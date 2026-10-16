// Gravação incremental do meta: em vez de enviar o meta inteiro (e a base) pelo IPC a cada gravação —
// dezenas de milhares de páginas clonadas e serializadas no processo da janela —, a janela envia só
// as páginas alteradas desde a última base conhecida pelo processo principal, e recebe de volta só o
// que a mesclagem mudou. Funções puras usadas pela janela (src/store.ts), pelo processo principal
// (main.cjs) e pelos testes (tests/perf-meta.test.mts).
import { jsonEqual } from './meta-merge.mjs'

const TOP = ['settings', 'notifications', 'syncedBlocks']

/** Diferença `prev → next`: páginas alteradas (null = removida) e campos de topo alterados. */
export function diffMeta(prev, next) {
  const pages = {}
  let count = 0
  const before = prev?.pages ?? {}, after = next?.pages ?? {}
  for (const id in after) {
    const a = before[id], b = after[id]
    if (a !== b && (a === undefined || !jsonEqual(a, b))) { pages[id] = b; count++ }
  }
  for (const id in before) if (!(id in after)) { pages[id] = null; count++ }
  const patch = { pages }
  for (const key of TOP) if (!jsonEqual(prev?.[key] ?? null, next?.[key] ?? null)) { patch[key] = next?.[key] ?? null; count++ }
  patch.size = count
  return patch
}

/** Aplica `patch` sobre `base` sem mutá-la (objetos não alterados são compartilhados). */
export function applyMetaPatch(base, patch) {
  if (!patch || !patch.size) return base
  const pages = { ...base.pages }
  for (const id in patch.pages) {
    if (patch.pages[id] === null) delete pages[id]
    else pages[id] = patch.pages[id]
  }
  const out = { ...base, pages }
  for (const key of TOP) if (key in patch) {
    if (patch[key] === null) delete out[key]
    else out[key] = patch[key]
  }
  return out
}

/** Validação defensiva do formato recebido pelo IPC. */
export function validMetaPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !patch.pages || typeof patch.pages !== 'object' || Array.isArray(patch.pages)) return false
  for (const id in patch.pages) {
    const page = patch.pages[id]
    if (page !== null && (typeof page !== 'object' || Array.isArray(page) || page.id !== id)) return false
  }
  for (const key of TOP) if (key in patch && patch[key] !== null && (typeof patch[key] !== 'object' || Array.isArray(patch[key]))) return false
  return Number.isInteger(patch.size)
}
