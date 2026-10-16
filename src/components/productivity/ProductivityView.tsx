// Tela "Produtividade": estatísticas locais de escrita e edição (src/activity, docs/USAGE.md).
import { useMemo, useState } from 'react'
import { BookOpen, Database, FileText, Settings2, X } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { requestSettingsSection } from '../../quick/QuickCaptureSettings'
import { protectedAncestor } from '../../security/pageLock'
import { summarize, streaks, weekComparison, topPageIds, workedLists, resolveWeekStart, METRICS, type Metric, type Period } from '../../activity/stats'
import { bookSentence } from '../../activity/books'
import { cancelBackfill, useBackfillStatus, useProductivityData } from '../../activity/session'
import { productivity } from '../../store'
import { Heatmap, metricLabel } from './Heatmap'
import { PageIcon } from '../page/PageIcon'
import { ProductivityIcon } from './ProductivityIcon'
import type { Page } from '../../types'
import './productivity.css'

export function openProductivitySettings() { requestSettingsSection('productivity'); actions.setSettingsOpen(true) }

function GoalRing({ value, goal, label }: { value: number; goal: number; label: string }) {
  const ratio = Math.min(1, value / goal), r = 22, c = 2 * Math.PI * r
  return <div className="pd-goal" role="img" aria-label={label}>
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r={r} className="pd-goal-track" />
      {ratio > 0 && <circle cx="28" cy="28" r={r} className="pd-goal-value" strokeDasharray={`${ratio * c} ${c}`} transform="rotate(-90 28 28)" />}
    </svg>
    <span className="pd-goal-pct">{Math.round(ratio * 100)}%</span>
  </div>
}

export function ProductivityView() {
  const { settings, pages } = useStore()
  const { locale, t } = useI18n()
  const { data, loaded } = useProductivityData()
  const backfill = useBackfillStatus()
  const [tab, setTab] = useState<'overview' | 'pages'>('overview')
  const [period, setPeriod] = useState<Period>('all')
  const [metric, setMetric] = useState<Metric>('words')
  const today = productivity.today()
  const enabled = settings.productivity?.enabled !== false
  const goal = settings.productivity?.dailyGoal ?? 0
  const weekStart = resolveWeekStart(settings.productivity?.weekStart, locale)
  const summary = useMemo(() => summarize(data, period, today), [data, period, today])
  const streak = useMemo(() => streaks(data, today), [data, today])
  const week = useMemo(() => weekComparison(data, today, weekStart), [data, today, weekStart])
  const worked = useMemo(() => workedLists(topPageIds(data, period, today), pages, id => selectors.isLive(id) && !protectedAncestor(pages, id)), [data, period, today, pages])
  const n = (value: number) => value.toLocaleString(locale)
  const compact = (value: number) => value >= 10000 ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value) : n(value)
  const hourName = (hour: number) => locale.startsWith('pt') ? `${hour}h` : new Date(2024, 0, 1, hour).toLocaleTimeString(locale, { hour: 'numeric' })
  const weekdayName = (day: number) => { const name = new Date(Date.UTC(2024, 0, 7 + day)).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' }); return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) }
  const todayWords = data.days[today]?.words ?? 0
  const sentence = bookSentence(summary.words, locale)
  const periods: [Period, string][] = [['all', t('Tudo', 'All')], ['30d', '30d'], ['7d', '7d'], ['today', t('Hoje', 'Today')]]
  const maxHour = Math.max(1, ...summary.hours)
  const title = (page: Page) => page.title || (page.database ? t('Sem título', 'Untitled') : t('Nova página', 'New page'))

  const cards: { id: string; label: string; value: string; hint?: string }[] = [
    { id: 'words', label: t('Palavras escritas', 'Words written'), value: compact(summary.words) },
    { id: 'edits', label: t('Edições', 'Edits'), value: compact(summary.edits), hint: t('{n} sessões', '{n} sessions', { n: n(summary.sessions) }) },
    { id: 'created', label: t('Páginas criadas', 'Pages created'), value: compact(summary.created) },
    { id: 'tasks', label: t('Tarefas concluídas', 'Tasks completed'), value: compact(summary.tasks) },
    { id: 'active', label: t('Dias ativos', 'Active days'), value: n(summary.activeDays) },
    { id: 'streak', label: t('Sequência atual / maior', 'Current / longest streak'), value: `${n(streak.current)} / ${n(streak.longest)}`, hint: t('dias seguidos', 'days in a row') },
    { id: 'peak', label: t('Horário de pico', 'Peak hour'), value: summary.peakHour === null ? '—' : hourName(summary.peakHour) },
    { id: 'weekday', label: t('Dia mais ativo', 'Most active day'), value: summary.busiestWeekday === null ? '—' : weekdayName(summary.busiestWeekday) },
  ]

  return <div className="pd-root">
    <div className="pd-inner">
      <header className="pd-header">
        <h1 className="pd-title"><ProductivityIcon size={26} /> {t('Produtividade', 'Productivity')}</h1>
        <p className="pd-sub">{t('Tudo fica neste computador; só contadores, nunca o conteúdo.', 'Everything stays on this computer; only counters, never your content.')}</p>
        <button type="button" className="pd-ghost" onClick={openProductivitySettings}><Settings2 size={14} /> {t('Ajustes', 'Settings')}</button>
      </header>

      {!enabled && <div className="pd-panel pd-off" role="status">
        <strong>{t('O registro de atividade está desligado.', 'Activity tracking is off.')}</strong>
        <span>{t('Nada novo é contado. Os números abaixo são do que já estava registrado.', 'Nothing new is counted. The numbers below are what was already recorded.')}</span>
        <button type="button" className="pd-btn" onClick={() => actions.updateSettings({ productivity: { ...settings.productivity, enabled: true } })}>{t('Ligar registro', 'Turn on tracking')}</button>
      </div>}

      <div className="pd-panel">
        <div className="pd-bar">
          <div className="pd-seg" role="tablist" aria-label={t('Seções', 'Sections')}>
            <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-on' : ''} onClick={() => setTab('overview')}>{t('Visão geral', 'Overview')}</button>
            <button type="button" role="tab" aria-selected={tab === 'pages'} className={tab === 'pages' ? 'is-on' : ''} onClick={() => setTab('pages')}>{t('Páginas e bancos', 'Pages & databases')}</button>
          </div>
          <div className="pd-seg" role="group" aria-label={t('Período', 'Period')}>
            {periods.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} className={period === id ? 'is-on' : ''} onClick={() => setPeriod(id)}>{label}</button>)}
          </div>
        </div>

        {backfill.running && <div className="pd-note" role="status">
          <span>{t('Reconstruindo o histórico anterior a partir de datas e versões… {done}/{total}', 'Rebuilding earlier history from dates and versions… {done}/{total}', { done: backfill.done, total: backfill.total })}</span>
          <button type="button" className="pd-icon-btn" onClick={cancelBackfill} aria-label={t('Cancelar reconstrução', 'Cancel rebuild')}><X size={14} /></button>
        </div>}
        {!loaded && <div className="pd-note" role="status">{t('Carregando…', 'Loading…')}</div>}

        {tab === 'overview' ? <>
          <div className="pd-cards">
            {cards.map(card => <div key={card.id} className="pd-card" data-card={card.id}>
              <span className="pd-card-label">{card.label}</span>
              <span className="pd-card-value">{card.value}</span>
              {card.hint && <span className="pd-card-hint">{card.hint}</span>}
            </div>)}
          </div>
          {summary.estimatedDays > 0 && <p className="pd-est">{t('Inclui {n} dias de histórico anterior estimado (reconstruído de datas e versões).', 'Includes {n} days of estimated earlier history (rebuilt from dates and versions).', { n: n(summary.estimatedDays) })}</p>}

          <Heatmap data={data} today={today} weekStart={weekStart} locale={locale} metric={metric} onMetric={setMetric} />

          <div className="pd-two">
            <section className="pd-box" aria-labelledby="pd-hours-title">
              <h2 id="pd-hours-title" className="pd-h2">{t('Edições por horário', 'Edits by hour')}</h2>
              <div className="pd-hours" role="img" aria-label={summary.peakHour === null ? t('Sem edições no período', 'No edits in this period') : t('Pico às {hour}', 'Peak at {hour}', { hour: hourName(summary.peakHour) })}>
                {summary.hours.map((count, hour) => <span key={hour} className={`pd-hour${hour === summary.peakHour ? ' is-peak' : ''}`} title={`${hourName(hour)} · ${t('{n} edições', '{n} edits', { n: n(count) })}`}>
                  <i style={{ height: `${Math.max(count ? 6 : 2, (count / maxHour) * 100)}%` }} />
                </span>)}
              </div>
              <div className="pd-hours-axis" aria-hidden><span>{hourName(0)}</span><span>{hourName(6)}</span><span>{hourName(12)}</span><span>{hourName(18)}</span><span>{hourName(23)}</span></div>
            </section>
            <section className="pd-box" aria-labelledby="pd-week-title">
              <div className="pd-week-head">
                <h2 id="pd-week-title" className="pd-h2">{t('Esta semana × anterior', 'This week vs. last')}</h2>
                {goal > 0 && <GoalRing value={todayWords} goal={goal} label={t('Meta de hoje: {value} de {goal} palavras', "Today's goal: {value} of {goal} words", { value: n(todayWords), goal: n(goal) })} />}
              </div>
              <table className="pd-week">
                <thead><tr><th scope="col"><span className="pd-sr">{t('Métrica', 'Metric')}</span></th><th scope="col">{t('Esta', 'This')}</th><th scope="col">{t('Anterior', 'Last')}</th><th scope="col">%</th></tr></thead>
                <tbody>{METRICS.map(m => {
                  const delta = week.change[m]
                  return <tr key={m}><th scope="row">{metricLabel(m)}</th><td>{n(week.current[m])}</td><td>{n(week.previous[m])}</td>
                    <td className={delta === null ? 'pd-muted' : delta >= 0 ? 'pd-up' : 'pd-down'}>{delta === null ? (week.current[m] ? t('novo', 'new') : '—') : `${delta > 0 ? '+' : ''}${delta}%`}</td></tr>
                })}</tbody>
              </table>
              {goal > 0 ? <p className="pd-muted pd-small">{t('Hoje: {value} de {goal} palavras (meta opcional).', 'Today: {value} of {goal} words (optional goal).', { value: n(todayWords), goal: n(goal) })}</p>
                : <button type="button" className="pd-link" onClick={openProductivitySettings}>{t('Definir uma meta diária (opcional)', 'Set a daily goal (optional)')}</button>}
            </section>
          </div>
          {sentence && <p className="pd-fun"><BookOpen size={14} aria-hidden /> {sentence}</p>}
        </> : <div className="pd-two">
          {([['pages', t('Páginas mais trabalhadas', 'Most worked pages'), worked.pages, FileText], ['databases', t('Bancos mais trabalhados', 'Most worked databases'), worked.databases, Database]] as const).map(([id, heading, list, Icon]) => <section key={id} className="pd-box" aria-labelledby={`pd-${id}-title`}>
            <h2 id={`pd-${id}-title`} className="pd-h2"><Icon size={14} aria-hidden /> {heading}</h2>
            {list.length ? <ol className="pd-list">{list.map(({ page, words, edits }) => <li key={page.id}>
              <button type="button" onClick={e => e.metaKey || e.ctrlKey ? actions.openInNewTab({ type: 'page', id: page.id }) : actions.openPage(page.id)}>
                <span className="pd-list-icon">{page.icon ? <PageIcon value={page.icon} style={{ width: 16, height: 16, fontSize: 15 }} /> : <Icon size={16} aria-hidden />}</span>
                <span className="pd-list-title">{title(page)}</span>
                <span className="pd-list-meta">{t('{w} palavras · {e} edições', '{w} words · {e} edits', { w: n(words), e: n(edits) })}</span>
              </button>
            </li>)}</ol> : <p className="pd-muted pd-small">{t('Nada no período ainda.', 'Nothing in this period yet.')}</p>}
          </section>)}
          <p className="pd-muted pd-small pd-span">{t('Páginas protegidas por senha contam nos totais, mas nunca aparecem aqui. Linhas de banco somam no banco.', 'Password-protected pages count in the totals but never appear here. Database rows add up to their database.')}</p>
        </div>}
      </div>
    </div>
  </div>
}
