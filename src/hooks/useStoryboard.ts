import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { extractManuscriptText, getManuscriptContentType, getManuscriptExtension } from '../lib/manuscriptParser'
import { supabase } from '../lib/supabase'
import type { Storyboard, StoryboardStatus } from '../types'
import { useAuth } from './useAuth'
import {
  STORAGE_BUCKET,
  getManuscriptStoragePath,
  getPptxStoragePath,
  projectsQueryKey,
} from './useProject'

const storyboardsQueryKey = ['storyboards'] as const

export function useStoryboards(projectId: string | undefined) {
  return useQuery({
    queryKey: [...storyboardsQueryKey, projectId],
    queryFn: async (): Promise<Storyboard[]> => {
      const { data, error } = await supabase
        .from('storyboards')
        .select('*')
        .eq('project_id', projectId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useStoryboard(storyboardId: string | undefined) {
  return useQuery({
    queryKey: [...storyboardsQueryKey, 'detail', storyboardId],
    queryFn: async (): Promise<Storyboard> => {
      const { data, error } = await supabase
        .from('storyboards')
        .select('*')
        .eq('id', storyboardId!)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!storyboardId,
  })
}

export interface CreateStoryboardInput {
  projectId: string
  title: string
  pptxFile: File
  manuscriptFile: File
}

export function useCreateStoryboard() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateStoryboardInput): Promise<Storyboard> => {
      if (!user) throw new Error('로그인이 필요합니다.')

      const manuscriptText = await extractManuscriptText(input.manuscriptFile)
      const manuscriptExt = getManuscriptExtension(input.manuscriptFile.name)
      if (!manuscriptExt) {
        throw new Error('원고는 TXT, DOCX, PDF, PPT, PPTX 파일만 지원합니다.')
      }

      const { data: existing } = await supabase
        .from('storyboards')
        .select('sort_order')
        .eq('project_id', input.projectId)
        .order('sort_order', { ascending: false })
        .limit(1)

      const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1

      const { data: storyboard, error: createError } = await supabase
        .from('storyboards')
        .insert({
          project_id: input.projectId,
          title: input.title.trim(),
          status: 'uploaded',
          sort_order: nextOrder,
          manuscript_text: manuscriptText,
        })
        .select()
        .single()

      if (createError) throw createError

      const pptxPath = getPptxStoragePath(user.id, input.projectId, storyboard.id)
      const manuscriptPath = getManuscriptStoragePath(
        user.id,
        input.projectId,
        storyboard.id,
        manuscriptExt,
      )

      const { error: pptxUploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(pptxPath, input.pptxFile, {
          contentType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          upsert: false,
        })

      if (pptxUploadError) {
        await supabase.from('storyboards').delete().eq('id', storyboard.id)
        throw pptxUploadError
      }

      const manuscriptContentType = getManuscriptContentType(manuscriptExt)

      const { error: manuscriptUploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(manuscriptPath, input.manuscriptFile, {
          contentType: manuscriptContentType,
          upsert: false,
        })

      if (manuscriptUploadError) {
        await supabase.storage.from(STORAGE_BUCKET).remove([pptxPath])
        await supabase.from('storyboards').delete().eq('id', storyboard.id)
        throw manuscriptUploadError
      }

      const { data: updated, error: updateError } = await supabase
        .from('storyboards')
        .update({
          source_pptx_url: pptxPath,
          source_pptx_name: input.pptxFile.name,
          source_manuscript_url: manuscriptPath,
          source_manuscript_name: input.manuscriptFile.name,
        })
        .eq('id', storyboard.id)
        .select()
        .single()

      if (updateError) throw updateError

      await supabase.from('change_logs').insert({
        project_id: input.projectId,
        user_id: user.id,
        action: 'pptx_uploaded',
        detail: `${input.title}: PPTX + 원고 업로드`,
      })

      return updated
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [...storyboardsQueryKey, data.project_id] })
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}

export function useUpdateStoryboardStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
      status,
    }: {
      id: string
      projectId: string
      status: StoryboardStatus
    }): Promise<Storyboard> => {
      const { data, error } = await supabase
        .from('storyboards')
        .update({ status })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [...storyboardsQueryKey, data.project_id] })
      queryClient.invalidateQueries({ queryKey: [...storyboardsQueryKey, 'detail', data.id] })
    },
  })
}

export function useDeleteStoryboard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
    }: {
      id: string
      projectId: string
    }): Promise<void> => {
      const { error } = await supabase.from('storyboards').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...storyboardsQueryKey, variables.projectId] })
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}
