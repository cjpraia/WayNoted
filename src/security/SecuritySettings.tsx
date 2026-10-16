import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Configurações → Segurança e privacidade (usa as classes st-* do SettingsModal).
import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Lock } from 'lucide-react'
import { actions, api as nativeApi, useStore } from '../store'
import { t, getLocale } from '../i18n'
import { securityApi, securityMessage, type VaultStatus } from './api'
import { openPageLockDialog } from './PageLockDialog'
import { setCachePersistence } from '../search/cache'
import { OnlineMediaSettings } from './OnlineMediaSettings'
import { UsageSettings } from './UsageSettings'
import { MAX_HINT, passwordProblem, problemMessage } from './validation'
import './security.css'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'

const windows = () => window.api?.platform === 'win32'
const AUTO_LOCK = [0, 1, 5, 15, 30, 60, 240]
const RELOCK = [0, 1, 5, 15, 60]
type Form = null | 'enable' | 'disable' | 'change' | 'recovery'

export function SecuritySettings() {
  const api = securityApi()
  const { pages } = useStore()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [form, setForm] = useState<Form>(null)
  const [password, setPasswordValue] = useState('')
  const [next, setNextValue] = useState('')
  const [confirm, setConfirmValue] = useState('')
  const [hint, setHintValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [deviceSecurity, setDeviceSecurity] = useState<{ enabled: boolean; deviceCipher?: 'none' | 'keychain' | 'legacy'; legacyPending?: boolean } | null>(null)
  const [cipher, setCipher] = useState<{ mode: 'none' | 'keychain' | 'legacy'; backups: { exists: boolean; count: number; expiresAt: number | null } } | null>(null)
  const [confirmCipher, setConfirmCipher] = useState(false)
  const refresh = () => api?.vaultStatus().then(value => { setStatus(value); setCachePersistence(!value.enabled) }).catch(cause => setFeedback({ text: securityMessage(cause, getLocale()), error: true }))
  useEffect(() => { void refresh(); void nativeApi.securityInfo?.().then(setDeviceSecurity).catch(() => {}); void nativeApi.deviceCipherStatus?.().then(setCipher).catch(() => {}) }, [])

  const reset = () => { setForm(null); setPasswordValue(''); setNextValue(''); setConfirmValue(''); setHintValue(''); setSubmitted(false); setAcknowledged(false) }
  // An error from a previous attempt never outlives an edit of the fields that caused it.
  const typed = (setter: (value: string) => void) => (value: string) => { setter(value); setFeedback(current => current?.error ? null : current) }
  const setPassword = typed(setPasswordValue), setNext = typed(setNextValue), setConfirm = typed(setConfirmValue), setHint = typed(setHintValue)
  const openForm = (value: Form) => { reset(); setForm(value); if (value === 'change') setHintValue(status?.hint ?? '') }
  const fresh = form === 'enable' || form === 'change'
  const problem = fresh ? passwordProblem(next, confirm, hint) : null
  const liveProblem = problem && (submitted || (confirm.length >= next.length && confirm.length > 0) || problem === 'hintHasPassword' || problem === 'hintLong') ? problemMessage(problem, t) : ''
  const run = async (operation: () => Promise<string | void>) => {
    setBusy(true); setFeedback(null)
    try { const text = await operation(); await refresh(); if (text) setFeedback({ text, error: false }) }
    catch (cause) { setFeedback({ text: securityMessage(cause, getLocale()), error: true }) }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!api) return
    setSubmitted(true)
    if (problem) return
    if (form === 'enable') {
      void run(async () => { await actions.flushAll(); const result = await api.vaultEnable(next, { acknowledged, hint }); reset(); setSavedKey(false); setRecoveryKey(result.recoveryKey); return t('Espaço criptografado com sua senha.', 'Workspace encrypted with your password.') })
    } else if (form === 'disable') {
      void run(async () => { await actions.flushAll(); await api.vaultDisable(password); reset(); return t('Senha do espaço removida. Os arquivos voltaram a ser arquivos locais normais.', 'Workspace password removed. Files are normal local files again.') })
    } else if (form === 'change') {
      void run(async () => { await api.vaultChangePassword(password, next, { hint }); reset(); return t('Senha alterada. A chave de recuperação continua válida.', 'Password changed. The recovery key remains valid.') })
    } else if (form === 'recovery') {
      void run(async () => { const result = await api.vaultRegenerateRecovery(password); reset(); setSavedKey(false); setRecoveryKey(result.recoveryKey); return t('Nova chave de recuperação gerada; a anterior deixou de valer.', 'New recovery key generated; the previous one no longer works.') })
    }
  }
  const copyKey = () => void run(async () => { if (!recoveryKey) return; if (nativeApi.copyText) await nativeApi.copyText(recoveryKey); else await navigator.clipboard.writeText(recoveryKey); return t('Chave copiada. Guarde-a fora deste computador.', 'Key copied. Keep it somewhere other than this computer.') })

  if (!api) return <>
    <h2 className="st-h">{t('Segurança e privacidade', 'Security & privacy')}</h2>
    <p className="st-p">{t('A criptografia com senha está disponível no aplicativo para Mac.', 'Password encryption is available in the desktop app.')}</p>
    <OnlineMediaSettings />
  </>
  const protectedRoots = status?.pages?.roots ?? []
  const passwordFields = (current: boolean, fresh: boolean) => <>
    {current && <input className="st-input" type="password" autoComplete="current-password" autoFocus aria-label={t('Senha atual do espaço', 'Current workspace password')} placeholder={t('Senha atual', 'Current password')} value={password} onChange={e => setPassword(e.target.value)} />}
    {fresh && <>
      <input className="st-input" type="password" autoComplete="new-password" autoFocus={!current} aria-label={t('Nova senha', 'New password')} placeholder={t('Nova senha (mín. 8 caracteres)', 'New password (min. 8 characters)')} value={next} onChange={e => setNext(e.target.value)} />
      <input className="st-input" type="password" autoComplete="new-password" aria-label={t('Confirmar nova senha', 'Confirm new password')} placeholder={t('Confirmar nova senha', 'Confirm new password')} value={confirm} onChange={e => setConfirm(e.target.value)} />
      <input className="st-input" type="text" maxLength={MAX_HINT + 20} autoComplete="off" spellCheck={false} aria-label={t('Dica de senha (opcional)', 'Password hint (optional)')} placeholder={t('Dica de senha (opcional)', 'Password hint (optional)')} value={hint} onChange={e => setHint(e.target.value)} />
      <span className="st-hint">{t('Aparece na tela de desbloqueio. Não escreva a senha aqui. A dica fica legível sem a senha, junto aos parâmetros de criptografia.', 'Shown on the unlock screen. Do not write the password here. The hint is readable without the password, next to the encryption parameters.')}</span>
      {liveProblem && <span className="st-feedback is-error" role="alert">{liveProblem}</span>}
    </>}
  </>
  const actionsRow = (label: string, danger = false, disabled = false) => <div className="st-confirm">
    <Button variant={danger ? 'danger' : 'secondary'} type="submit" disabled={busy || disabled}>{busy ? t('Aguarde…', 'Please wait…') : label}</Button>
    <Button type="button" onClick={reset} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
  </div>

  return <>
    <h2 className="st-h">{t('Segurança e privacidade', 'Security & privacy')}</h2>
    <p className="st-p">{t('Tudo fica neste computador, em arquivos locais. Para cifrá-los, ative a senha do espaço (AES-256-GCM): sem ela, nem este Mac abre o conteúdo.', 'Everything stays on this computer, in local files. To encrypt them, turn on the workspace password (AES-256-GCM): without it, not even this computer can open the content.')}</p>
    {feedback && <div className={`st-feedback${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}

    {recoveryKey && <div className="st-row st-row-col">
      <span className="st-label">{t('Sua chave de recuperação', 'Your recovery key')}</span>
      <span className="st-hint">{t('Ela é exibida só agora. Anote ou guarde num gerenciador de senhas fora deste computador. Sem a senha e sem esta chave, os dados são irrecuperáveis.', 'It is shown only now. Write it down or keep it in a password manager outside this computer. Without the password and this key, the data cannot be recovered.')}</span>
      <div className="sec-recovery" aria-label={t('Chave de recuperação', 'Recovery key')}>{recoveryKey}</div>
      <div className="st-confirm">
        <Button onClick={copyKey}><Copy size={14} aria-hidden /> {t('Copiar', 'Copy')}</Button>
        <label className="st-hint"><input type="checkbox" checked={savedKey} onChange={e => setSavedKey(e.target.checked)} /> {t('Guardei a chave em local seguro', 'I saved the key somewhere safe')}</label>
        <Button disabled={!savedKey} onClick={() => setRecoveryKey(null)}>{t('Concluir', 'Done')}</Button>
      </div>
    </div>}

    <div className="st-row st-row-col">
      <div className="st-row-between">
        <span className="st-label">{windows() ? t('Cifrar também com a chave do Windows (DPAPI)', 'Also encrypt with the Windows key (DPAPI)') : t('Cifrar também com a chave do computador (Keychain)', 'Also encrypt with this computer’s key (Keychain)')}</span>
        {cipher && nativeApi.deviceCipherSet && (cipher.mode === 'none'
          ? <Button type="button" disabled={busy} onClick={() => setConfirmCipher(value => !value)}>{t('Ativar…', 'Turn on…')}</Button>
          : <Button variant="danger-quiet" type="button" disabled={busy} onClick={() => void run(async () => { await actions.flushAll(); setCipher(await nativeApi.deviceCipherSet!(false)); setConfirmCipher(false); return t('Cifra do Keychain removida. O macOS não pedirá mais a senha do chaveiro ao abrir o app.', 'Keychain encryption removed. macOS will no longer ask for the keychain password when opening the app.') })}>{t('Desligar', 'Turn off')}</Button>)}
      </div>
      <span className="st-hint">{windows() ? t('A chave do dispositivo usa o Windows DPAPI, vinculada ao seu usuário do Windows. Não protege contra outros programas executados pelo mesmo usuário. Use a senha do espaço para proteção independente e mantenha um backup portável.', 'The device key uses Windows DPAPI, bound to your Windows user. It does not protect against other programs running as the same user. Use a workspace password for independent protection and keep a portable backup.') : cipher?.mode === 'keychain' || cipher?.mode === 'legacy'
        ? (cipher.mode === 'legacy' ? t('Seu espaço ainda usa a cifra antiga do chaveiro (migração adiada). Clique em Desligar para convertê-lo: o macOS pedirá a senha do chaveiro uma última vez.', 'Your workspace still uses the old keychain encryption (migration postponed). Click Turn off to convert it: macOS will ask for the keychain password one last time.') : t('Ativa: AES-256-GCM com chave aleatória protegida pelo Keychain do macOS. O macOS pode pedir a senha do chaveiro ao abrir o app e após atualizações.', 'On: AES-256-GCM with a random key protected by the macOS Keychain. macOS may ask for the keychain password when opening the app and after updates.'))
        : t('Desligada (padrão): por padrão os dados ficam neste computador em arquivos locais, sem tocar no Keychain. Para cifrá-los de verdade, use a senha do espaço abaixo.', 'Off (default): by default your data stays on this computer in local files, without touching the Keychain. To really encrypt it, use the workspace password below.')}</span>
      {confirmCipher && cipher?.mode === 'none' && <div className="sec-inline-form">
        <div className="sec-warning">{t(`Atenção: o macOS pode pedir a senha do chaveiro ao abrir o app e após atualizações do ${PRODUCT.name}. Você pode desligar esta opção a qualquer momento. Os arquivos serão convertidos com verificação.`, `Heads up: macOS may ask for the keychain password when opening the app and after ${PRODUCT.name} updates. You can turn this off at any time. Files are converted with verification.`)}</div>
        <div className="st-confirm">
          <Button type="button" onClick={() => setConfirmCipher(false)}>{t('Cancelar', 'Cancel')}</Button>
          <Button type="button" disabled={busy} onClick={() => void run(async () => { await actions.flushAll(); setCipher(await nativeApi.deviceCipherSet!(true)); setConfirmCipher(false); return t('Cifra do Keychain ativada.', 'Keychain encryption turned on.') })}>{t('Ativar cifra do Keychain', 'Turn on Keychain encryption')}</Button>
        </div>
      </div>}
      {cipher?.backups.exists && <div className="st-row-between">
        <span className="st-hint">{t('Cópia antiga cifrada mantida como backup{until}.', 'Old encrypted copy kept as a backup{until}.', { until: cipher.backups.expiresAt ? t(' até {date}', ' until {date}', { date: new Date(cipher.backups.expiresAt).toLocaleDateString() }) : '' })}</span>
        <Button variant="danger-quiet" type="button" disabled={busy} onClick={() => void run(async () => { setCipher(await nativeApi.deviceCipherRemoveBackups!()); return t('Backup antigo apagado.', 'Old backup deleted.') })}>{t('Apagar backup antigo', 'Delete old backup')}</Button>
      </div>}
    </div>

    <form className="st-row st-row-col" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape' && form && !busy && !event.nativeEvent.isComposing) { event.stopPropagation(); reset() } }}>
      <div className="st-row-between">
        <span className="st-label">{t('Senha do espaço', 'Workspace password')}</span>
        {status && !form && (status.enabled
          ? <div className="st-confirm"><Button type="button" onClick={() => openForm('change')}>{t('Trocar senha', 'Change password')}</Button><Button variant="danger-quiet" type="button" onClick={() => openForm('disable')}>{t('Desativar', 'Turn off')}</Button></div>
          : <Button type="button" onClick={() => openForm('enable')}><Lock size={14} aria-hidden /> {t('Ativar', 'Turn on')}</Button>)}
      </div>
      <span className="st-hint">{status?.enabled
        ? t('Ativa. Páginas, histórico, anexos, índice de busca e backups automáticos são cifrados com uma chave liberada só pela sua senha ({kdf}).', 'On. Pages, history, attachments, search index and automatic backups are encrypted with a key released only by your password ({kdf}).', { kdf: status.kdf ?? 'scrypt' })
        : t('Opcional. Pede a senha ao abrir o espaço e bloqueia automaticamente. A conversão é atômica: os arquivos só são trocados depois de verificados.', 'Optional. Asks for the password when opening the workspace and locks automatically. Conversion is atomic: files are swapped only after being verified.')}</span>
      {form === 'enable' && <div className="sec-inline-form">
        {passwordFields(false, true)}
        <div className="sec-warning">{t(`Sem a senha e sem a chave de recuperação (exibida uma única vez a seguir), os dados deste espaço são irrecuperáveis — nem o ${PRODUCT.name} consegue abri-los.`, `Without the password and the recovery key (shown only once next), this workspace’s data cannot be recovered — not even by ${PRODUCT.name}.`)}</div>
        <label className="st-hint"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> {t('Entendi que os dados ficam irrecuperáveis sem a senha e sem a chave de recuperação', 'I understand the data is unrecoverable without the password and the recovery key')}</label>
        {actionsRow(t('Criptografar espaço', 'Encrypt workspace'), false, !acknowledged || !next)}
      </div>}
      {form === 'disable' && <div className="sec-inline-form">
        <span className="st-hint">{t('Os arquivos deixam de ser cifrados pela senha e voltam a ser arquivos locais normais (ou cifrados pelo Keychain, se você ativou essa opção).', 'Files stop being encrypted by the password and go back to normal local files (or Keychain-encrypted, if you turned that option on).')}</span>
        {passwordFields(true, false)}{actionsRow(t('Desativar senha', 'Turn off password'), true, !password)}
      </div>}
      {form === 'change' && <div className="sec-inline-form">{passwordFields(true, true)}{actionsRow(t('Trocar senha', 'Change password'), false, !password || !next)}</div>}
      {form === 'recovery' && <div className="sec-inline-form">{passwordFields(true, false)}{actionsRow(t('Gerar nova chave', 'Generate new key'), false, !password)}</div>}
    </form>

    {status?.enabled && <>
      <div className="st-row st-row-between">
        <div className="st-row-col"><label className="st-label" htmlFor="sec-autolock">{t('Bloquear automaticamente', 'Lock automatically')}</label><span className="st-hint">{t('Após este tempo sem uso, a interface é descartada e a senha é pedida de novo.', 'After this idle time, the interface is discarded and the password is asked again.')}</span></div>
        <Select id="sec-autolock" value={status.settings.autoLockMinutes} disabled={busy} onChange={e => void run(async () => { await api.vaultSetOptions({ autoLockMinutes: Number(e.target.value) }) })}>
          {AUTO_LOCK.map(value => <option key={value} value={value}>{value === 0 ? t('Nunca', 'Never') : value < 60 ? t('{n} min', '{n} min', { n: value }) : t('{n} h', '{n} h', { n: value / 60 })}</option>)}
        </Select>
      </div>
      <label className="st-row st-row-between"><span className="st-row-col"><span className="st-label">{t('Bloquear ao dormir ou bloquear a tela', 'Lock on sleep or screen lock')}</span></span><input type="checkbox" checked={status.settings.lockOnSleep} disabled={busy} onChange={e => void run(async () => { await api.vaultSetOptions({ lockOnSleep: e.target.checked }) })} /></label>
      <label className="st-row st-row-between">
        <span className="st-row-col"><span className="st-label">{windows() ? t('Desbloquear com Windows Hello', 'Unlock with Windows Hello') : t('Desbloquear com Touch ID', 'Unlock with Touch ID')}</span><span className="st-hint">{windows() ? t('O Windows Hello confirma sua presença antes de liberar a chave protegida pelo Windows. Requer Windows Hello configurado. A senha não é guardada.', 'Windows Hello verifies your presence before releasing the Windows-protected key. Requires Windows Hello setup. Your password is not stored.') : status.touchIdAvailable ? t('A chave do espaço fica no Keychain e só é liberada após o Touch ID; o macOS pode pedir a senha do chaveiro ao ativar e ao usar. Desligado por padrão. A senha nunca é guardada.', 'The workspace key stays in the Keychain and is released only after Touch ID; macOS may ask for the keychain password when turning it on and when using it. Off by default. The password is never stored.') : t('Touch ID indisponível neste computador.', 'Touch ID is unavailable on this computer.')}</span></span>
        <input type="checkbox" checked={status.settings.touchId} disabled={busy || !status.touchIdAvailable} onChange={e => void run(async () => { await api.vaultSetTouchID(e.target.checked) })} />
      </label>
      <div className="st-row st-row-between">
        <span className="st-row-col"><span className="st-label">{t('Chave de recuperação', 'Recovery key')}</span><span className="st-hint">{t('Gere uma nova se perdeu a anterior.', 'Generate a new one if you lost the previous one.')}</span></span>
        <div className="st-confirm">
          <Button disabled={busy || !!form} onClick={() => openForm('recovery')}>{t('Gerar nova', 'Generate new')}</Button>
          <Button disabled={busy} onClick={() => void run(async () => { await actions.flushAll(); await api.vaultLock() })}><Lock size={14} aria-hidden /> {t('Bloquear agora', 'Lock now')}</Button>
        </div>
      </div>
    </>}

    <div className="st-row st-row-col">
      <div className="st-row-between">
        <span className="st-label">{t('Páginas protegidas por senha', 'Password-protected pages')}</span>
        {status?.pages?.settings && <Select aria-label={t('Retrancar páginas após', 'Relock pages after')} value={status.pages.settings.relockMinutes} disabled={busy} onChange={e => void run(async () => { await api.pageSetOptions({ relockMinutes: Number(e.target.value) }) })}>
          {RELOCK.map(value => <option key={value} value={value}>{value === 0 ? t('Retrancar só ao sair', 'Relock only on leave') : t('Retrancar após {n} min', 'Relock after {n} min', { n: value })}</option>)}
        </Select>}
      </div>
      <span className="st-hint">{t('Proteja uma página pelo menu “•••” da página. Elas retrancam ao sair, ao dormir o computador e após o tempo escolhido.', 'Protect a page from the page “•••” menu. They relock on leave, when the computer sleeps and after the chosen time.')}</span>
      {!!protectedRoots.length && <div className="sec-settings-list">
        {protectedRoots.map(root => { const page = pages[root.rootId]; return <div key={root.rootId} className="sec-settings-item">
          <Lock size={14} aria-hidden />
          <span className={page?.title ? undefined : 'sec-locked-title'}>{page?.title || t('Página protegida', 'Protected page')}{root.pages.length > 1 ? ` · ${t('{n} páginas', '{n} pages', { n: root.pages.length })}` : ''}</span>
          <Button onClick={() => { actions.setSettingsOpen(false); openPageLockDialog(root.rootId) }}>{t('Gerenciar', 'Manage')}</Button>
        </div> })}
      </div>}
    </div>
    <OnlineMediaSettings />
    <UsageSettings />
  </>
}
