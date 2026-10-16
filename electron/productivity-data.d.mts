export interface ProductivityDay {
  words: number
  edits: number
  sessions: number
  created: number
  tasks: number
  /** Edições por hora local (0–23). */
  hours: number[]
  /** Páginas mais trabalhadas do dia: id → [palavras, edições] (no máximo PAGES_PER_DAY). */
  pages?: Record<string, [number, number]>
  /** Dia reconstruído pelo backfill (estimado). */
  estimated?: boolean
}
export interface ProductivityData {
  v: number
  days: Record<string, ProductivityDay>
  trackingSince?: number
  backfilledAt?: number
  lastEditAt?: number
  clearedAt?: number
}
export interface ProductivityDelta {
  at?: number
  days: Record<string, Partial<ProductivityDay>>
  /** Rajadas de edição [início, fim] (epoch ms) para contar sessões sem duplicar entre janelas. */
  spans?: [number, number][]
}
export const PRODUCTIVITY_VERSION: number
export const SESSION_GAP_MS: number
export const PAGES_PER_DAY: number
export function dayKey(epoch: number): string
export function emptyDay(): ProductivityDay
export function emptyData(): ProductivityData
export function normalizeData(raw: unknown): ProductivityData
export function trimPages(pages: Record<string, [number, number]>): Record<string, [number, number]>
export function applyDelta(current: unknown, delta: ProductivityDelta, keyOf?: (epoch: number) => string): ProductivityData
export function applyBackfill(current: unknown, days: Record<string, Partial<ProductivityDay>>, now?: number): ProductivityData
export function clearedData(now?: number): ProductivityData
