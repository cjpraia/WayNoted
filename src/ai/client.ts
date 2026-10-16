// Orquestra um pedido de IA: prepara no processo principal → consentimento (1ª vez, nuvem) →
// prévia "Enviar/Cancelar" (nuvem com "Perguntar antes de cada envio") → execução em streaming.
import { getAIBridge } from './bridge.ts'
import { parseAIError } from './errors.ts'
import { refreshAISettings } from './settingsStore.ts'
import type { AIPrepareInput, AIPreview, AIRunResult, CloudProviderId } from './types.ts'

export interface AIPrompts {
  /** Diálogo de consentimento por provedor; resolve true só com aceite explícito. */
  consent(provider: CloudProviderId): Promise<boolean>
  /** Prévia exata do que será enviado; resolve true só com "Enviar". */
  preview(preview: AIPreview): Promise<boolean>
}
let prompts: AIPrompts | null = null
/** Registrado por <AIPromptsHost/>. Sem ele, nada que precise de confirmação é enviado. */
export function registerAIPrompts(value: AIPrompts | null) { prompts = value }

export interface RunOptions { onDelta?: (text: string) => void; onPreview?: (preview: AIPreview) => void; signal?: AbortSignal }

export async function runAI(input: AIPrepareInput, options: RunOptions = {}): Promise<AIRunResult & { preview: AIPreview }> {
  const bridge = getAIBridge()
  if (!bridge) throw new Error('AI_UNAVAILABLE')
  if (options.signal?.aborted) throw new Error('AI_CANCELLED')
  let preview: AIPreview
  try { preview = await bridge.aiPrepare(input) }
  catch (cause) {
    const error = parseAIError(cause)
    if (error.code !== 'AI_CONSENT_REQUIRED' || (error.detail !== 'openrouter' && error.detail !== 'google')) throw cause
    if (!prompts || !(await prompts.consent(error.detail))) throw new Error('AI_CANCELLED')
    await bridge.aiConsent(error.detail, true)
    void refreshAISettings().catch(() => {})
    if (options.signal?.aborted) throw new Error('AI_CANCELLED')
    preview = await bridge.aiPrepare(input)
  }
  options.onPreview?.(preview)
  if (preview.needsConfirmation) {
    const accepted = prompts ? await prompts.preview(preview) : false
    if (!accepted || options.signal?.aborted) { await bridge.aiCancel(preview.requestId).catch(() => {}); throw new Error('AI_CANCELLED') }
  }
  const unsubscribe = bridge.onAIEvent(event => { if (event.requestId === preview.requestId && event.type === 'delta' && event.text) options.onDelta?.(event.text) })
  const abort = () => { void bridge.aiCancel(preview.requestId).catch(() => {}) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await bridge.aiRun(preview.requestId, { confirmed: preview.needsConfirmation })
    return { ...result, preview }
  } finally {
    unsubscribe(); options.signal?.removeEventListener('abort', abort)
    if (preview.cloud) void refreshAISettings().catch(() => {})
  }
}
