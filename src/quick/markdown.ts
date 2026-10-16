import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.ts'
// Markdown leve da nota rápida → blocos BlockNote (JSON). Sem dependências: roda no renderer e nos testes.

export interface InlineText { type: 'text'; text: string; styles: Record<string, true> }
export interface InlineLink { type: 'link'; href: string; content: InlineText[] }
export type Inline = InlineText | InlineLink
export interface QuickBlock {
  id: string
  type: string
  props: Record<string, string | number | boolean>
  content?: Inline[]
  children: QuickBlock[]
}

const BASE = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' } as const
const newId = () => crypto.randomUUID()
const SAFE_LINK = new RegExp(`^(https?:|mailto:|(?:${[PRODUCT.protocol, COMPAT.previousProtocol, ...PRODUCT.protocolAliases].join("|")}):)`, "i")

/** Negrito (**), itálico (* ou _), código (crase), ~~riscado~~, [texto](url) e URLs soltas. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  const push = (text: string, styles: Record<string, true> = {}) => {
    if (!text) return
    const last = out.at(-1)
    if (last?.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(styles)) last.text += text
    else out.push({ type: 'text', text, styles })
  }
  const pattern = /\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g
  let index = 0
  for (const match of source.matchAll(pattern)) {
    push(source.slice(index, match.index))
    const [, bold, bold2, strike, code, label, href, italic, italic2, url] = match
    if (bold ?? bold2) for (const part of parseInline(bold ?? bold2)) pushStyled(part, { bold: true })
    else if (strike) for (const part of parseInline(strike)) pushStyled(part, { strike: true })
    else if (code) push(code, { code: true })
    else if (label && href) {
      if (SAFE_LINK.test(href)) out.push({ type: 'link', href, content: parseInline(label).flatMap(part => part.type === 'text' ? [part] : part.content) })
      else push(match[0])
    } else if (italic ?? italic2) for (const part of parseInline(italic ?? italic2)) pushStyled(part, { italic: true })
    else if (url) out.push({ type: 'link', href: url, content: [{ type: 'text', text: url, styles: {} }] })
    index = match.index + match[0].length
  }
  push(source.slice(index))
  return out

  function pushStyled(part: Inline, styles: Record<string, true>) {
    if (part.type === 'text') push(part.text, { ...part.styles, ...styles })
    else out.push({ ...part, content: part.content.map(text => ({ ...text, styles: { ...text.styles, ...styles } })) })
  }
}

function block(type: string, text: string | null, props: Record<string, string | number | boolean> = {}): QuickBlock {
  return { id: newId(), type, props: { ...BASE, ...props }, ...(text === null ? {} : { content: parseInline(text) }), children: [] }
}

const indentOf = (line: string) => line.replace(/\t/g, '  ').match(/^ */)![0].length

/** Converte o texto da nota em blocos. Listas aninhadas por recuo (2 espaços ou tab). */
export function markdownToBlocks(markdown: string): QuickBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const root: QuickBlock[] = []
  const stack: { indent: number; block: QuickBlock }[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(raw)
    if (fence) {
      const body: string[] = []
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i])
      const code: QuickBlock = { id: newId(), type: 'codeBlock', props: { language: fence[1] || 'text' }, content: body.length ? [{ type: 'text', text: body.join('\n'), styles: {} }] : [], children: [] }
      root.push(code); stack.length = 0; continue
    }
    if (!raw.trim()) { stack.length = 0; continue }
    const indent = indentOf(raw), line = raw.trim()
    let item: QuickBlock | null = null
    let m: RegExpExecArray | null
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) item = block('heading', m[2], { level: m[1].length })
    else if ((m = /^[-*+]\s+\[( |x|X)\]\s*(.*)$/.exec(line))) item = block('checkListItem', m[2], { checked: m[1] !== ' ' })
    else if ((m = /^\[( |x|X)\]\s+(.*)$/.exec(line))) item = block('checkListItem', m[2], { checked: m[1] !== ' ' })
    else if ((m = /^[-*+]\s+(.*)$/.exec(line))) item = block('bulletListItem', m[1])
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) item = block('numberedListItem', m[1])
    else if ((m = /^>\s?(.*)$/.exec(line))) item = block('quote', m[1])
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) item = { id: newId(), type: 'divider', props: {}, children: [] }
    else item = block('paragraph', line)
    const nestable = ['bulletListItem', 'numberedListItem', 'checkListItem'].includes(item.type)
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = indent > 0 ? stack.at(-1) : undefined
    if (parent) parent.block.children.push(item)
    else { root.push(item); if (!nestable) stack.length = 0 }
    if (nestable) stack.push({ indent, block: item })
  }
  return root
}

/** Texto puro dos blocos (para o contador e para validar nota vazia). */
export function blocksPlainText(blocks: QuickBlock[]): string {
  return blocks.map(item => [(item.content ?? []).map(part => part.type === 'text' ? part.text : part.content.map(text => text.text).join('')).join(''), blocksPlainText(item.children)].filter(Boolean).join('\n')).filter(Boolean).join('\n')
}
