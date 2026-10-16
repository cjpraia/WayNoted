// Tela "Revisão" (rota `review`) e cartão "Para revisar hoje" do Meu dia.
import { useEffect, useMemo, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { actions, getState } from '../store'
import { t, useI18n } from '../i18n'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { forecast, queueOrder, reviewStats, splitKey, DEFAULT_NEW_PER_DAY } from './reviewCore'
import { currentQueue, reviewSettings, setPageCard, syncToggleCards, updateReviewPrefs, useReviewVersion } from './reviewActions'
import { ReviewSession } from './ReviewSession'
import './review.css'

/** Cartões que as chaves apontam, com título legível. */
function titleOf(key: string): string {
  const { pageId, blockId } = splitKey(key)
  const page = getState().pages[pageId]
  return `${page?.title || t('Sem título', 'Untitled')}${blockId ? ` · ${t('bloco', 'block')}` : ''}`
}

export function useReviewSession() {
  const [keys, setKeys] = useState<string[] | null>(null)
  const start = () => { const queue = currentQueue(); const list = queueOrder(queue); if (list.length) setKeys(list) }
  const session = keys ? <ReviewSession keys={keys} onClose={() => setKeys(null)} /> : null
  return { start, session, open: !!keys }
}

export function ReviewHomeCard() {
  const settings = useReviewVersion()
  useEffect(() => { void syncToggleCards().catch(() => {}) }, [])
  const { start, session } = useReviewSession()
  const total = Object.keys(settings?.cards ?? {}).length
  if (!total) return null
  const queue = currentQueue()
  return <section className="hm-section rv-home" aria-labelledby="hm-review-title">
    <h2 className="hm-section-title" id="hm-review-title">{t('Para revisar hoje', 'To review today')}
      <span className="tk-card-counts"><span className="tk-badge">{t('{n} cartões', '{n} cards', { n: queue.total })}</span></span>
    </h2>
    <div className="tk-card-body">
      {queue.total ? <p className="rv-home-text">{t('{due} para rever e {fresh} novos. Leva poucos minutos.', '{due} to revisit and {fresh} new. It takes a few minutes.', { due: queue.due.length, fresh: queue.fresh.length })}</p>
        : <p className="tk-card-empty">{t('Tudo em dia. Nada vence hoje.', 'All caught up. Nothing is due today.')}</p>}
      <div className="tk-card-actions">
        <Button variant="primary" disabled={!queue.total} onClick={start}><GraduationCap size={14} aria-hidden /> {t('Revisar agora', 'Review now')}</Button>
        <Button variant="ghost" onClick={() => actions.navigate({ type: 'review' })}>{t('Abrir Revisão', 'Open Review')}</Button>
      </div>
    </div>
    {session}
  </section>
}

export function ReviewView() {
  const settings = useReviewVersion()
  const { locale } = useI18n()
  useEffect(() => { void syncToggleCards().catch(() => {}) }, [])
  const { start, session } = useReviewSession()
  const now = Date.now()
  const queue = currentQueue(now)
  const stats = reviewStats(settings, now)
  const days = useMemo(() => forecast(settings, now, 7), [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...days)
  const keys = Object.keys(settings?.cards ?? {}).sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  const weekday = (offset: number) => offset === 0 ? t('Hoje', 'Today') : new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(now + offset * 86_400_000))
  return <div className="tk-root">
    <div className="tk-inner">
      <header className="tk-header">
        <h1><GraduationCap size={22} aria-hidden /> {t('Revisão', 'Review')}</h1>
        <Button variant="primary" disabled={!queue.total} onClick={start}>{t('Começar revisão ({n})', 'Start review ({n})', { n: queue.total })}</Button>
      </header>
      <p className="rv-lead">{t('Revisão espaçada no seu Mac: cada página ou bloco de alternância marcado como cartão volta no momento certo. Nada sai daqui.', 'Spaced repetition on your Mac: every page or toggle block marked as a card comes back at the right time. Nothing leaves here.')}</p>
      <dl className="rv-stats" aria-label={t('Estatísticas', 'Statistics')}>
        <div><dt>{t('Hoje', 'Today')}</dt><dd>{stats.today}</dd></div>
        <div><dt>{t('Retenção (30 dias)', 'Retention (30 days)')}</dt><dd>{stats.retention === null ? '—' : `${stats.retention}%`}</dd></div>
        <div><dt>{t('Sequência', 'Streak')}</dt><dd>{t('{n} dias', '{n} days', { n: stats.streak })}</dd></div>
        <div><dt>{t('Cartões', 'Cards')}</dt><dd>{stats.total}</dd></div>
      </dl>
      <h2 className="rv-h">{t('Próximos 7 dias', 'Next 7 days')}</h2>
      <div className="rv-forecast" role="img" aria-label={t('Cartões por dia: {list}', 'Cards per day: {list}', { list: days.join(', ') })}>
        {days.map((count, offset) => <div key={offset} className="rv-bar"><span className="rv-bar-fill" style={{ height: `${Math.round((count / max) * 100)}%` }} /><span className="rv-bar-n">{count}</span><span className="rv-bar-d">{weekday(offset)}</span></div>)}
      </div>
      <h2 className="rv-h">{t('Ajustes', 'Settings')}</h2>
      <div className="rv-prefs">
        <label>{t('Novos por dia', 'New per day')} <Select value={String(settings?.newPerDay ?? DEFAULT_NEW_PER_DAY)} onChange={event => updateReviewPrefs({ newPerDay: Number(event.target.value) })}>
          {[5, 10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </Select></label>
        <label>{t('Retenção desejada', 'Desired retention')} <Select value={String(settings?.retention ?? 0.9)} onChange={event => updateReviewPrefs({ retention: Number(event.target.value) })}>
          {[0.8, 0.85, 0.9, 0.95].map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}
        </Select></label>
      </div>
      <h2 className="rv-h">{t('Cartões', 'Cards')} <span className="tk-badge">{keys.length}</span></h2>
      {!keys.length && <p className="tk-card-empty">{t('Nenhum cartão ainda. Abra uma página, escolha “Marcar como cartão de revisão” no menu ⋯ ou use “Blocos de alternância como cartões”.', 'No cards yet. Open a page, choose “Mark as review card” in the ⋯ menu, or use “Toggle blocks as cards”.')}</p>}
      <ul className="rv-list">
        {keys.slice(0, 200).map(key => {
          const card = settings!.cards![key]
          const due = card.phase === 'new' ? t('Novo', 'New') : new Date(card.due).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
          const { blockId } = splitKey(key)
          return <li key={key} className="rv-item">
            <button type="button" className="rv-item-main" onClick={() => actions.openPage(splitKey(key).pageId, blockId ? { blockId } : {})}>{titleOf(key)}</button>
            <span className="rv-item-due">{due}</span>
            {!blockId && <Button variant="ghost" onClick={() => setPageCard(key, false)}>{t('Remover', 'Remove')}</Button>}
          </li>
        })}
      </ul>
      {keys.length > 200 && <p className="tk-card-empty">{t('Mostrando 200 de {n}.', 'Showing 200 of {n}.', { n: keys.length })}</p>}
    </div>
    {session}
  </div>
}
