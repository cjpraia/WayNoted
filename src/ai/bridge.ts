// Acesso à IA a partir do renderer: só pelo preload (processo principal). Sem rede aqui.
import type { AIBridge } from './types.ts'
import { createDemoBridge, demoEnabled } from './demo.ts'

let override: AIBridge | null | undefined
let demo: AIBridge | null = null
/** Testes jsdom injetam um backend simulado. */
export function setAIBridge(bridge: AIBridge | null | undefined) { override = bridge }
export function getAIBridge(): AIBridge | null {
  if (override !== undefined) return override
  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: Partial<AIBridge> }).api : undefined)
  if (api && typeof api.aiPrepare === 'function') return api as AIBridge
  // Prévia no navegador (dev): backend simulado opcional, sem rede (docs/AI.md §6).
  if (demoEnabled()) return demo ??= createDemoBridge()
  return null
}
