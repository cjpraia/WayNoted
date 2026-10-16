// Cartão compacto "Esta semana" da página inicial; leva ao Painel de Produtividade.
import { useMemo } from 'react'
import { actions, productivity, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { addDays, resolveWeekStart, startOfWeek, streaks, weekComparison } from '../../activity/stats'
import { useProductivityData } from '../../activity/session'
import { ProductivityIcon } from './ProductivityIcon'
import './productivity.css'

export function HomeWeekCard() {
  const { settings } = useStore()
  const { locale, t } = useI18n()
  const { data } = useProductivityData()
  const today = productivity.today()
  const weekStart = resolveWeekStart(settings.productivity?.weekStart, locale)
  const week = useMemo(() => weekComparison(data, today, weekStart), [data, today, weekStart])
  const streak = useMemo(() => streaks(data, today), [data, today])
  if (settings.productivity?.enabled === false) return null
  const start = startOfWeek(today, weekStart)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const values = days.map(key => key <= today ? data.days[key]?.edits ?? 0 : 0)
  const max = Math.max(1, ...values)
  const n = (value: number) => value.toLocaleString(locale)
  const todayIndex = days.indexOf(today)
  const dayLetter = (key: string) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(`${key}T12:00:00`))
  return <button type="button" className="pd-home" onClick={() => actions.navigate({ type: 'productivity' })} aria-label={t('Esta semana: {w} palavras, {e} edições. Abrir Produtividade', 'This week: {w} words, {e} edits. Open Productivity', { w: n(week.current.words), e: n(week.current.edits) })}>
    <span className="pd-home-stats">
      <span className="pd-home-stat"><strong>{n(week.current.words)}</strong><span>{t('palavras', 'words')}</span></span>
      <span className="pd-home-stat"><strong>{n(week.current.edits)}</strong><span>{t('edições', 'edits')}</span></span>
      <span className="pd-home-stat"><strong>{n(week.current.tasks)}</strong><span>{t('tarefas', 'tasks')}</span></span>
      <span className="pd-home-stat"><strong>{n(streak.current)}</strong><span>{t('dias seguidos', 'day streak')}</span></span>
    </span>
    <span className="pd-home-week" aria-hidden>
      <span className="pd-home-bars">{values.map((value, i) => <i key={days[i]} className={`${value ? '' : 'is-zero'}${i === todayIndex ? ' is-today' : ''}`} style={{ height: `${Math.max(10, (value / max) * 100)}%` }} />)}</span>
      <span className="pd-home-days">{days.map((key, i) => <b key={key} className={i === todayIndex ? 'is-today' : ''}>{dayLetter(key)}</b>)}</span>
    </span>
    <span className="pd-home-link"><ProductivityIcon size={14} /> {t('Produtividade', 'Productivity')} <span aria-hidden>→</span></span>
  </button>
}
