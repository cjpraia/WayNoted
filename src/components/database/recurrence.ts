import type { DateValue } from '../../types'
import { isRecurring, occurrenceStarts } from '../../../electron/recurrence.mjs'

export interface DateOccurrence {
  /** Identidade visual estável; a página de origem nunca é duplicada. */
  id: string
  index: number
  start: string
  end: string
  recurring: boolean
  /** Ocorrência futura projetada (não é a data atual da linha); exibida pontilhada. */
  projected?: boolean
  startTime?: string
  endTime?: string
}

const DAY = 86_400_000
const parse = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`)
const iso = (epoch: number) => new Date(epoch).toISOString().slice(0, 10)
const validISO = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parse(value)) && iso(parse(value)) === value
const addDays = (start: string, days: number) => iso(parse(start) + days * DAY)
const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY)

/** Expande somente uma janela visível; não escreve no banco nem executa tarefas. */
export function dateOccurrences(sourceId: string, value: DateValue, windowStart: string, windowEnd: string, limit = 400): DateOccurrence[] {
  const base = value.start
  const originalEnd = value.end && value.end >= base ? value.end : base
  const from = parse(windowStart), to = parse(windowEnd), startEpoch = parse(base), endEpoch = parse(originalEnd)
  if (![base, originalEnd, windowStart, windowEnd].every(validISO) || from > to || endEpoch < startEpoch || !Number.isFinite(limit) || limit < 1) return []
  const duration = daysBetween(base, originalEnd)
  if (!isRecurring(value)) return startEpoch <= to && parse(originalEnd) >= from ? [{ id: `${sourceId}@${base}`, index: 0, start: base, end: originalEnd, recurring: false }] : []
  // A série é exibida a partir da ocorrência atual (as anteriores já foram concluídas/avançadas).
  const searchFrom = addDays(windowStart, -duration) > base ? addDays(windowStart, -duration) : base
  const starts = occurrenceStarts(value, searchFrom, windowEnd, limit)
  // A data atual da linha é sempre a ocorrência vigente, mesmo fora do padrão (ex.: movida à mão).
  if (searchFrom === base && starts[0]?.start !== base) starts.unshift({ start: base, ordinal: 0 })
  return starts.slice(0, limit).map(({ start, ordinal }) => ({
    id: `${sourceId}@${start}`, index: ordinal, start, end: addDays(start, duration), recurring: true, projected: start !== base,
  })).filter((occurrence) => parse(occurrence.end) >= from)
}
