// Recorrência de datas: cálculo puro em datas civis (AAAA-MM-DD), sem relógio nem fuso implícitos.
// Compartilhado pelo renderer (src/recurrence.ts) e pelo processo principal (lembretes com o app sem janela).

const DAY = 86_400_000
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly']
export const REMINDER_OFFSETS = [0, 5, 15, 30, 60, 1440]
const parse = (value) => Date.parse(`${value}T00:00:00.000Z`)
const iso = (epoch) => new Date(epoch).toISOString().slice(0, 10)
export const validISODate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parse(value)) && iso(parse(value)) === value
export const addDays = (value, days) => iso(parse(value) + days * DAY)
export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / DAY)
export const weekdayOf = (value) => new Date(parse(value)).getUTCDay()
const ymd = (value) => value.split('-').map(Number)
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const make = (year, month, day) => iso(Date.UTC(year, month - 1, day))
const shiftMonth = (year, month, k) => { const total = year * 12 + (month - 1) + k; return [Math.floor(total / 12), (total % 12) + 1] }
const maxISO = (a, b) => (a > b ? a : b)

function nthWeekday(year, month, weekday, nth) {
  const last = daysInMonth(year, month)
  if (nth < 0) return make(year, month, last - ((weekdayOf(make(year, month, last)) - weekday + 7) % 7))
  const first = 1 + ((weekday - weekdayOf(make(year, month, 1)) + 7) % 7)
  return make(year, month, Math.min(first + (nth - 1) * 7, last))
}

/** Ordem do dia da semana dentro do mês (1–4) ou -1 quando é a quinta ocorrência. */
export function weekdayOrdinal(value) { const n = Math.ceil(ymd(value)[2] / 7); return n > 4 ? -1 : n }
export const isLastWeekdayOfMonth = (value) => { const [y, m, d] = ymd(value); return d + 7 > daysInMonth(y, m) }

/** Regra normalizada; dados antigos (`repeat` sem `recurrence`) viram intervalo 1 sem fim. */
export function recurrenceRule(value) {
  if (!value || typeof value !== 'object' || !validISODate(value.start) || !RECURRENCE_FREQS.includes(value.repeat)) return null
  const raw = value.recurrence && typeof value.recurrence === 'object' ? value.recurrence : {}
  const anchor = validISODate(raw.anchor) && raw.anchor <= value.start ? raw.anchor : value.start
  const interval = Number.isInteger(raw.interval) && raw.interval >= 1 ? Math.min(raw.interval, 999) : 1
  const freq = value.repeat
  let weekdays
  if (freq === 'weekly') {
    weekdays = [...new Set(Array.isArray(raw.weekdays) ? raw.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort((a, b) => a - b)
    if (!weekdays.length) weekdays = [weekdayOf(anchor)]
  }
  const monthly = freq === 'monthly' ? (raw.monthly === 'weekday' || raw.monthly === 'lastWeekday' ? raw.monthly : 'day') : undefined
  const until = validISODate(raw.until) ? raw.until : undefined
  const count = Number.isInteger(raw.count) && raw.count >= 1 ? raw.count : undefined
  return { freq, interval, weekdays, monthly, until, count, anchor }
}

export const isRecurring = (value) => recurrenceRule(value) !== null

/** Datas do período `p` (ordem crescente) e o ordinal da primeira, contado a partir da âncora. */
function period(rule, p) {
  const { anchor, interval } = rule
  const [ay, am, ad] = ymd(anchor)
  if (rule.freq === 'daily') return { dates: [addDays(anchor, p * interval)], ordinal: p }
  if (rule.freq === 'weekly') {
    const weekStart = addDays(anchor, -weekdayOf(anchor))
    const base = addDays(weekStart, p * interval * 7)
    const firstWeek = rule.weekdays.filter((day) => day >= weekdayOf(anchor)).length
    const dates = rule.weekdays.map((day) => addDays(base, day)).filter((date) => date >= anchor)
    return { dates, ordinal: p === 0 ? 0 : firstWeek + (p - 1) * rule.weekdays.length }
  }
  if (rule.freq === 'monthly') {
    const [y, m] = shiftMonth(ay, am, p * interval)
    const date = rule.monthly === 'day' ? make(y, m, Math.min(ad, daysInMonth(y, m)))
      : nthWeekday(y, m, weekdayOf(anchor), rule.monthly === 'lastWeekday' ? -1 : weekdayOrdinal(anchor))
    return { dates: date >= anchor ? [date] : [], ordinal: p }
  }
  const y = ay + p * interval
  return { dates: [make(y, am, Math.min(ad, daysInMonth(y, am)))], ordinal: p }
}

function firstPeriod(rule, from) {
  if (from <= rule.anchor) return 0
  const { anchor, interval } = rule
  const [ay, am] = ymd(anchor), [fy, fm] = ymd(from)
  if (rule.freq === 'daily') return Math.max(0, Math.floor(daysBetween(anchor, from) / interval))
  if (rule.freq === 'weekly') return Math.max(0, Math.floor(daysBetween(addDays(anchor, -weekdayOf(anchor)), from) / (7 * interval)))
  if (rule.freq === 'monthly') return Math.max(0, Math.floor(((fy - ay) * 12 + fm - am) / interval) - 1)
  return Math.max(0, Math.floor((fy - ay) / interval) - 1)
}

/**
 * Ocorrências da série (início em ISO e ordinal desde a âncora) com início em [from, to].
 * Respeita fim por data (inclusivo) e por contagem; nunca percorre mais que `limit` resultados.
 */
export function occurrenceStarts(value, from, to, limit = 400) {
  const rule = recurrenceRule(value)
  if (!rule || !validISODate(from) || !validISODate(to) || from > to || !(limit >= 1)) return []
  const result = []
  for (let p = firstPeriod(rule, from), guard = 0; guard < 20_000 && result.length < limit; p++, guard++) {
    const { dates, ordinal } = period(rule, p)
    let stop = false
    for (let index = 0; index < dates.length; index++) {
      const date = dates[index], position = ordinal + index
      if (rule.count !== undefined && position >= rule.count) { stop = true; break }
      if ((rule.until && date > rule.until) || date > to) { stop = true; break }
      if (date >= from) result.push({ start: date, ordinal: position })
      if (result.length >= limit) { stop = true; break }
    }
    if (stop) break
  }
  return result
}

/** Primeira ocorrência estritamente depois de `after`, ou null se a série terminou. */
export function nextOccurrenceAfter(value, after) {
  if (!validISODate(after)) return null
  return occurrenceStarts(value, addDays(after, 1), '9999-12-31', 1)[0]?.start ?? null
}

/**
 * Próxima data ao concluir (como o Todoist): a primeira ocorrência depois da atual que não esteja
 * no passado. Mantém duração, horas, fuso e lembrete; grava a âncora para preservar fim de mês e contagem.
 */
export function advanceDateValue(value, today) {
  const rule = recurrenceRule(value)
  if (!rule) return null
  const from = maxISO(addDays(value.start, 1), validISODate(today) ? today : value.start)
  const next = occurrenceStarts(value, from, '9999-12-31', 1)[0]
  if (!next) return null
  const duration = value.end && validISODate(value.end) && value.end > value.start ? daysBetween(value.start, value.end) : 0
  const result = { ...value, start: next.start, recurrence: { ...(value.recurrence ?? {}), anchor: rule.anchor } }
  if (value.end) result.end = addDays(next.start, duration)
  return result
}

const WEEKDAY_NAMES = {
  pt: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}
const joinList = (items, en) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${en ? 'and' : 'e'} ${items.at(-1)}`
const ordinalWord = (n, en) => en ? (n === -1 ? 'last' : ['1st', '2nd', '3rd', '4th'][n - 1]) : (n === -1 ? 'última' : `${n}ª`)

function shortDate(value, en, omitYear) {
  const [y, m, d] = ymd(value), pad = (n) => String(n).padStart(2, '0')
  if (en) return omitYear ? `${pad(m)}/${pad(d)}` : `${pad(m)}/${pad(d)}/${y}`
  return omitYear ? `${pad(d)}/${pad(m)}` : `${pad(d)}/${pad(m)}/${y}`
}

/** Resumo legível, ex.: "Toda segunda e quarta, até 31/12" / "Every Monday and Wednesday, until 12/31". */
export function describeRecurrence(value, locale = 'pt-BR') {
  const rule = recurrenceRule(value)
  if (!rule) return ''
  const en = String(locale).startsWith('en')
  const n = rule.interval
  let text
  if (rule.freq === 'daily') text = n === 1 ? (en ? 'Every day' : 'Todo dia') : (en ? `Every ${n} days` : `A cada ${n} dias`)
  else if (rule.freq === 'weekly') {
    const days = rule.weekdays
    const names = days.map((day) => WEEKDAY_NAMES[en ? 'en' : 'pt'][day])
    const workdays = days.length === 5 && days.every((day, index) => day === index + 1)
    if (n === 1 && workdays) text = en ? 'Every weekday' : 'Todo dia útil'
    else if (n === 1 && days.length === 7) text = en ? 'Every day' : 'Todo dia'
    else if (n === 1) text = en ? `Every ${joinList(names, true)}` : `${days[0] === 0 || days[0] === 6 ? 'Todo' : 'Toda'} ${joinList(names, false)}`
    else text = en ? `Every ${n} weeks on ${joinList(names, true)}` : `A cada ${n} semanas: ${joinList(names, false)}`
  } else if (rule.freq === 'monthly') {
    const every = n === 1 ? (en ? 'Every month' : 'Todo mês') : (en ? `Every ${n} months` : `A cada ${n} meses`)
    if (rule.monthly === 'day') text = en ? `${every} on day ${ymd(rule.anchor)[2]}` : `${every} no dia ${ymd(rule.anchor)[2]}`
    else {
      const nth = rule.monthly === 'lastWeekday' ? -1 : weekdayOrdinal(rule.anchor)
      const day = WEEKDAY_NAMES[en ? 'en' : 'pt'][weekdayOf(rule.anchor)]
      const masculine = !en && (weekdayOf(rule.anchor) === 0 || weekdayOf(rule.anchor) === 6)
      text = en ? `${every} on the ${ordinalWord(nth, true)} ${day}` : `${every} ${masculine ? 'no' : 'na'} ${masculine ? (nth === -1 ? 'último' : `${nth}º`) : ordinalWord(nth, false)} ${day}`
    }
  } else {
    const [, m, d] = ymd(rule.anchor)
    const label = new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString(en ? 'en-US' : 'pt-BR', { day: 'numeric', month: en ? 'short' : 'long', timeZone: 'UTC' })
    text = n === 1 ? (en ? `Every year on ${label}` : `Todo ano em ${label}`) : (en ? `Every ${n} years on ${label}` : `A cada ${n} anos em ${label}`)
  }
  if (rule.until) text += en ? `, until ${shortDate(rule.until, true, rule.until.slice(0, 4) === value.start.slice(0, 4))}` : `, até ${shortDate(rule.until, false, rule.until.slice(0, 4) === value.start.slice(0, 4))}`
  else if (rule.count) text += en ? `, ${rule.count} ${rule.count === 1 ? 'time' : 'times'}` : `, ${rule.count} ${rule.count === 1 ? 'vez' : 'vezes'}`
  return text
}

// ---------- Fuso e lembretes ----------

const zoneOk = (zone) => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true } catch { return false } }
function partsAt(epoch, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
}

/**
 * Instante de uma data/hora civil num fuso IANA. Horário inexistente (salto do DST) avança para o
 * primeiro minuto válido; horário repetido (recuo do DST) usa a primeira ocorrência.
 */
export function wallTimeToEpoch(date, time, zone) {
  if (!validISODate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !zoneOk(zone)) return null
  const [h, mi] = time.split(':').map(Number)
  const wall = parse(date) + (h * 60 + mi) * 60_000
  // Candidatos: deslocamentos do fuso nas vizinhanças (antes/depois de uma possível transição).
  const offsets = [...new Set([wall - 36 * 3_600_000, wall, wall + 36 * 3_600_000].map((probe) => partsAt(probe, zone) - probe))]
  const exact = offsets.map((offset) => wall - offset).filter((epoch) => partsAt(epoch, zone) === wall).sort((a, b) => a - b)
  if (exact.length) return exact[0]
  // Lacuna: o relógio pula; usa o mesmo instante "depois do salto" (ex.: 02:30 → 03:30).
  // Usar o deslocamento anterior ao salto dá o maior instante candidato.
  return Math.max(...offsets.map((offset) => wall - offset))
}

/** Instante do lembrete de uma ocorrência; data sem hora usa 09:00. "1 dia antes" é civil (mesma hora). */
export function reminderInstant(value, occurrence, minutesBefore, fallbackZone) {
  if (!Number.isFinite(minutesBefore) || minutesBefore < 0) return null
  const zone = value.timeZone && zoneOk(value.timeZone) ? value.timeZone : fallbackZone
  const days = Math.floor(minutesBefore / 1440), rest = minutesBefore % 1440
  const epoch = wallTimeToEpoch(addDays(occurrence, -days), value.startTime || '09:00', zone)
  return epoch === null ? null : epoch - rest * 60_000
}

export function doneProperty(schema, dateProperty) {
  const chosen = dateProperty?.recurrenceDoneProperty
  if (chosen === 'none') return null
  const usable = (property) => property.type === 'status' || property.type === 'checkbox'
  return schema.properties.find((property) => property.id === chosen && usable(property))
    ?? schema.properties.find((property) => property.type === 'status')
    ?? schema.properties.find((property) => property.type === 'checkbox') ?? null
}

export function isDoneValue(property, value) {
  if (!property) return false
  if (property.type === 'checkbox') return value === true
  return !!property.options?.some((option) => option.id === value && option.group === 'complete')
}

function livePage(pages, id) {
  const seen = new Set()
  for (let page = pages[id]; page; page = page.parentId ? pages[page.parentId] : undefined) {
    if (page.trashed || seen.has(page.id)) return false
    seen.add(page.id)
  }
  return !!pages[id]
}

function reminderBody(value, occurrence, locale) {
  const en = String(locale).startsWith('en')
  const [y, m, d] = ymd(occurrence)
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(en ? 'en-US' : 'pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const when = value.startTime ? `${date} ${value.startTime}` : date
  const summary = describeRecurrence(value, locale)
  // Intervalo início → prazo: o lembrete dispara no início e informa os dois dias.
  const due = value.end && validISODate(value.end) && value.end > value.start ? shortDate(addDays(occurrence, daysBetween(value.start, value.end)), en, false) : ''
  const head = due ? `${en ? 'Starts' : 'Começa'} ${when} · ${en ? 'due' : 'prazo'} ${due}` : `${en ? 'Due' : 'Vence'} ${when}`
  return `${head}${summary ? ` · ↻ ${summary}` : ''}`
}

/**
 * Mantém um lembrete pendente por (linha, propriedade de data) com `reminder` definido.
 * IDs determinísticos tornam a operação idempotente; lembretes já disparados ficam como histórico.
 */
export function reconcileDateReminders(notifications, pages, now, options = {}) {
  const zone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = options.locale ?? 'pt-BR'
  const current = notifications ?? {}
  const next = { ...current }
  const desired = new Set()
  let changed = false
  for (const row of Object.values(pages ?? {})) {
    const schema = row.parentId ? pages[row.parentId]?.database : undefined
    if (!schema || !row.props || !livePage(pages, row.id)) continue
    for (const property of schema.properties) {
      const value = row.props[property.id]
      if (property.type !== 'date' || !value || typeof value !== 'object' || !validISODate(value.start) || !REMINDER_OFFSETS.includes(value.reminder)) continue
      const done = doneProperty(schema, property)
      if (done && isDoneValue(done, row.props[done.id])) continue
      const key = (occurrence) => `date-reminder:${row.id}:${property.id}:${occurrence}`
      const fired = (occurrence) => current[key(occurrence)] !== undefined && current[key(occurrence)].firedAt != null
      const candidates = [value.start]
      if (isRecurring(value)) {
        for (const { start } of occurrenceStarts(value, addDays(value.start, 1), addDays(maxISO(value.start, iso(now)), 400), 60)) {
          const at = reminderInstant(value, start, value.reminder, zone)
          if (at !== null && at > now) { candidates.push(start); break }
        }
      }
      const target = candidates.find((occurrence) => !fired(occurrence))
      if (!target) continue
      const dueAt = reminderInstant(value, target, value.reminder, zone)
      if (dueAt === null) continue
      const id = key(target)
      desired.add(id)
      // Adiado na Caixa de entrada: respeita o novo horário até disparar.
      const snoozed = current[id]?.source?.snoozed === true && current[id].firedAt == null
      const item = { id, pageId: row.id, title: row.title || (String(locale).startsWith('en') ? 'Untitled' : 'Sem título'), body: reminderBody(value, target, locale), dueAt: snoozed ? current[id].dueAt : dueAt, createdAt: dueAt, readAt: null, firedAt: null, repeat: 'none', source: { kind: 'date', rowId: row.id, propertyId: property.id, occurrence: target, ...(snoozed ? { snoozed: true } : {}) } }
      if (JSON.stringify(current[id]) !== JSON.stringify(item)) { next[id] = item; changed = true }
    }
  }
  for (const item of Object.values(current)) {
    if (item.source?.kind !== 'date') continue
    const stale = item.firedAt == null && !desired.has(item.id)
    // Excluídos na Caixa de entrada ficam como marcador só enquanto puderem voltar a ser alvo.
    const startNow = pages?.[item.source.rowId]?.props?.[item.source.propertyId]?.start
    const obsoleteTombstone = item.dismissedAt != null && (!validISODate(startNow) || item.source.occurrence < startNow)
    if (stale || obsoleteTombstone) { delete next[item.id]; changed = true }
  }
  return { notifications: changed ? next : current, changed }
}
