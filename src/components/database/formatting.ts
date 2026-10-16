import type { DateValue, Property, SelectOption } from '../../types'
import type { DatabasePropertyConfig, DatabaseSelectOptionConfig, DateConfig } from '../../database-models'
import { describeRecurrence } from '../../../electron/recurrence.mjs'

export function formatPropertyNumber(value: number, property: Property & DatabasePropertyConfig, locale = 'pt-BR'): string {
  if (!Number.isFinite(value)) return ''
  switch (property.numberFormat) {
    case 'currency': return new Intl.NumberFormat(locale, { style: 'currency', currency: property.currency ?? (locale === 'en-US' ? 'USD' : 'BRL') }).format(value)
    case 'percent': return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value)
    case 'progress': return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`
    default: return new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(value)
  }
}

export function progressValue(value: number): number { return Math.max(0, Math.min(100, value)) }

export function statusGroups(options: SelectOption[]): { group: NonNullable<DatabaseSelectOptionConfig['group']>; options: SelectOption[] }[] {
  return (['todo', 'progress', 'complete'] as const).map((group) => ({ group, options: options.filter((option) => (option as SelectOption & DatabaseSelectOptionConfig).group === group) }))
}

export type DateDisplayFormat = NonNullable<DatabasePropertyConfig['dateFormat']>
export type TimeDisplayFormat = NonNullable<DatabasePropertyConfig['timeFormat']>
export interface DateDisplayOptions { dateFormat?: DateDisplayFormat; timeFormat?: TimeDisplayFormat; today?: Date }

const pad = (n: number) => String(n).padStart(2, '0')

/** Data ISO (AAAA-MM-DD) no formato da propriedade; padrão como o Export Bundle: "8 de outubro de 2026". */
export function formatDisplayDate(iso: string, locale = 'pt-BR', options: DateDisplayOptions = {}): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (!year || !month || !day || Number.isNaN(date.getTime())) return iso
  switch (options.dateFormat ?? 'full') {
    case 'short': return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    case 'monthDayYear': return `${pad(month)}/${pad(day)}/${year}`
    case 'dayMonthYear': return `${pad(day)}/${pad(month)}/${year}`
    case 'yearMonthDay': return `${year}/${pad(month)}/${pad(day)}`
    case 'relative': {
      const today = options.today ?? new Date()
      const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const diff = Math.round((date.getTime() - base.getTime()) / 86_400_000)
      const en = locale === 'en-US'
      if (diff === 0) return en ? 'Today' : 'Hoje'
      if (diff === 1) return en ? 'Tomorrow' : 'Amanhã'
      if (diff === -1) return en ? 'Yesterday' : 'Ontem'
      return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    }
    default: return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }
}

/** Hora "HH:MM" em 24 h ("14:30") ou 12 h ("2:30 PM"). Padrão: 12 h só em inglês. */
export function formatDisplayTime(time: string, locale = 'pt-BR', format?: TimeDisplayFormat): string {
  const [h, m] = time.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time
  if ((format ?? (locale === 'en-US' ? '12h' : '24h')) === '24h') return `${pad(h)}:${pad(m)}`
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

/** Valor de data completo: início, hora, término ("8 de outubro de 2026 14:30 → 16:00"). */
export function formatDateValueText(value: DateValue & DateConfig, locale = 'pt-BR', options: DateDisplayOptions = {}): string {
  const time = (t?: string) => t ? ` ${formatDisplayTime(t, locale, options.timeFormat)}` : ''
  const start = `${formatDisplayDate(value.start, locale, options)}${time(value.startTime)}`
  const sameDay = !value.end || value.end === value.start
  const end = !sameDay ? `${formatDisplayDate(value.end!, locale, options)}${time(value.endTime)}` : value.endTime ? formatDisplayTime(value.endTime, locale, options.timeFormat) : ''
  return end ? `${start} → ${end}` : start
}

export function formatDateTime(value: DateValue & DateConfig, locale = 'pt-BR', options: DateDisplayOptions = {}): string {
  return `${formatDateValueText(value, locale, options)}${value.timeZone ? ` · ${value.timeZone}` : ''}`
}

/** Resumo da repetição para o marcador ↻ ("Toda segunda e quarta, até 31/12"); vazio se não repete. */
export function recurrenceLabel(value: DateValue & DateConfig, locale = 'pt-BR'): string {
  return describeRecurrence(value, locale)
}
