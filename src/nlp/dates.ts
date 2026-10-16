// Datas em linguagem natural (PT-BR e EN), sem dependências e sem relógio implícito.
// "amanhã às 9h", "segunda que vem", "dia 5", "todo dia 5 às 9h" (recorrência), "daqui a 2 semanas",
// "5/11", "fim do mês", "em 3 dias úteis", "next friday 3pm", "every monday and wednesday"…
// Todo o cálculo é feito em datas civis (AAAA-MM-DD) no fuso pedido; o instante final usa
// `wallTimeToEpoch`, que trata saltos e recuos de horário de verão. Regras de repetição saem no
// formato de `DateValue` (repeat + recurrence) usado por src/recurrence.ts e electron/recurrence.mjs.
import { addDays, validISODate, wallTimeToEpoch, describeRecurrence } from '../../electron/recurrence.mjs'
import type { DateRecurrence } from '../database-models.ts'
import type { DateValue } from '../types.ts'

export type NaturalLocale = 'pt-BR' | 'en-US'
export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface NaturalDateOptions {
  /** Instante de referência (padrão: agora). */
  now?: number | Date
  /** Fuso IANA usado para "hoje" e para o instante (padrão: o do sistema). */
  timeZone?: string
  /** Decide a ordem de datas numéricas: pt-BR = dia/mês, en-US = mês/dia. */
  locale?: NaturalLocale
}

export interface ParsedNaturalDate {
  /** Data civil no fuso pedido. */
  start: string
  /** 'HH:MM' quando o texto tinha hora. */
  time?: string
  /** Prazo quando o texto descreve um intervalo ("de segunda a sexta", "começa amanhã, entrega dia 20"); `start` é o início. */
  end?: string
  endTime?: string
  repeat?: RepeatFreq
  recurrence?: DateRecurrence
  /** Trecho reconhecido (texto original). */
  text: string
  index: number
  length: number
}

// ---------- Datas civis ----------

const pad = (n: number) => String(n).padStart(2, '0')
const make = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
function addMonths(iso: string, n: number): string {
  const [y, m, d] = ymd(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12), nm = (total % 12) + 1
  return make(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
function addBusinessDays(iso: string, n: number): string {
  let date = iso, left = Math.abs(n)
  const step = n < 0 ? -1 : 1
  for (let guard = 0; left > 0 && guard < 10_000; guard++) {
    date = addDays(date, step)
    const wd = weekday(date)
    if (wd !== 0 && wd !== 6) left--
  }
  return date
}

const systemZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
function validZone(zone: string | undefined): string {
  if (!zone) return systemZone()
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone } catch { return systemZone() }
}

/** Data e minuto do dia no fuso. */
export function civilNow(now: number | Date = Date.now(), timeZone?: string): { date: string; minutes: number } {
  const epoch = typeof now === 'number' ? now : now.getTime()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value)
  return { date: make(get('year'), get('month'), get('day')), minutes: get('hour') * 60 + get('minute') }
}

/** Data local AAAA-MM-DD no fuso (padrão: sistema). */
export function civilToday(now: number | Date = Date.now(), timeZone?: string): string { return civilNow(now, timeZone).date }

// ---------- Vocabulário ----------

/** Minúsculas sem acentos, preservando o comprimento (os índices continuam valendo no original). */
export function foldPreservingLength(value: string): string {
  let out = ''
  for (const char of value.toLowerCase()) {
    const folded = char.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    out += folded.length === char.length ? folded : char
  }
  return out
}

const WEEKDAYS: [RegExp, number][] = [
  [/^(domingos?|dom|sundays?|sun)$/, 0],
  [/^(segundas?(-feiras?)?|seg|mondays?|mon)$/, 1],
  [/^(tercas?(-feiras?)?|ter|tuesdays?|tues?)$/, 2],
  [/^(quartas?(-feiras?)?|qua|wednesdays?|wed)$/, 3],
  [/^(quintas?(-feiras?)?|qui|thursdays?|thu|thur|thurs)$/, 4],
  [/^(sextas?(-feiras?)?|sex|fridays?|fri)$/, 5],
  [/^(sabados?|sab|saturdays?|sat)$/, 6],
]
const WEEKDAY_RE = '(?:domingos?|dom|segundas?(?:-feiras?)?|seg|tercas?(?:-feiras?)?|ter|quartas?(?:-feiras?)?|qua|quintas?(?:-feiras?)?|qui|sextas?(?:-feiras?)?|sex|sabados?|sab|sundays?|sun|mondays?|mon|tuesdays?|tues?|wednesdays?|wed|thursdays?|thurs|thur|thu|fridays?|fri|saturdays?|sat)'
const weekdayIndex = (word: string) => WEEKDAYS.find(([re]) => re.test(word))?.[1] ?? -1

const MONTHS: [RegExp, number][] = [
  [/^(janeiro|jan|january)$/, 1], [/^(fevereiro|fev|february|feb)$/, 2], [/^(marco|mar|march)$/, 3],
  [/^(abril|abr|april|apr)$/, 4], [/^(maio|mai|may)$/, 5], [/^(junho|jun|june)$/, 6], [/^(julho|jul|july)$/, 7],
  [/^(agosto|ago|august|aug)$/, 8], [/^(setembro|set|september|sept|sep)$/, 9], [/^(outubro|out|october|oct)$/, 10],
  [/^(novembro|nov|november)$/, 11], [/^(dezembro|dez|december|dec)$/, 12],
]
const MONTH_RE = '(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|june|july|august|september|october|november|december|jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|sept|set|sep|out|oct|nov|dez|dec)\\.?'
const monthIndex = (word: string) => MONTHS.find(([re]) => re.test(word.replace(/\.$/, '')))?.[1] ?? -1

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
}
const NUMBER_RE = `(?:\\d{1,3}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`
const numberOf = (word: string) => /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word] ?? NaN

const END = '(?![a-z0-9])'

// ---------- Componentes ----------

interface State {
  today: string
  nowMinutes: number
  locale: NaturalLocale
  date?: string
  /** Data veio de expressão com dia explícito (não ajustar para o futuro). */
  explicit?: boolean
  time?: string
  /** Hora relativa (em N horas): data/hora já calculadas. */
  relativeTime?: boolean
  repeat?: RepeatFreq
  recurrence?: DateRecurrence
  /** Regra cujo início ainda depende de um dia (ex.: semanal em dias da semana). */
  recurWeekdays?: number[]
  recurMonthDay?: number
  recurYearly?: { month: number; day: number }
  until?: string
}

type Matcher = (s: string, at: number, st: State) => number | null

function sticky(source: string): RegExp { return new RegExp(source, 'y') }
function exec(re: RegExp, s: string, at: number): RegExpExecArray | null { re.lastIndex = at; return re.exec(s) }

const TIME_SUFFIX = '(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.|da manha|da tarde|da noite|da madrugada|in the morning|in the afternoon|in the evening|at night))?'
/** Hora: "às 9h", "9h30", "09:30", "9am", "às 3 da tarde", "meio-dia", "noon". */
const timeWithPrefix = sticky(`(?:(?:as|a|at|@)\\s+)(\\d{1,2})(?:(?::|h)(\\d{2})|h)?${TIME_SUFFIX}${END}`)
const timeBare = sticky(`(\\d{1,2})(?::(\\d{2})|h(\\d{2})?)${TIME_SUFFIX}${END}|(\\d{1,2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)${END}`)
const timeNamed = sticky(`(?:(?:ao|a|at|as)\\s+)?(meio-dia|meio dia|meia-noite|meia noite|noon|midday|midnight)${END}`)
const timeOfDay = sticky(`(?:(?:pela|de|a|in the|this|esta|nesta|hoje a|hoje de)\\s+)?(manha|tarde|noite|madrugada|morning|afternoon|evening|tonight)${END}`)

function setTime(st: State, h: number, m: number, suffix: string | undefined): boolean {
  if (st.time) return false
  const sfx = (suffix ?? '').replace(/\./g, '')
  if (sfx === 'pm' || sfx === 'da tarde' || sfx === 'da noite' || sfx === 'in the afternoon' || sfx === 'in the evening' || sfx === 'at night') { if (h < 12) h += 12 }
  else if ((sfx === 'am' || sfx === 'da madrugada' || sfx === 'da manha' || sfx === 'in the morning') && h === 12) h = 0
  if (sfx && (sfx === 'am' || sfx === 'pm') && (Number(h) > 23)) return false
  if (h > 23 || m > 59) return false
  st.time = `${pad(h)}:${pad(m)}`
  return true
}

const matchTime: Matcher = (s, at, st) => {
  let m = exec(timeWithPrefix, s, at)
  if (m && setTime(st, Number(m[1]), Number(m[2] ?? 0), m[3])) return m[0].length
  m = exec(timeBare, s, at)
  if (m) {
    const ok = m[1] !== undefined ? setTime(st, Number(m[1]), Number(m[2] ?? m[3] ?? 0), m[4]) : setTime(st, Number(m[5]), 0, m[6])
    if (ok) return m[0].length
  }
  m = exec(timeNamed, s, at)
  if (m && !st.time) { st.time = /meia|midnight/.test(m[1]) ? '00:00' : '12:00'; return m[0].length }
  m = exec(timeOfDay, s, at)
  if (m && !st.time) {
    const word = m[1]
    st.time = word === 'manha' || word === 'morning' ? '09:00' : word === 'tarde' || word === 'afternoon' ? '15:00' : word === 'madrugada' ? '03:00' : '20:00'
    if (word === 'tonight' && !st.date) { st.date = st.today; st.explicit = true }
    return m[0].length
  }
  return null
}

const relativeDay = sticky(`(depois de amanha|day after tomorrow|anteontem|antes de ontem|day before yesterday|hoje|today|tonight|amanha|tomorrow|tmrw|ontem|yesterday)${END}`)
const matchRelativeDay: Matcher = (s, at, st) => {
  const m = exec(relativeDay, s, at)
  if (!m || st.date) return null
  const word = m[1]
  const delta = /depois|after/.test(word) ? 2 : /anteontem|antes de ontem|before/.test(word) ? -2 : /hoje|today|tonight/.test(word) ? 0 : /amanha|tomorrow|tmrw/.test(word) ? 1 : -1
  st.date = addDays(st.today, delta); st.explicit = true
  if (word === 'tonight' && !st.time) st.time = '20:00'
  return m[0].length
}

const weekdayExpr = sticky(`(?:(proxima|proximo|next|this|esta|este|nesta|neste|essa|esse|nessa|nesse|na|no|on|last|ultima|ultimo)\\s+)?(${WEEKDAY_RE})(?:\\s+(que vem|seguinte|passada|passado|da semana que vem|da proxima semana|next week))?${END}`)
const matchWeekday: Matcher = (s, at, st) => {
  const m = exec(weekdayExpr, s, at)
  if (!m || st.date) return null
  const wd = weekdayIndex(m[2])
  if (wd < 0) return null
  const before = m[1] ?? '', after = m[3] ?? ''
  const todayWd = weekday(st.today)
  let delta = (wd - todayWd + 7) % 7
  if (/last|ultim/.test(before) || /passad/.test(after)) delta = -(((todayWd - wd + 7) % 7) || 7)
  else if (/semana que vem|proxima semana|next week/.test(after)) delta = (((8 - todayWd) % 7) || 7) + (wd + 6) % 7 // semana seguinte (segunda a domingo)
  else if (/proxim|next/.test(before) || /que vem|seguinte/.test(after)) delta = delta || 7
  st.date = addDays(st.today, delta); st.explicit = true
  return m[0].length
}

const offsetExpr = sticky(`(?:(daqui a|daqui|dentro de|em|in|after|apos)\\s+)?(${NUMBER_RE}|alguns|algumas|meia|half an?)\\s+(dias? uteis|business days?|work ?days?|weekdays?|minutos?|mins?|minutes?|horas?|hrs?|hours?|dias?|days?|semanas?|weeks?|meses|mes|months?|anos?|years?)(?:\\s+(depois|a partir de hoje|from now|later|atras|ago))?${END}`)
const matchOffset: Matcher = (s, at, st) => {
  const m = exec(offsetExpr, s, at)
  if (!m || st.date || (!m[1] && !m[4] && st.repeat)) return null
  const raw = m[2]
  let n = raw === 'alguns' || raw === 'algumas' ? 3 : raw === 'meia' || /^half/.test(raw) ? 0.5 : numberOf(raw)
  if (!Number.isFinite(n) || n > 999) return null
  // Sem "daqui a/em/in" ou "depois/ago" um número solto ("3 dias") ainda é aceito como deslocamento.
  if (/atras|ago/.test(m[4] ?? '')) n = -n
  const unit = m[3]
  if (/^(minutos?|mins?|minutes?|horas?|hrs?|hours?)$/.test(unit)) {
    if (st.time) return null
    const minutes = Math.round(n * (/^(horas?|hrs?|hours?)$/.test(unit) ? 60 : 1))
    const total = st.nowMinutes + minutes
    const days = Math.floor(total / 1440)
    st.date = addDays(st.today, days); st.explicit = true; st.relativeTime = true
    const rest = ((total % 1440) + 1440) % 1440
    st.time = `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`
    return m[0].length
  }
  if (!Number.isInteger(n)) return null
  if (/uteis|business|work|weekday/.test(unit)) st.date = addBusinessDays(st.today, n)
  else if (/^(dias?|days?)$/.test(unit)) st.date = addDays(st.today, n)
  else if (/^(semanas?|weeks?)$/.test(unit)) st.date = addDays(st.today, n * 7)
  else if (/^(meses|mes|months?)$/.test(unit)) st.date = addMonths(st.today, n)
  else st.date = addMonths(st.today, n * 12)
  st.explicit = true
  return m[0].length
}

const periodExpr = sticky(`(fim do mes|final do mes|fim deste mes|end of (?:the )?month|eom|fim da semana|final da semana|end of (?:the )?week|eow|fim do ano|final do ano|end of (?:the )?year|fim de semana|final de semana|this weekend|weekend|semana que vem|proxima semana|next week|mes que vem|proximo mes|next month|ano que vem|proximo ano|next year|inicio do mes que vem|inicio do proximo mes|comeco do mes que vem|start of next month|beginning of next month|inicio da semana que vem|start of next week|fim do mes que vem|end of next month)${END}`)
const matchPeriod: Matcher = (s, at, st) => {
  const m = exec(periodExpr, s, at)
  if (!m || st.date) return null
  const word = m[1]
  const [y, mo] = ymd(st.today)
  const wd = weekday(st.today)
  if (/fim do mes que vem|end of next month/.test(word)) { const next = addMonths(make(y, mo, 1), 1); const [ny, nm] = ymd(next); st.date = make(ny, nm, daysInMonth(ny, nm)) }
  else if (/mes|month|eom/.test(word) && /fim|final|end|eom/.test(word)) st.date = make(y, mo, daysInMonth(y, mo))
  else if (/fim da semana|final da semana|end of (the )?week|eow/.test(word)) st.date = addDays(st.today, wd <= 5 ? 5 - wd : 6)
  else if (/ano|year/.test(word) && /fim|final|end/.test(word)) st.date = make(y, 12, 31)
  else if (/fim de semana|final de semana|weekend/.test(word)) st.date = addDays(st.today, wd === 6 ? 0 : wd === 0 ? 0 : 6 - wd)
  else if (/semana|week/.test(word)) st.date = addDays(st.today, ((8 - wd) % 7) || 7)
  else if (/mes|month/.test(word)) st.date = addMonths(make(y, mo, 1), 1)
  else st.date = make(y + 1, 1, 1)
  st.explicit = true
  return m[0].length
}

/** Datas absolutas: ISO, numéricas (d/m ou m/d conforme o idioma), "5 de novembro", "nov 5th", "dia 5". */
const isoExpr = sticky(`(\\d{4})-(\\d{1,2})-(\\d{1,2})${END}`)
const numericExpr = sticky(`(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2}|\\d{4}))?${END}`)
const dayMonthExpr = sticky(`(?:dia\\s+)?(\\d{1,2})(?:o|º|ª|st|nd|rd|th)?(?:\\s+de|\\s+of)?\\s+(${MONTH_RE})(?:,?\\s+(?:de\\s+)?(\\d{4}))?${END}`)
const monthDayExpr = sticky(`(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`)
const dayOnlyExpr = sticky(`(?:dia|the|on the)\\s+(\\d{1,2})(?:o|º|st|nd|rd|th)?${END}`)
const monthOnlyExpr = sticky(`(?:em|in|no inicio de|inicio de)\\s+(${MONTH_RE})(?:\\s+(?:de\\s+)?(\\d{4}))?${END}`)

function validDay(y: number, m: number, d: number) { return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) }
/** Sem ano: a próxima ocorrência a partir de hoje. */
function nextMonthDay(today: string, m: number, d: number): string | null {
  const [y] = ymd(today)
  for (let year = y; year <= y + 8; year++) if (validDay(year, m, d)) { const date = make(year, m, d); if (date >= today) return date }
  return null
}
function nextDayOfMonth(today: string, d: number): string | null {
  const [y, m] = ymd(today)
  for (let k = 0; k < 24; k++) {
    const total = y * 12 + (m - 1) + k, yy = Math.floor(total / 12), mm = (total % 12) + 1
    if (validDay(yy, mm, d)) { const date = make(yy, mm, d); if (date >= today) return date }
  }
  return null
}
const fullYear = (raw: string) => raw.length === 2 ? 2000 + Number(raw) : Number(raw)

const matchAbsolute: Matcher = (s, at, st) => {
  if (st.date) return null
  let m = exec(isoExpr, s, at)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (!validDay(y, mo, d)) return null
    st.date = make(y, mo, d); st.explicit = true; return m[0].length
  }
  m = exec(numericExpr, s, at)
  if (m) {
    const a = Number(m[1]), b = Number(m[2])
    const [d, mo] = st.locale === 'en-US' ? [b, a] : [a, b]
    if (m[3]) { const y = fullYear(m[3]); if (!validDay(y, mo, d)) return null; st.date = make(y, mo, d) }
    else { const date = mo >= 1 && mo <= 12 ? nextMonthDay(st.today, mo, d) : null; if (!date) return null; st.date = date }
    st.explicit = true; return m[0].length
  }
  m = exec(dayMonthExpr, s, at)
  if (m) {
    const d = Number(m[1]), mo = monthIndex(m[2])
    if (mo < 0) return null
    if (m[3]) { const y = Number(m[3]); if (!validDay(y, mo, d)) return null; st.date = make(y, mo, d) }
    else { const date = nextMonthDay(st.today, mo, d); if (!date) return null; st.date = date }
    st.explicit = true; return m[0].length
  }
  m = exec(monthDayExpr, s, at)
  if (m) {
    const mo = monthIndex(m[1]), d = Number(m[2])
    if (mo < 0) return null
    if (m[3]) { const y = Number(m[3]); if (!validDay(y, mo, d)) return null; st.date = make(y, mo, d) }
    else { const date = nextMonthDay(st.today, mo, d); if (!date) return null; st.date = date }
    st.explicit = true; return m[0].length
  }
  m = exec(dayOnlyExpr, s, at)
  if (m) {
    const d = Number(m[1])
    if (d < 1 || d > 31) return null
    const date = nextDayOfMonth(st.today, d)
    if (!date) return null
    st.date = date; st.explicit = true; return m[0].length
  }
  m = exec(monthOnlyExpr, s, at)
  if (m) {
    const mo = monthIndex(m[1])
    if (mo < 0) return null
    const [y, cm] = ymd(st.today)
    const year = m[2] ? Number(m[2]) : mo < cm ? y + 1 : y
    st.date = mo === cm && year === y ? st.today : make(year, mo, 1); st.explicit = true; return m[0].length
  }
  return null
}

/** Repetição: "todo dia", "todo dia 5", "toda segunda e quarta", "a cada 2 semanas", "every weekday", "monthly". */
const everyPrefix = '(?:todos os|todas as|todo o|toda a|todo|toda|todos|todas|cada|every|each)'
const recurDaily = sticky(`(?:${everyPrefix}\\s+(?:dia|dias|day)|diariamente|daily|everyday)${END}`)
const recurWorkdays = sticky(`(?:${everyPrefix}\\s+(?:dia util|dias uteis|weekday|weekdays|business day|work ?day)|(?:nos |em )?dias uteis|weekdays|on weekdays)${END}`)
const recurMonthDay = sticky(`(?:${everyPrefix}\\s+(?:dia|mes no dia|month on the|month on day)|monthly on (?:the )?|every month on (?:the )?)\\s*(\\d{1,2})(?:o|º|st|nd|rd|th)?(?:\\s+(?:de|of)\\s+(${MONTH_RE}))?(?:\\s+(?:do mes|de cada mes|of (?:the|each|every) month))?${END}`)
const recurEveryNthMonthDay = sticky(`(?:every|each)\\s+(\\d{1,2})(?:st|nd|rd|th)${END}`)
const recurWeekdays = sticky(`${everyPrefix}\\s+(${WEEKDAY_RE}(?:\\s*(?:,|e|and|&)\\s*(?:a |as |o |os )?${WEEKDAY_RE})*)${END}`)
const recurUnit = sticky(`(?:${everyPrefix}\\s+(semana|week|mes|month|ano|year)|semanalmente|weekly|mensalmente|monthly|anualmente|yearly|annually|quinzenalmente|biweekly|fortnightly)${END}`)
const recurInterval = sticky(`(?:a cada|de|every)\\s+(${NUMBER_RE})\\s+(dias?|days?|semanas?|weeks?|meses|mes|months?|anos?|years?)(?:\\s+(?:na|no|on)\\s+(${WEEKDAY_RE}))?${END}`)
const recurYearlyDate = sticky(`(?:${everyPrefix}\\s+(?:ano\\s+(?:em|no dia)\\s+)?|every year on\\s+)(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?${END}`)

function recurWeekdayList(raw: string): number[] {
  const words = raw.split(/\s*(?:,|\be\b|\band\b|&)\s*/).map(word => word.replace(/^(a|as|o|os)\s+/, '').trim()).filter(Boolean)
  return [...new Set(words.map(weekdayIndex).filter(day => day >= 0))].sort((a, b) => a - b)
}

const matchRecurrence: Matcher = (s, at, st) => {
  if (st.repeat) return null
  let m = exec(recurMonthDay, s, at)
  if (m) {
    const d = Number(m[1])
    if (d < 1 || d > 31) return null
    if (m[2]) { const mo = monthIndex(m[2]); if (mo < 0) return null; st.repeat = 'yearly'; st.recurYearly = { month: mo, day: d } }
    else { st.repeat = 'monthly'; st.recurMonthDay = d }
    return m[0].length
  }
  m = exec(recurEveryNthMonthDay, s, at)
  if (m) { const d = Number(m[1]); if (d < 1 || d > 31) return null; st.repeat = 'monthly'; st.recurMonthDay = d; return m[0].length }
  m = exec(recurYearlyDate, s, at)
  if (m) { const mo = monthIndex(m[1]), d = Number(m[2]); if (mo < 0 || !validDay(2024, mo, d)) return null; st.repeat = 'yearly'; st.recurYearly = { month: mo, day: d }; return m[0].length }
  m = exec(recurWorkdays, s, at)
  if (m) { st.repeat = 'weekly'; st.recurWeekdays = [1, 2, 3, 4, 5]; return m[0].length }
  m = exec(recurDaily, s, at)
  if (m) { st.repeat = 'daily'; return m[0].length }
  m = exec(recurWeekdays, s, at)
  if (m) {
    const days = recurWeekdayList(m[1])
    if (!days.length) return null
    st.repeat = 'weekly'; st.recurWeekdays = days; return m[0].length
  }
  m = exec(recurInterval, s, at)
  if (m) {
    const n = numberOf(m[1])
    if (!Number.isInteger(n) || n < 1 || n > 999) return null
    const unit = m[2]
    st.repeat = /^(dias?|days?)$/.test(unit) ? 'daily' : /^(semanas?|weeks?)$/.test(unit) ? 'weekly' : /^(meses|mes|months?)$/.test(unit) ? 'monthly' : 'yearly'
    if (n > 1) st.recurrence = { ...st.recurrence, interval: n }
    if (m[3] && st.repeat === 'weekly') st.recurWeekdays = [weekdayIndex(m[3])]
    return m[0].length
  }
  m = exec(recurUnit, s, at)
  if (m) {
    const word = m[1] ?? m[0]
    if (/quinzen|biweekly|fortnight/.test(word)) { st.repeat = 'weekly'; st.recurrence = { ...st.recurrence, interval: 2 } }
    else st.repeat = /semana|week/.test(word) ? 'weekly' : /mes|month/.test(word) ? 'monthly' : 'yearly'
    return m[0].length
  }
  return null
}

const untilExpr = sticky(`(?:ate|until|till|through)\\s+`)
const matchUntil: Matcher = (s, at, st) => {
  if (!st.repeat || st.until) return null
  const m = exec(untilExpr, s, at)
  if (!m) return null
  // Reaproveita os reconhecedores de data num estado separado.
  const inner: State = { today: st.today, nowMinutes: st.nowMinutes, locale: st.locale }
  const pos = at + m[0].length
  for (const matcher of [matchAbsolute, matchPeriod, matchRelativeDay, matchWeekday, matchOffset]) {
    const used = matcher(s, pos, inner)
    if (used !== null && inner.date) { st.until = inner.date; return m[0].length + used }
  }
  return null
}

const startingExpr = sticky(`(?:a partir de|comecando|comecando em|starting|starting on|starting from|from)${END}`)
const matchStarting: Matcher = (s, at) => { const m = exec(startingExpr, s, at); return m ? m[0].length : null }

const CONNECTORS = sticky(`(?:de|do|da|em|no|na|on|the|e|and|-|–|@)(?=\\s|$)`)
const SPACE = /[\s,;]+/y

const MATCHERS: Matcher[] = [matchUntil, matchStarting, matchRecurrence, matchPeriod, matchRelativeDay, matchOffset, matchAbsolute, matchWeekday, matchTime]

function finish(st: State): { start: string; time?: string; repeat?: RepeatFreq; recurrence?: DateRecurrence } | null {
  let start = st.date
  if (st.repeat) {
    const base = start ?? st.today
    const timePassed = !start && st.time !== undefined && toMinutes(st.time) <= st.nowMinutes
    const from = timePassed ? addDays(base, 1) : base
    if (st.recurMonthDay !== undefined) start = nextDayOfMonth(from, st.recurMonthDay) ?? undefined
    else if (st.recurYearly) start = nextMonthDay(from, st.recurYearly.month, st.recurYearly.day) ?? undefined
    else if (st.recurWeekdays) {
      for (let k = 0; k < 7; k++) { const date = addDays(from, k); if (st.recurWeekdays.includes(weekday(date))) { start = date; break } }
    } else start = from
    if (!start) return null
    const recurrence: DateRecurrence = { ...st.recurrence }
    if (st.recurWeekdays && !(st.recurWeekdays.length === 1 && st.recurWeekdays[0] === weekday(start))) recurrence.weekdays = st.recurWeekdays
    if (st.until) { if (st.until < start) return null; recurrence.until = st.until }
    return { start, ...(st.time ? { time: st.time } : {}), repeat: st.repeat, ...(Object.keys(recurrence).length ? { recurrence } : {}) }
  }
  if (!start) {
    if (!st.time) return null
    // Só a hora: hoje se ainda não passou, senão amanhã.
    start = toMinutes(st.time) > st.nowMinutes ? st.today : addDays(st.today, 1)
  }
  return { start, ...(st.time ? { time: st.time } : {}) }
}
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }

/** Lê `text` a partir de `from`; devolve o estado e onde parou (consumindo o máximo possível). */
function scan(folded: string, from: number, st: State, requireEnd: boolean): number | null {
  let pos = from, lastUseful = -1
  let consumed = false
  for (let guard = 0; guard < 40 && pos < folded.length; guard++) {
    SPACE.lastIndex = pos
    const space = SPACE.exec(folded)
    if (space) { pos += space[0].length; if (pos >= folded.length) break }
    let used: number | null = null
    for (const matcher of MATCHERS) { used = matcher(folded, pos, st); if (used !== null) break }
    if (used !== null) { pos += used; consumed = true; lastUseful = pos; continue }
    const connector = exec(CONNECTORS, folded, pos)
    if (connector && consumed) { pos += connector[0].length; continue }
    if (connector && !consumed && /^(no|na|on|the|em|@)$/.test(connector[0])) { pos += connector[0].length; continue }
    break
  }
  if (!consumed) return null
  if (requireEnd && folded.slice(pos).trim() && folded.slice(lastUseful).trim()) return null
  return lastUseful
}

function baseState(options: NaturalDateOptions): State {
  const zone = validZone(options.timeZone)
  const { date, minutes } = civilNow(options.now ?? Date.now(), zone)
  return { today: date, nowMinutes: minutes, locale: options.locale ?? 'pt-BR' }
}

// Intervalos início → prazo. Aceita as duas línguas em qualquer locale (as palavras-chave não colidem).
const RANGE_PATTERNS: RegExp[] = [
  /^([\s@]*(?:de|do dia)\s+)(.+?)\s+(?:a|ate)\s+(.+)$/,
  /^([\s@]*(?:comeca|inicia|iniciando|inicio)\s+)(.+?)\s*[,;]?\s+(?:entrega|entregar|prazo|vence|termina|fim|ate)\s+(?:em\s+|no\s+)?(.+)$/,
  /^([\s@]*from\s+)(.+?)\s+(?:to|until|through|thru)\s+(.+)$/,
  /^([\s@]*(?:starts?|begins?|starting)\s+)(.+?)\s*[,;]?\s+(?:due|ends?|deadline|until)\s+(?:on\s+)?(.+)$/,
]

function parseRange(text: string, folded: string, options: NaturalDateOptions): ParsedNaturalDate | null {
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(folded)
    if (!match) continue
    const lead = match[1].length
    const first = text.slice(lead, lead + match[2].length), second = text.slice(folded.length - match[3].length)
    const a = parseNaturalDate(first, options, true)
    if (!a || a.repeat) continue
    let b = parseNaturalDate(second, options, true)
    if (!b || b.repeat) continue
    // "de segunda a sexta": o fim é resolvido a partir do início, não de hoje.
    if (b.start < a.start) {
      const base = Date.parse(`${a.start}T12:00:00Z`)
      b = parseNaturalDate(second, { ...options, now: base, timeZone: 'UTC' }, true)
      if (!b || b.repeat) continue
    }
    if (b.start <= a.start) continue
    const leadSpace = folded.match(/^[\s@]*/)![0].length
    return { start: a.start, ...(a.time ? { time: a.time } : {}), end: b.start, ...(b.time ? { endTime: b.time } : {}), text: text.slice(leadSpace).trim(), index: leadSpace, length: text.length - leadSpace }
  }
  return null
}

/** Interpreta o texto inteiro como uma data (ou intervalo); null quando sobra texto não reconhecido. */
export function parseNaturalDate(text: string, options: NaturalDateOptions = {}, single = false): ParsedNaturalDate | null {
  if (typeof text !== 'string' || !text.trim() || text.length > 200) return null
  const folded = foldPreservingLength(text)
  const st = baseState(options)
  if (!single) { const range = parseRange(text, folded, options); if (range) return range }
  const lead = folded.match(/^[\s@]*/)![0].length
  const end = scan(folded, lead, st, true)
  if (end === null) return null
  const result = finish(st)
  if (!result || !validISODate(result.start)) return null
  return { ...result, text: text.slice(lead, end).trim(), index: lead, length: end - lead }
}

/**
 * Procura uma data marcada com "@" dentro de um texto livre (nota rápida, título): tenta o trecho
 * mais longo (até 8 palavras) após o "@" que forme uma data válida. "@amanhã às 9h comprar pão".
 */
export function findMarkedDate(text: string, options: NaturalDateOptions = {}): ParsedNaturalDate | null {
  if (typeof text !== 'string') return null
  const marker = /(^|[\s(])@(?=\S)/g
  for (const match of text.matchAll(marker)) {
    const start = match.index! + match[1].length + 1
    const quoted = /^"([^"\n]{1,120})"/.exec(text.slice(start))
    if (quoted) {
      const parsed = parseNaturalDate(quoted[1], options)
      if (parsed) return { ...parsed, text: quoted[0], index: start - 1, length: quoted[0].length + 1 }
      continue
    }
    const rest = text.slice(start).split('\n')[0]
    const words = [...rest.matchAll(/\S+/g)].slice(0, 8)
    for (let n = words.length; n >= 1; n--) {
      const last = words[n - 1]
      const end = last.index! + last[0].replace(/[.,;:!?)]+$/, '').length
      const candidate = rest.slice(0, end)
      const parsed = parseNaturalDate(candidate, options)
      if (parsed) return { ...parsed, text: candidate, index: start - 1, length: end + 1 }
    }
  }
  return null
}

// ---------- Saídas ----------

/** Valor de propriedade de data (banco). A hora fica em `startTime`; a regra em repeat/recurrence. */
export function toDateValue(parsed: Pick<ParsedNaturalDate, 'start' | 'time' | 'repeat' | 'recurrence'> & { end?: string; endTime?: string }, base: DateValue | null = null): DateValue {
  const value: DateValue = { ...(base ?? {}), start: parsed.start }
  delete value.end; delete value.endTime
  if (parsed.end) { value.end = parsed.end; if (parsed.endTime) value.endTime = parsed.endTime }
  if (parsed.time) value.startTime = parsed.time
  else delete value.startTime
  if (parsed.repeat) { value.repeat = parsed.repeat; if (parsed.recurrence) value.recurrence = parsed.recurrence; else delete value.recurrence }
  else if (base?.repeat && base.repeat !== 'none') { value.repeat = base.repeat; if (base.recurrence) value.recurrence = { ...base.recurrence, anchor: undefined } }
  if (value.recurrence) { delete value.recurrence.anchor; if (!Object.keys(value.recurrence).length) delete value.recurrence }
  return value
}

/** Instante (epoch ms) da data/hora no fuso; sem hora usa `fallbackTime`. DST: ver wallTimeToEpoch. */
export function parsedInstant(parsed: Pick<ParsedNaturalDate, 'start' | 'time'>, timeZone?: string, fallbackTime = '12:00'): number | null {
  return wallTimeToEpoch(parsed.start, parsed.time ?? fallbackTime, validZone(timeZone))
}

/** Preset aceito pela menção de data em to-dos (src/recurrence.ts MENTION_REPEAT_PRESETS) ou null. */
export function mentionRepeatOf(parsed: Pick<ParsedNaturalDate, 'start' | 'repeat' | 'recurrence'>): '' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | null {
  if (!parsed.repeat) return ''
  const r = parsed.recurrence ?? {}
  if (r.interval && r.interval !== 1) return null
  if (r.until || r.count) return null
  if (parsed.repeat === 'weekly' && r.weekdays) return r.weekdays.join() === '1,2,3,4,5' ? 'weekdays' : null
  return parsed.repeat
}

/** "8 de outubro de 2026 09:00 · Todo mês no dia 5" / "October 8, 2026 9:00 AM · Every month on day 5". */
export function describeNaturalDate(parsed: Pick<ParsedNaturalDate, 'start' | 'time' | 'repeat' | 'recurrence'> & { end?: string }, locale: string = 'pt-BR'): string {
  const [y, m, d] = ymd(parsed.start)
  const en = locale.startsWith('en')
  if (parsed.end) {
    const { end, ...rest } = parsed
    const fmt = (iso: string) => { const [yy, mm, dd] = ymd(iso); return new Intl.DateTimeFormat(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(yy, mm - 1, dd))) }
    return `${en ? 'Starts' : 'Início'} ${fmt(rest.start)} · ${en ? 'Due' : 'Prazo'} ${fmt(end)}`
  }
  const date = new Intl.DateTimeFormat(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  let time = ''
  if (parsed.time) {
    const [h, mi] = parsed.time.split(':').map(Number)
    time = en ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, mi))) : parsed.time
  }
  const rule = parsed.repeat ? describeRecurrence({ start: parsed.start, repeat: parsed.repeat, recurrence: parsed.recurrence } as DateValue, en ? 'en-US' : 'pt-BR') : ''
  return [date + (time ? ` ${time}` : ''), rule].filter(Boolean).join(' · ')
}

/** Weekday helper re-exported for UI (0 = domingo). */
export const weekdayOfISO = weekday
export { addMonths as addMonthsISO, addBusinessDays, daysInMonth }
