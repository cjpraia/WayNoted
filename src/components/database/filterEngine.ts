// Núcleo puro de filtro/ordenação dos bancos (sem store e sem React). Usado por `applyView` (lib.ts)
// e pelas consultas vivas (src/query). Estende o filtro original com:
// - datas relativas guardadas como texto no valor do filtro (`@today`, `@today+7d`, `@thisWeek`,
//   `@nextMonth`, `@past7d`, `@next30d`…), avaliadas no dia corrente do fuso pedido;
// - `@thisPage` (página onde a consulta está) em relações;
// - opções de seleção comparadas por id OU por nome (consultas atravessam bancos com ids diferentes);
// - operadores <, >, ≤, ≥ e "não é" também em datas.
import type { DateValue, Filter, Page, Property, PropValue, SelectOption } from '../../types'
import { isFileArray, isStringArray } from './derived.ts'
import { isRichTextValue, richTextPlain } from './richText.ts'
import { formatDateValueText } from './formatting.ts'

export interface FilterEnv {
  pages: Record<string, Page>
  locale?: string
  /** Instante de referência para datas relativas (padrão: agora). */
  now?: Date | number
  /** Fuso IANA para "hoje" e para o dia de carimbos de tempo (padrão: fuso do sistema). */
  timeZone?: string
  /** 0 = domingo, 1 = segunda (padrão 0, como pt-BR/en-US). */
  weekStart?: 0 | 1
  /** Página que contém a consulta (`@thisPage`). */
  thisPageId?: string
}

export type SortKey = string | number | null

const pad = (n: number) => String(n).padStart(2, '0')
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function isEmptyFilterValue(value: PropValue): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}
export function isDateLike(value: PropValue): value is DateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'start' in value
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
/** Dia civil 'AAAA-MM-DD' de um instante no fuso pedido (ou no fuso do sistema). */
export function dayInZone(instant: number | Date, timeZone?: string): string {
  const date = typeof instant === 'number' ? new Date(instant) : instant
  if (!timeZone) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  let format = zoneFormatters.get(timeZone)
  if (!format) {
    try { format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }) } catch { return dayInZone(date) }
    zoneFormatters.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// Aritmética de dias civis em UTC (sem horário de verão).
const toUtc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }
const fromUtc = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }
export function shiftDay(iso: string, days: number): string { return fromUtc(toUtc(iso) + days * 86_400_000) }
function shiftMonth(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12), month = total - year * 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, last))}`
}
const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay()
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`
const monthEnd = (iso: string) => shiftDay(shiftMonth(monthStart(iso), 1), -1)

export interface DayRange { start: string; end: string }
export const RELATIVE_DATE = /^@(today|yesterday|tomorrow|thisWeek|lastWeek|nextWeek|thisMonth|lastMonth|nextMonth|thisYear|lastYear|nextYear|past(\d{1,4})d|next(\d{1,4})d)(?:([+-])(\d{1,4})([dwmy]))?$/

export function isRelativeDate(value: unknown): value is string { return typeof value === 'string' && RELATIVE_DATE.test(value) }

/** Hoje no fuso do ambiente. */
export function todayFor(env: Pick<FilterEnv, 'now' | 'timeZone'> = {}): string {
  return dayInZone(env.now === undefined ? Date.now() : typeof env.now === 'number' ? env.now : env.now.getTime(), env.timeZone)
}

/** Converte o valor de filtro de data (ISO ou relativo) num intervalo de dias inclusivo. */
export function resolveDateRange(value: unknown, env: Pick<FilterEnv, 'now' | 'timeZone' | 'weekStart'> = {}): DayRange | null {
  if (typeof value !== 'string') return null
  if (ISO_DAY.test(value)) return { start: value, end: value }
  const match = RELATIVE_DATE.exec(value)
  if (!match) return null
  const today = todayFor(env)
  const ws = env.weekStart ?? 0
  const weekOf = (iso: string): DayRange => { const start = shiftDay(iso, -((weekday(iso) - ws + 7) % 7)); return { start, end: shiftDay(start, 6) } }
  const monthOf = (iso: string): DayRange => ({ start: monthStart(iso), end: monthEnd(iso) })
  const yearOf = (iso: string): DayRange => ({ start: `${iso.slice(0, 4)}-01-01`, end: `${iso.slice(0, 4)}-12-31` })
  let range: DayRange
  switch (match[1]) {
    case 'today': range = { start: today, end: today }; break
    case 'yesterday': { const d = shiftDay(today, -1); range = { start: d, end: d }; break }
    case 'tomorrow': { const d = shiftDay(today, 1); range = { start: d, end: d }; break }
    case 'thisWeek': range = weekOf(today); break
    case 'lastWeek': range = weekOf(shiftDay(today, -7)); break
    case 'nextWeek': range = weekOf(shiftDay(today, 7)); break
    case 'thisMonth': range = monthOf(today); break
    case 'lastMonth': range = monthOf(shiftMonth(monthStart(today), -1)); break
    case 'nextMonth': range = monthOf(shiftMonth(monthStart(today), 1)); break
    case 'thisYear': range = yearOf(today); break
    case 'lastYear': range = yearOf(`${Number(today.slice(0, 4)) - 1}-01-01`); break
    case 'nextYear': range = yearOf(`${Number(today.slice(0, 4)) + 1}-01-01`); break
    default:
      if (match[2]) range = { start: shiftDay(today, -Number(match[2])), end: today }
      else range = { start: today, end: shiftDay(today, Number(match[3])) }
  }
  if (match[4]) {
    const amount = Number(match[5]) * (match[4] === '-' ? -1 : 1)
    const unit = match[6]
    const move = (iso: string) => unit === 'd' ? shiftDay(iso, amount) : unit === 'w' ? shiftDay(iso, amount * 7) : unit === 'm' ? shiftMonth(iso, amount) : shiftMonth(iso, amount * 12)
    range = { start: move(range.start), end: move(range.end) }
  }
  return range
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()

/** Opção por id ou, para consultas entre bancos, por nome (sem acentos/caixa). */
export function optionFor(prop: Property, key: unknown): SelectOption | undefined {
  if (typeof key !== 'string') return undefined
  const byId = prop.options?.find((option) => option.id === key)
  if (byId) return byId
  const name = fold(key)
  return prop.options?.find((option) => fold(option.name) === name)
}

/** Texto puro de um valor (sem store): mesmo formato de `valueToText`. */
export function valueText(value: PropValue, prop: Property, pages: Record<string, Page>, locale = 'pt-BR'): string {
  if (isEmptyFilterValue(value)) return ''
  if (isRichTextValue(value)) return richTextPlain(value)
  if (prop.type === 'createdTime' || prop.type === 'updatedTime') return typeof value === 'number' ? new Date(value).toLocaleString(locale) : ''
  if (isDateLike(value)) {
    const text = formatDateValueText(value, locale, { dateFormat: prop.dateFormat, timeFormat: prop.timeFormat })
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return value.timeZone && value.timeZone !== localZone && (value.startTime || value.endTime) ? `${text} · ${value.timeZone}` : text
  }
  if (isFileArray(value)) return value.map((file) => file.name).join(', ')
  if (isStringArray(value)) return value.map((id) => prop.type === 'relation' ? pages[id]?.title ?? '' : prop.type === 'rollup' ? id : prop.options?.find((option) => option.id === id)?.name ?? '').filter(Boolean).join(', ')
  if (typeof value === 'boolean') return value ? locale === 'en-US' ? 'Yes' : 'Sim' : locale === 'en-US' ? 'No' : 'Não'
  if (prop.type === 'select' || prop.type === 'status') return prop.options?.find((option) => option.id === value)?.name ?? ''
  if (typeof value === 'number') return value.toLocaleString(locale)
  if (typeof value === 'object' && value && 'label' in value) return String((value as { label: unknown }).label ?? '')
  return String(value)
}

function compareRange(value: DayRange, op: Filter['op'], range: DayRange): boolean {
  switch (op) {
    case 'before': case 'lt': return value.start < range.start
    case 'after': case 'gt': return value.end > range.end
    case 'lte': return value.start <= range.end
    case 'gte': return value.end >= range.start
    case 'isNot': return value.end < range.start || value.start > range.end
    default: return value.start <= range.end && range.start <= value.end
  }
}

/** Um valor (já resolvido) passa no filtro? Mesma semântica do filtro de visualização dos bancos. */
export function matchValue(value: PropValue, prop: Property, filter: Pick<Filter, 'op' | 'value'>, env: FilterEnv): boolean {
  const empty = isEmptyFilterValue(value)
  const fv = filter.value
  if (filter.op === 'isEmpty') return empty
  if (filter.op === 'isNotEmpty') return !empty
  // Filtro ainda sem valor definido não restringe nada.
  if (prop.type !== 'checkbox' && (fv === null || fv === '' || fv === undefined)) return true

  switch (prop.type) {
    case 'checkbox': {
      const want = fv === true || fv === 'true'
      return filter.op === 'isNot' ? (value === true) !== want : (value === true) === want
    }
    case 'number':
    case 'formula':
    case 'rollup':
    case 'uniqueId': {
      if (typeof value !== 'number') {
        if (prop.type === 'number' || typeof value === 'boolean' || value === null) return filter.op === 'isNot'
        return textMatch(valueText(value, prop, env.pages, env.locale), filter.op, fv)
      }
      const n = Number(fv)
      if (filter.op === 'is') return value === n
      if (filter.op === 'isNot') return value !== n
      if (filter.op === 'gt' || filter.op === 'after') return value > n
      if (filter.op === 'lt' || filter.op === 'before') return value < n
      if (filter.op === 'gte') return value >= n
      if (filter.op === 'lte') return value <= n
      return textMatch(String(value), filter.op, fv)
    }
    case 'select':
    case 'status': {
      const target = optionFor(prop, fv)?.id ?? fv
      if (filter.op === 'contains' || filter.op === 'notContains') return textMatch(valueText(value, prop, env.pages, env.locale), filter.op, fv)
      return filter.op === 'isNot' ? value !== target : value === target
    }
    case 'multiSelect': {
      const target = optionFor(prop, fv)?.id ?? String(fv)
      const has = isStringArray(value) && value.includes(target)
      return filter.op === 'notContains' || filter.op === 'isNot' ? !has : has
    }
    case 'relation': {
      const id = fv === '@thisPage' ? env.thisPageId : typeof fv === 'string' && env.pages[fv] ? fv : undefined
      if (id !== undefined || fv === '@thisPage') {
        const has = !!id && isStringArray(value) && value.includes(id)
        return filter.op === 'notContains' || filter.op === 'isNot' ? !has : has
      }
      return textMatch(valueText(value, prop, env.pages, env.locale), filter.op, fv)
    }
    case 'createdTime':
    case 'updatedTime': {
      const range = resolveDateRange(fv, env)
      if (typeof value !== 'number' || !range) return false
      const day = dayInZone(value, env.timeZone)
      return compareRange({ start: day, end: day }, filter.op, range)
    }
    case 'date': {
      const range = resolveDateRange(fv, env)
      if (!isDateLike(value) || !range) return false
      return compareRange({ start: value.start, end: value.end ?? value.start }, filter.op, range)
    }
    default:
      return textMatch(valueText(value, prop, env.pages, env.locale), filter.op, fv)
  }
}

function textMatch(text: string, op: Filter['op'], fv: unknown): boolean {
  const lower = text.toLowerCase()
  const q = String(fv).toLowerCase()
  if (op === 'contains') return lower.includes(q)
  if (op === 'notContains') return !lower.includes(q)
  if (op === 'isNot') return lower !== q
  if (op === 'gt' || op === 'after') return lower > q
  if (op === 'lt' || op === 'before') return lower < q
  if (op === 'gte') return lower >= q
  if (op === 'lte') return lower <= q
  return lower === q
}

/** Chave de ordenação de um valor resolvido. Vazios devolvem null (vão para o fim). */
export function sortKeyOf(value: PropValue, prop: Property, env: Pick<FilterEnv, 'pages' | 'locale'>): SortKey {
  if (isEmptyFilterValue(value)) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (isDateLike(value)) return value.start
  // Seleções ordenam pela posição da opção no esquema, como no Export Bundle.
  if (prop.type === 'select' || prop.type === 'status') return prop.options?.findIndex((o) => o.id === value) ?? 0
  return valueText(value, prop, env.pages, env.locale).toLowerCase()
}

/** Valores de filtro que dependem do dia atual tornam o cache por linha dependente da data. */
export function filtersDependOnToday(values: readonly unknown[]): boolean { return values.some(isRelativeDate) }
