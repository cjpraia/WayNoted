// Árvore de arquivos do pacote: pastas espelham a hierarquia das páginas.
import type { Page } from '../types'
import { isLivePage } from '../components/database/derived.ts'
import { joinPath, safeFileName, type ExportScope } from './model.ts'

export interface LayoutNode {
  page: Page
  kind: 'page' | 'database' | 'row'
  /** Arquivo da página (`.md` ou `.html`). */
  file: string
  /** Pasta onde ficam as subpáginas (para bancos: a própria pasta do banco). */
  dir: string
  /** Base dos nomes de arquivos do banco (CSV). */
  base: string
  children: LayoutNode[]
}

export interface Layout { roots: LayoutNode[]; nodes: Map<string, LayoutNode>; order: LayoutNode[] }

const RESERVED = ['assets', 'index', 'schema', "workspace-export"]

export function livePages(pages: Record<string, Page>): Page[] {
  return Object.values(pages).filter((page) => isLivePage(page.id, pages))
}

export function childrenOf(pages: Page[], parentId: string | null): Page[] {
  return pages.filter((page) => page.parentId === parentId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

export function buildLayout(pages: Record<string, Page>, scope: ExportScope, pageId: string | undefined, ext: 'md' | 'html', untitled: string, stableNames = false): Layout {
  const live = livePages(pages)
  const nodes = new Map<string, LayoutNode>()
  const order: LayoutNode[] = []
  let roots: Page[]
  if (scope === 'workspace') roots = childrenOf(live, null)
  else {
    const root = pageId ? pages[pageId] : undefined
    if (!root || !isLivePage(root.id, pages)) throw new Error('PAGE_UNAVAILABLE')
    roots = [root]
  }
  const place = (siblings: Page[], dir: string, depth: number, parent: Page | null): LayoutNode[] => {
    const used = new Set(RESERVED)
    return siblings.map((page) => {
      // Espelho contínuo: nome estável = título + id curto (renomear só muda o título; colisões não dependem da ordem).
      const plain = safeFileName(page.title, untitled), stem = stableNames ? `${plain.slice(0, 60).trim()}--${page.id.replace(/-/g, '').slice(0, 8)}` : plain
      let base = stem
      for (let n = 2; used.has(base.toLowerCase()); n++) base = `${stem} (${n})`
      used.add(base.toLowerCase())
      const kind: LayoutNode['kind'] = page.database ? 'database' : parent?.database ? 'row' : 'page'
      const node: LayoutNode = kind === 'database'
        ? { page, kind, file: joinPath(dir, base, `index.${ext}`), dir: joinPath(dir, base), base, children: [] }
        : { page, kind, file: joinPath(dir, `${base}.${ext}`), dir: joinPath(dir, base), base, children: [] }
      nodes.set(page.id, node)
      order.push(node)
      const includeChildren = scope !== 'page' || depth === 0 && !!page.database
      if (includeChildren) {
        const kids = childrenOf(live, page.id)
        if (kids.length) node.children = place(kids, node.dir, depth + 1, page)
      }
      return node
    })
  }
  const rootNodes = place(roots, '', 0, scope === 'workspace' ? null : (roots[0]?.parentId ? pages[roots[0].parentId] ?? null : null))
  return { roots: rootNodes, nodes, order }
}
