import { useCallback, useEffect, useMemo, useState, startTransition } from 'react'
import {
  SLIDE_TYPE_LABELS,
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
  useSlides,
  type ParseProgress,
} from '../../hooks/useSlides'
import { useToast } from '../../hooks/ToastProvider'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project, Slide, SlideType, Storyboard } from '../../types'

const PAGE_SIZE = 20

const FILTER_TYPES: Array<{ value: SlideType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'intro', label: '인트로' },
  { value: 'lesson', label: '레슨' },
  { value: 'content', label: '콘텐츠' },
  { value: 'divider', label: '간지' },
  { value: 'quiz', label: '문제풀기' },
  { value: 'apply', label: '적용하기' },
  { value: 'outro', label: '아웃트로' },
]

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
  const { data: slides = [], isLoading: slidesLoading } = useSlides(storyboard.id)
  const extractSlides = useExtractSlides()
  const bulkUpdate = useBulkUpdateSlides()
  const completeExtraction = useCompleteExtraction()

  const [localSlides, setLocalSlides] = useState<Slide[]>([])
  const [typeFilter, setTypeFilter] = useState<SlideType | 'all'>('all')
  const [autoExtractAttempted, setAutoExtractAttempted] = useState(false)
  const [page, setPage] = useState(0)
  const [extractProgress, setExtractProgress] = useState<ParseProgress | null>(null)

  useEffect(() => {
    if (slides.length > 0) {
      startTransition(() => {
        setLocalSlides(slides)
        setPage(0)
      })
    }
  }, [slides])

  const runExtraction = useCallback(async () => {
    if (!storyboard.source_pptx_url) {
      showToast('PPTX 파일 경로가 없습니다.', 'error')
      return
    }

    try {
      setExtractProgress(null)
      const result = await extractSlides.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        storagePath: storyboard.source_pptx_url,
        onProgress: setExtractProgress,
      })
      startTransition(() => {
        setLocalSlides(result)
        setPage(0)
      })
      showToast('화면 텍스트 추출이 완료되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 추출에 실패했습니다.', 'error')
    } finally {
      setExtractProgress(null)
    }
  }, [extractSlides, project.id, storyboard.id, storyboard.source_pptx_url, showToast])

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

  const filteredSlides = useMemo(() => {
    if (typeFilter === 'all') return localSlides
    return localSlides.filter((s) => s.slide_type === typeFilter)
  }, [localSlides, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredSlides.length / PAGE_SIZE))
  const pagedSlides = useMemo(() => {
    const safePage = Math.min(page, totalPages - 1)
    const start = safePage * PAGE_SIZE
    return filteredSlides.slice(start, start + PAGE_SIZE)
  }, [filteredSlides, page, totalPages])

  const updateLocalSlide = (id: string, field: 'screen_text' | 'screen_num', value: string) => {
    setLocalSlides((prev) =>
      prev.map((slide) => {
        if (slide.id !== id) return slide
        if (field === 'screen_text') {
          return { ...slide, screen_text: parseScreenTextInput(value, slide.screen_text) }
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
    try {
      await completeExtraction.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slides: localSlides,
      })
      showToast('추출이 완료되었습니다. 영어 번역 단계로 진행할 수 있습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '추출 완료 처리에 실패했습니다.', 'error')
    }
  }

  const handleDownloadXlsx = () => {
    const safeTitle = storyboard.title.replace(/[\\/:*?"<>|]/g, '_')
    downloadExtractionXlsx(localSlides, `${safeTitle}_화면텍스트.xlsx`)
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
  const isBusy = isExtracting || bulkUpdate.isPending || completeExtraction.isPending
  const isExtracted = storyboard.status !== 'uploaded'

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 1. 화면 텍스트 추출</h3>
          <p className="nb-step-desc">
            PPTX에서 화면에 표시되는 텍스트만 추출합니다. (나레이션 제외)
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
            {isExtracting ? '추출 중...' : '다시 추출'}
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

      {isExtracting && (
        <ChunkProgressPanel
          title="PPTX 추출"
          progress={extractChunkProgress}
          hint="화면 텍스트만 추출하여 저장합니다."
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

      <div className="flex flex-wrap gap-2">
        {FILTER_TYPES.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setTypeFilter(filter.value)}
            className={`nb-filter-pill ${
              typeFilter === filter.value ? 'nb-filter-pill--active' : 'nb-filter-pill--inactive'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {slidesLoading || isExtracting ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
        </div>
      ) : localSlides.length === 0 ? (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">추출된 슬라이드가 없습니다.</p>
        </div>
      ) : (
        <div className="nb-card nb-h-scroll overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>슬라이드</th>
                <th>유형</th>
                <th>화면번호</th>
                <th className="min-w-[320px]">화면텍스트 (한국어)</th>
              </tr>
            </thead>
            <tbody>
              {pagedSlides.map((slide) => (
                <tr key={slide.id}>
                  <td className="font-medium">{slide.slide_num}</td>
                  <td>
                    <span className="nb-badge">{SLIDE_TYPE_LABELS[slide.slide_type]}</span>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={slide.screen_num ?? ''}
                      onChange={(e) => updateLocalSlide(slide.id, 'screen_num', e.target.value)}
                      className="nb-input w-full min-w-[80px] text-xs"
                    />
                  </td>
                  <td>
                    <textarea
                      value={formatScreenText(slide.screen_text)}
                      onChange={(e) => updateLocalSlide(slide.id, 'screen_text', e.target.value)}
                      rows={3}
                      className="nb-textarea w-full text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isExtracted && (
        <p className="text-sm text-emerald-600">추출이 완료되었습니다.</p>
      )}
    </div>
  )
}
