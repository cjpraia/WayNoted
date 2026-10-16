// Progresso do dia, fechamento e revisão da semana — parte pura (Goal-Gradient, Zeigarnik, Peak-End).
// Tom: sem culpa. Nada aqui produz cor de alerta nem notificação para "pouco progresso".
import type { TaskItem } from '../tasks/taskCore.ts'

export interface DayProgress { done: number; total: number; fraction: number; complete: boolean }

/** Tarefas com data de hoje (inclusive herdadas da nota diária): concluídas / total. `items` deve incluir as concluídas. */
export function dayProgress(items: readonly TaskItem[], today: string): DayProgress {
  const mine = items.filter(item => item.due === today)
  const done = mine.filter(item => item.done).length
  const total = mine.length
  return { done, total, fraction: total ? done / total : 0, complete: total > 0 && done === total }
}

/** Meta diária de palavras só aparece se configurada (>0). */
export function wordGoal(words: number, goal: number | undefined): { words: number; goal: number; fraction: number; reached: boolean } | null {
  if (!goal || goal <= 0) return null
  return { words, goal, fraction: Math.min(1, words / goal), reached: words >= goal }
}

export function daySummary(tasks: number, words: number, tr: (pt: string, en: string, vars?: Record<string, string | number>) => string, format: (n: number) => string = String): string {
  const parts = [tasks === 1 ? tr('1 tarefa', '1 task') : tr('{n} tarefas', '{n} tasks', { n: format(tasks) })]
  if (words > 0) parts.push(tr('{n} palavras', '{n} words', { n: format(words) }))
  return tr('Hoje: {parts}', 'Today: {parts}', { parts: parts.join(', ') })
}

const parse = (iso: string) => new Date(`${iso}T12:00:00Z`)
const fmt = (date: Date) => date.toISOString().slice(0, 10)
export const shiftDay = (iso: string, days: number) => { const d = parse(iso); d.setUTCDate(d.getUTCDate() + days); return fmt(d) }
export const weekdayOfISO = (iso: string) => parse(iso).getUTCDay()
/** Segunda-feira desta semana (semana ISO). */
export const mondayOf = (iso: string) => shiftDay(iso, -((weekdayOfISO(iso) + 6) % 7))
/** Segunda-feira da próxima semana. */
export const nextMonday = (iso: string) => shiftDay(mondayOf(iso), 7)
export const tomorrowOf = (iso: string) => shiftDay(iso, 1)

/** Revisão da semana: opcional, sexta (5) ou domingo (0), uma vez por semana. */
export function weekReviewDue(today: string, reviewedWeek: string | undefined): boolean {
  const day = weekdayOfISO(today)
  return (day === 5 || day === 0) && reviewedWeek !== mondayOf(today)
}

/** Texto de tarefa de prioridade: limpa, sem vazio, no máximo 3. */
export function cleanPriorities(values: readonly string[]): string[] {
  return values.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3)
}

/** Final da importação: "N páginas, N bancos, N avisos" (sem alarme: avisos são só informação). */
export function importSummary(pages: number, databases: number, warnings: number, tr: (pt: string, en: string, vars?: Record<string, string | number>) => string, format: (n: number) => string = String): string {
  return tr('{pages} páginas, {databases} bancos, {warnings} avisos', '{pages} pages, {databases} databases, {warnings} warnings', { pages: format(pages), databases: format(databases), warnings: format(warnings) })
}
