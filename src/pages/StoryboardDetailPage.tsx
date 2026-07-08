import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ScreenTextExtractionStep } from '../components/storyboard/ScreenTextExtractionStep'
import { ScreenTextPipelineStep } from '../components/storyboard/ScreenTextPipelineStep'
import { StoryboardExpertReviewStep } from '../components/storyboard/StoryboardExpertReviewStep'
import { StoryboardDoneStep } from '../components/storyboard/StoryboardDoneStep'
import { StoryboardStatusBadge } from '../components/storyboard/StoryboardStatusBadge'
import { StoryboardStepNav } from '../components/storyboard/StoryboardStepNav'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useProject } from '../hooks/useProject'
import { useStoryboard } from '../hooks/useStoryboard'
import {
  canNavigateToStoryboardStep,
  storyboardStatusToStep,
  storyboardStepPrerequisiteMessage,
} from '../lib/storyboardStatus'

export function StoryboardDetailPage() {
  const { projectId, storyboardId } = useParams<{ projectId: string; storyboardId: string }>()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: storyboard, isLoading: storyboardLoading, error } = useStoryboard(storyboardId)
  const { showToast } = useToast()
  const [viewStep, setViewStep] = useState(1)

  useEffect(() => {
    if (storyboard) {
      setViewStep(storyboardStatusToStep(storyboard.status))
    }
  }, [storyboard?.status, storyboard?.id])

  const handleStepClick = (step: number) => {
    if (!storyboard) return
    if (!canNavigateToStoryboardStep(step, storyboard.status)) {
      showToast(storyboardStepPrerequisiteMessage(step), 'error')
      return
    }
    setViewStep(step)
  }

  if (projectLoading || storyboardLoading) {
    return (
      <div className="nb-empty-state">
        <Spinner className="text-gray-400" />
      </div>
    )
  }

  if (error || !project || !storyboard) {
    return (
      <div className="nb-alert nb-alert--error">
        스토리보드를 찾을 수 없습니다.
        <Link to={`/projects/${projectId}`} className="nb-link ml-2">
          프로젝트로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="nb-page-toolbar">
        <div>
          <p className="text-xs text-gray-500">
            <Link to={`/projects/${project.id}`} className="nb-link">
              {project.title}
            </Link>
          </p>
          <h2 className="text-xl font-semibold text-gray-900">{storyboard.title}</h2>
        </div>
        <StoryboardStatusBadge status={storyboard.status} />
      </div>

      <div className="nb-card p-4 sm:p-6">
        <StoryboardStepNav
          status={storyboard.status}
          activeStep={viewStep}
          onStepClick={handleStepClick}
        />
      </div>

      {viewStep === 1 && (
        <div className="nb-card p-4 sm:p-6">
          <ScreenTextExtractionStep
            project={project}
            storyboard={storyboard}
            onStepComplete={() => setViewStep(2)}
          />
        </div>
      )}

      {viewStep === 2 && (
        <div className="nb-card p-4 sm:p-6">
          <ScreenTextPipelineStep
            project={project}
            storyboard={storyboard}
            onStepComplete={() => setViewStep(3)}
          />
        </div>
      )}

      {viewStep === 3 && (
        <div className="nb-card p-4 sm:p-6">
          <StoryboardExpertReviewStep project={project} storyboard={storyboard} />
        </div>
      )}

      {viewStep === 4 && (
        <div className="nb-card p-4 sm:p-6">
          <StoryboardDoneStep project={project} storyboard={storyboard} />
        </div>
      )}
    </div>
  )
}
