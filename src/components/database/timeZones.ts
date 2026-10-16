import type { DateValue } from '../../types'
import type { DateOccurrence } from './recurrence'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
const partsFor = (epoch: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: field('year'), month: field('month'), day: field('day'), hour: field('hour'), minute: field('minute') }
}
const utcParts = (date: string, time: string) => {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return { year, month, day, hour, minute }
}
const asUTC = ({ year, month, day, hour, minute }: ReturnType<typeof utcParts>) => Date.UTC(year, month - 1, day, hour, minute)
const sameParts = (a: ReturnType<typeof utcParts>, b: ReturnType<typeof utcParts>) => a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute
export const validTimeZone = (timeZone: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone }); return true } catch { return false } }

export function validDateValueWallTimes(value: DateValue, fallbackZone: string): boolean {
  const zone = value.timeZone ?? fallbackZone
  return validTimeZone(zone) && (!value.startTime || zonedDateTimeToEpoch(value.start, value.startTime, zone) !== null)
    && (!value.endTime || !!value.end && zonedDateTimeToEpoch(value.end, value.endTime, zone) !== null)
}

/** Converte data/hora civil e IANA zone em instante; horário inexistente no DST é inválido. */
export function zonedDateTimeToEpoch(date: string, time: string, timeZone: string): number | null {
  if (!datePattern.test(date) || !timePattern.test(time) || !validTimeZone(timeZone)) return null
  const wanted = utcParts(date, time)
  const wallUTC = asUTC(wanted)
  if (new Date(wallUTC).toISOString().slice(0, 10) !== date) return null
  let epoch = wallUTC
  for (let attempt = 0; attempt < 4; attempt++) {
    const delta = wallUTC - asUTC(partsFor(epoch, timeZone))
    if (!delta) break
    epoch += delta
  }
  return sameParts(partsFor(epoch, timeZone), wanted) ? epoch : null
}

export function epochToZonedDateTime(epoch: number, timeZone: string): { date: string; time: string } | null {
  if (!Number.isFinite(epoch) || !validTimeZone(timeZone)) return null
  const p = partsFor(epoch, timeZone)
  return { date: `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }
}

/** Preserva instantes dos campos com hora ao trocar fuso; datas sem hora seguem calendário civil. */
export function convertDateValueZone(value: DateValue, fromZone: string, toZone: string): DateValue | null {
  if (!validTimeZone(fromZone) || !validTimeZone(toZone)) return null
  const start = value.startTime ? zonedDateTimeToEpoch(value.start, value.startTime, fromZone) : null
  const end = value.end && value.endTime ? zonedDateTimeToEpoch(value.end, value.endTime, fromZone) : null
  if (value.startTime && start === null || value.endTime && end === null) return null
  const convertedStart = start !== null ? epochToZonedDateTime(start, toZone) : null
  const convertedEnd = end !== null ? epochToZonedDateTime(end, toZone) : null
  if (start !== null && !convertedStart || end !== null && !convertedEnd) return null
  const shiftedDays = convertedStart ? Math.round((Date.parse(`${convertedStart.date}T00:00:00Z`) - Date.parse(`${value.start}T00:00:00Z`)) / 86_400_000) : 0
  const calendarEnd = value.end && !value.endTime && shiftedDays ? new Date(Date.parse(`${value.end}T00:00:00Z`) + shiftedDays * 86_400_000).toISOString().slice(0, 10) : value.end
  const next: DateValue = { ...value, timeZone: toZone, start: convertedStart?.date ?? value.start, startTime: convertedStart?.time ?? value.startTime, end: convertedEnd?.date ?? calendarEnd, endTime: convertedEnd?.time ?? value.endTime }
  return next
}

/** Projeta uma ocorrência no fuso do dispositivo, mantendo a chave da série de origem. */
export function occurrenceForViewer(occurrence: DateOccurrence, value: DateValue, viewerZone: string): DateOccurrence | null {
  if (!value.startTime && !value.endTime) return occurrence
  const converted = convertDateValueZone({ ...value, start: occurrence.start, end: value.end ? occurrence.end : undefined }, value.timeZone ?? viewerZone, viewerZone)
  return converted ? { ...occurrence, start: converted.start, end: converted.end ?? converted.start, startTime: converted.startTime, endTime: converted.endTime } : null
}
