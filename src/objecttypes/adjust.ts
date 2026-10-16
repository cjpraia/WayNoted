// Ajustes pós-teste dos tipos (docs/USAGE.md, "Ajustes pós-teste"): lógica pura, sem React nem store.
// 1) campos da página que o tipo não tem; 2) reordenar; 4) páginas sem tipo; 5) tipo das novas linhas e tipos como modelos.
import type { Page, Property } from '../types'
import { effectiveProperties, findType, fold, UNSUPPORTED_FIELD_TYPES, FIELD_TYPES, type ObjectType, type TypeList } from './model.ts'

// ---------- 1. campos próprios da página ----------

export interface ExtraField {
  property: Property
  /** Páginas-alvo cujo banco tem este campo. */
  pageIds: string[]
  /** Quantas dessas páginas têm valor preenchido. */
  filled: number
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * Campos do banco de cada página-alvo (linhas de banco) que o tipo ainda não tem. "Já tem" = mesmo id, ou mesmo
 * nome e mesmo tipo de campo. Campos que um tipo não suporta (fórmula, rollup, botão, ID único, título) ficam de fora.
 */
export function extraFieldsFor(pages: Record<string, Page>, types: TypeList, pageIds: string[], typeId: string): ExtraField[] {
  if (!findType(types, typeId)) return []
  const have = effectiveProperties(types, typeId)
  const ids = new Set(have.map((prop) => prop.id))
  const names = new Set(have.map((prop) => `${fold(prop.name)}|${prop.type}`))
  const out = new Map<string, ExtraField>()
  for (const id of pageIds) {
    const page = pages[id]
    const schema = page?.parentId ? pages[page.parentId]?.database : undefined
    if (!page || !schema || page.types?.includes(typeId)) continue
    for (const property of schema.properties) {
      if (UNSUPPORTED_FIELD_TYPES.has(property.type) || !FIELD_TYPES.includes(property.type) || ids.has(property.id) || names.has(`${fold(property.name)}|${property.type}`)) continue
      let entry = out.get(property.id)
      if (!entry) out.set(property.id, (entry = { property, pageIds: [], filled: 0 }))
      entry.pageIds.push(id)
      if (!isEmpty(page.props?.[property.id])) entry.filled++
    }
  }
  return [...out.values()]
}

// ---------- 2. reordenar ----------

/** Move `id` para antes/depois de `targetId`. Devolve a mesma lista se nada muda. */
export function moveRelative<T extends { id: string }>(list: readonly T[], id: string, targetId: string, after: boolean): readonly T[] {
  if (id === targetId) return list
  const moving = list.find((item) => item.id === id)
  const rest = list.filter((item) => item.id !== id)
  const at = rest.findIndex((item) => item.id === targetId)
  if (!moving || at < 0) return list
  const next = [...rest]
  next.splice(after ? at + 1 : at, 0, moving)
  return next.every((item, index) => item === list[index]) ? list : next
}

/** Move `id` uma posição (teclado: ⌥↑/⌥↓). */
export function moveStep<T extends { id: string }>(list: readonly T[], id: string, delta: -1 | 1): readonly T[] {
  const index = list.findIndex((item) => item.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

// ---------- 4. páginas sem tipo ----------

export interface UntypedOptions {
  /** Bancos cujas linhas não entram (ex.: notas diárias). */
  excludeDatabaseIds?: ReadonlySet<string>
  /** Texto de busca já normalizado com `fold`. */
  query?: string
}

/** Páginas sem nenhum tipo: normais e linhas de banco; fora lixeira, bancos, lousas, bloqueadas, protegidas e páginas-modelo de tipos. */
export function untypedPages(pages: Record<string, Page>, types: TypeList, options: UntypedOptions = {}): Page[] {
  const templateSources = new Set(types.map((type) => type.template.sourcePageId).filter((id): id is string => !!id))
  const live = new Map<string, boolean>()
  const isLive = (id: string): boolean => {
    const known = live.get(id)
    if (known !== undefined) return known
    let current: Page | undefined = pages[id]
    let result = !!current
    for (let guard = 0; current && guard < 256; guard++) {
      if (current.trashed) { result = false; break }
      const parent: Page | undefined = current.parentId ? pages[current.parentId] : undefined
      if (!current.parentId) break
      if (!parent) { result = false; break }
      current = parent
    }
    live.set(id, result)
    return result
  }
  const q = options.query ?? ''
  const out: Page[] = []
  for (const id in pages) {
    const page = pages[id]
    if (page.types?.length || page.database || page.canvas || page.locked || page.passwordLock || page.trashed || templateSources.has(id)) continue
    if (page.parentId && options.excludeDatabaseIds?.has(page.parentId)) continue
    if (!isLive(id)) continue
    if (q && !fold(page.title).includes(q)) continue
    out.push(page)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ---------- 5. tipo das novas linhas ----------

/**
 * Tipo dominante das linhas de um banco: o que ≥ 50% das linhas vivas têm, com pelo menos 2 linhas. Empate: o
 * tipo com mais linhas. Devolve null se nenhum.
 */
export function dominantRowType(pages: Record<string, Page>, types: TypeList, dbId: string, excludeIds?: ReadonlySet<string>): { type: ObjectType; count: number; total: number } | null {
  const rows = Object.values(pages).filter((page) => page.parentId === dbId && !page.trashed && !excludeIds?.has(page.id))
  if (rows.length < 2) return null
  const counts = new Map<string, number>()
  for (const row of rows) for (const typeId of new Set(row.types ?? [])) if (findType(types, typeId)) counts.set(typeId, (counts.get(typeId) ?? 0) + 1)
  let best: [string, number] | null = null
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry
  if (!best || best[1] < 2 || best[1] * 2 < rows.length) return null
  return { type: findType(types, best[0])!, count: best[1], total: rows.length }
}

// ---------- 5b. tipos como modelos ----------

/**
 * Tipos oferecidos como modelo ("Tipo: Tags"): os em uso/escolhidos, em ordem de uso, sem repetir o nome de um
 * modelo já listado (nativo ou do banco).
 */
export function typesAsTemplates<T extends { type: ObjectType }>(sidebar: readonly T[], takenNames: readonly string[]): T[] {
  const taken = new Set(takenNames.map(fold))
  return sidebar.filter(({ type }) => type.name.trim() && !taken.has(fold(type.name)))
}
