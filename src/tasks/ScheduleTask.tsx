import PRODUCT from '../../shared/product.json' with { type: 'json' }
// "Agendar…" uma tarefa no Calendário do macOS (E2): diálogo com dia, hora, duração e calendário, o botão da linha
// da tarefa e o aviso de confirmação quando a tarefa muda depois de agendada. Nada é apagado ou movido sem perguntar.
import { useEffect, useRef, useState } from 'react'
import { CalendarCheck, CalendarPlus } from 'lucide-react'
import { useStore } from '../store'
import { useI18n } from '../i18n'
import { useModalFocus } from '../a11y/useModalFocus'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { showToast, showUndoToast } from '../components/ui/toastQueue'
import { hasNativeCalendar, openCalendarSettings, useCalendarAccess, useCalendarSettings } from '../components/calendar/calendarState'
import { calendarErrorMessage } from '../components/calendar/eventMapping'
import { permissionLabel } from '../components/calendar/CalendarAccessPanel'
import { localDay } from '../daily/dailyCore'
import { currentTasks, startTaskIndex, taskIndexStatus, useTaskIndexVersion } from './taskIndex'
import type { TaskItem } from './taskCore'
import { DURATION_OPTIONS, localSlotOf, suggestedSlot, type Slot, type TaskSyncAction } from './taskCalendarCore'
import { applySyncAction, canScheduleTasks, currentSyncPlan, scheduleTask, taskDuration, taskLink, unscheduleTask } from './taskCalendarActions'
import './taskCalendar.css'

// ---------- Abrir o diálogo de qualquer lugar ----------

interface Request { item: TaskItem; slot?: Slot }
const openers = new Set<(request: Request) => void>()
export function openScheduleTask(item: TaskItem, slot?: Slot) { for (const open of openers) open({ item, slot }) }

/** Cria o evento direto (arrastar e soltar) e oferece desfazer. Erros viram aviso. */
export async function scheduleDropped(item: TaskItem, slot: Slot, t: (pt: string, en: string, vars?: Record<string, string | number>) => string): Promise<void> {
  try {
    const hadLink = !!taskLink(item.key)
    await scheduleTask(item, slot)
    showUndoToast(t('Agendada: {title} às {time}', 'Scheduled: {title} at {time}', { title: item.title || t('Sem título', 'Untitled'), time: slot.time }), () => { if (!hadLink) void unscheduleTask(item.key, true).catch(() => {}) }, t('Desfazer', 'Undo'))
  } catch (cause) { showToast({ message: calendarErrorMessage(cause, t) }) }
}

// ---------- Botão na linha da tarefa ----------

export function TaskScheduleButton({ item }: { item: TaskItem }) {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  if (!hasNativeCalendar() || item.done) return null
  const link = settings.taskLinks?.[item.key]
  const label = link ? t('Agendada no Calendário — alterar', 'Scheduled in Calendar — change') : t('Agendar no Calendário…', 'Schedule in Calendar…')
  return <button type="button" className={`tk-sched${link ? ' is-on' : ''}`} aria-label={`${label}: ${item.title || t('Sem título', 'Untitled')}`} title={label} onClick={() => openScheduleTask(item)}>
    {link ? <CalendarCheck size={14} aria-hidden /> : <CalendarPlus size={14} aria-hidden />}
  </button>
}

// ---------- Diálogo ----------

export function ScheduleTaskHost() {
  const [request, setRequest] = useState<Request | null>(null)
  useEffect(() => { const open = (next: Request) => setRequest(next); openers.add(open); return () => { openers.delete(open) } }, [])
  return request ? <ScheduleTaskDialog key={request.item.key} request={request} onClose={() => setRequest(null)} /> : null
}

function ScheduleTaskDialog({ request, onClose }: { request: Request; onClose(): void }) {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  const { status, calendars, defaultCalendarId } = useCalendarAccess(true)
  const { item } = request
  const link = settings.taskLinks?.[item.key]
  const today = localDay()
  const initial = request.slot ?? (link && localSlotOf(link)) ?? suggestedSlot(item, today, taskDuration())
  const [day, setDay] = useState(initial.day)
  const [time, setTime] = useState(initial.time)
  const [minutes, setMinutes] = useState(initial.minutes)
  const [calendarId, setCalendarId] = useState(settings.defaultCalendarId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useModalFocus(root)
  const authorization = status?.authorization
  const canWrite = authorization === 'fullAccess' || authorization === 'writeOnly'
  const writable = calendars.filter(calendar => calendar.allowsModify)
  const run = async (task: () => Promise<unknown>, done?: string) => {
    setBusy(true); setError('')
    try { await task(); if (done) showToast({ message: done }); onClose() } catch (cause) { setError(calendarErrorMessage(cause, t)) } finally { setBusy(false) }
  }
  const options = [...new Set<number>([...DURATION_OPTIONS, minutes])].sort((a, b) => a - b)
  return <div className="tc-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={root} className="tc-dialog" role="dialog" aria-modal="true" aria-label={t('Agendar no Calendário', 'Schedule in Calendar')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <h3>{t('Agendar no Calendário', 'Schedule in Calendar')}</h3>
      <p className="tc-task">{item.title || t('Sem título', 'Untitled')}</p>
      {status && !canWrite && <div className="tc-warning" role="status">
        <span>{authorization === 'unavailable' ? calendarErrorMessage(new Error('NATIVE_UNSUPPORTED'), t) : `${t('Permissão do macOS', 'macOS permission')}: ${permissionLabel(authorization, t)}. ${t('Conceda o acesso em Configurações → Calendário.', 'Grant access in Settings → Calendar.')}`}</span>
        {authorization !== 'unavailable' && <Button onClick={() => { onClose(); openCalendarSettings() }}>{t('Abrir Configurações', 'Open Settings')}</Button>}
      </div>}
      <div className="tc-fields">
        <label>{t('Dia', 'Day')}<input type="date" className="tc-input" value={day} onChange={event => setDay(event.target.value)} /></label>
        <label>{t('Hora', 'Time')}<input type="time" className="tc-input" value={time} onChange={event => setTime(event.target.value)} /></label>
        <label>{t('Duração', 'Duration')}<Select value={String(minutes)} onChange={event => setMinutes(Number(event.target.value))}>
          {options.map(value => <option key={value} value={value}>{value < 60 ? `${value} min` : `${value / 60} h${value % 60 ? ` ${value % 60} min` : ''}`}</option>)}
        </Select></label>
        {authorization === 'fullAccess' && writable.length > 0 && !link && <label>{t('Calendário', 'Calendar')}<Select value={calendarId} onChange={event => setCalendarId(event.target.value)}>
          <option value="">{t('Padrão', 'Default')}{defaultCalendarId ? ` (${calendars.find(calendar => calendar.id === defaultCalendarId)?.title ?? ''})` : ''}</option>
          {writable.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.title}</option>)}
        </Select></label>}
      </div>
      <p className="tc-hint">{t(`O evento leva um link de volta para esta tarefa. Se você concluir ou mover a tarefa, o ${PRODUCT.name} pergunta o que fazer com o evento.`, `The event carries a link back to this task. If you complete or move the task, ${PRODUCT.name} asks what to do with the event.`)}</p>
      {error && <p className="tc-error" role="alert">{error}</p>}
      <div className="np-dialog-actions">
        {link && <Button variant="danger-quiet" disabled={busy} onClick={() => void run(() => unscheduleTask(item.key, true), t('Evento removido do Calendário.', 'Event removed from Calendar.'))}>{t('Remover do Calendário', 'Remove from Calendar')}</Button>}
        <Button onClick={onClose} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || !day || !time || (!!status && !canWrite)} onClick={() => void run(() => scheduleTask(item, { day, time, minutes }, { calendarId: calendarId || undefined }), link ? t('Evento atualizado.', 'Event updated.') : t('Evento criado no Calendário.', 'Event created in Calendar.'))}>{link ? t('Atualizar evento', 'Update event') : t('Agendar', 'Schedule')}</Button>
      </div>
    </div>
  </div>
}

// ---------- Sincronização com confirmação ----------

const asked = new Set<string>()

/** Montado uma vez: renomeia eventos sozinho e pergunta antes de remover ou mover. */
export function TaskEventSyncHost() {
  const state = useStore()
  useTaskIndexVersion()
  const links = state.settings.calendarIntegration?.taskLinks
  const [prompt, setPrompt] = useState<TaskSyncAction | null>(null)
  useEffect(() => { if (links && Object.keys(links).length) startTaskIndex() }, [links])
  useEffect(() => {
    if (!state.ready || !links || !Object.keys(links).length || !canScheduleTasks() || prompt) return
    const timer = window.setTimeout(async () => {
      if (taskIndexStatus().pending > 0) return
      const plan = currentSyncPlan()
      for (const action of plan) if (action.kind === 'rename') await applySyncAction(action, true).catch(() => {})
      const next = plan.find(action => action.kind !== 'rename' && !asked.has(`${action.kind}:${action.key}`))
      if (next) setPrompt(next)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [state.ready, state.pages, links, prompt])
  if (!prompt) return null
  return <SyncPromptDialog prompt={prompt} onDone={() => setPrompt(null)} />
}

function SyncPromptDialog({ prompt, onDone }: { prompt: TaskSyncAction; onDone(): void }) {
  const { t } = useI18n()
  const state = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useModalFocus(root)
  const link = state.settings.calendarIntegration?.taskLinks?.[prompt.key]
  const task = currentTasks(true).find(item => item.key === prompt.key)
  const name = link?.title || task?.title || t('Sem título', 'Untitled')
  const answer = async (confirmed: boolean) => {
    setBusy(true); setError('')
    try { await applySyncAction(prompt, confirmed); onDone() } catch (cause) { setError(calendarErrorMessage(cause, t)) } finally { setBusy(false) }
  }
  const later = () => { asked.add(`${prompt.kind}:${prompt.key}`); onDone() }
  const text = prompt.kind === 'done' ? t('A tarefa “{title}” foi concluída. Remover o evento do Calendário?', 'The task “{title}” was completed. Remove the event from Calendar?', { title: name })
    : prompt.kind === 'gone' ? t('A tarefa “{title}” não existe mais. Remover o evento do Calendário?', 'The task “{title}” no longer exists. Remove the event from Calendar?', { title: name })
    : t('O prazo da tarefa “{title}” mudou para {date}. Mover o evento junto?', 'The due date of “{title}” changed to {date}. Move the event too?', { title: name, date: prompt.kind === 'moved' ? `${prompt.due}${prompt.time ? ` ${prompt.time}` : ''}` : '' })
  return <div className="tc-overlay">
    <div ref={root} className="tc-dialog tc-dialog--small" role="alertdialog" aria-modal="true" aria-label={t('Evento no Calendário', 'Calendar event')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); later() } }}>
      <h3>{t('Evento no Calendário', 'Calendar event')}</h3>
      <p>{text}</p>
      {error && <p className="tc-error" role="alert">{error}</p>}
      <div className="np-dialog-actions">
        <Button onClick={later} disabled={busy}>{t('Perguntar depois', 'Ask later')}</Button>
        <Button disabled={busy} onClick={() => void answer(false)}>{prompt.kind === 'moved' ? t('Manter onde está', 'Keep where it is') : t('Manter o evento', 'Keep the event')}</Button>
        <Button variant={prompt.kind === 'moved' ? 'primary' : 'danger'} disabled={busy} onClick={() => void answer(true)}>{prompt.kind === 'moved' ? t('Mover evento', 'Move event') : t('Remover evento', 'Remove event')}</Button>
      </div>
    </div>
  </div>
}
