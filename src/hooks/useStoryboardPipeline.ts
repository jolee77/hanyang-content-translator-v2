import { useMutation, useQueryClient } from '@tanstack/react-query'
import { spellingCheck, translateSlides, verifyTranslations } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { applyFieldCorrection } from '../lib/slideFields'
import { hasSpellingTextChanges } from '../lib/spellingReview'
import { supabase } from '../lib/supabase'
import type { Slide, SpellingResult } from '../types'
import { useAuth } from './useAuth'

const SPELLING_BATCH = 10
const TRANSLATE_BATCH = 3
const VERIFY_BATCH = 4

async function applySpellingToSlides(
  results: SpellingResult[],
  slides: Slide[],
  projectId: string,
  userId: string | undefined,
): Promise<number> {
  const slideMap = new Map(slides.map((s) => [s.id, s]))
  let applied = 0

  for (const result of results) {
    if (!hasSpellingTextChanges(result)) continue
    const slide = slideMap.get(result.slide_id)
    if (!slide) continue

    const updates = applyFieldCorrection(slide, result.field, result.suggestion)
    if (Object.keys(updates).length === 0) continue

    const { error: slideError } = await supabase.from('slides').update(updates).eq('id', slide.id)
    if (slideError) throw slideError

    const { error: resultError } = await supabase
      .from('spelling_results')
      .update({ applied: true, skipped: false })
      .eq('id', result.id)
    if (resultError) throw resultError

    if (userId) {
      await supabase.from('change_logs').insert({
        project_id: projectId,
        user_id: userId,
        action: 'spelling_applied',
        detail: `슬라이드 ${slide.slide_num} ${result.field} 자동 교정`,
      })
    }

    applied += 1
  }

  return applied
}

export function useRunScreenTextPipeline() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      slides,
      targetLang,
      onChunkProgress,
    }: {
      projectId: string
      storyboardId: string
      slides: Slide[]
      targetLang: string
      onChunkProgress?: (progress: ChunkProgress) => void
    }): Promise<void> => {
      const slideIds = slides
        .filter((s) => s.slide_type !== 'guide')
        .map((s) => s.id)

      if (slideIds.length === 0) {
        throw new Error('처리할 슬라이드가 없습니다.')
      }

      // 1. 맞춤법 검사
      const spellingBatches: string[][] = []
      for (let i = 0; i < slideIds.length; i += SPELLING_BATCH) {
        spellingBatches.push(slideIds.slice(i, i + SPELLING_BATCH))
      }

      onChunkProgress?.(mergeChunkProgress(0, spellingBatches.length + 3, '맞춤법 검사 준비'))

      for (let i = 0; i < spellingBatches.length; i++) {
        onChunkProgress?.(
          mergeChunkProgress(i + 1, spellingBatches.length + 3, '맞춤법 AI 검사'),
        )
        await spellingCheck(projectId, spellingBatches[i], {
          storyboardId,
          screenTextOnly: true,
          resetResults: i === 0,
          finalize: i === spellingBatches.length - 1,
        })
      }

      const { data: spellingResults, error: spellingError } = await supabase
        .from('spelling_results')
        .select('*')
        .eq('project_id', projectId)
        .in('slide_id', slideIds)

      if (spellingError) throw spellingError

      onChunkProgress?.(
        mergeChunkProgress(spellingBatches.length + 1, spellingBatches.length + 3, '맞춤법 자동 반영'),
      )

      await applySpellingToSlides((spellingResults ?? []) as SpellingResult[], slides, projectId, user?.id)

      // 2. 영어 번역
      const translateBatches: string[][] = []
      for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH) {
        translateBatches.push(slideIds.slice(i, i + TRANSLATE_BATCH))
      }

      for (let i = 0; i < translateBatches.length; i++) {
        onChunkProgress?.(
          mergeChunkProgress(
            spellingBatches.length + 1 + i,
            spellingBatches.length + translateBatches.length + 2,
            '영어 번역',
          ),
        )
        await translateSlides(projectId, storyboardId, translateBatches[i], targetLang, {
          screenTextOnly: true,
          resetResults: i === 0,
          finalize: i === translateBatches.length - 1,
        })
      }

      // 3. 역번역 검증
      const { data: translations, error: trError } = await supabase
        .from('translations')
        .select('id')
        .eq('project_id', projectId)
        .in('slide_id', slideIds)

      if (trError) throw trError

      const translationIds = (translations ?? []).map((row) => row.id)
      if (translationIds.length === 0) {
        throw new Error('번역 결과가 없습니다.')
      }

      const verifyBatches: string[][] = []
      for (let i = 0; i < translationIds.length; i += VERIFY_BATCH) {
        verifyBatches.push(translationIds.slice(i, i + VERIFY_BATCH))
      }

      for (let i = 0; i < verifyBatches.length; i++) {
        onChunkProgress?.(
          mergeChunkProgress(
            spellingBatches.length + translateBatches.length + 1 + i,
            spellingBatches.length + translateBatches.length + verifyBatches.length + 1,
            '역번역 검증',
          ),
        )
        await verifyTranslations(projectId, {
          storyboardId,
          translationIds: verifyBatches[i],
          resetResults: i === 0,
          finalize: i === verifyBatches.length - 1,
        })
      }

      onChunkProgress?.(
        mergeChunkProgress(
          spellingBatches.length + translateBatches.length + verifyBatches.length,
          spellingBatches.length + translateBatches.length + verifyBatches.length,
          '처리 완료',
        ),
      )
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.storyboardId] })
      queryClient.invalidateQueries({ queryKey: ['translations'] })
      queryClient.invalidateQueries({ queryKey: ['verifications'] })
      queryClient.invalidateQueries({ queryKey: ['spelling_results'] })
    },
  })
}
