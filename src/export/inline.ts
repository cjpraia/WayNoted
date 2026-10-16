// Conteúdo inline do BlockNote ⇄ Markdown. O formato gerado é Markdown comum (GFM),
// com HTML mínimo para o que o Markdown não expressa (sublinhado, cores, datas).
import { object, type RawInline } from './model.ts'

export interface InlineWriteContext {
  /** Converte um href do documento no destino do link Markdown. */
  href(href: string): string
}
export interface InlineReadContext {
  /** Converte o destino do link Markdown de volta num href do documento. */
  href(destination: string): string
}

type Styles = Record<string, unknown>
const BOOLEAN_STYLES = ['bold', 'italic', 'underline', 'strike', 'code']

export function normalizeInline(content: unknown): RawInline[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content, styles: {} }] : []
  if (!Array.isArray(content)) return []
  return content.filter(object) as RawInline[]
}

const ENTITY = /&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|nbsp);/i
function escapeText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if ('\\*`[]<~$|'.includes(char)) out += '\\' + char
    else if (char === '_' && !(/[\p{L}\p{N}]/u.test(text[i - 1] ?? '') && /[\p{L}\p{N}]/u.test(text[i + 1] ?? ''))) out += '\\_'
    else if (char === '&' && ENTITY.test(text.slice(i, i + 10))) out += '&amp;'
    else if (char === '\n') out += '<br>'
    else out += char
  }
  return out
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim()) ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function attr(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

function writeText(item: RawInline): string {
  const text = String(item.text ?? '')
  if (!text) return ''
  const styles = object(item.styles) ? item.styles : {}
  const lead = styles.code ? '' : /^\s*/.exec(text)![0], trail = styles.code ? '' : /\s*$/.exec(text.slice(lead.length))![0]
  const core = text.slice(lead.length, text.length - trail.length)
  if (!core) return escapeText(text)
  let out = styles.code ? core.split('\n').map(codeSpan).join('<br>') : escapeText(core)
  if (styles.italic) out = `*${out}*`
  if (styles.bold) out = `**${out}**`
  if (styles.strike) out = `~~${out}~~`
  if (styles.underline) out = `<u>${out}</u>`
  const extra = Object.fromEntries(Object.entries(styles).filter(([name, value]) => !BOOLEAN_STYLES.includes(name) && name !== 'textColor' && name !== 'backgroundColor' && value !== undefined && value !== false))
  const color = typeof styles.textColor === 'string' && styles.textColor !== 'default' ? ` data-color="${attr(styles.textColor)}"` : ''
  const background = typeof styles.backgroundColor === 'string' && styles.backgroundColor !== 'default' ? ` data-bg="${attr(styles.backgroundColor)}"` : ''
  const other = Object.keys(extra).length ? ` data-styles="${attr(JSON.stringify(extra))}"` : ''
  if (color || background || other) out = `<span${color}${background}${other}>${out}</span>`
  return escapeText(lead) + out + escapeText(trail)
}

export function inlineToMarkdown(content: unknown, ctx: InlineWriteContext): string {
  return normalizeInline(content).map((item) => {
    if (item.type === 'text' || item.type === undefined) return writeText(item)
    if (item.type === 'link') {
      const inner = inlineToMarkdown(item.content, ctx) || escapeText(String(item.href ?? ''))
      return `[${inner}](${linkDestination(ctx.href(String(item.href ?? '')))})`
    }
    if (item.type === 'inlineEquation') return `$${String(item.props?.latex ?? '').replace(/(^|[^\\])\$/g, '$1\\$')}$`
    if (item.type === 'dateMention') {
      const props = item.props ?? {}
      const page = props.pageId ? ` data-page="${attr(String(props.pageId))}"` : ''
      const id = props.id ? ` data-id="${attr(String(props.id))}"` : ''
      const start = props.startDate ? ` data-start="${attr(String(props.startDate))}"` : ''
      return `<time datetime="${attr(String(props.date ?? ''))}"${page}${id}${start}>${escapeText(String(props.date ?? ''))}</time>`
    }
    // Tipo inline desconhecido: preserva os dados num atributo e mostra o texto.
    const label = typeof item.text === 'string' ? item.text : Array.isArray(item.content) ? inlinePlain(item.content) : String(item.type)
    return `<span data-np-inline="${attr(JSON.stringify(item))}">${escapeText(label)}</span>`
  }).join('')
}

/** Destinos com espaço ou parênteses vão entre `< >` (CommonMark). */
export function linkDestination(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>\n]/g, (char) => encodeURIComponent(char))}>` : href
}

export function inlinePlain(content: unknown): string {
  return normalizeInline(content).map((item) => item.type === 'link' ? inlinePlain(item.content) : item.type === 'inlineEquation' ? String(item.props?.latex ?? '') : item.type === 'dateMention' ? String(item.props?.date ?? '') : String(item.text ?? '')).join('')
}

// ---------- leitura ----------

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|nbsp);/gi, (_match, code: string) => {
    const lower = code.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'nbsp') return ' '
    return String.fromCodePoint(lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10))
  })
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of tag.matchAll(/([a-z-]+)="([^"]*)"/gi)) out[match[1].toLowerCase()] = decodeEntities(match[2])
  return out
}

function sameStyles(a: Styles, b: Styles): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** Junta trechos de texto vizinhos com os mesmos estilos (forma canônica). */
export function mergeText(items: RawInline[]): RawInline[] {
  const out: RawInline[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (item.type === 'text' && !item.text) continue
    if (item.type === 'text' && last?.type === 'text' && sameStyles(last.styles ?? {}, item.styles ?? {})) last.text = String(last.text) + item.text
    else out.push(item.type === 'text' ? { type: 'text', text: item.text, styles: { ...(item.styles ?? {}) } } : item)
  }
  return out
}

function findLinkEnd(source: string, start: number): { text: string; destination: string; end: number } | null {
  let depth = 0
  let i = start
  for (; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') { i++; continue }
    if (char === '`') { const run = /^`+/.exec(source.slice(i))![0]; const close = source.indexOf(run, i + run.length); if (close > 0) i = close + run.length - 1; continue }
    if (char === '[') depth++
    else if (char === ']') { if (depth === 0) break; depth-- }
  }
  if (source[i] !== ']' || source[i + 1] !== '(') return null
  const text = source.slice(start, i)
  let j = i + 2
  let destination = ''
  if (source[j] === '<') {
    const close = source.indexOf('>', j)
    if (close < 0) return null
    destination = source.slice(j + 1, close)
    j = close + 1
  } else {
    let parens = 0
    const begin = j
    for (; j < source.length; j++) {
      const char = source[j]
      if (char === '\\') { j++; continue }
      if (char === '(') parens++
      else if (char === ')') { if (parens === 0) break; parens-- }
      else if (char === ' ') break
    }
    destination = source.slice(begin, j)
  }
  const close = source.indexOf(')', j)
  if (close < 0) return null
  return { text, destination: destination.replace(/\\(.)/g, '$1'), end: close + 1 }
}

export function markdownToInline(source: string, ctx: InlineReadContext): RawInline[] {
  const items: RawInline[] = []
  const styles: Styles = {}
  const spans: Styles[] = []
  let text = ''
  const current = (): Styles => {
    const out: Styles = {}
    for (const [key, value] of Object.entries(styles)) if (value) out[key] = value
    for (const span of spans) Object.assign(out, span)
    return out
  }
  let active = current()
  const flush = () => { if (text) items.push({ type: 'text', text, styles: active }); text = '' }
  const restyle = () => { const next = current(); if (!sameStyles(next, active)) { flush(); active = next } }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const rest = source.slice(i)
    if (char === '\\' && i + 1 < source.length && /[!-/:-@[-`{-~]/.test(source[i + 1])) { text += source[i + 1]; i++; continue }
    if (char === '`') {
      const run = /^`+/.exec(rest)![0]
      const close = source.indexOf(run, i + run.length)
      if (close > 0 && source[close + run.length] !== '`') {
        let code = source.slice(i + run.length, close)
        if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        flush()
        items.push({ type: 'text', text: code, styles: { ...current(), code: true } })
        i = close + run.length - 1
        continue
      }
      text += run; i += run.length - 1; continue
    }
    if (rest.startsWith('**')) { styles.bold = !styles.bold; restyle(); i++; continue }
    if (char === '*') { styles.italic = !styles.italic; restyle(); continue }
    if (rest.startsWith('~~')) { styles.strike = !styles.strike; restyle(); i++; continue }
    if (/^<u>/i.test(rest)) { styles.underline = true; restyle(); i += 2; continue }
    if (/^<\/u>/i.test(rest)) { styles.underline = false; restyle(); i += 3; continue }
    if (/^<br\s*\/?>/i.test(rest)) { text += '\n'; i += /^<br\s*\/?>/i.exec(rest)![0].length - 1; continue }
    const span = /^<span\b[^>]*>/i.exec(rest)
    if (span) {
      const values = attrs(span[0])
      if (values['data-np-inline']) {
        const close = source.indexOf('</span>', i + span[0].length)
        try {
          const raw = JSON.parse(values['data-np-inline'])
          if (close > 0 && object(raw)) { flush(); items.push(raw as RawInline); i = close + 6; continue }
        } catch { /* mostra o texto */ }
      }
      const next: Styles = {}
      if (values['data-color']) next.textColor = values['data-color']
      if (values['data-bg']) next.backgroundColor = values['data-bg']
      if (values['data-styles']) { try { Object.assign(next, JSON.parse(values['data-styles'])) } catch { /* ignora */ } }
      spans.push(next); restyle(); i += span[0].length - 1; continue
    }
    if (/^<\/span>/i.test(rest)) { spans.pop(); restyle(); i += 6; continue }
    const time = /^<time\b[^>]*>([\s\S]*?)<\/time>/i.exec(rest)
    if (time) {
      const values = attrs(time[0].slice(0, time[0].indexOf('>') + 1))
      flush()
      items.push({ type: 'dateMention', props: { id: values['data-id'] ?? '', date: values.datetime ?? decodeEntities(time[1]), pageId: values['data-page'] ?? '', ...(/^\d{4}-\d{2}-\d{2}$/.test(values['data-start'] ?? '') ? { startDate: values['data-start'] } : {}) } })
      i += time[0].length - 1
      continue
    }
    if (char === '$') {
      let j = i + 1
      for (; j < source.length; j++) { if (source[j] === '\\') { j++; continue } if (source[j] === '$') break }
      if (j < source.length && j > i + 1) {
        flush()
        items.push({ type: 'inlineEquation', props: { latex: source.slice(i + 1, j) } })
        i = j
        continue
      }
    }
    if (char === '[') {
      const link = findLinkEnd(source, i + 1)
      if (link) {
        flush()
        const content = markdownToInline(link.text, ctx).filter((item) => item.type === 'text')
        items.push({ type: 'link', href: ctx.href(link.destination), content })
        i = link.end - 1
        continue
      }
    }
    if (char === '&') {
      const entity = /^&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|nbsp);/i.exec(rest)
      if (entity) { text += decodeEntities(entity[0]); i += entity[0].length - 1; continue }
    }
    text += char
  }
  flush()
  return mergeText(items)
}
