import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Configurações → Dados → "Espelho Markdown" (docs/DEVELOPMENT.md D1): cópia somente leitura, EM TEXTO CLARO, opt-in.
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, TriangleAlert } from 'lucide-react'
import { api } from '../../store'
import { t, useI18n } from '../../i18n'
import type { MirrorSettings } from '../../types'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { ProgressBar } from '../ui/ProgressBar'
import { DialogActions } from '../ui/DialogActions'
import { mirrorMessage, mirrorNow, notifyMirrorChanged, onMirrorBusy } from '../../mirror/controller'
import '../backup/BackupSettings.css'

type Mode = null | 'enable' | 'remove'

export function MirrorSettingsCard() {
  const { locale } = useI18n()
  const [settings, setSettings] = useState<MirrorSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  const [vaultAck, setVaultAck] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fail = useCallback((error: unknown) => setMessage({ text: mirrorMessage(error, locale), error: true }), [locale])
  const reload = useCallback(() => api.mirrorSettings!().then(setSettings).catch(fail), [fail])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => onMirrorBusy((value) => { setBusy(value); if (!value) void reload() }), [reload])
  if (!settings) return null

  const setEnabled = async (enabled: boolean) => {
    try {
      await api.mirrorSettingsSet!({ enabled, acknowledged: enabled, vaultAcknowledged: enabled ? vaultAck || settings.vaultAcknowledged : undefined })
      setMode(enabled ? null : settings.status.hasFiles ? 'remove' : null)
      setMessage(null); notifyMirrorChanged(); await reload()
    } catch (error) { fail(error) }
  }
  const chooseFolder = async () => {
    try {
      const dir = await api.mirrorChooseFolder!()
      if (dir) { await api.mirrorSettingsSet!({ directory: dir }); notifyMirrorChanged(); await reload() }
    } catch (error) { fail(error) }
  }
  const resetFolder = async () => { try { await api.mirrorSettingsSet!({ directory: settings.defaultDirectory }); notifyMirrorChanged(); await reload() } catch (error) { fail(error) } }
  const refreshNow = async () => {
    setMessage(null)
    try {
      const result = await mirrorNow(true)
      if (result) setMessage({ text: t('{pages} páginas no espelho · {written} arquivos gravados.', '{pages} pages in the mirror · {written} files written.', { pages: result.pages, written: result.written }) })
    } catch (error) { fail(error) }
    await reload()
  }
  const removeFiles = async () => {
    try { const { removed } = await api.mirrorRemove!(); setMessage({ text: t('{n} arquivos apagados.', '{n} files deleted.', { n: removed }) }); setMode(null); await reload() } catch (error) { fail(error) }
  }
  const status = settings.status
  const needsVaultAck = settings.vault.enabled
  const vaultOk = !needsVaultAck || vaultAck || settings.vaultAcknowledged

  return <>
    <Toggle
      label={t('Espelho Markdown (texto claro)', 'Markdown mirror (clear text)')}
      hint={t('Mantém uma cópia somente leitura das suas páginas, em arquivos .md, numa pasta sua. Desligado por padrão.', 'Keeps a read-only copy of your pages as .md files in a folder of yours. Off by default.')}
      checked={settings.enabled || mode === 'enable'}
      onChange={(value) => { setMessage(null); if (value) setMode('enable'); else void setEnabled(false) }}
    />
    {mode === 'enable' && !settings.enabled && <div className="bk-confirm" role="alertdialog" aria-labelledby="mirror-confirm-title">
      <h4 id="mirror-confirm-title"><TriangleAlert size={14} aria-hidden /> {t('Gravar seu conteúdo em texto claro?', 'Write your content in clear text?')}</h4>
      <ul className="bk-summary">
        <li>{t('Grava seu conteúdo em TEXTO CLARO nesta pasta, sem criptografia:', 'Writes your content in CLEAR TEXT in this folder, without encryption:')} <code>{settings.directory}</code></li>
        <li>{t(`Edições feitas nos arquivos NÃO voltam para o ${PRODUCT.name}; elas são sobrescritas.`, `Edits made to the files do NOT go back into ${PRODUCT.name}; they are overwritten.`)}</li>
        <li>{t('Páginas protegidas por senha, a lixeira e as páginas marcadas “Não espelhar” nunca são gravadas.', 'Password-protected pages, the trash and pages marked “Do not mirror” are never written.')}</li>
        <li>{t('Quem acessar a pasta (ou o backup do Mac, iCloud, Spotlight) poderá ler as páginas espelhadas.', 'Anyone with access to the folder (or your Mac backup, iCloud, Spotlight) can read the mirrored pages.')}</li>
      </ul>
      {needsVaultAck && <label className="st-label"><input type="checkbox" checked={vaultAck} onChange={(event) => setVaultAck(event.target.checked)} /> {t('Este espaço tem senha. Entendo que o espelho NÃO é protegido por ela.', 'This workspace has a password. I understand the mirror is NOT protected by it.')}</label>}
      <div className="bk-actions"><Button onClick={() => void chooseFolder()}><FolderOpen size={14} aria-hidden /> {t('Escolher pasta…', 'Choose folder…')}</Button></div>
      <DialogActions confirmLabel={t('Ligar espelho em texto claro', 'Turn on clear-text mirror')} disabled={!vaultOk} onConfirm={() => void setEnabled(true)} onCancel={() => { setMode(null); setVaultAck(false) }} />
    </div>}
    {mode === 'remove' && <div className="bk-confirm" role="alertdialog" aria-labelledby="mirror-remove-title">
      <h4 id="mirror-remove-title">{t('Remover os arquivos já gerados?', 'Remove the files already generated?')}</h4>
      <p className="st-hint">{t(`O espelho foi desligado. Os arquivos continuam na pasta, em texto claro. Remover apaga só o que o ${PRODUCT.name} gerou (não vai para a Lixeira).`, `The mirror is off. The files are still in the folder, in clear text. Removing deletes only what ${PRODUCT.name} generated (it does not go to the Trash).`)}</p>
      <DialogActions destructive confirmLabel={t('Remover arquivos', 'Remove files')} onConfirm={() => void removeFiles()} onCancel={() => setMode(null)} />
    </div>}
    <div className="st-row st-row-col">
      <div className="st-label">{t('Pasta do espelho', 'Mirror folder')}</div>
      <code>{settings.directory}</code>
      <div className="bk-actions">
        <Button onClick={() => void chooseFolder()} disabled={mode === 'enable'}><FolderOpen size={14} aria-hidden /> {t('Escolher pasta…', 'Choose folder…')}</Button>
        <Button onClick={() => void api.mirrorReveal!().catch(fail)} disabled={!status.hasFiles}>{t('Mostrar no Finder', 'Show in Finder')}</Button>
        {settings.directory !== settings.defaultDirectory && <Button variant="ghost" onClick={() => void resetFolder()}>{t('Voltar ao padrão', 'Back to default')}</Button>}
      </div>
      <span className="st-hint">{t(`Fora das pastas de dados e de backups do ${PRODUCT.name}. Há uma pasta por espaço, com um LEIA-ME.md.`, `Outside the ${PRODUCT.name} data and backup folders. One folder per workspace, with a README.`)}</span>
    </div>
    <div className="st-row st-row-between">
      <div>
        <div className="st-label">{t('Atualizar agora', 'Update now')}</div>
        <div className="st-hint">
          {status.updatedAt ? t('Última atualização: {date} · {pages} páginas.', 'Last update: {date} · {pages} pages.', { date: new Date(status.updatedAt).toLocaleString(locale), pages: status.pages }) : t('Ainda não houve atualização.', 'No update yet.')}
          {' '}{t('As mudanças são gravadas sozinhas poucos segundos depois de você editar.', 'Changes are written automatically a few seconds after you edit.')}
        </div>
      </div>
      <Button variant="primary" disabled={!settings.enabled || busy} onClick={() => void refreshNow()}>{t('Atualizar agora', 'Update now')}</Button>
    </div>
    {busy && <ProgressBar label={t('Atualizando o espelho…', 'Updating the mirror…')} />}
    {status.error && settings.enabled && <div className="bk-error" role="alert">{t('Último erro: {message}', 'Last error: {message}', { message: status.error.message })}</div>}
    {settings.enabled && settings.vault.locked && <div className="st-hint">{t('Espaço bloqueado: o espelho fica parado até desbloquear.', 'Workspace locked: the mirror is paused until you unlock it.')}</div>}
    {message && <div className={message.error ? 'bk-error' : 'st-hint'} role={message.error ? 'alert' : 'status'}>{message.text}</div>}
  </>
}
