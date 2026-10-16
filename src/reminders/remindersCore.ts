import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Lembretes do macOS com ida e volta (C3b) — parte pura: o que espelhar, o que mudou de cada lado e quem vence um conflito.
// Campos sincronizados: título, prazo (data e hora) e conclusão. Cada campo é comparado com o último estado sincronizado
// (`sig` do vínculo): só um lado mudou → a mudança passa para o outro; os dois mudaram para valores diferentes → vence a
// alteração mais recente (página × `modified` do Lembrete) e o conflito vai para o registro. Sem relógio implícito nem rede.
import type { AppleReminder, ReminderLink, RemindersSyncSettings, SyncLogEntry } from '../types.ts'
import type { TaskItem } from '../tasks/taskCore.ts'

export interface TaskState { title: string; done: boolean; due: string | null; time: string | null }
export type Field = 'title' | 'due' | 'done'

export const LOG_LIMIT = 50
export const DEFAULT_LIST_NAME = `${PRODUCT.name}`

export const stateOfTask = (task: Pick<TaskItem, 'title' | 'done' | 'due' | 'time'>): TaskState => ({ title: task.title.trim(), done: !!task.done, due: task.due ?? null, time: task.time ?? null })
export const stateOfReminder = (reminder: AppleReminder): TaskState => ({ title: reminder.title.trim(), done: reminder.completed, due: reminder.due?.date ?? null, time: reminder.due?.time ?? null })
export const sigOf = (state: TaskState): string => JSON.stringify([state.title, state.done, state.due, state.time])
export const parseSig = (sig: string): TaskState | null => {
  try {
    const [title, done, due, time] = JSON.parse(sig) as [unknown, unknown, unknown, unknown]
    return typeof title === 'string' && typeof done === 'boolean' && (due === null || typeof due === 'string') && (time === null || typeof time === 'string') ? { title, done, due, time } : null
  } catch { return null }
}

const fieldValue = (state: TaskState, field: Field): string => field === 'title' ? state.title : field === 'done' ? String(state.done) : `${state.due ?? ''} ${state.due ? state.time ?? '' : ''}`.trim()
const assign = (target: TaskState, source: TaskState, field: Field) => {
  if (field === 'title') target.title = source.title
  else if (field === 'done') target.done = source.done
  else { target.due = source.due; target.time = source.due ? source.time : null }
}

export type Op =
  | { kind: 'create'; key: string; state: TaskState }
  | { kind: 'sync'; key: string; reminderId: string; final: TaskState; pushFields: Field[]; pullFields: Field[]; conflicts: { field: Field; local: string; remote: string; winner: 'local' | 'remote' }[] }
  | { kind: 'unlink'; key: string; reminderId: string; reason: 'remote-deleted' | 'task-gone' | 'not-mirrored' }

export interface PlanInput {
  settings: RemindersSyncSettings
  tasks: ReadonlyMap<string, TaskItem>
  remote: ReadonlyMap<string, AppleReminder>
  /** Última alteração local da tarefa (ms): `updatedAt` da página dela. */
  localModified(taskKey: string): number
  today: string
  /** O índice de tarefas terminou de ler: antes disso "não achei a tarefa" não prova nada. */
  indexReady: boolean
  isGone(taskKey: string): boolean
}

/** Chaves que devem estar espelhadas: as escolhidas e, com a opção, as de hoje e atrasadas ainda abertas. */
export function mirroredKeys(settings: RemindersSyncSettings, tasks: ReadonlyMap<string, TaskItem>, today: string): Set<string> {
  const keys = new Set(Object.keys(settings.chosen ?? {}))
  if (settings.autoToday) for (const [key, task] of tasks) if (!task.done && task.due && task.due <= today && !settings.dismissed?.[key]) keys.add(key)
  return keys
}

export function planRemindersSync(input: PlanInput): Op[] {
  const { settings, tasks, remote, today } = input
  const links = settings.links ?? {}
  const wanted = mirroredKeys(settings, tasks, today)
  const ops: Op[] = []
  const seen = new Set<string>()
  for (const [key, link] of Object.entries(links)) {
    seen.add(key)
    const task = tasks.get(key)
    const reminder = remote.get(link.reminderId)
    if (!reminder) { ops.push({ kind: 'unlink', key, reminderId: link.reminderId, reason: 'remote-deleted' }); continue }
    if (!task) { if (input.indexReady && input.isGone(key)) ops.push({ kind: 'unlink', key, reminderId: link.reminderId, reason: 'task-gone' }); continue }
    if (!wanted.has(key)) { ops.push({ kind: 'unlink', key, reminderId: link.reminderId, reason: 'not-mirrored' }); continue }
    const base = parseSig(link.sig)
    const local = stateOfTask(task), far = stateOfReminder(reminder)
    if (!base) { ops.push({ kind: 'sync', key, reminderId: link.reminderId, final: local, pushFields: ['title', 'due', 'done'], pullFields: [], conflicts: [] }); continue }
    const final: TaskState = { ...base }
    const pushFields: Field[] = [], pullFields: Field[] = []
    const conflicts: { field: Field; local: string; remote: string; winner: 'local' | 'remote' }[] = []
    for (const field of ['title', 'due', 'done'] as Field[]) {
      const b = fieldValue(base, field), l = fieldValue(local, field), r = fieldValue(far, field)
      const localChanged = l !== b, remoteChanged = r !== b
      if (!localChanged && !remoteChanged) continue
      if (localChanged && remoteChanged && l === r) { assign(final, local, field); continue }
      let winner: 'local' | 'remote'
      if (localChanged && remoteChanged) {
        winner = input.localModified(key) >= (Date.parse(reminder.modified) || 0) ? 'local' : 'remote'
        conflicts.push({ field, local: l, remote: r, winner })
      } else winner = localChanged ? 'local' : 'remote'
      if (winner === 'local') { assign(final, local, field); pushFields.push(field) }
      else { assign(final, far, field); pullFields.push(field) }
    }
    if (pushFields.length || pullFields.length || sigOf(final) !== link.sig || conflicts.length) ops.push({ kind: 'sync', key, reminderId: link.reminderId, final, pushFields, pullFields, conflicts })
  }
  for (const key of wanted) {
    if (seen.has(key)) continue
    const task = tasks.get(key)
    if (!task || task.done) continue
    ops.push({ kind: 'create', key, state: stateOfTask(task) })
  }
  return ops
}

export function newLink(key: string, reminderId: string, state: TaskState, localAt: number, remoteAt: number): ReminderLink {
  return { taskKey: key, reminderId, sig: sigOf(state), localAt, remoteAt }
}

export function pushLog(log: readonly SyncLogEntry[] | undefined, entries: readonly SyncLogEntry[]): SyncLogEntry[] {
  return [...entries, ...(log ?? [])].slice(0, LOG_LIMIT)
}

export const reminderDue = (state: TaskState): { date: string; time?: string } | null => state.due ? { date: state.due, ...(state.time ? { time: state.time } : {}) } : null
