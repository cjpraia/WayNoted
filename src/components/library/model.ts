import type { LibraryScope, Page } from '../../types'
import type { SearchEngine } from '../../search/engine.ts'
import { normalizeText } from '../../search/normalize.ts'
import { isQueryable } from '../../query/engine.ts'
import { untypedPages } from '../../objecttypes/adjust.ts'
import { typeIndex, type TypeList } from '../../objecttypes/model.ts'

export function libraryPages(pages: Record<string, Page>, types: TypeList, scope: LibraryScope, recent: readonly string[], dailyDatabaseId?: string) {
  if (scope === 'recent') return [...new Set(recent)].filter(id => isQueryable(pages, id)).map(id => pages[id])
  const candidates = scope === 'untyped'
    ? untypedPages(pages, types, { includeEditLocked: true, includeContainers: true, excludeDatabaseIds: dailyDatabaseId ? new Set([dailyDatabaseId]) : undefined })
    : Object.values(pages)
  return candidates.filter(page => isQueryable(pages, page.id)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export function libraryTypePages(pages: Record<string, Page>, types: TypeList, typeId: string) {
  return new Set(typeIndex(pages, types).get(typeId))
}

export function indexedLibraryMatches(engine: SearchEngine, query: string, pages: Record<string, Page>) {
  if (!query.trim()) return new Set<string>()
  return new Set(engine.search(query, {
    mode: 'all', content: 'body', accept: page => isQueryable(pages, page.id),
  }).map(({ page }) => page.id))
}

export function searchLibrary(pages: readonly Page[], query: string, bodyMatches: ReadonlySet<string>, typePages?: ReadonlySet<string>) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  return pages.filter(page => {
    if (typePages && !typePages.has(page.id)) return false
    if (!words.length || bodyMatches.has(page.id)) return true
    const content = normalizeText([page.title, page.text, page.bodyText].filter(Boolean).join(' '))
    return words.every(word => content.includes(word))
  })
}
