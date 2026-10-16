import type { Page } from '../../types.ts'
import { normalizeText } from '../../search/normalize.ts'
import { SearchEngine, parseQuery, propertySegments, type SearchHit } from '../../search/engine.ts'
import { findTypeByName, hasType } from '../../objecttypes/model.ts'
import { registeredTypes } from '../../objecttypes/registry.ts'
export type { SearchHit } from '../../search/engine.ts'

export interface SearchFilters {
  kind: 'all' | 'page' | 'database' | 'row'
  favorites: boolean
  updated: 'all' | 'day' | 'week' | 'month'
  scope: string
  sort: 'relevance' | 'updated' | 'title'
  content?: 'all' | 'title' | 'body' | 'properties' | 'comments'
  match?: 'all' | 'any' | 'exact'
  dateField?: 'updated' | 'created'
  after?: string
  before?: string
  propertyName?: string
  author?: string
  /** Inclui páginas da lixeira (sempre depois das vivas). */
  includeTrash?: boolean
}
export const defaultSearchFilters: SearchFilters = { kind: 'all', favorites: false, updated: 'all', scope: '', sort: 'relevance', content: 'all', match: 'all', dateField: 'updated', after: '', before: '', propertyName: '', author: '', includeTrash: false }
/** Mantido por compatibilidade; use `normalizeText` de src/search/normalize.ts. */
export const normalizeSearch = normalizeText

/** Parent traversal rejects trashed ancestors and malformed cycles. Never mutates metadata. */
export function ancestry(id: string, pages: Record<string, Page>): string[] | null {
  const chain: string[] = []
  let page: Page | undefined = pages[id]
  while (page) {
    if (page.trashed || chain.includes(page.id)) return null
    chain.push(page.id)
    page = page.parentId ? pages[page.parentId] : undefined
  }
  return chain
}

export function propertySearchText(page: Page, pages: Record<string, Page>, propertyName = ''): string {
  const wanted = normalizeText(propertyName)
  return propertySegments(page, pages).filter(segment => !wanted || normalizeText(segment.propertyName ?? '') === wanted).map(segment => `${segment.propertyName} ${segment.text}`).join('\n')
}

/** Índice compartilhado da janela; sincroniza por identidade das páginas a cada consulta. */
export const searchEngine = new SearchEngine()

/**
 * Password-protected pages (src/security): only their title is searchable, never properties or
 * comments; locked pages with a hidden title are left out entirely. Memoized per pages object.
 */
const searchableCache = new WeakMap<object, Record<string, Page>>()
export function searchablePages(pages: Record<string, Page>): Record<string, Page> {
  const cached = searchableCache.get(pages)
  if (cached) return cached
  let result = pages
  for (const page of Object.values(pages)) {
    if (!page.passwordLock) continue
    if (result === pages) result = { ...pages }
    if (page.passwordLock.hideTitle && !page.passwordLock.unlocked) delete result[page.id]
    else result[page.id] = { ...page, text: '', bodyText: '', props: {}, typeProps: {}, comments: [] }
  }
  searchableCache.set(pages, result)
  return result
}

export interface SearchContext { /** Teto de resultados quando a consulta é vazia (a interface mostra 100 e "100+"). */ limit?: number; now?: number; recent?: string[]; visits?: Record<string, number> }

function acceptFor(pages: Record<string, Page>, filters: SearchFilters, now: number) {
  const days = { all: Infinity, day: 1, week: 7, month: 30 }[filters.updated]
  const after = filters.after ? new Date(filters.after + 'T00:00:00').getTime() : -Infinity
  const before = filters.before ? new Date(filters.before + 'T23:59:59.999').getTime() : Infinity
  const author = filters.author ? normalizeText(filters.author) : ''
  return (page: Page) => {
    if (filters.scope) {
      let current: Page | undefined = page, inside = false
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) { if (current.id === filters.scope) { inside = true; break } seen.add(current.id); current = current.parentId ? pages[current.parentId] : undefined }
      if (!inside) return false
    }
    if (filters.favorites && !page.favorite) return false
    if (filters.kind === 'database' && !page.database) return false
    if (filters.kind === 'page' && page.database) return false
    if (filters.kind === 'row' && !(page.parentId && pages[page.parentId]?.database)) return false
    const timestamp = filters.dateField === 'created' ? page.createdAt : page.updatedAt
    if (now - timestamp > days * 86400000) return false
    if (timestamp < after || timestamp > before) return false
    if (author) {
      const attributed = page as Page & { createdBy?: string; updatedBy?: string }
      if (!normalizeText(`${attributed.createdBy || ''} ${attributed.updatedBy || ''}`).includes(author)) return false
    }
    return true
  }
}

/** Filtro de tipo de objeto na consulta: `tipo:Livro`, `type:Book`, `tipo:"Nome com espaço"`. */
export function parseTypeFilter(query: string): { query: string; types: string[] } {
  const types: string[] = []
  const rest = query.replace(/(^|\s)(?:tipo|type):(?:"([^"]+)"|(\S+))/gi, (_m, lead: string, quoted?: string, plain?: string) => { types.push((quoted ?? plain ?? '').trim()); return lead })
  return { query: rest.replace(/\s+/g, ' ').trim(), types: types.filter(Boolean) }
}

/** Busca completa: resultados pontuados (ver ranking em src/search/engine.ts). */
export function searchWorkspace(pages: Record<string, Page>, query: string, filters: SearchFilters, context: SearchContext = {}): SearchHit[] {
  const now = context.now ?? Date.now()
  pages = searchablePages(pages)
  searchEngine.sync(pages)
  const typed = parseTypeFilter(query)
  let accept = acceptFor(pages, filters, now)
  if (typed.types.length) {
    const types = registeredTypes()
    const wanted = typed.types.map(name => findTypeByName(types, name)?.id ?? null)
    const base = accept
    // Tipo desconhecido: nenhum resultado (em vez de ignorar o filtro em silêncio).
    accept = (page: Page) => wanted.every(id => id !== null && hasType(types, page, id)) && base(page)
    query = typed.query
  }
  const emptyQuery = !parseQuery(typed.query, filters.match).flat && !/(^|\s)-\S/.test(typed.query)
  const hits = searchEngine.search(query, { limit: emptyQuery && filters.sort !== 'title' && !filters.includeTrash ? (context.limit ?? undefined) : undefined, mode: filters.match, content: filters.content, propertyName: filters.propertyName, includeTrash: filters.includeTrash, now, recent: context.recent, visits: context.visits, accept })
  const empty = !parseQuery(query, filters.match).flat && !/(^|\s)-\S/.test(query)
  if (filters.sort === 'title') hits.sort((a, b) => Number(a.trashed) - Number(b.trashed) || a.page.title.localeCompare(b.page.title, 'pt-BR') || a.page.id.localeCompare(b.page.id))
  else if (filters.sort === 'updated' || empty) hits.sort((a, b) => Number(a.trashed) - Number(b.trashed) || b.page.updatedAt - a.page.updatedAt || a.page.id.localeCompare(b.page.id))
  return hits
}

export function searchPages(pages: Record<string, Page>, query: string, filters: SearchFilters, now = Date.now()): Page[] {
  return searchWorkspace(pages, query, filters, { now }).map(hit => hit.page)
}

export function moveDestinations(pages: Record<string, Page>, pageId: string, query = ''): Page[] {
  const q = normalizeSearch(query)
  return Object.values(pages).filter(page => {
    const chain = ancestry(page.id, pages)
    // Password-protected pages that are locked (or under one) cannot receive pages.
    return chain && !chain.includes(pageId) && (!page.locked || !!page.database) && !chain.some(id => pages[id]?.passwordLock && !pages[id].passwordLock!.unlocked) && normalizeSearch(page.title).includes(q)
  }).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
}
