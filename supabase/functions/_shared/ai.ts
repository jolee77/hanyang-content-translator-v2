import { HttpError, extractJsonFromText } from './http.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type AiProvider = 'claude' | 'openai' | 'google'

export interface AiConfig {
  provider: AiProvider
  apiKey: string
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: 'Claude (Anthropic)',
  openai: 'OpenAI',
  google: 'Google Gemini',
}

const PROVIDER_KEY_MAP: Record<AiProvider, string> = {
  claude: 'claude_api_key',
  openai: 'openai_api_key',
  google: 'google_api_key',
}

export const CLAUDE_MODEL = 'claude-sonnet-4-6'
export const CLAUDE_SPELLING_MODEL = 'claude-haiku-4-5'
const OPENAI_MODEL = 'gpt-4o'
const GOOGLE_MODEL = 'gemini-2.0-flash'

export function getProviderLabel(provider: AiProvider): string {
  return PROVIDER_LABELS[provider]
}

export async function getAiConfig(serviceClient: SupabaseClient): Promise<AiConfig> {
  const { data, error } = await serviceClient
    .from('settings')
    .select('key, value')
    .in('key', ['active_ai_provider', 'claude_api_key', 'openai_api_key', 'google_api_key'])

  if (error) {
    throw new HttpError(500, `AI 설정 조회 실패: ${error.message}`)
  }

  const map = new Map((data ?? []).map((row) => [row.key, row.value]))
  const provider = (map.get('active_ai_provider') ?? 'claude') as AiProvider

  if (!['claude', 'openai', 'google'].includes(provider)) {
    throw new HttpError(400, '유효하지 않은 AI 서비스 설정입니다.')
  }

  const apiKey = map.get(PROVIDER_KEY_MAP[provider])?.trim()
  if (!apiKey) {
    throw new HttpError(
      400,
      `${PROVIDER_LABELS[provider]} API 키가 설정되지 않았습니다. 관리자 설정에서 등록해 주세요.`,
    )
  }

  return { provider, apiKey }
}

/** @deprecated getAiConfig 사용 */
export async function getClaudeApiKey(serviceClient: SupabaseClient): Promise<string> {
  const config = await getAiConfig(serviceClient)
  return config.apiKey
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  model: string,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new HttpError(response.status === 429 ? 429 : 502, `Claude API 오류: ${body}`)
  }

  const data = await response.json() as { content?: Array<{ type: string; text?: string }> }
  const text = data.content?.find((block) => block.type === 'text')?.text
  if (!text) throw new HttpError(502, 'Claude API 응답이 비어 있습니다.')
  return text
}

async function callOpenAi(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new HttpError(response.status === 429 ? 429 : 502, `OpenAI API 오류: ${body}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new HttpError(502, 'OpenAI API 응답이 비어 있습니다.')
  return text
}

async function callGoogle(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new HttpError(response.status === 429 ? 429 : 502, `Google Gemini API 오류: ${body}`)
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new HttpError(502, 'Google Gemini API 응답이 비어 있습니다.')
  return text
}

export async function callAi(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  spelling = false,
): Promise<string> {
  switch (config.provider) {
    case 'claude':
      return callClaude(
        config.apiKey,
        systemPrompt,
        userPrompt,
        maxTokens,
        spelling ? CLAUDE_SPELLING_MODEL : CLAUDE_MODEL,
      )
    case 'openai':
      return callOpenAi(config.apiKey, systemPrompt, userPrompt, maxTokens)
    case 'google':
      return callGoogle(config.apiKey, systemPrompt, userPrompt, maxTokens)
    default:
      throw new HttpError(400, '지원하지 않는 AI 서비스입니다.')
  }
}

export async function callAiJson<T>(
  config: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  spelling = false,
): Promise<T> {
  const text = await callAi(config, systemPrompt, userPrompt, maxTokens, spelling)
  return extractJsonFromText(text) as T
}

// claude.ts 호환 re-export
export async function callClaudeJson<T>(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  model = CLAUDE_MODEL,
): Promise<T> {
  const text = await callClaude(apiKey, systemPrompt, userPrompt, maxTokens, model)
  return extractJsonFromText(text) as T
}

export async function callClaudeText(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  model = CLAUDE_MODEL,
): Promise<string> {
  return callClaude(apiKey, systemPrompt, userPrompt, maxTokens, model)
}
