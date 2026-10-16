/**
 * Ranking de uso local (Pareto): conta quantas vezes cada comando foi usado, com decaimento
 * exponencial, para mostrar primeiro o que a pessoa realmente usa.
 *
 * Privacidade: só ids de comandos (ex.: "heading-1", "cmd:new"), contagens e datas. Nunca
 * conteúdo de páginas nem texto digitado. Fica em `localStorage` deste Mac, não sai do app,
 * pode ser desligado e apagado em Configurações → Segurança e privacidade.
 */
export type UsageScope = 'slash' | 'cmd' | 'prop'
interface Entry { n: number; t: number }
interface Store { v: 1; off?: boolean; slash: Record<string, Entry>; cmd: Record<string, Entry>; prop: Record<string, Entry> }

export const USAGE_KEY = "workspace.usage.v1"
/** Meia-vida do peso de cada uso: depois de 14 dias, um uso vale metade. */
export const USAGE_HALF_LIFE_MS = 14 * 24 * 3600 * 1000
const MAX_ENTRIES = 300
const ID_PATTERN = /^[a-z0-9:_.\-]{1,80}$/i

let memory: Store | null = null
let override: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined
const listeners = new Set<() => void>()
let version = 0

const empty = (): Store => ({ v: 1, slash: {}, cmd: {}, prop: {} })
function backend(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (override !== undefined) return override
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
/** Só para testes: troca o armazenamento (null = só memória). */
export function setUsageStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined) { override = storage; memory = null; version++ }

function sanitize(raw: unknown): Store {
  const store = empty()
  if (!raw || typeof raw !== 'object') return store
  const source = raw as Record<string, unknown>
  store.off = source.off === true
  for (const scope of ['slash', 'cmd', 'prop'] as const) {
    const bucket = source[scope]
    if (!bucket || typeof bucket !== 'object') continue
    for (const [id, value] of Object.entries(bucket as Record<string, unknown>)) {
      const entry = value as Partial<Entry> | null
      if (!ID_PATTERN.test(id) || !entry || !Number.isFinite(entry.n) || !Number.isFinite(entry.t)) continue
      store[scope][id] = { n: Math.max(0, Math.min(entry.n!, 1e6)), t: entry.t! }
    }
  }
  return store
}
function load(): Store {
  if (memory) return memory
  try { const text = backend()?.getItem(USAGE_KEY); memory = sanitize(text ? JSON.parse(text) : null) } catch { memory = empty() }
  return memory
}
function save(store: Store) {
  memory = store
  version++
  try { backend()?.setItem(USAGE_KEY, JSON.stringify(store)) } catch { /* Conveniência local; a falha não afeta o uso. */ }
  listeners.forEach((listener) => listener())
}

/** Peso atual de uma entrada: n × 0,5^(idade / meia-vida). */
export function decayedScore(entry: Entry | undefined, now = Date.now()): number {
  if (!entry) return 0
  return entry.n * Math.pow(0.5, Math.max(0, now - entry.t) / USAGE_HALF_LIFE_MS)
}

export function usageEnabled(): boolean { return !load().off }
export function setUsageEnabled(enabled: boolean) { const store = { ...load() }; if (enabled) delete store.off; else store.off = true; save(store) }
/** Apaga todos os contadores, mantendo a preferência ligado/desligado. */
export function clearUsage() { const store = empty(); if (load().off) store.off = true; save(store) }

export function recordUse(scope: UsageScope, id: string, now = Date.now()) {
  const store = load()
  if (store.off || !ID_PATTERN.test(id)) return
  const bucket = { ...store[scope] }
  bucket[id] = { n: decayedScore(bucket[id], now) + 1, t: now }
  const ids = Object.keys(bucket)
  if (ids.length > MAX_ENTRIES) for (const stale of ids.sort((a, b) => decayedScore(bucket[a], now) - decayedScore(bucket[b], now)).slice(0, ids.length - MAX_ENTRIES + 20)) delete bucket[stale]
  save({ ...store, [scope]: bucket })
}

/** Peso de cada id (0 quando o ranking está desligado). */
export function usageScores(scope: UsageScope, now = Date.now()): Record<string, number> {
  const store = load()
  if (store.off) return {}
  return Object.fromEntries(Object.entries(store[scope]).map(([id, entry]) => [id, decayedScore(entry, now)]))
}
/** Ids usados por último, do mais recente para o mais antigo. */
export function recentIds(scope: UsageScope, limit: number): string[] {
  const store = load()
  if (store.off) return []
  return Object.entries(store[scope]).sort((a, b) => b[1].t - a[1].t).slice(0, limit).map(([id]) => id)
}
export function usageCount(): number { const s = load(); return Object.keys(s.slash).length + Object.keys(s.cmd).length + Object.keys(s.prop).length }
export function subscribeUsage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function usageVersion() { return version }

/**
 * Posição serial: o mais importante no início e o segundo mais importante no fim da lista,
 * onde a memória é melhor; o resto fica no meio. Recebe a lista já ordenada por importância.
 */
export function serialOrder<T>(ranked: readonly T[]): T[] {
  if (ranked.length < 3) return [...ranked]
  return [ranked[0], ...ranked.slice(2), ranked[1]]
}
