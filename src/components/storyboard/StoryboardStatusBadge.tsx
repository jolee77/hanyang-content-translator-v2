import {
  storyboardStatusToBadgeClass,
  storyboardStatusToPhaseLabel,
} from '../../lib/storyboardStatus'
import type { StoryboardStatus } from '../../types'

interface StoryboardStatusBadgeProps {
  status: StoryboardStatus
  className?: string
}

export function StoryboardStatusBadge({ status, className = '' }: StoryboardStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${storyboardStatusToBadgeClass(status)} ${className}`}
    >
      {storyboardStatusToPhaseLabel(status)}
    </span>
  )
}
