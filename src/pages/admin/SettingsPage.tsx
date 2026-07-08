import { useEffect, useState, type FormEvent } from 'react'
import { maskApiKey } from '../../lib/apiKey'
import { useSettings, useUpdateSettings } from '../../hooks/useAdmin'
import { useToast } from '../../hooks/ToastProvider'
import { Spinner } from '../../components/ui/Spinner'
import type { AiProvider } from '../../types'

const AI_PROVIDERS: Array<{ value: AiProvider; label: string; placeholder: string }> = [
  { value: 'claude', label: 'Claude (Anthropic)', placeholder: 'sk-ant-api03-...' },
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'google', label: 'Google Gemini', placeholder: 'AIza...' },
]

export function SettingsPage() {
  const { data: settings, isLoading, error } = useSettings()
  const updateSettings = useUpdateSettings()
  const { showToast } = useToast()

  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('claude')
  const [apiKeyInput, setApiKeyInput] = useState('')

  useEffect(() => {
    if (settings) {
      setSelectedProvider(settings.active_ai_provider)
    }
  }, [settings])

  const providerMeta = AI_PROVIDERS.find((p) => p.value === selectedProvider)!

  const getMaskedKey = (provider: AiProvider): string | null => {
    if (!settings) return null
    switch (provider) {
      case 'claude':
        return settings.claude_api_key
      case 'openai':
        return settings.openai_api_key
      case 'google':
        return settings.google_api_key
      default:
        return null
    }
  }

  const maskedKey = maskApiKey(getMaskedKey(selectedProvider))
  const hasExistingKey = !!getMaskedKey(selectedProvider)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    const payload: Parameters<typeof updateSettings.mutateAsync>[0] = {
      activeAiProvider: selectedProvider,
    }

    if (apiKeyInput.trim()) {
      if (selectedProvider === 'claude') payload.claudeApiKey = apiKeyInput
      if (selectedProvider === 'openai') payload.openaiApiKey = apiKeyInput
      if (selectedProvider === 'google') payload.googleApiKey = apiKeyInput
    }

    try {
      await updateSettings.mutateAsync(payload)
      setApiKeyInput('')
      showToast('설정이 저장되었습니다.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '설정 저장에 실패했습니다.',
        'error',
      )
    }
  }

  if (isLoading) {
    return (
      <div className="nb-empty-state">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">설정을 불러오는 중...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="nb-alert nb-alert--error">
        설정을 불러오지 못했습니다: {error.message}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">API 설정</h2>
          <p className="mt-1 text-sm text-gray-500">
            AI 서비스 선택 및 API 키를 관리합니다. 목표 언어는 프로젝트 생성 시 지정합니다.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="nb-card nb-input-surface p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            AI 서비스
          </h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="aiProvider" className="nb-field-label">
                사용할 AI 서비스
              </label>
              <select
                id="aiProvider"
                value={selectedProvider}
                onChange={(e) => {
                  setSelectedProvider(e.target.value as AiProvider)
                  setApiKeyInput('')
                }}
                className="nb-input mt-1 w-full"
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <p className="nb-help-text">
                번역·맞춤법 등 AI 작업에 사용할 서비스입니다. 선택 후 해당 서비스의 API 키를 등록하세요.
              </p>
            </div>

            {hasExistingKey && (
              <div className="nb-input-panel">
                <p className="text-xs font-medium text-gray-500">
                  {providerMeta.label} 등록된 키
                </p>
                <p className="mt-1 font-mono text-sm text-gray-800">{maskedKey}</p>
              </div>
            )}

            <div>
              <label htmlFor="apiKey" className="nb-field-label">
                {providerMeta.label} API 키
              </label>
              <input
                id="apiKey"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="nb-input mt-1 w-full font-mono"
                placeholder={providerMeta.placeholder}
                autoComplete="off"
              />
              <p className="nb-help-text">
                Edge Function에서 사용됩니다. 서버에만 저장되며 화면에는 마스킹되어 표시됩니다.
              </p>
            </div>
          </div>
        </div>

        <div className="nb-form-actions">
          <button type="submit" disabled={updateSettings.isPending} className="nb-btn-primary">
            {updateSettings.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
