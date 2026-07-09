import { formatScreenText, isSyncMarkerOnly } from './pptxParser'
import type { Slide } from '../types'

export type ConsistencyStatus = 'match' | 'partial' | 'missing'

export interface ScreenTextConsistencyItem {
  slideId: string
  slideNum: number
  screenNum: string | null
  text: string
  status: ConsistencyStatus
  score: number
  hint: string
}

export interface ConsistencySummary {
  total: number
  match: number
  partial: number
  missing: number
  items: ScreenTextConsistencyItem[]
}

function shouldSkipConsistencyLine(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (isSyncMarkerOnly(t)) return true
  if (/^#\d+\b/.test(t) && t.length < 30) return true
  if (/^출처\s*:/.test(t)) return true
  if (/^(영상|이미지|사진|캡처|동영상)/.test(t)) return true
  return false
}

function isLearningSlide(slide: Slide): boolean {
  if (slide.slide_type === 'intro' || slide.slide_type === 'divider' || slide.slide_type === 'outro') {
    return false
  }
  return slide.slide_num >= 4
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[「」『』"'"'']/g, '')
    .replace(/[.,!?;:·…]/g, '')
}

function longestCommonSubstringRatio(a: string, b: string): number {
  if (!a || !b) return 0
  if (a.length > b.length) [a, b] = [b, a]

  let maxLen = 0
  const dp = new Array(a.length + 1).fill(0)

  for (let i = 1; i <= b.length; i++) {
    let prev = 0
    for (let j = 1; j <= a.length; j++) {
      const temp = dp[j]
      if (b[i - 1] === a[j - 1]) {
        dp[j] = prev + 1
        maxLen = Math.max(maxLen, dp[j])
      } else {
        dp[j] = 0
      }
      prev = temp
    }
  }

  return maxLen / Math.max(a.length, 1)
}

function checkTextAgainstManuscript(text: string, manuscriptNorm: string): {
  status: ConsistencyStatus
  score: number
  hint: string
} {
  const norm = normalizeForCompare(text)
  if (!norm) {
    return { status: 'missing', score: 0, hint: '빈 텍스트' }
  }

  if (manuscriptNorm.includes(norm)) {
    return { status: 'match', score: 1, hint: '원고와 일치' }
  }

  const ratio = longestCommonSubstringRatio(norm, manuscriptNorm)
  if (ratio >= 0.55 || norm.length >= 4 && manuscriptNorm.includes(norm.slice(0, Math.min(norm.length, 8)))) {
    return {
      status: 'partial',
      score: ratio,
      hint: '원고와 유사 (표기·띄어쓰기 차이 가능)',
    }
  }

  return {
    status: 'missing',
    score: ratio,
    hint: '원고에서 찾기 어려움 — 스토리보드·원고 불일치 확인 필요',
  }
}

export function checkScreenTextConsistency(
  slides: Slide[],
  manuscriptText: string | null | undefined,
): ConsistencySummary {
  const manuscriptNorm = normalizeForCompare(manuscriptText ?? '')
  const items: ScreenTextConsistencyItem[] = []

  if (!manuscriptNorm) {
    return { total: 0, match: 0, partial: 0, missing: 0, items }
  }

  for (const slide of slides) {
    if (!isLearningSlide(slide)) continue

    const screenText = formatScreenText(slide.screen_text).trim()
    if (!screenText) continue

    const lines = screenText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !shouldSkipConsistencyLine(line))

    const texts = lines.length > 0 ? lines : []

    for (const text of texts) {
      const result = checkTextAgainstManuscript(text, manuscriptNorm)
      items.push({
        slideId: slide.id,
        slideNum: slide.slide_num,
        screenNum: slide.screen_num,
        text,
        status: result.status,
        score: result.score,
        hint: result.hint,
      })
    }
  }

  return {
    total: items.length,
    match: items.filter((i) => i.status === 'match').length,
    partial: items.filter((i) => i.status === 'partial').length,
    missing: items.filter((i) => i.status === 'missing').length,
    items,
  }
}
