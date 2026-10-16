// Pure helpers for password-protected pages (no React; used by sidebar, search and exports).
import type { Page } from '../types'

/** Protected and not unlocked in this session. */
export function isLockedPage(page: Page | undefined | null): boolean { return !!page?.passwordLock && !page.passwordLock.unlocked }
export function isProtectedPage(page: Page | undefined | null): boolean { return !!page?.passwordLock }
/** Title shown in lists: hidden titles become a neutral label while locked. */
export function protectedTitle(page: Page, lockedLabel: string): string | null {
  if (!page.passwordLock) return null
  if (page.passwordLock.hideTitle && !page.passwordLock.unlocked) return lockedLabel
  return null
}
/** Pages that may be exported/previewed: locked protected pages and everything under them are removed. */
export function withoutLockedPages(pages: Record<string, Page>): Record<string, Page> {
  if (!Object.values(pages).some(isLockedPage)) return pages
  const blocked = (page: Page | undefined, seen = new Set<string>()): boolean => {
    while (page && !seen.has(page.id)) {
      if (isLockedPage(page)) return true
      seen.add(page.id); page = page.parentId ? pages[page.parentId] : undefined
    }
    return false
  }
  return Object.fromEntries(Object.entries(pages).filter(([, page]) => !blocked(page)))
}
/** Whether two routes stay inside the same protected tree (avoids relocking while moving inside it). */
export function sameProtectedTree(a: Page | undefined, rootId: string): boolean { return a?.passwordLock?.rootId === rootId }
/** The page itself or the nearest ancestor that is password protected and locked in this session. */
export function lockedAncestor(pages: Record<string, Page>, id: string | null | undefined): Page | null {
  const seen = new Set<string>()
  let page = id ? pages[id] : undefined
  while (page && !seen.has(page.id)) {
    if (isLockedPage(page)) return page
    seen.add(page.id); page = page.parentId ? pages[page.parentId] : undefined
  }
  return null
}
/** Nearest protected (locked or unlocked) page in the chain starting at `id`. */
export function protectedAncestor(pages: Record<string, Page>, id: string | null | undefined): Page | null {
  const seen = new Set<string>()
  let page = id ? pages[id] : undefined
  while (page && !seen.has(page.id)) {
    if (page.passwordLock) return page
    seen.add(page.id); page = page.parentId ? pages[page.parentId] : undefined
  }
  return null
}
/** Live descendants of a protected page that have no lock of their own (repair candidates). */
export function unprotectedDescendants(pages: Record<string, Page>, id: string): Page[] {
  const out: Page[] = [], seen = new Set([id])
  const walk = (parentId: string) => { for (const page of Object.values(pages)) if (page.parentId === parentId && !seen.has(page.id) && !page.trashed) { seen.add(page.id); if (!page.passwordLock) out.push(page); walk(page.id) } }
  walk(id)
  return out
}
/** Confirmation used by the store (replaceable in tests). */
export const lockPrompts = {
  confirm: (text: string): boolean => typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true,
}
