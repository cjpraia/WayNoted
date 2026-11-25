import type { Page } from '../../types'

/** Legacy workspaces keep their trees and special pages. Ordinary loose pages live in the Acervo. */
export function isPrivateRoot(page: Page, hasChildren: boolean): boolean {
  if (page.parentId !== null || page.trashed) return false
  // The Acervo excludes password-protected pages, so keep an entry point in the tree.
  if (page.passwordLock) return true
  return page.sidebarPrivate ?? !!(page.database || page.canvas || hasChildren)
}

/** On workspace load, retain existing root folders even if their last child is moved later. */
export function keepLegacyPrivateRoots(pages: Record<string, Page>): Record<string, Page> {
  let result = pages
  for (const child of Object.values(pages)) {
    const parent = child.parentId ? result[child.parentId] : undefined
    if (parent?.parentId !== null || parent.sidebarPrivate !== undefined) continue
    if (result === pages) result = { ...pages }
    result[parent.id] = { ...parent, sidebarPrivate: true }
  }
  return result
}
