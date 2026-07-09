import { useCallback, useEffect, useMemo, useRef, useState, startTransition, Fragment } from 'react'
import {
  formatScreenText,
  parseScreenTextInput,
} from '../../lib/pptxParser'
import { downloadExtractionXlsx } from '../../lib/xlsxGenerator'
import {
  checkScreenTextConsistency,
  type ConsistencySummary,
} from '../../lib/manuscriptConsistency'
import {
  useBulkUpdateSlides,
  useCompleteExtraction,
  useExtractSlides,
  useRetrySlideExtraction,
  useSlides,
  type ParseProgress,
} from '../../hooks/useSlides'
import { useToast } from '../../hooks/ToastProvider'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project, Slide, Storyboard } from '../../types'

interface ScreenTextExtractionStepProps {
  project: Project
  storyboard: Storyboard
  onStepComplete?: () => void
}

export function ScreenTextExtractionStep({
  project,
  storyboard,
  onStepComplete,
}: ScreenTextExtractionStepProps) {
  const { showToast } = useToast()
  const { data: slides = [], isLoading: slidesLoading, isError: slidesError, error: slidesQueryError } = useSlides(storyboard.id)
  const extractSlides = useExtractSlides()
  const retrySlideExtraction = useRetrySlideExtraction()
  const bulkUpdate = useBulkUpdateSlides()
  const completeExtraction = useCompleteExtraction()

  const [localSlides, setLocalSlides] = useState<Slide[]>([])
  const [retryingSlideId, setRetryingSlideId] = useState<string | null>(null)
  const [autoExtractAttempted, setAutoExtractAttempted] = useState(false)
  const [activeSlideNum, setActiveSlideNum] = useState<number | null>(null)
  const [extractProgress, setExtractProgress] = useState<ParseProgress | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())
  const navButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (slides.length > 0) {
      startTransition(() => {
        setLocalSlides(slides)
      })
    }
  }, [slides])

  const failedCount = useMemo(
    () => localSlides.filter((s) => s.extraction_status === 'failed').length,
    [localSlides],
  )

  const runExtraction = useCallback(async () => {
    if (!storyboard.source_pptx_url) {
      showToast('PPTX 파일 경로가 없습니다.', 'error')
      return
    }

    try {
      setExtractProgress(null)
      setExtractError(null)
      const result = await extractSlides.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        storagePath: storyboard.source_pptx_url,
        onProgress: setExtractProgress,
      })
      startTransition(() => {
        setLocalSlides(result)
      })
      const failed = result.filter((s) => s.extraction_status === 'failed').length
      if (failed > 0) {
        showToast(
          `추출 완료 — ${result.length}장 중 ${failed}장 실패. 실패 슬라이드는 다시 시도하거나 다음 단계로 진행할 수 있습니다.`,
          'info',
        )
      } else {
        showToast(`${result.length}장 슬라이드 추출이 완료되었습니다.`, 'success')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PPTX 추출에 실패했습니다.'
      setExtractError(message)
      setAutoExtractAttempted(false)
      showToast(message, 'error')
    } finally {
      setExtractProgress(null)
    }
  }, [extractSlides, project.id, storyboard.id, storyboard.source_pptx_url, showToast])

  const handleRetrySlide = async (slide: Slide) => {
    if (!storyboard.source_pptx_url) return

    setRetryingSlideId(slide.id)
    try {
      const updated = await retrySlideExtraction.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        storagePath: storyboard.source_pptx_url,
        slideId: slide.id,
        slideNum: slide.slide_num,
      })
      setLocalSlides((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      if (updated.extraction_status === 'failed') {
        showToast(`슬라이드 ${slide.slide_num} 추출에 실패했습니다.`, 'error')
      } else {
        showToast(`슬라이드 ${slide.slide_num} 추출을 다시 완료했습니다.`, 'success')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '슬라이드 재추출에 실패했습니다.', 'error')
    } finally {
      setRetryingSlideId(null)
    }
  }

  useEffect(() => {
    if (
      !slidesLoading &&
      slides.length === 0 &&
      !autoExtractAttempted &&
      !extractSlides.isPending &&
      storyboard.source_pptx_url
    ) {
      setAutoExtractAttempted(true)
      runExtraction()
    }
  }, [
    slidesLoading,
    slides.length,
    autoExtractAttempted,
    extractSlides.isPending,
    storyboard.source_pptx_url,
    runExtraction,
  ])

  const consistency: ConsistencySummary = useMemo(
    () => checkScreenTextConsistency(localSlides, storyboard.manuscript_text),
    [localSlides, storyboard.manuscript_text],
  )

  const scrollToSlide = useCallback((slideNum: number) => {
    rowRefs.current.get(slideNum)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    navButtonRefs.current.get(slideNum)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
    setActiveSlideNum(slideNum)
  }, [])

  useEffect(() => {
    if (localSlides.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        const top = visible[0]?.target.getAttribute('data-slide-num')
        if (top) setActiveSlideNum(parseInt(top, 10))
      },
      { rootMargin: '-80px 0px -40% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    for (const slide of localSlides) {
      const row = rowRefs.current.get(slide.slide_num)
      if (row) observer.observe(row)
    }

    return () => observer.disconnect()
  }, [localSlides])

  const updateLocalSlide = (
    id: string,
    field: 'screen_text' | 'screen_num' | 'narration',
    value: string,
  ) => {
    setLocalSlides((prev) =>
      prev.map((slide) => {
        if (slide.id !== id) return slide
        if (field === 'screen_text') {
          return { ...slide, screen_text: parseScreenTextInput(value, slide.screen_text) }
        }
        if (field === 'narration') {
          return { ...slide, narration: value || null }
        }
        return { ...slide, screen_num: value || null }
      }),
    )
  }

  const handleSaveEdits = async () => {
    try {
      await bulkUpdate.mutateAsync({ storyboardId: storyboard.id, slides: localSlides })
      showToast('변경사항이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  const handleComplete = async () => {
    if (failedCount > 0) {
      const proceed = window.confirm(
        `추출 실패 슬라이드가 ${failedCount}장 있습니다. 그래도 추출 완료 후 다음 단계로 진행하시겠습니까?`,
      )
      if (!proceed) return
    }

    try {
      await completeExtraction.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slides: localSlides,
      })
      showToast('추출이 완료되었습니다. 다음 단계로 진행할 수 있습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '추출 완료 처리에 실패했습니다.', 'error')
    }
  }

  const handleDownloadXlsx = () => {
    const safeTitle = storyboard.title.replace(/[\\/:*?"<>|]/g, '_')
    downloadExtractionXlsx(localSlides, `${safeTitle}_추출.xlsx`)
  }

  const isExtracting = extractSlides.isPending
  const extractChunkProgress: ChunkProgress | null = extractProgress
    ? {
        current: extractProgress.current,
        total: extractProgress.total,
        phase: extractProgress.phase === 'parsing' ? 'PPTX 슬라이드 분석' : '추출 결과 저장',
        percent: Math.round((extractProgress.current / Math.max(extractProgress.total, 1)) * 100),
      }
    : null
  const isBusy =
    isExtracting ||
    bulkUpdate.isPending ||
    completeExtraction.isPending ||
    retrySlideExtraction.isPending
  const isExtracted = storyboard.status !== 'uploaded'

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 1. 화면 텍스트 추출</h3>
          <p className="nb-step-desc">
            PPTX 전체 슬라이드(1번부터)에서 화면번호·화면 텍스트·나레이션을 추출합니다. 화면설명
            영역은 제외합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAutoExtractAttempted(true)
              runExtraction()
            }}
            disabled={isBusy || !storyboard.source_pptx_url}
            className="nb-btn-secondary"
          >
            {isExtracting && <Spinner />}
            {isExtracting ? '추출 중...' : '전체 다시 추출'}
          </button>
          <button
            type="button"
            onClick={handleSaveEdits}
            disabled={isBusy || localSlides.length === 0}
            className="nb-btn-secondary"
          >
            변경사항 저장
          </button>
          <button
            type="button"
            onClick={handleDownloadXlsx}
            disabled={localSlides.length === 0}
            className="nb-btn-secondary"
          >
            XLSX 다운로드
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={isBusy || localSlides.length === 0 || isExtracted}
            className="nb-btn-primary"
          >
            {completeExtraction.isPending && <Spinner className="text-white" />}
            추출 완료
          </button>
        </div>
      </div>

      {localSlides.length > 0 && (
        <p className="text-sm text-gray-600">
          총 {localSlides.length}장
          {failedCount > 0 && (
            <span className="ml-2 font-medium text-red-600">
              · 추출 실패 {failedCount}장 (붉은색 행 — 개별 재시도 가능)
            </span>
          )}
        </p>
      )}

      {isExtracting && (
        <ChunkProgressPanel
          title="PPTX 추출"
          progress={extractChunkProgress}
          hint="전체 슬라이드를 순서대로 분석합니다."
        />
      )}

      {localSlides.length > 0 && storyboard.manuscript_text && consistency.total > 0 && (
        <div className="nb-card p-4">
          <h4 className="text-sm font-semibold text-gray-900">원고 정합성 검증</h4>
          <p className="mt-1 text-xs text-gray-500">
            원고: {storyboard.source_manuscript_name ?? '업로드된 원고'} · 일치 {consistency.match} ·
            유사 {consistency.partial} · 불일치 {consistency.missing}
          </p>
          {consistency.missing > 0 && (
            <div className="nb-alert nb-alert--warning mt-3 text-sm">
              원고와 맞지 않는 화면 텍스트가 {consistency.missing}건 있습니다. 추출 완료 전에
              확인해 주세요.
            </div>
          )}
          {consistency.items.filter((i) => i.status !== 'match').length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              <table className="nb-table text-xs">
                <thead>
                  <tr>
                    <th>슬라이드</th>
                    <th>상태</th>
                    <th>화면 텍스트</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {consistency.items
                    .filter((i) => i.status !== 'match')
                    .map((item, idx) => (
                      <tr key={`${item.slideId}-${idx}`}>
                        <td>{item.slideNum}</td>
                        <td>
                          <span
                            className={
                              item.status === 'missing'
                                ? 'text-red-600'
                                : 'text-amber-600'
                            }
                          >
                            {item.status === 'missing' ? '불일치' : '유사'}
                          </span>
                        </td>
                        <td className="max-w-[200px] truncate">{item.text}</td>
                        <td className="text-gray-500">{item.hint}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {slidesLoading || isExtracting ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
        </div>
      ) : localSlides.length === 0 ? (
        <div className="nb-empty-state space-y-3">
          <p className="text-sm text-gray-500">추출된 슬라이드가 없습니다.</p>
          {(extractError || slidesError) && (
            <div className="nb-alert nb-alert--warning mx-auto max-w-xl text-left text-sm">
              <p className="font-medium text-red-700">추출 오류</p>
              <p className="mt-1 text-gray-700">
                {extractError ??
                  (slidesQueryError instanceof Error
                    ? slidesQueryError.message
                    : '슬라이드 목록을 불러오지 못했습니다.')}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setAutoExtractAttempted(true)
              runExtraction()
            }}
            disabled={isBusy || !storyboard.source_pptx_url}
            className="nb-btn-primary"
          >
            {isExtracting && <Spinner className="text-white" />}
            {isExtracting ? '추출 중...' : 'PPTX 추출 시작'}
          </button>
        </div>
      ) : (
        <div className="relative pb-14">
          <div className="nb-card nb-h-scroll overflow-hidden">
            <table className="nb-table">
              <thead>
                <tr>
                  <th className="w-16">슬라이드</th>
                  <th className="w-24">화면번호</th>
                  <th className="min-w-[280px]">화면텍스트 (한국어)</th>
                  <th className="min-w-[280px]">나레이션 (한국어)</th>
                  <th className="w-24">재추출</th>
                </tr>
              </thead>
              <tbody>
                {localSlides.map((slide) => {
                  const isFailed = slide.extraction_status === 'failed'
                  return (
                    <tr
                      key={slide.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(slide.slide_num, el)
                        else rowRefs.current.delete(slide.slide_num)
                      }}
                      data-slide-num={slide.slide_num}
                      className={[
                        'scroll-mt-20',
                        isFailed
                          ? 'bg-red-50'
                          : activeSlideNum === slide.slide_num
                            ? 'bg-blue-50/60'
                            : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={isFailed ? slide.extraction_error ?? '추출 실패' : undefined}
                    >
                      <td className="font-medium">
                        {slide.slide_num}
                        {isFailed && (
                          <span className="mt-0.5 block text-xs font-normal text-red-600">
                            실패
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          value={slide.screen_num ?? ''}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_num', e.target.value)
                          }
                          className="nb-input w-full min-w-[72px] text-xs"
                        />
                      </td>
                      <td>
                        <textarea
                          value={formatScreenText(slide.screen_text)}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'screen_text', e.target.value)
                          }
                          rows={4}
                          className={`nb-textarea w-full text-xs ${isFailed && !formatScreenText(slide.screen_text) ? 'border-red-300' : ''}`}
                          placeholder={isFailed ? '추출되지 않음' : undefined}
                        />
                      </td>
                      <td>
                        <textarea
                          value={slide.narration ?? ''}
                          onChange={(e) =>
                            updateLocalSlide(slide.id, 'narration', e.target.value)
                          }
                          rows={4}
                          className="nb-textarea w-full text-xs"
                          placeholder="나레이션 없음"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleRetrySlide(slide)}
                          disabled={isBusy || retryingSlideId === slide.id}
                          className="nb-btn-secondary text-xs whitespace-nowrap"
                        >
                          {retryingSlideId === slide.id ? <Spinner /> : '다시 추출'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <nav
            aria-label="슬라이드 이동"
            className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm"
          >
            <div className="nb-h-scroll mx-auto flex max-w-[100vw] items-center gap-1 whitespace-nowrap px-4 py-2.5">
              {localSlides.map((slide, index) => {
                const isFailed = slide.extraction_status === 'failed'
                const isActive = activeSlideNum === slide.slide_num
                return (
                  <Fragment key={slide.id}>
                    {index > 0 && (
                      <span className="select-none text-gray-300" aria-hidden>
                        -
                      </span>
                    )}
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) navButtonRefs.current.set(slide.slide_num, el)
                        else navButtonRefs.current.delete(slide.slide_num)
                      }}
                      onClick={() => scrollToSlide(slide.slide_num)}
                      title={
                        isFailed
                          ? `슬라이드 ${slide.slide_num} — 추출 실패`
                          : `슬라이드 ${slide.slide_num}로 이동`
                      }
                      className={[
                        'min-w-[1.75rem] rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
                        isFailed
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-gray-600 hover:bg-gray-100',
                        isActive ? 'bg-blue-100 font-semibold text-blue-700 ring-1 ring-blue-300' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {slide.slide_num}
                    </button>
                  </Fragment>
                )
              })}
            </div>
          </nav>
        </div>
      )}

      {isExtracted && (
        <p className="text-sm text-emerald-600">추출이 완료되었습니다.</p>
      )}
    </div>
  )
}
