import type { RichTextRun, RichTextValue } from '../../database-models'

export function isRichTextValue(value: unknown): value is RichTextValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as RichTextValue).type === 'richText' && Array.isArray((value as RichTextValue).runs)
}

export function richTextPlain(value: RichTextValue): string { return value.runs.map((run) => run.text).join('') }

/** Só links navegáveis explícitos; protocolos executáveis e credenciais são rejeitados. */
export function safeRichHref(input: string): string | undefined {
  try {
    const url = new URL(input)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined
  } catch { return undefined }
}

function coalesce(runs: RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const previous = out[out.length - 1]
    const marks = { ...run, text: '' }
    if (previous && JSON.stringify({ ...previous, text: '' }) === JSON.stringify(marks)) previous.text += run.text
    else out.push({ ...run })
  }
  return out
}

export function replaceRichRange(value: RichTextValue, start: number, end: number, text: string): RichTextValue {
  const plain = richTextPlain(value)
  const lo = Math.max(0, Math.min(start, plain.length))
  const hi = Math.max(lo, Math.min(end, plain.length))
  let offset = 0
  const before: RichTextRun[] = []
  const after: RichTextRun[] = []
  for (const run of value.runs) {
    const a = offset, b = a + run.text.length
    if (a < lo) before.push({ ...run, text: run.text.slice(0, Math.min(run.text.length, lo - a)) })
    if (b > hi) after.push({ ...run, text: run.text.slice(Math.max(0, hi - a)) })
    offset = b
  }
  const inherited = before[before.length - 1] ?? value.runs.find((run) => run.text.length > 0)
  return { type: 'richText', runs: coalesce([...before, text ? { ...inherited, text } : { text: '' }, ...after]) }
}

export function markRichRange(value: RichTextValue, start: number, end: number, patch: Partial<RichTextRun>): RichTextValue {
  if (end <= start) return value
  const out: RichTextRun[] = []
  let offset = 0
  for (const run of value.runs) {
    const a = offset, b = a + run.text.length
    const lo = Math.max(a, start), hi = Math.min(b, end)
    if (lo >= hi) out.push(run)
    else {
      if (lo > a) out.push({ ...run, text: run.text.slice(0, lo - a) })
      const next = { ...run, ...patch, text: run.text.slice(lo - a, hi - a) }
      if (!next.href) delete next.href
      out.push(next)
      if (hi < b) out.push({ ...run, text: run.text.slice(hi - a) })
    }
    offset = b
  }
  return { type: 'richText', runs: coalesce(out) }
}

// ---------------------------------------------------------------------------
// Edição inline (contenteditable ↔ runs). Funções puras sobre texto/runs e um
// percurso de DOM que só usa a API estrutural (funciona no navegador e no jsdom).
// ---------------------------------------------------------------------------

export type RichMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
export const RICH_MARKS: RichMark[] = ['bold', 'italic', 'underline', 'strike', 'code']

const MARK_KEYS = ['bold', 'italic', 'underline', 'strike', 'code', 'href', 'color', 'background'] as const

function sameMarks(a: RichTextRun, b: RichTextRun): boolean {
  return MARK_KEYS.every((key) => (a[key] || undefined) === (b[key] || undefined))
}

/** Junta runs vizinhos de mesma formatação, remove vazios e chaves falsas (`bold: false`). */
export function normalizeRuns(runs: RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const clean: RichTextRun = { text: run.text }
    for (const key of MARK_KEYS) {
      const v = run[key]
      if (v) (clean as unknown as Record<string, unknown>)[key] = v
    }
    const previous = out[out.length - 1]
    if (previous && sameMarks(previous, clean)) previous.text += clean.text
    else out.push(clean)
  }
  return out
}

/** Runs de um valor de propriedade de texto (string, número, richText ou vazio). */
export function valueToRuns(value: unknown): RichTextRun[] {
  if (isRichTextValue(value)) return normalizeRuns(value.runs)
  if (value === null || value === undefined) return []
  return normalizeRuns([{ text: String(value) }])
}

/** Valor a gravar: sem formatação vira `string` (caminho rápido), vazio vira `null`. */
export function runsToStored(runs: RichTextRun[]): string | RichTextValue | null {
  const clean = normalizeRuns(runs)
  const text = clean.map((run) => run.text).join('')
  if (text.trim() === '') return null
  if (clean.every((run) => MARK_KEYS.every((key) => !run[key]))) return text
  return { type: 'richText', runs: clean }
}

export function sameStored(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isRichTextValue(a) || isRichTextValue(b)) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (a ?? null) === (b ?? null)
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML mínimo (sem estilos inline) que representa os runs; `\n` vira `<br>`. */
export function runsToHtml(runs: RichTextRun[]): string {
  return normalizeRuns(runs).map((run) => {
    let html = escapeHtml(run.text).replace(/\n/g, '<br>')
    if (run.code) html = `<code>${html}</code>`
    if (run.strike) html = `<s>${html}</s>`
    if (run.underline) html = `<u>${html}</u>`
    if (run.italic) html = `<i>${html}</i>`
    if (run.bold) html = `<b>${html}</b>`
    const href = run.href && safeRichHref(run.href)
    if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`
    if (run.color || run.background) {
      html = `<span${run.color ? ` data-rt-color="${escapeHtml(run.color)}"` : ''}${run.background ? ` data-rt-bg="${escapeHtml(run.background)}"` : ''}>${html}</span>`
    }
    return html
  }).join('')
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE', 'SECTION', 'ARTICLE'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TEMPLATE', 'META', 'TITLE', 'NOSCRIPT'])

interface ElementLike extends Node { tagName: string; getAttribute(name: string): string | null; style?: { fontWeight?: string; fontStyle?: string; textDecorationLine?: string; textDecoration?: string } }

/**
 * Percorre um DOM de contenteditable (ou HTML colado) e devolve runs. Reconhece b/strong, i/em, u,
 * s/strike/del, code, a[href] e estilos inline equivalentes; `<br>` e blocos viram `\n`.
 * `trimTrailing`: descarta o `\n` do `<br>` de preenchimento que o navegador deixa no fim.
 */
export function domToRuns(root: Node, options: { trimTrailing?: boolean } = {}): RichTextRun[] {
  const { trimTrailing = true } = options
  const out: RichTextRun[] = []
  const lastChar = () => { for (let i = out.length - 1; i >= 0; i--) if (out[i].text) return out[i].text.slice(-1); return '' }
  const walk = (node: Node, marks: Partial<RichTextRun>) => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/ /g, ' ').replace(/[\r​]/g, '')
      if (text) out.push({ ...marks, text })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as ElementLike
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) return
    if (tag === 'BR') { out.push({ text: '\n' }); return }
    const block = BLOCK_TAGS.has(tag)
    if (block && out.length && lastChar() !== '\n') out.push({ text: '\n' })
    const next: Partial<RichTextRun> = { ...marks }
    if (tag === 'B' || tag === 'STRONG') next.bold = true
    if (tag === 'I' || tag === 'EM') next.italic = true
    if (tag === 'U') next.underline = true
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') next.code = true
    if (tag === 'A') { const href = safeRichHref(el.getAttribute('href') ?? ''); if (href) next.href = href }
    const style = el.style
    if (style) {
      const weight = style.fontWeight ?? ''
      if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) next.bold = true
      if (style.fontStyle === 'italic') next.italic = true
      const deco = `${style.textDecorationLine ?? ''} ${style.textDecoration ?? ''}`
      if (deco.includes('underline')) next.underline = true
      if (deco.includes('line-through')) next.strike = true
    }
    const color = el.getAttribute('data-rt-color'), bg = el.getAttribute('data-rt-bg')
    if (color) next.color = color
    if (bg) next.background = bg
    for (const child of Array.from(node.childNodes)) walk(child, next)
  }
  for (const child of Array.from(root.childNodes)) walk(child, {})
  if (trimTrailing && root.lastChild && root.lastChild.nodeType === 1 && (root.lastChild as unknown as ElementLike).tagName.toUpperCase() === 'BR' && out.length && out[out.length - 1].text === '\n') out.pop()
  return normalizeRuns(out)
}

/** HTML colado → runs suportados (negrito/itálico/sublinhado/tachado/código/link); o resto vira texto limpo. */
export function htmlToRuns(html: string): RichTextRun[] {
  if (typeof DOMParser === 'undefined') return normalizeRuns([{ text: html }])
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return domToRuns(doc.body, { trimTrailing: false })
}

/** Markdown em linha (`**negrito**`, `*itálico*`, `~~tachado~~`, `` `código` ``, `[texto](url)`) → runs. */
export function hasInlineMarkdown(text: string): boolean {
  return /\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\((https?:\/\/|mailto:)[^)\s]+\)/.test(text)
}

export function markdownToRuns(text: string): RichTextRun[] {
  const out: RichTextRun[] = []
  const pattern = /\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|(?<![*\w])\*([^*\n]+)\*(?![*\w])/g
  let last = 0
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ text: m[1], bold: true })
    else if (m[2] !== undefined) out.push({ text: m[2], strike: true })
    else if (m[3] !== undefined) out.push({ text: m[3], code: true })
    else if (m[4] !== undefined) {
      const href = safeRichHref(m[5])
      out.push(href ? { text: m[4], href } : { text: m[4] })
    } else out.push({ text: m[6], italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return normalizeRuns(out)
}

export function runsSlice(runs: RichTextRun[], start: number, end: number): RichTextRun[] {
  const out: RichTextRun[] = []
  let offset = 0
  for (const run of runs) {
    const a = offset, b = a + run.text.length
    offset = b
    const lo = Math.max(a, start), hi = Math.min(b, end)
    if (lo < hi) out.push({ ...run, text: run.text.slice(lo - a, hi - a) })
  }
  return out
}

/** Marcas presentes em TODOS os caracteres de [start, end). */
export function marksInRange(runs: RichTextRun[], start: number, end: number): Set<RichMark> {
  const slice = runsSlice(runs, start, end)
  return new Set(slice.length ? RICH_MARKS.filter((mark) => slice.every((run) => !!run[mark])) : [])
}

/** Link comum a todo o trecho (ou `undefined`). */
export function hrefInRange(runs: RichTextRun[], start: number, end: number): string | undefined {
  const slice = runsSlice(runs, start, end)
  const first = slice[0]?.href
  return first && slice.every((run) => run.href === first) ? first : undefined
}

/** Se `pos` está dentro/na borda de um link, devolve o intervalo completo desse link. */
export function linkRangeAt(runs: RichTextRun[], pos: number): { start: number; end: number; href: string } | undefined {
  const bounds: { a: number; b: number; href?: string }[] = []
  let offset = 0
  for (const run of runs) { bounds.push({ a: offset, b: offset + run.text.length, href: run.href }); offset += run.text.length }
  let i = bounds.findIndex((x) => x.href && pos >= x.a && pos <= x.b)
  if (i < 0) return undefined
  const href = bounds[i].href as string
  let lo = i, hi = i
  while (lo > 0 && bounds[lo - 1].href === href) lo--
  while (hi < bounds.length - 1 && bounds[hi + 1].href === href) hi++
  return { start: bounds[lo].a, end: bounds[hi].b, href }
}

/** Liga/desliga uma marca no trecho: se todo o trecho já a tem, remove; senão aplica. */
export function toggleMarkInRange(runs: RichTextRun[], start: number, end: number, mark: RichMark): RichTextRun[] {
  if (end <= start) return runs
  const on = !marksInRange(runs, start, end).has(mark)
  return normalizeRuns(markRichRange({ type: 'richText', runs }, start, end, { [mark]: on }).runs)
}

export function setLinkInRange(runs: RichTextRun[], start: number, end: number, href: string | undefined): RichTextRun[] {
  if (end <= start) return runs
  return normalizeRuns(markRichRange({ type: 'richText', runs }, start, end, { href }).runs)
}

export function clearFormatInRange(runs: RichTextRun[], start: number, end: number): RichTextRun[] {
  if (end <= start) return runs
  return normalizeRuns(markRichRange({ type: 'richText', runs }, start, end, { bold: false, italic: false, underline: false, strike: false, code: false, href: undefined, color: undefined, background: undefined }).runs)
}

/** Aceita "exemplo.com" (assume https) e e-mails; rejeita protocolos perigosos. */
export function normalizeLinkInput(input: string): string | undefined {
  const raw = input.trim()
  if (!raw) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return safeRichHref(raw)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return safeRichHref(`mailto:${raw}`)
  return safeRichHref(`https://${raw}`)
}

// --- Seleção ↔ deslocamentos de texto -------------------------------------------------

/** Deslocamentos [start, end) do texto (mesma contagem de `domToRuns`) da seleção dentro de `root`. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = root.ownerDocument.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const measure = (container: Node, offset: number) => {
    const r = root.ownerDocument.createRange()
    r.selectNodeContents(root)
    r.setEnd(container, offset)
    const holder = root.ownerDocument.createElement('div')
    holder.appendChild(r.cloneContents())
    return richTextPlain({ type: 'richText', runs: domToRuns(holder, { trimTrailing: false }) }).length
  }
  const start = measure(range.startContainer, range.startOffset)
  const end = range.collapsed ? start : measure(range.endContainer, range.endOffset)
  return { start, end }
}

function locate(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset
  const walk = (node: Node): { node: Node; offset: number } | null => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const len = (child.nodeValue ?? '').length
        if (remaining <= len) return { node: child, offset: remaining }
        remaining -= len
      } else if (child.nodeType === 1) {
        if ((child as Element).tagName === 'BR') {
          const parent = child.parentNode as Node
          const index = Array.prototype.indexOf.call(parent.childNodes, child)
          if (remaining === 0) return { node: parent, offset: index }
          remaining -= 1
          if (remaining === 0 && !child.nextSibling && parent === root) return { node: parent, offset: index + 1 }
        } else {
          const found = walk(child)
          if (found) return found
        }
      }
    }
    return null
  }
  return walk(root) ?? { node: root, offset: root.childNodes.length }
}

export function setSelectionOffsets(root: HTMLElement, start: number, end: number = start) {
  const doc = root.ownerDocument
  const sel = doc.getSelection()
  if (!sel) return
  const a = locate(root, start), b = start === end ? a : locate(root, end)
  const range = doc.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

// --- Inserção na seleção (execCommand quando existe: mantém o desfazer nativo) ----------

/** Substitui a seleção atual por HTML. Usa `insertHTML` do navegador (desfazer nativo) ou um fallback por Range. */
export function insertHtmlAtSelection(root: HTMLElement, html: string) {
  const doc = root.ownerDocument
  let ok = false
  try { ok = typeof doc.execCommand === 'function' && doc.execCommand('insertHTML', false, html) } catch { ok = false }
  if (ok) return
  const sel = doc.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const holder = doc.createElement('template')
  holder.innerHTML = html
  const frag = holder.content
  const last = frag.lastChild
  range.insertNode(frag)
  if (last) { range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range) }
}

/** Quebra de linha na posição do cursor (Shift+Enter). */
export function insertLineBreak(root: HTMLElement) {
  const doc = root.ownerDocument
  let ok = false
  try { ok = typeof doc.execCommand === 'function' && doc.execCommand('insertLineBreak') } catch { ok = false }
  if (ok) return
  const sel = doc.getSelection()
  if (!sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const br = doc.createElement('br')
  range.insertNode(br)
  // No fim do conteúdo o navegador precisa de um segundo <br> para mostrar a linha nova.
  if (!br.nextSibling) br.after(doc.createElement('br'))
  range.setStartAfter(br)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}
