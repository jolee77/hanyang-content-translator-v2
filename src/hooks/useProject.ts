import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Project, ProjectStatus } from '../types'
import { useAuth } from './useAuth'

export const STORAGE_BUCKET = 'pptx-files'
export const projectsQueryKey = ['projects'] as const

export function getPptxStoragePath(
  userId: string,
  projectId: string,
  storyboardId: string,
): string {
  return `${userId}/${projectId}/${storyboardId}/source.pptx`
}

export function getManuscriptStoragePath(
  userId: string,
  projectId: string,
  storyboardId: string,
  extension: string,
): string {
  return `${userId}/${projectId}/${storyboardId}/manuscript${extension}`
}

export function useProjects() {
  const { user } = useAuth()

  return useQuery({
    queryKey: [...projectsQueryKey, user?.id],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('created_by', user!.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
    enabled: !!user,
  })
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: [...projectsQueryKey, id],
    queryFn: async (): Promise<Project> => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id!)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

export interface CreateProjectInput {
  title: string
  translationGuidelines: string
  targetLang: string
}

export function useCreateProject() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateProjectInput): Promise<Project> => {
      if (!user) throw new Error('로그인이 필요합니다.')

      const { data: project, error: createError } = await supabase
        .from('projects')
        .insert({
          created_by: user.id,
          title: input.title.trim(),
          status: 'uploaded',
          target_lang: input.targetLang,
          translation_guidelines: input.translationGuidelines.trim(),
        })
        .select()
        .single()

      if (createError) throw createError

      await supabase.from('change_logs').insert({
        project_id: project.id,
        user_id: user.id,
        action: 'project_created',
        detail: project.title,
      })

      return project
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      title,
      translationGuidelines,
      targetLang,
    }: {
      id: string
      title?: string
      translationGuidelines?: string
      targetLang?: string
    }): Promise<Project> => {
      const updates: Record<string, string> = {}
      if (title !== undefined) updates.title = title.trim()
      if (translationGuidelines !== undefined) {
        updates.translation_guidelines = translationGuidelines.trim()
      }
      if (targetLang !== undefined) updates.target_lang = targetLang

      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...projectsQueryKey, data.id] })
    },
  })
}

export function useUpdateProjectStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string
      status: ProjectStatus
    }): Promise<Project> => {
      const { data, error } = await supabase
        .from('projects')
        .update({ status })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectsQueryKey })
      queryClient.invalidateQueries({ queryKey: [...projectsQueryKey, data.id] })
    },
  })
}
