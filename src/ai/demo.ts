// Backend SIMULADO da IA para revisar a interface no navegador (npm run dev:web).
// Só em desenvolvimento e com localStorage['np:ai-demo']='1'. Nunca acessa a rede.
import type { AIBridge, AIEvent, AIPreview, AISettings, AISettingsPatch, CloudProviderId, ProviderId } from './types.ts'

export function demoEnabled(): boolean {
  try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && localStorage.getItem('np:ai-demo') === '1' } catch { return false }
}
const estimate = (text: string) => Math.ceil(text.length / 4)

/** Vetor determinístico por palavras (hash) — só para exercitar o índice semântico na prévia. */
export function demoEmbedding(text: string, size = 64): number[] {
  const vector = new Array(size).fill(0)
  for (const word of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) ?? []) {
    let hash = 0
    for (const char of word.slice(0, 5)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    vector[hash % size] += 1
  }
  return vector
}

export function createDemoBridge(): AIBridge {
  const listeners = new Set<(event: AIEvent) => void>()
  const pending = new Map<string, AIPreview>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const settings: AISettings = {
    activeProvider: 'ollama', models: { ollama: 'llama3.2:3b (simulado)', openrouter: '', google: '' }, embeddingModel: 'nomic-embed-text', embeddingBackend: 'auto', temperature: 0.3, maxTokens: 1024,
    featureProviders: { assistant: '', ask: '', blocks: '' }, ollamaEndpoint: 'http://127.0.0.1:11434', blockCloud: false, consent: { openrouter: null, google: null },
    confirmEachSend: { openrouter: true, google: true }, redact: false, openrouterAttribution: false, askTopK: 6, keys: { openrouter: { configured: false }, google: { configured: false } }, usage: {},
  }
  const snapshot = () => structuredClone(settings)
  const fail = (code: string, detail?: string) => { throw new Error(`${code}${detail ? `|detail=${detail}` : ''}`) }
  const cloud = (id: ProviderId): id is CloudProviderId => id !== 'ollama'
  return {
    async aiGetSettings() { return snapshot() },
    async aiUpdateSettings(patch: AISettingsPatch) {
      const { models, featureProviders, confirmEachSend, ...rest } = patch
      Object.assign(settings, rest)
      if (models) Object.assign(settings.models, models)
      if (featureProviders) Object.assign(settings.featureProviders, featureProviders)
      if (confirmEachSend) Object.assign(settings.confirmEachSend, confirmEachSend)
      return snapshot()
    },
    async aiSetKey(provider, key, _options) { if (key.trim().length < 8) fail('AI_KEY_INVALID_FORMAT'); settings.keys[provider] = { configured: true, last4: key.trim().slice(-4) }; return snapshot() },
    async aiRemoveKey(provider) { settings.keys[provider] = { configured: false }; return snapshot() },
    async aiConsent(provider, granted) { settings.consent[provider] = granted ? { grantedAt: Date.now(), version: 1 } : null; return snapshot() },
    async aiStatus() {
      const state = (id: CloudProviderId) => settings.blockCloud ? 'blocked' as const : !settings.keys[id].configured ? 'no-key' as const : !settings.consent[id] ? 'no-consent' as const : 'ready' as const
      return { ollama: { state: 'ready', models: 2 }, openrouter: { state: state('openrouter') }, google: { state: state('google') } }
    },
    async aiListModels(provider) {
      if (provider === 'ollama') return [{ id: 'llama3.2:3b (simulado)', name: 'llama3.2:3b (simulado)' }, { id: 'nomic-embed-text', name: 'nomic-embed-text' }]
      if (settings.blockCloud) fail('AI_CLOUD_BLOCKED', provider)
      if (!settings.keys[provider as CloudProviderId]?.configured) fail('AI_NO_KEY', provider)
      return provider === 'openrouter' ? ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'].map(id => ({ id, name: id })) : ['gemini-2.5-flash', 'gemini-2.5-pro'].map(id => ({ id, name: id }))
    },
    async aiTest(provider) { if (cloud(provider) && !settings.keys[provider].configured) fail('AI_NO_KEY', provider); return { ok: true } },
    async aiPrepare(input) {
      const id = settings.featureProviders[input.feature] || settings.activeProvider
      if (cloud(id)) {
        if (settings.blockCloud) fail('AI_CLOUD_BLOCKED', id)
        if (!settings.consent[id]) fail('AI_CONSENT_REQUIRED', id)
        if (!settings.keys[id].configured) fail('AI_NO_KEY', id)
        if (!settings.models[id]) fail('AI_NO_MODEL', id)
      }
      const excerpts = input.sources.map((s, i) => `[${i + 1}] ${s.title ?? ''}${s.path ? ` › ${s.path}` : ''}\n${s.text}`).join('\n\n')
      const messages = [{ role: 'system' as const, content: 'You are a personal writing assistant inside a notes app. (simulado)' }, { role: 'user' as const, content: input.operation === 'notes' ? `Question:\n${input.prompt}\n\n<excerpts>\n${excerpts}\n</excerpts>` : `User request:\n${input.prompt}\n\n<context>\n${input.sources.map(s => s.text).join('\n\n')}\n</context>` }]
      const preview: AIPreview = { requestId: crypto.randomUUID(), provider: id, cloud: cloud(id), model: input.model || settings.models[id], messages, tokens: estimate(messages.map(m => m.content).join('\n')), needsConfirmation: cloud(id) && settings.confirmEachSend[id], excluded: 0, redacted: settings.redact, sources: input.sources.length, keptIndexes: input.sources.map((_, i) => i) }
      pending.set(preview.requestId, preview)
      return preview
    },
    aiRun(requestId, options) {
      const job = pending.get(requestId)
      pending.delete(requestId)
      if (!job) return Promise.reject(new Error('AI_EXPIRED'))
      if (job.needsConfirmation && !options.confirmed) return Promise.reject(new Error('AI_CONFIRMATION_REQUIRED'))
      const answer = job.messages[1].content.startsWith('Question') ? `De acordo com as suas notas, a decisão principal está registrada em [1]${job.sources > 1 ? ' e foi detalhada depois [2]' : ''}. (Resposta simulada, sem modelo real.)` : 'Prévia simulada do assistente: este texto foi gerado localmente pelo backend de demonstração.'
      const pieces = answer.match(/.{1,12}/g) ?? []
      return new Promise((resolve, reject) => {
        let index = 0
        const tick = () => {
          if (!pending.has(`run:${requestId}`)) { reject(new Error('AI_CANCELLED')); return }
          if (index >= pieces.length) { pending.delete(`run:${requestId}`); const usage = { promptTokens: job.tokens, completionTokens: estimate(answer), estimated: true }; listeners.forEach(l => l({ requestId, type: 'done' })); resolve({ text: answer, usage, provider: job.provider, model: job.model }); return }
          listeners.forEach(l => l({ requestId, type: 'delta', text: pieces[index++] }))
          timers.set(requestId, setTimeout(tick, 60))
        }
        pending.set(`run:${requestId}`, job)
        tick()
      })
    },
    async aiCancel(requestId) { for (const key of [...pending.keys()]) if (!requestId || key === `run:${requestId}` || key === requestId) { pending.delete(key) } },
    async aiEmbed(texts) { return texts.map(text => demoEmbedding(text)) },
    async aiLoadIndex() { return null },
    async aiSaveIndex() {},
    async aiLoadChats() { try { return JSON.parse(sessionStorage.getItem('np:ai-demo-chats') ?? 'null') } catch { return null } },
    async aiSaveChats(data) { try { sessionStorage.setItem('np:ai-demo-chats', JSON.stringify(data)) } catch { /* só prévia */ } },
    onAIEvent(handler) { listeners.add(handler); return () => { listeners.delete(handler) } },
  }
}
