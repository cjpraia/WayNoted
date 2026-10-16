type TextNode = { type?: string; text?: string; content?: unknown }
type BlockNode = { id?: string; content?: unknown; children?: unknown[] }

function countIn(value: unknown, query: string): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countIn(item, query), 0)
  if (!value || typeof value !== 'object') return 0
  const item = value as TextNode
  if (typeof item.text === 'string') return item.text.toLocaleLowerCase().split(query.toLocaleLowerCase()).length - 1
  return countIn(item.content, query)
}

export function findInBlocks(blocks: unknown[], query: string): { blockId: string; count: number }[] {
  if (!query) return []
  const out: { blockId: string; count: number }[] = []
  const walk = (items: unknown[]) => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as BlockNode
      const count = countIn(block.content, query)
      if (count && block.id) out.push({ blockId: block.id, count })
      if (Array.isArray(block.children)) walk(block.children)
    }
  }
  walk(blocks)
  return out
}

function replaceIn(value: unknown, query: string, replacement: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceIn(item, query, replacement))
  if (!value || typeof value !== 'object') return value
  const item = value as TextNode
  if (typeof item.text === 'string') {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { ...item, text: item.text.replace(new RegExp(escaped, 'giu'), () => replacement) }
  }
  if (item.content !== undefined) return { ...item, content: replaceIn(item.content, query, replacement) }
  return value
}

export function replaceBlockText(content: unknown, query: string, replacement: string): unknown {
  return query ? replaceIn(content, query, replacement) : content
}
