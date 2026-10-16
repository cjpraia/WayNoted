/** Navigation must follow the parent document commit and ownership metadata commit. */
export async function persistOwnedBlockBeforeNavigation(id: string, saveParent: () => Promise<void>, saveMeta: () => Promise<void>, open: (id: string) => void): Promise<void> {
  await saveParent()
  await saveMeta()
  open(id)
}

/** Structured clone keeps rich text, nested blocks and stable source IDs for a new page document. */
export function copyBlockForNewPage<T>(block: T): T { return structuredClone(block) }

/** The first column receives the converted block's complete subtree. */
export function columnsFromBlock<T extends { id?: string; type?: string; content?: unknown; props?: unknown; children?: unknown[] }>(block: T, count: number): { type: 'column'; children: unknown[] }[] {
  if (!Number.isInteger(count) || count < 2 || count > 5) throw new Error('Column count must be 2–5')
  return Array.from({ length: count }, (_, index) => ({ type: 'column' as const, children: [index === 0 ? { ...structuredClone(block), id: crypto.randomUUID() } : { type: 'paragraph' }] }))
}
