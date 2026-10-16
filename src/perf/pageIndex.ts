// Índice "filhos por pai" com cache por versão do objeto `pages` da store (imutável: cada mudança
// gera um novo objeto). Atualização incremental: só as listas dos pais afetados são recriadas, então
// as linhas de um banco não alterado mantêm a mesma identidade de array (memoização barata adiante).
// Sem dependências da store — testado em tests/perf-index.test.mts.
import type { Page } from '../types'

type Pages = Record<string, Page>
type Key = string | null

export interface PageIndex {
  pages: Pages
  size: number
  /** Filhos (inclusive na lixeira) por pai, ordenados por `order`. Não mutar. */
  all: Map<Key, Page[]>
  /** Cache preguiçoso dos filhos fora da lixeira. */
  live: Map<Key, Page[]>
  /** Cache preguiçoso de `isLive` (página e ancestrais fora da lixeira). */
  alive: Map<string, boolean>
}

const EMPTY: Page[] = []
const byOrder = (a: Page, b: Page) => a.order - b.order
let last: PageIndex | null = null
/** Acima disso a reconstrução completa é mais barata que o patch. */
const PATCH_LIMIT = 2000

function build(pages: Pages): PageIndex {
  const all = new Map<Key, Page[]>()
  let size = 0
  for (const id in pages) {
    const page = pages[id]
    size++
    const list = all.get(page.parentId)
    if (list) list.push(page)
    else all.set(page.parentId, [page])
  }
  for (const list of all.values()) list.sort(byOrder)
  return { pages, size, all, live: new Map(), alive: new Map() }
}

/** Posição de inserção estável (depois dos iguais) por `order`. */
function insertAt(list: Page[], page: Page) {
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid].order <= page.order) lo = mid + 1; else hi = mid }
  list.splice(lo, 0, page)
}

function patch(prev: PageIndex, pages: Pages): PageIndex | null {
  const changed: string[] = []
  let size = 0, added = 0
  for (const id in pages) {
    size++
    const before = prev.pages[id]
    if (before !== pages[id]) {
      if (!before) added++
      changed.push(id)
      if (changed.length > PATCH_LIMIT) return null
    }
  }
  // Exclusão definitiva (rara): reconstrói.
  if (prev.size + added !== size) return null
  if (!changed.length) return { ...prev, pages }
  const all = new Map(prev.all), copied = new Set<Key>()
  const own = (key: Key) => {
    if (!copied.has(key)) { copied.add(key); all.set(key, [...(all.get(key) ?? EMPTY)]) }
    return all.get(key)!
  }
  for (const id of changed) {
    const before = prev.pages[id], after = pages[id]
    if (before && before.parentId === after.parentId && before.order === after.order) {
      const list = own(after.parentId), i = list.indexOf(before)
      if (i >= 0) { list[i] = after; continue }
    }
    if (before) {
      const list = own(before.parentId), i = list.indexOf(before)
      if (i >= 0) list.splice(i, 1)
    }
    insertAt(own(after.parentId), after)
  }
  const live = new Map(prev.live)
  for (const key of copied) live.delete(key)
  // Lixeira/pai mudaram: `alive` depende de ancestrais, recalcula preguiçosamente.
  return { pages, size, all, live, alive: new Map() }
}

/** Índice para este objeto `pages` (incremental a partir do último, quando possível). */
export function pageIndex(pages: Pages): PageIndex {
  if (last?.pages === pages) return last
  last = (last && patch(last, pages)) ?? build(pages)
  return last
}

/** Filhos fora da lixeira, em ordem. Array compartilhado (não mutar). */
export function liveChildren(pages: Pages, parentId: Key): Page[] {
  const index = pageIndex(pages)
  let list = index.live.get(parentId)
  if (!list) {
    const all = index.all.get(parentId) ?? EMPTY
    list = all.some((p) => p.trashed) ? all.filter((p) => !p.trashed) : all
    index.live.set(parentId, list)
  }
  return list
}

/** Todos os filhos diretos (inclusive na lixeira), em ordem. Não mutar. */
export function allChildren(pages: Pages, parentId: Key): Page[] {
  return pageIndex(pages).all.get(parentId) ?? EMPTY
}

/** Página e ancestrais existem e nenhum está na lixeira (memoizado por versão). */
export function isLiveIndexed(pages: Pages, id: string | null): boolean {
  if (!id) return false
  const index = pageIndex(pages), memo = index.alive
  const known = memo.get(id)
  if (known !== undefined) return known
  const path: string[] = []
  const seen = new Set<string>()
  let cur: Page | undefined = pages[id], result = true
  while (cur) {
    const cached = memo.get(cur.id)
    if (cached !== undefined) { result = cached; break }
    if (cur.trashed || seen.has(cur.id)) { result = false; path.push(cur.id); break }
    seen.add(cur.id); path.push(cur.id)
    if (cur.parentId && !pages[cur.parentId]) { result = false; break }
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  if (!pages[id]) result = false
  for (const key of path) memo.set(key, result)
  return result
}

/** Descendentes (todas as profundidades, inclusive na lixeira) usando o índice. */
export function descendantIds(pages: Pages, id: string): string[] {
  const out: string[] = [], visited = new Set([id]), stack = [id]
  while (stack.length) {
    const pid = stack.pop()!
    if (pid !== id) out.push(pid)
    const children = allChildren(pages, pid)
    // Pré-ordem (como a versão recursiva anterior): empilha ao contrário.
    for (let i = children.length - 1; i >= 0; i--) if (!visited.has(children[i].id)) { visited.add(children[i].id); stack.push(children[i].id) }
  }
  return out
}
