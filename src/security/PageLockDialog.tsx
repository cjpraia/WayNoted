// Protect a page with its own password, or manage/remove an existing protection.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useModalFocus } from '../a11y/useModalFocus'
import { actions, getState, useStore } from '../store'
import { t, getLocale } from '../i18n'
import { securityApi, securityMessage } from './api'
import { Button } from '../components/ui/Button'
import { MAX_HINT, passwordProblem, problemMessage } from './validation'
import { unprotectedDescendants } from './pageLock'
import './security.css'

const listeners = new Set<(pageId: string | null) => void>()
export function openPageLockDialog(pageId: string) { listeners.forEach(listener => listener(pageId)) }
export const pageLockAvailable = () => !!securityApi()

export function PageLockDialogHost() {
  const [pageId, setPageId] = useState<string | null>(null)
  useEffect(() => { listeners.add(setPageId); return () => { listeners.delete(setPageId) } }, [])
  if (!pageId) return null
  return <PageLockDialog pageId={pageId} onClose={() => setPageId(null)} />
}

function PageLockDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const page = useStore().pages[pageId]
  const api = securityApi()
  const lock = page?.passwordLock
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirmValue] = useState('')
  const [current, setCurrentValue] = useState('')
  const [hint, setHintValue] = useState('')
  const [hintLoaded, setHintLoaded] = useState(false)
  const [includeChildren, setIncludeChildren] = useState(true)
  const [hideTitle, setHideTitle] = useState(false)
  const [mode, setMode] = useState<'remove' | 'change'>('remove')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Errors returned by the main process are tied to the values that produced them: any edit clears them.
  const [error, setError] = useState('')
  const edit = (setter: (value: string) => void) => (value: string) => { setter(value); setError('') }
  const setPassword = edit(setPasswordValue), setConfirm = edit(setConfirmValue), setCurrent = edit(setCurrentValue), setHint = edit(setHintValue)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const dialogRef = useRef<HTMLFormElement>(null)
  useModalFocus(dialogRef)
  useEffect(() => {
    // Changing the password keeps the current hint editable (it is lock metadata, not secret).
    if (!lock || !api || mode !== 'change' || hintLoaded) return
    void api.pageLockHint(pageId).then(value => { setHintValue(value ?? ''); setHintLoaded(true) }).catch(() => setHintLoaded(true))
  }, [lock, mode, hintLoaded])
  if (!api || !page) return null
  const children = Object.values(getState().pages).filter(p => p.parentId === pageId && !p.trashed).length
  const isRoot = lock?.rootId === pageId
  const needsNewPassword = !lock || mode === 'change'
  const problem = needsNewPassword ? passwordProblem(password, confirm, hint) : null
  // Live message: shown once the user tried to submit or finished typing the confirmation.
  const liveMessage = problem && (submitted || (confirm.length >= password.length && confirm.length > 0) || problem === 'hintHasPassword' || problem === 'hintLong') ? problemMessage(problem, t) : ''
  const message = error || liveMessage

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await actions.flushAll(); await operation(); onClose() }
    catch (cause) { setError(securityMessage(cause, getLocale())) }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (problem) return
    if (!lock) void run(() => api.pageProtect(pageId, password, { includeChildren, hideTitle, hint }))
    else if (mode === 'remove') void run(() => api.pageUnprotect(lock.rootId, current))
    else void run(() => api.pageChangePassword(lock.rootId, current, password, { hint }))
  }
  const hintField = <>
    <input className="sec-input" type="text" maxLength={MAX_HINT + 20} autoComplete="off" spellCheck={false} aria-label={t('Dica de senha (opcional)', 'Password hint (optional)')} placeholder={t('Dica de senha (opcional)', 'Password hint (optional)')} value={hint} onChange={e => setHint(e.target.value)} aria-describedby="sec-hint-help" />
    <span id="sec-hint-help" className="sec-hint" style={{ textAlign: 'left' }}>{t('Aparece na tela de desbloqueio. Não escreva a senha aqui. Fica legível sem a senha, junto aos dados da proteção.', 'Shown on the unlock screen. Do not write the password here. It is readable without the password, next to the protection data.')}</span>
  </>

  return (
    <div className="sec-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form ref={dialogRef} className="sec-dialog" role="dialog" aria-modal="true" aria-labelledby="sec-page-title" onSubmit={submit} noValidate>
        <h2 id="sec-page-title">{lock ? t('Proteção por senha', 'Password protection') : t('Proteger página com senha', 'Protect page with a password')}</h2>
        {!lock && <>
          <p>{t('O conteúdo desta página (e do histórico) é cifrado com uma senha própria. Ela some da busca, das prévias, das exportações e da API local até ser desbloqueada.', 'This page’s content (and history) is encrypted with its own password. It disappears from search, previews, exports and the local API until unlocked.')}</p>
          <input className="sec-input" type="password" autoComplete="new-password" autoFocus aria-label={t('Senha da página', 'Page password')} placeholder={t('Senha (mín. 8 caracteres)', 'Password (min. 8 characters)')} value={password} onChange={e => setPassword(e.target.value)} />
          <input className="sec-input" type="password" autoComplete="new-password" aria-label={t('Confirmar senha', 'Confirm password')} placeholder={t('Confirmar senha', 'Confirm password')} value={confirm} onChange={e => setConfirm(e.target.value)} />
          {hintField}
          <label className="sec-check"><input type="checkbox" checked={includeChildren} onChange={e => setIncludeChildren(e.target.checked)} />{t('Incluir subpáginas atuais', 'Include current subpages')}{children ? ` (${children})` : ''}</label>
          <label className="sec-check"><input type="checkbox" checked={hideTitle} onChange={e => setHideTitle(e.target.checked)} />{t('Ocultar o título na barra lateral e na busca enquanto estiver trancada', 'Hide the title in the sidebar and search while locked')}</label>
          <div className="sec-warning">{t('Não há como recuperar esta senha. Se esquecê-la, o conteúdo da página fica inacessível.', 'This password cannot be recovered. If you forget it, the page content becomes inaccessible.')}</div>
        </>}
        {lock && <>
          <p>{isRoot ? t('Esta página está protegida por senha.', 'This page is password protected.') : t('Esta página faz parte de uma página protegida; a senha é a mesma.', 'This page belongs to a protected page; it uses the same password.')}</p>
          {lock.unlocked && (() => { const loose = unprotectedDescendants(getState().pages, lock.rootId); return loose.length ? <Button variant="ghost" type="button" style={{ justifyContent: 'flex-start' }} disabled={busy} onClick={() => void run(() => api.pageProtectChildren(lock.rootId))}>{t('Proteger subpáginas não protegidas ({n})', 'Protect unprotected subpages ({n})', { n: loose.length })}</Button> : null })()}
          {lock.unlocked && <label className="sec-check"><input type="checkbox" checked={lock.hideTitle} disabled={busy} onChange={e => void run(() => api.pageSetHideTitle(pageId, e.target.checked))} />{t('Ocultar o título enquanto estiver trancada', 'Hide the title while locked')}</label>}
          <div className="sec-row" style={{ justifyContent: 'flex-start' }} role="radiogroup">
            <label className="sec-check"><input type="radio" checked={mode === 'remove'} onChange={() => { setMode('remove'); setError(''); setSubmitted(false) }} />{t('Remover proteção', 'Remove protection')}</label>
            <label className="sec-check"><input type="radio" checked={mode === 'change'} onChange={() => { setMode('change'); setError(''); setSubmitted(false) }} />{t('Trocar senha', 'Change password')}</label>
          </div>
          <input className="sec-input" type="password" autoComplete="current-password" autoFocus aria-label={t('Senha atual', 'Current password')} placeholder={t('Senha atual', 'Current password')} value={current} onChange={e => setCurrent(e.target.value)} />
          {mode === 'change' && <>
            <input className="sec-input" type="password" autoComplete="new-password" aria-label={t('Nova senha', 'New password')} placeholder={t('Nova senha (mín. 8 caracteres)', 'New password (min. 8 characters)')} value={password} onChange={e => setPassword(e.target.value)} />
            <input className="sec-input" type="password" autoComplete="new-password" aria-label={t('Confirmar nova senha', 'Confirm new password')} placeholder={t('Confirmar nova senha', 'Confirm new password')} value={confirm} onChange={e => setConfirm(e.target.value)} />
            {hintField}
          </>}
          {mode === 'remove' && <span className="sec-hint" style={{ textAlign: 'left' }}>{t('A dica de senha também é removida.', 'The password hint is removed too.')}</span>}
        </>}
        <div className="sec-error" role="alert">{message}</div>
        <div className="sec-actions">
          {lock?.unlocked && <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => api.pageRelock(lock.rootId))}>{t('Trancar agora', 'Lock now')}</Button>}
          <Button variant="ghost" type="button" onClick={onClose}>{t('Cancelar', 'Cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || (lock ? !current : !password)}>
            {busy ? t('Aguarde…', 'Please wait…') : lock ? (mode === 'remove' ? t('Remover proteção', 'Remove protection') : t('Trocar senha', 'Change password')) : t('Proteger', 'Protect')}
          </Button>
        </div>
      </form>
    </div>
  )
}
