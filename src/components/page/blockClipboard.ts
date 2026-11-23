import { blocksToText } from './util.ts'
import type { PageEditorType } from './schema'

export const BLOCKNOTE_CLIPBOARD = 'blocknote/html'

type EditorBlock = NonNullable<ReturnType<PageEditorType['getBlock']>>
type ClipboardFormats = { internal: string; html: string; text: string; limited: boolean }

const portableBlocks = new Set([
  'paragraph', 'heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem',
  'toggleListItem', 'table', 'divider', 'codeBlock', 'callout', 'columnList', 'column', 'equation',
])

function inlineText(value: unknown): string {
  if (Array.isArray(value)) return value.map(inlineText).join('')
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const item = value as { type?: string; content?: unknown; text?: string; props?: { latex?: string; date?: string } }
  return item.text ?? item.props?.latex ?? item.props?.date ?? inlineText(item.content)
}

function tsvCell(text: string): string {
  return /[\t\r\n"]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}

/** Live/owned blocks cannot be recreated safely from the clipboard. Copy a readable snapshot. */
export function blockClipboardFormats(editor: Pick<PageEditorType, 'blocksToFullHTML' | 'blocksToHTMLLossy'>, source: EditorBlock, unsupportedLabel: string): ClipboardFormats {
  let limited = false
  const lines: string[] = []
  const snapshotInline = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(snapshotInline)
    if (!value || typeof value !== 'object') return value
    const node = value as { type?: string; content?: unknown; rows?: { cells: unknown[] }[] }
    if (node.type === 'dateMention' || node.type === 'inlineEquation') {
      limited = true
      return { type: 'text', text: inlineText(node), styles: {} }
    }
    if (node.type === 'tableContent') return { ...node, rows: node.rows?.map(row => ({ ...row, cells: row.cells.map(snapshotInline) })) }
    return node.content === undefined ? value : { ...node, content: snapshotInline(node.content) }
  }
  const visit = (block: EditorBlock, depth = 0): EditorBlock => {
    let result = block
    if (!portableBlocks.has(block.type)) {
      limited = true
      const props = block.props as Record<string, unknown>
      const label = [props.title, props.label, props.name, props.caption, props.url, props.latex].filter((value): value is string => typeof value === 'string' && value.length > 0 && !/^(?:data|blob|file):/i.test(value))
      const fallback = blocksToText([{ ...block, props: { ...props, url: undefined }, children: [] }]).trim()
      const content = [...new Set([...label, fallback].filter(Boolean))].join('\n') || '[' + unsupportedLabel + ': ' + block.type + ']'
      result = { id: block.id, type: 'paragraph', props: {}, content: [{ type: 'text', text: content, styles: {} }], children: [] } as unknown as EditorBlock
    }

    if (result.type === 'table') {
      for (const row of result.content.rows) lines.push(row.cells.map(cell => tsvCell(inlineText(cell))).join('\t'))
    } else if (result.type === 'equation') {
      lines.push(result.props.latex)
    } else if (result.type === 'divider') {
      lines.push('---')
    } else {
      const line = inlineText(result.content)
      if (line) lines.push('  '.repeat(depth) + line)
    }
    return { ...result, content: snapshotInline(result.content), children: block.children.map((child) => visit(child, depth + 1)) } as EditorBlock
  }

  const blocks = [visit(source)]
  return {
    // Pass new IDs to the serializers so pasted copies never carry source IDs.
    internal: editor.blocksToFullHTML(blocks.map(freshBlockIds)),
    html: editor.blocksToHTMLLossy(blocks),
    text: lines.join('\n'),
    limited,
  }
}

function freshBlockIds(block: EditorBlock): EditorBlock {
  return { ...block, id: globalThis.crypto.randomUUID(), children: block.children.map(freshBlockIds) }
}

/** Use the same clipboard MIME types as copying a selection in BlockNote. */
export async function writeBlockClipboard(formats: ClipboardFormats): Promise<boolean> {
  let standardWritten = false
  let internalWritten = false
  const copy = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    event.stopImmediatePropagation()
    data.setData('text/html', formats.html)
    data.setData('text/plain', formats.text)
    standardWritten = true
    try {
      data.setData(BLOCKNOTE_CLIPBOARD, formats.internal)
      internalWritten = true
    } catch { /* Browser does not accept custom clipboard formats. */ }
  }
  document.addEventListener('copy', copy, true)
  try {
    // Synchronous inside the menu action, while the user gesture is active.
    if (document.execCommand?.('copy') && standardWritten) return internalWritten
  } finally {
    document.removeEventListener('copy', copy, true)
  }

  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([formats.html], { type: 'text/html' }),
    'text/plain': new Blob([formats.text], { type: 'text/plain' }),
  })])
  return false
}
