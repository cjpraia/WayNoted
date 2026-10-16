// Mini calendário mensal próprio (painel do fluxo diário): semana conforme o idioma, hoje em círculo,
// pontos por dia (nota diária, tarefas, eventos) e navegação por teclado (setas).
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { t } from '../i18n'
import { addDays, formatLongDate, formatMonthYear, monthGrid, type DailyLocale } from './dailyCore'
import { Select } from '../components/ui/Select'
import { hasTaskDrag } from '../tasks/taskDrag'

const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]

export interface DayMarks { note: boolean; tasks: number; overdue: boolean; events: number }

export function MiniMonth({ year, month, selected, today, weekStart, locale, marks, onPick, onMonth, onDropTask }: {
  year: number; month: number; selected: string; today: string; weekStart: 0 | 1; locale: DailyLocale
  marks: (day: string) => DayMarks | undefined; onPick: (day: string) => void; onMonth: (year: number, month: number) => void
  /** Uma tarefa foi solta neste dia (agendar no Calendário). */
  onDropTask?: (day: string, event: React.DragEvent) => void
}) {
  const days = monthGrid(year, month, weekStart)
  const names = days.slice(0, 7).map(day => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)))
  const shift = (n: number) => { const total = year * 12 + month - 1 + n; onMonth(Math.floor(total / 12), (total % 12) + 1) }
  const onKey = (event: React.KeyboardEvent, day: string) => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : 0
    if (!delta) return
    event.preventDefault()
    const next = addDays(day, delta)
    onPick(next)
    requestAnimationFrame(() => (document.querySelector(`[data-dl-day="${next}"]`) as HTMLElement | null)?.focus())
  }
  const title = formatMonthYear(year, month, locale)
  return <div className="dl-month">
    <div className="dl-month-head">
      <button type="button" className="dl-icon-btn" aria-label={t('Mês anterior', 'Previous month')} onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
      <span className="dl-month-title" aria-live="polite">{title.charAt(0).toUpperCase() + title.slice(1)}</span>
      <Select className="dl-year" aria-label={t('Ano', 'Year')} value={year} onChange={event => onMonth(Number(event.target.value), month)}>
        {Array.from({ length: 11 }, (_, i) => year - 5 + i).map(y => <option key={y} value={y}>{y}</option>)}
      </Select>
      <button type="button" className="dl-icon-btn" aria-label={t('Próximo mês', 'Next month')} onClick={() => shift(1)}><ChevronRight size={16} /></button>
    </div>
    <div className="dl-grid" role="grid" aria-label={title}>
      {names.map((name, i) => <span key={i} className="dl-wd" role="columnheader">{name}</span>)}
      {days.map(day => {
        const mark = marks(day)
        const [, m, d] = ymd(day)
        const label = formatLongDate(day, locale) + (mark?.note ? ` · ${t('nota diária', 'daily note')}` : '') + (mark?.tasks ? ` · ${t('{n} tarefas', '{n} tasks', { n: mark.tasks })}` : '') + (mark?.events ? ` · ${t('{n} eventos', '{n} events', { n: mark.events })}` : '')
        return <button type="button" key={day} data-dl-day={day} role="gridcell" aria-selected={day === selected} aria-current={day === today ? 'date' : undefined} aria-label={label} tabIndex={day === selected ? 0 : -1}
          className={`dl-day${m !== month ? ' is-out' : ''}${day === today ? ' is-today' : ''}${day === selected ? ' is-selected' : ''}`} onClick={() => onPick(day)} onKeyDown={event => onKey(event, day)}
          {...(onDropTask ? { onDragOver: (event: React.DragEvent) => { if (hasTaskDrag(event)) event.preventDefault() }, onDrop: (event: React.DragEvent) => { if (hasTaskDrag(event)) { event.preventDefault(); onDropTask(day, event) } } } : {})}>
          <span className="dl-day-num">{d}</span>
          <span className="dl-dots" aria-hidden>{mark?.note && <i className="dl-dot is-note" />}{!!mark?.tasks && <i className={`dl-dot is-task${mark.overdue ? ' is-overdue' : ''}`} />}{!!mark?.events && <i className="dl-dot is-event" />}</span>
        </button>
      })}
    </div>
  </div>
}

