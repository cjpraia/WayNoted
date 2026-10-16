import { localPageLink } from './links.ts'

/** Locate the first block that actually links to a page, including nested blocks. */
export function firstLinkingBlock(blocks: unknown[], targetPageId: string): string | undefined {
  const containsLink = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(containsLink)
    const item = value as { href?: string; content?: unknown }
    return (typeof item.href === 'string' && localPageLink.exec(item.href)?.[1]?.toLowerCase() === targetPageId.toLowerCase()) || containsLink(item.content)
  }
  const walk = (items: unknown[]): string | undefined => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as { id?: string; type?: string; props?: { pageId?: string }; content?: unknown; children?: unknown[] }
      if (block.id && ((block.type === 'page' && block.props?.pageId?.toLowerCase() === targetPageId.toLowerCase()) || containsLink(block.content))) return block.id
      if (Array.isArray(block.children)) { const found = walk(block.children); if (found) return found }
    }
  }
  return walk(blocks)
}
