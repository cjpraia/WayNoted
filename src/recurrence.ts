// Tarefas recorrentes: regras de repetição, resumo legível e plano de conclusão (avançar ou copiar).
// O cálculo de datas vive em `electron/recurrence.mjs` para que o processo principal agende
// lembretes mesmo sem janela aberta; este módulo é a fachada tipada usada pela interface e pela store.
import type { DatabaseSchema, DateValue, Page, Property, PropValue } from './types'
import type { DateRecurrence } from './database-models'
import {
  advanceDateValue, describeRecurrence, doneProperty, isDoneValue, isRecurring, nextOccurrenceAfter, occurrenceStarts,
  recurrenceRule, reminderInstant, REMINDER_OFFSETS, validISODate, weekdayOf, weekdayOrdinal, isLastWeekdayOfMonth, wallTimeToEpoch, addDays as advanceDays, daysBetween,
} from '../electron/recurrence.mjs'

export {
  advanceDateValue, describeRecurrence, doneProperty, isDoneValue, isRecurring, nextOccurrenceAfter, occurrenceStarts,
  recurrenceRule, reminderInstant, REMINDER_OFFSETS, validISODate, weekdayOf, weekdayOrdinal, isLastWeekdayOfMonth, wallTimeToEpoch,
}

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'monthlyWeekday' | 'yearly' | 'custom'
export const COMPLETION_HISTORY_LIMIT = 20

export function localISODate(epoch = Date.now()): string {
  const date = new Date(epoch)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Preset que corresponde ao valor (para o seletor "Repetir"); combinações livres são "custom". */
export function presetOf(value: DateValue | null | undefined): RepeatPreset {
  const rule = recurrenceRule(value)
  if (!rule || !value) return 'none'
  const r = value.recurrence ?? {}
  if (rule.interval !== 1 || r.until || r.count) return 'custom'
  if (rule.freq === 'daily') return 'daily'
  if (rule.freq === 'weekly') {
    if (rule.weekdays!.join() === '1,2,3,4,5') return 'weekdays'
    return rule.weekdays!.length === 1 && rule.weekdays![0] === weekdayOf(value.start) ? 'weekly' : 'custom'
  }
  if (rule.freq === 'monthly') return rule.monthly === 'day' ? 'monthly' : rule.monthly === 'weekday' ? 'monthlyWeekday' : 'custom'
  return 'yearly'
}

/** Aplica um preset; mantém início, horas e lembrete. A âncora é reiniciada no início atual. */
export function applyPreset(value: DateValue, preset: RepeatPreset): DateValue {
  const base: DateValue = { ...value }
  delete base.recurrence
  switch (preset) {
    case 'none': return { ...base, repeat: 'none' }
    case 'daily': return { ...base, repeat: 'daily' }
    case 'weekdays': return { ...base, repeat: 'weekly', recurrence: { weekdays: [1, 2, 3, 4, 5] } }
    case 'weekly': return { ...base, repeat: 'weekly' }
    case 'monthly': return { ...base, repeat: 'monthly' }
    case 'monthlyWeekday': return { ...base, repeat: 'monthly', recurrence: { monthly: weekdayOrdinal(value.start) === -1 ? 'lastWeekday' : 'weekday' } }
    case 'yearly': return { ...base, repeat: 'yearly' }
    default: return { ...value, repeat: value.repeat && value.repeat !== 'none' ? value.repeat : 'weekly' }
  }
}

/** Atualiza campos da regra personalizada, descartando valores vazios para manter dados enxutos. */
export function patchRecurrence(value: DateValue, patch: Partial<DateRecurrence>): DateValue {
  const next: DateRecurrence = { ...(value.recurrence ?? {}), ...patch }
  for (const key of Object.keys(next) as (keyof DateRecurrence)[]) if (next[key] === undefined || (Array.isArray(next[key]) && !(next[key] as unknown[]).length)) delete next[key]
  if (next.interval === 1) delete next.interval
  if (next.monthly === 'day') delete next.monthly
  const result: DateValue = { ...value }
  if (Object.keys(next).length) result.recurrence = next
  else delete result.recurrence
  return result
}

export interface CompletionPlan {
  dateProperty: Property
  doneProperty: Property
  mode: 'advance' | 'copy'
  /** Valor da data na linha concluída. */
  currentDate: DateValue
  /** Próxima ocorrência (nova data da linha ou da cópia); null quando a série terminou. */
  nextDate: DateValue | null
  /** Valor "a fazer" para a propriedade de conclusão na linha que continua a série. */
  resetValue: PropValue
}

function resetValueFor(property: Property, previous: PropValue | undefined): PropValue {
  if (property.type === 'checkbox') return false
  const todo = property.options?.find((option) => option.group === 'todo')
  if (todo) return todo.id
  return typeof previous === 'string' && !isDoneValue(property, previous) ? previous : null
}

/**
 * Detecta a transição "não concluída → concluída" na propriedade de conclusão de cada data recorrente
 * da linha e devolve o que fazer. Função pura: a store aplica o plano.
 */
export function recurringCompletions(schema: DatabaseSchema, row: Page, changedPropId: string, previous: PropValue | undefined, next: PropValue, now = Date.now()): CompletionPlan[] {
  const plans: CompletionPlan[] = []
  for (const property of schema.properties) {
    if (property.type !== 'date') continue
    const value = row.props?.[property.id] as DateValue | undefined
    if (!value || typeof value !== 'object' || !isRecurring(value)) continue
    const done = doneProperty(schema, property)
    if (!done || done.id !== changedPropId || isDoneValue(done, previous) || !isDoneValue(done, next)) continue
    const completions = [...(value.completions ?? []), now].slice(-COMPLETION_HISTORY_LIMIT)
    const history = { completions, completedCount: (value.completedCount ?? 0) + 1 }
    const advanced = advanceDateValue(value, localISODate(now))
    const mode = property.recurrenceOnComplete === 'copy' ? 'copy' : 'advance'
    plans.push({
      dateProperty: property, doneProperty: done, mode,
      // Na cópia, a linha concluída deixa de repetir para não duplicar ocorrências futuras.
      currentDate: mode === 'copy' && advanced ? { ...value, ...history, repeat: 'none' } : { ...value, ...history },
      nextDate: advanced ? { ...advanced, ...history } : null,
      resetValue: resetValueFor(done, previous),
    })
  }
  return plans
}

/** Texto do histórico mínimo: "Concluída 3× · última em 7 de out." */
export function completionSummary(value: DateValue, locale = 'pt-BR'): string {
  if (!value.completedCount) return ''
  const en = locale.startsWith('en')
  const last = value.completions?.at(-1)
  const when = last ? new Date(last).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return en ? `Completed ${value.completedCount}×${when ? ` · last on ${when}` : ''}` : `Concluída ${value.completedCount}×${when ? ` · última em ${when}` : ''}`
}

export const isValidISODate = (value: unknown): value is string => validISODate(value)

/** Presets aceitos pela menção de data em blocos de tarefa (to-do) na página. */
export const MENTION_REPEAT_PRESETS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const
export type MentionRepeat = typeof MENTION_REPEAT_PRESETS[number]

/**
 * Próxima data de uma menção (instante ISO) ao marcar o to-do: mesma hora local, próxima ocorrência
 * não passada do preset. Devolve null se a data ou o preset forem inválidos.
 */
export function advanceMentionDate(instant: string, repeat: string, now = Date.now()): string | null {
  if (!(MENTION_REPEAT_PRESETS as readonly string[]).includes(repeat)) return null
  const at = new Date(instant)
  if (!Number.isFinite(at.getTime())) return null
  const start = localISODate(at.getTime())
  const next = advanceDateValue(applyPreset({ start }, repeat as RepeatPreset), localISODate(now))
  if (!next) return null
  const [y, m, d] = next.start.split('-').map(Number)
  return new Date(y, m - 1, d, at.getHours(), at.getMinutes()).toISOString()
}

/**
 * Menção com início separado do prazo: ao avançar o prazo de `from` para `to`, o início anda o mesmo
 * número de dias civis (a duração se mantém). Devolve '' se o início for inválido.
 */
export function shiftMentionStart(startDate: string, fromInstant: string, toInstant: string): string {
  if (!validISODate(startDate)) return ''
  const day = (instant: string) => { const d = new Date(instant); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const from = day(fromInstant), to = day(toInstant)
  if (!validISODate(from) || !validISODate(to)) return ''
  return advanceDays(startDate, daysBetween(from, to))
}
