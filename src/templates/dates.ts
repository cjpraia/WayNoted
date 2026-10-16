// Datas civis puras (sem store, sem React) usadas por modelos com variáveis e pela nota diária.
import { addDays } from '../../electron/recurrence.mjs'

export type DailyLocale = 'pt-BR' | 'en-US'
export const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]
export const utc = (iso: string) => { const [y, m, d] = ymd(iso); return new Date(Date.UTC(y, m - 1, d)) }
export const isISODate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && utc(value).toISOString().slice(0, 10) === value
export { addDays }

/** Dia local (fuso do sistema) de um instante. */
export function localDay(epoch = Date.now()): string {
  const d = new Date(epoch)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Semana ISO-8601 (segunda a domingo; semana 1 contém a primeira quinta do ano). */
export function isoWeek(iso: string): number {
  const date = utc(iso)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

/** Primeiro dia da semana do idioma (0 = domingo, 1 = segunda), com preferência explícita. */
export function weekStartFor(locale: string, preference: 'auto' | 'sunday' | 'monday' = 'auto'): 0 | 1 {
  if (preference === 'sunday') return 0
  if (preference === 'monday') return 1
  try {
    const info = (new Intl.Locale(locale) as unknown as { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } })
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay
    if (first === 1) return 1
    if (first === 7) return 0
  } catch { /* Intl.Locale sem weekInfo: usa o padrão abaixo. */ }
  // pt-BR e en-US começam no domingo; demais idiomas europeus, na segunda.
  return /^(pt-BR|en-US|en-CA|es-MX|ja|ko|zh|he)/.test(locale) ? 0 : 1
}

/** Grade de 6 semanas do mês (42 dias), começando no dia da semana pedido. */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): string[] {
  const first = `${year}-${pad(month)}-01`
  const offset = (utc(first).getUTCDay() - weekStart + 7) % 7
  const start = addDays(first, -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function weekDays(iso: string, weekStart: 0 | 1): string[] {
  const offset = (utc(iso).getUTCDay() - weekStart + 7) % 7
  const start = addDays(iso, -offset)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

const fmt = (iso: string, locale: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utc(iso))
export const formatLongDate = (iso: string, locale: DailyLocale) => fmt(iso, locale, { day: 'numeric', month: 'long', year: 'numeric' })
export const formatShortDate = (iso: string, locale: DailyLocale) => fmt(iso, locale, { day: 'numeric', month: 'short' })
export const formatWeekday = (iso: string, locale: DailyLocale) => fmt(iso, locale, { weekday: 'long' })
export const formatMonthYear = (year: number, month: number, locale: DailyLocale) => fmt(`${year}-${pad(month)}-01`, locale, { month: 'long', year: 'numeric' })


/** Soma meses civis (dia limitado ao fim do mês: 31/jan + 1m = 28 ou 29/fev). */
export function addMonths(iso: string, months: number): string {
  const [y, m, day] = ymd(iso)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12 + 12) % 12 + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(Math.min(day, last))}`
}

/** Hora local HH:mm de um instante. */
export function localTime(epoch = Date.now()): string {
  const d = new Date(epoch)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Nome do mês por extenso, sem ano ("outubro"). */
export const formatMonthName = (iso: string, locale: DailyLocale) => fmt(iso, locale, { month: 'long' })
