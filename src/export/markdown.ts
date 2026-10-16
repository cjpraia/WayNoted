// Blocos BlockNote → Markdown fiel. Blocos sem equivalente ganham uma forma legível e
// um comentário HTML invisível (`<!-- np:… -->`) que permite a reimportação sem perda.
import { inlineToMarkdown, inlinePlain, normalizeInline, type InlineWriteContext } from './inline.ts'
import { object, type RawBlock } from './model.ts'
import type { QueryExport } from '../query/exportResult.ts'

export interface BlockWriteContext extends InlineWriteContext {
  /** Destino de uma imagem/arquivo (data-URL → caminho em assets/). */
  media(url: string, name: string): string
  /** Troca data-URLs dentro de JSON por referências `asset:`. */
  json<T>(value: T): T
  pageLink(pageId: string): { label: string; destination: string }
  synced(id: string): unknown[] | undefined
  /** Ids de blocos citados por links/comentários; esses ids são preservados. */
  keepIds: Set<string>
  /** Blocos sincronizados sendo escritos (evita recursão). */
  activeSynced?: Set<string>
  /** Resultado atual de um bloco de consulta (src/query/exportResult.ts). */
  queryResult?(props: Record<string, unknown>): QueryExport | null
}

/** Props com estes valores são o padrão do editor e não precisam ser gravados. */
export const DEFAULT_PROPS: Record<string, unknown> = {
  textColor: 'default', backgroundColor: 'default', textAlignment: 'left', isToggleable: false, checked: false,
  showPreview: true, caption: '', colspan: 1, rowspan: 1, width: 1,
}
const NATIVE_KEYS: Record<string, string[]> = {
  heading: ['level'], checkListItem: ['checked'], codeBlock: ['language'], callout: ['icon'], image: ['url', 'name'], equation: ['latex'],
}
const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])
const NATIVE_TYPES = new Set(['paragraph', 'heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'codeBlock', 'table', 'image', 'divider', 'callout', 'equation', 'columnList', 'column'])

export function isDefaultProp(key: string, value: unknown, type?: string): boolean {
  if (value === undefined || value === null) return true
  if (key === 'language' && type === 'codeBlock') return value === '' || value === 'text'
  if (key === 'name' && (type === 'image' || type === 'video' || type === 'audio' || type === 'file')) return value === ''
  if (key === 'url' && type === 'image') return value === ''
  return key in DEFAULT_PROPS && DEFAULT_PROPS[key] === value
}

function extraProps(block: RawBlock, skip: string[] = []): Record<string, unknown> {
  const type = String(block.type ?? 'paragraph')
  const native = NATIVE_KEYS[type] ?? []
  return Object.fromEntries(Object.entries(block.props ?? {}).filter(([key, value]) => !native.includes(key) && !skip.includes(key) && !isDefaultProp(key, value, type)))
}

function comment(kind: string, value?: unknown): string {
  const json = value === undefined ? '' : ' ' + JSON.stringify(value).replace(/--/g, '\\u002d\\u002d')
  return `<!-- np:${kind}${json} -->`
}

function attrsLine(block: RawBlock, ctx: BlockWriteContext, skip: string[] = []): string[] {
  const extra = extraProps(block, skip)
  if (block.id && ctx.keepIds.has(block.id)) extra.id = block.id
  return Object.keys(extra).length ? [comment('attrs', ctx.json(extra))] : []
}

function escapeLineStart(line: string): string {
  if (/^(#{1,6}(\s|$)|>|[-+](\s|$)|=+\s*$|\d+[.)](\s|$)|\||\$\$|```|~~~|<!--|<details|<\/details|<summary|---\s*$)/.test(line)) {
    const digits = /^\d+/.exec(line)
    return digits ? `${digits[0]}\\${line.slice(digits[0].length)}` : `\\${line}`
  }
  return line
}

function indent(lines: string[], width: number): string[] {
  const pad = ' '.repeat(width)
  return lines.map((line) => (line ? pad + line : line))
}

/** Espaços nas pontas viram entidades: no Markdown eles seriam indentação ou sumiriam. */
export function protectEdges(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, (run) => [...run].map((char) => `&#${char.charCodeAt(0)};`).join(''))
}

function inline(block: RawBlock, ctx: BlockWriteContext): string {
  return protectEdges(inlineToMarkdown(block.content, ctx))
}

function fence(code: string, char = '`'): string {
  const longest = Math.max(2, ...[...code.matchAll(new RegExp(`${char === '`' ? '`' : '~'}+`, 'g'))].map((match) => match[0].length))
  return char.repeat(longest + 1)
}

function tableCells(row: unknown): unknown[] {
  return object(row) && Array.isArray(row.cells) ? row.cells : []
}
function cellContent(cell: unknown): unknown {
  return object(cell) && cell.type === 'tableCell' ? cell.content : cell
}
function cellProps(cell: unknown): Record<string, unknown> {
  if (!object(cell) || cell.type !== 'tableCell' || !object(cell.props)) return {}
  return Object.fromEntries(Object.entries(cell.props).filter(([key, value]) => !isDefaultProp(key, value)))
}

function tableMarkdown(block: RawBlock, ctx: BlockWriteContext): string[] {
  const content = object(block.content) ? block.content : {}
  const rows = Array.isArray(content.rows) ? content.rows : []
  const width = Math.max(1, ...rows.map((row) => tableCells(row).length))
  const cell = (value: unknown) => protectEdges(inlineToMarkdown(cellContent(value), ctx)) || ' '
  const lines = rows.map((row) => `| ${Array.from({ length: width }, (_, index) => cell(tableCells(row)[index])).join(' | ')} |`)
  if (!lines.length) lines.push(`| ${Array(width).fill(' ').join(' | ')} |`)
  lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`)
  const meta: Record<string, unknown> = {}
  if (Array.isArray(content.columnWidths) && content.columnWidths.some((value) => value !== null && value !== undefined)) meta.columnWidths = content.columnWidths.map((value) => value ?? null)
  if (content.headerRows !== undefined) meta.headerRows = content.headerRows
  if (content.headerCols !== undefined) meta.headerCols = content.headerCols
  if (!rows.length) meta.empty = true
  const props = rows.map((row) => tableCells(row).map(cellProps))
  if (props.some((row) => row.some((value) => Object.keys(value).length))) meta.cellProps = props
  if (rows.some((row) => tableCells(row).some((value) => Array.isArray(value)))) meta.legacyCells = true
  const extra = extraProps(block)
  if (block.id && ctx.keepIds.has(block.id)) extra.id = block.id
  if (Object.keys(meta).length) extra.table = meta
  return [...(Object.keys(extra).length ? [comment('attrs', ctx.json(extra))] : []), ...lines]
}

/** Forma legível dos blocos sem equivalente Markdown (o JSON acompanha para a reimportação). */
function readable(block: RawBlock, ctx: BlockWriteContext): string[] {
  const props = block.props ?? {}
  const str = (key: string) => String(props[key] ?? '')
  switch (block.type) {
    case 'page': {
      const link = ctx.pageLink(str('pageId'))
      return [`[${link.label}](${link.destination})`]
    }
    // Lousa: lista legível (cartões como links, texto das notas/formas); o conteúdo exato viaja no np:block.
    case 'canvas': {
      const objects = Array.isArray(props.objects) ? props.objects as Record<string, unknown>[] : []
      const items = objects.flatMap((o) => {
        if (!o || typeof o !== 'object') return []
        if ((o.type === 'page' || o.type === 'database') && typeof o.pageId === 'string') { const link = ctx.pageLink(o.pageId); return [`- [${link.label}](${link.destination})`] }
        const text = o.type === 'section' ? o.title : o.type === 'connector' ? o.label : o.type === 'note' || o.type === 'text' || o.type === 'shape' ? o.text : o.type === 'image' || o.type === 'file' ? o.name : ''
        return typeof text === 'string' && text.trim() ? [`- ${escapeLabel(text.replace(/\s+/g, ' ').trim())}`] : []
      })
      return items.length ? items : ['*[canvas]*']
    }
    case 'video': case 'audio': case 'file': {
      const icon = block.type === 'video' ? '🎬' : block.type === 'audio' ? '🔊' : '📎'
      const url = str('url')
      return url ? [`[${icon} ${escapeLabel(str('name') || url)}](${ctx.media(url, str('name') || block.type)})`] : [`${icon} ${escapeLabel(str('name'))}`]
    }
    case 'pdfPreview': case 'localAttachment': {
      const data = str('data')
      return data ? [`[📎 ${escapeLabel(str('name'))}](${ctx.media(data, str('name'))})`] : [`📎 ${escapeLabel(str('name'))}`]
    }
    case 'bookmark': return [`[🔖 ${escapeLabel(str('title') || str('url'))}](${ctx.href(str('url'))})${str('description') ? ` — ${escapeLabel(str('description'))}` : ''}`]
    case 'onlineVideo': return [`[▶ ${escapeLabel(str('title') || str('url'))}](${ctx.href(str('url'))})${str('caption') ? ` — ${escapeLabel(str('caption'))}` : ''}`]
    case 'externalReference': return [`[🔗 ${escapeLabel(str('title') || str('url'))}](${ctx.href(str('url'))})`]
    case 'tableOfContents': return ['*[Sumário / Table of contents]*']
    case 'breadcrumb': return ['*[Trilha / Breadcrumb]*']
    case 'localButton': return [`**[${escapeLabel(str('label') || 'Botão')}]**`]
    case 'mermaid': return ['```mermaid', ...str('source').split('\n'), '```']
    case 'htmlSandbox': return ['```html', ...str('html').split('\n'), '```']
    case 'tabs': {
      let tabs: { title?: string; body?: string }[] = []
      try { const parsed = JSON.parse(str('tabsJson')); if (Array.isArray(parsed)) tabs = parsed } catch { /* JSON inválido */ }
      return tabs.flatMap((tab, index) => [...(index ? [''] : []), `**${escapeLabel(String(tab.title ?? ''))}**`, '', ...String(tab.body ?? '').split('\n').map(escapeLineStart)])
    }
    case 'aiBlock': case 'aiMeetingNotes': return str('output') ? str('output').split('\n').map(escapeLineStart) : [`*${escapeLabel(str('prompt'))}*`]
    case 'syncedBlock': {
      const id = str('syncedId')
      const active = ctx.activeSynced ?? (ctx.activeSynced = new Set())
      const blocks = active.has(id) ? undefined : ctx.synced(id)
      if (!blocks) return ['*[Bloco sincronizado indisponível / Synced block unavailable]*']
      active.add(id)
      try { return blocksToMarkdownLines(blocks as RawBlock[], ctx) } finally { active.delete(id) }
    }
    case 'pageBreak': return ['---']
    case 'query': {
      // Texto da consulta num comentário + resultado atual como tabela/lista (a consulta em si viaja no np:block).
      const result = ctx.queryResult?.(props)
      const lines = [comment('query', result?.text ?? str('text'))]
      if (!result) return lines
      const link = (row: QueryExport['rows'][number], label: string) => { if (!row.pageId) return escapeLabel(label); const target = ctx.pageLink(row.pageId); return `[${escapeLabel(label) || '—'}](${target.destination})` }
      if (result.display === 'count') return [...lines, `**${result.total}**`]
      if (!result.rows.length) return [...lines, '*—*']
      if (result.display !== 'table') return [...lines, ...result.rows.map((row) => `- ${link(row, row.cells[0] ?? '')}${row.cells.slice(1).filter(Boolean).length ? ` — ${row.cells.slice(1).filter(Boolean).map(escapeLabel).join(' · ')}` : ''}`)]
      const cell = (text: string) => escapeLabel(text).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
      return [...lines, `| ${result.columns.map(cell).join(' | ')} |`, `| ${result.columns.map(() => '---').join(' | ')} |`, ...result.rows.map((row) => `| ${row.cells.map((text, index) => index === 0 ? link(row, text).replace(/\|/g, '\\|') : cell(text)).join(' | ')} |`)]
    }
    default: {
      const text = inlinePlain(block.content)
      return text ? [escapeLabel(text)] : [`*[${escapeLabel(String(block.type))}]*`]
    }
  }
}

function escapeLabel(text: string): string {
  return inlineToMarkdown([{ type: 'text', text, styles: {} }], { href: (value) => value })
}

/** Vídeo online: link legível + comentário `<!-- np:embed {…} -->` que o importador usa para recriar o player. */
function embedLines(block: RawBlock, ctx: BlockWriteContext): string[] {
  const props = block.props ?? {}
  const data: Record<string, unknown> = { url: String(props.url ?? '') }
  for (const key of ['title', 'caption'] as const) if (props[key]) data[key] = String(props[key])
  if (Number(props.width) > 0) data.width = Number(props.width)
  if (props.align === 'left') data.align = 'left'
  if (block.id && ctx.keepIds.has(block.id)) data.id = block.id
  return [comment('embed', data), ...readable(block, ctx)]
}

function opaque(block: RawBlock, ctx: BlockWriteContext): string[] {
  const data: Record<string, unknown> = { type: block.type, props: block.props ?? {} }
  if (block.content !== undefined && !(Array.isArray(block.content) && !block.content.length)) data.content = block.content
  if (block.id && ctx.keepIds.has(block.id)) data.id = block.id
  return [comment('block', ctx.json(data)), ...readable(block, ctx), '<!-- /np:block -->']
}

interface Emitted { lines: string[]; childIndent: number | null }

function emit(block: RawBlock, ctx: BlockWriteContext, number: number): Emitted {
  const type = String(block.type ?? 'paragraph')
  const props = block.props ?? {}
  const children = Array.isArray(block.children) ? block.children : []
  if (type === 'onlineVideo') return { lines: embedLines(block, ctx), childIndent: 2 }
  if (!NATIVE_TYPES.has(type)) return { lines: opaque(block, ctx), childIndent: 2 }
  switch (type) {
    case 'paragraph': {
      const text = inline(block, ctx)
      return { lines: [...attrsLine(block, ctx), text ? escapeLineStart(text) : '<br>'], childIndent: 2 }
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(props.level) || 1))
      return { lines: [...attrsLine(block, ctx), `${'#'.repeat(level)} ${inline(block, ctx)}`.trimEnd()], childIndent: 2 }
    }
    case 'quote': return { lines: [...attrsLine(block, ctx), `> ${inline(block, ctx)}`.trimEnd()], childIndent: 2 }
    case 'bulletListItem': return { lines: [...attrsLine(block, ctx), `- ${inline(block, ctx)}`.trimEnd()], childIndent: 2 }
    case 'numberedListItem': {
      const marker = `${number}. `
      return { lines: [...attrsLine(block, ctx), `${marker}${inline(block, ctx)}`.trimEnd()], childIndent: marker.length }
    }
    case 'checkListItem': return { lines: [...attrsLine(block, ctx), `- [${props.checked ? 'x' : ' '}] ${inline(block, ctx)}`.trimEnd()], childIndent: 2 }
    case 'toggleListItem': {
      const body = blocksToMarkdownLines(children, ctx)
      return { lines: [...attrsLine(block, ctx), '<details>', `<summary>${inline(block, ctx)}</summary>`, ...(body.length ? ['', ...body, ''] : []), '</details>'], childIndent: null }
    }
    case 'codeBlock': {
      const code = inlinePlain(block.content)
      const marks = fence(code)
      const language = typeof props.language === 'string' && props.language !== 'text' ? props.language : ''
      return { lines: [...attrsLine(block, ctx), marks + language, ...code.split('\n'), marks], childIndent: 2 }
    }
    case 'divider': return { lines: [...attrsLine(block, ctx), '---'], childIndent: 2 }
    case 'equation': {
      const latex = String(props.latex ?? '')
      return { lines: [...attrsLine(block, ctx), '$$', ...latex.split('\n').map((line) => (line.trim() === '$$' ? ` ${line}` : line)), '$$'], childIndent: 2 }
    }
    case 'image': {
      const url = String(props.url ?? '')
      const name = String(props.name ?? '')
      const destination = url ? ctx.media(url, name || 'imagem') : ''
      return { lines: [...attrsLine(block, ctx), `![${escapeLabel(name)}](${destination})`], childIndent: 2 }
    }
    case 'callout': {
      const body = blocksToMarkdownLines(children, ctx)
      const icon = String(props.icon ?? '')
      return { lines: [...attrsLine(block, ctx), `> [!note]${icon ? ' ' + icon : ''}`, `> ${inline(block, ctx)}`.trimEnd(), ...(body.length ? ['>', ...body.map((line) => (line ? `> ${line}` : '>'))] : [])], childIndent: null }
    }
    case 'table': return { lines: tableMarkdown(block, ctx), childIndent: 2 }
    case 'columnList': {
      const lines = [comment('columns', ctx.json({ ...extraProps(block), ...(block.id && ctx.keepIds.has(block.id) ? { id: block.id } : {}) }))]
      for (const column of children) {
        const extra = extraProps(column)
        if (column.id && ctx.keepIds.has(column.id)) extra.id = column.id
        lines.push('', comment('column', ctx.json(extra)), '', ...blocksToMarkdownLines(Array.isArray(column.children) ? column.children : [], ctx))
      }
      lines.push('', '<!-- /np:columns -->')
      return { lines, childIndent: null }
    }
    case 'column': return { lines: blocksToMarkdownLines(children, ctx), childIndent: null }
  }
  return { lines: opaque(block, ctx), childIndent: 2 }
}

export function blocksToMarkdownLines(blocks: RawBlock[], ctx: BlockWriteContext): string[] {
  const lines: string[] = []
  let previous: string | null = null
  let number = 0
  let looseChildren = false
  for (const block of blocks) {
    if (!object(block)) continue
    const type = String(block.type ?? 'paragraph')
    number = type === 'numberedListItem' ? (previous === 'numberedListItem' ? number + 1 : Number(block.props?.start) || 1) : 0
    const { lines: own, childIndent } = emit(block, ctx, number)
    const children = Array.isArray(block.children) ? block.children : []
    const tight = previous !== null && !looseChildren && LIST_TYPES.has(type) && LIST_TYPES.has(previous)
    if (previous !== null && !tight) lines.push('')
    lines.push(...own)
    looseChildren = false
    if (childIndent !== null && children.length) {
      const nested = blocksToMarkdownLines(children, ctx)
      if (!(LIST_TYPES.has(type) && children.every((child) => LIST_TYPES.has(String(child.type))))) { lines.push(''); looseChildren = true }
      lines.push(...indent(nested, childIndent))
    }
    previous = type
  }
  return lines
}

export function blocksToMarkdown(blocks: unknown[], ctx: BlockWriteContext): string {
  return blocksToMarkdownLines(blocks.filter(object) as RawBlock[], ctx).join('\n')
}

export { normalizeInline }
