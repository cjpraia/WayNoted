// Inferência de tipos para a importação de CSV (puro, sem store/DOM). Colunas mistas viram texto.
import type { PropValue } from '../../types'

export type CsvColumnType = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'checkbox' | 'url' | 'email' | 'phone' | 'ignore'
export const CSV_COLUMN_TYPES: CsvColumnType[] = ['text', 'number', 'date', 'select', 'multiSelect', 'checkbox', 'url', 'email', 'phone', 'ignore']

export interface ColumnPlan {
  index: number
  header: string
  type: CsvColumnType
  /** Formatos da propriedade criada (número). */
  numberFormat?: 'number' | 'currency' | 'percent'
  currency?: string
  /** Número: separador decimal; data: ordem das partes das datas com barra. */
  decimal?: '.' | ','
  dateOrder?: 'dmy' | 'mdy'
  /** A ordem dia/mês não pôde ser deduzida dos dados; foi usado o idioma do app. */
  ambiguousDate?: boolean
  multiSeparator?: ',' | ';'
  /** Valores não vazios que não cabem no tipo escolhido. */
  problems: number
  sample: string[]
}

const CURRENCIES: [RegExp, string][] = [[/^R\$\s*/i, 'BRL'], [/^US\$\s*|^\$\s*/i, 'USD'], [/^€\s*/, 'EUR'], [/^£\s*/, 'GBP']]
const CHECK_TRUE = new Set(['sim', 's', 'true', 'verdadeiro', 'yes', 'y', 'x', '✓', '✔'])
const CHECK_FALSE = new Set(['não', 'nao', 'n', 'false', 'falso', 'no'])
const URL_RE = /^(?:https?:\/\/|www\.)[^\s/$.?#][^\s]*$/i
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/
const PHONE_RE = /^\+?[\d\s().-]{8,22}$/

const isEmpty = (cell: string | undefined) => !cell || !cell.trim()

export interface ParsedNumber { value: number; percent: boolean; currency?: string }

/** Número em formato brasileiro (1.234,56) ou americano (1,234.56). `decimal` desfaz a ambiguidade de "1.234". */
export function parseNumberCell(raw: string, decimal: '.' | ','): ParsedNumber | null {
  let s = raw.trim()
  if (!s) return null
  let negative = false, percent = false, currency: string | undefined
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim() }
  if (s.startsWith('-') || s.startsWith('−')) { negative = true; s = s.slice(1).trim() }
  for (const [re, code] of CURRENCIES) if (re.test(s)) { currency = code; s = s.replace(re, ''); break }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim() }
  if (s.endsWith('%')) { percent = true; s = s.slice(0, -1).trim() }
  s = s.replace(/(\d)[\s\u00a0](?=\d{3}(?!\d))/g, '$1')
  if (!/^\d[\d.,]*$/.test(s)) return null
  const thousands = decimal === ',' ? '.' : ','
  const body = s
  const parts = body.split(decimal)
  if (parts.length > 2) return null
  const intPart = parts[0], frac = parts[1]
  if (frac !== undefined && !/^\d+$/.test(frac)) return null
  const groups = intPart.split(thousands)
  if (groups.length > 1 && !(/^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g)))) return null
  if (groups.length === 1 && !/^\d+$/.test(intPart)) return null
  const digits = groups.join('')
  if (/^0\d/.test(digits) && frac === undefined && groups.length === 1) return null // "007": identificador, não número
  const value = Number(`${digits}${frac !== undefined ? '.' + frac : ''}`)
  if (!Number.isFinite(value) || digits.length > 15) return null
  return { value: negative ? -value : value, percent, currency }
}

interface DateParts { y: number; m: number; d: number; time?: string }

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(y, m, 0).getDate()
}
const pad = (n: number) => String(n).padStart(2, '0')
const TIME = '(?:[T\\s]+(\\d{1,2}):(\\d{2})(?::\\d{2}(?:\\.\\d+)?)?\\s*(?:Z|[+-]\\d{2}:?\\d{2})?\\s*([ap]m)?)?'
const ISO_RE = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})${TIME}$`, 'i')
const SLASH_RE = new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})${TIME}$`, 'i')

function timeOf(h?: string, mi?: string, ap?: string): string | undefined | null {
  if (h === undefined) return undefined
  let hour = Number(h)
  if (ap) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0) }
  if (hour > 23 || Number(mi) > 59) return null
  return `${pad(hour)}:${mi}`
}

/** Forma de uma data: iso, ou barra com as duas primeiras partes (a ordem é decidida por coluna). */
function dateShape(cell: string): { kind: 'iso'; parts: DateParts } | { kind: 'slash'; a: number; b: number; y: number; time?: string } | null {
  const s = cell.trim()
  let m = ISO_RE.exec(s)
  if (m) {
    const time = timeOf(m[4], m[5], m[6])
    if (time === null || !validDate(+m[1], +m[2], +m[3])) return null
    return { kind: 'iso', parts: { y: +m[1], m: +m[2], d: +m[3], ...(time ? { time } : {}) } }
  }
  m = SLASH_RE.exec(s)
  if (m) {
    const time = timeOf(m[4], m[5], m[6])
    if (time === null) return null
    return { kind: 'slash', a: +m[1], b: +m[2], y: +m[3], ...(time ? { time } : {}) }
  }
  return null
}

export function parseDateCell(cell: string, order: 'dmy' | 'mdy'): { start: string; startTime?: string } | null {
  const shape = dateShape(cell)
  if (!shape) return null
  let y: number, m: number, d: number, time: string | undefined
  if (shape.kind === 'iso') ({ y, m, d, time } = shape.parts)
  else { y = shape.y; time = shape.time; if (order === 'dmy') { d = shape.a; m = shape.b } else { m = shape.a; d = shape.b } }
  if (!validDate(y, m, d)) return null
  return { start: `${y}-${pad(m)}-${pad(d)}`, ...(time ? { startTime: time } : {}) }
}

export function inferColumn(index: number, header: string, cells: string[], locale = 'pt-BR'): ColumnPlan {
  const filled = cells.filter((c) => !isEmpty(c)).map((c) => c.trim())
  const sample = filled.slice(0, 5)
  const base: ColumnPlan = { index, header, type: 'text', problems: 0, sample }
  if (!filled.length) return base
  const allOf = (test: (c: string) => boolean) => filled.every(test)

  // Checkbox: 1/0 só quando toda a coluna é assim; palavras exigem ao menos um valor reconhecido.
  const lower = filled.map((c) => c.toLowerCase())
  if (lower.every((c) => c === '0' || c === '1')) return { ...base, type: 'checkbox' }
  if (lower.every((c) => CHECK_TRUE.has(c) || CHECK_FALSE.has(c))) return { ...base, type: 'checkbox' }

  if (allOf((c) => URL_RE.test(c))) return { ...base, type: 'url' }
  if (allOf((c) => EMAIL_RE.test(c))) return { ...base, type: 'email' }
  if (allOf((c) => PHONE_RE.test(c) && /[+()\s.-]/.test(c) && (c.match(/\d/g)?.length ?? 0) >= 8 && !dateShape(c))) return { ...base, type: 'phone' }

  // Datas
  const shapes = filled.map(dateShape)
  if (shapes.every((s) => s)) {
    let dmy = false, mdy = false, slash = 0
    for (const s of shapes) if (s?.kind === 'slash') { slash++; if (s.a > 12) dmy = true; if (s.b > 12) mdy = true }
    if (!(dmy && mdy)) {
      const ambiguous = slash > 0 && !dmy && !mdy && shapes.some((s) => s?.kind === 'slash' && s.a !== s.b)
      const order: 'dmy' | 'mdy' = dmy ? 'dmy' : mdy ? 'mdy' : locale === 'en-US' ? 'mdy' : 'dmy'
      if (filled.every((c) => parseDateCell(c, order))) return { ...base, type: 'date', dateOrder: order, ...(ambiguous ? { ambiguousDate: true } : {}) }
    }
  }

  // Números: o separador decimal vem dos dados; sem evidência, do idioma.
  let commaDec = 0, dotDec = 0
  for (const c of filled) {
    const num = c.replace(/[^\d.,]/g, '')
    const lastComma = num.lastIndexOf(','), lastDot = num.lastIndexOf('.')
    if (lastComma >= 0 && lastDot >= 0) { if (lastComma > lastDot) commaDec++; else dotDec++ }
    else if (lastComma >= 0 && (num.length - lastComma - 1 !== 3 || (num.match(/,/g)?.length ?? 0) === 1 && /^0/.test(num))) commaDec++
    else if (lastDot >= 0 && (num.length - lastDot - 1 !== 3 || (num.match(/\./g)?.length ?? 0) === 1 && /^0/.test(num))) dotDec++
  }
  const decimal: '.' | ',' = commaDec > dotDec ? ',' : dotDec > commaDec ? '.' : locale === 'en-US' ? '.' : ','
  const numbers = filled.map((c) => parseNumberCell(c, decimal))
  if (numbers.every((n) => n)) {
    const list = numbers as ParsedNumber[]
    const pct = list.filter((n) => n.percent).length
    const codes = new Set(list.map((n) => n.currency).filter(Boolean))
    if (pct === 0 || pct === list.length) {
      if (codes.size <= 1 && !(pct && codes.size)) {
        const currency = [...codes][0]
        return { ...base, type: 'number', decimal, numberFormat: pct ? 'percent' : currency ? 'currency' : 'number', ...(currency ? { currency } : {}) }
      }
    }
  }

  // Seleção / multisseleção: poucos valores repetidos.
  const distinct = new Set(filled)
  const MAX_OPTIONS = 20
  const seps: (',' | ';')[] = [';', ',']
  for (const sep of seps) {
    const withSep = filled.filter((c) => c.includes(sep)).length
    if (!withSep) continue
    const tokens = filled.flatMap((c) => c.split(sep).map((x) => x.trim()).filter(Boolean))
    const set = new Set(tokens)
    if (set.size >= 2 && set.size <= MAX_OPTIONS && tokens.length >= set.size * 2 && withSep >= Math.max(1, filled.length * 0.2) && tokens.every((x) => x.length <= 40)) return { ...base, type: 'multiSelect', multiSeparator: sep }
  }
  if (distinct.size >= 1 && distinct.size <= MAX_OPTIONS && filled.length >= distinct.size * 2 && filled.length >= 4 && [...distinct].every((x) => x.length <= 40)) return { ...base, type: 'select' }
  return base
}

/** Nomes únicos para colunas novas (cabeçalhos duplicados ou vazios recebem sufixo). */
export function uniqueHeaders(headers: string[], fallback = 'Coluna'): string[] {
  const seen = new Map<string, number>()
  return headers.map((raw, i) => {
    const name = raw.trim() || `${fallback} ${i + 1}`
    const key = name.toLowerCase()
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? name : `${name} (${count})`
  })
}

/** Converte uma célula conforme o plano. `null` em `ok` = valor não vazio inválido para o tipo. */
export function convertPlannedCell(plan: ColumnPlan, cell: string): { value: PropValue; ok: boolean } {
  const s = cell.trim()
  if (!s) return { value: null, ok: true }
  switch (plan.type) {
    case 'number': {
      const n = parseNumberCell(s, plan.decimal ?? ',')
      return n ? { value: n.percent ? Math.round(n.value * 1e10) / 1e10 / 100 : n.value, ok: true } : { value: null, ok: false }
    }
    case 'date': {
      const d = parseDateCell(s, plan.dateOrder ?? 'dmy')
      return d ? { value: d, ok: true } : { value: null, ok: false }
    }
    case 'checkbox': {
      const l = s.toLowerCase()
      if (l === '1' || CHECK_TRUE.has(l)) return { value: true, ok: true }
      if (l === '0' || CHECK_FALSE.has(l)) return { value: false, ok: true }
      return { value: null, ok: false }
    }
    case 'url': return { value: s, ok: URL_RE.test(s) }
    case 'email': return { value: s, ok: EMAIL_RE.test(s) }
    case 'phone': return { value: s, ok: PHONE_RE.test(s) }
    default: return { value: s, ok: true }
  }
}

/** Reavalia o plano depois que o usuário trocou o tipo: refaz formatos e conta as células inválidas. */
export function replanColumn(plan: ColumnPlan, type: CsvColumnType, cells: string[], locale = 'pt-BR'): ColumnPlan {
  const inferred = inferColumn(plan.index, plan.header, cells, locale)
  const next: ColumnPlan = { ...inferred, type, problems: 0 }
  if (type === 'number' && inferred.type !== 'number') { next.decimal = locale === 'en-US' ? '.' : ','; next.numberFormat = 'number' }
  if (type === 'date' && inferred.type !== 'date') next.dateOrder = locale === 'en-US' ? 'mdy' : 'dmy'
  if (type === 'multiSelect') next.multiSeparator = inferred.multiSeparator ?? (cells.some((c) => c.includes(';')) ? ';' : ',')
  if (type === 'select' || type === 'multiSelect' || type === 'text' || type === 'ignore') return next
  next.problems = cells.reduce((count, cell) => count + (convertPlannedCell(next, cell).ok ? 0 : 1), 0)
  return next
}

/** Inferência de todas as colunas. Fatiado por quem chama via `from`/`to` para não travar a interface. */
export function inferColumns(rows: string[][], headers: string[], locale = 'pt-BR', from = 0, to = headers.length): ColumnPlan[] {
  const names = uniqueHeaders(headers)
  const out: ColumnPlan[] = []
  for (let c = from; c < to; c++) {
    const cells: string[] = new Array(rows.length)
    for (let r = 0; r < rows.length; r++) cells[r] = rows[r][c] ?? ''
    out.push(inferColumn(c, names[c], cells, locale))
  }
  return out
}

export function countIssues(plans: ColumnPlan[]): number {
  return plans.reduce((sum, p) => sum + (p.type === 'ignore' ? 0 : p.problems), 0)
}
