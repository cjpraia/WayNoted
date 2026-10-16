// Agregações do Painel de Produtividade (puro). Dias são chaves 'YYYY-MM-DD' no fuso local; a
// aritmética de datas é feita em UTC sobre as chaves, imune a mudanças de horário de verão.
import type { ProductivityData, ProductivityDay } from '../../electron/productivity-data.mjs'

export type Period = 'all' | '30d' | '7d' | 'today'
export type Metric = 'words' | 'edits' | 'tasks' | 'created'
export const METRICS: Metric[] = ['words', 'edits', 'tasks', 'created']

const DAY_MS = 86400000
const toUTC = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fromUTC = (ms: number) => { const date = new Date(ms); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` }
export const addDays = (key: string, days: number) => fromUTC(toUTC(key) + days * DAY_MS)
export const daysBetween = (from: string, to: string) => Math.round((toUTC(to) - toUTC(from)) / DAY_MS)
/** 0 = domingo … 6 = sábado. */
export const weekdayOf = (key: string) => new Date(toUTC(key)).getUTCDay()
export const startOfWeek = (key: string, weekStart: 0 | 1) => addDays(key, -((weekdayOf(key) - weekStart + 7) % 7))

export function isActive(day: ProductivityDay | undefined): boolean {
  return !!day && (day.words > 0 || day.edits > 0 || day.created > 0 || day.tasks > 0)
}

/** Primeiro dia incluído no período (null = tudo). */
export function periodStart(period: Period, today: string): string | null {
  return period === 'today' ? today : period === '7d' ? addDays(today, -6) : period === '30d' ? addDays(today, -29) : null
}
function inPeriod(key: string, period: Period, today: string) { const start = periodStart(period, today); return key <= today && (start === null || key >= start) }

export interface Summary {
  words: number; edits: number; sessions: number; created: number; tasks: number
  activeDays: number; estimatedDays: number
  /** Edições por hora local no período. */
  hours: number[]
  /** Edições por dia da semana (0 = domingo). */
  weekdays: number[]
  peakHour: number | null
  busiestWeekday: number | null
}

export function summarize(data: ProductivityData, period: Period, today: string): Summary {
  const summary: Summary = { words: 0, edits: 0, sessions: 0, created: 0, tasks: 0, activeDays: 0, estimatedDays: 0, hours: new Array(24).fill(0), weekdays: new Array(7).fill(0), peakHour: null, busiestWeekday: null }
  for (const [key, day] of Object.entries(data.days)) {
    if (!inPeriod(key, period, today)) continue
    summary.words += day.words; summary.edits += day.edits; summary.sessions += day.sessions
    summary.created += day.created; summary.tasks += day.tasks
    if (isActive(day)) { summary.activeDays++; if (day.estimated) summary.estimatedDays++ }
    day.hours.forEach((count, hour) => { summary.hours[hour] += count })
    summary.weekdays[weekdayOf(key)] += day.edits
  }
  const peak = (values: number[]) => { let best = -1, at: number | null = null; values.forEach((v, i) => { if (v > best && v > 0) { best = v; at = i } }); return at }
  summary.peakHour = peak(summary.hours)
  summary.busiestWeekday = peak(summary.weekdays)
  return summary
}

/**
 * Sequência atual (dias seguidos com atividade até hoje; se hoje ainda não teve atividade, a sequência
 * que terminou ontem continua valendo — sem cobrança) e a maior já registrada.
 */
export function streaks(data: ProductivityData, today: string): { current: number; longest: number } {
  const active = Object.keys(data.days).filter(key => key <= today && isActive(data.days[key])).sort()
  let longest = 0, run = 0, previous: string | null = null
  for (const key of active) {
    run = previous && daysBetween(previous, key) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = key
  }
  let current = 0
  for (let key = isActive(data.days[today]) ? today : addDays(today, -1); isActive(data.days[key]); key = addDays(key, -1)) current++
  return { current, longest }
}

export interface Totals { words: number; edits: number; tasks: number; created: number }
const totalsBetween = (data: ProductivityData, from: string, to: string): Totals => {
  const totals = { words: 0, edits: 0, tasks: 0, created: 0 }
  for (const [key, day] of Object.entries(data.days)) if (key >= from && key <= to) for (const metric of METRICS) totals[metric] += day[metric]
  return totals
}
const change = (now: number, before: number) => before > 0 ? Math.round(((now - before) / before) * 100) : null

/** Semana atual até hoje × o mesmo número de dias da semana anterior (comparação justa no meio da semana). */
export function weekComparison(data: ProductivityData, today: string, weekStart: 0 | 1) {
  const start = startOfWeek(today, weekStart), elapsed = daysBetween(start, today)
  const current = totalsBetween(data, start, today)
  const previous = totalsBetween(data, addDays(start, -7), addDays(start, -7 + elapsed))
  return { start, current, previous, change: Object.fromEntries(METRICS.map(metric => [metric, change(current[metric], previous[metric])])) as Record<Metric, number | null> }
}

export interface HeatCell { key: string; value: number; level: 0 | 1 | 2 | 3 | 4; inRange: boolean; estimated: boolean; day?: ProductivityDay }
export interface Heatmap { weeks: HeatCell[][]; months: { column: number; month: number; year: number }[]; first: string; last: string; max: number }

/**
 * Mapa de calor: 53 semanas terminando na semana de `end`. `from` limita o intervalo exibido (ex.: 1º de
 * janeiro no modo ano). Níveis 1–4 pelos quartis dos dias com valor > 0 dentro do intervalo.
 */
export function heatmap(data: ProductivityData, end: string, weekStart: 0 | 1, metric: Metric, from: string = addDays(end, -364)): Heatmap {
  const lastWeek = startOfWeek(end, weekStart), firstWeek = addDays(lastWeek, -52 * 7)
  const values: number[] = []
  const weeks: HeatCell[][] = []
  for (let column = 0; column < 53; column++) {
    const week: HeatCell[] = []
    for (let row = 0; row < 7; row++) {
      const key = addDays(firstWeek, column * 7 + row), day = data.days[key], inRange = key >= from && key <= end
      const value = inRange && day ? day[metric] : 0
      if (value > 0) values.push(value)
      week.push({ key, value, level: 0, inRange, estimated: !!day?.estimated, ...(inRange && day ? { day } : {}) })
    }
    weeks.push(week)
  }
  values.sort((a, b) => a - b)
  const q = (p: number) => values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
  for (const week of weeks) for (const cell of week) if (cell.value > 0) cell.level = cell.value <= q1 ? 1 : cell.value <= q2 ? 2 : cell.value <= q3 ? 3 : 4
  const months: Heatmap['months'] = []
  weeks.forEach((week, column) => {
    const firstOfMonth = week.find(cell => cell.key.endsWith('-01'))
    const anchor = column === 0 ? week[0] : firstOfMonth
    if (!anchor) return
    const [y, m] = anchor.key.split('-').map(Number)
    if (column === 0 && !firstOfMonth && week[0].key.slice(8) > '21') return // evita rótulo espremido antes do próximo mês
    months.push({ column, month: m - 1, year: y })
  })
  return { weeks, months, first: firstWeek, last: addDays(firstWeek, 53 * 7 - 1), max: values.at(-1) ?? 0 }
}

export function yearsWithData(data: ProductivityData, today: string): number[] {
  const years = new Set(Object.keys(data.days).filter(key => isActive(data.days[key])).map(key => Number(key.slice(0, 4))))
  years.add(Number(today.slice(0, 4)))
  return [...years].sort((a, b) => b - a)
}

/** Páginas mais trabalhadas no período (ids crus; títulos e visibilidade são resolvidos na exibição). */
export function topPageIds(data: ProductivityData, period: Period, today: string): { id: string; words: number; edits: number }[] {
  const totals = new Map<string, { id: string; words: number; edits: number }>()
  for (const [key, day] of Object.entries(data.days)) {
    if (!inPeriod(key, period, today) || !day.pages) continue
    for (const [id, [words, edits]] of Object.entries(day.pages)) {
      const entry = totals.get(id) ?? { id, words: 0, edits: 0 }
      entry.words += words; entry.edits += edits
      totals.set(id, entry)
    }
  }
  return [...totals.values()].sort((a, b) => b.words + b.edits * 5 - (a.words + a.edits * 5) || (a.id < b.id ? -1 : 1))
}

/**
 * Agrupa em páginas e bancos: linhas de banco somam no banco (e não aparecem como página). Páginas
 * protegidas por senha (ou dentro de uma), na lixeira ou ausentes nunca aparecem — `visible` decide.
 */
export function workedLists<P extends { id: string; parentId: string | null; database?: unknown }>(
  entries: { id: string; words: number; edits: number }[], pages: Record<string, P>, visible: (id: string) => boolean, limit = 8,
) {
  const pageList: { page: P; words: number; edits: number }[] = []
  const databases = new Map<string, { page: P; words: number; edits: number }>()
  for (const entry of entries) {
    const page = pages[entry.id]
    if (!page || !visible(page.id)) continue
    const parent = page.parentId ? pages[page.parentId] : undefined
    if (parent?.database) {
      if (!visible(parent.id)) continue
      const current = databases.get(parent.id) ?? { page: parent, words: 0, edits: 0 }
      current.words += entry.words; current.edits += entry.edits
      databases.set(parent.id, current)
    } else if (page.database) {
      const current = databases.get(page.id) ?? { page, words: 0, edits: 0 }
      current.words += entry.words; current.edits += entry.edits
      databases.set(page.id, current)
    } else pageList.push({ page, words: entry.words, edits: entry.edits })
  }
  const order = (a: { words: number; edits: number }, b: { words: number; edits: number }) => b.words + b.edits * 5 - (a.words + a.edits * 5)
  return { pages: pageList.sort(order).slice(0, limit), databases: [...databases.values()].sort(order).slice(0, limit) }
}

/** Início da semana: preferência explícita ou a convenção do idioma (Intl.Locale weekInfo; padrão domingo). */
export function resolveWeekStart(setting: 'auto' | 'sunday' | 'monday' | undefined, locale: string): 0 | 1 {
  if (setting === 'sunday') return 0
  if (setting === 'monday') return 1
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay
    if (firstDay === 1) return 1
  } catch { /* Intl sem weekInfo: domingo. */ }
  return 0
}
