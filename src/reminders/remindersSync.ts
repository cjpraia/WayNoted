import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Lembretes do macOS com ida e volta (C3b) — execução: lê a lista "aplicativo", aplica o plano e registra o que fez.
// Opt-in: nada roda (e a permissão do macOS nunca é pedida) antes de o usuário ligar a opção em Configurações.
import { actions, getState } from '../store.ts'
import { translate } from '../localization.ts'
import { completeTask } from '../tasks/taskActions.ts'
import { currentTasks, taskIndexStatus } from '../tasks/taskIndex.ts'
import { taskUrl } from '../tasks/taskCalendarCore.ts'
import { localDay } from '../daily/dailyCore.ts'
import type { AppleReminder, NativeApi, ReminderLink, RemindersSyncSettings, SyncLogEntry } from '../types.ts'
import type { TaskItem } from '../tasks/taskCore.ts'
import { applyDue, applyTitle } from './localApply.ts'
import { DEFAULT_LIST_NAME, newLink, planRemindersSync, pushLog, reminderDue, type Op, type TaskState } from './remindersCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)
const native = (): NativeApi | undefined => (typeof window !== 'undefined' ? window.api : undefined)

export const remindersAvailable = () => !!native()?.remindersStatus
export const DEFAULT_REMINDERS: RemindersSyncSettings = { enabled: false, listName: DEFAULT_LIST_NAME }
export const remindersSettings = (settings = getState().settings): RemindersSyncSettings => ({ ...DEFAULT_REMINDERS, ...settings.remindersSync })
export function updateRemindersSettings(update: Partial<RemindersSyncSettings> | ((current: RemindersSyncSettings) => RemindersSyncSettings)) {
  const current = remindersSettings()
  actions.updateSettings({ remindersSync: typeof update === 'function' ? update(current) : { ...current, ...update } })
}

/** Só em memória: gravar a cada ciclo sujaria o meta sem necessidade. */
let lastRun: { at: number; ops: number; errors: number } | null = null
export const lastRemindersRun = () => lastRun

// ---------- Ligar e escolher tarefas ----------

/** Liga o espelho: pede a permissão do macOS (só aqui), cria/acha a lista e faz a primeira sincronização. */
export async function enableReminders(listName = DEFAULT_LIST_NAME): Promise<{ authorization: string }> {
  const api = native()
  if (!api?.remindersRequestAccess || !api.remindersEnsureList) throw new Error('NATIVE_UNSUPPORTED')
  const status = await api.remindersRequestAccess()
  if (status.authorization !== 'fullAccess') return { authorization: status.authorization }
  const { list } = await api.remindersEnsureList({ title: listName.trim() || DEFAULT_LIST_NAME, id: remindersSettings().listId })
  updateRemindersSettings(current => ({ ...current, enabled: true, listName: list.title, listId: list.id, lastError: undefined }))
  return { authorization: 'fullAccess' }
}

/** Desliga: não apaga lembretes nem a lista; só deixa de sincronizar. */
export function disableReminders() { updateRemindersSettings(current => ({ ...current, enabled: false })) }

export function setTaskMirrored(key: string, on: boolean) {
  updateRemindersSettings(current => {
    const chosen = { ...current.chosen }, dismissed = { ...current.dismissed }
    if (on) { chosen[key] = true; delete dismissed[key] } else { delete chosen[key]; dismissed[key] = true }
    return { ...current, chosen, dismissed }
  })
}
export const isTaskMirrored = (key: string, settings = remindersSettings(), tasks?: ReadonlyMap<string, TaskItem>): boolean => !!settings.links?.[key] || !!settings.chosen?.[key] || (!!settings.autoToday && !settings.dismissed?.[key] && !!tasks?.get(key) && !tasks.get(key)!.done && !!tasks.get(key)!.due && tasks.get(key)!.due! <= localDay())

// ---------- Ciclo ----------

function isGone(key: string): boolean {
  const [kind, pageId] = key.split(':')
  const page = getState().pages[pageId]
  if (!page || page.trashed) return true
  return kind === 'c' ? !page.passwordLock : false
}

const describeState = (state: TaskState) => `${state.title}${state.due ? ` · ${state.due}${state.time ? ` ${state.time}` : ''}` : ''}${state.done ? ` · ${message('concluída', 'done')}` : ''}`
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300)

let running = false

export async function runRemindersSync(now = Date.now()): Promise<{ ops: number; errors: number } | null> {
  const api = native()
  const cfg = remindersSettings()
  if (running || !cfg.enabled || !api?.remindersList || !api.remindersUpsert || !api.remindersComplete || !api.remindersEnsureList || !api.remindersStatus || !getState().ready) return null
  if (taskIndexStatus().pending > 0) return null
  running = true
  const log: SyncLogEntry[] = []
  let links = { ...cfg.links }, chosen = { ...cfg.chosen }, dismissed = { ...cfg.dismissed }, listId = cfg.listId
  let errors = 0
  const note = (entry: Omit<SyncLogEntry, 'at'>) => { log.push({ at: now, ...entry, detail: entry.detail.slice(0, 300) }); if (entry.action === 'error') errors++ }
  try {
    const status = await api.remindersStatus()
    if (status.authorization !== 'fullAccess') { updateRemindersSettings(current => ({ ...current, lastError: `REMINDERS_ACCESS_${status.authorization}` })); return null }
    const ensured = await api.remindersEnsureList({ title: cfg.listName || DEFAULT_LIST_NAME, id: listId })
    listId = ensured.list.id
    const remote = new Map<string, AppleReminder>((await api.remindersList({ listId })).reminders.map(reminder => [reminder.id, reminder]))
    const tasks = new Map(currentTasks(true).map(item => [item.key, item]))
    const today = localDay(now)
    const ops = planRemindersSync({ settings: { ...cfg, links, chosen, dismissed }, tasks, remote, today, indexReady: true, isGone, localModified: key => { const task = tasks.get(key); return task ? getState().pages[task.pageId]?.updatedAt ?? 0 : 0 } })
    for (const op of ops) {
      const task = tasks.get(op.key)
      const title = task?.title || op.key
      try {
        if (op.kind === 'create' && task) {
          const created = await api.remindersUpsert({ listId, title: op.state.title, notes: `${PRODUCT.name}${task.sourceTitle ? ` · ${task.sourceTitle}` : ''}`, url: taskUrl(task), due: reminderDue(op.state), completed: false })
          links[op.key] = newLink(op.key, created.id, op.state, getState().pages[task.pageId]?.updatedAt ?? now, Date.parse(created.modified) || now)
          note({ key: op.key, title, action: 'created', detail: describeState(op.state) })
        } else if (op.kind === 'unlink') {
          delete links[op.key]
          if (op.reason === 'remote-deleted') { delete chosen[op.key]; dismissed[op.key] = true }
          note({ key: op.key, title, action: 'unlinked', detail: op.reason === 'remote-deleted' ? message('Lembrete apagado no app Lembretes.', 'Reminder deleted in Reminders.') : op.reason === 'task-gone' ? message('A tarefa não existe mais; o lembrete foi mantido.', 'The task no longer exists; the reminder was kept.') : message('Fora do espelho; o lembrete foi mantido.', 'No longer mirrored; the reminder was kept.') })
        } else if (op.kind === 'sync' && task) await applySync(op, task, api, links, note, now)
      } catch (cause) {
        note({ key: op.key, title, action: 'error', detail: errorText(cause) })
        // Um erro ao aplicar não pode repetir para sempre: segue com o vínculo e tenta de novo no próximo ciclo.
      }
    }
    const changed = ops.length > 0 || listId !== cfg.listId || cfg.lastError
    if (changed) updateRemindersSettings(current => ({ ...current, listId, links, chosen, dismissed, log: pushLog(current.log, log.reverse()), lastSyncAt: now, lastError: errors ? log.find(entry => entry.action === 'error')?.detail : undefined }))
    lastRun = { at: now, ops: ops.length, errors }
    return { ops: ops.length, errors }
  } catch (cause) {
    updateRemindersSettings(current => ({ ...current, lastError: errorText(cause), log: pushLog(current.log, [{ at: now, key: '', title: '', action: 'error', detail: errorText(cause) }]) }))
    lastRun = { at: now, ops: 0, errors: 1 }
    return { ops: 0, errors: 1 }
  } finally { running = false }
}

async function applySync(op: Extract<Op, { kind: 'sync' }>, task: TaskItem, api: NativeApi, links: Record<string, ReminderLink>, note: (entry: Omit<SyncLogEntry, 'at'>) => void, now: number) {
  const title = task.title || op.key
  let final = op.final
  for (const conflict of op.conflicts) note({ key: op.key, title, action: 'conflict', detail: message(`{field}: ${PRODUCT.name} “{local}” × Lembretes “{remote}” → vence {winner} (alteração mais recente).`, `{field}: ${PRODUCT.name} “{local}” vs Reminders “{remote}” → {winner} wins (most recent change).`).replace('{field}', conflict.field === 'title' ? message('título', 'title') : conflict.field === 'due' ? message('prazo', 'due date') : message('conclusão', 'completion')).replace('{local}', conflict.local).replace('{remote}', conflict.remote).replace('{winner}', conflict.winner === 'local' ? `${PRODUCT.name}` : message('Lembretes', 'Reminders')) })
  let remote: AppleReminder | null = null
  // Lembretes → aplicativo.
  let advanced = false
  if (op.pullFields.includes('title')) { await applyTitle(task, final.title); note({ key: op.key, title, action: 'pulled', detail: `${message('título', 'title')}: ${final.title}` }) }
  if (op.pullFields.includes('due')) { await applyDue(task, final.due, final.time); note({ key: op.key, title, action: 'pulled', detail: `${message('prazo', 'due date')}: ${final.due ?? ''}${final.time ? ` ${final.time}` : ''}` }) }
  if (op.pullFields.includes('done')) {
    const result = await completeTask(task, final.done)
    advanced = result === 'advanced'
    note({ key: op.key, title, action: 'pulled', detail: advanced ? message('concluída (tarefa recorrente: próxima ocorrência)', 'completed (recurring task: next occurrence)') : final.done ? message('concluída', 'completed') : message('reaberta', 'reopened') })
    // Tarefa recorrente avançou em vez de concluir: o Lembrete volta a "aberto" (o novo prazo vai no próximo ciclo).
    if (advanced) final = { ...final, done: false }
  }
  // aplicativo → Lembretes.
  const push: Parameters<NonNullable<NativeApi['remindersUpsert']>>[0] = { id: op.reminderId }
  if (op.pushFields.includes('title')) push.title = final.title
  if (op.pushFields.includes('due')) push.due = reminderDue(final)
  if (op.pushFields.includes('done') || advanced) push.completed = final.done
  if (Object.keys(push).length > 1) {
    remote = await api.remindersUpsert!(push)
    note({ key: op.key, title, action: 'pushed', detail: op.pushFields.map(field => field === 'title' ? message('título', 'title') : field === 'due' ? message('prazo', 'due date') : message('conclusão', 'completion')).join(', ') || message('conclusão', 'completion') })
  }
  links[op.key] = newLink(op.key, op.reminderId, final, getState().pages[task.pageId]?.updatedAt ?? now, Date.parse(remote?.modified ?? '') || now)
}
