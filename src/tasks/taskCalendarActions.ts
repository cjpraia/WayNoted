// Tarefa → evento do Calendário do macOS (E2) — ligação com o store e com o helper nativo (EventKit).
// Respeita a permissão existente: criar exige ao menos "somente adicionar"; atualizar/remover exigem acesso total.
import { getState } from '../store.ts'
import { translate } from '../localization.ts'
import { calendarSettings, bumpCalendarRevision, nativeCalendar, updateCalendarSettings } from '../components/calendar/calendarCore.ts'
import type { SystemCalendarEvent, TaskEventLink } from '../types.ts'
import { currentTasks, taskIndexStatus } from './taskIndex.ts'
import type { TaskItem } from './taskCore.ts'
import { DEFAULT_TASK_MINUTES, eventInputFor, localSlotOf, movedSlot, planTaskEventSync, slotRange, suggestedSlot, type Slot, type TaskSyncAction } from './taskCalendarCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const NATIVE = 'NATIVE_UNSUPPORTED'

export const taskLinks = (): Record<string, TaskEventLink> => calendarSettings().taskLinks ?? {}
export const taskLink = (key: string): TaskEventLink | undefined => taskLinks()[key]
export const taskDuration = (): number => { const value = calendarSettings().taskDuration; return typeof value === 'number' && value >= 5 && value <= 600 ? value : DEFAULT_TASK_MINUTES }
export const canScheduleTasks = () => !!nativeCalendar()?.calendarCreateEvent

function setLink(key: string, link: TaskEventLink | null) {
  updateCalendarSettings(current => {
    const taskLinks = { ...current.taskLinks }
    if (link) taskLinks[key] = link; else delete taskLinks[key]
    return { ...current, taskLinks }
  })
}

const taskOf = (key: string): TaskItem | undefined => currentTasks(true).find(item => item.key === key)

/** Cria (ou move, se já existe) o evento da tarefa no horário dado. Devolve o evento do sistema. */
export async function scheduleTask(item: TaskItem, slot: Slot, options: { calendarId?: string; today?: string } = {}): Promise<SystemCalendarEvent> {
  const native = nativeCalendar()
  if (!native?.calendarCreateEvent) throw new Error(NATIVE)
  const input = eventInputFor(item, slot, zone(), getState().settings.locale)
  if (!input) throw new Error(message('Horário inválido para este dia.', 'Invalid time for this day.'))
  const existing = taskLink(item.key)
  const now = Date.now()
  let event: SystemCalendarEvent
  if (existing && native.calendarUpdateEvent) {
    try {
      event = await native.calendarUpdateEvent({ id: existing.eventId, itemId: existing.itemId, ...input, title: input.title })
    } catch (cause) {
      // Evento apagado no Calendário: cria um novo no lugar.
      if (!/EVENT_NOT_FOUND/.test(cause instanceof Error ? cause.message : String(cause))) throw cause
      event = await native.calendarCreateEvent({ ...input, ...(options.calendarId || calendarSettings().defaultCalendarId ? { calendarId: options.calendarId || calendarSettings().defaultCalendarId } : {}) })
    }
  } else {
    const calendarId = options.calendarId || calendarSettings().defaultCalendarId
    event = await native.calendarCreateEvent({ ...input, ...(calendarId ? { calendarId } : {}) })
  }
  setLink(item.key, { taskKey: item.key, eventId: event.id, itemId: event.itemId, calendarId: event.calendarId, title: item.title.trim(), start: input.start, end: input.end, due: item.due, time: item.time ?? null, createdAt: existing?.createdAt ?? now, syncedAt: now })
  bumpCalendarRevision()
  return event
}

/** Tira a ligação e, a pedido, apaga o evento. */
export async function unscheduleTask(key: string, deleteEvent: boolean): Promise<void> {
  const link = taskLink(key)
  if (!link) return
  const native = nativeCalendar()
  if (deleteEvent && native?.calendarDeleteEvent) await native.calendarDeleteEvent({ id: link.eventId, itemId: link.itemId })
  setLink(key, null)
  bumpCalendarRevision()
}

/** Aplica uma ação do plano. `confirmed` vale para done/gone (remover o evento) e moved (mover o evento). */
export async function applySyncAction(action: TaskSyncAction, confirmed: boolean): Promise<void> {
  const link = taskLink(action.key)
  const native = nativeCalendar()
  if (!link) return
  if (action.kind === 'rename') {
    if (!native?.calendarUpdateEvent) return
    try {
      await native.calendarUpdateEvent({ id: link.eventId, itemId: link.itemId, title: action.title })
      setLink(action.key, { ...link, title: action.title, syncedAt: Date.now(), error: undefined })
    } catch (cause) { setLink(action.key, { ...link, title: action.title, error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 300) }) }
    return
  }
  if (action.kind === 'done' || action.kind === 'gone') {
    if (confirmed) await unscheduleTask(action.key, true).catch(async cause => {
      // Evento já apagado no Calendário: só desfaz a ligação.
      if (/EVENT_NOT_FOUND/.test(String(cause))) setLink(action.key, null); else throw cause
    })
    else setLink(action.key, { ...link, keepEvent: true })
    return
  }
  // moved
  if (confirmed) {
    const slot = movedSlot(link, action.due, action.time)
    const range = slot ? slotRange(slot, zone()) : null
    if (!range || !native?.calendarUpdateEvent) return
    const event = await native.calendarUpdateEvent({ id: link.eventId, itemId: link.itemId, ...range })
    setLink(action.key, { ...link, ...range, eventId: event.id || link.eventId, itemId: event.itemId || link.itemId, due: action.due, time: action.time, syncedAt: Date.now(), error: undefined })
    bumpCalendarRevision()
  } else setLink(action.key, { ...link, due: action.due, time: action.time })
}

/** Plano atual a partir do índice de tarefas (concluídas incluídas). */
export function currentSyncPlan(): TaskSyncAction[] {
  const links = taskLinks()
  if (!Object.keys(links).length) return []
  const tasks = new Map(currentTasks(true).map(item => [item.key, item]))
  const { pages } = getState()
  return planTaskEventSync(links, tasks, {
    indexReady: taskIndexStatus().pending === 0 && getState().ready,
    isGone: key => {
      const [kind, pageId] = key.split(':')
      const page = pages[pageId]
      // Linha ou página sumiu/foi para a lixeira. Checklist presente na página mas sem o item: apagado.
      if (!page || page.trashed) return true
      return kind === 'c' ? !page.passwordLock : false
    },
  })
}

export { localSlotOf, suggestedSlot }
