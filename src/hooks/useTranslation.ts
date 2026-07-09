import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { translateSlides } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { fetchTranslationsForSlides } from '../lib/supabaseChunks'
import {
  estimateKoDurationSeconds,
  estimateTargetDurationSeconds,
  getLangConfig,
  NARRATION_FIELD_KEY,
} from '../lib/lang'
import { supabase } from '../lib/supabase'
import type { Translation } from '../types'

const translationsQueryKey = ['translations'] as const
const TRANSLATE_BATCH_SIZE = 3

export function useStoryboardTranslations(
  storyboardId: string | undefined,
  slideIds: string[],
) {
  return useQuery({
    queryKey: [...translationsQueryKey, 'storyboard', storyboardId],
    queryFn: async (): Promise<Translation[]> => {
      if (slideIds.length === 0) return []
      return fetchTranslationsForSlides(slideIds)
    },
    enabled: !!storyboardId && slideIds.length > 0,
  })
}

export function useTranslations(projectId: string | undefined) {
  return useQuery({
    queryKey: [...translationsQueryKey, projectId],
    queryFn: async (): Promise<Translation[]> => {
      const { data, error } = await supabase
        .from('translations')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })
}

export function useRunScreenTextTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      slideIds,
      targetLang,
      onChunkProgress,
    }: {
      projectId: string
      storyboardId: string
      slideIds: string[]
      targetLang: string
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
      if (slideIds.length === 0) {
        throw new Error('번역할 슬라이드가 없습니다.')
      }

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + TRANSLATE_BATCH_SIZE))
      }

      onChunkProgress?.(mergeChunkProgress(0, batches.length, '번역 준비'))

      for (let i = 0; i < batches.length; i++) {
        onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, '슬라이드 묶음 AI 번역'))

        await translateSlides(projectId, storyboardId, batches[i], targetLang, {
          resetResults: i === 0,
          finalize: i === batches.length - 1,
          screenTextOnly: true,
        })
      }

      onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '번역 완료'))
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({
        queryKey: [...translationsQueryKey, 'storyboard', variables.storyboardId],
      })
    },
  })
}

/** @deprecated v1 전체 번역 워크플로용 */
export function useRunTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      slideIds,
      targetLang,
      onChunkProgress,
    }: {
      projectId: string
      storyboardId: string
      slideIds: string[]
      targetLang: string
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + TRANSLATE_BATCH_SIZE))
      }

      for (let i = 0; i < batches.length; i++) {
        await translateSlides(projectId, storyboardId, batches[i], targetLang, {
          resetResults: i === 0,
          finalize: i === batches.length - 1,
          screenTextOnly: false,
        })
        onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, '번역'))
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...translationsQueryKey, variables.projectId] })
    },
  })
}

export function useUpdateTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      viText,
    }: {
      id: string
      projectId: string
      viText: string
      targetLang: string
    }): Promise<Translation> => {
      const { data, error } = await supabase
        .from('translations')
        .update({ vi_text: viText })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: translationsQueryKey })
    },
  })
}

export { NARRATION_FIELD_KEY }

export function getNarrationSpeedInfo(
  translation: Translation,
  targetLang: string,
) {
  const koSeconds = estimateKoDurationSeconds(translation.source)
  const targetSeconds = estimateTargetDurationSeconds(translation.vi_text, targetLang)
  const exceeds = targetSeconds > koSeconds && koSeconds > 0

  return {
    koSeconds,
    targetSeconds,
    exceeds,
    langName: getLangConfig(targetLang).name,
  }
}
