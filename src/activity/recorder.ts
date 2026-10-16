// Contador em memória das ações de edição (O(1) por evento). Gera "deltas" que a camada de
// persistência soma ao arquivo do espaço (electron/productivity-data.mjs). Definições: docs/USAGE.md.
import { dayKey as localDayKey, emptyDay, SESSION_GAP_MS, type ProductivityDay, type ProductivityDelta } from '../../electron/productivity-data.mjs'
import type { DocStats } from './words.ts'

/** Salvamentos da mesma página dentro desta janela contam como uma única edição. */
export const EDIT_WINDOW_MS = 30 * 1000

interface Burst { peakWords: number; peakChecked: number; lastAt: number }

export class ActivityRecorder {
  private days: Record<string, ProductivityDay> = {}
  private spans: [number, number][] = []
  private span: [number, number] | null = null
  private spanDirty = false
  private bursts = new Map<string, Burst>()
  private lastEdit = new Map<string, number>()
  private completed = new Set<string>()
  private readonly now: () => number
  private readonly keyOf: (epoch: number) => string

  constructor(options: { now?: () => number; keyOf?: (epoch: number) => string } = {}) {
    this.now = options.now ?? Date.now
    this.keyOf = options.keyOf ?? localDayKey
  }

  private day(at: number) { const key = this.keyOf(at); return (this.days[key] ??= emptyDay()) }
  private touch(at: number) {
    if (this.span && at - this.span[1] < SESSION_GAP_MS && at >= this.span[0]) this.span[1] = Math.max(this.span[1], at)
    else { if (this.span) this.spans.push(this.span); this.span = [at, at] }
    this.spanDirty = true
  }
  private page(day: ProductivityDay, pageId: string, words: number, edits: number) {
    const pages = (day.pages ??= {})
    const entry = pages[pageId] ?? [0, 0]
    pages[pageId] = [entry[0] + words, entry[1] + edits]
  }
  /** Edição coalescida por página (EDIT_WINDOW_MS); devolve 1 quando conta. */
  private countEdit(pageId: string, at: number): number {
    const last = this.lastEdit.get(pageId)
    if (last !== undefined && at - last < EDIT_WINDOW_MS && at >= last) return 0
    this.lastEdit.set(pageId, at)
    const day = this.day(at)
    day.edits++
    day.hours[new Date(at).getHours()]++
    return 1
  }

  /**
   * Documento salvo pelo editor. Palavras escritas = quanto o texto passou do maior tamanho já visto na
   * rajada atual da página (marca d'água): apagar não desconta, reescrever o que foi apagado não conta de
   * novo e reformatar não muda nada. Uma pausa de 10 min reinicia a marca no tamanho atual.
   * O mesmo vale para tarefas marcadas (marcar/desmarcar repetidas vezes conta uma vez).
   */
  docSaved(pageId: string, before: DocStats, after: DocStats, named: boolean, at = this.now()) {
    let burst = this.bursts.get(pageId)
    if (!burst || at - burst.lastAt >= SESSION_GAP_MS || at < burst.lastAt) burst = { peakWords: before.words, peakChecked: before.checked, lastAt: at }
    const words = Math.max(0, after.words - burst.peakWords), tasks = Math.max(0, after.checked - burst.peakChecked)
    burst.peakWords = Math.max(burst.peakWords, after.words)
    burst.peakChecked = Math.max(burst.peakChecked, after.checked)
    burst.lastAt = at
    this.bursts.set(pageId, burst)
    if (this.bursts.size > 500) for (const [id, value] of this.bursts) if (at - value.lastAt >= SESSION_GAP_MS) this.bursts.delete(id)
    const day = this.day(at)
    day.words += words
    day.tasks += tasks
    const edits = this.countEdit(pageId, at)
    if (named && (words || edits)) this.page(day, pageId, words, edits)
    this.touch(at)
  }

  /** Alteração de título, ícone, capa ou propriedades (linhas de banco). */
  edited(pageId: string, named: boolean, at = this.now()) {
    const edits = this.countEdit(pageId, at)
    if (named && edits) this.page(this.day(at), pageId, 0, edits)
    this.touch(at)
  }

  created(pageId: string, named: boolean, at = this.now()) {
    const day = this.day(at)
    day.created++
    if (named) this.page(day, pageId, 0, 0)
    this.touch(at)
  }

  /** Linha de banco concluída: conta no máximo uma vez por linha e por dia (desmarcar e marcar não infla). */
  taskCompleted(rowId: string, named: boolean, at = this.now()) {
    const key = `${rowId}|${this.keyOf(at)}`
    if (this.completed.has(key)) return
    this.completed.add(key)
    if (this.completed.size > 5000) this.completed.clear()
    const day = this.day(at)
    day.tasks++
    if (named) this.page(day, rowId, 0, 0)
    this.touch(at)
  }

  hasPending() { return this.spanDirty || this.spans.length > 0 || Object.keys(this.days).length > 0 }

  /** Incrementos pendentes sem retirá-los (exibição). */
  peek(): ProductivityDelta | null {
    if (!this.hasPending()) return null
    return { at: this.now(), days: this.days, spans: [...this.spans, ...(this.span ? [[this.span[0], this.span[1]] as [number, number]] : [])] }
  }

  /** Retira os incrementos pendentes (a rajada aberta continua e será reenviada estendida). */
  take(): ProductivityDelta | null {
    if (!this.hasPending()) return null
    const delta: ProductivityDelta = { at: this.now(), days: this.days, spans: [...this.spans, ...(this.span ? [[this.span[0], this.span[1]] as [number, number]] : [])] }
    this.days = {}
    this.spans = []
    this.spanDirty = false
    return delta
  }

  /** Falha ao gravar: devolve o delta para a próxima tentativa (soma aos novos incrementos). */
  restore(delta: ProductivityDelta) {
    for (const [key, value] of Object.entries(delta.days)) {
      const day = (this.days[key] ??= emptyDay())
      for (const field of ['words', 'edits', 'created', 'tasks'] as const) day[field] += value[field] ?? 0
      value.hours?.forEach((count, hour) => { day.hours[hour] += count })
      for (const [id, [words, edits]] of Object.entries(value.pages ?? {})) this.page(day, id, words, edits)
    }
    this.spans.unshift(...(delta.spans ?? []).filter(span => !this.span || span[0] !== this.span[0]))
    this.spanDirty = true
  }

  /** Descarta tudo (registro desligado ou histórico apagado). */
  reset() {
    this.days = {}; this.spans = []; this.span = null; this.spanDirty = false
    this.bursts.clear(); this.lastEdit.clear(); this.completed.clear()
  }
}
