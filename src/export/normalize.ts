// Forma canônica de documentos/páginas para comparar um espaço antes e depois da ida e volta.
import type { Page } from '../types'
import { isDefaultProp } from './markdown.ts'
import { mergeText, normalizeInline } from './inline.ts'
import { object, type RawBlock } from './model.ts'

/** Espaços nas pontas de um trecho formatado são invisíveis; o Markdown os deixa fora da marcação. */
function hoistWhitespace(items: ReturnType<typeof normalizeInline>): ReturnType<typeof normalizeInline> {
  return items.flatMap((item) => {
    const styles = object(item.styles) ? item.styles : {}
    if (item.type !== 'text' || styles.code || !Object.keys(styles).length) return [item]
    const text = String(item.text ?? '')
    const lead = /^\s*/.exec(text)![0], trail = /\s*$/.exec(text.slice(lead.length))![0]
    const core = text.slice(lead.length, text.length - trail.length)
    if (!core) return [{ ...item, styles: {} }]
    return [...(lead ? [{ type: 'text', text: lead, styles: {} }] : []), { ...item, text: core }, ...(trail ? [{ type: 'text', text: trail, styles: {} }] : [])]
  })
}

function inline(content: unknown): unknown[] {
  return mergeText(hoistWhitespace(normalizeInline(content)).map((item) => {
    if (item.type === 'link') return { type: 'link', href: item.href, content: inline(item.content) }
    if (item.type === 'text' || item.type === undefined) {
      const styles = Object.fromEntries(Object.entries(object(item.styles) ? item.styles : {}).filter(([key, value]) => value !== false && value !== undefined && !(key.endsWith('Color') && value === 'default')))
      return { type: 'text', text: item.text ?? '', styles }
    }
    const { id: _id, ...props } = (item.props ?? {}) as Record<string, unknown>
    return { ...item, props: Object.fromEntries(Object.entries(props).filter(([, value]) => value !== '')) }
  }) as never)
}

function props(block: RawBlock): Record<string, unknown> {
  return Object.fromEntries(Object.entries(block.props ?? {}).filter(([key, value]) => !isDefaultProp(key, value, block.type)).sort(([a], [b]) => a.localeCompare(b)))
}

function table(content: unknown): unknown {
  if (!object(content)) return content
  const rows = Array.isArray(content.rows) ? content.rows : []
  return {
    columnWidths: Array.isArray(content.columnWidths) && content.columnWidths.some((value) => value != null) ? content.columnWidths.map((value) => value ?? null) : null,
    headerRows: content.headerRows ?? null, headerCols: content.headerCols ?? null,
    rows: rows.map((row) => (object(row) && Array.isArray(row.cells) ? row.cells : []).map((cell) => object(cell) && cell.type === 'tableCell'
      ? { props: props({ props: cell.props as Record<string, unknown> }), content: inline(cell.content) }
      : { props: {}, content: inline(cell) })),
  }
}

export function normalizeBlocks(blocks: unknown): unknown[] {
  if (!Array.isArray(blocks)) return []
  return blocks.filter(object).map((raw) => {
    const block = raw as RawBlock
    const type = String(block.type ?? 'paragraph')
    const out: Record<string, unknown> = { type, props: props(block) }
    if (type === 'table') out.content = table(block.content)
    else if (type === 'codeBlock') out.content = normalizeInline(block.content).map((item) => item.text ?? '').join('')
    else if (block.content !== undefined && !(Array.isArray(block.content) && !block.content.length)) out.content = Array.isArray(block.content) || typeof block.content === 'string' ? inline(block.content) : block.content
    const children = normalizeBlocks(block.children)
    if (children.length) out.children = children
    return out
  })
}

/** Campos persistentes de uma página (sem índices derivados como `text`). */
export function normalizePage(page: Page): Record<string, unknown> {
  const { text: _t, bodyText: _b, outboundPageIds: _o, bodyOutboundPageIds: _bo, syncedBlockIds: _s, pendingTemplateBlocks: _p, removedByBlock: _r, blockConversion: _c, trashed: _tr, trashedAt: _ta, ...rest } = page
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length)).sort(([a], [b]) => a.localeCompare(b)))))
}
