const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/**
 * Igualdade com a mesma semântica de `JSON.stringify(a) === JSON.stringify(b)` (chaves com `undefined`
 * são ignoradas; em arrays `undefined`/NaN/Infinity valem `null`), mas sem serializar: compara por
 * identidade primeiro e para na primeira diferença. Com dezenas de milhares de páginas isso evita
 * várias serializações completas do meta a cada gravação (bloqueavam a UI por segundos).
 */
export function jsonEqual(a, b) {
  if (a === b) return true
  if (a !== null && typeof a === 'object' && typeof a.toJSON === 'function') a = a.toJSON()
  if (b !== null && typeof b === 'object' && typeof b.toJSON === 'function') b = b.toJSON()
  const ta = typeof a, tb = typeof b
  if (ta === 'number' && tb === 'number') return a === b || (!Number.isFinite(a) && !Number.isFinite(b))
  if (a === null || b === null) {
    // NaN/Infinity serializam como null.
    const nullish = (v) => v === null || (typeof v === 'number' && !Number.isFinite(v))
    return nullish(a) && nullish(b)
  }
  if (ta !== 'object' || tb !== 'object') return a === b
  const arrayA = Array.isArray(a)
  if (arrayA !== Array.isArray(b)) return false
  if (arrayA) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i]
      const nx = x === undefined || typeof x === 'function' || typeof x === 'symbol' ? null : x
      const ny = y === undefined || typeof y === 'function' || typeof y === 'symbol' ? null : y
      if (!jsonEqual(nx, ny)) return false
    }
    return true
  }
  const skip = (v) => v === undefined || typeof v === 'function' || typeof v === 'symbol'
  let countA = 0
  for (const key in a) {
    if (!Object.prototype.hasOwnProperty.call(a, key) || skip(a[key])) continue
    countA++
    if (!Object.prototype.hasOwnProperty.call(b, key) || skip(b[key]) || !jsonEqual(a[key], b[key])) return false
  }
  let countB = 0
  for (const key in b) if (Object.prototype.hasOwnProperty.call(b, key) && !skip(b[key])) countB++
  return countA === countB
}
const same = (a, b) => (a === undefined || b === undefined ? a === b : jsonEqual(a, b))
const ephemeral = new Set(['settings.openTabs', 'settings.activeTabId', 'settings.recent', 'settings.sidebarWidth', 'settings.sidebarCollapsed'])

/** Three-way merge: edits in unrelated fields/windows survive. Same-field conflicts are explicit. */
export function mergeMeta(current, base, proposed, path = '') {
  if (same(proposed, base)) return current
  if (same(current, base) || same(current, proposed)) return proposed
  if (ephemeral.has(path)) return proposed
  if (/\.(updatedAt|firedAt|readAt)$/.test(path) && typeof current === 'number' && typeof proposed === 'number') return Math.max(current, proposed)
  if (object(current) && object(base) && object(proposed)) {
    const result = {}
    for (const key of new Set([...Object.keys(current), ...Object.keys(base), ...Object.keys(proposed)])) {
      const value = mergeMeta(current[key], base[key], proposed[key], path ? `${path}.${key}` : key)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  const error = new Error(`CONCURRENT_CHANGE:${path}`)
  error.code = 'CONCURRENT_CHANGE'
  error.field = path
  throw error
}

export function pageContentChanged(before, after) {
  if (!before || !after) return false
  // Caminho rápido (a maioria das páginas não mudou): sem montar cópias filtradas.
  if (before === after || jsonEqual(before, after)) return false
  const meaningful = page => Object.fromEntries(Object.entries(page).filter(([key]) => !['updatedAt', 'updatedBy', 'text', 'bodyText', 'syncedBlockIds', 'outboundPageIds', 'bodyOutboundPageIds', 'pendingTemplateBlocks', 'favorite', 'order'].includes(key)))
  return !same(meaningful(before), meaningful(after))
}

/** Assign unique row numbers at the serialized write boundary, including concurrent windows. */
export function assignSequences(current, proposed) {
  const next = structuredClone(proposed)
  for (const database of Object.values(next.pages ?? {})) {
    if (!database.database || database.database.linkedSourceId) continue
    const existing = Object.values(current?.pages ?? {}).filter(page => page.parentId === database.id)
    const used = new Set(existing.map(page => page.sequence).filter(Number.isFinite))
    let sequence = Math.max(database.database.nextSequence ?? 1, 1, ...[...used].map(value => value + 1))
    for (const row of Object.values(next.pages).filter(page => page.parentId === database.id && !current?.pages[page.id])) {
      if (!Number.isFinite(row.sequence) || used.has(row.sequence)) row.sequence = sequence++
      used.add(row.sequence); sequence = Math.max(sequence, row.sequence + 1)
    }
    if (used.size) database.database.nextSequence = sequence
  }
  return next
}
