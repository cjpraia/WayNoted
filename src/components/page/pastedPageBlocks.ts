// Colar blocos de página/banco: recortar+colar move o mesmo banco; copiar+colar
// (o original continua no documento) duplica o banco/subpágina possuído, como
// a ação "Duplicar" do menu do bloco. Vínculos ("linked") continuam vínculos.
export interface PageRefBlock { id: string; type: string; props?: Record<string, unknown>; children?: PageRefBlock[] }

function walk(blocks: readonly PageRefBlock[], visit: (block: PageRefBlock) => void) {
  for (const block of blocks) { visit(block); if (Array.isArray(block.children)) walk(block.children, visit) }
}

/** Blocos `page` novos no documento que apontam para uma página ainda referenciada por um bloco que já existia. */
export function copiedPageBlocks(before: readonly PageRefBlock[], after: readonly PageRefBlock[]): PageRefBlock[] {
  const previousIds = new Set<string>()
  walk(before, (block) => previousIds.add(block.id))
  const survivors = new Set<string>()
  walk(after, (block) => {
    const pageId = block.props?.pageId
    if (block.type === 'page' && typeof pageId === 'string' && pageId && previousIds.has(block.id)) survivors.add(pageId)
  })
  const copies: PageRefBlock[] = []
  walk(after, (block) => {
    const pageId = block.props?.pageId
    if (block.type === 'page' && typeof pageId === 'string' && survivors.has(pageId) && !previousIds.has(block.id) && block.props?.ownership !== 'linked') copies.push(block)
  })
  return copies
}
