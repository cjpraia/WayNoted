import type { Node as PMNode } from '@tiptap/pm/model'
import type { CommentTextAnchor } from '../../types'

type TextBlock = { id: string; start: number; text: string; size: number }
function textBlocks(doc: PMNode): TextBlock[] {
  const blocks: TextBlock[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer' || !node.attrs.id || !node.firstChild?.inlineContent) return
    const content = node.firstChild
    blocks.push({ id: String(node.attrs.id), start: pos + 2, text: content.textBetween(0, content.content.size, '\n', '\uFFFC'), size: content.content.size })
  })
  return blocks
}

export function captureTextAnchor(doc: PMNode, from: number, to: number): CommentTextAnchor | null {
  if (from === to) return null
  const segments = textBlocks(doc).flatMap(block => {
    const start = Math.max(0, from - block.start), end = Math.min(block.size, to - block.start)
    if (start >= end) return []
    return [{ blockId: block.id, from: start, to: end, quote: block.text.slice(start, end), prefix: block.text.slice(Math.max(0, start - 32), start), suffix: block.text.slice(end, end + 32) }]
  }).filter(segment => segment.quote)
  return segments.length ? { segments } : null
}

/** Slash commands usually leave a collapsed cursor; anchor the current text block. */
export function captureBlockTextAnchor(doc: PMNode, blockId: string): CommentTextAnchor | null {
  const block = textBlocks(doc).find((item) => item.id === blockId)
  return block && block.size ? captureTextAnchor(doc, block.start, block.start + block.size) : null
}

/** Resolve relative offsets first, then relocate the quoted text after nearby edits. */
export function resolveTextAnchor(doc: PMNode, anchor: CommentTextAnchor): { from: number; to: number } | null {
  const blocks = textBlocks(doc), positions: { from: number; to: number }[] = []
  for (const segment of anchor.segments) {
    const block = blocks.find(block => block.id === segment.blockId)
    if (!block || !segment.quote) return null
    const candidates: number[] = []
    let index = block.text.indexOf(segment.quote)
    while (index >= 0) { candidates.push(index); index = block.text.indexOf(segment.quote, index + 1) }
    const contextual = candidates.filter(index => (!segment.prefix || block.text.slice(0, index).endsWith(segment.prefix)) && (!segment.suffix || block.text.slice(index + segment.quote.length).startsWith(segment.suffix)))
    const found = contextual.length === 1 ? contextual[0] : candidates.length === 1 ? candidates[0] : contextual.includes(segment.from) ? segment.from : -1
    if (found < 0) return null
    positions.push({ from: block.start + found, to: block.start + found + segment.quote.length })
  }
  if (!positions.length || positions.some((position, index) => index > 0 && position.from < positions[index - 1].to)) return null
  return { from: positions[0].from, to: positions.at(-1)!.to }
}
