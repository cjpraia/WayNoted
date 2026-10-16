// Registro de produtividade (docs/USAGE.md): formato e mescla do arquivo `productivity.json`.
// Puro e compartilhado entre o processo principal (gravação) e o renderer (navegador/exibição).
// Só contadores agregados por dia local — nunca conteúdo nem títulos.

export const PRODUCTIVITY_VERSION = 1
/** Rajadas de edição separadas por pelo menos este intervalo contam como sessões distintas. */
export const SESSION_GAP_MS = 10 * 60 * 1000
/** Máximo de páginas guardadas por dia (as mais trabalhadas). */
export const PAGES_PER_DAY = 20
const KEY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const count = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** Dia local 'YYYY-MM-DD' de um instante. */
export function dayKey(epoch) {
  const date = new Date(epoch)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function emptyDay() { return { words: 0, edits: 0, sessions: 0, created: 0, tasks: 0, hours: new Array(24).fill(0) } }
export function emptyData() { return { v: PRODUCTIVITY_VERSION, days: {} } }

function normalizeDay(raw) {
  const day = emptyDay()
  if (!raw || typeof raw !== 'object') return day
  for (const field of ['words', 'edits', 'sessions', 'created', 'tasks']) day[field] = count(raw[field])
  if (Array.isArray(raw.hours)) for (let hour = 0; hour < 24; hour++) day.hours[hour] = count(raw.hours[hour])
  if (raw.pages && typeof raw.pages === 'object') {
    const pages = {}
    for (const [id, value] of Object.entries(raw.pages)) if (UUID.test(id) && Array.isArray(value)) pages[id] = [count(value[0]), count(value[1])]
    if (Object.keys(pages).length) day.pages = trimPages(pages)
  }
  if (raw.estimated) day.estimated = true
  return day
}

/** Valida/normaliza um arquivo lido do disco; dados estranhos são descartados, nunca propagados. */
export function normalizeData(raw) {
  const data = emptyData()
  if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') return data
  for (const [key, value] of Object.entries(raw.days)) if (KEY.test(key)) data.days[key] = normalizeDay(value)
  for (const field of ['trackingSince', 'backfilledAt', 'lastEditAt', 'clearedAt']) if (count(raw[field])) data[field] = count(raw[field])
  return data
}

const weight = ([words, edits]) => words + edits * 5
/** Mantém só as PAGES_PER_DAY páginas com mais palavras/edições (peso: palavras + 5 × edições). */
export function trimPages(pages) {
  const entries = Object.entries(pages)
  if (entries.length <= PAGES_PER_DAY) return pages
  return Object.fromEntries(entries.sort((a, b) => weight(b[1]) - weight(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, PAGES_PER_DAY))
}

function addDay(target, delta) {
  for (const field of ['words', 'edits', 'sessions', 'created', 'tasks']) target[field] += count(delta[field])
  if (Array.isArray(delta.hours)) for (let hour = 0; hour < 24; hour++) target.hours[hour] += count(delta.hours[hour])
  if (delta.pages && typeof delta.pages === 'object') {
    const pages = { ...(target.pages ?? {}) }
    for (const [id, value] of Object.entries(delta.pages)) {
      if (!UUID.test(id) || !Array.isArray(value)) continue
      const current = pages[id] ?? [0, 0]
      pages[id] = [current[0] + count(value[0]), current[1] + count(value[1])]
    }
    target.pages = trimPages(pages)
  }
}

/**
 * Soma um delta (incrementos de uma janela) ao arquivo. Comutativa: janelas diferentes podem gravar em
 * qualquer ordem sem perder contagens. As sessões vêm de `spans` ([início, fim] de rajadas de edição):
 * uma rajada abre sessão nova quando começa SESSION_GAP_MS depois da última edição já registrada —
 * assim duas janelas editando ao mesmo tempo não contam sessões em dobro.
 */
export function applyDelta(current, delta, keyOf = dayKey) {
  const data = normalizeData(current)
  if (!delta || typeof delta !== 'object') return data
  for (const [key, value] of Object.entries(delta.days ?? {})) {
    if (!KEY.test(key) || !value || typeof value !== 'object') continue
    const day = data.days[key] ?? emptyDay()
    addDay(day, { ...value, sessions: 0 })
    data.days[key] = day
  }
  const spans = (Array.isArray(delta.spans) ? delta.spans : []).filter(span => Array.isArray(span) && count(span[0]) && count(span[1]) >= count(span[0])).sort((a, b) => a[0] - b[0])
  for (const [start, end] of spans) {
    if (!data.lastEditAt || start - data.lastEditAt >= SESSION_GAP_MS) {
      const key = keyOf(start), day = data.days[key] ?? emptyDay()
      day.sessions++
      data.days[key] = day
    }
    data.lastEditAt = Math.max(data.lastEditAt ?? 0, end)
  }
  if (!data.trackingSince && (spans.length || Object.keys(delta.days ?? {}).length)) data.trackingSince = count(delta.at) || Date.now()
  return data
}

/**
 * Aplica o histórico reconstruído (uma única vez por espaço). Só entram dias anteriores ao início do
 * registro ao vivo; eles ficam marcados como estimados. Devolve o arquivo sem mudanças se já houve backfill.
 */
export function applyBackfill(current, days, now = Date.now()) {
  const data = normalizeData(current)
  if (data.backfilledAt) return data
  const since = dayKey(data.trackingSince ?? now)
  for (const [key, value] of Object.entries(days ?? {})) {
    if (!KEY.test(key) || key >= since || !value || typeof value !== 'object') continue
    const day = data.days[key] ?? emptyDay()
    addDay(day, value)
    day.estimated = true
    data.days[key] = day
  }
  data.backfilledAt = now
  if (!data.trackingSince) data.trackingSince = now
  return data
}

/** "Apagar histórico": zera os dias e impede que a estimativa seja refeita automaticamente. */
export function clearedData(now = Date.now()) { return { v: PRODUCTIVITY_VERSION, days: {}, trackingSince: now, backfilledAt: now, clearedAt: now } }
