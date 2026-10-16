import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Tarefa → evento do Calendário do macOS (E2) — parte pura: horário do evento, link de volta e plano de sincronização.
// O evento é um bloco de tempo para a tarefa: não substitui o prazo dela. Mudanças que apagariam ou moveriam o evento
// nunca são aplicadas sozinhas: o plano devolve a pergunta e quem chama confirma com o usuário.
import { zonedDateTimeToEpoch } from '../components/database/timeZones.ts'
import type { SystemCalendarEventInput, TaskEventLink } from '../types.ts'
import type { TaskItem } from './taskCore.ts'

export const DEFAULT_TASK_MINUTES = 30
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const
export const DAY_HOURS = { first: 6, last: 22 }

export interface Slot { day: string; time: string; minutes: number }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function validSlot(slot: Slot): boolean {
  return DAY.test(slot.day) && TIME.test(slot.time) && Number.isInteger(slot.minutes) && slot.minutes >= 5 && slot.minutes <= 24 * 60
}

/** Início e fim ISO do bloco no fuso dado (horário de parede do usuário). null = horário inexistente (salto do horário de verão). */
export function slotRange(slot: Slot, timeZone: string): { start: string; end: string } | null {
  if (!validSlot(slot)) return null
  const start = zonedDateTimeToEpoch(slot.day, slot.time, timeZone)
  if (start === null) return null
  return { start: new Date(start).toISOString(), end: new Date(start + slot.minutes * 60_000).toISOString() }
}

/** Link `workspace://` de volta para a tarefa (página e, em checklist, o bloco). */
export function taskUrl(item: Pick<TaskItem, 'pageId' | 'blockId'>): string {
  return `workspace://page/${item.pageId}${item.blockId ? `#block=${item.blockId}` : ''}`
}

export function eventInputFor(item: Pick<TaskItem, 'title' | 'pageId' | 'blockId' | 'sourceTitle'>, slot: Slot, timeZone: string, locale: string): SystemCalendarEventInput | null {
  const range = slotRange(slot, timeZone)
  if (!range) return null
  const en = locale.startsWith('en')
  const untitled = en ? 'Untitled task' : 'Tarefa sem título'
  return {
    title: (item.title.trim() || untitled).slice(0, 500), ...range, allDay: false, timeZone,
    notes: `${en ? `Task from ${PRODUCT.name}` : `Tarefa do ${PRODUCT.name}`}${item.sourceTitle ? ` · ${item.sourceTitle}` : ''}`.slice(0, 5000),
    url: taskUrl(item),
  }
}

/** Sugestão de horário: o da própria tarefa, ou 09:00. */
export const suggestedSlot = (item: Pick<TaskItem, 'due' | 'time'>, today: string, minutes = DEFAULT_TASK_MINUTES): Slot => ({ day: item.due && item.due >= today ? item.due : today, time: item.time ?? '09:00', minutes })

/** Dia e hora locais de um instante ISO (para reabrir o diálogo com o evento atual). */
export function localSlotOf(link: Pick<TaskEventLink, 'start' | 'end'>): Slot | null {
  const start = new Date(link.start), end = new Date(link.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, time: `${pad(start.getHours())}:${pad(start.getMinutes())}`, minutes: Math.max(5, Math.round((end.getTime() - start.getTime()) / 60_000)) }
}

// ---------- Plano de sincronização ----------

export type TaskSyncAction =
  /** Título mudou: atualiza o evento sem perguntar (nada se perde). */
  | { kind: 'rename'; key: string; title: string }
  /** Concluída: pergunta se o evento deve sair do Calendário. */
  | { kind: 'done'; key: string }
  /** Sumiu (página excluída/tarefa removida): pergunta se o evento deve sair. */
  | { kind: 'gone'; key: string }
  /** Prazo/hora mudaram: pergunta se o evento deve acompanhar. */
  | { kind: 'moved'; key: string; due: string; time: string | null }

export interface SyncContext {
  /** O índice de tarefas terminou de ler as páginas (antes disso "não achei" não prova nada). */
  indexReady: boolean
  /** A tarefa não existe mais, olhando as páginas (só chamado com índice pronto). */
  isGone(taskKey: string): boolean
}

export function planTaskEventSync(links: Record<string, TaskEventLink> | undefined, tasks: ReadonlyMap<string, TaskItem>, context: SyncContext): TaskSyncAction[] {
  const out: TaskSyncAction[] = []
  for (const [key, link] of Object.entries(links ?? {})) {
    const task = tasks.get(key)
    if (!task) { if (context.indexReady && context.isGone(key) && !link.keepEvent) out.push({ kind: 'gone', key }); continue }
    if (task.done) { if (!link.keepEvent) out.push({ kind: 'done', key }); continue }
    const title = task.title.trim()
    if (title && title !== link.title) out.push({ kind: 'rename', key, title })
    if (task.due && (task.due !== link.due || (task.time ?? null) !== link.time)) out.push({ kind: 'moved', key, due: task.due, time: task.time ?? null })
  }
  return out
}

/** Novo bloco quando o evento acompanha o prazo: mesma duração, dia e hora da tarefa (sem hora, mantém a hora do evento). */
export function movedSlot(link: Pick<TaskEventLink, 'start' | 'end'>, due: string, time: string | null): Slot | null {
  const current = localSlotOf(link)
  return current ? { day: due, time: time ?? current.time, minutes: current.minutes } : null
}
