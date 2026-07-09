import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { spellingCheck } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { applyFieldCorrection } from '../lib/slideFields'
import {
  hasSpellingTextChanges,
  normalizeSpellingIssues,
} from '../lib/spellingReview'
import { reconcileSpellingSuggestion } from '../lib/spellingNormalize'
import { supabase } from '../lib/supabase'
import type { Slide, SpellingResult } from '../types'
import { useAuth } from './useAuth'

const spellingQueryKey = ['spelling_results'] as const
/** Edge Function spelling-check BATCH_SIZE와 동일 */
const SPELLING_BATCH_SIZE = 10

function normalizeSpellingResult(row: SpellingResult & { issues?: unknown; approved?: boolean }): SpellingResult {
  const issues = normalizeSpellingIssues(row.issues)
  const { suggestion, issues: reconciledIssues } = reconcileSpellingSuggestion(
    row.original,
    row.suggestion,
    issues,
  )

  return {
    ...row,
    suggestion,
    skipped: row.skipped ?? false,
    approved: row.approved ?? false,
    issues: reconciledIssues,
  }
}

export interface SpellingCheckSummary {
  resultCount: number
  changeCount: number
  processedSlides: number
}

export function useSpellingResults(projectId: string | undefined) {
  return useQuery({
    queryKey: [...spellingQueryKey, projectId],
    queryFn: async (): Promise<SpellingResult[]> => {
      const { data, error } = await supabase
        .from('spelling_results')
        .select('*')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data ?? []).map((row) => normalizeSpellingResult(row as SpellingResult))
    },
    enabled: !!projectId,
  })
}

export function useRunSpellingCheck() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      slideIds,
      onProgress,
      onChunkProgress,
    }: {
      projectId: string
      slideIds: string[]
      onProgress?: (percent: number) => void
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<SpellingCheckSummary> => {
      if (slideIds.length === 0) {
        throw new Error('검사할 슬라이드가 없습니다.')
      }

      const { error: statusError } = await supabase
        .from('projects')
        .update({ status: 'spelling' })
        .eq('id', projectId)

      if (statusError) throw statusError

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += SPELLING_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + SPELLING_BATCH_SIZE))
      }

      let totalResults = 0
      let processedSlides = 0

      onChunkProgress?.(mergeChunkProgress(0, batches.length, '맞춤법 검사 준비'))
      onProgress?.(0)

      for (let i = 0; i < batches.length; i++) {
        const from = i * SPELLING_BATCH_SIZE + 1
        const to = Math.min((i + 1) * SPELLING_BATCH_SIZE, slideIds.length)

        onChunkProgress?.(
          mergeChunkProgress(i, batches.length, `${from}~${to}번 슬라이드 AI 검사 중`),
        )

        const result = await spellingCheck(projectId, batches[i], {
          resetResults: i === 0,
          finalize: i === batches.length - 1,
        })

        totalResults += result.result_count
        processedSlides += result.processed_slides

        const percent = Math.round(((i + 1) / batches.length) * 100)
        onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, 'AI 검사'))
        onProgress?.(percent)
      }

      if (totalResults === 0) {
        throw new Error(
          '맞춤법 검사 결과가 저장되지 않았습니다. 추출된 화면 텍스트·나레이션이 있는지 확인해 주세요.',
        )
      }

      await queryClient.invalidateQueries({
        queryKey: [...spellingQueryKey, projectId],
      })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })

      const results = await queryClient.fetchQuery({
        queryKey: [...spellingQueryKey, projectId],
        queryFn: async (): Promise<SpellingResult[]> => {
          const { data, error } = await supabase
            .from('spelling_results')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true })

          if (error) throw error
          return (data ?? []).map((row) => normalizeSpellingResult(row as SpellingResult))
        },
      })
      const changeCount = results.filter(hasSpellingTextChanges).length

      onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '맞춤법 검사 완료'))
      onProgress?.(100)

      return {
        resultCount: totalResults,
        changeCount,
        processedSlides,
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

/** v2 스토리보드 Step 2 — 화면텍스트 맞춤법만 검사 */
export function useRunScreenTextSpellingCheck() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      slideIds,
      onChunkProgress,
    }: {
      projectId: string
      storyboardId: string
      slideIds: string[]
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
      if (slideIds.length === 0) {
        throw new Error('검사할 슬라이드가 없습니다.')
      }

      const batches: string[][] = []
      for (let i = 0; i < slideIds.length; i += SPELLING_BATCH_SIZE) {
        batches.push(slideIds.slice(i, i + SPELLING_BATCH_SIZE))
      }

      onChunkProgress?.(mergeChunkProgress(0, batches.length, '맞춤법 검사 준비'))

      for (let i = 0; i < batches.length; i++) {
        onChunkProgress?.(mergeChunkProgress(i + 1, batches.length, '맞춤법 AI 검사'))
        await spellingCheck(projectId, batches[i], {
          storyboardId,
          screenTextOnly: true,
          resetResults: i === 0,
          finalize: i === batches.length - 1,
        })
      }

      onChunkProgress?.(mergeChunkProgress(batches.length, batches.length, '맞춤법 검사 완료'))
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({
        queryKey: ['storyboards', 'detail', variables.storyboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['spelling_results'] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.storyboardId] })
    },
  })
}

async function applySpellingResultToSlide(
  result: SpellingResult,
  slide: Slide,
  projectId: string,
  userId: string | undefined,
): Promise<void> {
  const updates = applyFieldCorrection(slide, result.field, result.suggestion)
  if (Object.keys(updates).length === 0) {
    throw new Error('해당 필드를 업데이트할 수 없습니다.')
  }

  const { error: slideError } = await supabase
    .from('slides')
    .update(updates)
    .eq('id', slide.id)

  if (slideError) throw slideError

  const { error: resultError } = await supabase
    .from('spelling_results')
    .update({ applied: true, skipped: false, approved: true })
    .eq('id', result.id)

  if (resultError) throw resultError

  if (userId) {
    const { error: logError } = await supabase.from('change_logs').insert({
      project_id: projectId,
      user_id: userId,
      action: 'spelling_applied',
      detail: `슬라이드 ${slide.slide_num} ${result.field} 수정 적용`,
      metadata: { stage: 'spelling', spelling_result_id: result.id },
    })

    if (logError) throw logError
  }
}

export function useApplySpellingFix() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      result,
      slide,
      projectId,
    }: {
      result: SpellingResult
      slide: Slide
      projectId: string
      storyboardId?: string
    }): Promise<void> => {
      await applySpellingResultToSlide(result, slide, projectId, user?.id)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      if (variables.storyboardId) {
        queryClient.invalidateQueries({ queryKey: ['slides', variables.storyboardId] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['slides'] })
      }
    },
  })
}

export function useBulkApplySpellingFix() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      results,
      slides,
      projectId,
    }: {
      results: SpellingResult[]
      slides: Slide[]
      projectId: string
      storyboardId?: string
    }): Promise<number> => {
      const slideMap = new Map(slides.map((s) => [s.id, s]))
      let applied = 0

      for (const result of results) {
        const slide = slideMap.get(result.slide_id)
        if (!slide) continue
        await applySpellingResultToSlide(result, slide, projectId, user?.id)
        applied += 1
      }

      return applied
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
      if (variables.storyboardId) {
        queryClient.invalidateQueries({ queryKey: ['slides', variables.storyboardId] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['slides'] })
      }
    },
  })
}

export function useSkipSpellingFix() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      resultIds,
      projectId: _projectId,
    }: {
      resultIds: string[]
      projectId: string
    }): Promise<void> => {
      if (resultIds.length === 0) return

      const { error } = await supabase
        .from('spelling_results')
        .update({ skipped: true, approved: false })
        .in('id', resultIds)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

export function useApproveSpellingFix() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      resultIds,
      projectId: _projectId,
    }: {
      resultIds: string[]
      projectId: string
    }): Promise<void> => {
      if (resultIds.length === 0) return

      const { error } = await supabase
        .from('spelling_results')
        .update({ approved: true, skipped: false })
        .in('id', resultIds)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

export function useRevokeSpellingApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      resultIds,
      projectId: _projectId,
    }: {
      resultIds: string[]
      projectId: string
    }): Promise<void> => {
      if (resultIds.length === 0) return

      const { error } = await supabase
        .from('spelling_results')
        .update({ approved: false })
        .in('id', resultIds)
        .eq('applied', false)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...spellingQueryKey, variables.projectId] })
    },
  })
}

export function useCompleteSpellingReview() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ projectId }: { projectId: string }): Promise<void> => {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'spelling_done' })
        .eq('id', projectId)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] })
    },
  })
}

export function issueTypeLabel(type: string): string {
  switch (type) {
    case 'spelling':
    case 'spacing':
      return '맞춤법'
    case 'grammar':
      return '내용'
    case 'style':
      return '일관성'
    default:
      return '맞춤법'
  }
}

export function hasSpellingChanges(result: SpellingResult): boolean {
  return hasSpellingTextChanges(result)
}

export { isSpellingPendingReview, isSpellingReviewSettled, isSpellingApplySettled } from '../lib/spellingReview'

export function isSpellingCheckComplete(status: string): boolean {
  return status === 'spelling_done'
}

export function isSpellingCheckInterrupted(status: string): boolean {
  return status === 'spelling'
}
