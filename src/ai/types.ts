// Contrato renderer ↔ processo principal da IA (electron/ai/ipc.cjs, docs/AI.md).
export type ProviderId = 'ollama' | 'openrouter' | 'google'
export type CloudProviderId = 'openrouter' | 'google'
export type EmbeddingMode = 'auto' | 'ollama' | 'apple' | 'off'
export interface EmbedStatus { mode: EmbeddingMode; backend: 'ollama' | 'apple' | 'none'; model: string; ollama: { available: boolean }; apple: { available: boolean; dimension?: number; reason?: string } }
export type AIFeature = 'assistant' | 'ask' | 'blocks'
export type AIOperation = 'write' | 'summarize' | 'translate' | 'ask' | 'autofill' | 'notes'
export interface AIMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AIUsageCounter { requests: number; promptTokens: number; completionTokens: number; estimated: boolean }
export interface AISettings {
  activeProvider: ProviderId
  models: Record<ProviderId, string>
  embeddingModel: string
  embeddingBackend: EmbeddingMode
  temperature: number
  maxTokens: number
  featureProviders: Record<AIFeature, ProviderId | ''>
  ollamaEndpoint: string
  blockCloud: boolean
  consent: Record<CloudProviderId, { grantedAt: number; version: number } | null>
  confirmEachSend: Record<CloudProviderId, boolean>
  redact: boolean
  openrouterAttribution: boolean
  askTopK: number
  /** Só `{ configured, last4 }`: a chave nunca chega ao renderer. */
  keys: Record<CloudProviderId, { configured: boolean; last4?: string; storage?: 'file' | 'keychain' | 'session' }>
  usage: Record<string, Partial<Record<ProviderId, AIUsageCounter>>>
}
export type AISettingsPatch = Partial<Omit<AISettings, 'keys' | 'usage' | 'consent' | 'models' | 'featureProviders' | 'confirmEachSend'>> & { models?: Partial<Record<ProviderId, string>>; featureProviders?: Partial<Record<AIFeature, ProviderId | ''>>; confirmEachSend?: Partial<Record<CloudProviderId, boolean>> }
export interface AISource { pageId: string; blockId?: string; title?: string; path?: string; text: string }
export interface AIPrepareInput { feature: AIFeature; operation: AIOperation; prompt: string; sources: AISource[]; history?: { role: 'user' | 'assistant'; content: string }[]; locale: 'pt-BR' | 'en-US'; model?: string }
export interface AIPreview { requestId: string; provider: ProviderId; cloud: boolean; model: string; messages: AIMessage[]; tokens: number; needsConfirmation: boolean; excluded: number; redacted: boolean; sources: number; keptIndexes: number[] }
export interface AIRunResult { text: string; usage: { promptTokens: number; completionTokens: number; estimated: boolean }; provider: ProviderId; model: string }
export interface AIEvent { requestId: string; type: 'delta' | 'done' | 'error'; text?: string; code?: string }
export interface AIProviderStatus { state: 'ready' | 'no-model' | 'offline' | 'no-key' | 'no-consent' | 'blocked'; models?: number; code?: string }
export interface AIModelInfo { id: string; name: string; contextLength?: number }

/** Métodos expostos pelo preload (electron/preload.cjs). */
export interface AIBridge {
  aiGetSettings(): Promise<AISettings>
  aiUpdateSettings(patch: AISettingsPatch): Promise<AISettings>
  aiSetKey(provider: CloudProviderId, key: string, options?: { storage?: 'auto' | 'session' }): Promise<AISettings>
  aiRemoveKey(provider: CloudProviderId): Promise<AISettings>
  aiConsent(provider: CloudProviderId, granted: boolean): Promise<AISettings>
  aiStatus(): Promise<Record<ProviderId, AIProviderStatus>>
  aiListModels(provider: ProviderId): Promise<AIModelInfo[]>
  aiTest(provider: ProviderId): Promise<{ ok: boolean; models?: number }>
  aiPrepare(input: AIPrepareInput): Promise<AIPreview>
  aiRun(requestId: string, options: { confirmed?: boolean }): Promise<AIRunResult>
  aiCancel(requestId?: string): Promise<void>
  aiEmbed(texts: string[]): Promise<number[][]>
  aiEmbedStatus?(options?: { download?: boolean }): Promise<EmbedStatus>
  aiLoadIndex(): Promise<unknown>
  aiSaveIndex(data: unknown): Promise<void>
  aiLoadChats(): Promise<unknown>
  aiSaveChats(data: unknown): Promise<void>
  onAIEvent(handler: (event: AIEvent) => void): () => void
}
export const PROVIDER_LABEL: Record<ProviderId, string> = { ollama: 'Ollama', openrouter: 'OpenRouter', google: 'Google Gemini' }
export const isCloud = (id: ProviderId): id is CloudProviderId => id === 'openrouter' || id === 'google'
