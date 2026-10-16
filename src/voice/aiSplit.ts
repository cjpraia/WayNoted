// IA local opcional para separar a transcrição em tarefas (B3). Só é oferecida com provedor LOCAL (Ollama) pronto:
// nunca escolhe um provedor em nuvem por conta própria, então nada sai do Mac sem o consentimento que já existe em Configurações → IA.
import { getAIBridge } from '../ai/bridge.ts'
import { runAI } from '../ai/client.ts'
import type { AIBridge } from '../ai/types.ts'

export async function localAiReady(bridge: AIBridge | null = getAIBridge()): Promise<boolean> {
  if (!bridge) return false
  try {
    const settings = await bridge.aiGetSettings()
    const provider = settings.featureProviders.assistant || settings.activeProvider
    if (provider !== 'ollama') return false
    const status = await bridge.aiStatus()
    return status.ollama?.state === 'ready'
  } catch { return false }
}

export function splitPrompt(text: string, locale: 'pt-BR' | 'en-US'): string {
  const language = locale === 'en-US' ? 'English' : 'Brazilian Portuguese'
  return [
    `Split this voice transcript into separate to-do items. Write each item as a short imperative sentence in ${language}.`,
    'Keep any date, time or urgency words inside the item exactly as spoken. Do not invent items. Ignore filler words.',
    'Reply with ONLY a JSON array of strings, nothing else.',
    '',
    'Transcript:',
    text,
  ].join('\n')
}

/** Primeiro array JSON de strings na resposta do modelo (tolera texto ao redor e cercas de código). */
export function parseItems(answer: string): string[] | null {
  const start = answer.indexOf('['), end = answer.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(answer.slice(start, end + 1))
    if (!Array.isArray(value)) return null
    const items = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    return items.length ? items.slice(0, 40) : null
  } catch { return null }
}

/** null = IA indisponível ou resposta inútil (quem chamou volta à heurística). */
export async function splitWithLocalAi(text: string, locale: 'pt-BR' | 'en-US', signal?: AbortSignal): Promise<string[] | null> {
  if (!text.trim() || !(await localAiReady())) return null
  try {
    const result = await runAI({ feature: 'assistant', operation: 'write', prompt: splitPrompt(text.slice(0, 12_000), locale), sources: [], locale }, { signal })
    if (result.preview.cloud) return null
    return parseItems(result.text)
  } catch { return null }
}
