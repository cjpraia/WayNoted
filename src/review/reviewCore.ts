// Revisão espaçada (A6) — parte pura: fila "Para revisar hoje", estatísticas, cartões de alternância e desfazer.
// Sem store e sem React. O estado dos cartões fica em `settings.review` (não altera a página nem o histórico dela).
import { endOfDay, isDue, newCard, reviewCard, validCard, type FsrsParams, type Grade, type ReviewCard } from './fsrs.ts'

/** Chave de um cartão: `pageId` (página/linha inteira) ou `pageId#blockId` (bloco de alternância). */
export type CardKey = string

/** Dia civil local: [revisões, acertos (nota ≥ 2), cartões novos apresentados]. */
export type DayLog = [number, number, number]

export interface ReviewSettings {
  /** Cartões marcados, por chave. */
  cards?: Record<CardKey, ReviewCard>
  /** Páginas cujos blocos de alternância (título = pergunta, filhos = resposta) viram cartões. */
  toggles?: Record<string, true>
  log?: Record<string, DayLog>
  /** Retenção desejada (0,7–0,97). */
  retention?: number
  /** Máximo de cartões novos por dia (padrão 20). */
  newPerDay?: number
  maxInterval?: number
}

export const DEFAULT_NEW_PER_DAY = 20
const LOG_DAYS = 400
const MAX_CARDS = 20_000

export const splitKey = (key: CardKey): { pageId: string; blockId?: string } => {
  const at = key.indexOf('#')
  return at < 0 ? { pageId: key } : { pageId: key.slice(0, at), blockId: key.slice(at + 1) }
}
export const cardKey = (pageId: string, blockId?: string): CardKey => (blockId ? `${pageId}#${blockId}` : pageId)

export const localDayOf = (now: number): string => {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function paramsOf(settings: ReviewSettings | undefined): Partial<FsrsParams> {
  return { retention: settings?.retention, maxInterval: settings?.maxInterval }
}

// ---------- Fila ----------

export interface QueueInput {
  settings: ReviewSettings | undefined
  now: number
  /** A página existe, está viva e pode mostrar conteúdo (sem lixeira nem senha). */
  pageOk(pageId: string): boolean
  /** Para blocos de alternância: o bloco ainda existe? (null = não verificado, aceita). */
  blockOk?(pageId: string, blockId: string): boolean
}

export interface Queue {
  /** Devidos hoje (revisões), do mais atrasado ao mais recente. */
  due: CardKey[]
  /** Novos que cabem no limite de hoje. */
  fresh: CardKey[]
  /** Novos além do limite diário. */
  waiting: number
  /** Cartões aprendendo cuja próxima tentativa passa de agora (minutos) mas ainda é hoje. */
  total: number
}

const dueOrder = (cards: Record<string, ReviewCard>) => (a: CardKey, b: CardKey) => cards[a].due - cards[b].due || a.localeCompare(b)

export function buildQueue({ settings, now, pageOk, blockOk }: QueueInput): Queue {
  const cards = settings?.cards ?? {}
  const limit = Math.max(0, Math.round(settings?.newPerDay ?? DEFAULT_NEW_PER_DAY))
  const introduced = settings?.log?.[localDayOf(now)]?.[2] ?? 0
  const due: CardKey[] = [], fresh: CardKey[] = []
  for (const key of Object.keys(cards)) {
    const card = cards[key]
    if (!validCard(card)) continue
    const { pageId, blockId } = splitKey(key)
    if (!pageOk(pageId) || (blockId && blockOk && !blockOk(pageId, blockId))) continue
    if (card.phase === 'new') fresh.push(key)
    else if (isDue(card, now)) due.push(key)
  }
  due.sort(dueOrder(cards))
  fresh.sort((a, b) => cards[a].due - cards[b].due || a.localeCompare(b))
  const room = Math.max(0, limit - introduced)
  const today = fresh.slice(0, room)
  return { due, fresh: today, waiting: fresh.length - today.length, total: due.length + today.length }
}

/** Fila em ordem de sessão: devidos primeiro, depois novos. */
export const queueOrder = (queue: Queue): CardKey[] => [...queue.due, ...queue.fresh]

// ---------- Gravação das notas ----------

export interface RateResult {
  settings: ReviewSettings
  /** Estado anterior para desfazer. */
  undo: UndoEntry
  card: ReviewCard
}
export interface UndoEntry { key: CardKey; before: ReviewCard | null; day: string; logBefore: DayLog | null }

const prune = (log: Record<string, DayLog>, today: string): Record<string, DayLog> => {
  const keys = Object.keys(log).sort()
  if (keys.length <= LOG_DAYS) return log
  const out: Record<string, DayLog> = {}
  for (const key of keys.slice(keys.length - LOG_DAYS)) out[key] = log[key]
  void today
  return out
}

/** Aplica uma nota: novo estado do cartão, contagem do dia e o que for preciso para desfazer. */
export function applyRating(settings: ReviewSettings | undefined, key: CardKey, grade: Grade, now: number): RateResult | null {
  const current = settings?.cards?.[key]
  if (!current || !validCard(current)) return null
  const day = localDayOf(now)
  const log = { ...settings?.log }
  const before = log[day] ?? null
  const next = reviewCard(current, grade, now, paramsOf(settings))
  const [reviews, passed, fresh] = before ?? [0, 0, 0]
  log[day] = [reviews + 1, passed + (grade >= 2 ? 1 : 0), fresh + (current.phase === 'new' ? 1 : 0)]
  return {
    card: next,
    undo: { key, before: current, day, logBefore: before },
    settings: { ...settings, cards: { ...settings?.cards, [key]: next }, log: prune(log, day) },
  }
}

/** Desfaz a última nota (cartão e contagem do dia). */
export function undoRating(settings: ReviewSettings | undefined, entry: UndoEntry): ReviewSettings {
  const cards = { ...settings?.cards }
  if (entry.before) cards[entry.key] = entry.before
  else delete cards[entry.key]
  const log = { ...settings?.log }
  if (entry.logBefore) log[entry.day] = entry.logBefore
  else delete log[entry.day]
  return { ...settings, cards, log }
}

// ---------- Marcar e desmarcar ----------

export function addCards(settings: ReviewSettings | undefined, keys: readonly CardKey[], now: number): ReviewSettings {
  const cards = { ...settings?.cards }
  let count = Object.keys(cards).length
  for (const key of keys) {
    if (cards[key] || count >= MAX_CARDS) continue
    cards[key] = newCard(now)
    count++
  }
  return { ...settings, cards }
}

export function removeCards(settings: ReviewSettings | undefined, match: (key: CardKey) => boolean): ReviewSettings {
  const cards: Record<string, ReviewCard> = {}
  for (const [key, card] of Object.entries(settings?.cards ?? {})) if (!match(key)) cards[key] = card
  return { ...settings, cards }
}

export const isCardPage = (settings: ReviewSettings | undefined, pageId: string) => !!settings?.cards?.[pageId]
export const cardCountForPage = (settings: ReviewSettings | undefined, pageId: string) => Object.keys(settings?.cards ?? {}).filter(key => splitKey(key).pageId === pageId && key !== pageId).length

// ---------- Estatísticas ----------

export interface ReviewStats {
  today: number
  /** Porcentagem (0–100) de acertos nos últimos 30 dias; null sem revisões. */
  retention: number | null
  /** Dias seguidos com revisão (até hoje; se hoje ainda não revisou, conta até ontem). */
  streak: number
  total: number
}

const addDay = (day: string, delta: number): string => {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function reviewStats(settings: ReviewSettings | undefined, now: number): ReviewStats {
  const log = settings?.log ?? {}
  const today = localDayOf(now)
  let reviews = 0, passed = 0
  for (let i = 0, day = today; i < 30; i++, day = addDay(day, -1)) { const entry = log[day]; if (entry) { reviews += entry[0]; passed += entry[1] } }
  let streak = 0
  let day = (log[today]?.[0] ?? 0) > 0 ? today : addDay(today, -1)
  for (let guard = 0; guard < LOG_DAYS && (log[day]?.[0] ?? 0) > 0; guard++, day = addDay(day, -1)) streak++
  return { today: log[today]?.[0] ?? 0, retention: reviews ? Math.round((passed / reviews) * 100) : null, streak, total: Object.keys(settings?.cards ?? {}).length }
}

/** Quantos cartões vencem em cada um dos próximos `days` dias (para o gráfico simples da tela Revisão). */
export function forecast(settings: ReviewSettings | undefined, now: number, days = 7): number[] {
  const out = new Array<number>(days).fill(0)
  const start = endOfDay(now)
  for (const card of Object.values(settings?.cards ?? {})) {
    if (!validCard(card) || card.phase === 'new') continue
    const offset = card.due <= start ? 0 : Math.ceil((card.due - start) / 86_400_000)
    if (offset >= 0 && offset < days) out[offset]++
  }
  return out
}

// ---------- Cartões de pergunta/resposta (bloco de alternância) ----------

type AnyBlock = { id?: unknown; type?: unknown; content?: unknown; children?: unknown }
type AnyInline = { type?: string; text?: string; content?: unknown }

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  let out = ''
  for (const raw of content as AnyInline[]) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.text === 'string') out += raw.text
    else if (Array.isArray(raw.content)) out += inlineText(raw.content)
  }
  return out
}

/** Texto simples dos blocos (um parágrafo por linha; filhos recuados). */
export function blocksPlainText(blocks: unknown, depth = 0): string {
  if (!Array.isArray(blocks) || depth > 12) return ''
  const lines: string[] = []
  for (const raw of blocks as AnyBlock[]) {
    if (!raw || typeof raw !== 'object') continue
    const text = inlineText(raw.content).replace(/\s+/g, ' ').trim()
    const prefix = '  '.repeat(depth)
    if (text) lines.push(prefix + text)
    const child = blocksPlainText(raw.children, depth + 1)
    if (child) lines.push(child)
  }
  return lines.join('\n')
}

export interface ToggleCard { blockId: string; front: string; back: string }

/** Blocos de alternância com título e pelo menos um filho: pergunta = título, resposta = filhos. */
export function extractToggleCards(blocks: unknown): ToggleCard[] {
  const out: ToggleCard[] = []
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 40) return
    for (const raw of list as AnyBlock[]) {
      if (!raw || typeof raw !== 'object') continue
      if (raw.type === 'toggleListItem' && typeof raw.id === 'string') {
        const front = inlineText(raw.content).replace(/\s+/g, ' ').trim()
        const back = blocksPlainText(raw.children)
        if (front && back) out.push({ blockId: raw.id, front: front.slice(0, 500), back: back.slice(0, 4000) })
      }
      if (Array.isArray(raw.children)) walk(raw.children, depth + 1)
    }
  }
  walk(blocks, 0)
  return out
}
