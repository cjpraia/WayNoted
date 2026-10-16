import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Lógica pura da visualização vinculada (docs/USAGE.md): quais bancos podem ser
// fonte, em que ordem aparecem no seletor "Vincular fonte de dados", o caminho (Espaço / pai / …),
// a paginação "Mostrar mais" (5 → 20 → todos) e o esquema ao trocar de fonte.
import type { DatabaseSchema, Page, View } from '../../types'
import { isLivePage } from './derived.ts'
import { normalizeText as normalizeSearch } from '../../search/normalize.ts'

type Pages = Record<string, Page>

export interface LinkableSource {
  id: string
  title: string
  icon: string | null
  /** Ancestrais, do espaço até o pai direto (sem o próprio banco). */
  path: string[]
  rowCount: number
}

/** Degraus do "Mostrar mais" (Hick/Miller): 5 itens, depois 20, depois todos. */
export const SOURCE_PAGE_STEPS = [5, 20, Infinity] as const

/** Segue `linkedSourceId` até o banco que guarda as linhas (com teto contra ciclos). */
export function resolveLinkedRoot(pages: Pages, id: string): string {
  let current = id
  for (let guard = 0; guard < 32; guard++) {
    const next = pages[current]?.database?.linkedSourceId
    if (!next || next === current) return current
    current = next
  }
  return current
}

/** Um banco "de verdade": vivo, com linhas próprias, não vinculado nem combinado, sem senha trancada no caminho. */
export function isLinkableDatabase(pages: Pages, page: Page | undefined): page is Page {
  if (!page?.database || page.trashed) return false
  if (page.database.linkedSourceId || page.database.sourceDatabaseIds?.length) return false
  if (!isLivePage(page.id, pages)) return false
  for (let id: string | null = page.id, guard = 0; id && guard < 64; id = pages[id]?.parentId ?? null, guard++) {
    const lock = pages[id]?.passwordLock
    if (lock && !(lock as { unlocked?: boolean }).unlocked) return false
  }
  return true
}

export function sourcePath(pages: Pages, id: string, workspaceName: string, untitled: string): string[] {
  const path: string[] = []
  const seen = new Set<string>([id])
  let current = pages[id]?.parentId ?? null
  while (current && !seen.has(current) && path.length < 32) {
    seen.add(current)
    path.unshift(pages[current]?.title || untitled)
    current = pages[current]?.parentId ?? null
  }
  return [workspaceName, ...path]
}

/**
 * Bancos que podem ser fonte, filtrados pela busca (nome e caminho) e ordenados:
 * usados recentemente primeiro (ordem de `recent`), depois os editados mais recentemente.
 */
export function linkableSources(pages: Pages, options: { query?: string; recent?: readonly string[]; exclude?: readonly string[]; workspaceName?: string; untitled?: string } = {}): LinkableSource[] {
  const workspace = options.workspaceName || `${PRODUCT.name}`
  const untitled = options.untitled ?? 'Sem título'
  const exclude = new Set(options.exclude ?? [])
  const recentRank = new Map((options.recent ?? []).map((id, index) => [id, index]))
  const counts = new Map<string, number>()
  for (const page of Object.values(pages)) if (page.parentId && !page.trashed) counts.set(page.parentId, (counts.get(page.parentId) ?? 0) + 1)
  const q = normalizeSearch((options.query ?? '').trim())
  const out: (LinkableSource & { rank: number; updatedAt: number })[] = []
  for (const page of Object.values(pages)) {
    if (exclude.has(page.id) || !isLinkableDatabase(pages, page)) continue
    const title = page.title || untitled
    const path = sourcePath(pages, page.id, workspace, untitled)
    if (q && !normalizeSearch(`${title} ${path.join(' ')}`).includes(q)) continue
    out.push({ id: page.id, title, icon: page.icon, path, rowCount: counts.get(page.id) ?? 0, rank: recentRank.get(page.id) ?? Infinity, updatedAt: page.updatedAt })
  }
  // Na busca, quem casa pelo nome vem antes de quem casa só pelo caminho.
  const byName = (s: LinkableSource) => (q && normalizeSearch(s.title).includes(q) ? 0 : 1)
  out.sort((a, b) => byName(a) - byName(b) || a.rank - b.rank || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title))
  return out.map(({ rank: _rank, updatedAt: _updated, ...source }) => source)
}

/** Quantos itens mostrar no degrau `step` (0, 1, 2…). */
export function visibleSourceCount(step: number, total: number): number {
  const limit = SOURCE_PAGE_STEPS[Math.min(step, SOURCE_PAGE_STEPS.length - 1)]
  return Math.min(limit, total)
}

/** Visualização inicial de uma visualização vinculada (tabela, sem filtros). */
export function freshLinkedView(name: string, id: string = crypto.randomUUID()): View {
  return { id, name, type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
}

/** Esquema de uma visualização vinculada nova (propriedades vivem na fonte). */
export function linkedSchema(sourceId: string, view: View): DatabaseSchema {
  return { properties: [], views: [view], activeViewId: view.id, linkedSourceId: sourceId }
}

/**
 * Trocar a fonte: as visualizações antigas apontam para propriedades da fonte anterior, então
 * recomeçam com uma tabela limpa (como no Export Bundle). O ⌘Z devolve o esquema anterior inteiro.
 */
export function relinkedSchema(current: DatabaseSchema, sourceId: string, viewName: string): DatabaseSchema {
  const view = freshLinkedView(viewName)
  return { ...current, properties: [], views: [view], activeViewId: view.id, linkedSourceId: sourceId, sourceDatabaseIds: undefined }
}

/**
 * "Visualizações em <fonte>": copia a configuração de uma visualização da fonte para esta visualização
 * vinculada e guarda a origem (`sourceViewId`). Se já existe uma aba com essa origem, devolve-a (não duplica).
 */
export function adoptSourceView(current: DatabaseSchema, sourceView: View): { schema: DatabaseSchema; viewId: string; added: boolean } {
  const existing = current.views.find((view) => view.sourceViewId === sourceView.id)
  if (existing) return { schema: { ...current, activeViewId: existing.id }, viewId: existing.id, added: false }
  const view: View = { ...structuredClone(sourceView), id: crypto.randomUUID(), sourceViewId: sourceView.id }
  return { schema: { ...current, views: [...current.views, view], activeViewId: view.id }, viewId: view.id, added: true }
}

/** Bloco "Visualização vinculada" recém-inserido pelo menu `/`: abre o seletor sozinho uma vez. */
const autoOpen = new Set<string>()
export function requestLinkPickerAutoOpen(blockId: string) { autoOpen.add(blockId) }
export function consumeLinkPickerAutoOpen(blockId: string): boolean { return autoOpen.delete(blockId) }

/** Avisos dispensáveis da primeira vez: dica do painel "Nova visualização" e edição de propriedade compartilhada. */
export const LINKED_TIP_KEY = "workspace.linkedViewTip.v2"
export const LINKED_SCHEMA_NOTICE_KEY = "workspace.linkedSchemaNotice.v1"
export function linkedTipSeen(key: string = LINKED_TIP_KEY, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try { return storage?.getItem(key) === '1' } catch { return true }
}
export function markLinkedTipSeen(key: string = LINKED_TIP_KEY, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(key, '1') } catch { /* sem armazenamento: o aviso só não fica lembrado */ }
}
