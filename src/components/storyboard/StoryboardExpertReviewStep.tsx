import { useMemo, useState } from 'react'
import { ProgressBar } from '../ui/ProgressBar'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/ToastProvider'
import {
  getExpertReviewStats,
  getReviewUrl,
  useCreateExpertReview,
  useExpertReviewItems,
  useExpertReviews,
} from '../../hooks/useExpertReview'
import { fieldKeyLabel } from '../../lib/slideFields'
import { useSlides } from '../../hooks/useSlides'
import { isStoryboardStatusAtLeast, storyboardStepPrerequisiteMessage } from '../../lib/storyboardStatus'
import type { Project, Storyboard } from '../../types'

interface StoryboardExpertReviewStepProps {
  project: Project
  storyboard: Storyboard
}

export function StoryboardExpertReviewStep({ project, storyboard }: StoryboardExpertReviewStepProps) {
  const { showToast } = useToast()
  const { data: reviews = [], isLoading, refetch } = useExpertReviews(
    project.id,
    storyboard.id,
  )
  const { data: slides = [] } = useSlides(storyboard.id)
  const createReview = useCreateExpertReview()

  const activeReview = reviews.find((r) => r.status !== 'done') ?? reviews[0]
  const { data: items = [] } = useExpertReviewItems(activeReview?.id, project.id)

  const [reviewerName, setReviewerName] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [memo, setMemo] = useState('')

  const accessible = isStoryboardStatusAtLeast(storyboard.status, 'verified')
  const hasActiveReview = activeReview && activeReview.status !== 'done'
  const reviewUrl = activeReview ? getReviewUrl(activeReview.token) : ''
  const stats = getExpertReviewStats(items)

  const slideMap = useMemo(() => new Map(slides.map((s) => [s.id, s])), [slides])

  const handleCreateLink = async () => {
    if (!accessible) {
      showToast(storyboardStepPrerequisiteMessage(3), 'error')
      return
    }
    if (!reviewerName.trim() || !reviewerEmail.trim()) {
      showToast('전문가 이름과 이메일을 입력해 주세요.', 'error')
      return
    }

    try {
      await createReview.mutateAsync({
        projectId: project.id,
        storyboardId: storyboard.id,
        reviewerName: reviewerName.trim(),
        reviewerEmail: reviewerEmail.trim(),
        memo: memo.trim(),
      })
      showToast('검증 링크가 생성되었습니다.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '링크 생성에 실패했습니다.', 'error')
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(reviewUrl)
      showToast('링크가 클립보드에 복사되었습니다.', 'success')
    } catch {
      showToast('클립보드 복사에 실패했습니다.', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="nb-page-toolbar">
        <div>
          <h3 className="nb-step-title">Step 3. 전문가 검증</h3>
          <p className="nb-step-desc">
            화면 텍스트 영어 번역에 대한 전문가 검증 링크를 생성합니다.
          </p>
        </div>
        {hasActiveReview && (
          <button type="button" onClick={() => refetch()} className="nb-btn-secondary">
            새로고침
          </button>
        )}
      </div>

      {!accessible && (
        <div className="nb-alert nb-alert--warning">{storyboardStepPrerequisiteMessage(3)}</div>
      )}

      {isLoading ? (
        <div className="nb-empty-state">
          <Spinner className="text-gray-400" />
        </div>
      ) : hasActiveReview ? (
        <div className="space-y-4">
          <div className="nb-input-panel">
            <p className="text-sm font-semibold" style={{ color: '#0958d9' }}>
              검증 링크
            </p>
            <p className="mt-1 break-all font-mono text-sm">{reviewUrl}</p>
            <button type="button" onClick={handleCopyLink} className="nb-btn-primary mt-3">
              클립보드 복사
            </button>
          </div>

          {items.length > 0 && (
            <div className="nb-card p-4">
              <p className="mb-2 text-sm text-gray-600">
                진행률: {stats.total - stats.pending}/{stats.total}
              </p>
              <ProgressBar progress={Math.round(((stats.total - stats.pending) / stats.total) * 100)} />
            </div>
          )}

          <div className="nb-card overflow-hidden">
            <table className="nb-table">
              <thead>
                <tr>
                  <th>슬라이드</th>
                  <th>항목</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{slideMap.get(item.slide_id)?.slide_num ?? '-'}</td>
                    <td>{fieldKeyLabel(item.field)}</td>
                    <td>{item.status === 'pending' ? '대기' : '완료'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form
          className="nb-card nb-input-surface p-6"
          onSubmit={(e) => {
            e.preventDefault()
            handleCreateLink()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="nb-field-label">전문가 이름</label>
              <input
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="nb-input mt-1 w-full"
                required
              />
            </div>
            <div>
              <label className="nb-field-label">전문가 이메일</label>
              <input
                type="email"
                value={reviewerEmail}
                onChange={(e) => setReviewerEmail(e.target.value)}
                className="nb-input mt-1 w-full"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="nb-field-label">메모 (선택)</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={3}
                className="nb-textarea mt-1 w-full"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={createReview.isPending || !accessible}
              className="nb-btn-primary"
            >
              {createReview.isPending ? '생성 중...' : '검증 링크 생성'}
            </button>
          </div>
        </form>
      )}

      {storyboard.status === 'done' && (
        <div className="nb-alert nb-alert--success text-sm">
          전문가 검증이 완료되었습니다. 완료 단계에서 영문 PPTX를 다운로드하세요.
        </div>
      )}
    </div>
  )
}
