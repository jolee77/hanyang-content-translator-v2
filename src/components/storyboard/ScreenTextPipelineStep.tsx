import { useEffect, useMemo, useState } from 'react'
import { formatScreenText } from '../../lib/pptxParser'
import { fieldKeyLabel } from '../../lib/slideFields'
import {
  formatSpellingReviewReason,
  getSpellingItemStatus,
  hasSpellingTextChanges,
  isSpellingApplySettled,
  isSpellingApprovedForApply,
  isSpellingPendingReview,
  isSpellingReviewSettled,
  spellingItemBoxClass,
} from '../../lib/spellingReview'
import { downloadBlob } from '../../lib/xlsxGenerator'
import { generateKoreanCorrectedPptx } from '../../lib/pptxGenerator'
import { supabase } from '../../lib/supabase'
import { STORAGE_BUCKET } from '../../hooks/useProject'
import { useSlides } from '../../hooks/useSlides'
import {
  useCompleteStoryboardPipelineReview,
  useRunScreenTextTranslationAndVerify,
  useRunScreenTextVerifyOnly,
} from '../../hooks/useStoryboardPipeline'
import {
  useApplySpellingFix,
  useApproveSpellingFix,
  useBulkApplySpellingFix,
  useRevokeSpellingApproval,
  useRunScreenTextSpellingCheck,
  useSkipSpellingFix,
  useSpellingResults,
} from '../../hooks/useSpelling'
import { useStoryboardTranslations } from '../../hooks/useTranslation'
import {
  getMatchStatus,
  isVerificationPendingReview,
  isVerificationReviewSettled,
  matchStatusClass,
  matchStatusLabel,
  useBulkUpdateVerificationStatus,
  useUpdateVerificationStatus,
  useVerifications,
} from '../../hooks/useVerification'
import { useToast } from '../../hooks/ToastProvider'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import { SuggestionHighlight } from '../ui/SuggestionHighlight'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project, SpellingResult, Storyboard, Verification } from '../../types'
import { getLangConfig } from '../../lib/lang'
import { isStoryboardStatusAtLeast } from '../../lib/storyboardStatus'

interface ScreenTextPipelineStepProps {
  project: Project
  storyboard: Storyboard
  onStepComplete?: () => void
}

export function ScreenTextPipelineStep({
  project,
  storyboard,
  onStepComplete,
}: ScreenTextPipelineStepProps) {
  const { showToast } = useToast()
  const { data: slides = [] } = useSlides(storyboard.id)
  const { data: allSpellingResults = [] } = useSpellingResults(project.id)
  const slideIdSet = useMemo(() => new Set(slides.map((s) => s.id)), [slides])
  const { data: translations = [] } = useStoryboardTranslations(
    storyboard.id,
    slides.map((s) => s.id),
  )
  const { data: verifications = [] } = useVerifications(project.id)

  const runSpelling = useRunScreenTextSpellingCheck()
  const runTranslationVerify = useRunScreenTextTranslationAndVerify()
  const runVerifyOnly = useRunScreenTextVerifyOnly()
  const completeReview = useCompleteStoryboardPipelineReview()
  const applyFix = useApplySpellingFix()
  const approveFix = useApproveSpellingFix()
  const revokeApproval = useRevokeSpellingApproval()
  const bulkApply = useBulkApplySpellingFix()
  const skipFix = useSkipSpellingFix()
  const updateVerification = useUpdateVerificationStatus()
  const bulkUpdateVerification = useBulkUpdateVerificationStatus()

  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)
  const [progressPhase, setProgressPhase] = useState<'spelling' | 'translation' | null>(null)
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set())
  const [selectedApplyIds, setSelectedApplyIds] = useState<Set<string>>(new Set())
  const [selectedVerificationIds, setSelectedVerificationIds] = useState<Set<string>>(new Set())
  const [isGeneratingPptx, setIsGeneratingPptx] = useState(false)

  const eligibleSlides = useMemo(
    () => slides.filter((s) => s.slide_type !== 'guide' && formatScreenText(s.screen_text).trim()),
    [slides],
  )

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

  const spellingResults = useMemo(
    () => allSpellingResults.filter((r) => slideIdSet.has(r.slide_id)),
    [allSpellingResults, slideIdSet],
  )

  const storyboardVerifications = useMemo(
    () => verifications.filter((v) => translations.some((t) => t.id === v.translation_id)),
    [verifications, translations],
  )

  const verificationByTranslationId = useMemo(
    () => new Map(storyboardVerifications.map((v) => [v.translation_id, v])),
    [storyboardVerifications],
  )

  const pendingSpelling = useMemo(
    () => spellingResults.filter(isSpellingPendingReview),
    [spellingResults],
  )

  const approvedForApply = useMemo(
    () => spellingResults.filter(isSpellingApprovedForApply),
    [spellingResults],
  )

  const appliedSpelling = useMemo(
    () => spellingResults.filter((r) => r.applied),
    [spellingResults],
  )

  const pendingVerification = useMemo(
    () => storyboardVerifications.filter(isVerificationPendingReview),
    [storyboardVerifications],
  )

  const targetLang = project.target_lang
  const langName = getLangConfig(targetLang).name
  const isVerified = isStoryboardStatusAtLeast(storyboard.status, 'verified')
  const spellingChecked = isStoryboardStatusAtLeast(storyboard.status, 'spelling_done')
  const hasTranslationResults = translations.length > 0
  const hasPipelineResults = hasTranslationResults && storyboardVerifications.length > 0
  const spellingReviewSettled =
    spellingResults.length === 0 || isSpellingReviewSettled(spellingResults)
  const isTranslationRunning = runTranslationVerify.isPending || runVerifyOnly.isPending
  const showTranslationSection =
    spellingReviewSettled &&
    (isTranslationRunning ||
      hasTranslationResults ||
      isStoryboardStatusAtLeast(storyboard.status, 'translating'))
  const spellingApplySettled = isSpellingApplySettled(spellingResults)
  const spellingSettled = spellingReviewSettled && spellingApplySettled
  const verificationSettled = isVerificationReviewSettled(storyboardVerifications)

  const eligibleSlideIds = useMemo(() => eligibleSlides.map((s) => s.id), [eligibleSlides])

  const canRunSpelling =
    eligibleSlides.length > 0 &&
    isStoryboardStatusAtLeast(storyboard.status, 'extracted') &&
    !isVerified &&
    storyboard.status !== 'expert_review' &&
    storyboard.status !== 'done'

  const canRunTranslation =
    canRunSpelling &&
    spellingChecked &&
    spellingReviewSettled

  const canCompleteReview =
    hasPipelineResults &&
    spellingSettled &&
    verificationSettled &&
    !isVerified

  useEffect(() => {
    setSelectedReviewIds((prev) => {
      const pendingIds = new Set(pendingSpelling.map((r) => r.id))
      const next = new Set<string>()
      for (const id of prev) {
        if (pendingIds.has(id)) next.add(id)
      }
      return next
    })
  }, [pendingSpelling])

  useEffect(() => {
    setSelectedApplyIds((prev) => {
      const applyIds = new Set(approvedForApply.map((r) => r.id))
      const next = new Set<string>()
      for (const id of prev) {
        if (applyIds.has(id)) next.add(id)
      }
      return next
    })
  }, [approvedForApply])

  useEffect(() => {
    setSelectedVerificationIds((prev) => {
      const pendingIds = new Set(pendingVerification.map((v) => v.id))
      const next = new Set<string>()
      for (const id of prev) {
        if (pendingIds.has(id)) next.add(id)
      }
      return next
    })
  }, [pendingVerification])

  const handleRunSpelling = async () => {
    if (eligibleSlideIds.length === 0) {
      showToast('검사할 화면 텍스트가 없습니다.', 'error')
      return
    }

    try {
      setProgressPhase('spelling')
      setChunkProgress(null)
      await runSpelling.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slideIds: eligibleSlideIds,
        onChunkProgress: setChunkProgress,
      })
      showToast('맞춤법 검사가 완료되었습니다. 수정안을 승인하거나 거절해 주세요.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '맞춤법 검사에 실패했습니다.', 'error')
    } finally {
      setChunkProgress(null)
      setProgressPhase(null)
    }
  }

  const handleRunTranslationVerify = async () => {
    if (!spellingReviewSettled) {
      showToast('맞춤법 검토(승인/거절)를 모두 완료한 뒤 실행해 주세요.', 'error')
      return
    }

    if (eligibleSlideIds.length === 0) {
      showToast('처리할 화면 텍스트가 없습니다.', 'error')
      return
    }

    try {
      setProgressPhase('translation')
      setChunkProgress(null)
      await runTranslationVerify.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slideIds: eligibleSlideIds,
        targetLang,
        onChunkProgress: setChunkProgress,
      })
      showToast(
        `${langName} 번역·역번역이 완료되었습니다. 결과를 검토한 뒤 다음 단계로 진행해 주세요.`,
        'success',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '번역·역번역 처리에 실패했습니다.'
      if (hasTranslationResults) {
        showToast(
          `${message} 저장된 번역 ${translations.length}건은 유지됩니다. 역번역만 다시 실행하거나 결과를 검토해 주세요.`,
          'error',
        )
      } else {
        showToast(message, 'error')
      }
    } finally {
      setChunkProgress(null)
      setProgressPhase(null)
    }
  }

  const handleRunVerifyOnly = async () => {
    if (eligibleSlideIds.length === 0) {
      showToast('검증할 슬라이드가 없습니다.', 'error')
      return
    }

    try {
      setProgressPhase('translation')
      setChunkProgress(null)
      await runVerifyOnly.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slideIds: eligibleSlideIds,
        onChunkProgress: setChunkProgress,
      })
      showToast('역번역 검증이 완료되었습니다. 결과를 검토해 주세요.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '역번역 검증에 실패했습니다.', 'error')
    } finally {
      setChunkProgress(null)
      setProgressPhase(null)
    }
  }

  const handleComplete = async () => {
    if (isVerified) {
      onStepComplete?.()
      return
    }

    if (!spellingSettled) {
      if (!spellingReviewSettled) {
        showToast('맞춤법 수정안을 모두 검토해 주세요. (승인 또는 거절)', 'error')
      } else {
        showToast('승인한 맞춤법 항목을 슬라이드에 반영해 주세요.', 'error')
      }
      return
    }
    if (!verificationSettled) {
      showToast('주의·불일치 역번역 항목을 모두 승인 처리해 주세요.', 'error')
      return
    }

    try {
      await completeReview.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
      })
      showToast('검토가 완료되었습니다. 전문가 검증 단계로 진행할 수 있습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '완료 처리에 실패했습니다.', 'error')
    }
  }

  const handleApproveSpelling = async (result: SpellingResult) => {
    try {
      await approveFix.mutateAsync({ resultIds: [result.id], projectId: project.id })
      showToast('검토 승인했습니다. 「슬라이드 반영」에서 선택 후 반영하세요.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleRejectSpelling = async (result: SpellingResult) => {
    try {
      await skipFix.mutateAsync({ resultIds: [result.id], projectId: project.id })
      showToast('수정안을 거절했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleBulkApproveSpelling = async () => {
    const targets = pendingSpelling.filter((r) => selectedReviewIds.has(r.id))
    if (targets.length === 0) {
      showToast('승인할 항목을 선택해 주세요.', 'error')
      return
    }
    try {
      await approveFix.mutateAsync({
        resultIds: targets.map((r) => r.id),
        projectId: project.id,
      })
      setSelectedReviewIds(new Set())
      showToast(`${targets.length}건을 검토 승인했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleBulkRejectSpelling = async () => {
    const targets = pendingSpelling.filter((r) => selectedReviewIds.has(r.id))
    if (targets.length === 0) {
      showToast('거절할 항목을 선택해 주세요.', 'error')
      return
    }
    try {
      await skipFix.mutateAsync({
        resultIds: targets.map((r) => r.id),
        projectId: project.id,
      })
      setSelectedReviewIds(new Set())
      showToast(`${targets.length}건을 거절했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleApplySpelling = async (result: SpellingResult) => {
    const slide = slideMap.get(result.slide_id)
    if (!slide) return
    try {
      await applyFix.mutateAsync({
        result,
        slide,
        projectId: project.id,
        storyboardId: storyboard.id,
      })
      showToast('슬라이드 데이터에 반영했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '반영에 실패했습니다.', 'error')
    }
  }

  const handleRevokeApproval = async (result: SpellingResult) => {
    try {
      await revokeApproval.mutateAsync({ resultIds: [result.id], projectId: project.id })
      showToast('승인을 취소했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleBulkApplySpelling = async () => {
    const targets = approvedForApply.filter((r) => selectedApplyIds.has(r.id))
    if (targets.length === 0) {
      showToast('반영할 항목을 선택해 주세요.', 'error')
      return
    }
    try {
      const count = await bulkApply.mutateAsync({
        results: targets,
        slides,
        projectId: project.id,
        storyboardId: storyboard.id,
      })
      setSelectedApplyIds(new Set())
      showToast(`${count}건을 슬라이드에 반영했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '반영에 실패했습니다.', 'error')
    }
  }

  const handleDownloadCorrectedPptx = async () => {
    if (!storyboard.source_pptx_url) {
      showToast('원본 PPTX 경로가 없습니다.', 'error')
      return
    }
    if (appliedSpelling.length === 0) {
      showToast('반영된 맞춤법 항목이 없습니다. 먼저 슬라이드 반영을 완료해 주세요.', 'error')
      return
    }

    setIsGeneratingPptx(true)
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(storyboard.source_pptx_url)

      if (error) throw error

      const sourceFile = new File([data], storyboard.source_pptx_name ?? 'source.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

      const blob = await generateKoreanCorrectedPptx(sourceFile, slides, appliedSpelling)
      const safeTitle = storyboard.title.replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(blob, `${safeTitle}_맞춤법반영.pptx`)
      showToast('맞춤법이 반영된 한국어 PPTX를 다운로드했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 생성에 실패했습니다.', 'error')
    } finally {
      setIsGeneratingPptx(false)
    }
  }

  const handleVerificationDecision = async (
    verification: Verification,
    applyStatus: 'applied' | 'skipped',
  ) => {
    try {
      await updateVerification.mutateAsync({
        id: verification.id,
        projectId: project.id,
        applyStatus,
      })
      showToast(
        applyStatus === 'applied' ? '번역·역번역 결과를 승인했습니다.' : '번역·역번역 결과를 거절했습니다.',
        'success',
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleBulkApproveVerification = async () => {
    const targets = pendingVerification.filter((v) => selectedVerificationIds.has(v.id))
    if (targets.length === 0) {
      showToast('승인할 항목을 선택해 주세요.', 'error')
      return
    }
    try {
      await bulkUpdateVerification.mutateAsync({
        projectId: project.id,
        ids: targets.map((v) => v.id),
        applyStatus: 'applied',
      })
      setSelectedVerificationIds(new Set())
      showToast(`${targets.length}건을 승인했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const handleBulkRejectVerification = async () => {
    const targets = pendingVerification.filter((v) => selectedVerificationIds.has(v.id))
    if (targets.length === 0) {
      showToast('거절할 항목을 선택해 주세요.', 'error')
      return
    }
    try {
      await bulkUpdateVerification.mutateAsync({
        projectId: project.id,
        ids: targets.map((v) => v.id),
        applyStatus: 'skipped',
      })
      setSelectedVerificationIds(new Set())
      showToast(`${targets.length}건을 거절했습니다.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    }
  }

  const isBusy =
    runSpelling.isPending ||
    runTranslationVerify.isPending ||
    runVerifyOnly.isPending ||
    completeReview.isPending ||
    applyFix.isPending ||
    approveFix.isPending ||
    revokeApproval.isPending ||
    bulkApply.isPending ||
    skipFix.isPending ||
    bulkUpdateVerification.isPending ||
    updateVerification.isPending ||
    isGeneratingPptx

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 2. 맞춤법·번역·역번역</h3>
          <p className="nb-step-desc">
            먼저 맞춤법 검사 후 승인·거절 검토를 완료하면 {langName} 번역·역번역을 실행할 수
            있습니다. 슬라이드가 많으면 번역·역번역에 10~30분 이상 걸릴 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunSpelling}
            disabled={isBusy || !canRunSpelling}
            className="nb-btn-secondary"
          >
            {runSpelling.isPending && <Spinner />}
            {runSpelling.isPending
              ? '맞춤법 검사 중...'
              : spellingChecked
                ? '맞춤법 다시 검사'
                : '맞춤법 검사'}
          </button>
          <button
            type="button"
            onClick={handleRunTranslationVerify}
            disabled={isBusy || !canRunTranslation}
            className="nb-btn-secondary"
            title={
              !spellingChecked
                ? '먼저 맞춤법 검사를 실행해 주세요.'
                : !spellingReviewSettled
                  ? '맞춤법 항목을 모두 승인 또는 거절해 주세요.'
                  : undefined
            }
          >
            {runTranslationVerify.isPending && <Spinner />}
            {runTranslationVerify.isPending
              ? '번역·역번역 중...'
              : hasPipelineResults
                ? '번역·역번역 다시 실행'
                : '번역·역번역'}
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || (!canCompleteReview && !isVerified)}
            className="nb-btn-primary"
          >
            {completeReview.isPending && <Spinner className="text-white" />}
            {isVerified ? '전문가 검증으로 이동' : '검토 완료 → 전문가 검증'}
          </button>
        </div>
      </div>

      {project.translation_guidelines?.trim() && (
        <div className="nb-input-panel text-sm">
          <p className="font-medium">적용 중인 가이드라인</p>
          <p className="mt-1 whitespace-pre-wrap text-gray-600">
            {project.translation_guidelines}
          </p>
        </div>
      )}

      {chunkProgress && (
        <ChunkProgressPanel
          title={progressPhase === 'spelling' ? '맞춤법 검사' : '번역·역번역'}
          progress={chunkProgress}
          hint={
            progressPhase === 'spelling'
              ? '화면 텍스트·나레이션을 AI로 검사합니다. (자동 반영하지 않습니다)'
              : `${langName} 번역 후 역번역 검증을 진행합니다.`
          }
        />
      )}

      {spellingChecked && !spellingReviewSettled && (
        <div className="nb-alert nb-alert--warning text-sm">
          맞춤법 수정안을 모두 승인 또는 거절하면 「번역·역번역」 버튼이 활성화됩니다.
        </div>
      )}

      {(spellingChecked || hasPipelineResults || isTranslationRunning) && (
        <div className="nb-summary-bar text-sm">
          <span>
            맞춤법 검토{' '}
            {pendingSpelling.length > 0 ? (
              <span className="font-medium text-amber-700">대기 {pendingSpelling.length}건</span>
            ) : (
              <span className="font-medium text-emerald-700">완료</span>
            )}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            슬라이드 반영{' '}
            {approvedForApply.length > 0 ? (
              <span className="font-medium text-violet-700">대기 {approvedForApply.length}건</span>
            ) : (
              <span className="font-medium text-emerald-700">
                {appliedSpelling.length > 0 ? `완료 ${appliedSpelling.length}건` : '—'}
              </span>
            )}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            번역{' '}
            {isTranslationRunning ? (
              <span className="font-medium text-blue-700">처리 중…</span>
            ) : (
              <span>{translations.length}건</span>
            )}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            역번역 승인{' '}
            {isTranslationRunning ? (
              <span className="font-medium text-blue-700">처리 중…</span>
            ) : pendingVerification.length > 0 ? (
              <span className="font-medium text-amber-700">대기 {pendingVerification.length}건</span>
            ) : (
              <span
                className={`font-medium ${
                  storyboardVerifications.length > 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {storyboardVerifications.length > 0
                  ? '완료'
                  : hasTranslationResults
                    ? '미검증'
                    : '—'}
              </span>
            )}
          </span>
        </div>
      )}

      {isVerified && (
        <div className="nb-alert nb-alert--success text-sm">
          검토가 완료되었습니다. 「검토 완료 → 전문가 검증」을 누르거나 상단 Step 3으로 이동하세요.
        </div>
      )}

      {showTranslationSection && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">번역·역번역 결과</h4>
              <p className="mt-0.5 text-xs text-gray-500">
                {isTranslationRunning
                  ? `슬라이드 ${eligibleSlides.length}장 처리 중입니다. 완료까지 수 분~십 수 분 걸릴 수 있습니다.`
                  : '주의·불일치 항목을 확인하고 승인 또는 거절해 주세요.'}
              </p>
            </div>
            {pendingVerification.length > 0 && !isTranslationRunning && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedVerificationIds(new Set(pendingVerification.map((v) => v.id)))
                  }
                  className="nb-btn-secondary text-xs"
                  disabled={isBusy}
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  onClick={handleBulkApproveVerification}
                  className="nb-btn-secondary text-xs"
                  disabled={isBusy}
                >
                  선택 승인
                </button>
                <button
                  type="button"
                  onClick={handleBulkRejectVerification}
                  className="nb-btn-secondary text-xs"
                  disabled={isBusy}
                >
                  선택 거절
                </button>
              </div>
            )}
          </div>

          {isTranslationRunning && !hasTranslationResults && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              이전 결과를 갱신하고 있습니다. 진행이 끝나면 아래 표에 결과가 표시됩니다.
            </div>
          )}

          {!isTranslationRunning && hasTranslationResults && !hasPipelineResults && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p>
                번역 {translations.length}건이 저장되어 있습니다. 역번역 검증이 완료되지 않았거나
                중단되었습니다.
              </p>
              <button
                type="button"
                onClick={handleRunVerifyOnly}
                disabled={isBusy}
                className="nb-btn-secondary mt-2 text-xs"
              >
                역번역만 다시 실행
              </button>
            </div>
          )}

          {hasTranslationResults && (
            <div className="nb-card overflow-hidden">
              <table className="nb-table">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th>슬라이드</th>
                    <th>필드</th>
                    <th>한국어</th>
                    <th>{langName}</th>
                    <th>역번역</th>
                    <th>검증</th>
                    <th>검토</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleSlides.map((slide) => {
                    const slideTranslations = translations.filter((t) => t.slide_id === slide.id)
                    if (slideTranslations.length === 0) return null

                    return slideTranslations.map((tr) => {
                      const verification = verificationByTranslationId.get(tr.id)
                      const matchStatus = verification ? getMatchStatus(verification) : null
                      const isPending = verification
                        ? isVerificationPendingReview(verification)
                        : false

                      return (
                        <tr key={tr.id}>
                          <td>
                            {isPending && (
                              <input
                                type="checkbox"
                                checked={selectedVerificationIds.has(verification!.id)}
                                onChange={() => {
                                  setSelectedVerificationIds((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(verification!.id)) next.delete(verification!.id)
                                    else next.add(verification!.id)
                                    return next
                                  })
                                }}
                              />
                            )}
                          </td>
                          <td className="font-medium">{slide.slide_num}</td>
                          <td className="text-xs text-gray-500">{fieldKeyLabel(tr.field)}</td>
                          <td className="text-sm">{tr.source}</td>
                          <td className="text-sm text-blue-800">{tr.vi_text}</td>
                          <td className="text-sm text-gray-600">
                            {verification?.back_translation ?? '-'}
                            {verification?.issues && (
                              <p className="mt-1 text-xs text-amber-800">{verification.issues}</p>
                            )}
                          </td>
                          <td>
                            {verification && matchStatus ? (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchStatusClass(matchStatus)}`}
                              >
                                {matchStatusLabel(matchStatus)}
                                {verification.score != null && ` (${verification.score}%)`}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">대기</span>
                            )}
                          </td>
                          <td>
                            {isPending ? (
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleVerificationDecision(verification!, 'applied')
                                  }
                                  disabled={isBusy}
                                  className="nb-btn-primary text-xs"
                                >
                                  승인
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleVerificationDecision(verification!, 'skipped')
                                  }
                                  disabled={isBusy}
                                  className="nb-btn-secondary text-xs"
                                >
                                  거절
                                </button>
                              </div>
                            ) : verification ? (
                              <span className="text-xs text-emerald-700">
                                {verification.apply_status === 'applied'
                                  ? '승인됨'
                                  : verification.apply_status === 'skipped'
                                    ? '거절됨'
                                    : '확인됨'}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {spellingResults.length > 0 && (
        <section className="space-y-4">
          <div className="nb-card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">1. 맞춤법 검토</h4>
                <p className="mt-0.5 text-xs text-gray-500">
                  수정안을 승인하거나 거절합니다. 승인한 항목만 다음 단계에서 반영할 수 있습니다.
                </p>
              </div>
              {pendingSpelling.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedReviewIds(new Set(pendingSpelling.map((r) => r.id)))}
                    className="nb-btn-secondary text-xs"
                    disabled={isBusy}
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkApproveSpelling}
                    className="nb-btn-secondary text-xs"
                    disabled={isBusy}
                  >
                    선택 승인
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkRejectSpelling}
                    className="nb-btn-secondary text-xs"
                    disabled={isBusy}
                  >
                    선택 거절
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {spellingResults
                .filter(
                  (r) =>
                    hasSpellingTextChanges(r) || r.applied || r.skipped || r.approved,
                )
                .map((result) => {
                  const slide = slideMap.get(result.slide_id)
                  const itemStatus = getSpellingItemStatus(result)
                  const isPending = isSpellingPendingReview(result)

                  return (
                    <div
                      key={result.id}
                      className={`rounded-lg px-4 py-3 ${spellingItemBoxClass(itemStatus)}`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        {isPending && (
                          <input
                            type="checkbox"
                            checked={selectedReviewIds.has(result.id)}
                            onChange={() => {
                              setSelectedReviewIds((prev) => {
                                const next = new Set(prev)
                                if (next.has(result.id)) next.delete(result.id)
                                else next.add(result.id)
                                return next
                              })
                            }}
                            className="mt-1"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500">
                            슬라이드 {slide?.slide_num ?? '-'} · {fieldKeyLabel(result.field)}
                          </p>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-medium text-gray-500">원문</p>
                              <p className="mt-0.5 whitespace-pre-wrap text-sm">{result.original}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-500">수정안</p>
                              <SuggestionHighlight
                                original={result.original}
                                suggestion={result.suggestion}
                              />
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-gray-600">
                            {formatSpellingReviewReason(result)}
                          </p>
                        </div>
                        {isPending && (
                          <div className="flex shrink-0 flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => handleApproveSpelling(result)}
                              disabled={isBusy}
                              className="nb-btn-primary text-xs"
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectSpelling(result)}
                              disabled={isBusy}
                              className="nb-btn-secondary text-xs"
                            >
                              거절
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>

            {spellingReviewSettled && pendingSpelling.length === 0 && (
              <p className="text-xs text-emerald-700">맞춤법 검토가 완료되었습니다.</p>
            )}
          </div>

          {(approvedForApply.length > 0 || appliedSpelling.length > 0) && (
            <div className="nb-card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">2. 슬라이드 반영</h4>
                  <p className="mt-0.5 text-xs text-gray-500">
                    검토 승인한 항목을 다중 선택하여 슬라이드 데이터에 반영합니다. 반영 후 PPTX에
                    밀어넣을 수 있습니다.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {approvedForApply.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedApplyIds(new Set(approvedForApply.map((r) => r.id)))
                        }
                        className="nb-btn-secondary text-xs"
                        disabled={isBusy}
                      >
                        전체 선택
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkApplySpelling}
                        className="nb-btn-secondary text-xs"
                        disabled={isBusy}
                      >
                        선택 반영
                      </button>
                    </>
                  )}
                  {appliedSpelling.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadCorrectedPptx}
                      disabled={isBusy}
                      className="nb-btn-primary text-xs"
                    >
                      {isGeneratingPptx && <Spinner className="text-white" />}
                      맞춤법 반영 PPTX
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {approvedForApply.map((result) => {
                  const slide = slideMap.get(result.slide_id)
                  return (
                    <div
                      key={result.id}
                      className={`rounded-lg px-4 py-3 ${spellingItemBoxClass('approved')}`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedApplyIds.has(result.id)}
                          onChange={() => {
                            setSelectedApplyIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(result.id)) next.delete(result.id)
                              else next.add(result.id)
                              return next
                            })
                          }}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-500">
                            슬라이드 {slide?.slide_num ?? '-'} · {fieldKeyLabel(result.field)}
                          </p>
                          <p className="mt-1 text-sm">
                            <span className="text-gray-500 line-through">{result.original}</span>
                            <span className="mx-2 text-gray-300">→</span>
                            <span className="font-medium text-violet-900">{result.suggestion}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => handleApplySpelling(result)}
                            disabled={isBusy}
                            className="nb-btn-primary text-xs"
                          >
                            반영
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeApproval(result)}
                            disabled={isBusy}
                            className="nb-btn-secondary text-xs"
                          >
                            승인 취소
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {appliedSpelling.map((result) => {
                  const slide = slideMap.get(result.slide_id)
                  return (
                    <div
                      key={result.id}
                      className={`rounded-lg px-4 py-3 ${spellingItemBoxClass('applied')}`}
                    >
                      <p className="text-xs text-gray-500">
                        슬라이드 {slide?.slide_num ?? '-'} · {fieldKeyLabel(result.field)}
                      </p>
                      <p className="mt-1 text-sm text-emerald-800">
                        반영 완료: {result.suggestion}
                      </p>
                    </div>
                  )
                })}
              </div>

              {spellingApplySettled && approvedForApply.length === 0 && (
                <p className="text-xs text-emerald-700">
                  승인한 맞춤법이 모두 슬라이드에 반영되었습니다. 「맞춤법 반영 PPTX」로 원본
                  파일에 적용할 수 있습니다.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {!spellingChecked && !runSpelling.isPending && spellingResults.length === 0 && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">
            「맞춤법 검사」를 실행하면 수정 제안이 표시됩니다. 검토를 마친 뒤 「번역·역번역」을
            실행하세요.
          </p>
        </div>
      )}
    </div>
  )
}
