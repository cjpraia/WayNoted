// Markdown colado → blocos do editor. Reaproveita o conversor do importador do Export Bundle
// (src/importers/bundle/markdown.ts, puro e o mais completo do projeto) e acrescenta o que
// colagens reais pedem: alertas `> [!note]`, imagens remotas, realce `==x==`, `\( \)`/`\[ \]`,
// notas de rodapé, citações aninhadas, alinhamento de tabela GFM e papéis de conversa.
import { parseMarkdownBlocks } from "../../../importers/bundle/markdown.ts"
import type { Block, ConvertContext, InlineNode } from "../../../importers/bundle/blocks.ts"
import { conversationRoles } from './detect.ts'

export type PasteBlock = Block

export interface SchemaSupport {
  /** O schema do editor tem este tipo de bloco? (fallbacks para editores sem blocos próprios) */
  block(type: string): boolean
  inline(type: string): boolean
}

export const fullSupport: SchemaSupport = { block: () => true, inline: () => true }

const IMG = ''
const FENCE = /^(\s*)(`{3,}|~{3,})/
const ALERT_ICONS: Record<string, string> = {
  note: 'ℹ️', info: 'ℹ️', tip: '💡', hint: '💡', important: '❗', warning: '⚠️', caution: '🛑', danger: '🛑', error: '❌',
  success: '✅', check: '✅', question: '❓', faq: '❓', example: '📝', quote: '💬', cite: '💬', abstract: '📋', summary: '📋', tldr: '📋', todo: '☑️', bug: '🐞', failure: '❌', fail: '❌',
}
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (id: string) => /^\d+$/.test(id) ? [...id].map((digit) => SUPERSCRIPT[Number(digit)]).join('') : `[${id}]`

interface Prepared { text: string; images: { url: string; alt: string }[]; alignments: ('left' | 'center' | 'right' | null)[][] }

function safeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);/i.test(url) || /^file:\/\//i.test(url)
}

/** Conversões inline numa linha fora de código (pulando trechos `código`). */
function inlinePass(line: string, images: Prepared['images']): string {
  let out = ''
  let index = 0
  while (index < line.length) {
    const tick = line.indexOf('`', index)
    const end = tick < 0 ? line.length : tick
    out += inlineSegment(line.slice(index, end), images)
    if (tick < 0) break
    const run = /^`+/.exec(line.slice(tick))![0]
    const close = line.indexOf(run, tick + run.length)
    if (close < 0) { out += line.slice(tick); break }
    out += line.slice(tick, close + run.length)
    index = close + run.length
  }
  return out
}

function inlineSegment(text: string, images: Prepared['images']): string {
  if (!text) return text
  return text
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/==(?=\S)([^=\n]*?\S)==/g, '<mark class="highlight-yellow_background">$1</mark>')
    .replace(/\\\((.+?)\\\)/g, (_m, latex: string) => `$${latex.trim()}$`)
    .replace(/\[\^([^\]\s]+)\](?!:)/g, (_m, id: string) => sup(id))
    .replace(/!\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (_m, alt: string, url: string) => {
      if (!safeImageUrl(url)) return alt
      if (/^https?:/i.test(url)) return `[${alt || url}](${url})`
      images.push({ url, alt }); return `${IMG}${images.length - 1}${IMG}`
    })
}

function alignmentOf(separator: string): ('left' | 'center' | 'right' | null)[] {
  return separator.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => {
    const value = cell.trim()
    return value.startsWith(':') && value.endsWith(':') ? 'center' : value.endsWith(':') ? 'right' : value.startsWith(':') ? 'left' : null
  })
}

/** Normaliza o texto antes do conversor: só transformações seguras, sempre fora de código. */
export function prepareMarkdown(source: string): Prepared {
  const images: Prepared['images'] = []
  const alignments: Prepared['alignments'] = []
  const input = source.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/​/g, '').split('\n')
  const roles = new Map(conversationRoles(input).map((item) => [item.index, item]))
  const out: string[] = []
  let fence: string | null = null
  let math = false
  let quoteDepth = 0
  for (let index = 0; index < input.length; index++) {
    let line = input[index]
    if (fence) { out.push(line); if (line.trim().startsWith(fence) && /^\s*(`+|~+)\s*$/.test(line)) fence = null; continue }
    const open = FENCE.exec(line)
    if (open) { fence = open[2]; quoteDepth = 0; out.push(line); continue }
    // \[ … \] (ChatGPT) → $$ … $$
    if (math) { if (/^\s*(\\\]|\$\$)\s*$/.test(line)) { out.push('$$'); math = false } else out.push(line.replace(/\\\]\s*$/, () => { math = false; return '\n$$' })); continue }
    const display = /^\s*\\\[(.*?)(\\\])?\s*$/.exec(line)
    if (display) {
      if (display[2] !== undefined) out.push(`$$${display[1].trim()}$$`)
      else { out.push('$$'); if (display[1].trim()) out.push(display[1]); math = true }
      continue
    }
    if (/^\s*\$\$/.test(line)) { out.push(line); if (!/^\s*\$\$.*\$\$\s*$/.test(line) || line.trim() === '$$') { const close = input.findIndex((next, at) => at > index && next.trim().endsWith('$$')); if (close > index) { out.push(...input.slice(index + 1, close + 1)); index = close } } continue }

    const role = roles.get(index)
    if (role) {
      out.push('', `**${role.role}:**`, '')
      if (role.rest.trim()) out.push(inlinePass(role.rest, images))
      quoteDepth = 0
      continue
    }
    // Definição de nota de rodapé: "[^1]: texto" → "¹ texto".
    const footnote = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line)
    if (footnote) { out.push(`${sup(footnote[1])} ${inlinePass(footnote[2], images)}`); continue }

    // Imagem sozinha na linha (data:/file:) → bloco de imagem; remota → bloco de imagem também.
    const lone = /^!\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)\s*$/.exec(line)
    if (lone && safeImageUrl(lone[2])) { images.push({ url: lone[2], alt: lone[1] }); out.push('', `${IMG}${images.length - 1}${IMG}`, ''); quoteDepth = 0; continue }

    // Alerta GFM/Markdown Vault "> [!warning] Título" → callout com ícone (via <aside> do conversor).
    const alert = /^\s{0,3}>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(line)
    if (alert) {
      const icon = ALERT_ICONS[alert[1].toLowerCase()] ?? '💡'
      const body: string[] = []
      if (alert[2].trim()) body.push(`**${inlinePass(alert[2].trim(), images)}**`, '')
      while (index + 1 < input.length && /^\s{0,3}>/.test(input[index + 1])) body.push(inlinePass(input[++index].replace(/^\s{0,3}>\s?/, ''), images))
      while (body.length && !body[body.length - 1].trim()) body.pop()
      out.push('', '<aside>', `${icon} ${body.shift() ?? ''}`, ...body, '</aside>', '')
      continue
    }

    // Citação aninhada: linha em branco ">" antes de aprofundar, para virar filho.
    const quote = /^\s{0,3}((?:>\s?)+)/.exec(line)
    if (quote) {
      const depth = (quote[1].match(/>/g) ?? []).length
      if (quoteDepth && depth > quoteDepth) out.push('>'.repeat(quoteDepth))
      quoteDepth = depth
    } else quoteDepth = 0

    // Tabela GFM: guarda o alinhamento da linha separadora, na ordem do documento.
    if (/^\s*\|/.test(line) && index + 1 < input.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(input[index + 1]) && /\|/.test(input[index + 1])) alignments.push(alignmentOf(input[index + 1]))

    line = inlinePass(line, images)
    out.push(line)
  }
  return { text: out.join('\n'), images, alignments }
}

const ctx = (): ConvertContext => ({ file: '', resolvePage: () => null, isChild: () => false, resolveAsset: () => null, warn: () => {}, referenced: new Set() })

function inlineFallback(nodes: InlineNode[], support: SchemaSupport): InlineNode[] {
  if (support.inline('inlineEquation')) return nodes
  return nodes.map((node) => node.type === 'inlineEquation' ? { type: 'text', text: node.props.latex, styles: { code: true } } : node)
}

function plainText(content: unknown): string {
  return Array.isArray(content) ? content.map((node: { text?: string; content?: { text: string }[] }) => node.text ?? node.content?.map((part) => part.text).join('') ?? '').join('') : ''
}

/** Ajustes finais: títulos ≤ 3, imagens, alinhamento, fallbacks de schema. */
function finish(blocks: Block[], prepared: Prepared, support: SchemaSupport, tables: { next: number }): Block[] {
  const out: Block[] = []
  for (const block of blocks) {
    block.children = finish(block.children ?? [], prepared, support, tables)
    if (block.type === 'heading') block.props = { ...block.props, level: Math.min(3, Number(block.props?.level) || 1) }
    if (Array.isArray(block.content)) {
      const text = plainText(block.content)
      const image = new RegExp(`^${IMG}(\\d+)${IMG}$`).exec(text.trim())
      if (image && block.type === 'paragraph' && prepared.images[Number(image[1])]) {
        const { url, alt } = prepared.images[Number(image[1])]
        out.push({ id: block.id, type: 'image', props: { url, name: alt, caption: alt, showPreview: true }, children: [] }, ...block.children)
        continue
      }
      if (text.includes(IMG)) {
        block.content = block.content.map((node) => node.type === 'text' ? { ...node, text: node.text.replace(new RegExp(`${IMG}(\\d+)${IMG}`, 'g'), (_m, n: string) => prepared.images[Number(n)]?.alt ?? '') } : node)
      }
      block.content = inlineFallback(block.content, support)
    }
    if (block.type === 'table' && block.content && !Array.isArray(block.content)) {
      const align = prepared.alignments[tables.next++] ?? []
      block.content.rows = block.content.rows.map((row) => ({
        cells: row.cells.map((cell, column) => ({ type: 'tableCell', props: align[column] ? { textAlignment: align[column] } : {}, content: inlineFallback(cell, support) })) as never,
      }))
    }
    if (!support.block(block.type)) {
      if (block.type === 'callout') { out.push({ ...block, type: 'quote', props: {} }); continue }
      if (block.type === 'equation') { out.push({ id: block.id, type: 'codeBlock', props: { language: 'text' }, content: [{ type: 'text', text: String(block.props?.latex ?? ''), styles: {} }], children: [] }); continue }
      if (block.type === 'mermaid') { out.push({ id: block.id, type: 'codeBlock', props: { language: 'text' }, content: [{ type: 'text', text: String(block.props?.source ?? ''), styles: {} }], children: [] }); continue }
      if (block.type === 'image' || block.type === 'page' || block.type === 'pdfPreview') continue
      out.push({ ...block, type: 'paragraph', props: {} }); continue
    }
    out.push(block)
  }
  return out
}

/** Converte Markdown (já identificado como tal) em blocos JSON do editor. */
export function markdownToPasteBlocks(source: string, support: SchemaSupport = fullSupport): Block[] {
  const prepared = prepareMarkdown(source)
  const blocks = parseMarkdownBlocks(prepared.text, ctx())
  return finish(blocks, prepared, support, { next: 0 })
}

/** Tabela simples do editor a partir de linhas TSV. */
export function tsvToTableBlock(rows: string[][]): Block {
  return { id: crypto.randomUUID(), type: 'table', props: {}, content: { type: 'tableContent', rows: rows.map((row) => ({ cells: row.map((cell) => cell ? [{ type: 'text', text: cell, styles: {} }] : []) })) }, children: [] }
}

/**
 * Divide Markdown grande em fatias que podem ser convertidas separadamente: corta só em linha
 * em branco seguida de linha sem recuo, fora de cercas/equações/<details>.
 */
export function splitMarkdownChunks(source: string, size: number): string[] {
  if (source.length <= size) return [source]
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const chunks: string[] = []
  let current: string[] = [], length = 0, fence: string | null = null, math = false, details = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const open = FENCE.exec(line)
    if (fence) { if (line.trim().startsWith(fence)) fence = null }
    else if (open) fence = open[2]
    else if (/^\s*(\$\$|\\\[|\\\])\s*$/.test(line)) math = !math
    details += (line.match(/<details\b/gi) ?? []).length - (line.match(/<\/details>/gi) ?? []).length
    current.push(line); length += line.length + 1
    const next = lines[index + 1]
    if (length >= size && !fence && !math && details <= 0 && line.trim() === '' && next !== undefined && /^\S/.test(next) && !/^(\d+[.)]|[-*+])\s/.test(next) && !/^\s*\|/.test(next)) {
      chunks.push(current.join('\n')); current = []; length = 0
    }
  }
  if (current.length) chunks.push(current.join('\n'))
  return chunks
}
