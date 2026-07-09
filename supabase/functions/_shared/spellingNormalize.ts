/** 맞춤법 비교용 — 연속 공백·줄바꿈을 단일 공백으로 통일 */
export function normalizeSpellingComparableText(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
}

export function stripSpellingWhitespace(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '')
}

export function hasLineBreak(text: string): boolean {
  return /[\n\r\u2028\u2029]/.test(text)
}

export function hasHangul(text: string): boolean {
  return /[\uAC00-\uD7AF\u3131-\u318E]/.test(text)
}

export function isPredominantlyLatin(text: string): boolean {
  const stripped = stripSpellingWhitespace(text)
  if (!stripped.length) return false
  const latin = (stripped.match(/[A-Za-z]/g) ?? []).length
  return latin / stripped.length >= 0.6
}

export interface SpellingIssueLike {
  type: string
  message: string
}

export function isSpellingContentEqual(original: string, suggestion: string): boolean {
  return normalizeSpellingComparableText(original) === normalizeSpellingComparableText(suggestion)
}

function isWhitespaceOnlySpellingDifference(original: string, suggestion: string): boolean {
  if (isSpellingContentEqual(original, suggestion)) return true
  return stripSpellingWhitespace(original) === stripSpellingWhitespace(suggestion)
}

export function isNewlineLayoutSpellingDifference(
  original: string,
  suggestion: string,
  issues: SpellingIssueLike[] = [],
): boolean {
  const nonSpacingIssues = issues.filter((issue) => issue.type !== 'spacing')
  if (issues.length > 0 && nonSpacingIssues.length > 0) return false

  if (!isWhitespaceOnlySpellingDifference(original, suggestion)) return false

  if (hasLineBreak(original)) return true

  if (hasHangul(original) || hasHangul(suggestion)) return false

  return isPredominantlyLatin(original)
}

export function reconcileSpellingSuggestion<T extends SpellingIssueLike>(
  original: string,
  suggestion: string,
  issues: T[],
): { suggestion: string; issues: T[] } {
  if (original === suggestion) {
    return { suggestion: original, issues: [] }
  }

  if (isSpellingContentEqual(original, suggestion)) {
    return {
      suggestion: original,
      issues: issues.filter((issue) => issue.type !== 'spacing'),
    }
  }

  if (isNewlineLayoutSpellingDifference(original, suggestion, issues)) {
    return { suggestion: original, issues: [] }
  }

  return { suggestion, issues }
}
