import type { StoryboardStatus } from '../types'

export const STORYBOARD_STEPS = [
  { step: 1, label: '화면 텍스트 추출' },
  { step: 2, label: '맞춤법·번역·역번역' },
  { step: 3, label: '전문가 검증' },
  { step: 4, label: '완료' },
] as const

const PHASE_LABELS = ['추출', 'AI처리', '전문가검토', '완료'] as const

const PHASE_BADGE_CLASSES = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-indigo-100 text-indigo-800',
  'bg-emerald-100 text-emerald-800',
] as const

const STATUS_ORDER: StoryboardStatus[] = [
  'uploaded',
  'extracted',
  'spelling',
  'spelling_done',
  'translating',
  'translated',
  'verifying',
  'verified',
  'expert_review',
  'done',
]

export function storyboardStatusToStep(status: StoryboardStatus): number {
  switch (status) {
    case 'uploaded':
      return 1
    case 'extracted':
    case 'spelling':
    case 'spelling_done':
    case 'translating':
    case 'translated':
    case 'verifying':
      return 2
    case 'verified':
    case 'expert_review':
      return 3
    case 'done':
      return 4
    default:
      return 1
  }
}

export function storyboardStatusToPhaseLabel(status: StoryboardStatus): string {
  return PHASE_LABELS[storyboardStatusToStep(status) - 1]
}

export function storyboardStatusToBadgeClass(status: StoryboardStatus): string {
  return PHASE_BADGE_CLASSES[storyboardStatusToStep(status) - 1]
}

export function isStoryboardStatusAtLeast(
  status: StoryboardStatus,
  minimum: StoryboardStatus,
): boolean {
  return STATUS_ORDER.indexOf(status) >= STATUS_ORDER.indexOf(minimum)
}

const STEP_MINIMUM_STATUS: Record<number, StoryboardStatus> = {
  2: 'extracted',
  3: 'verified',
  4: 'done',
}

export function canNavigateToStoryboardStep(
  step: number,
  status: StoryboardStatus,
): boolean {
  if (step === 1) return true
  if (step === 4) return status === 'done'
  const current = storyboardStatusToStep(status)
  if (step <= current) return true
  const minimum = STEP_MINIMUM_STATUS[step]
  return minimum ? isStoryboardStatusAtLeast(status, minimum) : false
}

export function storyboardStepPrerequisiteMessage(step: number): string {
  switch (step) {
    case 2:
      return '이전 단계(화면 텍스트 추출)를 먼저 완료해 주세요.'
    case 3:
      return '맞춤법·번역·역번역 검증을 완료한 후 전문가 검증으로 이동할 수 있습니다.'
    case 4:
      return '전문가 검증이 완료된 후 완료 단계로 이동할 수 있습니다.'
    default:
      return '이전 단계를 먼저 완료해 주세요.'
  }
}
