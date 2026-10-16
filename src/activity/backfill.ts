// Reconstrução estimada do histórico anterior ao registro (uma vez por espaço). A parte pura recebe
// datas e textos já carregados; `runBackfill` busca os dados aos poucos, em fatias ociosas e cancelável.
import { dayKey as localDayKey, emptyDay, SESSION_GAP_MS, type ProductivityDay } from '../../electron/productivity-data.mjs'
import type { DatabaseSchema, DateValue, DocumentVersion, Page } from '../types'
import { countWords, countChecked } from './words.ts'
import { isDoneValue } from '../recurrence.ts'
import { isCompletionProperty } from './tasks.ts'

export interface Snapshot { savedAt: number; text: string; checked: number }
export interface BackfillPage {
  id: string
  createdAt: number
  updatedAt: number
  /** false para páginas protegidas/na lixeira: contam nos totais, nunca na lista de páginas. */
  named: boolean
  /** Estados do conteúdo em ordem cronológica (versões + atual), quando carregados. */
  snapshots?: Snapshot[]
  /** Histórico truncado: a primeira versão só serve de base (não credita palavras). */
  partial?: boolean
  /** Instantes de conclusão de tarefas (datas recorrentes, linhas concluídas). */
  doneAt?: number[]
}

/** Agrega por dia tudo o que aconteceu antes de `before` (chave exclusiva). */
export function reconstruct(pages: BackfillPage[], before: string, keyOf: (epoch: number) => string = localDayKey): Record<string, ProductivityDay> {
  const days: Record<string, ProductivityDay> = {}
  const moments: number[] = []
  const day = (at: number) => { const key = keyOf(at); return key < before ? (days[key] ??= emptyDay()) : null }
  const credit = (page: BackfillPage, at: number, words: number, edits: number) => {
    const target = day(at)
    if (!target) return
    target.words += words
    target.edits += edits
    if (edits) { target.hours[new Date(at).getHours()] += edits; moments.push(at) }
    if (page.named && (words || edits)) { const pages = (target.pages ??= {}); const entry = pages[page.id] ?? [0, 0]; pages[page.id] = [entry[0] + words, entry[1] + edits] }
  }
  for (const page of pages) {
    if (page.createdAt > 0) { const target = day(page.createdAt); if (target) { target.created++; moments.push(page.createdAt) } }
    const snapshots = (page.snapshots ?? []).filter(s => Number.isFinite(s.savedAt) && s.savedAt > 0).sort((a, b) => a.savedAt - b.savedAt)
    if (snapshots.length) {
      let previousText: string | null = null, previousWords = 0, previousChecked = 0
      if (page.partial) { const first = snapshots.shift()!; previousText = first.text; previousWords = countWords(first.text); previousChecked = first.checked }
      for (const snapshot of snapshots) {
        if (snapshot.text === previousText && snapshot.checked === previousChecked) continue
        const words = countWords(snapshot.text)
        credit(page, snapshot.savedAt, Math.max(0, words - previousWords), 1)
        const tasks = Math.max(0, snapshot.checked - previousChecked)
        const target = day(snapshot.savedAt)
        if (target && tasks) target.tasks += tasks
        previousText = snapshot.text; previousWords = words; previousChecked = snapshot.checked
      }
    } else if (page.updatedAt > page.createdAt + 1000) credit(page, page.updatedAt, 0, 1)
    for (const at of page.doneAt ?? []) { const target = day(at); if (target) target.tasks++ }
  }
  // Sessões estimadas: rajadas de momentos conhecidos separadas por 10 min.
  moments.sort((a, b) => a - b)
  let last = -Infinity
  for (const at of moments) {
    if (at - last >= SESSION_GAP_MS) { const target = day(at); if (target) target.sessions++ }
    last = at
  }
  for (const value of Object.values(days)) value.estimated = true
  return days
}

/** Conclusões conhecidas de uma linha: histórico das datas recorrentes ou, se concluída agora, `updatedAt`. */
export function completionMoments(row: Page, schema: DatabaseSchema | undefined): number[] {
  if (!schema || !row.props) return []
  const moments: number[] = []
  for (const property of schema.properties) {
    if (property.type !== 'date') continue
    const value = row.props[property.id] as DateValue | undefined
    if (value && typeof value === 'object' && Array.isArray(value.completions)) moments.push(...value.completions.filter(n => Number.isFinite(n)))
  }
  if (!moments.length && schema.properties.some(property => isCompletionProperty(schema, property) && isDoneValue(property, row.props?.[property.id]))) moments.push(row.updatedAt)
  return moments
}

export interface BackfillSource {
  pages: Record<string, Page>
  /** Página protegida (ou dentro de uma) ou fora da árvore viva: entra só nos totais. */
  hidden(id: string): boolean
  isProtected(id: string): boolean
  listVersions(id: string): Promise<DocumentVersion[]>
  loadDoc(id: string): Promise<unknown[] | null>
  toText(blocks: unknown[]): string
}

const idle = () => new Promise<void>(resolve => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(() => resolve(), { timeout: 500 }); else setTimeout(resolve, 16)
})

/** Limites para não pesar em espaços enormes. */
export const BACKFILL_LIMITS = { pagesWithHistory: 3000, versionsPerPage: 300 }

/**
 * Coleta e reconstrói. Só lê o histórico de versões de páginas com texto e sem proteção, as mais
 * recentes primeiro, uma página por fatia ociosa. `signal` cancela; `onProgress` informa o andamento.
 */
export async function runBackfill(source: BackfillSource, before: string, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; keyOf?: (epoch: number) => string } = {}) {
  const all = Object.values(source.pages)
  const input: BackfillPage[] = all.map(page => {
    const parent = page.parentId ? source.pages[page.parentId] : undefined
    return { id: page.id, createdAt: page.createdAt, updatedAt: page.updatedAt, named: !source.hidden(page.id), doneAt: parent?.database ? completionMoments(page, parent.database) : [] }
  })
  const byId = new Map(input.map(entry => [entry.id, entry]))
  const candidates = all.filter(page => !source.isProtected(page.id) && !page.database && (page.bodyText ?? page.text ?? '').trim())
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, BACKFILL_LIMITS.pagesWithHistory)
  let done = 0
  options.onProgress?.(0, candidates.length)
  for (const page of candidates) {
    if (options.signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    await idle()
    try {
      const listed = (await source.listVersions(page.id)).filter(v => v.reason !== 'conflict')
      const versions = listed.slice(0, BACKFILL_LIMITS.versionsPerPage)
      if (listed.length > versions.length) byId.get(page.id)!.partial = true
      const snapshots: Snapshot[] = versions.map(v => ({ savedAt: v.savedAt, text: source.toText(v.blocks), checked: countChecked(v.blocks) }))
      const current = versions.length ? await source.loadDoc(page.id) : null
      snapshots.push({ savedAt: page.updatedAt, text: current ? source.toText(current) : page.bodyText ?? page.text ?? '', checked: current ? countChecked(current) : snapshots.at(-1)?.checked ?? 0 })
      byId.get(page.id)!.snapshots = snapshots
    } catch { /* Página ilegível (ex.: bloqueada): fica só com datas. */ }
    options.onProgress?.(++done, candidates.length)
  }
  return reconstruct(input, before, options.keyOf)
}
