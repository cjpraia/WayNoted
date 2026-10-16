// Configurações de IA espelhadas do processo principal (fonte da verdade: electron/ai/service.cjs).
import { useSyncExternalStore } from 'react'
import { getAIBridge } from './bridge.ts'
import type { AIFeature, AISettings, ProviderId } from './types.ts'

let current: AISettings | null = null
let loading: Promise<AISettings | null> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

export function setAISettings(value: AISettings | null) { current = value; emit() }
export function aiSettings() { return current }
export function refreshAISettings(): Promise<AISettings | null> {
  const bridge = getAIBridge()
  if (!bridge) return Promise.resolve(null)
  loading ??= bridge.aiGetSettings().then(value => { setAISettings(value); return value }).finally(() => { loading = null })
  return loading
}
export function useAISettings(): AISettings | null {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => current)
  if (!value && !loading && getAIBridge()) void refreshAISettings().catch(() => {})
  return value
}
export function providerFor(feature: AIFeature, settings: AISettings | null): ProviderId {
  return settings?.featureProviders[feature] || settings?.activeProvider || 'ollama'
}
