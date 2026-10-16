// ENML (XHTML restrito do ENEX Archive) → blocos do aplicativo. Puro, sem DOM.
import { block, mediaBlock, mergeInline, paragraph, text, type AssetRef, type Block, type InlineNode, type Styles, type TextNode } from '../bundle/blocks.ts'
import { parseXml, textOf, XmlError, type XNode } from './xml.ts'

export interface EnmlContext {
  /** Anexo ligado a <en-media hash type>; null se não existir na nota. */
  media(hash: string, type: string): AssetRef | null
  warn(code: string, detail?: string): void
  cryptLabel: string
}

const BLOCK_TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'hr', 'center', 'section', 'article', 'en-note', 'dl', 'dd', 'dt', 'address'])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link'])
const HEADING = /^h([1-6])$/

const collapse = (value: string) => value.replace(/[ \t\r\n\f]+/g, ' ')

/** Estilos inline do atributo style (o ENEX Archive usa spans com font-weight, font-style e text-decoration). */
function styleFrom(node: XNode, base: Styles): Styles {
  const next: Styles = { ...base }
  switch (node.name) {
    case 'b': case 'strong': next.bold = true; break
    case 'i': case 'em': case 'cite': next.italic = true; break
    case 'u': case 'ins': next.underline = true; break
    case 's': case 'strike': case 'del': next.strike = true; break
    case 'code': case 'tt': case 'kbd': case 'samp': next.code = true; break
    case 'mark': next.backgroundColor = 'yellow'; break
  }
  const style = node.attrs.style
  if (style) {
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.bold = true
    if (/font-style\s*:\s*italic/i.test(style)) next.italic = true
    if (/text-decoration[^;]*underline/i.test(style)) next.underline = true
    if (/text-decoration[^;]*line-through/i.test(style)) next.strike = true
    if (/-archive-highlight\s*:\s*true/i.test(style)) next.backgroundColor = 'yellow'
    if (/font-family\s*:[^;]*(monospace|courier|menlo|consolas)/i.test(style)) next.code = true
  }
  return next
}

const isBlock = (node: XNode | string): node is XNode => typeof node !== 'string' && BLOCK_TAGS.has(node.name)

function trimInline(nodes: InlineNode[]): InlineNode[] {
  const out = mergeInline(nodes)
  const first = out[0], last = out[out.length - 1]
  if (first?.type === 'text') first.text = first.text.replace(/^[ \n]+/, '')
  if (last?.type === 'text') last.text = last.text.replace(/[ \n]+$/, '')
  return mergeInline(out)
}
const hasText = (nodes: InlineNode[]) => nodes.some(node => node.type !== 'text' || node.text.trim() !== '')

function safeHref(raw: string | undefined): string | null {
  const href = (raw ?? '').trim()
  return /^(https?|mailto|tel|ftp):/i.test(href) ? href : null
}

/** Conteúdo inline de uma sequência de nós; mídia encontrada vai para `sink`. */
function inlineOf(nodes: (XNode | string)[], ctx: EnmlContext, sink: Block[], styles: Styles = {}): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (typeof node === 'string') { out.push(text(collapse(node), styles)); continue }
    if (SKIP_TAGS.has(node.name)) continue
    if (node.name === 'br') { out.push(text('\n', styles)); continue }
    if (node.name === 'en-todo') { out.push(text(node.attrs.checked === 'true' ? '☑ ' : '☐ ', styles)); continue }
    if (node.name === 'en-crypt') { ctx.warn('encrypted'); out.push(text(ctx.cryptLabel, { ...styles, italic: true })); continue }
    if (node.name === 'en-media') {
      const asset = ctx.media((node.attrs.hash ?? '').toLowerCase(), node.attrs.type ?? '')
      if (asset) sink.push(mediaBlock(asset))
      continue
    }
    if (node.name === 'img') continue
    const next = styleFrom(node, styles)
    if (node.name === 'a') {
      const inner = inlineOf(node.children, ctx, sink, next)
      const flat = inner.flatMap((item): TextNode[] => item.type === 'text' ? [item] : item.type === 'link' ? item.content : [])
      const href = safeHref(node.attrs.href)
      if (href && flat.length) out.push({ type: 'link', href, content: flat })
      else { if (node.attrs.href && !href && !node.attrs.href.startsWith('#')) ctx.warn('broken-link', node.attrs.href.slice(0, 80)); out.push(...flat) }
      continue
    }
    const inner = inlineOf(node.children, ctx, sink, next)
    if (isBlock(node) && inner.length) out.push(...inner, text('\n', styles))
    else out.push(...inner)
  }
  return out
}

/** Divide filhos em itens de lista (primeiro bloco = conteúdo do item; demais = filhos). */
function listItems(list: XNode, ordered: boolean, ctx: EnmlContext): Block[] {
  const out: Block[] = []
  for (const item of list.children) {
    if (typeof item === 'string') continue
    if (item.name !== 'li') { out.push(...convertBlocks([item], ctx)); continue }
    const inner = convertBlocks(item.children, ctx)
    const first = inner[0]
    if (first && (first.type === 'paragraph' || first.type === 'checkListItem')) {
      const type = first.type === 'checkListItem' ? 'checkListItem' : ordered ? 'numberedListItem' : 'bulletListItem'
      out.push(block(type, first.type === 'checkListItem' ? first.props : {}, first.content, [...first.children, ...inner.slice(1)]))
    } else out.push(block(ordered ? 'numberedListItem' : 'bulletListItem', {}, [], inner))
  }
  return out
}

function tableBlock(table: XNode, ctx: EnmlContext): Block[] {
  const rows: XNode[] = []
  const collect = (node: XNode) => { for (const item of node.children) if (typeof item !== 'string') { if (item.name === 'tr') rows.push(item); else if (item.name === 'tbody' || item.name === 'thead' || item.name === 'tfoot') collect(item) } }
  collect(table)
  if (!rows.length) return []
  const sink: Block[] = []
  const cells = rows.map(row => row.children.filter((cell): cell is XNode => typeof cell !== 'string' && (cell.name === 'td' || cell.name === 'th')).map(cell => trimInline(inlineOf(cell.children, ctx, sink))))
  const width = Math.max(1, ...cells.map(row => row.length))
  const headerRows = rows[0].children.some(cell => typeof cell !== 'string' && cell.name === 'th') ? 1 : 0
  return [block('table', {}, { type: 'tableContent', ...(headerRows ? { headerRows } : {}), rows: cells.map(row => ({ cells: Array.from({ length: width }, (_, index) => row[index] ?? []) })) }), ...sink]
}

/** Converte nós ENML em blocos; texto solto vira parágrafos, `<en-todo>` inicia itens de tarefa. */
export function convertBlocks(nodes: (XNode | string)[], ctx: EnmlContext): Block[] {
  const out: Block[] = []
  let run: InlineNode[] = []
  let todo: boolean | null = null
  const sink: Block[] = []
  const flush = () => {
    const content = trimInline(run)
    if (todo !== null) out.push(block('checkListItem', { checked: todo }, content))
    else if (hasText(content)) out.push(paragraph(content))
    run = []; todo = null
    if (sink.length) out.push(...sink.splice(0))
  }
  for (const node of nodes) {
    if (typeof node === 'string') { run.push(text(collapse(node))); continue }
    if (SKIP_TAGS.has(node.name)) continue
    if (node.name === 'en-todo') { flush(); todo = node.attrs.checked === 'true'; continue }
    if (node.name === 'br') { if (todo !== null) flush(); else run.push(text('\n')); continue }
    if (node.name === 'en-media') {
      const asset = ctx.media((node.attrs.hash ?? '').toLowerCase(), node.attrs.type ?? '')
      if (asset) { flush(); out.push(mediaBlock(asset)) }
      continue
    }
    if (!isBlock(node)) { run.push(...inlineOf([node], ctx, sink)); continue }
    flush()
    const heading = HEADING.exec(node.name)
    if (heading) {
      const side: Block[] = []
      out.push(block('heading', { level: Math.min(3, Number(heading[1])) }, trimInline(inlineOf(node.children, ctx, side))), ...side)
      continue
    }
    switch (node.name) {
      case 'ul': case 'ol': out.push(...listItems(node, node.name === 'ol', ctx)); break
      case 'table': out.push(...tableBlock(node, ctx)); break
      case 'hr': out.push(block('divider', {})); break
      case 'pre': out.push(block('codeBlock', { language: 'text' }, [text(textOf(node).replace(/^\n/, '').replace(/\n$/, ''))])); break
      case 'blockquote': {
        const inner = convertBlocks(node.children, ctx)
        const first = inner[0]
        if (first && first.type === 'paragraph') out.push(block('quote', {}, first.content, inner.slice(1)))
        else out.push(block('quote', {}, [], inner))
        break
      }
      default: out.push(...convertBlocks(node.children, ctx))
    }
  }
  flush()
  return out
}

/** Texto simples do ENML malformado (plano B): tags removidas, entidades decodificadas. */
export function plainFromBrokenEnml(source: string): string {
  return source.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/div|\/p|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
}

export function convertEnml(source: string, ctx: EnmlContext): Block[] {
  let root: XNode
  try { root = parseXml(source) } catch (error) {
    if (!(error instanceof XmlError)) throw error
    ctx.warn('enml-invalid', error.message)
    return plainFromBrokenEnml(source).split(/\n{2,}/).filter(Boolean).map(chunk => paragraph([text(chunk)]))
  }
  const note = root.children.find((item): item is XNode => typeof item !== 'string' && item.name === 'en-note')
  return convertBlocks(note ? note.children : root.children, ctx)
}
