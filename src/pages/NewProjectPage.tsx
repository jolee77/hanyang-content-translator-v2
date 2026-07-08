import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useCreateProject } from '../hooks/useProject'
import { LANG_CONFIG } from '../lib/lang'

const TARGET_LANGUAGES = Object.entries(LANG_CONFIG).map(([code, { name }]) => ({
  code,
  name,
}))

export function NewProjectPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const createProject = useCreateProject()

  const [title, setTitle] = useState('')
  const [translationGuidelines, setTranslationGuidelines] = useState('')
  const [targetLang, setTargetLang] = useState('en')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    try {
      const project = await createProject.mutateAsync({
        title,
        translationGuidelines,
        targetLang,
      })
      showToast('프로젝트가 생성되었습니다. 스토리보드를 추가해 주세요.', 'success')
      navigate(`/projects/${project.id}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '프로젝트 생성에 실패했습니다.', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">새 프로젝트</h2>
          <p className="mt-1 text-sm text-gray-500">
            프로젝트를 생성한 뒤 여러 스토리보드(PPTX)를 추가할 수 있습니다.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="nb-card nb-input-surface p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            프로젝트 정보
          </h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="title" className="nb-field-label">
                프로젝트명
              </label>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="예: PLC 기초과정 - 영어 현지화"
              />
            </div>

            <div>
              <label htmlFor="guidelines" className="nb-field-label">
                번역 가이드라인
              </label>
              <textarea
                id="guidelines"
                required
                value={translationGuidelines}
                onChange={(e) => setTranslationGuidelines(e.target.value)}
                rows={6}
                className="nb-textarea mt-1 w-full"
                placeholder="예: 공손하고 전문적인 톤을 유지하세요. PLC 용어는 업계 표준 영문 표기를 사용합니다."
              />
              <p className="nb-help-text">
                이 프로젝트에 포함된 모든 스토리보드 번역에 공통 적용됩니다.
              </p>
            </div>

            <div>
              <label htmlFor="targetLang" className="nb-field-label">
                목표 언어
              </label>
              <select
                id="targetLang"
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="nb-input mt-1 w-full"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
              <p className="nb-help-text">
                이 프로젝트에 포함된 모든 스토리보드 번역에 공통 적용됩니다.
              </p>
            </div>
          </div>
        </div>

        <div className="nb-form-actions">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            disabled={createProject.isPending}
            className="nb-btn-secondary"
          >
            취소
          </button>
          <button type="submit" disabled={createProject.isPending} className="nb-btn-primary">
            {createProject.isPending && <Spinner className="text-white" />}
            {createProject.isPending ? '생성 중...' : '프로젝트 생성'}
          </button>
        </div>
      </form>
    </div>
  )
}
