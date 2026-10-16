/** Structural blocks and non-text inline content are never mistaken for a blank document. */
export function isEmptyPageDocument(blocks: unknown[] | null): boolean {
  return !blocks?.length || blocks.every(raw => {
    if (!raw || typeof raw !== 'object') return false
    const block = raw as { type?: string; content?: unknown; children?: unknown[]; props?: Record<string, unknown> }
    if (block.type !== 'paragraph' || block.children?.length || (block.props?.backgroundColor && block.props.backgroundColor !== 'default')) return false
    if (typeof block.content === 'string') return block.content.length === 0
    return block.content === undefined || Array.isArray(block.content) && block.content.every(inline => inline?.type === 'text' && inline.text === '')
  })
}
