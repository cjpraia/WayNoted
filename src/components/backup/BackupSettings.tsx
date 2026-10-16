import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Configurações → Dados → "Backup externo" e tela de recuperação (docs/DEVELOPMENT.md F3).
// Cópias verificadas por SHA-256 fora da pasta de dados; restauração completa com confirmação e cópia de segurança.
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../../store'
import { showToast } from '../ui/toastQueue'
import { t, useI18n } from '../../i18n'
import type { BackupDescription, BackupSetInfo, BackupSettings } from '../../types'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'
import { ProgressBar } from '../ui/ProgressBar'
import { DialogActions } from '../ui/DialogActions'
import './BackupSettings.css'

/** "BACKUP_X: texto pt / text en" (erros do processo principal) → texto no idioma atual. */
export function backupMessage(error: unknown, locale: string): string {
  const raw = String((error as { message?: string })?.message ?? error)
  const cleaned = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^[A-Z_]{4,}: /, '')
  const [pt, en] = cleaned.split(' / ')
  return locale === 'en-US' && en ? en : pt
}
export function formatBytes(bytes: number, locale: string) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`
}
const kindLabel = (kind: BackupSetInfo['kind']) => kind === 'manual' ? t('Manual', 'Manual') : kind === 'auto' ? t('Automática', 'Automatic') : t('Antes de restaurar', 'Before restore')

/** Lista de cópias com data, tamanho e estado; "Restaurar…" abre o resumo de confirmação. */
export function BackupList({ sets, onRestore, disabled }: { sets: BackupSetInfo[]; onRestore: (id: string) => void; disabled?: boolean }) {
  const { locale } = useI18n()
  if (!sets.length) return <p className="bk-empty">{t('Ainda não há cópias nesta pasta.', 'There are no copies in this folder yet.')}</p>
  return <ul className="bk-list">{sets.map(set => <li key={set.id} className="bk-item">
    <div className="bk-item-main">
      <span className="bk-date">{new Date(set.createdAt).toLocaleString(locale)}</span>
      <span className="bk-meta">{kindLabel(set.kind)} · {formatBytes(set.size, locale)}{set.encrypted ? ` · ${t('cifrada', 'encrypted')}` : ''}</span>
    </div>
    <span className={`bk-state${set.healthy === false ? ' is-bad' : set.verified ? ' is-ok' : ''}`}>
      {set.healthy === false ? <><TriangleAlert size={13} aria-hidden /> {t('Danificada', 'Damaged')}</> : set.verified ? <><ShieldCheck size={13} aria-hidden /> {t('Verificada ✓', 'Verified ✓')}</> : t('Não verificada', 'Not verified')}
    </span>
    <Button disabled={disabled || set.healthy === false} onClick={() => onRestore(set.id)}>{t('Restaurar…', 'Restore…')}</Button>
  </li>)}</ul>
}

const RESTORED_NOTICE_KEY = 'np.restoredNotice'
/** Depois do reload da restauração: mostra o toast "Espaço restaurado de <data>" uma única vez. */
export function showRestoredNotice() {
  try {
    const message = sessionStorage.getItem(RESTORED_NOTICE_KEY)
    if (!message) return
    sessionStorage.removeItem(RESTORED_NOTICE_KEY)
    showToast({ message })
  } catch { /* ignore */ }
}

/** Recarrega a janela depois do aviso de conclusão da restauração (o processo principal recarrega só as outras janelas). */
export const reloadWindow = () => window.location.reload()

/** Resumo + confirmação explícita da restauração completa (destrutiva). */
export function RestoreConfirm({ id, onCancel, onDone }: { id: string; onCancel: () => void; onDone: (message: string) => void }) {
  const { locale } = useI18n()
  const [info, setInfo] = useState<BackupDescription | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => { let live = true; api.backupDescribe?.(id).then(v => live && setInfo(v)).catch(e => live && setError(backupMessage(e, locale))); return () => { live = false } }, [id, locale])
  const restore = async () => {
    setBusy(true); setError(null)
    try { await api.backupRestore!(id); setBusy(false); setDone(true) }
    catch (e) { setError(backupMessage(e, locale)); setBusy(false) }
  }
  const finish = () => {
    const message = t('Espaço restaurado de {date}.', 'Workspace restored from {date}.', { date: info?.createdAt ? new Date(info.createdAt).toLocaleString(locale) : '' })
    try { sessionStorage.setItem(RESTORED_NOTICE_KEY, message) } catch { /* sem sessionStorage: só o diálogo */ }
    onDone(message); reloadWindow()
  }
  if (done) return <div className="bk-confirm" role="alertdialog" aria-labelledby="bk-done-title">
    <h4 id="bk-done-title">{t(`Restauração concluída. O ${PRODUCT.name} vai reiniciar a janela.`, `Restore finished. ${PRODUCT.name} will restart the window.`)}</h4>
    <div className="bk-actions"><Button variant="primary" autoFocus onClick={finish}>OK</Button></div>
  </div>
  return <div className="bk-confirm" role="alertdialog" aria-labelledby="bk-confirm-title">
    <h4 id="bk-confirm-title">{t('Restaurar o espaço inteiro?', 'Restore the entire workspace?')}</h4>
    {!info && !error && <ProgressBar label={t('Verificando a cópia…', 'Verifying the copy…')} />}
    {info?.ok && <ul className="bk-summary">
      <li>{t('Cópia de', 'Copy from')} <strong>{new Date(info.createdAt!).toLocaleString(locale)}</strong></li>
      <li>{t('{pages} páginas · {files} arquivos · {size}', '{pages} pages · {files} files · {size}', { pages: info.pages ?? 0, files: info.fileCount ?? 0, size: formatBytes(info.totalSize ?? 0, locale) })}</li>
      <li>{info.encrypted ? t('Cifrada com a senha do espaço (será pedida de novo ao abrir).', 'Encrypted with the workspace password (it will be asked again on open).') : t('Sem senha do espaço: este backup é legível sem senha. Se o espaço atual tem senha, ele deixará de ter.', 'No workspace password: this backup is readable without one. If the current workspace has a password, it will no longer have one.')}</li>
      <li>{t('Tudo o que existe agora será substituído. O estado atual fica guardado como uma cópia “Antes de restaurar”.', 'Everything that exists now will be replaced. The current state is kept as a “Before restore” copy.')}</li>
    </ul>}
    {info && !info.ok && <p className="bk-error" role="alert">{t('Esta cópia está danificada e não pode ser restaurada.', 'This copy is damaged and cannot be restored.')}</p>}
    {info?.newerThanApp && <p className="bk-error" role="alert">{t(`Esta cópia vem de uma versão mais nova do ${PRODUCT.name}.`, `This copy comes from a newer ${PRODUCT.name} version.`)}</p>}
    {error && <p className="bk-error" role="alert">{error}</p>}
    {busy && <ProgressBar label={t('Restaurando…', 'Restoring…')} />}
    <DialogActions destructive busy={busy} disabled={!info?.ok || !!info.newerThanApp} confirmLabel={t('Restaurar espaço inteiro', 'Restore entire workspace')} onConfirm={() => void restore()} onCancel={onCancel} />
  </div>
}

export function BackupSettingsCard() {
  const { locale } = useI18n()
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [sets, setSets] = useState<BackupSetInfo[]>([])
  const [busy, setBusy] = useState<null | 'now' | 'verify'>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const refresh = useCallback(async (verify: 'quick' | 'full' = 'quick') => { setSets(await api.backupList!(verify)) }, [])
  useEffect(() => { void api.backupSettings!().then(setSettings).then(() => refresh()).catch(e => setMessage({ text: backupMessage(e, locale), error: true })) }, [refresh, locale])
  if (!settings) return null
  const update = async (patch: Parameters<NonNullable<typeof api.backupSettingsSet>>[0]) => {
    try { const next = await api.backupSettingsSet!(patch); setSettings(s => s && { ...s, ...next }); setMessage(null); await refresh() } catch (e) { setMessage({ text: backupMessage(e, locale), error: true }) }
  }
  const run = async (kind: 'now' | 'verify') => {
    setBusy(kind); setMessage(null)
    try {
      if (kind === 'now') { await api.backupNow!(); await refresh(); setMessage({ text: t('Backup criado e verificado.', 'Backup created and verified.') }) }
      else { await refresh('full'); setMessage({ text: t('Verificação concluída.', 'Verification finished.') }) }
    } catch (e) { setMessage({ text: backupMessage(e, locale), error: true }) } finally { setBusy(null) }
  }
  const usingICloud = settings.directory === settings.icloud.path
  const r = settings.retention
  const preset = `${r.daily}-${r.weekly}-${r.monthly}`
  return <>
    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={settings.enabled} onChange={e => void update({ enabled: e.target.checked })} /> {t('Backup externo automático', 'Automatic external backup')}</label>
      <span className="st-hint">{t('Cópias verificadas por hash numa pasta fora dos dados do app. Se o espaço tem senha, as cópias ficam cifradas.', 'Hash-verified copies in a folder outside the app data. If the workspace has a password, copies stay encrypted.')}</span>
    </div>
    <div className="st-row st-row-col">
      <div className="st-label">{t('Pasta de backup', 'Backup folder')}</div>
      <code>{settings.directory}</code>
      <div className="bk-actions">
        <Button onClick={() => void api.backupChooseFolder!().then(async dir => { if (dir) await update({ directory: dir }) }).catch(e => setMessage({ text: backupMessage(e, locale), error: true }))}><FolderOpen size={14} aria-hidden /> {t('Escolher pasta…', 'Choose folder…')}</Button>
        <Button onClick={() => void api.backupRevealFolder!()}>{t('Mostrar no Finder', 'Show in Finder')}</Button>
        {settings.directory !== settings.defaultDirectory && <Button variant="ghost" onClick={() => void update({ directory: settings.defaultDirectory })}>{t('Voltar ao padrão', 'Back to default')}</Button>}
      </div>
      {settings.icloud.available && !usingICloud && <div className="st-hint">{t('Sugestão: guardar no iCloud Drive para ter uma cópia fora deste Mac.', 'Suggestion: keep copies in iCloud Drive to have one outside this Mac.')} <Button variant="ghost" onClick={() => void update({ directory: settings.icloud.path })}>{t('Usar iCloud Drive', 'Use iCloud Drive')}</Button></div>}
    </div>
    <div className="st-row st-row-between">
      <label>{t('Intervalo', 'Interval')} <Select value={settings.intervalHours} onChange={e => void update({ intervalHours: Number(e.target.value) })}>
        <option value={1}>{t('1 hora', '1 hour')}</option><option value={6}>{t('6 horas', '6 hours')}</option><option value={24}>{t('Diariamente', 'Daily')}</option>
      </Select></label>
      <label>{t('Retenção', 'Retention')} <Select value={preset} onChange={e => { const [daily, weekly, monthly] = e.target.value.split('-').map(Number); void update({ retention: { daily, weekly, monthly } }) }}>
        <option value="7-4-6">{t('7 diárias + 4 semanais + 6 mensais', '7 daily + 4 weekly + 6 monthly')}</option>
        <option value="3-2-2">{t('Enxuta: 3 + 2 + 2', 'Lean: 3 + 2 + 2')}</option>
        <option value="14-8-12">{t('Longa: 14 + 8 + 12', 'Long: 14 + 8 + 12')}</option>
        {!['7-4-6', '3-2-2', '14-8-12'].includes(preset) && <option value={preset}>{`${r.daily} + ${r.weekly} + ${r.monthly}`}</option>}
      </Select></label>
    </div>
    <div className="st-row st-row-between">
      <div><div className="st-label">{t('Fazer backup agora', 'Back up now')}</div><div className="st-hint">{t('Cria e confere uma cópia completa (páginas, histórico, anexos e configurações).', 'Creates and checks a full copy (pages, history, attachments and settings).')}</div></div>
      <div className="bk-actions"><Button variant="primary" disabled={!!busy} aria-busy={busy === 'now'} onClick={() => void run('now')}>{busy === 'now' ? t('Fazendo backup…', 'Backing up…') : t('Fazer backup agora', 'Back up now')}</Button>
        <Button disabled={!!busy || !sets.length} onClick={() => void run('verify')}>{t('Verificar agora', 'Verify now')}</Button></div>
    </div>
    {busy && <ProgressBar label={busy === 'now' ? t('Copiando e verificando…', 'Copying and verifying…') : t('Conferindo as cópias…', 'Checking the copies…')} />}
    {message && <div className={message.error ? 'bk-error' : 'st-hint'} role={message.error ? 'alert' : 'status'}>{message.text}</div>}
    <BackupList sets={sets} disabled={!!busy || !!restoring} onRestore={setRestoring} />
    {restoring && <RestoreConfirm id={restoring} onCancel={() => setRestoring(null)} onDone={text => { setMessage({ text }); setRestoring(null) }} />}
  </>
}

/** Tela de erro ao abrir (meta.json falhou/corrompido): lista cópias verificadas e deixa abrir a partir de uma. */
export function BackupRecovery() {
  const { locale } = useI18n()
  const [sets, setSets] = useState<BackupSetInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  useEffect(() => { let live = true; api.backupList?.('full').then(v => live && setSets(v.filter(s => s.kind !== 'pre-restore'))).catch(e => live && setError(backupMessage(e, locale))); return () => { live = false } }, [locale])
  if (!api.backupList) return null
  const best = sets?.find(s => s.verified)
  return <section className="bk-recovery" aria-label={t('Recuperar a partir de um backup', 'Recover from a backup')}>
    <h2>{t('Abrir a partir de um backup', 'Open from a backup')}</h2>
    {!sets && !error && <ProgressBar label={t('Verificando os backups…', 'Verifying backups…')} />}
    {error && <p className="bk-error" role="alert">{error}</p>}
    {sets && <>
      <BackupList sets={sets} onRestore={setRestoring} disabled={!!restoring} />
      {best && !restoring && <Button variant="primary" onClick={() => setRestoring(best.id)}>{t('Abrir último backup verificado', 'Open latest verified backup')}</Button>}
    </>}
    {restoring && <RestoreConfirm id={restoring} onCancel={() => setRestoring(null)} onDone={() => {}} />}
  </section>
}
