import type { CommentTextAnchor } from '../../types'
type TextLeaf = { node: Record<string, unknown>; key: string; from: number; to: number }
type BlockNode = { id?: string; content?: unknown; children?: unknown[] }

function textLeaves(block: BlockNode): { text: string; leaves: TextLeaf[] } {
  let text = ''
  const leaves: TextLeaf[] = []
  const walk = (value: unknown, parent?: Record<string, unknown>, key?: string) => {
    if (typeof value === 'string' && parent && key) { leaves.push({ node: parent, key, from: text.length, to: text.length + value.length }); text += value; return }
    if (Array.isArray(value)) { value.forEach(item => walk(item)); return }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    if (typeof node.text === 'string') walk(node.text, node, 'text')
    else if (node.content !== undefined) walk(node.content, node, 'content')
  }
  walk(block.content, block as Record<string, unknown>, 'content')
  return { text, leaves }
}

/** Replace text across rich runs without flattening styles or unrelated links. */
export function applySuggestionToBlocks(blocks: unknown[], original: string, replacement: string, blockId?: string, anchor?: CommentTextAnchor): unknown[] {
  if (!original) throw new Error('A sugestão não contém o texto original.')
  const copy = structuredClone(blocks) as BlockNode[], nodes: BlockNode[] = []
  const walk = (items: BlockNode[]) => { for (const block of items) { nodes.push(block); if (Array.isArray(block.children)) walk(block.children as BlockNode[]) } }
  walk(copy)
  const matches: { leaves: TextLeaf[]; from: number; to: number; replacement: string }[] = []
  if (anchor?.segments.length && anchor.segments.map(segment => segment.quote).join('\n') === original) {
    for (const [index, segment] of anchor.segments.entries()) {
      if (!segment.quote) throw new Error('O texto original mudou ou não foi encontrado.')
      const node = nodes.find(node => node.id === segment.blockId)
      if (!node) throw new Error('O texto original mudou ou não foi encontrado.')
      const { text, leaves } = textLeaves(node)
      const found: number[] = []
      for (let at = text.indexOf(segment.quote); at >= 0; at = text.indexOf(segment.quote, at + 1)) found.push(at)
      const contextual = found.filter(at => (!segment.prefix || text.slice(0, at).endsWith(segment.prefix)) && (!segment.suffix || text.slice(at + segment.quote.length).startsWith(segment.suffix)))
      const at = contextual.length === 1 ? contextual[0] : found.length === 1 ? found[0] : -1
      if (at < 0) throw new Error('O texto original mudou ou não foi encontrado.')
      matches.push({ leaves, from: at, to: at + segment.quote.length, replacement: index === 0 ? replacement : '' })
    }
  } else {
    for (const node of nodes.filter(node => !blockId || node.id === blockId)) {
      const { text, leaves } = textLeaves(node)
      for (let index = text.indexOf(original); index >= 0; index = text.indexOf(original, index + original.length)) matches.push({ leaves, from: index, to: index + original.length, replacement })
    }
    if (matches.length !== 1) throw new Error(matches.length ? 'O texto aparece várias vezes; escolha um bloco específico.' : 'O texto original mudou ou não foi encontrado.')
  }
  for (const match of matches) {
    let inserted = false
    for (const leaf of match.leaves) {
      if (leaf.to <= match.from || leaf.from >= match.to) continue
      const text = String(leaf.node[leaf.key]), from = Math.max(0, match.from - leaf.from), to = Math.min(text.length, match.to - leaf.from)
      leaf.node[leaf.key] = text.slice(0, from) + (inserted ? '' : match.replacement) + text.slice(to)
      inserted = true
    }
  }
  return copy
}
