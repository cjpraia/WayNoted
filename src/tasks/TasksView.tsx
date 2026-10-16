// Tela "Tarefas": Hoje / Próximas / Atrasadas / Sem data, reunindo checklists (com menção de data)
// e linhas de bancos com data e conclusão pendente. Concluir funciona no lugar; clicar abre a origem.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckSquare, FileText, ListChecks, Mic, Repeat, Square } from 'lucide-react'
import { useStore } from '../store'
import { t, useI18n } from '../i18n'
import { currentBuckets, startTaskIndex, taskIndexStatus, useTaskIndexVersion } from './taskIndex'
import { groupTasks, type TaskBuckets, type TaskItem } from './taskCore'
import { completeTask, openTaskSource } from './taskActions'
import { addDays, formatLongDate, formatShortDate, formatWeekday, type DailyLocale } from '../daily/dailyCore'
import { useToday } from '../daily/CalendarPanel'
import { openToday } from '../daily/dailyNotes'
import './tasks.css'
import { showToast, showUndoToast } from '../components/ui/toastQueue'
import { Illustration } from '../components/ui/illustrations/Illustration'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'
import { shortcutHint } from '../shortcuts'
import { openVoiceTasks } from '../voice/VoiceTasksDialog'
import { TaskScheduleButton } from './ScheduleTask'
import { TaskReminderButton } from '../reminders/RemindersUi'
import { taskDragProps } from './taskDrag'

export type TaskTab = 'today' | 'upcoming' | 'overdue' | 'undated'
const ROW = 38, HEADER = 34, VIRTUAL_AFTER = 150

export function dueLabel(due: string | null, today: string, locale: DailyLocale): string {
  if (!due) return t('Sem data', 'No date')
  if (due === today) return t('Hoje', 'Today')
  if (due === addDays(today, 1)) return t('Amanhã', 'Tomorrow')
  if (due === addDays(today, -1)) return t('Ontem', 'Yesterday')
  if (due > today && due <= addDays(today, 6)) { const day = formatWeekday(due, locale); return day.charAt(0).toUpperCase() + day.slice(1) }
  return formatShortDate(due, locale) + (due.slice(0, 4) !== today.slice(0, 4) ? ` ${due.slice(0, 4)}` : '')
}

type Row = { kind: 'header'; key: string; label: string; count: number; tone?: 'overdue' } | { kind: 'task'; key: string; item: TaskItem }

export function TaskLine({ item, today, locale, showDue, onDone, pending }: { item: TaskItem; today: string; locale: DailyLocale; showDue: boolean; onDone: (item: TaskItem) => void; pending: boolean }) {
  const overdue = !!item.due && item.due < today
  return <div className={`tk-item${pending ? ' is-pending' : ''}`} role="listitem" {...taskDragProps(item)}>
    <button type="button" className="tk-check" aria-label={t('Concluir “{title}”', 'Complete “{title}”', { title: item.title || t('Sem título', 'Untitled') })} disabled={pending} onClick={() => onDone(item)}>
      {pending ? <CheckSquare size={16} /> : <Square size={16} />}
    </button>
    <button type="button" className="tk-main" onClick={event => openTaskSource(item, event.metaKey || event.ctrlKey)} title={t('Abrir em {page}', 'Open in {page}', { page: item.sourceTitle })}>
      <span className="tk-title">{item.title || t('Sem título', 'Untitled')}</span>
      <span className="tk-meta">
        {item.inherited && item.due && <span className={`tk-due tk-inherit${overdue ? ' is-overdue' : ''}`} title={t('Data herdada da nota diária', 'Date inherited from the daily note')}><FileText size={11} aria-hidden /> {t('Nota de {day}', 'Note from {day}', { day: formatShortDate(item.due, locale) })}</span>}
        {!item.inherited && item.startDate && item.due && <span className={`tk-range${overdue ? ' is-overdue' : ''}`} title={t('Início e prazo', 'Start and due')}><CalendarDays size={11} aria-hidden /> {t('Início', 'Start')} {dueLabel(item.startDate, today, locale)} → {t('Prazo', 'Due')} {dueLabel(item.due, today, locale)}</span>}
        {!item.inherited && !item.startDate && showDue && item.due && <span className={`tk-due${overdue ? ' is-overdue' : ''}`}><CalendarDays size={11} aria-hidden /> {dueLabel(item.due, today, locale)}</span>}
        {item.time && <span className="tk-time">{item.time}</span>}
        {item.repeat && <span className="tk-repeat" title={item.repeat}><Repeat size={11} aria-hidden /> {item.repeat}</span>}
        {!item.inherited && <span className="tk-source">{item.kind === 'row' ? '▦ ' : ''}{item.sourceTitle}</span>}
      </span>
    </button>
    <TaskScheduleButton item={item} />
    <TaskReminderButton item={item} />
  </div>
}

function rowsFor(tab: TaskTab, buckets: TaskBuckets, group: 'day' | 'project', today: string, locale: DailyLocale): Row[] {
  const rows: Row[] = []
  const section = (key: string, label: string, items: TaskItem[], tone?: 'overdue') => {
    if (!items.length) return
    if (group === 'project') {
      for (const part of groupTasks(items, 'project')) {
        rows.push({ kind: 'header', key: `${key}:${part.key}`, label: `${label ? label + ' · ' : ''}${part.items[0].sourceTitle}`, count: part.items.length, tone })
        for (const item of part.items) rows.push({ kind: 'task', key: item.key, item })
      }
      return
    }
    rows.push({ kind: 'header', key, label, count: items.length, tone })
    for (const item of items) rows.push({ kind: 'task', key: item.key, item })
  }
  if (tab === 'today') { section('overdue', t('Atrasadas', 'Overdue'), buckets.overdue, 'overdue'); section('today', `${t('Hoje', 'Today')} · ${formatLongDate(today, locale)}`, buckets.today) }
  else if (tab === 'overdue') {
    if (group === 'day') for (const part of groupTasks(buckets.overdue, 'day')) section(`o:${part.key}`, dueLabel(part.key, today, locale), part.items, 'overdue')
    else section('overdue', '', buckets.overdue, 'overdue')
  } else if (tab === 'upcoming') {
    if (group === 'day') for (const part of groupTasks(buckets.upcoming, 'day')) section(`u:${part.key}`, `${dueLabel(part.key, today, locale)} · ${formatShortDate(part.key, locale)}`, part.items)
    else section('upcoming', '', buckets.upcoming)
  } else section('undated', group === 'day' ? t('Sem data', 'No date') : '', buckets.undated)
  return rows
}

export function TasksView() {
  const { pages } = useStore()
  const { locale } = useI18n()
  useTaskIndexVersion()
  useEffect(() => startTaskIndex(), [])
  const today = useToday()
  const [tab, setTab] = useState<TaskTab>('today')
  const [group, setGroup] = useState<'day' | 'project'>('day')
  const [source, setSource] = useState('all')
  const [pending, setPending] = useState<Record<string, boolean>>({})
    const [error, setError] = useState('')
  const all = currentBuckets(today)
  // Bancos e páginas presentes na lista (filtro "Origem").
  const sources = useMemo(() => {
    const map = new Map<string, { title: string; kind: 'row' | 'checklist'; count: number }>()
    for (const item of [...all.overdue, ...all.today, ...all.upcoming, ...all.undated]) {
      const entry = map.get(item.sourceId) ?? { title: item.sourceTitle, kind: item.kind, count: 0 }
      entry.count++; map.set(item.sourceId, entry)
    }
    return [...map].sort((a, b) => a[1].title.localeCompare(b[1].title))
  }, [all])
  const filter = (item: TaskItem) => source === 'all' || (source === 'checklists' ? item.kind === 'checklist' : source === 'databases' ? item.kind === 'row' : item.sourceId === source)
  const buckets = useMemo<TaskBuckets>(() => source === 'all' ? all : { overdue: all.overdue.filter(filter), today: all.today.filter(filter), upcoming: all.upcoming.filter(filter), undated: all.undated.filter(filter) }, [all, source]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => rowsFor(tab, buckets, group, today, locale), [tab, buckets, group, today, locale])
  const status = taskIndexStatus()
  void pages

  const done = (item: TaskItem) => {
    setPending(value => ({ ...value, [item.key]: true })); setError('')
    void completeTask(item, true).then(result => notifyDone(item, result)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(value => { const next = { ...value }; delete next[item.key]; return next }))
  }
  const notifyDone = (item: TaskItem, result: string) => {
    // Recorrente reagendada: desfazer não volta a data (como no Todoist); só reabre itens marcados.
    if (result === 'advanced') { showToast({ message: t('Reagendada para a próxima ocorrência', 'Rescheduled to the next occurrence') }); return }
    showUndoToast(t('Concluída: {title}', 'Completed: {title}', { title: item.title || t('Sem título', 'Untitled') }), () => {
      void completeTask(item, false).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
    }, t('Desfazer', 'Undo'))
  }

  // Virtualização simples (alturas fixas) para listas grandes.
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 800 })
  const virtual = rows.length > VIRTUAL_AFTER
  const offsets = useMemo(() => { const out = [0]; for (const row of rows) out.push(out[out.length - 1] + (row.kind === 'header' ? HEADER : ROW)); return out }, [rows])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !virtual) return
    const update = () => setViewport({ top: Math.max(0, el.scrollTop - (listRef.current?.offsetTop ?? 0)), height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [virtual])
  let start = 0, end = rows.length
  if (virtual) {
    const from = viewport.top - 400, to = viewport.top + viewport.height + 400
    while (start < rows.length && offsets[start + 1] < from) start++
    end = start
    while (end < rows.length && offsets[end] < to) end++
  }

  const tabs: [TaskTab, string, number, string?][] = [
    ['today', t('Hoje', 'Today'), buckets.today.length + buckets.overdue.length],
    ['upcoming', t('Próximas', 'Upcoming'), buckets.upcoming.length],
    ['overdue', t('Atrasadas', 'Overdue'), buckets.overdue.length, 'overdue'],
    ['undated', t('Sem data', 'No date'), buckets.undated.length],
  ]
  return <div className="tk-root" ref={scrollRef}>
    <div className="tk-inner">
      <header className="tk-header">
        <h1><ListChecks size={22} aria-hidden /> {t('Tarefas', 'Tasks')}</h1>
        <Button onClick={openVoiceTasks}><Mic size={14} aria-hidden /> {t('Por voz', 'By voice')}</Button>
        <Button onClick={() => void openToday().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))} title={shortcutHint('daily-today')}><CalendarDays size={14} /> {t('Nota de hoje', 'Today’s note')}</Button>
      </header>
      <div className="tk-tabs" role="tablist" aria-label={t('Prazo', 'Due')}>
        {tabs.map(([id, label, count, tone]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tk-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
          {label} <span className={`tk-badge${tone === 'overdue' && count ? ' is-overdue' : ''}`}>{count}</span>
        </button>)}
      </div>
      <div className="tk-toolbar">
        <label>{t('Agrupar por', 'Group by')} <Select value={group} onChange={event => setGroup(event.target.value as 'day' | 'project')}>
          <option value="day">{t('Dia', 'Day')}</option><option value="project">{t('Projeto', 'Project')}</option>
        </Select></label>
        <label>{t('Origem', 'Source')} <Select value={source} onChange={event => setSource(event.target.value)}>
          <option value="all">{t('Todas', 'All')}</option>
          <option value="databases">{t('Só bancos de dados', 'Databases only')}</option>
          <option value="checklists">{t('Só checklists', 'Checklists only')}</option>
          {sources.filter(([, entry]) => entry.kind === 'row').length > 0 && <optgroup label={t('Bancos de dados', 'Databases')}>
            {sources.filter(([, entry]) => entry.kind === 'row').map(([id, entry]) => <option key={id} value={id}>{entry.title} ({entry.count})</option>)}
          </optgroup>}
        </Select></label>
        {status.pending > 0 && <span className="tk-indexing" role="status">{t('Lendo {n} páginas…', 'Reading {n} pages…', { n: status.pending })}</span>}
      </div>
      {error && <div className="tk-error" role="alert">{error}</div>}
      <div className="tk-list" role="list" ref={listRef} style={virtual ? { height: offsets[rows.length], position: 'relative' } : undefined}>
        {!rows.length && <div className="tk-empty">
          <Illustration name="tasks" size={92} />
          <p>{tab === 'today' ? t('Nada para hoje. Use @data num item de checklist ou uma data num banco com status.', 'Nothing for today. Add @date to a checklist item or a date to a database with a status.') : t('Nenhuma tarefa aqui.', 'No tasks here.')}</p>
        </div>}
        {rows.slice(start, end).map((row, i) => {
          const style = virtual ? { position: 'absolute' as const, top: offsets[start + i], left: 0, right: 0, height: row.kind === 'header' ? HEADER : ROW } : undefined
          return row.kind === 'header'
            ? <div key={row.key} className={`tk-group${row.tone === 'overdue' ? ' is-overdue' : ''}`} style={style} role="presentation"><span>{row.label}</span><span className="tk-group-count">{row.count}</span></div>
            : <div key={row.key} style={style}><TaskLine item={row.item} today={today} locale={locale} showDue={tab !== 'upcoming' || group === 'project'} onDone={done} pending={!!pending[row.item.key]} /></div>
        })}
      </div>
    </div>
  </div>
}
