import { useMutation, useQueryClient } from '@tanstack/react-query'
import { translateSlides, verifyTranslations } from '../lib/claudeApi'
import { type ChunkProgress, mergeChunkProgress } from '../lib/chunkProgress'
import { fetchTranslationIdsForSlides } from '../lib/supabaseChunks'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const TRANSLATE_BATCH = 6
const VERIFY_SLIDE_BATCH = 12

function getLangLabel(targetLang: string): string {
  const labels: Record<string, string> = {
    en: '영어',
    vi: '베트남어',
    zh: '중국어',
    ja: '일본어',
    id: '인도네시아어',
  }
  return labels[targetLang] ?? '목표 언어'
}

/** v2 스토리보드 Step 2 — 화면텍스트 번역 + 역번역 검증 */
export function useRunScreenTextTranslationAndVerify() {
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
        throw new Error('처리할 슬라이드가 없습니다.')
      }

      const translateBatches: string[][] = []
      for (let i = 0; i < slideIds.length; i += TRANSLATE_BATCH) {
        translateBatches.push(slideIds.slice(i, i + TRANSLATE_BATCH))
      }

      const verifySlideBatches: string[][] = []
      for (let i = 0; i < slideIds.length; i += VERIFY_SLIDE_BATCH) {
        verifySlideBatches.push(slideIds.slice(i, i + VERIFY_SLIDE_BATCH))
      }

      const progressTotal =
        1 + translateBatches.length + 1 + verifySlideBatches.length + 1
      let progressStep = 0

      const report = (phase: string, waiting = false) => {
        onChunkProgress?.({
          ...mergeChunkProgress(progressStep, progressTotal, phase),
          waiting,
        })
      }

      report('번역 준비')

      for (let i = 0; i < translateBatches.length; i++) {
        const phase = `${getLangLabel(targetLang)} 번역 (${i + 1}/${translateBatches.length})`
        report(phase, true)
        await translateSlides(projectId, storyboardId, translateBatches[i], targetLang, {
          screenTextOnly: true,
          resetResults: i === 0,
          finalize: i === translateBatches.length - 1,
        })
        progressStep += 1
        report(phase, false)
        await queryClient.invalidateQueries({ queryKey: ['translations'] })
      }

      progressStep += 1
      report('번역 결과 확인')

      const translationIds = await fetchTranslationIdsForSlides(projectId, slideIds)
      if (translationIds.length === 0) {
        throw new Error('번역 결과가 없습니다. 맞춤법 검사·추출 상태를 확인해 주세요.')
      }

      for (let i = 0; i < verifySlideBatches.length; i++) {
        const phase = `역번역 검증 (${i + 1}/${verifySlideBatches.length})`
        report(phase, true)
        await verifyTranslations(projectId, {
          storyboardId,
          slideIds: verifySlideBatches[i],
          resetResults: i === 0,
          finalize: i === verifySlideBatches.length - 1,
          pipelineReview: true,
          storyboardFinalizeStatus: 'verifying',
        })
        progressStep += 1
        report(phase, false)
        await queryClient.invalidateQueries({ queryKey: ['verifications'] })
      }

      progressStep = progressTotal
      report('번역·역번역 완료 — 결과를 검토해 주세요')
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({
        queryKey: ['storyboards', 'detail', variables.storyboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['slides', variables.storyboardId] })
      queryClient.invalidateQueries({ queryKey: ['translations'] })
      queryClient.invalidateQueries({ queryKey: ['verifications'] })
    },
  })
}

/** 번역은 유지하고 역번역 검증만 다시 실행 */
export function useRunScreenTextVerifyOnly() {
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
        throw new Error('검증할 슬라이드가 없습니다.')
      }

      const translationIds = await fetchTranslationIdsForSlides(projectId, slideIds)
      if (translationIds.length === 0) {
        throw new Error('번역 결과가 없습니다. 먼저 번역을 실행해 주세요.')
      }

      const verifySlideBatches: string[][] = []
      for (let i = 0; i < slideIds.length; i += VERIFY_SLIDE_BATCH) {
        verifySlideBatches.push(slideIds.slice(i, i + VERIFY_SLIDE_BATCH))
      }

      const progressTotal = verifySlideBatches.length + 1
      let progressStep = 0

      const report = (phase: string, waiting = false) => {
        onChunkProgress?.({
          ...mergeChunkProgress(progressStep, progressTotal, phase),
          waiting,
        })
      }

      report('역번역 검증 준비')

      for (let i = 0; i < verifySlideBatches.length; i++) {
        const phase = `역번역 검증 (${i + 1}/${verifySlideBatches.length})`
        report(phase, true)
        await verifyTranslations(projectId, {
          storyboardId,
          slideIds: verifySlideBatches[i],
          resetResults: i === 0,
          finalize: i === verifySlideBatches.length - 1,
          pipelineReview: true,
          storyboardFinalizeStatus: 'verifying',
        })
        progressStep += 1
        report(phase, false)
        await queryClient.invalidateQueries({ queryKey: ['verifications'] })
      }

      progressStep = progressTotal
      report('역번역 검증 완료 — 결과를 검토해 주세요')
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({
        queryKey: ['storyboards', 'detail', variables.storyboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['verifications'] })
    },
  })
}

export function useCompleteStoryboardPipelineReview() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
    }: {
      projectId: string
      storyboardId: string
    }): Promise<void> => {
      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'verification_applied',
          detail: '맞춤법·번역·역번역 검토 완료',
          metadata: { stage: 'pipeline_review', storyboard_id: storyboardId },
        })
      }

      const { error } = await supabase
        .from('storyboards')
        .update({ status: 'verified' })
        .eq('id', storyboardId)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({ queryKey: ['storyboards', 'detail', variables.storyboardId] })
    },
  })
}
