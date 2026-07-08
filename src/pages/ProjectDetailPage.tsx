import { useState, type DragEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StoryboardStatusBadge } from '../components/storyboard/StoryboardStatusBadge'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useProject, useUpdateProject } from '../hooks/useProject'
import { useCreateStoryboard, useStoryboards } from '../hooks/useStoryboard'
import { LANG_CONFIG } from '../lib/lang'
import {
  isManuscriptFile,
  MANUSCRIPT_ACCEPT,
  MANUSCRIPT_FORMAT_LABEL,
  MANUSCRIPT_UNSUPPORTED_MSG,
} from '../lib/manuscriptParser'

function isPptxFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.pptx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: project, isLoading, error } = useProject(id)
  const { data: storyboards = [], isLoading: storyboardsLoading } = useStoryboards(id)
  const createStoryboard = useCreateStoryboard()
  const updateProject = useUpdateProject()
  const { showToast } = useToast()

  const [showAddForm, setShowAddForm] = useState(false)
  const [storyboardTitle, setStoryboardTitle] = useState('')
  const [pptxFile, setPptxFile] = useState<File | null>(null)
  const [manuscriptFile, setManuscriptFile] = useState<File | null>(null)
  const [isDraggingPptx, setIsDraggingPptx] = useState(false)
  const [editingGuidelines, setEditingGuidelines] = useState(false)
  const [guidelinesDraft, setGuidelinesDraft] = useState('')

  const handleFile = (file: File) => {
    if (!isPptxFile(file)) {
      showToast('PPTX 파일만 업로드할 수 있습니다.', 'error')
      return
    }
    setPptxFile(file)
  }

  const handleAddStoryboard = async (e: FormEvent) => {
    e.preventDefault()
    if (!id || !pptxFile) {
      showToast('PPTX 파일을 선택해 주세요.', 'error')
      return
    }
    if (!manuscriptFile) {
      showToast('원고 파일을 선택해 주세요.', 'error')
      return
    }

    try {
      await createStoryboard.mutateAsync({
        projectId: id,
        title: storyboardTitle.trim() || pptxFile.name.replace(/\.pptx$/i, ''),
        pptxFile,
        manuscriptFile,
      })
      setStoryboardTitle('')
      setPptxFile(null)
      setManuscriptFile(null)
      setShowAddForm(false)
      showToast('스토리보드가 추가되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '스토리보드 추가에 실패했습니다.', 'error')
    }
  }

  const handleSaveGuidelines = async () => {
    if (!project) return
    try {
      await updateProject.mutateAsync({
        id: project.id,
        translationGuidelines: guidelinesDraft,
      })
      setEditingGuidelines(false)
      showToast('가이드라인이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다.', 'error')
    }
  }

  if (isLoading) {
    return (
      <div className="nb-empty-state">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">프로젝트를 불러오는 중...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="nb-alert nb-alert--error">
        프로젝트를 찾을 수 없습니다.
        <Link to="/dashboard" className="nb-link ml-2">
          대시보드로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{project.title}</h2>
          <p className="mt-1 text-sm text-gray-500">
            목표 언어: {LANG_CONFIG[project.target_lang as keyof typeof LANG_CONFIG]?.name ?? project.target_lang}
            {' · '}
            생성일: {new Date(project.created_at).toLocaleDateString('ko-KR')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setGuidelinesDraft(project.translation_guidelines ?? '')
            setEditingGuidelines((v) => !v)
          }}
          className="nb-btn-secondary"
        >
          {editingGuidelines ? '가이드라인 닫기' : '가이드라인 수정'}
        </button>
      </div>

      <div className="nb-card nb-input-surface p-6">
        <h3 className="mb-2 text-sm font-semibold" style={{ color: '#0958d9' }}>
          번역 가이드라인
        </h3>
        {editingGuidelines ? (
          <div className="space-y-3">
            <textarea
              value={guidelinesDraft}
              onChange={(e) => setGuidelinesDraft(e.target.value)}
              rows={5}
              className="nb-textarea w-full"
            />
            <button
              type="button"
              onClick={handleSaveGuidelines}
              disabled={updateProject.isPending}
              className="nb-btn-primary"
            >
              저장
            </button>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-gray-700">
            {project.translation_guidelines?.trim() || '가이드라인이 없습니다.'}
          </p>
        )}
        <p className="nb-help-text mt-2">
          프로젝트에 포함된 모든 스토리보드 번역에 공통 적용됩니다.
        </p>
      </div>

      <div className="nb-page-toolbar">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">스토리보드</h3>
          <p className="mt-1 text-sm text-gray-500">
            각 스토리보드에서 PPTX·원고 업로드 후 화면 텍스트 추출·번역을 진행합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="nb-btn-primary"
        >
          {showAddForm ? '추가 취소' : '스토리보드 추가'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddStoryboard} className="nb-card nb-input-surface p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="storyboardTitle" className="nb-field-label">
                스토리보드 제목
              </label>
              <input
                id="storyboardTitle"
                type="text"
                value={storyboardTitle}
                onChange={(e) => setStoryboardTitle(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="예: 1회차 - 시스템 개요"
              />
            </div>
            <div>
              <label className="nb-field-label">스토리보드 PPTX</label>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDraggingPptx(true)
                }}
                onDragLeave={() => setIsDraggingPptx(false)}
                onDrop={(e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault()
                  setIsDraggingPptx(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleFile(file)
                }}
                className={
                  isDraggingPptx
                    ? 'nb-dropzone nb-dropzone--active'
                    : pptxFile
                      ? 'nb-dropzone nb-dropzone--ready'
                      : 'nb-dropzone'
                }
              >
                {pptxFile ? (
                  <>
                    <p className="text-sm font-medium text-gray-900">{pptxFile.name}</p>
                    <button
                      type="button"
                      onClick={() => setPptxFile(null)}
                      className="mt-2 text-xs text-gray-500 hover:text-red-600"
                    >
                      파일 제거
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">PPTX 파일을 드래그하거나</p>
                    <label className="nb-btn-secondary mt-2 cursor-pointer">
                      PPTX 선택
                      <input
                        type="file"
                        accept=".pptx"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleFile(file)
                        }}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
            <div>
              <label className="nb-field-label">원고 (대본)</label>
              <div className={manuscriptFile ? 'nb-dropzone nb-dropzone--ready' : 'nb-dropzone'}>
                {manuscriptFile ? (
                  <>
                    <p className="text-sm font-medium text-gray-900">{manuscriptFile.name}</p>
                    <button
                      type="button"
                      onClick={() => setManuscriptFile(null)}
                      className="mt-2 text-xs text-gray-500 hover:text-red-600"
                    >
                      파일 제거
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">{MANUSCRIPT_FORMAT_LABEL} 원고</p>
                    <label className="nb-btn-secondary mt-2 cursor-pointer">
                      원고 선택
                      <input
                        type="file"
                        accept={MANUSCRIPT_ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (!isManuscriptFile(file)) {
                            showToast(MANUSCRIPT_UNSUPPORTED_MSG, 'error')
                            return
                          }
                          setManuscriptFile(file)
                        }}
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="nb-help-text mt-1">
                원고 텍스트로 스토리보드 화면 텍스트 정합성을 검증합니다.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createStoryboard.isPending || !pptxFile || !manuscriptFile}
              className="nb-btn-primary"
            >
              {createStoryboard.isPending ? '업로드 중...' : '스토리보드 추가'}
            </button>
          </div>
        </form>
      )}

      {storyboardsLoading && (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
        </div>
      )}

      {!storyboardsLoading && storyboards.length === 0 && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">등록된 스토리보드가 없습니다.</p>
          <p className="text-xs text-gray-400">PPTX를 업로드하여 스토리보드를 추가하세요.</p>
        </div>
      )}

      {storyboards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {storyboards.map((storyboard) => (
            <Link
              key={storyboard.id}
              to={`/projects/${project.id}/storyboards/${storyboard.id}`}
              className="nb-project-card"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h4 className="line-clamp-2 font-medium">{storyboard.title}</h4>
                <StoryboardStatusBadge status={storyboard.status} />
              </div>
              <dl className="space-y-1 text-xs text-gray-500">
                <div className="flex justify-between">
                  <dt>파일</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium text-gray-700">
                    {storyboard.source_pptx_name ?? '-'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>원고</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium text-gray-700">
                    {storyboard.source_manuscript_name ?? '-'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>수정일</dt>
                  <dd>{new Date(storyboard.updated_at).toLocaleDateString('ko-KR')}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}