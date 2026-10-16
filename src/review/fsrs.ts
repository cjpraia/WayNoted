// FSRS-lite: agendador de revisão espaçada (estabilidade/dificuldade), 100% local e determinístico.
// Baseado nas fórmulas públicas do FSRS-4.5 (curva de esquecimento R = (1 + F·t/S)^-0,5) com pesos padrão fixos,
// sem otimização por usuário, sem fuzz aleatório e sem relógio implícito: tudo recebe `now`.
// Notas: 1 = De novo, 2 = Difícil, 3 = Bom, 4 = Fácil.

export type Grade = 1 | 2 | 3 | 4
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning'

export interface ReviewCard {
  phase: CardPhase
  /** Estabilidade S: dias até a lembrança cair para a retenção desejada. 0 enquanto o cartão é novo. */
  stability: number
  /** Dificuldade D, 1 (fácil) a 10 (difícil). */
  difficulty: number
  /** Instante (ms) em que volta a ser devido. */
  due: number
  /** Última revisão (ms) ou null. */
  last: number | null
  reps: number
  lapses: number
}

export interface FsrsParams {
  /** Retenção desejada (0,7–0,97). Padrão 0,9. */
  retention: number
  /** Teto do intervalo, em dias (1–36500). Padrão 365. */
  maxInterval: number
}

export const DEFAULT_PARAMS: FsrsParams = { retention: 0.9, maxInterval: 365 }
export const LEARN_STEP_MS = 10 * 60_000
const DAY_MS = 86_400_000

// Pesos padrão do FSRS-4.5.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]
const DECAY = -0.5
const FACTOR = 19 / 81

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function normalizeParams(input?: Partial<FsrsParams> | null): FsrsParams {
  const retention = typeof input?.retention === 'number' && Number.isFinite(input.retention) ? clamp(input.retention, 0.7, 0.97) : DEFAULT_PARAMS.retention
  const maxInterval = typeof input?.maxInterval === 'number' && Number.isFinite(input.maxInterval) ? clamp(Math.round(input.maxInterval), 1, 36500) : DEFAULT_PARAMS.maxInterval
  return { retention, maxInterval }
}

export function newCard(now: number): ReviewCard {
  return { phase: 'new', stability: 0, difficulty: 0, due: now, last: null, reps: 0, lapses: 0 }
}

/** Probabilidade de lembrar depois de `elapsedDays` com estabilidade `stability`. */
export function retrievability(elapsedDays: number, stability: number): number {
  if (!(stability > 0)) return 0
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY)
}

/** Intervalo (dias, fracionário) para a retenção pedida. Com 90 % é igual à estabilidade. */
export function intervalDays(stability: number, retention: number): number {
  return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)
}

const initialStability = (grade: Grade) => W[grade - 1]
const initialDifficulty = (grade: Grade) => clamp(W[4] - (grade - 3) * W[5], 1, 10)

function nextDifficulty(difficulty: number, grade: Grade): number {
  const moved = difficulty - W[6] * (grade - 3)
  return clamp(W[7] * initialDifficulty(3) + (1 - W[7]) * moved, 1, 10)
}

function recallStability(difficulty: number, stability: number, r: number, grade: Grade): number {
  const hard = grade === 2 ? W[15] : 1
  const easy = grade === 4 ? W[16] : 1
  return stability * (1 + Math.exp(W[8]) * (11 - difficulty) * Math.pow(stability, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy)
}

function forgetStability(difficulty: number, stability: number, r: number): number {
  const next = W[11] * Math.pow(difficulty, -W[12]) * (Math.pow(stability + 1, W[13]) - 1) * Math.exp((1 - r) * W[14])
  return clamp(Math.min(next, stability), 0.1, 36500)
}

/** Início do dia local (00:00) `days` dias depois do dia de `now`. Usa o calendário local (horário de verão). */
export function startOfDay(now: number, days = 0): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
}
export const endOfDay = (now: number) => startOfDay(now, 1) - 1

function elapsedDaysOf(card: ReviewCard, now: number): number {
  return card.last === null ? 0 : Math.max(0, (now - card.last) / DAY_MS)
}

function applyGrade(card: ReviewCard, grade: Grade, now: number, params: FsrsParams): ReviewCard {
  const base = { last: now, reps: card.reps + 1 }
  if (card.phase === 'new' || !(card.stability > 0)) {
    const stability = initialStability(grade)
    const difficulty = initialDifficulty(grade)
    return { ...card, ...base, stability, difficulty, phase: grade === 1 ? 'learning' : 'review', due: now, lapses: card.lapses }
  }
  const r = retrievability(elapsedDaysOf(card, now), card.stability)
  if (grade === 1) {
    return { ...card, ...base, difficulty: nextDifficulty(card.difficulty, grade), stability: forgetStability(card.difficulty, card.stability, r), phase: 'relearning', lapses: card.lapses + 1, due: now }
  }
  return { ...card, ...base, difficulty: nextDifficulty(card.difficulty, grade), stability: recallStability(card.difficulty, card.stability, r, grade), phase: 'review', due: now }
}

export interface Scheduled { grade: Grade; card: ReviewCard; /** Intervalo em dias inteiros (0 = nova tentativa em minutos). */ days: number }

/** Resultado das quatro notas para o cartão agora. Intervalos crescem de Difícil a Fácil (mínimo +1 dia entre eles). */
export function scheduleAll(card: ReviewCard, now: number, input?: Partial<FsrsParams> | null): Record<Grade, Scheduled> {
  const params = normalizeParams(input)
  const raw = ([1, 2, 3, 4] as Grade[]).map(grade => applyGrade(card, grade, now, params))
  const cap = (days: number) => clamp(Math.round(days), 1, params.maxInterval)
  let hard = cap(intervalDays(raw[1].stability, params.retention))
  let good = cap(intervalDays(raw[2].stability, params.retention))
  let easy = cap(intervalDays(raw[3].stability, params.retention))
  hard = Math.min(hard, good)
  good = Math.max(good, Math.min(hard + 1, params.maxInterval))
  easy = Math.max(easy, Math.min(good + 1, params.maxInterval))
  const finish = (grade: Grade, days: number): Scheduled => {
    const next = raw[grade - 1]
    if (grade === 1) return { grade, days: 0, card: { ...next, due: now + LEARN_STEP_MS } }
    return { grade, days, card: { ...next, due: startOfDay(now, days) } }
  }
  return { 1: finish(1, 0), 2: finish(2, hard), 3: finish(3, good), 4: finish(4, easy) }
}

export function reviewCard(card: ReviewCard, grade: Grade, now: number, params?: Partial<FsrsParams> | null): ReviewCard {
  return scheduleAll(card, now, params)[grade].card
}

/** O cartão aparece na fila de hoje (novo, ou devido até o fim do dia local). */
export function isDue(card: ReviewCard, now: number): boolean {
  return card.phase === 'new' || card.due <= endOfDay(now)
}

/** "10 min", "1 dia", "4 dias", "2 meses", "1 ano". */
export function intervalLabel(days: number, locale: string): string {
  const en = locale.startsWith('en')
  if (days <= 0) return en ? '10 min' : '10 min'
  if (days < 30) return en ? `${days} ${days === 1 ? 'day' : 'days'}` : `${days} ${days === 1 ? 'dia' : 'dias'}`
  if (days < 365) { const months = Math.round(days / 30); return en ? `${months} ${months === 1 ? 'month' : 'months'}` : `${months} ${months === 1 ? 'mês' : 'meses'}` }
  const years = Math.round((days / 365) * 10) / 10
  return en ? `${years} ${years === 1 ? 'year' : 'years'}` : `${years} ${years === 1 ? 'ano' : 'anos'}`
}

export function validCard(value: unknown): value is ReviewCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  return ['new', 'learning', 'review', 'relearning'].includes(card.phase as string)
    && typeof card.stability === 'number' && typeof card.difficulty === 'number' && typeof card.due === 'number'
    && (card.last === null || typeof card.last === 'number') && typeof card.reps === 'number' && typeof card.lapses === 'number'
}
