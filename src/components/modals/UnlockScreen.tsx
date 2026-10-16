// Tela de desbloqueio do espaço protegido por senha (antes de qualquer dado ser carregado).
import { humanError } from '../../onboarding/humanError'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Fingerprint, KeyRound, Lock } from 'lucide-react'
import { translate, type Locale } from '../../localization'
import { securityApi, securityMessage, type VaultStatus } from '../../security/api'
import { HintReveal } from '../../security/PageLockGate'
import { passwordProblem, problemMessage } from '../../security/validation'
import '../../security/security.css'
import { Logo } from '../ui/Logo'
import { Button } from '../ui/Button'

export function UnlockScreen({ status, onUnlocked }: { status: VaultStatus; onUnlocked: (status: VaultStatus) => void }) {
  const locale: Locale = status.settings.locale ?? 'pt-BR'
  const tr = (pt: string, en: string) => translate(locale, pt, en)
  const api = securityApi()!
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setErrorValue] = useState('')
  const [showHint, setShowHint] = useState(false)
  const setError = setErrorValue
  const typed = (setter: (value: string) => void) => (value: string) => { setter(value); setErrorValue('') }
  const input = useRef<HTMLInputElement>(null)
  const touchId = status.touchIdAvailable && status.settings.touchId

  useEffect(() => {
    document.documentElement.lang = locale
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [locale])
  useEffect(() => { input.current?.focus() }, [mode])

  const run = async (operation: () => Promise<VaultStatus>) => {
    setBusy(true); setError('')
    try { const value = await operation(); setPassword(''); setRecovery(''); setNext(''); setConfirm(''); onUnlocked(value) }
    catch (cause) { setError(/WRONG_PASSWORD/.test(String((cause as Error)?.message ?? cause)) ? humanError('password', cause, (pt, en, vars) => translate(locale, pt, en, vars)).text : securityMessage(cause, locale)); input.current?.focus(); input.current?.select() }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'password') { if (password) void run(() => api.vaultUnlock(password)); return }
    const problem = passwordProblem(next, confirm)
    if (problem) { setError(problemMessage(problem, (pt, en, vars) => translate(locale, pt, en, vars))); return }
    void run(() => api.vaultUnlockRecovery(recovery, next))
  }

  return (
    <div className="sec-screen">
      <form className="sec-card" onSubmit={submit} aria-labelledby="sec-unlock-title">
        <Logo size={30} className="sec-brand" />
        <div className="sec-badge" aria-hidden><Lock size={20} strokeWidth={1.75} /></div>
        <h1 id="sec-unlock-title">{tr('Espaço bloqueado', 'Workspace locked')}</h1>
        <p>{mode === 'password'
          ? tr('Digite a senha do espaço para abrir suas páginas. Nada é carregado antes do desbloqueio.', 'Enter the workspace password to open your pages. Nothing is loaded before unlocking.')
          : tr('Use a chave de recuperação que você guardou e defina uma nova senha.', 'Use the recovery key you saved and choose a new password.')}</p>
        <div className="sec-form">
          {mode === 'password' ? (
            <input ref={input} className="sec-input" type="password" autoComplete="current-password" aria-label={tr('Senha do espaço', 'Workspace password')} placeholder={tr('Senha', 'Password')} value={password} onChange={e => typed(setPassword)(e.target.value)} readOnly={busy} />
          ) : <>
            <input ref={input} className="sec-input is-mono" aria-label={tr('Chave de recuperação', 'Recovery key')} placeholder="XXXX-XXXX-…" value={recovery} onChange={e => typed(setRecovery)(e.target.value)} spellCheck={false} autoComplete="off" readOnly={busy} />
            <input className="sec-input" type="password" autoComplete="new-password" aria-label={tr('Nova senha', 'New password')} placeholder={tr('Nova senha (mín. 8 caracteres)', 'New password (min. 8 characters)')} value={next} onChange={e => typed(setNext)(e.target.value)} readOnly={busy} />
            <input className="sec-input" type="password" autoComplete="new-password" aria-label={tr('Confirmar nova senha', 'Confirm new password')} placeholder={tr('Confirmar nova senha', 'Confirm new password')} value={confirm} onChange={e => typed(setConfirm)(e.target.value)} readOnly={busy} />
          </>}
          <div className="sec-error" role="alert">{error}</div>
          <Button variant="primary" type="submit" disabled={busy || (mode === 'password' ? !password : !recovery || !next)}>
            {busy ? tr('Verificando…', 'Checking…') : mode === 'password' ? tr('Desbloquear', 'Unlock') : tr('Recuperar e desbloquear', 'Recover and unlock')}
          </Button>
        </div>
        {mode === 'password' && <HintReveal hint={status.hint} shown={showHint} onShow={() => setShowHint(true)} label={tr('Mostrar dica', 'Show hint')} title={tr('Dica de senha', 'Password hint')} />}
        <div className="sec-row">
          {touchId && mode === 'password' && <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => api.vaultUnlockTouchID())}><Fingerprint size={16} aria-hidden /> {status.biometricKind === 'windowsHello' ? tr('Usar Windows Hello', 'Use Windows Hello') : tr('Usar Touch ID', 'Use Touch ID')}</Button>}
          <Button variant="ghost" type="button" disabled={busy} onClick={() => { setError(''); setMode(mode === 'password' ? 'recovery' : 'password') }}>
            <KeyRound size={16} aria-hidden /> {mode === 'password' ? tr('Esqueci a senha', 'Forgot password') : tr('Voltar à senha', 'Back to password')}
          </Button>
        </div>
        <p className="sec-hint">{tr('Sem a senha e sem a chave de recuperação, os dados deste espaço não podem ser recuperados.', 'Without the password and the recovery key, this workspace’s data cannot be recovered.')}</p>
      </form>
    </div>
  )
}
