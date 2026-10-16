import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Conversões puras entre datas do aplicativo e eventos do Calendário do macOS (sem React nem store).
import type { DateValue, SystemCalendarEvent, SystemCalendarEventInput } from '../../types'
import { zonedDateTimeToEpoch } from '../database/timeZones.ts'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HOUR_MS = 3_600_000

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDate(iso: string, hours = 0, minutes = 0, seconds = 0): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day, hours, minutes, seconds)
}

export function addDays(iso: string, days: number): string {
  const date = localDate(iso)
  date.setDate(date.getDate() + days)
  return localDay(date)
}

/** Intervalo do evento para o valor de data de uma linha; null quando não há data válida. */
export function eventRangeForDate(value: DateValue | null | undefined, viewerZone: string): Pick<SystemCalendarEventInput, 'start' | 'end' | 'allDay' | 'timeZone'> | null {
  if (!value || typeof value.start !== 'string' || !DAY_PATTERN.test(value.start)) return null
  const lastDay = value.end && DAY_PATTERN.test(value.end) && value.end >= value.start ? value.end : value.start
  if (!value.startTime) {
    // Dia inteiro: do início do primeiro dia ao fim do último (EventKit trata como evento flutuante).
    return { start: localDate(value.start).toISOString(), end: localDate(lastDay, 23, 59, 59).toISOString(), allDay: true }
  }
  const zone = value.timeZone || viewerZone
  const start = zonedDateTimeToEpoch(value.start, value.startTime, zone)
  if (start === null) return null
  let end = value.endTime ? zonedDateTimeToEpoch(lastDay, value.endTime, zone) : null
  if (end === null || end <= start) end = start + HOUR_MS
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay: false, ...(value.timeZone ? { timeZone: value.timeZone } : {}) }
}

/** Assinatura estável do que é sincronizado; muda quando a data ou o título da linha mudam. */
export function linkSignature(value: DateValue | null | undefined, title: string): string {
  if (!value?.start) return JSON.stringify({ none: true, title })
  return JSON.stringify({ start: value.start, end: value.end ?? null, startTime: value.startTime ?? null, endTime: value.endTime ?? null, timeZone: value.timeZone ?? null, title })
}

/** Dias locais (inclusive) cobertos por um evento do sistema. */
export function systemEventDays(event: Pick<SystemCalendarEvent, 'start' | 'end' | 'allDay'>): { start: string; end: string } | null {
  const start = new Date(event.start), end = new Date(event.end)
  if (Number.isNaN(start.getTime())) return null
  let last = Number.isNaN(end.getTime()) || end < start ? start : end
  // Fim exatamente à meia-noite (ou dia inteiro) pertence ao dia anterior.
  if (last > start && (event.allDay || (last.getHours() === 0 && last.getMinutes() === 0 && last.getSeconds() === 0))) last = new Date(last.getTime() - 1)
  const first = localDay(start), final = localDay(last)
  return { start: first, end: final < first ? first : final }
}

export interface SystemSegment { event: SystemCalendarEvent; startCol: number; endCol: number; lane: number; continuesLeft: boolean; continuesRight: boolean }

function diffDays(a: string, b: string): number {
  return Math.round((localDate(b).getTime() - localDate(a).getTime()) / 86_400_000)
}

/** Distribui eventos do sistema numa semana em faixas (mesma regra das barras do calendário). */
export function layoutSystemWeek(weekStart: string, events: readonly SystemCalendarEvent[]): { segments: SystemSegment[]; lanes: number } {
  const weekEnd = addDays(weekStart, 6)
  const segments = events.flatMap((event) => {
    const days = systemEventDays(event)
    if (!days || days.start > weekEnd || days.end < weekStart) return []
    return [{
      event,
      startCol: days.start < weekStart ? 0 : diffDays(weekStart, days.start),
      endCol: days.end > weekEnd ? 6 : diffDays(weekStart, days.end),
      continuesLeft: days.start < weekStart,
      continuesRight: days.end > weekEnd,
      lane: 0,
    }]
  }).sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || Number(b.event.allDay) - Number(a.event.allDay) || a.event.start.localeCompare(b.event.start))
  const laneEnds: number[] = []
  for (const segment of segments) {
    let lane = laneEnds.findIndex((end) => end < segment.startCol)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = segment.endCol
    segment.lane = lane
  }
  return { segments, lanes: laneEnds.length }
}

/** Eventos que tocam um dia local, dia inteiro primeiro e depois por horário. */
export function eventsForDay(events: readonly SystemCalendarEvent[], day: string): SystemCalendarEvent[] {
  return events.filter((event) => { const days = systemEventDays(event); return !!days && days.start <= day && days.end >= day })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

/** Rótulo de horário para listas ("Dia todo", "09:00–10:30"). */
export function eventTimeLabel(event: Pick<SystemCalendarEvent, 'start' | 'end' | 'allDay'>, locale: string, day?: string): string {
  if (event.allDay) return locale === 'en-US' ? 'All day' : 'Dia todo'
  const start = new Date(event.start), end = new Date(event.end)
  const format = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: locale === 'en-US' ? undefined : false })
  if (day && localDay(start) < day) return locale === 'en-US' ? `until ${format(end)}` : `até ${format(end)}`
  return Number.isNaN(end.getTime()) || end <= start ? format(start) : `${format(start)}–${format(end)}`
}

/** Janela [início, fim) em ISO cobrindo dias locais inteiros. */
export function rangeForDays(firstDay: string, lastDay: string): { start: string; end: string } {
  return { start: localDate(firstDay).toISOString(), end: localDate(addDays(lastDay, 1)).toISOString() }
}

/** Traduz códigos do helper em mensagens para a interface. */
export function calendarErrorMessage(error: unknown, t: (pt: string, en: string) => string): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (/CALENDAR_ACCESS_NOT_DETERMINED/.test(text)) return t('Permita o acesso ao Calendário para continuar.', 'Allow Calendar access to continue.')
  if (/CALENDAR_ACCESS_DENIED/.test(text)) return t(`O acesso ao Calendário foi negado. Abra Ajustes do Sistema → Privacidade e Segurança → Calendários e ative o ${PRODUCT.name}.`, `Calendar access was denied. Open System Settings → Privacy & Security → Calendars and enable ${PRODUCT.name}.`)
  if (/CALENDAR_WRITE_ONLY/.test(text)) return t(`O ${PRODUCT.name} só pode adicionar eventos. Conceda acesso total em Ajustes do Sistema → Calendários para ler e atualizar.`, `${PRODUCT.name} can only add events. Grant full access in System Settings → Calendars to read and update.`)
  if (/CALENDAR_READ_ONLY/.test(text)) return t('Este calendário é somente leitura. Escolha outro em Configurações → Calendário.', 'This calendar is read-only. Choose another in Settings → Calendar.')
  if (/EVENT_NOT_FOUND/.test(text)) return t('O evento vinculado não existe mais no Calendário.', 'The linked event no longer exists in Calendar.')
  if (/NATIVE_HELPER_MISSING/.test(text)) return t('O componente nativo do Calendário não foi encontrado. Rode npm run build:native.', 'The native Calendar component was not found. Run npm run build:native.')
  if (/NATIVE_UNSUPPORTED/.test(text)) return t('Disponível somente no app para macOS.', 'Available only in the macOS app.')
  const cleaned = text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  return cleaned || t('Não foi possível acessar o Calendário.', 'Could not access Calendar.')
}
