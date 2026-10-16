// Sessão de revisão em tela cheia: frente → Espaço → verso → notas 1–4 (De novo, Difícil, Bom, Fácil).
// Teclado: Espaço/Enter mostra a resposta, 1–4 dá a nota, ⌘Z desfaz a última nota, Esc encerra.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, RotateCcw, X } from 'lucide-react'
import { t, useI18n } from '../i18n'
import { PageIcon } from '../components/page/PageIcon'
import { Button } from '../components/ui/Button'
import { ProgressBar } from '../components/ui/ProgressBar'
import { getState } from '../store'
import { intervalLabel, scheduleAll, type Grade } from './fsrs'
import { paramsOf, reviewStats, type CardKey, type UndoEntry } from './reviewCore'
import { cardContent, openCardSource, rateCard, reviewSettings, undoRate, type CardContent } from './reviewActions'
import './review.css'

interface Step { entry: UndoEntry; queue: CardKey[]; done: number }

export const GRADES: { grade: Grade; pt: string; en: string }[] = [
  { grade: 1, pt: 'De novo', en: 'Again' },
  { grade: 2, pt: 'Difícil', en: 'Hard' },
  { grade: 3, pt: 'Bom', en: 'Good' },
  { grade: 4, pt: 'Fácil', en: 'Easy' },
]

export function ReviewSession({ keys, onClose, now = () => Date.now() }: { keys: CardKey[]; onClose(): void; now?: () => number }) {
  const { locale } = useI18n()
  const [queue, setQueue] = useState<CardKey[]>(keys)
  const [done, setDone] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [content, setContent] = useState<CardContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const history = useRef<Step[]>([])
  const total = useRef(keys.length)
  const [, force] = useState(0)
  const current = queue[0]

  useEffect(() => {
    if (!current) { setContent(null); setLoading(false); return }
    let alive = true
    setLoading(true); setRevealed(false)
    void cardContent(current).then(value => {
      if (!alive) return
      if (!value) { setQueue(list => list.slice(1)); total.current = Math.max(0, total.current - 1); return }
      setContent(value); setLoading(false)
    }).catch(() => { if (alive) { setError(t('Não foi possível ler este cartão.', 'Could not read this card.')); setLoading(false) } })
    return () => { alive = false }
  }, [current])

  const card = current ? reviewSettings().cards?.[current] : undefined
  const options = useMemo(() => (card ? scheduleAll(card, now(), paramsOf(reviewSettings())) : null), [card]) // eslint-disable-line react-hooks/exhaustive-deps

  const rate = useCallback((grade: Grade) => {
    if (!current || !revealed) return
    const entry = rateCard(current, grade, now())
    if (!entry) { setQueue(list => list.slice(1)); return }
    history.current.push({ entry, queue, done })
    const rest = queue.slice(1)
    if (grade === 1) { rest.splice(Math.min(rest.length, 3), 0, current); setQueue(rest) }
    else { setQueue(rest); setDone(value => value + 1) }
    force(value => value + 1)
  }, [current, revealed, queue, done, now])

  const undo = useCallback(() => {
    const step = history.current.pop()
    if (!step) return
    undoRate(step.entry)
    setQueue(step.queue); setDone(step.done); setRevealed(false); force(value => value + 1)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!revealed && current && !loading) setRevealed(true); return }
      if (['1', '2', '3', '4'].includes(event.key)) { event.preventDefault(); if (revealed) rate(Number(event.key) as Grade) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [revealed, current, loading, rate, undo, onClose])

  const finished = !current
  const stats = finished ? reviewStats(getState().settings.review, now()) : null
  const fraction = total.current ? done / total.current : 1
  const pending = Math.max(0, total.current - done)

  const view = <div className="rv-overlay" role="dialog" aria-modal="true" aria-label={t('Sessão de revisão', 'Review session')}>
    <header className="rv-top">
      <div className="rv-progress"><ProgressBar value={fraction} label={t('{done} de {total} revisados', '{done} of {total} reviewed', { done, total: total.current })} /></div>
      <Button variant="ghost" onClick={undo} disabled={!history.current.length} title={`${t('Desfazer a última nota', 'Undo the last rating')} (⌘Z)`}><RotateCcw size={14} aria-hidden /> {t('Desfazer', 'Undo')}</Button>
      <Button variant="ghost" onClick={onClose} aria-label={t('Encerrar revisão', 'End review')} title="Esc"><X size={14} aria-hidden /> {t('Encerrar', 'End')}</Button>
    </header>
    <main className="rv-stage">
      {error && <p className="rv-error" role="alert">{error}</p>}
      {finished ? <section className="rv-done" aria-live="polite">
        <h2 className="np-display">{done ? t('Sessão concluída', 'Session complete') : t('Nada para revisar agora', 'Nothing to review right now')}</h2>
        <p>{t('{n} cartões revisados nesta sessão.', '{n} cards reviewed this session.', { n: done })}</p>
        {stats && <dl className="rv-stats">
          <div><dt>{t('Hoje', 'Today')}</dt><dd>{stats.today}</dd></div>
          <div><dt>{t('Retenção (30 dias)', 'Retention (30 days)')}</dt><dd>{stats.retention === null ? '—' : `${stats.retention}%`}</dd></div>
          <div><dt>{t('Sequência', 'Streak')}</dt><dd>{t('{n} dias', '{n} days', { n: stats.streak })}</dd></div>
        </dl>}
        <Button variant="primary" onClick={onClose}>{t('Fechar', 'Close')}</Button>
      </section> : <section className="rv-card" aria-live="polite" aria-busy={loading}>
        {content && <>
          <div className="rv-meta">
            <PageIcon value={content.icon} fallback="page" style={{ width: 16, height: 16 }} />
            <span className="rv-source">{content.title}</span>
            <span className="rv-count">{t('{n} restantes', '{n} left', { n: pending })}</span>
            <Button variant="ghost" onClick={() => { openCardSource(content.key); onClose() }} title={t('Abrir a página', 'Open the page')}><ExternalLink size={14} aria-hidden /> {t('Abrir', 'Open')}</Button>
          </div>
          <div className="rv-front np-display" data-test="rv-front">{content.front}</div>
          {revealed ? <div className="rv-back" data-test="rv-back">{content.back || t('(Sem conteúdo)', '(No content)')}</div>
            : <Button variant="primary" className="rv-reveal" onClick={() => setRevealed(true)}>{t('Mostrar resposta', 'Show answer')} <kbd>{t('Espaço', 'Space')}</kbd></Button>}
        </>}
      </section>}
    </main>
    {!finished && <footer className="rv-grades" role="group" aria-label={t('Nota', 'Rating')}>
      {GRADES.map(({ grade, pt, en }) => <Button key={grade} className={`rv-grade rv-grade--${grade}`} disabled={!revealed || !options} aria-keyshortcuts={String(grade)} onClick={() => rate(grade)}>
        <span className="rv-grade-label">{t(pt, en)}</span>
        <span className="rv-grade-when">{options ? intervalLabel(options[grade].days, locale) : ''}</span>
        <kbd>{grade}</kbd>
      </Button>)}
    </footer>}
  </div>
  return typeof document === 'undefined' ? view : createPortal(view, document.body)
}
