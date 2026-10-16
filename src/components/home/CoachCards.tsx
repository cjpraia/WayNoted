// Cartões de "começar bem" no Meu dia: Continuar, Primeiros passos, Você sabia?, Sua semana.
// Um único destaque primário por tela (Von Restorff): aqui só "Continuar" usa o estilo primário; o resto é neutro.
import { useMemo, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import type { QuickCaptureBridge } from '../../quick/types'
import { useI18n } from '../../i18n'
import { PageIcon } from '../page/PageIcon'
import { Icon } from '../ui/icons/Icon'
import { protectedAncestor } from '../../security/pageLock'
import { pickResume } from '../../onboarding/resume'
import { STEPS, checklistVisible, onboardingProgress, pickTip } from '../../onboarding/model'
import { weekReviewDue } from '../../onboarding/day'
import { dismissOnboarding, dismissTip, planNextWeek, setTipsOff, skipWeekReview } from '../../onboarding/actions'
import { resolveWeekStart, streaks, weekComparison } from '../../activity/stats'
import { useProductivityData } from '../../activity/session'
import { showToast } from '../ui/toastQueue'
import { Button } from '../ui/Button'
import './coach.css'

/** Retomada: o hook devolve o alvo único; o componente desenha. */
export function useResumeTarget() {
  const { settings, pages } = useStore()
  const recent = settings.recent
  return useMemo(() => pickResume(settings.onboarding?.resume, recent, pages, id => !!protectedAncestor(pages, id)), [settings.onboarding?.resume, recent, pages])
}

function ago(ts: number, tr: ReturnType<typeof useI18n>['t']): string {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000))
  if (minutes < 1) return tr('agora mesmo', 'just now')
  if (minutes < 60) return tr('há {n} min', '{n} min ago', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tr('há {n} h', '{n} h ago', { n: hours })
  const days = Math.floor(hours / 24)
  return days === 1 ? tr('ontem', 'yesterday') : tr('há {n} dias', '{n} days ago', { n: days })
}

export function ContinueCard({ target, pendingCapture }: { target: NonNullable<ReturnType<typeof useResumeTarget>>; pendingCapture: boolean }) {
  const { t } = useI18n()
  const page = selectors.page(target.pageId)
  const title = target.title || t('Sem título', 'Untitled')
  return <section className="co-continue" aria-labelledby="co-continue-title">
    <span className="co-continue-icon" aria-hidden><PageIcon value={target.icon} fallback={page?.database ? 'database' : 'page'} style={{ width: 20, height: 20 }} /></span>
    <div className="co-continue-text">
      <p className="co-eyebrow" id="co-continue-title">{t('Continuar de onde parou', 'Pick up where you left off')} · {ago(target.at, t)}</p>
      <strong className="co-continue-name">{title}</strong>
      {target.excerpt && <span className="co-continue-excerpt">{target.excerpt}</span>}
    </div>
    <div className="co-continue-actions">
      <Button variant="primary" onClick={() => actions.openPage(target.pageId, target.blockId ? { blockId: target.blockId } : {})}>{t('Continuar', 'Continue')} <ArrowRight size={14} strokeWidth={1.75} /></Button>
      {pendingCapture && <button type="button" className="co-link" onClick={() => void (api as unknown as QuickCaptureBridge).showQuickCapture?.()}>{t('Você tem uma captura em rascunho', 'You have a capture draft')}</button>}
    </div>
  </section>
}

export function OnboardingCard() {
  const { settings } = useStore()
  const { t } = useI18n()
  const state = settings.onboarding
  if (!checklistVisible(state)) return null
  const { done, total } = onboardingProgress(state)
  const act: Partial<Record<string, () => void>> = {
    page: () => actions.openPage(actions.createPage(null)),
    search: () => actions.setSearchOpen(true),
    database: () => actions.openPage(actions.createDatabase(null)),
  }
  return <section className="co-card" aria-labelledby="co-first-title">
    <header className="co-card-head">
      <h2 className="hm-section-title" id="co-first-title">{t('Primeiros passos', 'Getting started')}</h2>
      <span className="co-count">{t('{done} de {total}', '{done} of {total}', { done, total })}</span>
      <Button variant="ghost" className="co-card-action" onClick={() => { dismissOnboarding(); showToast({ message: t('Primeiros passos dispensado. Reabra em Configurações → Ajuda.', 'Getting started dismissed. Reopen it in Settings → Help.') }) }}>{t('Dispensar', 'Dismiss')}</Button>
    </header>
    <div className="co-bar" role="progressbar" aria-label={t('Progresso dos primeiros passos', 'Getting started progress')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: `${(done / total) * 100}%` }} /></div>
    <ul className="co-steps">
      {STEPS.map(step => {
        const ok = !!state?.done?.[step.id]
        const run = act[step.id]
        return <li key={step.id} className={ok ? 'is-done' : ''}>
          <span className="co-check" aria-hidden>{ok && <Check size={12} strokeWidth={2.5} />}</span>
          {run && !ok ? <button type="button" className="co-step-btn" onClick={run}>{t(step.pt, step.en)}</button> : <span>{t(step.pt, step.en)}</span>}
          {step.keys && <kbd>{step.keys}</kbd>}
          <span className="co-sr">{ok ? t('feito', 'done') : t('a fazer', 'to do')}</span>
        </li>
      })}
    </ul>
    <p className="co-note" data-ot="native-types-note">{t('Pessoa, Projeto, Reunião, Tarefa, Livro, Ideia, Recurso e Empresa já estão prontos na barra lateral, em Tipos.', 'Person, Project, Meeting, Task, Book, Idea, Resource and Company are ready in the sidebar, under Types.')}</p>
  </section>
}

/** Uma dica por sessão: a primeira escolhida fica registrada; depois de dispensada, nenhuma outra aparece até reabrir o app. */
let sessionTip: string | null = null
export function TipLine() {
  const { settings } = useStore()
  const { t } = useI18n()
  const [hidden, setHidden] = useState(false)
  const tip = useMemo(() => {
    const picked = checklistVisible(settings.onboarding) ? null : pickTip(settings.onboarding, false)
    if (!picked) return null
    if (sessionTip && sessionTip !== picked.id) return null
    sessionTip = picked.id
    return picked
  }, [settings.onboarding])
  // Um assunto por vez (Hick): com os Primeiros passos à vista, a dica espera.
  if (!tip || hidden || checklistVisible(settings.onboarding)) return null
  return <p className="co-tip" role="note"><span><strong>{t('Você sabia?', 'Did you know?')}</strong> {t(tip.pt, tip.en)}</span>
    <Button variant="ghost" className="co-card-action" onClick={() => { setHidden(true); dismissTip(tip.id) }}>{t('Entendi', 'Got it')}</Button>
    <Button variant="ghost" className="co-card-action" onClick={() => { setHidden(true); setTipsOff(true) }}>{t('Não mostrar mais', 'Don’t show again')}</Button>
  </p>
}

export function WeekReviewCard({ today }: { today: string }) {
  const { settings } = useStore()
  const { locale, t } = useI18n()
  const { data } = useProductivityData()
  const [choosing, setChoosing] = useState(false)
  const [values, setValues] = useState(['', '', ''])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const weekStart = resolveWeekStart(settings.productivity?.weekStart, locale)
  const week = useMemo(() => weekComparison(data, today, weekStart), [data, today, weekStart])
  const streak = useMemo(() => streaks(data, today), [data, today])
  if (!weekReviewDue(today, settings.onboarding?.weekReviewed)) return null
  const n = (value: number) => value.toLocaleString(locale)
  const save = async () => {
    setBusy(true); setError('')
    try {
      const id = await planNextWeek(values, today)
      if (id) showToast({ message: t('Prioridades criadas na nota de segunda.', 'Priorities added to Monday’s note.'), actionLabel: t('Abrir', 'Open'), onAction: () => actions.openPage(id) })
      setChoosing(false)
    } catch { setError(t('Não consegui criar as tarefas agora. Seus textos continuam aqui; tente de novo.', 'I could not create the tasks right now. Your text is still here; try again.')) }
    finally { setBusy(false) }
  }
  return <section className="co-card" aria-labelledby="co-week-title">
    <header className="co-card-head">
      <h2 className="hm-section-title" id="co-week-title">{t('Sua semana', 'Your week')}</h2>
      <Button variant="ghost" className="co-card-action" onClick={() => skipWeekReview(today)}>{t('Agora não', 'Not now')}</Button>
    </header>
    <p className="co-week-stats">{t('{w} palavras · {e} edições · {k} tarefas · {s} dias seguidos', '{w} words · {e} edits · {k} tasks · {s} day streak', { w: n(week.current.words), e: n(week.current.edits), k: n(week.current.tasks), s: n(streak.current) })}</p>
    {!choosing ? <Button onClick={() => setChoosing(true)}><Icon name="plus" size={14} /> {t('Escolher 3 prioridades da próxima semana', 'Choose 3 priorities for next week')}</Button>
      : <form className="co-priorities" onSubmit={event => { event.preventDefault(); void save() }}>
        {values.map((value, i) => <input key={i} value={value} autoFocus={i === 0} maxLength={120} aria-label={t('Prioridade {n}', 'Priority {n}', { n: i + 1 })} placeholder={t('Prioridade {n}', 'Priority {n}', { n: i + 1 })} onChange={event => setValues(list => list.map((item, j) => j === i ? event.target.value : item))} />)}
        <div className="co-row"><Button type="submit" variant="primary" disabled={busy || !values.some(v => v.trim())}>{t('Criar na nota de segunda', 'Add to Monday’s note')}</Button>
          <Button variant="ghost" className="co-card-action" onClick={() => setChoosing(false)}>{t('Cancelar', 'Cancel')}</Button></div>
        {error && <p className="co-error" role="alert">{error}</p>}
      </form>}
  </section>
}
