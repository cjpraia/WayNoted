// Markdown exportado pelo Export Bundle → blocos BlockNote (JSON). Puro: não depende de DOM nem do editor.
import { block, codeLanguage, inlineText, mediaBlock, mergeInline, pageBlock, pageHref, paragraph, text, type Block, type ConvertContext, type InlineNode, type Styles, type TextNode } from './blocks.ts'
import { isExternalHref, leadingEmoji, newId } from './util.ts'

const PUNCT = /[!-/:-@[-`{-~]/

interface InlineSink { media: Block[] }

function findClosing(source: string, delimiter: string, from: number): number {
  let index = from
  while (index < source.length) {
    const found = source.indexOf(delimiter, index)
    if (found < 0) return -1
    if (source[found - 1] !== '\\' && found > from) return found
    index = found + 1
  }
  return -1
}

/** Encontra `]` correspondente respeitando colchetes aninhados e escapes. */
function matchBracket(source: string, open: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (char === '\\') { index++; continue }
    if (char === openChar) depth++
    else if (char === closeChar) { depth--; if (depth === 0) return index }
  }
  return -1
}

const HTML_STYLE: Record<string, string> = { u: 'underline', ins: 'underline', b: 'bold', strong: 'bold', i: 'italic', em: 'italic', s: 'strike', del: 'strike', strike: 'strike', code: 'code' }

export function parseInline(source: string, ctx: ConvertContext, sink: InlineSink, styles: Styles = {}): InlineNode[] {
  const out: InlineNode[] = []
  let buffer = ''
  const flush = () => { if (buffer) { out.push(text(buffer, styles)); buffer = '' } }
  const nested = (inner: string, extra: Styles) => { flush(); out.push(...parseInline(inner, ctx, sink, { ...styles, ...extra })) }
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const rest = source.slice(index)
    if (char === '\\' && index + 1 < source.length && PUNCT.test(source[index + 1])) { buffer += source[index + 1]; index += 2; continue }
    // Equação inline: $`x`$ (formato do Export Bundle) ou $x$.
    if (char === '$' && source[index + 1] !== '$') {
      if (source[index + 1] === '`') {
        const end = source.indexOf('`$', index + 2)
        if (end > index + 2) { flush(); out.push({ type: 'inlineEquation', props: { id: newId(), latex: source.slice(index + 2, end) } }); index = end + 2; continue }
      }
      const end = findClosing(source, '$', index + 1)
      if (end > index + 1) {
        const latex = source.slice(index + 1, end)
        if (!/^\s|\s$/.test(latex) && !/\d/.test(source[end + 1] ?? '') && !latex.includes('\n')) { flush(); out.push({ type: 'inlineEquation', props: { id: newId(), latex } }); index = end + 1; continue }
      }
    }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)![0]
      const end = source.indexOf(ticks, index + ticks.length)
      if (end > 0) { flush(); out.push(text(source.slice(index + ticks.length, end).replace(/^ (.*) $/, '$1'), { ...styles, code: true })); index = end + ticks.length; continue }
      buffer += ticks; index += ticks.length; continue
    }
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const delimiter = rest.slice(0, 2)
      const end = findClosing(source, delimiter, index + 2)
      if (end > index + 2) { nested(source.slice(index + 2, end), { bold: true }); index = end + 2; continue }
    }
    if (rest.startsWith('~~')) {
      const end = findClosing(source, '~~', index + 2)
      if (end > index + 2) { nested(source.slice(index + 2, end), { strike: true }); index = end + 2; continue }
    }
    if ((char === '*' || char === '_') && source[index + 1] !== ' ' && source[index + 1] !== char) {
      const wordy = char === '_' && /[\p{L}\p{N}]/u.test(source[index - 1] ?? '')
      if (!wordy) {
        let end = findClosing(source, char, index + 1)
        while (end > 0 && (source[end + 1] === char || source[end - 1] === ' ' || (char === '_' && /[\p{L}\p{N}]/u.test(source[end + 1] ?? '')))) end = findClosing(source, char, end + 2)
        if (end > index + 1) { nested(source.slice(index + 1, end), { italic: true }); index = end + 1; continue }
      }
    }
    if (char === '!' && source[index + 1] === '[') {
      const close = matchBracket(source, index + 1, '[', ']')
      if (close > 0 && source[close + 1] === '(') {
        const end = matchBracket(source, close + 1, '(', ')')
        if (end > 0) {
          const alt = source.slice(index + 2, close)
          const href = linkTarget(source.slice(close + 2, end))
          sink.media.push(...mediaFor(href, alt, ctx))
          index = end + 1; continue
        }
      }
    }
    if (char === '[') {
      const close = matchBracket(source, index, '[', ']')
      if (close > 0 && source[close + 1] === '(') {
        const end = matchBracket(source, close + 1, '(', ')')
        if (end > 0) {
          flush()
          const label = source.slice(index + 1, close)
          out.push(...linkNodes(label, linkTarget(source.slice(close + 2, end)), ctx, sink, styles))
          index = end + 1; continue
        }
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?|mailto):[^>\s]+)>/i.exec(rest)
      if (auto) { flush(); out.push({ type: 'link', href: auto[1], content: [text(auto[1], styles)] }); index += auto[0].length; continue }
      if (/^<br\s*\/?>/i.test(rest)) { buffer += '\n'; index += /^<br\s*\/?>/i.exec(rest)![0].length; continue }
      const tag = /^<([a-z]+)(\s[^>]*)?>/i.exec(rest)
      if (tag) {
        const name = tag[1].toLowerCase()
        const closeTag = new RegExp(`</${name}\\s*>`, 'i')
        const after = source.slice(index + tag[0].length)
        const closeMatch = closeTag.exec(after)
        if (closeMatch) {
          const inner = after.slice(0, closeMatch.index)
          const style = HTML_STYLE[name]
          if (name === 'a') {
            flush()
            const href = /href\s*=\s*"([^"]*)"/i.exec(tag[2] ?? '')?.[1] ?? ''
            out.push(...linkNodes(inner, href, ctx, sink, styles))
          } else if (name === 'mark' || name === 'span') {
            const color = /(?:class|data-color)\s*=\s*"[^"]*?(?:highlight-)?(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?/i.exec(tag[2] ?? '')
            nested(inner, color ? (color[2] || name === 'mark' ? { backgroundColor: color[1].toLowerCase() } : { textColor: color[1].toLowerCase() }) : {})
          } else nested(inner, style ? { [style]: true } : {})
          index += tag[0].length + closeMatch.index + closeMatch[0].length
          continue
        }
      }
      const stray = /^<\/?[a-z][^>]*>/i.exec(rest)
      if (stray) { index += stray[0].length; continue }
    }
    buffer += char
    index++
  }
  flush()
  return mergeInline(out)
}

/** "(caminho com espaço.md "título")" → caminho. */
function linkTarget(raw: string): string {
  let value = raw.trim()
  if (value.startsWith('<') && value.includes('>')) value = value.slice(1, value.indexOf('>'))
  else value = value.replace(/\s+"[^"]*"$/, '')
  return value.trim()
}

function linkNodes(label: string, href: string, ctx: ConvertContext, sink: InlineSink, styles: Styles): InlineNode[] {
  const inner = parseInline(label, ctx, sink, styles)
  const textOnly = (nodes: InlineNode[]): TextNode[] => nodes.flatMap(node => node.type === 'text' ? [node] : node.type === 'link' ? node.content : [text(node.props.latex, { ...styles, code: true })])
  const pageId = ctx.resolvePage(href)
  if (pageId) return [{ type: 'link', href: pageHref(pageId), content: textOnly(inner) }]
  if (isExternalHref(href)) {
    if (/^(https?|mailto|tel|ftp):/i.test(href)) return [{ type: 'link', href, content: textOnly(inner) }]
    return inner
  }
  if (!href || href.startsWith('#')) return inner
  const asset = ctx.resolveAsset(href)
  if (asset) { sink.media.push(mediaBlock(asset)); return inner }
  ctx.warn('broken-link', href)
  return inner
}

function mediaFor(href: string, alt: string, ctx: ConvertContext): Block[] {
  if (/^data:image\//i.test(href)) return [block('image', { url: href, name: alt, caption: '' })]
  if (isExternalHref(href)) {
    ctx.warn('remote-media', href)
    return [paragraph([{ type: 'link', href, content: [text(alt || href)] }])]
  }
  const asset = ctx.resolveAsset(href)
  if (!asset) { ctx.warn('missing-asset', href); return [paragraph([text(`[${alt || href}]`, { italic: true })])] }
  const caption = alt && alt !== asset.name && !/\.[a-z0-9]{2,5}$/i.test(alt) ? alt : ''
  return [mediaBlock(asset, caption)]
}

// ---------------------------------------------------------------- blocos

function indentOf(line: string): number {
  let width = 0
  for (const char of line) { if (char === ' ') width++; else if (char === '\t') width += 4; else break }
  return width
}
function dedent(line: string, amount: number): string {
  let index = 0, width = 0
  while (index < line.length && width < amount && (line[index] === ' ' || line[index] === '\t')) { width += line[index] === '\t' ? 4 : 1; index++ }
  return line.slice(index)
}
const isBlank = (line: string) => line.trim() === ''

const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[([ xX])\]\s+)?(.*)$/
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^`]*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const DIVIDER = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function startsBlock(line: string, next?: string): boolean {
  return HEADING.test(line) || FENCE.test(line) || DIVIDER.test(line) || LIST.test(line) || /^\s*>/.test(line) || /^\s*\$\$/.test(line)
    || /^\s*<(aside|details|summary|\/details|\/aside)\b/i.test(line) || (/^\s*\|/.test(line) && !!next && TABLE_SEP.test(next)) || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)
}

function splitRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
  const cells: string[] = []
  let current = '', code = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\\' && value[index + 1] === '|') { current += '|'; index++; continue }
    if (char === '`') code = !code
    if (char === '|' && !code) { cells.push(current.trim()); current = ''; continue }
    current += char
  }
  cells.push(current.trim())
  return cells
}

/** Converte uma linha inteira em blocos (texto + mídias soltas). */
function inlineBlock(type: string, props: Record<string, unknown>, source: string, ctx: ConvertContext, children: Block[] = []): Block[] {
  const sink: InlineSink = { media: [] }
  const content = parseInline(source, ctx, sink)
  // Linha que é só um link para página importada → bloco de página (subpágina ou "link para página").
  if (type === 'paragraph' && content.length === 1 && content[0].type === 'link' && content[0].href.startsWith("workspace://page/") && !children.length) {
    const pageId = content[0].href.slice("workspace://page/".length)
    const child = ctx.isChild(pageId)
    if (child) ctx.referenced.add(pageId)
    return [pageBlock(pageId, !child), ...sink.media]
  }
  if (!content.length && sink.media.length && type === 'paragraph') return [...sink.media, ...children]
  return [block(type, props, content, children), ...sink.media]
}

export function parseMarkdownBlocks(markdown: string, ctx: ConvertContext): Block[] {
  return parseLines(markdown.replace(/\r\n?/g, '\n').split('\n'), ctx)
}

function parseLines(lines: string[], ctx: ConvertContext): Block[] {
  const out: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) { index++; continue }
    const trimmed = line.trim()

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[2], body: string[] = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith(marker)) body.push(dedent(lines[index++], fence[1].length))
      index++
      const language = fence[3].trim()
      if (/^mermaid$/i.test(language)) out.push(block('mermaid', { source: body.join('\n') }))
      else out.push(block('codeBlock', { language: codeLanguage(language) }, [text(body.join('\n'))]))
      continue
    }

    if (trimmed.startsWith('$$')) {
      const single = /^\$\$(.+)\$\$$/.exec(trimmed)
      if (single) { out.push(block('equation', { latex: single[1].trim() })); index++; continue }
      const body: string[] = [trimmed.slice(2)]
      index++
      while (index < lines.length && !lines[index].trim().endsWith('$$')) body.push(lines[index++])
      if (index < lines.length) body.push(lines[index].trim().slice(0, -2))
      index++
      out.push(block('equation', { latex: body.join('\n').trim() }))
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading && indentOf(line) < 4) {
      out.push(...inlineBlock('heading', { level: Math.min(heading[1].length, 6) }, heading[2], ctx))
      index++; continue
    }

    if (DIVIDER.test(line)) { out.push(block('divider', {})); index++; continue }

    if (/^<aside\b[^>]*>/i.test(trimmed)) {
      const body: string[] = []
      let first = trimmed.replace(/^<aside\b[^>]*>/i, '')
      let closed = /<\/aside>\s*$/i.test(first)
      if (closed) first = first.replace(/<\/aside>\s*$/i, '')
      if (first.trim()) body.push(first)
      index++
      let depth = 1
      while (!closed && index < lines.length) {
        const current = lines[index]
        if (/^\s*<aside\b/i.test(current)) depth++
        if (/<\/aside>\s*$/i.test(current.trim())) { depth--; if (depth === 0) { const before = current.replace(/<\/aside>\s*$/i, ''); if (before.trim()) body.push(before); index++; break } }
        body.push(current)
        index++
      }
      out.push(callout(body, ctx))
      continue
    }

    if (/^<details\b[^>]*>/i.test(trimmed)) {
      const body: string[] = []
      let summary = ''
      const rest = trimmed.replace(/^<details\b[^>]*>/i, '')
      index++
      let depth = 1
      const consume = (value: string): boolean => {
        // Devolve true quando o </details> de fechamento foi encontrado.
        let remaining = value
        if (!summary) {
          const match = /<summary>([\s\S]*?)<\/summary>/i.exec(remaining)
          if (match) { summary = match[1].trim() || ' '; remaining = remaining.replace(match[0], '') }
        }
        depth += (remaining.match(/<details\b/gi) ?? []).length
        const closes = (remaining.match(/<\/details>/gi) ?? []).length
        if (closes && depth - closes <= 0) { const before = remaining.replace(/<\/details>\s*$/i, ''); if (before.trim()) body.push(before); return true }
        depth -= closes
        if (remaining.trim() || body.length) body.push(remaining)
        return false
      }
      let done = consume(rest)
      while (!done && index < lines.length) done = consume(lines[index++])
      const children = parseLines(body, ctx)
      const headingMatch = /^<h([1-6])>([\s\S]*)<\/h\1>$/i.exec(summary) ?? /^(#{1,3})\s+(.*)$/.exec(summary)
      if (headingMatch) {
        const level = /^\d$/.test(headingMatch[1]) ? Number(headingMatch[1]) : headingMatch[1].length
        out.push(...inlineBlock('heading', { level, isToggleable: true }, headingMatch[2], ctx, children))
      } else out.push(...inlineBlock('toggleListItem', {}, summary.trim(), ctx, children))
      continue
    }

    if (trimmed.startsWith('>')) {
      const body: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) body.push(lines[index++].trim().replace(/^>\s?/, ''))
      const callout = /^\[!(\w+)\]\s*$/.exec(body[0] ?? '')
      if (callout) { out.push(calloutFrom(body.slice(1), ctx, '💡')); continue }
      const [first, ...more] = splitParagraphs(body)
      const sink: InlineSink = { media: [] }
      const content = parseInline(first.join('\n'), ctx, sink)
      const children = more.length ? parseLines(more.flatMap(part => [...part, '']), ctx) : []
      out.push(block('quote', {}, content, children), ...sink.media)
      continue
    }

    if (/^\s*\|/.test(line) && index + 1 < lines.length && TABLE_SEP.test(lines[index + 1])) {
      const header = splitRow(line)
      index += 2
      const rows = [header]
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(splitRow(lines[index++]))
      const width = Math.max(...rows.map(row => row.length))
      const sink: InlineSink = { media: [] }
      const content = { type: 'tableContent' as const, headerRows: 1, rows: rows.map(row => ({ cells: Array.from({ length: width }, (_, cell) => parseInline((row[cell] ?? '').replace(/<br\s*\/?>/gi, '\n'), ctx, sink)) })) }
      out.push(block('table', {}, content), ...sink.media)
      continue
    }

    const list = LIST.exec(line)
    if (list) {
      const baseIndent = indentOf(line)
      const ordered = /\d/.test(list[2])
      const checkbox = list[4]
      const itemLines: string[] = [list[5]]
      index++
      const childLines: string[] = []
      while (index < lines.length) {
        const current = lines[index]
        if (isBlank(current)) {
          // Linha em branco continua o item só se a próxima não-vazia estiver indentada.
          let ahead = index + 1
          while (ahead < lines.length && isBlank(lines[ahead])) ahead++
          if (ahead < lines.length && indentOf(lines[ahead]) > baseIndent) { childLines.push(''); index++; continue }
          break
        }
        if (indentOf(current) > baseIndent) { childLines.push(current); index++; continue }
        if (!childLines.length && !startsBlock(current, lines[index + 1])) { itemLines.push(current.trim()); index++; continue }
        break
      }
      const childIndent = Math.min(...childLines.filter(value => !isBlank(value)).map(indentOf))
      const children = childLines.length ? parseLines(childLines.map(value => dedent(value, childIndent)), ctx) : []
      const type = checkbox !== undefined ? 'checkListItem' : ordered ? 'numberedListItem' : 'bulletListItem'
      const props: Record<string, unknown> = checkbox !== undefined ? { checked: checkbox.toLowerCase() === 'x' } : {}
      if (ordered && !out.some(previous => previous.type === 'numberedListItem') && Number.parseInt(list[2], 10) > 1) props.start = Number.parseInt(list[2], 10)
      out.push(...inlineBlock(type, props, itemLines.join('\n'), ctx, children))
      continue
    }

    // Parágrafo: linhas consecutivas até branco ou início de outro bloco.
    const body: string[] = [trimmed]
    index++
    while (index < lines.length && !isBlank(lines[index]) && !startsBlock(lines[index], lines[index + 1])) body.push(lines[index++].trim())
    out.push(...inlineBlock('paragraph', {}, body.join('\n'), ctx))
  }
  return out
}

function splitParagraphs(lines: string[]): string[][] {
  const parts: string[][] = [[]]
  for (const line of lines) {
    if (isBlank(line)) { if (parts[parts.length - 1].length) parts.push([]) }
    else parts[parts.length - 1].push(line)
  }
  return parts.filter(part => part.length).length ? parts.filter(part => part.length) : [[]]
}

function callout(body: string[], ctx: ConvertContext): Block {
  const lines = body.map(line => line.trim() === '' ? '' : line.replace(/^\s{0,4}/, ''))
  while (lines.length && isBlank(lines[0])) lines.shift()
  let icon = '💡'
  const emoji = leadingEmoji(lines[0] ?? '')
  if (emoji) {
    icon = emoji.icon
    lines[0] = emoji.rest
  } else {
    const image = /^<img\b[^>]*src="([^"]+)"[^>]*\/?>\s*/i.exec(lines[0] ?? '')
    if (image) { const asset = ctx.resolveAsset(image[1]); if (asset?.mime.startsWith('image/')) icon = asset.url; lines[0] = lines[0].slice(image[0].length) }
  }
  return calloutFrom(lines, ctx, icon)
}

function calloutFrom(lines: string[], ctx: ConvertContext, icon: string): Block {
  while (lines.length && isBlank(lines[0])) lines.shift()
  const first: string[] = []
  let index = 0
  while (index < lines.length && !isBlank(lines[index]) && !(first.length && startsBlock(lines[index], lines[index + 1]))) {
    if (!first.length && startsBlock(lines[index], lines[index + 1])) break
    first.push(lines[index++].trim())
  }
  const sink: InlineSink = { media: [] }
  const content = parseInline(first.join('\n'), ctx, sink)
  const children = [...sink.media, ...parseLines(lines.slice(index), ctx)]
  return block('callout', { icon }, content, children)
}

/** Texto plano de um trecho Markdown (para títulos e valores de propriedades). */
export function markdownPlain(source: string): string {
  const ctx: ConvertContext = { file: '', resolvePage: () => null, isChild: () => false, resolveAsset: () => null, warn: () => {}, referenced: new Set() }
  return inlineText(parseInline(source, ctx, { media: [] }))
}
