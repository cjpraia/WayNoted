// Painel de calendário à direita (opcional, desligado por padrão): mini calendário mensal próprio com
// pontos (nota diária / tarefas / eventos), navegação mês/ano e "Hoje"; o dia escolhido mostra a nota
// diária, tarefas, eventos do Calendário do macOS (só se o acesso já estiver autorizado) e páginas criadas.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CalendarDays, CheckSquare, Plus, Square, X } from 'lucide-react'
import { actions, getState, useStore } from '../store'
import { t, useI18n } from '../i18n'
import { hasNativeCalendar, useCalendarAccess, useCalendarSettings, useSystemEvents } from '../components/calendar/calendarState'
import { eventsForDay, eventTimeLabel, rangeForDays, systemEventDays } from '../components/calendar/eventMapping'
import { PageIcon } from '../components/page/PageIcon'
import { addDays, formatLongDate, formatShortDate, formatWeekday, isoWeek, localDay, monthGrid, weekDays, weekStartFor, type DailyLocale } from './dailyCore'
import { MiniMonth, type DayMarks } from './MiniMonth'
import { dailyDateOf, dailyNotesIndex, dailySettings, openDailyNote, pagesCreatedOn, updateDailySettings } from './dailyNotes'
import { currentTasks, useTaskIndexVersion } from '../tasks/taskIndex'
import { tasksOnDay, type TaskItem } from '../tasks/taskCore'
import { completeTask, openTaskSource } from '../tasks/taskActions'
import type { SystemCalendarEvent } from '../types'
import './daily.css'
import '../tasks/taskCalendar.css'
import { shortcutHint } from '../shortcuts'
import { TaskScheduleButton, scheduleDropped } from '../tasks/ScheduleTask'
import { draggedTaskKey, hasTaskDrag, taskDragProps, useTaskDrag } from '../tasks/taskDrag'
import { DAY_HOURS, suggestedSlot } from '../tasks/taskCalendarCore'
import { canScheduleTasks, taskDuration } from '../tasks/taskCalendarActions'

export const PANEL_MIN = 260, PANEL_MAX = 560, PANEL_DEFAULT = 320

/** Mostra/oculta o painel (botão da barra superior, ⌘⇧C e Configurações). */
export function toggleCalendarPanel(open?: boolean) {
  updateDailySettings({ panelOpen: open ?? !dailySettings().panelOpen })
}

/** Dia local atual; atualiza na virada do dia. */
export function useToday(): string {
  const [today, setToday] = useState(() => localDay())
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDay()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return today
}

const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]

export type { DayMarks } from './MiniMonth'

function TaskRow({ item, onError }: { item: TaskItem; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const done = !!item.done
  const { locale } = useI18n()
  return <li className={`dl-task${done ? ' is-done' : ''}`} {...taskDragProps(item)}>
    <button type="button" className="dl-check" disabled={busy} aria-label={done ? t('Reabrir tarefa', 'Reopen task') : t('Concluir tarefa', 'Complete task')} onClick={() => { setBusy(true); void completeTask(item, !done).catch(error => onError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false)) }}>
      {done ? <CheckSquare size={16} /> : <Square size={16} />}
    </button>
    <button type="button" className="dl-task-main" onClick={event => openTaskSource(item, event.metaKey || event.ctrlKey)} title={item.sourceTitle}>
      <span className="dl-task-title">{item.title || t('Sem título', 'Untitled')}</span>
      <span className="dl-task-meta" title={item.inherited ? t('Data herdada da nota diária', 'Date inherited from the daily note') : undefined}>{[item.time, item.repeat ? '↻' : '', item.inherited && item.due ? t('Nota de {day}', 'Note from {day}', { day: formatShortDate(item.due, locale as DailyLocale) }) : item.sourceTitle].filter(Boolean).join(' · ')}</span>
    </button>
    <TaskScheduleButton item={item} />
  </li>
}

/** Faixa de horas que aparece durante o arrasto de uma tarefa: soltar numa hora cria o evento no Calendário do macOS. */
function ScheduleDropZone({ day }: { day: string }) {
  const dragging = useTaskDrag()
  const [over, setOver] = useState<number | null>(null)
  const { locale } = useI18n()
  if (!dragging || !canScheduleTasks()) return null
  const hours = Array.from({ length: DAY_HOURS.last - DAY_HOURS.first + 1 }, (_, i) => DAY_HOURS.first + i)
  const drop = (event: React.DragEvent, hour: number) => {
    event.preventDefault(); setOver(null)
    const key = draggedTaskKey(event)
    const item = key ? currentTasks(true).find(task => task.key === key) : undefined
    if (item) void scheduleDropped(item, { day, time: `${String(hour).padStart(2, '0')}:00`, minutes: taskDuration() }, t)
  }
  return <div className="tc-drop" role="group" aria-label={t('Soltar para agendar', 'Drop to schedule')}>
    <p className="tc-drop-title">{t('Solte numa hora para agendar em {day}', 'Drop on an hour to schedule on {day}', { day: formatShortDate(day, locale as DailyLocale) })}</p>
    <div className="tc-hours">{hours.map(hour => <div key={hour} className={`tc-hour${over === hour ? ' is-over' : ''}`} onDragOver={event => { if (hasTaskDrag(event)) { event.preventDefault(); setOver(hour) } }} onDragLeave={() => setOver(null)} onDrop={event => drop(event, hour)}>{String(hour).padStart(2, '0')}:00</div>)}</div>
  </div>
}

function EventRow({ event, day, locale }: { event: SystemCalendarEvent; day: string; locale: string }) {
  return <li className="dl-event" style={{ ['--dl-event-color' as string]: event.color }}>
    <i className="dl-event-bar" aria-hidden />
    <span className="dl-event-time">{eventTimeLabel(event, locale, day)}</span>
    <span className="dl-event-title">{event.title || t('(Sem título)', '(No title)')}</span>
  </li>
}

function DayDetails({ day, today, locale, tasks, events, eventsReady }: { day: string; today: string; locale: DailyLocale; tasks: TaskItem[]; events: SystemCalendarEvent[]; eventsReady: boolean }) {
  const note = dailyNotesIndex().get(day)
  const created = pagesCreatedOn(day, 30)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  useEffect(() => setError(''), [day])
  const weekday = formatWeekday(day, locale)
  const dayTasks = tasksOnDay(tasks, day)
  const dayEvents = eventsForDay(events, day)
  return <div className="dl-details">
    <div className="dl-day-head">
      <span className="dl-weekday">{weekday.charAt(0).toUpperCase() + weekday.slice(1)}</span>
      {day === today && <span className="dl-today-badge">{t('Hoje', 'Today')}</span>}
      <h3 className="dl-date">{formatLongDate(day, locale)}</h3>
      <span className="dl-week">{t('Semana {n}', 'Week {n}', { n: isoWeek(day) })}</span>
    </div>
    {error && <div className="dl-error" role="alert">{error}</div>}
    <section className="dl-section" aria-label={t('Nota diária', 'Daily note')}>
      <h4>{t('Nota diária', 'Daily note')}</h4>
      {note ? <button type="button" className="dl-note" onClick={event => event.metaKey || event.ctrlKey ? actions.openInNewTab({ type: 'page', id: note.id }) : actions.openPage(note.id)}>
        <PageIcon value={note.icon ?? 'lucide:calendar-days:red'} className="dl-note-icon" style={{ width: 16, height: 16 }} /><span>{note.title}</span>
      </button> : <button type="button" className="dl-add" disabled={creating} onClick={() => { setCreating(true); void openDailyNote(day).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setCreating(false)) }}>
        <Plus size={14} /> {creating ? t('Criando…', 'Creating…') : t('Nota diária', 'Daily note')}
      </button>}
    </section>
    <ScheduleDropZone day={day} />
    <section className="dl-section" aria-label={t('Tarefas do dia', 'Tasks for the day')}>
      <h4>{t('Tarefas do dia', 'Tasks for the day')} <span className="dl-count">{dayTasks.filter(task => !task.done).length}</span></h4>
      {dayTasks.length ? <ul className="dl-list">{dayTasks.map(item => <TaskRow key={item.key} item={item} onError={setError} />)}</ul> : <p className="dl-empty">{t('Nenhuma tarefa com data neste dia.', 'No tasks due on this day.')}</p>}
    </section>
    {eventsReady && <section className="dl-section" aria-label={t('Eventos', 'Events')}>
      <h4>{t('Eventos', 'Events')} <span className="dl-count">{dayEvents.length}</span></h4>
      {dayEvents.length ? <ul className="dl-list">{dayEvents.map(event => <EventRow key={`${event.id}-${event.start}`} event={event} day={day} locale={locale} />)}</ul> : <p className="dl-empty">{t('Nenhum evento.', 'No events.')}</p>}
    </section>}
    <section className="dl-section" aria-label={t('Criado neste dia', 'Created on this day')}>
      <h4>{day === today ? t('Criado hoje', 'Created today') : t('Criado neste dia', 'Created on this day')} <span className="dl-count">{created.length}</span></h4>
      {created.length ? <ul className="dl-list">{created.map(page => <li key={page.id}><button type="button" className="dl-created" onClick={event => event.metaKey || event.ctrlKey ? actions.openInNewTab({ type: 'page', id: page.id }) : actions.openPage(page.id)}>
        {<PageIcon value={page.icon} fallback="page" className="dl-note-icon" style={{ width: 16, height: 16 }} />}<span>{page.title || t('Sem título', 'Untitled')}</span>
        <time>{new Date(page.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
      </button></li>)}</ul> : <p className="dl-empty">{t('Nenhuma página criada.', 'No pages created.')}</p>}
    </section>
  </div>
}

function DaySummary({ days, today, locale, tasks, events, eventsReady, onPick }: { days: string[]; today: string; locale: DailyLocale; tasks: TaskItem[]; events: SystemCalendarEvent[]; eventsReady: boolean; onPick: (day: string) => void }) {
  const notes = dailyNotesIndex()
  const rows = days.map(day => ({ day, note: notes.get(day), tasks: tasksOnDay(tasks, day), events: eventsReady ? eventsForDay(events, day) : [] }))
  const visible = days.length > 7 ? rows.filter(row => row.note || row.tasks.length || row.events.length) : rows
  if (!visible.length) return <p className="dl-empty dl-pad">{t('Nada marcado neste mês.', 'Nothing scheduled this month.')}</p>
  return <ul className="dl-summary">{visible.map(row => <li key={row.day}>
    <button type="button" className={`dl-summary-day${row.day === today ? ' is-today' : ''}`} onClick={() => onPick(row.day)}>
      <span className="dl-summary-date"><b>{ymd(row.day)[2]}</b> {formatWeekday(row.day, locale).slice(0, 3)}</span>
      <span className="dl-summary-items">
        {row.note && <span className="dl-chip is-note">{t('Nota', 'Note')}</span>}
        {row.tasks.slice(0, 3).map(task => <span key={task.key} className="dl-chip is-task">{task.title || t('Sem título', 'Untitled')}</span>)}
        {row.tasks.length > 3 && <span className="dl-chip">+{row.tasks.length - 3}</span>}
        {row.events.slice(0, 2).map(event => <span key={`${event.id}-${event.start}`} className="dl-chip is-event">{event.title || t('(Sem título)', '(No title)')}</span>)}
        {!row.note && !row.tasks.length && !row.events.length && <span className="dl-summary-none">—</span>}
      </span>
    </button>
  </li>)}</ul>
}

export function CalendarPanel() {
  const { settings, pages } = useStore()
  const { locale } = useI18n()
  useTaskIndexVersion()
  const flow = settings.dailyFlow ?? {}
  const today = useToday()
  const [selected, setSelected] = useState(today)
  const [[year, month], setMonth] = useState(() => ymd(today).slice(0, 2) as [number, number])
  const [width, setWidth] = useState(() => Math.max(PANEL_MIN, Math.min(PANEL_MAX, flow.panelWidth ?? PANEL_DEFAULT)))
  const tab = flow.panelTab ?? 'day'
  const weekStart = weekStartFor(locale, flow.weekStart ?? 'auto')
  // Abrir uma nota diária seleciona o dia dela no painel.
  const { route } = useStore()
  const routeDay = route.type === 'page' ? dailyDateOf(route.id) : null
  useEffect(() => { if (routeDay) { setSelected(routeDay); const [y, m] = ymd(routeDay); setMonth([y, m]) } }, [routeDay])
  const lastToday = useRef(today)
  useEffect(() => { if (lastToday.current !== today && selected === lastToday.current) setSelected(today); lastToday.current = today }, [today, selected])

  // Eventos do macOS: só lê o estado da permissão (nunca pede). Sem acesso total, a seção some.
  const calendar = useCalendarSettings()
  const native = hasNativeCalendar()
  const { status } = useCalendarAccess(native && calendar.enabled)
  const eventsReady = native && calendar.enabled && calendar.calendarIds.length > 0 && status?.authorization === 'fullAccess'
  const grid = useMemo(() => monthGrid(year, month, weekStart), [year, month, weekStart])
  const range = useMemo(() => rangeForDays(grid[0], grid[41]), [grid])
  const { events } = useSystemEvents(eventsReady ? range : null)

  const tasks = currentTasks(true)
  const openTasks = currentTasks()
  const marks = useMemo(() => {
    const map = new Map<string, DayMarks>()
    const get = (day: string) => { let mark = map.get(day); if (!mark) map.set(day, mark = { note: false, tasks: 0, overdue: false, events: 0 }); return mark }
    for (const day of dailyNotesIndex().keys()) get(day).note = true
    for (const task of openTasks) if (task.due) { const mark = get(task.due); mark.tasks++; if (task.due < today) mark.overdue = true }
    if (eventsReady) for (const event of events) {
      const span = systemEventDays(event)
      if (!span) continue
      for (let day = span.start, guard = 0; day <= span.end && guard < 62; day = addDays(day, 1), guard++) get(day).events++
    }
    return map
  }, [pages, openTasks, events, eventsReady, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (day: string) => {
    setSelected(day)
    const [y, m] = ymd(day)
    if (y !== year || m !== month) setMonth([y, m])
  }
  // Soltar uma tarefa num dia do mês: cria o evento no horário da tarefa (ou 09:00) e oferece desfazer.
  const dropOnDay = (day: string, event: React.DragEvent) => {
    const key = draggedTaskKey(event)
    const item = key ? currentTasks(true).find(task => task.key === key) : undefined
    if (item) void scheduleDropped(item, { ...suggestedSlot({ due: day, time: item.time }, day, taskDuration()), day }, t)
  }
  const goToday = () => { pick(today); if (tab !== 'day') updateDailySettings({ panelTab: 'day' }) }
  const setTab = (next: 'day' | 'week' | 'month') => updateDailySettings({ panelTab: next })

  const onResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX, startWidth = width
    let latest = startWidth
    const move = (e: PointerEvent) => { latest = Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth + (startX - e.clientX))); setWidth(latest) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); updateDailySettings({ panelWidth: Math.round(latest) }) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const onResizeKey = (event: React.KeyboardEvent) => {
    const delta = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
    if (!delta) return
    event.preventDefault()
    const next = Math.max(PANEL_MIN, Math.min(PANEL_MAX, width + delta)); setWidth(next); updateDailySettings({ panelWidth: next })
  }

  const monthDays = grid.filter(day => ymd(day)[1] === month)
  return <aside className="dl-panel" style={{ width }} aria-label={t('Calendário', 'Calendar')}>
    <div className="dl-resize" role="separator" aria-orientation="vertical" aria-label={t('Ajustar largura do painel', 'Resize panel')} aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={width} tabIndex={0} onPointerDown={onResize} onKeyDown={onResizeKey} />
    <div className="dl-head">
      <CalendarDays size={16} aria-hidden />
      <strong>{t('Calendário', 'Calendar')}</strong>
      <button type="button" className="dl-today-btn" onClick={goToday}>{t('Hoje', 'Today')}</button>
      <button type="button" className="dl-icon-btn" aria-label={t('Fechar painel de calendário', 'Close calendar panel')} title={`${t('Fechar', 'Close')} (${shortcutHint('calendar-panel')})`} onClick={() => toggleCalendarPanel(false)}><X size={16} /></button>
    </div>
    <MiniMonth year={year} month={month} selected={selected} today={today} weekStart={weekStart} locale={locale} marks={day => marks.get(day)} onPick={pick} onMonth={(y, m) => setMonth([y, m])} onDropTask={canScheduleTasks() ? dropOnDay : undefined} />
    <div className="dl-tabs" role="tablist" aria-label={t('Visualização', 'View')}>
      {(['day', 'week', 'month'] as const).map(id => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
        {id === 'day' ? t('Dia', 'Day') : id === 'week' ? t('Semana', 'Week') : t('Mês', 'Month')}
      </button>)}
    </div>
    <div className="dl-scroll">
      {tab === 'day' && <DayDetails day={selected} today={today} locale={locale} tasks={tasks} events={events} eventsReady={eventsReady} />}
      {tab === 'week' && <DaySummary days={weekDays(selected, weekStart)} today={today} locale={locale} tasks={openTasks} events={events} eventsReady={eventsReady} onPick={day => { pick(day); setTab('day') }} />}
      {tab === 'month' && <DaySummary days={monthDays} today={today} locale={locale} tasks={openTasks} events={events} eventsReady={eventsReady} onPick={day => { pick(day); setTab('day') }} />}
    </div>
  </aside>
}

/** Atalho usado fora do painel: estado atual (para testes e comandos). */
export const calendarPanelOpen = () => !!getState().settings.dailyFlow?.panelOpen
