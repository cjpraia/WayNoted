// Barra no topo de uma nota diária: ‹ dia anterior · dia da semana · Hoje · Semana N · próximo dia ›.
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { t, useI18n } from '../i18n'
import { addDays, formatWeekday, isoWeek } from './dailyCore'
import { dailyDateOf, openDailyNote } from './dailyNotes'
import { useToday } from './CalendarPanel'
import { RolloverDialog, useRolloverCandidates } from './RolloverDialog'
import './daily.css'
import { shortcutHint } from '../shortcuts'

export function DailyNoteNav({ pageId }: { pageId: string }) {
  useStore()
  const { locale } = useI18n()
  const today = useToday()
  const [error, setError] = useState('')
  const [rollover, setRollover] = useState(false)
  const overdue = useRolloverCandidates()
  const date = dailyDateOf(pageId)
  if (!date) return null
  const go = (day: string, event?: React.MouseEvent) => { setError(''); void openDailyNote(day, { newTab: !!(event?.metaKey || event?.ctrlKey) }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))) }
  return <div className="dn-bar" role="navigation" aria-label={t('Navegar entre notas diárias', 'Navigate daily notes')}>
    <button type="button" className="dn-nav" title={t('Dia anterior', 'Previous day')} aria-label={t('Dia anterior', 'Previous day')} onClick={event => go(addDays(date, -1), event)}><ChevronLeft size={16} /></button>
    <button type="button" className="dn-nav" title={t('Próximo dia', 'Next day')} aria-label={t('Próximo dia', 'Next day')} onClick={event => go(addDays(date, 1), event)}><ChevronRight size={16} /></button>
    <span className="dn-weekday">{(day => day.charAt(0).toUpperCase() + day.slice(1))(formatWeekday(date, locale))}</span>
    {date === today && <span className="dn-today">{t('Hoje', 'Today')}</span>}
    <span className="dn-week">{t('Semana {n}', 'Week {n}', { n: isoWeek(date) })}</span>
    {date !== today && <button type="button" className="dn-go-today" onClick={event => go(today, event)} title={shortcutHint('daily-today')}>{t('Ir para hoje', 'Go to today')}</button>}
    {date === today && overdue.length > 0 && <button type="button" className="dn-rollover" onClick={() => setRollover(true)} title={t('Copiar ou mover tarefas em aberto de dias anteriores para esta nota', 'Copy or move open tasks from earlier days to this note')}>{t('Trazer tarefas atrasadas para hoje ({n})', 'Bring overdue tasks to today ({n})', { n: overdue.length })}</button>}
    {rollover && <RolloverDialog onClose={() => setRollover(false)} />}
    {error && <span className="dn-error" role="alert">{error}</span>}
  </div>
}
