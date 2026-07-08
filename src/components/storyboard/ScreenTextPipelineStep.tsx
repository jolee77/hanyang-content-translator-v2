import { useMemo, useState } from 'react'
import { formatScreenText } from '../../lib/pptxParser'
import { useSlides } from '../../hooks/useSlides'
import { useRunScreenTextPipeline } from '../../hooks/useStoryboardPipeline'
import { useStoryboardTranslations } from '../../hooks/useTranslation'
import { useVerifications } from '../../hooks/useVerification'
import { useToast } from '../../hooks/ToastProvider'
import { ChunkProgressPanel } from '../ui/ChunkProgressPanel'
import { Spinner } from '../ui/Spinner'
import type { ChunkProgress } from '../../lib/chunkProgress'
import type { Project, Storyboard } from '../../types'
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
  const { data: translations = [] } = useStoryboardTranslations(
    storyboard.id,
    slides.map((s) => s.id),
  )
  const { data: verifications = [] } = useVerifications(project.id)
  const runPipeline = useRunScreenTextPipeline()
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)

  const eligibleSlides = useMemo(
    () => slides.filter((s) => s.slide_type !== 'guide' && formatScreenText(s.screen_text).trim()),
    [slides],
  )

  const storyboardVerifications = useMemo(
    () => verifications.filter((v) => translations.some((t) => t.id === v.translation_id)),
    [verifications, translations],
  )

  const targetLang = project.target_lang
  const langName = getLangConfig(targetLang).name
  const isVerified = isStoryboardStatusAtLeast(storyboard.status, 'verified')
  const canRun =
    storyboard.status === 'extracted' ||
    storyboard.status === 'spelling' ||
    storyboard.status === 'spelling_done'

  const handleRun = async () => {
    if (eligibleSlides.length === 0) {
      showToast('처리할 화면 텍스트가 없습니다.', 'error')
      return
    }

    try {
      setChunkProgress(null)
      await runPipeline.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        slides,
        targetLang,
        onChunkProgress: setChunkProgress,
      })
      showToast('맞춤법·번역·역번역 검증이 완료되었습니다.', 'success')
      onStepComplete?.()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '처리에 실패했습니다.', 'error')
    } finally {
      setChunkProgress(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 2. 맞춤법·번역·역번역</h3>
          <p className="nb-step-desc">
            화면 텍스트에 대해 맞춤법 검사 → {langName} 번역 → 역번역 검증을 한 번에 처리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={runPipeline.isPending || !canRun || eligibleSlides.length === 0}
          className="nb-btn-primary"
        >
          {runPipeline.isPending && <Spinner className="text-white" />}
          {runPipeline.isPending ? '처리 중...' : '한꺼번에 처리'}
        </button>
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
          title="AI 파이프라인"
          progress={chunkProgress}
          hint="맞춤법 검사 → 자동 반영 → 영어 번역 → 역번역 검증 순으로 진행됩니다."
        />
      )}

      {isVerified && (
        <div className="nb-alert nb-alert--success text-sm">
          AI 처리가 완료되었습니다. 번역 {translations.length}건 · 역번역 검증{' '}
          {storyboardVerifications.length}건
        </div>
      )}

      {eligibleSlides.length > 0 && translations.length > 0 && (
        <div className="nb-card overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>슬라이드</th>
                <th>한국어</th>
                <th>{langName}</th>
                <th>역번역</th>
              </tr>
            </thead>
            <tbody>
              {eligibleSlides.map((slide) => {
                const slideTranslations = translations.filter((t) => t.slide_id === slide.id)
                const backTranslations = slideTranslations
                  .map((t) => {
                    const v = storyboardVerifications.find((vr) => vr.translation_id === t.id)
                    return v?.back_translation
                  })
                  .filter(Boolean)
                  .join('\n')

                return (
                  <tr key={slide.id}>
                    <td className="font-medium">{slide.slide_num}</td>
                    <td className="text-sm">{formatScreenText(slide.screen_text)}</td>
                    <td className="text-sm text-blue-800">
                      {slideTranslations.map((t) => t.vi_text).join('\n')}
                    </td>
                    <td className="text-sm text-gray-600">{backTranslations || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
