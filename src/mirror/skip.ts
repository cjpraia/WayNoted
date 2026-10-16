// "Não espelhar" (D1): a marca `mirrorSkip` vale para a página e todas as subpáginas (mesma regra de "Privado para IA").
import type { Page } from '../types'

/** Id da página (ela mesma ou um ancestral) que tem "Não espelhar", ou null. */
export function mirrorSkipSource(pages: Record<string, Page>, id: string): string | null {
  const seen = new Set<string>()
  let page: Page | undefined = pages[id]
  while (page && !seen.has(page.id)) {
    if (page.mirrorSkip) return page.id
    seen.add(page.id)
    page = page.parentId ? pages[page.parentId] : undefined
  }
  return null
}
