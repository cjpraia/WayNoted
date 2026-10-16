// Front-matter YAML de notas do Markdown Vault (subconjunto prático): escalares, listas (`- a` ou `[a, b]`),
// strings com aspas, blocos `|`/`>` e mapas aninhados (mantidos como texto). Puro e tolerante (Postel).
export type FmValue = string | number | boolean | null | string[]
export interface Frontmatter { data: Record<string, FmValue>; keys: string[]; body: string; found: boolean }

function unquote(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => c === 'n' ? '\n' : c === 't' ? '\t' : c)
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s
}
function stripComment(raw: string): string {
  let quote = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i)
  }
  return raw
}
function splitInline(raw: string): string[] {
  const out: string[] = []
  let current = '', quote = ''
  for (const c of raw) {
    if (quote) { current += c; if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; current += c; continue }
    if (c === ',') { out.push(current); current = ''; continue }
    current += c
  }
  if (current.trim()) out.push(current)
  return out.map(unquote).filter(item => item !== '')
}
function scalar(raw: string): string | number | boolean | null {
  const s = stripComment(raw).trim()
  if (s === '' || s === '~' || /^null$/i.test(s)) return null
  if (/^(true|yes|on)$/i.test(s) && !/^['"]/.test(s)) return true
  if (/^(false|no|off)$/i.test(s)) return false
  if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 16 && !/^-?0\d/.test(s)) return Number(s)
  return unquote(s)
}

export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const open = /^---[ \t]*\n/.exec(text)
  if (!open) return { data: {}, keys: [], body: text, found: false }
  const lines = text.slice(open[0].length).split('\n')
  let end = lines.findIndex(line => /^(---|\.\.\.)[ \t]*$/.test(line))
  if (end < 0) return { data: {}, keys: [], body: text, found: false }
  const body = lines.slice(end + 1).join('\n')
  const data: Record<string, FmValue> = {}
  const keys: string[] = []
  for (let i = 0; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = /^([^\s:#][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line)
    if (!match) continue
    const key = unquote(match[1])
    const rest = (match[2] ?? '').trim()
    let value: FmValue
    if (rest === '' || /^[|>][+-]?$/.test(rest)) {
      const block: string[] = []
      while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || /^\s*$/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]))) block.push(lines[++i])
      while (block.length && !block[block.length - 1].trim()) block.pop()
      if (/^[|>]/.test(rest)) {
        const indent = Math.min(...block.filter(l => l.trim()).map(l => /^\s*/.exec(l)![0].length), Infinity)
        const content = block.map(l => l.slice(Number.isFinite(indent) ? indent : 0))
        value = rest.startsWith('>') ? content.join(' ').replace(/\s+/g, ' ').trim() : content.join('\n')
      } else if (block.length && block.every(l => !l.trim() || /^\s*-(\s|$)/.test(l))) {
        value = block.filter(l => l.trim()).map(l => unquote(stripComment(l.replace(/^\s*-\s*/, ''))))
      } else if (block.length) {
        // Mapa aninhado: guarda como linhas "chave: valor" legíveis.
        value = block.map(l => l.trim()).filter(Boolean).join('; ')
      } else value = null
    } else if (rest.startsWith('[') && rest.endsWith(']')) value = splitInline(rest.slice(1, -1))
    else value = scalar(rest)
    if (!(key in data)) keys.push(key)
    data[key] = value
  }
  return { data, keys, body, found: true }
}

/** Texto de exibição de um valor (listas viram "a, b"; booleanos "Sim"/"Não" ficam a cargo de quem chama). */
export function fmText(value: FmValue): string {
  if (value === null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Lista de strings de um campo que pode ser texto, lista ou "a, b" (aliases, tags). */
export function fmList(value: FmValue | undefined): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean)
  return String(value).split(/[,;]/).map(item => item.trim()).filter(Boolean)
}

/** "2026-10-08", "2026-10-08T10:00", "08/10/2026" → ms, ou null. */
export function fmDate(value: FmValue | undefined): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  const br = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s)
  const time = br ? Date.UTC(+br[3], +br[2] - 1, +br[1], 12) : /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s.length === 10 ? `${s}T12:00:00Z` : s) : NaN
  return Number.isFinite(time) ? time : null
}
