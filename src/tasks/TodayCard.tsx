// Cartão "Hoje" da página inicial: até 5 tarefas atrasadas ou de hoje (as futuras ficam só na tela Tarefas) e atalho para a nota do dia.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Icon } from '../components/ui/icons/Icon'
import { actions, useStore } from '../store'
import { t, useI18n } from '../i18n'
import { currentBuckets, currentTasks, startTaskIndex, useTaskIndexVersion } from './taskIndex'
import { dueNowTasks, type TaskItem } from './taskCore'
import { completeTask } from './taskActions'
import { TaskLine } from './TasksView'
import { useToday } from '../daily/CalendarPanel'
import { dailyNoteFor, openToday } from '../daily/dailyNotes'
import { dayProgress, daySummary, wordGoal } from '../onboarding/day'
import { planTomorrow } from '../onboarding/actions'
import { useProductivityData } from '../activity/session'
import { showUndoToast } from '../components/ui/toastQueue'
import './tasks.css'
import { Illustration } from '../components/ui/illustrations/Illustration'
import { Button } from '../components/ui/Button'

export function TodayCard({ primary = true }: { primary?: boolean }) {
  const { settings } = useStore()
  const { locale } = useI18n()
  useTaskIndexVersion()
  useEffect(() => startTaskIndex(), [])
  const today = useToday()
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const buckets = currentBuckets(today)
  const items = dueNowTasks(buckets, 5)
  const note = dailyNoteFor(today)
  // Progresso do dia (Goal-Gradient/Zeigarnik): concluídas / total de hoje, inclusive as herdadas da nota diária.
  const all = currentTasks(true)
  const progress = useMemo(() => dayProgress(all, today), [all, today])
  const { data } = useProductivityData()
  const wordsToday = settings.productivity?.enabled === false ? 0 : data.days[today]?.words ?? 0
  const goal = settings.productivity?.enabled === false ? null : wordGoal(wordsToday, settings.productivity?.dailyGoal)
  const finished = useRef(progress.complete)
  const [fresh, setFresh] = useState(false)
  useEffect(() => { if (progress.complete && !finished.current) setFresh(true); finished.current = progress.complete }, [progress.complete])
  const ring = 16, circ = 2 * Math.PI * 6.5
  // Fechamento do dia (Peak-End): tudo o que era para hoje foi feito e nada está atrasado.
  const doneToday = items.length || buckets.today.length || buckets.overdue.length ? 0 : currentTasks(true).filter(item => item.done && item.due === today).length
  const done = (item: TaskItem) => {
    setPending(value => ({ ...value, [item.key]: true })); setError('')
    void completeTask(item, true).then(result => { if (result === 'checked') showUndoToast(t('Concluída: {title}', 'Completed: {title}', { title: item.title || t('Sem título', 'Untitled') }), () => void completeTask(item, false).catch(() => {}), t('Desfazer', 'Undo')) }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(value => { const next = { ...value }; delete next[item.key]; return next }))
  }
  return <section className="hm-section tk-card" aria-labelledby="hm-today-title">
    <h2 className="hm-section-title" id="hm-today-title">{t('Hoje', 'Today')}
      {progress.total > 0 && <span className="co-ring" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={t('{done} de {total} tarefas', '{done} of {total} tasks', { done: progress.done, total: progress.total })}>
        <svg width={ring} height={ring} viewBox="0 0 16 16" aria-hidden><circle className="co-ring-track" cx="8" cy="8" r="6.5" fill="none" strokeWidth="2" /><circle className="co-ring-fill" cx="8" cy="8" r="6.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - progress.fraction)} /></svg>
        {t('{done} de {total} tarefas', '{done} of {total} tasks', { done: progress.done, total: progress.total })}
      </span>}
      {goal && <span className="co-goal">{t('{w} de {g} palavras', '{w} of {g} words', { w: goal.words.toLocaleString(locale), g: goal.goal.toLocaleString(locale) })}</span>}
      {(buckets.overdue.length > 0 || buckets.today.length > 0) && <span className="tk-card-counts">
        {buckets.overdue.length > 0 && <span className="tk-badge is-overdue">{t('{n} atrasadas', '{n} overdue', { n: buckets.overdue.length })}</span>}
        <span className="tk-badge">{t('{n} para hoje', '{n} due today', { n: buckets.today.length })}</span>
      </span>}
    </h2>
    <div className="tk-card-body">
      {doneToday > 0 ? <div className={`tk-day-done${fresh ? ' is-fresh' : ''}`} role="status">
          <Illustration name="day-done" size={76} />
          <div className="tk-day-done-text"><strong className="np-display">{t('Dia concluído', 'Day complete')}</strong>
            <span>{t('Bom descanso.', 'Enjoy the rest of your day.')}</span>
            <span className="co-summary">{daySummary(doneToday, wordsToday, t, n => n.toLocaleString(locale))}</span>
            <Button className="co-plan" onClick={() => void planTomorrow().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))}><Icon name="today" size={14} /> {t('Planejar amanhã', 'Plan tomorrow')}</Button></div>
        </div>
        : items.length ? <div role="list">{items.map(item => <TaskLine key={item.key} item={item} today={today} locale={locale} showDue onDone={done} pending={!!pending[item.key]} />)}</div>
        : <p className="tk-card-empty">{t('Nada para hoje.', 'Nothing for today.')} {buckets.upcoming.length > 0
          ? <button type="button" className="tk-link" onClick={() => actions.navigate({ type: 'tasks' })}>{t('Ver próximas', 'See upcoming')}</button>
          : t('Escreva “@amanhã” num item de checklist para agendá-lo.', 'Type “@tomorrow” in a checklist item to schedule it.')}</p>}
      {error && <div className="tk-error" role="alert">{error}</div>}
      <div className="tk-card-actions">
        <Button variant={primary ? 'primary' : 'secondary'} onClick={() => void openToday().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))}><Icon name="today" size={14} /> {note ? t('Abrir nota de hoje', 'Open today’s note') : t('Criar nota de hoje', 'Create today’s note')}</Button>
        <Button variant="ghost" onClick={() => actions.navigate({ type: 'tasks' })}>{t('Ver todas as tarefas', 'View all tasks')} <ArrowRight size={14} strokeWidth={1.75} /></Button>
      </div>
    </div>
  </section>
}
