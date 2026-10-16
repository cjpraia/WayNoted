// Itens "Hoje" e "Tarefas" da barra lateral (fluxo diário).
import { Icon } from '../components/ui/icons/Icon'
import { actions, useStore } from '../store'
import { t } from '../i18n'
import type { Route } from '../types'
import { dailyDateOf, openToday } from './dailyNotes'
import { localDay } from './dailyCore'
import { currentBuckets, useTaskIndexVersion } from '../tasks/taskIndex'
import { useToday } from './CalendarPanel'
import './daily.css'
import { shortcutHint } from '../shortcuts'
import { currentQueue, useReviewVersion } from '../review/reviewActions'

export function DailyFlowNav({ route }: { route: Route }) {
  useStore()
  useTaskIndexVersion()
  const reviewState = useReviewVersion()
  const hasCards = Object.keys(reviewState?.cards ?? {}).length > 0
  const reviewDue = hasCards ? currentQueue().total : 0
  const today = useToday()
  const buckets = currentBuckets(today)
  const due = buckets.overdue.length + buckets.today.length
  const onToday = route.type === 'page' && dailyDateOf(route.id) === localDay()
  return <div className="sb-daily">
    <button type="button" className={`sb-row sb-nav${onToday ? ' sb-row--active' : ''}`} data-tip={t('Nota de hoje', 'Today’s note')} data-tip-kbd={shortcutHint('daily-today')} onClick={() => void openToday().catch(actions.reportSaveError)}>
      <span className="sb-row-icon"><Icon name="today" size={18} /></span><span className="sb-row-title">{t('Hoje', 'Today')}</span>
    </button>
    <button type="button" className={`sb-row sb-nav${route.type === 'tasks' ? ' sb-row--active' : ''}`} aria-current={route.type === 'tasks' ? 'page' : undefined} onClick={() => actions.navigate({ type: 'tasks' })}>
      <span className="sb-row-icon"><Icon name="tasks" size={18} /></span><span className="sb-row-title">{t('Tarefas', 'Tasks')}</span>
      {due > 0 && <span className={`sb-daily-count${buckets.overdue.length ? ' is-overdue' : ''}`} aria-label={t('{n} para hoje ou atrasadas', '{n} due today or overdue', { n: due })}>{due}</span>}
    </button>
    {hasCards && <button type="button" className={`sb-row sb-nav${route.type === 'review' ? ' sb-row--active' : ''}`} aria-current={route.type === 'review' ? 'page' : undefined} onClick={() => actions.navigate({ type: 'review' })}>
      <span className="sb-row-icon"><Icon name="review" size={18} /></span><span className="sb-row-title">{t('Revisão', 'Review')}</span>
      {reviewDue > 0 && <span className="sb-daily-count" aria-label={t('{n} cartões para revisar', '{n} cards to review', { n: reviewDue })}>{reviewDue}</span>}
    </button>}
  </div>
}
