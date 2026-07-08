import { invokeEdgeFunction } from './edgeFunction'

export interface SpellingCheckResponse {
  success: boolean
  project_id: string
  processed_slides: number
  result_count: number
}

export function spellingCheck(
  projectId: string,
  slideIds: string[],
  options?: {
    storyboardId?: string
    screenTextOnly?: boolean
    resetResults?: boolean
    finalize?: boolean
  },
) {
  return invokeEdgeFunction<SpellingCheckResponse>('spelling-check', {
    project_id: projectId,
    storyboard_id: options?.storyboardId,
    slide_ids: slideIds,
    screen_text_only: options?.screenTextOnly ?? true,
    reset_results: options?.resetResults ?? false,
    finalize: options?.finalize ?? true,
  })
}

export function translateSlides(
  projectId: string,
  storyboardId: string,
  slideIds: string[],
  targetLang: string,
  options?: { resetResults?: boolean; finalize?: boolean; screenTextOnly?: boolean },
) {
  return invokeEdgeFunction<{
    success: boolean
    processed_slides: number
    translation_count: number
  }>('translate', {
    project_id: projectId,
    storyboard_id: storyboardId,
    slide_ids: slideIds,
    target_lang: targetLang,
    screen_text_only: options?.screenTextOnly ?? true,
    reset_results: options?.resetResults ?? false,
    finalize: options?.finalize ?? true,
  })
}

export function verifyTranslations(
  projectId: string,
  options?: {
    storyboardId?: string
    translationIds?: string[]
    resetResults?: boolean
    finalize?: boolean
  },
) {
  return invokeEdgeFunction<{ success: boolean; verified_count: number }>('verify', {
    project_id: projectId,
    storyboard_id: options?.storyboardId,
    translation_ids: options?.translationIds,
    reset_results: options?.resetResults ?? false,
    finalize: options?.finalize ?? true,
  })
}

export function extractGlossary(projectId: string) {
  return invokeEdgeFunction<{ terms: unknown[]; summary: string }>('extract-glossary', {
    project_id: projectId,
  })
}
