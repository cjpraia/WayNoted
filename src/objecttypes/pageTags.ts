import type { Page } from '../types'
import { fold, type TypeList } from './model.ts'
import { isQueryable } from '../query/engine.ts'

export function tagTypeIds(types: TypeList): Set<string> {
  return new Set(types.filter(type => ['tag', 'tags'].includes(fold(type.name))).map(type => type.id))
}

export function linkedTagPages(page: Page, pages: Record<string, Page>): Page[] {
  return (page.tagPageIds ?? []).filter(id => isQueryable(pages, id)).map(id => pages[id])
}

const tagIndex = new WeakMap<Record<string, Page>, Map<string, Page[]>>()
const NO_PAGES: Page[] = []

export function pagesTaggedWith(tagId: string, pages: Record<string, Page>): Page[] {
  if (!isQueryable(pages, tagId)) return NO_PAGES
  let index = tagIndex.get(pages)
  if (!index) {
    index = new Map()
    for (const page of Object.values(pages)) {
      if (!page.tagPageIds?.length || !isQueryable(pages, page.id)) continue
      for (const id of page.tagPageIds) {
        const linked = index.get(id)
        if (linked) linked.push(page)
        else index.set(id, [page])
      }
    }
    for (const related of index.values()) related.sort((a, b) => b.updatedAt - a.updatedAt)
    tagIndex.set(pages, index)
  }
  return index.get(tagId) ?? NO_PAGES
}
