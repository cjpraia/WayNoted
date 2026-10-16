// "Privado para IA" (A1): a marca `aiPrivate` vale para a página e todas as subpáginas. A decisão final de
// esconder dos agentes e do envio a provedores em nuvem é do processo principal (electron/agent-privacy.cjs);
// aqui só a leitura para a interface (menu da página).
import type { Page } from '../types.ts'

/** Id da página que define a privacidade (a própria ou o ancestral mais próximo marcado); null se não for privada. */
export function aiPrivateSource(pages: Record<string, Page>, id: string): string | null {
  const seen = new Set<string>()
  let page: Page | undefined = pages[id]
  while (page && !seen.has(page.id)) {
    if (page.aiPrivate) return page.id
    seen.add(page.id)
    page = page.parentId ? pages[page.parentId] : undefined
  }
  return null
}
export const isAiPrivate = (pages: Record<string, Page>, id: string) => aiPrivateSource(pages, id) !== null
