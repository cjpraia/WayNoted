// Campos extras de datas recorrentes (recorrência, lembrete, conclusões) validados para importação.
// Espelhado em `electron/date-extras.cjs` (API local). Mantenha as regras iguais.
import type { DateRecurrence } from '../database-models'

const MONTHLY = new Set(['day', 'weekday', 'lastWeekday'])
const int = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Devolve a regra limpa, ou null se algum campo for inválido. */
export function sanitizeRecurrence(value: unknown): DateRecurrence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const out: DateRecurrence = {}
  if (raw.interval !== undefined) { if (!int(raw.interval, 1, 1000)) return null; out.interval = raw.interval }
  if (raw.weekdays !== undefined) {
    if (!Array.isArray(raw.weekdays) || raw.weekdays.length > 7 || !raw.weekdays.every((day) => int(day, 0, 6))) return null
    out.weekdays = [...new Set(raw.weekdays as number[])]
  }
  if (raw.monthly !== undefined) { if (!MONTHLY.has(String(raw.monthly))) return null; out.monthly = raw.monthly as DateRecurrence['monthly'] }
  if (raw.until !== undefined) { if (!isISODate(raw.until)) return null; out.until = raw.until }
  if (raw.count !== undefined) { if (!int(raw.count, 1, 10000)) return null; out.count = raw.count }
  if (raw.anchor !== undefined) { if (!isISODate(raw.anchor)) return null; out.anchor = raw.anchor }
  return out
}

/** Campos extras válidos de um valor de data; `invalid` recebe o nome do campo rejeitado. */
export function dateExtras(raw: Record<string, unknown>, invalid?: (field: string) => void): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (raw.recurrence !== undefined) { const rule = sanitizeRecurrence(raw.recurrence); if (rule) out.recurrence = rule; else invalid?.('recurrence') }
  if (raw.reminder !== undefined) { if (int(raw.reminder, 0, 525600)) out.reminder = raw.reminder; else invalid?.('reminder') }
  if (raw.completions !== undefined) {
    if (Array.isArray(raw.completions) && raw.completions.length <= 1000 && raw.completions.every((at) => typeof at === 'number' && Number.isFinite(at) && at >= 0)) out.completions = [...raw.completions]
    else invalid?.('completions')
  }
  if (raw.completedCount !== undefined) { if (int(raw.completedCount, 0, 1e9)) out.completedCount = raw.completedCount; else invalid?.('completedCount') }
  return out
}
