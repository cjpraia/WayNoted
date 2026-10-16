// Markdown (o gerado pelo aplicativo e Markdown comum simples) → blocos BlockNote.
import { markdownToInline, type InlineReadContext } from './inline.ts'
import { newId, object, type RawBlock } from './model.ts'
import { parseVideoUrl } from '../components/page/videoEmbed.ts'

export interface BlockReadContext extends InlineReadContext {
  /** Destino de imagem/arquivo → URL do bloco (caminho do pacote → data-URL). */
  media(destination: string): string
  /** Resolve referências `asset:` dentro do JSON dos blocos especiais. */
  json<T>(value: T): T
}

const indentOf = (line: string) => /^ */.exec(line)![0].length
const blank = (line: string) => !line.trim()

function marker(line: string, kind: string): unknown | undefined {
  const match = new RegExp(`^<!--\\s*np:${kind}(?:\\s+([\\s\\S]*?))?\\s*-->\\s*$`).exec(line.trim())
  if (!match) return undefined
  if (!match[1]) return {}
  try { return JSON.parse(match[1]) } catch { return {} }
}

/** Índice da linha que fecha o bloco aberto em `start` (respeitando aninhamento). */
function closing(lines: string[], start: number, open: RegExp, close: RegExp): number {
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim()
    if (open.test(line)) depth++
    else if (close.test(line)) { depth--; if (depth === 0) return i }
  }
  return lines.length
}

function textBlock(type: string, content: string, ctx: BlockReadContext, props: Record<string, unknown> = {}): RawBlock {
  return { id: newId(), type, props, content: markdownToInline(content, ctx), children: [] }
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) { cell += body[i] + body[i + 1]; i++; continue }
    if (body[i] === '`') {
      const run = /^`+/.exec(body.slice(i))![0]
      const close = body.indexOf(run, i + run.length)
      if (close > 0) { cell += body.slice(i, close + run.length); i = close + run.length - 1; continue }
    }
    if (body[i] === '|') { cells.push(cell); cell = '' } else cell += body[i]
  }
  cells.push(cell)
  return cells.map((value) => value.trim())
}

function parseTable(lines: string[], attrs: Record<string, unknown>, ctx: BlockReadContext): RawBlock {
  const meta = object(attrs.table) ? attrs.table : {}
  const rows = lines.filter((_, index) => index !== 1).map(splitRow)
  const cellProps = Array.isArray(meta.cellProps) ? meta.cellProps as Record<string, unknown>[][] : []
  const content: Record<string, unknown> = {
    type: 'tableContent',
    columnWidths: Array.isArray(meta.columnWidths) ? meta.columnWidths.map((value) => value ?? undefined) : Array(Math.max(0, ...rows.map((row) => row.length))).fill(undefined),
    rows: meta.empty ? [] : rows.map((row, r) => ({
      cells: row.map((cell, c) => {
        const inline = markdownToInline(cell, ctx)
        return meta.legacyCells ? inline : { type: 'tableCell', props: { ...(cellProps[r]?.[c] ?? {}) }, content: inline }
      }),
    })),
  }
  if (meta.headerRows !== undefined) content.headerRows = meta.headerRows
  if (meta.headerCols !== undefined) content.headerCols = meta.headerCols
  const { table: _table, ...props } = attrs
  return { id: newId(), type: 'table', props, content, children: [] }
}

function applyAttrs(block: RawBlock, attrs: Record<string, unknown> | null): RawBlock {
  if (!attrs) return block
  const { id, table: _table, ...props } = attrs
  return { ...block, ...(typeof id === 'string' ? { id } : {}), props: { ...(block.props ?? {}), ...props } }
}

interface Parsed { block: RawBlock | null; next: number; childIndent: number | null }

function parseOne(lines: string[], start: number, ctx: BlockReadContext, attrs: Record<string, unknown> | null): Parsed {
  const line = lines[start]
  const trimmed = line.trim()

  const opaque = marker(line, 'block')
  if (opaque !== undefined) {
    const end = closing(lines, start, /^<!--\s*np:block\b/, /^<!--\s*\/np:block\s*-->$/)
    const data = object(opaque) ? ctx.json(opaque) : {}
    const block: RawBlock = { id: typeof data.id === 'string' ? data.id : newId(), type: String(data.type ?? 'paragraph'), props: object(data.props) ? data.props : {}, children: [] }
    if (data.content !== undefined) block.content = data.content
    return { block, next: end + 1, childIndent: 2 }
  }

  // Vídeo online: `<!-- np:embed {"url":…} -->` seguido (ou não) do link legível.
  const embed = marker(line, 'embed')
  if (embed !== undefined) {
    const data = object(embed) ? embed : {}
    const url = typeof data.url === 'string' ? data.url : ''
    const next = start + 1 < lines.length && /^\[▶ /.test(lines[start + 1].trim()) ? start + 2 : start + 1
    const video = parseVideoUrl(url)
    // Endereço fora da lista fechada: ignora o comentário e deixa o link legível como parágrafo.
    if (!video) return { block: null, next: start + 1, childIndent: null }
    const props: Record<string, unknown> = { url: video.watchUrl }
    for (const key of ['title', 'caption'] as const) if (typeof data[key] === 'string') props[key] = data[key]
    if (typeof data.width === 'number' && data.width > 0) props.width = Math.round(data.width)
    if (data.align === 'left') props.align = 'left'
    return { block: { id: typeof data.id === 'string' ? data.id : newId(), type: 'onlineVideo', props, children: [] }, next, childIndent: 2 }
  }

  // Consulta escrita à mão (ou de outro exportador): só o texto; o bloco interpreta ao abrir.
  const queryMarker = marker(line, 'query')
  const queryText = typeof queryMarker === 'string' ? queryMarker : queryMarker !== undefined ? /^<!--\s*np:query\s+([\s\S]*?)\s*-->\s*$/.exec(trimmed)?.[1] : undefined
  if (queryText) {
    let next = start + 1
    while (next < lines.length && lines[next].trim() && !/^<!--/.test(lines[next].trim())) next++
    return { block: { id: newId(), type: 'query', props: { query: '', text: queryText }, children: [] }, next, childIndent: 2 }
  }

  const columns = marker(line, 'columns')
  if (columns !== undefined) {
    const end = closing(lines, start, /^<!--\s*np:columns\b/, /^<!--\s*\/np:columns\s*-->$/)
    const body = lines.slice(start + 1, end)
    const columnBlocks: RawBlock[] = []
    let depth = 0
    let current: { props: Record<string, unknown>; lines: string[] } | null = null
    for (const item of body) {
      const t = item.trim()
      if (/^<!--\s*np:columns\b/.test(t)) depth++
      if (/^<!--\s*\/np:columns\s*-->$/.test(t)) depth--
      const column = depth === 0 ? marker(item, 'column') : undefined
      if (column !== undefined) {
        if (current) columnBlocks.push(applyAttrs({ id: newId(), type: 'column', props: {}, children: parseBlocks(current.lines, ctx) }, ctx.json(current.props)))
        current = { props: object(column) ? column : {}, lines: [] }
      } else current?.lines.push(item)
    }
    if (current) columnBlocks.push(applyAttrs({ id: newId(), type: 'column', props: {}, children: parseBlocks(current.lines, ctx) }, ctx.json(current.props)))
    const block = applyAttrs({ id: newId(), type: 'columnList', props: {}, children: columnBlocks }, object(columns) ? ctx.json(columns) : null)
    return { block, next: end + 1, childIndent: null }
  }

  if (/^<!--\s*np:rows\b/.test(trimmed)) {
    const end = lines.findIndex((item, index) => index > start && /^<!--\s*\/np:rows\s*-->$/.test(item.trim()))
    return { block: null, next: end < 0 ? lines.length : end + 1, childIndent: null }
  }
  if (/^<!--[\s\S]*-->$/.test(trimmed)) return { block: null, next: start + 1, childIndent: null }

  if (/^<details>$/i.test(trimmed)) {
    const end = closing(lines, start, /^<details>$/i, /^<\/details>$/i)
    const summaryLine = lines[start + 1]?.trim() ?? ''
    const summary = /^<summary>([\s\S]*)<\/summary>$/i.exec(summaryLine)
    const bodyStart = summary ? start + 2 : start + 1
    const block = textBlock('toggleListItem', summary ? summary[1] : '', ctx)
    block.children = parseBlocks(lines.slice(bodyStart, end), ctx)
    return { block, next: end + 1, childIndent: null }
  }

  const fenceMatch = /^(`{3,}|~{3,})\s*([^`\s]*)\s*$/.exec(trimmed)
  if (fenceMatch) {
    const close = lines.findIndex((item, index) => index > start && item.trim().startsWith(fenceMatch[1][0].repeat(fenceMatch[1].length)) && /^(`+|~+)$/.test(item.trim()))
    const end = close < 0 ? lines.length : close
    const pad = indentOf(line)
    const code = lines.slice(start + 1, end).map((item) => item.slice(Math.min(pad, indentOf(item)))).join('\n')
    const props: Record<string, unknown> = fenceMatch[2] ? { language: fenceMatch[2] } : {}
    return { block: { id: newId(), type: 'codeBlock', props, content: code ? [{ type: 'text', text: code, styles: {} }] : [], children: [] }, next: end + 1, childIndent: 2 }
  }

  if (trimmed === '$$') {
    const close = lines.findIndex((item, index) => index > start && item.trim() === '$$')
    const end = close < 0 ? lines.length : close
    const latex = lines.slice(start + 1, end).map((item) => (item.trim() === '$$' ? item.slice(1) : item)).join('\n')
    return { block: { id: newId(), type: 'equation', props: { latex }, children: [] }, next: end + 1, childIndent: 2 }
  }

  if (trimmed.startsWith('|')) {
    let end = start
    while (end < lines.length && lines[end].trim().startsWith('|')) end++
    const rows = lines.slice(start, end)
    if (rows.length >= 2 && /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(rows[1].trim())) return { block: parseTable(rows, attrs ?? {}, ctx), next: end, childIndent: 2 }
  }

  if (trimmed.startsWith('>')) {
    let end = start
    while (end < lines.length && lines[end].trim().startsWith('>')) end++
    const body = lines.slice(start, end).map((item) => item.trim().replace(/^>\s?/, ''))
    const callout = /^\[!(\w+)\][ \t]*(.*)$/.exec(body[0])
    if (callout) {
      const block = textBlock('callout', body[1] ?? '', ctx, { icon: callout[2] || (callout[1].toLowerCase() === 'note' ? '' : '💡') })
      block.children = parseBlocks(body.slice(2), ctx)
      return { block, next: end, childIndent: null }
    }
    return { block: textBlock('quote', body.join('<br>'), ctx), next: end, childIndent: 2 }
  }

  const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(trimmed)
  if (heading) return { block: textBlock('heading', (heading[2] ?? '').replace(/\s+#+\s*$/, ''), ctx, { level: heading[1].length }), next: start + 1, childIndent: 2 }

  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s+/g, ''))) return { block: { id: newId(), type: 'divider', props: {}, children: [] }, next: start + 1, childIndent: 2 }

  const check = /^[-*+]\s+\[([ xX])\](?:\s+(.*))?$/.exec(trimmed)
  if (check) return { block: textBlock('checkListItem', check[2] ?? '', ctx, { checked: check[1] !== ' ' }), next: start + 1, childIndent: 2 }
  const bullet = /^([-*+])(?:\s+(.*))?$/.exec(trimmed)
  if (bullet && (bullet[2] !== undefined || trimmed.length === 1)) return { block: textBlock('bulletListItem', bullet[2] ?? '', ctx), next: start + 1, childIndent: 2 }
  const numbered = /^(\d{1,9})([.)])(?:\s+(.*))?$/.exec(trimmed)
  if (numbered) return { block: textBlock('numberedListItem', numbered[3] ?? '', ctx), next: start + 1, childIndent: numbered[1].length + 2 }

  const image = /^!\[((?:\\.|[^\]\\])*)\]\((<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)$/.exec(trimmed)
  if (image) {
    const name = markdownToInline(image[1], ctx).map((item) => String(item.text ?? '')).join('')
    const destination = image[2].replace(/^<|>$/g, '')
    const props: Record<string, unknown> = { url: destination ? ctx.media(destination) : '' }
    if (name) props.name = name
    return { block: { id: newId(), type: 'image', props, children: [] }, next: start + 1, childIndent: 2 }
  }

  if (/^<br\s*\/?>$/i.test(trimmed)) return { block: { id: newId(), type: 'paragraph', props: {}, content: [], children: [] }, next: start + 1, childIndent: 2 }

  // Parágrafo: linhas seguidas no mesmo recuo (Markdown comum quebra linhas longas).
  let end = start + 1
  const pad = indentOf(line)
  while (end < lines.length && !blank(lines[end]) && indentOf(lines[end]) === pad && !startsBlock(lines[end].trim())) end++
  const text = lines.slice(start, end).map((item) => item.trim()).join(' ')
  return { block: textBlock('paragraph', text, ctx), next: end, childIndent: 2 }
}

function startsBlock(line: string): boolean {
  return /^(#{1,6}(\s|$)|>|[-*+]\s|\d{1,9}[.)]\s|\||\$\$$|```|~~~|<!--|<details>|<br\s*\/?>$|!\[)/i.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line)
}

/** `lines` já sem o recuo do pai. */
export function parseBlocks(lines: string[], ctx: BlockReadContext): RawBlock[] {
  const blocks: RawBlock[] = []
  let attrs: Record<string, unknown> | null = null
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (blank(line)) { i++; continue }
    const found = marker(line, 'attrs')
    if (found !== undefined) { attrs = object(found) ? ctx.json(found) : null; i++; continue }
    const base = indentOf(line)
    const local = base ? lines.slice(i).map((item) => item.slice(Math.min(base, indentOf(item)))) : lines.slice(i)
    const parsed = parseOne(local, 0, ctx, attrs)
    i += parsed.next
    if (!parsed.block) { attrs = null; continue }
    let block = parsed.block.type === 'table' ? applyAttrs(parsed.block, attrs ? { id: attrs.id } : null) : applyAttrs(parsed.block, attrs)
    attrs = null
    if (parsed.childIndent !== null) {
      const childIndent = base + parsed.childIndent
      let end = i
      let lastContent = i
      while (end < lines.length && (blank(lines[end]) || indentOf(lines[end]) >= childIndent)) { if (!blank(lines[end])) lastContent = end + 1; end++ }
      if (lastContent > i) {
        const childLines = lines.slice(i, lastContent).map((item) => item.slice(Math.min(childIndent, indentOf(item))))
        block = { ...block, children: [...(block.children ?? []), ...parseBlocks(childLines, ctx)] }
        i = lastContent
      }
    }
    blocks.push(block)
  }
  return blocks
}

export function markdownToBlocks(markdown: string, ctx: BlockReadContext): RawBlock[] {
  return parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'), ctx)
}
