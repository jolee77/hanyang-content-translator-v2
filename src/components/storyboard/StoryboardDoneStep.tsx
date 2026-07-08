import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { STORAGE_BUCKET } from '../../hooks/useProject'
import { downloadBlob, downloadTranslationXlsx } from '../../lib/xlsxGenerator'
import { generateEnglishScreenPptx } from '../../lib/pptxGenerator'
import { useSlides } from '../../hooks/useSlides'
import { useStoryboardTranslations } from '../../hooks/useTranslation'
import { useToast } from '../../hooks/ToastProvider'
import { Spinner } from '../ui/Spinner'
import type { Project, Storyboard } from '../../types'

interface StoryboardDoneStepProps {
  project: Project
  storyboard: Storyboard
}

export function StoryboardDoneStep({ project, storyboard }: StoryboardDoneStepProps) {
  const { showToast } = useToast()
  const { data: slides = [] } = useSlides(storyboard.id)
  const { data: translations = [] } = useStoryboardTranslations(
    storyboard.id,
    slides.map((s) => s.id),
  )
  const [isGenerating, setIsGenerating] = useState(false)

  const handleDownloadXlsx = () => {
    const rows = slides
      .filter((slide) => translations.some((t) => t.slide_id === slide.id))
      .map((slide) => ({
        slide,
        translations: translations.filter((t) => t.slide_id === slide.id),
      }))
    const safeTitle = storyboard.title.replace(/[\\/:*?"<>|]/g, '_')
    downloadTranslationXlsx(rows, `${safeTitle}_한영.xlsx`, project.target_lang)
  }

  const handleDownloadPptx = async () => {
    if (!storyboard.source_pptx_url) {
      showToast('원본 PPTX 경로가 없습니다.', 'error')
      return
    }
    if (translations.length === 0) {
      showToast('적용할 번역 데이터가 없습니다.', 'error')
      return
    }
    if (storyboard.status !== 'done') {
      showToast('전문가 검증이 완료된 후 다운로드할 수 있습니다.', 'error')
      return
    }

    setIsGenerating(true)
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(storyboard.source_pptx_url)

      if (error) throw error

      const sourceFile = new File([data], storyboard.source_pptx_name ?? 'source.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })

      const blob = await generateEnglishScreenPptx(sourceFile, translations)
      const safeTitle = storyboard.title.replace(/[\\/:*?"<>|]/g, '_')
      downloadBlob(blob, `${safeTitle}_영문화면.pptx`)
      showToast('영문 화면 텍스트가 적용된 PPTX를 다운로드했습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PPTX 생성에 실패했습니다.', 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 4. 완료</h3>
          <p className="nb-step-desc">
            전문가 검증이 완료된 영문 화면 텍스트를 스토리보드 PPTX에 반영하여 다운로드합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleDownloadXlsx} className="nb-btn-secondary">
            XLSX 다운로드
          </button>
          <button
            type="button"
            onClick={handleDownloadPptx}
            disabled={isGenerating || storyboard.status !== 'done'}
            className="nb-btn-primary"
          >
            {isGenerating && <Spinner className="text-white" />}
            {isGenerating ? '생성 중...' : '영문 PPTX 다운로드'}
          </button>
        </div>
      </div>

      <div className="nb-alert nb-alert--success text-sm">
        <p className="font-medium">{storyboard.title}</p>
        <p className="mt-1 text-gray-600">
          프로젝트: {project.title} · 번역 {translations.length}건
          {storyboard.status !== 'done' && ' · 전문가 검증 완료 후 PPTX 다운로드 가능'}
        </p>
      </div>

      <p className="text-sm text-gray-500">
        Phase 2에서는 전문가 영상 촬영 후 나레이션 추출 및 중국어 번역 기능이 추가됩니다.
      </p>
    </div>
  )
}
