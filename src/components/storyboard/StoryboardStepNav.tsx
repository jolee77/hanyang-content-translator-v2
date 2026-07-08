import { STORYBOARD_STEPS } from '../../lib/storyboardStatus'
import type { StoryboardStatus } from '../../types'

interface StoryboardStepNavProps {
  status: StoryboardStatus
  activeStep: number
  onStepClick: (step: number) => void
}

export function StoryboardStepNav({ activeStep, onStepClick }: StoryboardStepNavProps) {
  return (
    <nav className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
      {STORYBOARD_STEPS.map(({ step, label }) => {
        const isActive = activeStep === step
        return (
          <button
            key={step}
            type="button"
            onClick={() => onStepClick(step)}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition sm:px-4 sm:text-sm ${
              isActive
                ? 'bg-[#1677ff] text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                isActive ? 'bg-white/20' : 'bg-white text-gray-500'
              }`}
            >
              {step}
            </span>
            {label}
          </button>
        )
      })}
    </nav>
  )
}
