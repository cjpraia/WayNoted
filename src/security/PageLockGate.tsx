// Gate for password-protected pages: asks for the page password before the editor (or the
// peek preview) mounts, and relocks when the user leaves the protected tree.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { actions, getState, useStore } from '../store'
import { t, getLocale } from '../i18n'
import { securityApi, securityMessage } from './api'
import { Button } from '../components/ui/Button'
import { sameProtectedTree, unprotectedDescendants } from './pageLock'
import './security.css'

export function PageLockGate({ pageId, peek, children }: { pageId: string; peek?: boolean; children: ReactNode }) {
  const page = useStore().pages[pageId]
  const api = securityApi()
  const lock = page?.passwordLock
  const unlocked = !!lock?.unlocked
  const rootId = lock?.rootId

  useEffect(() => {
    if (!api || !unlocked || !rootId) return
    let last = 0
    const ping = () => { const now = Date.now(); if (now - last > 30000) { last = now; void api.pageActivity(rootId).catch(() => {}) } }
    ping()
    const events = ['keydown', 'pointerdown', 'wheel'] as const
    events.forEach(name => window.addEventListener(name, ping, { passive: true, capture: true }))
    return () => {
      events.forEach(name => window.removeEventListener(name, ping, { capture: true }))
      // Leaving the protected tree relocks it once pending edits are saved.
      setTimeout(() => {
        const state = getState()
        const current = state.route.type === 'page' ? state.pages[state.route.id] : undefined
        const peeked = state.peekPageId ? state.pages[state.peekPageId] : undefined
        if (sameProtectedTree(current, rootId) || sameProtectedTree(peeked, rootId)) return
        void actions.flushAll().then(() => api.pageRelock(rootId)).catch(actions.reportSaveError)
      }, 400)
    }
  }, [unlocked, rootId])

  if (api && lock && unlocked && lock.inherit && !peek) return <><LooseChildrenNotice pageId={pageId} rootId={lock.rootId} />{children}</>
  if (!api || !lock || unlocked) return <>{children}</>
  const prompt = <LockedPrompt pageId={pageId} title={page.title} />
  if (!peek) return <div className="sec-page">{prompt}</div>
  return <div className="sec-overlay" onMouseDown={event => { if (event.target === event.currentTarget) actions.closePeek() }}><div className="sec-dialog">{prompt}</div></div>
}

function LockedPrompt({ pageId, title }: { pageId: string; title: string }) {
  const api = securityApi()!
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { void api.pageLockHint?.(pageId).then(setHint).catch(() => setHint(null)) }, [pageId])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password) return
    setBusy(true); setError('')
    try { await api.pageUnlock(pageId, password); setPassword('') }
    catch (cause) { setError(securityMessage(cause, getLocale())); input.current?.focus(); input.current?.select() }
    finally { setBusy(false) }
  }
  return (
    <form className="sec-card" onSubmit={event => void submit(event)} aria-label={t('Página protegida por senha', 'Password-protected page')}>
      <div className="sec-badge" aria-hidden><Lock size={24} strokeWidth={1.6} /></div>
      <h2>{title || t('Página protegida', 'Protected page')}</h2>
      <p>{t('Esta página está protegida por senha. O conteúdo fica cifrado até você desbloqueá-la.', 'This page is password protected. Its content stays encrypted until you unlock it.')}</p>
      <div className="sec-form">
        <input ref={input} className="sec-input" type="password" autoComplete="off" aria-label={t('Senha da página', 'Page password')} placeholder={t('Senha da página', 'Page password')} value={password} onChange={event => { setPassword(event.target.value); setError('') }} readOnly={busy} />
        <div className="sec-error" role="alert">{error}</div>
        <Button variant="primary" type="submit" disabled={busy || !password}>{busy ? t('Verificando…', 'Checking…') : t('Desbloquear página', 'Unlock page')}</Button>
      </div>
      <HintReveal hint={hint} shown={showHint} onShow={() => setShowHint(true)} label={t('Mostrar dica', 'Show hint')} title={t('Dica de senha', 'Password hint')} />
    </form>
  )
}

/** Hint hidden behind a link: never shown by default (someone may be looking at the screen). */
export function HintReveal({ hint, shown, onShow, label, title }: { hint: string | null; shown: boolean; onShow: () => void; label: string; title: string }) {
  if (!hint) return null
  if (!shown) return <Button variant="ghost" className="sec-hint-link" type="button" onClick={onShow}>{label}</Button>
  return <p className="sec-hint-text" role="note"><strong>{title}:</strong> {hint}</p>
}

/** Repair for subpages created before inheritance existed: offer to protect them. */
function LooseChildrenNotice({ pageId, rootId }: { pageId: string; rootId: string }) {
  const pages = useStore().pages
  const [busy, setBusy] = useState(false)
  const loose = unprotectedDescendants(pages, pageId)
  if (!loose.length) return null
  const protect = async () => {
    setBusy(true)
    try { await actions.flushAll(); await securityApi()!.pageProtectChildren(rootId, loose.map(page => page.id)) }
    catch (cause) { actions.reportSaveError(new Error(securityMessage(cause, getLocale()))) }
    finally { setBusy(false) }
  }
  return <div className="sec-notice" role="status">
    <span>{t('{n} subpágina(s) desta página protegida não têm senha e aparecem na busca e nas exportações.', '{n} subpage(s) of this protected page have no password and appear in search and exports.', { n: loose.length })}</span>
    <Button variant="ghost" type="button" disabled={busy} onClick={() => void protect()}>{t('Proteger subpáginas não protegidas ({n})', 'Protect unprotected subpages ({n})', { n: loose.length })}</Button>
  </div>
}
