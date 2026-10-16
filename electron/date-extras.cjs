// Campos extras de datas recorrentes para a API local. Espelha `src/export/dateExtras.ts`.
const MONTHLY = new Set(['day', 'weekday', 'lastWeekday'])
const int = (value, min, max) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
function isISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function sanitizeRecurrence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  if (value.interval !== undefined) { if (!int(value.interval, 1, 1000)) return null; out.interval = value.interval }
  if (value.weekdays !== undefined) {
    if (!Array.isArray(value.weekdays) || value.weekdays.length > 7 || !value.weekdays.every(day => int(day, 0, 6))) return null
    out.weekdays = [...new Set(value.weekdays)]
  }
  if (value.monthly !== undefined) { if (!MONTHLY.has(String(value.monthly))) return null; out.monthly = value.monthly }
  if (value.until !== undefined) { if (!isISODate(value.until)) return null; out.until = value.until }
  if (value.count !== undefined) { if (!int(value.count, 1, 10000)) return null; out.count = value.count }
  if (value.anchor !== undefined) { if (!isISODate(value.anchor)) return null; out.anchor = value.anchor }
  return out
}
function dateExtras(raw, invalid) {
  const out = {}
  if (raw.recurrence !== undefined) { const rule = sanitizeRecurrence(raw.recurrence); if (rule) out.recurrence = rule; else invalid?.('recurrence') }
  if (raw.reminder !== undefined) { if (int(raw.reminder, 0, 525600)) out.reminder = raw.reminder; else invalid?.('reminder') }
  if (raw.completions !== undefined) {
    if (Array.isArray(raw.completions) && raw.completions.length <= 1000 && raw.completions.every(at => typeof at === 'number' && Number.isFinite(at) && at >= 0)) out.completions = [...raw.completions]
    else invalid?.('completions')
  }
  if (raw.completedCount !== undefined) { if (int(raw.completedCount, 0, 1e9)) out.completedCount = raw.completedCount; else invalid?.('completedCount') }
  return out
}
module.exports = { dateExtras, sanitizeRecurrence, isISODate }
