import PRODUCT from '../../shared/product.json' with { type: 'json' }
// Seção "Captura rápida" das Configurações: atalhos globais, barra de menus e início de sessão.
import { useEffect, useState } from 'react'
import { api } from '../store'
import { t, useI18n } from '../i18n'
import { acceleratorLabel, eventToAccelerator } from './accelerator'
import type { QuickCaptureBridge, QuickCaptureSettings as Prefs } from './types'
import './quick-settings.css'
import { Button } from '../components/ui/Button'

const bridge = () => api as unknown as QuickCaptureBridge

let requestedSection: string | null = null
/** Pedido de abrir as Configurações já nesta seção (ex.: "Preferências…" na barra de menus). */
export function requestSettingsSection(section: string) { requestedSection = section }
export function takeRequestedSettingsSection() { const value = requestedSection; requestedSection = null; return value }

function ShortcutField({ label, hint, value, status, onChange }: { label: string; hint: string; value: string; status?: string; onChange: (value: string) => Promise<void> }) {
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Escape') { setRecording(false); return }
      const accelerator = eventToAccelerator(event)
      if (accelerator) { setRecording(false); void onChange(accelerator) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])
  return <div className="st-row st-row-between qc-row">
    <div className="qc-text"><span className="st-label">{label}</span><span className="st-hint">{status === 'busy' ? t('Em uso por outro app — escolha outra combinação.', 'Used by another app — choose another combination.') : hint}</span></div>
    <div className="qc-actions">
      <button className={`qc-shortcut${recording ? ' is-recording' : ''}${status === 'busy' ? ' is-busy' : ''}`} onClick={() => setRecording(!recording)} aria-label={t('Alterar atalho: {label}', 'Change shortcut: {label}', { label })}>
        {recording ? t('Pressione as teclas…', 'Press keys…') : value ? acceleratorLabel(value, t('Espaço', 'Space')) : t('Desativado', 'Off')}
      </button>
      {value && !recording && <Button onClick={() => void onChange('')}>{t('Desativar', 'Turn off')}</Button>}
    </div>
  </div>
}

export function QuickCaptureSettings() {
  useI18n()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  useEffect(() => { void bridge().quickCaptureSettings?.().then(setPrefs).catch(error => setFeedback({ text: String(error?.message ?? error), error: true })) }, [])
  const update = async (patch: Parameters<NonNullable<QuickCaptureBridge['updateQuickCaptureSettings']>>[0]) => {
    setFeedback(null)
    try { setPrefs(await bridge().updateQuickCaptureSettings!(patch)) }
    catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error)
      const [pt, en] = message.split(' / ')
      setFeedback({ text: en ? t(pt, en) : message, error: true })
    }
  }
  if (!bridge().quickCaptureSettings) return <p className="st-p">{t('A captura rápida está disponível no app para Mac.', 'Quick capture is available in the Mac app.')}</p>
  if (!prefs) return null
  return <>
    <ShortcutField label={t('Nova nota rápida', 'New quick note')} hint={t(`Abre uma janela flutuante de qualquer app, mesmo com o ${PRODUCT.name} fechado.`, `Opens a floating window from any app, even with ${PRODUCT.name} closed.`)}
      value={prefs.shortcut} status={prefs.status.shortcut} onChange={shortcut => update({ shortcut })} />
    <ShortcutField label={t('Capturar seleção', 'Capture selection')} hint={t('Copie o texto (⌘C) e use o atalho: a nota abre preenchida, com a página de origem quando o navegador a informar.', 'Copy text (⌘C) and use the shortcut: the note opens prefilled, with the source page when the browser provides it.')}
      value={prefs.captureShortcut} status={prefs.status.captureShortcut} onChange={captureShortcut => update({ captureShortcut })} />
    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={prefs.showTray} onChange={event => void update({ showTray: event.target.checked })} /> {t('Mostrar ícone na barra de menus', 'Show icon in the menu bar')}</label>
      <span className="st-hint">{t('Acesso a nova nota, busca e páginas recentes sem abrir a janela principal.', 'Access new note, search and recent pages without opening the main window.')}</span>
    </div>
    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={prefs.trayTasks} disabled={!prefs.showTray} onChange={event => void update({ trayTasks: event.target.checked })} /> {t('Listar as tarefas de hoje no menu do ícone', 'List today’s tasks in the icon menu')}</label>
      <span className="st-hint">{t('Até 10 tarefas de hoje e atrasadas; clique em uma para concluí-la. Páginas protegidas por senha nunca aparecem.', 'Up to 10 tasks due today and overdue; click one to complete it. Password-protected pages never appear.')}</span>
    </div>
    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={prefs.trayCount} disabled={!prefs.showTray || !prefs.trayTasks} onChange={event => void update({ trayCount: event.target.checked })} /> {t('Mostrar o número de tarefas ao lado do ícone', 'Show the task count next to the icon')}</label>
      <span className="st-hint">{t('Desligado por padrão; o número some quando não há tarefas para hoje.', 'Off by default; the number disappears when nothing is due today.')}</span>
    </div>
    <div className="st-row st-row-col">
      <label className="st-label"><input type="checkbox" checked={prefs.openAtLogin} onChange={event => void update({ openAtLogin: event.target.checked })} /> {t('Abrir ao iniciar sessão', 'Open at login')}</label>
      <span className="st-hint">{prefs.loginItemSupported
        ? t(`Com o ícone na barra de menus ativo, o ${PRODUCT.name} inicia em segundo plano.`, `With the menu bar icon on, ${PRODUCT.name} starts in the background.`)
        : t('Aplicado no app instalado; nesta versão de desenvolvimento a preferência só é salva.', 'Applied in the installed app; in this development build the preference is only saved.')}</span>
    </div>
    <div className="st-row st-row-col">
      <span className="st-label">{t('Outros apps e Atalhos', 'Other apps and Shortcuts')}</span>
      <span className="st-hint">{t("Automatize com o link workspace://capture?text=…&url=… (por exemplo, no app Atalhos).", "Automate with the link workspace://capture?text=…&url=… (for example, in the Shortcuts app).")}</span>
    </div>
    {feedback && <p className={`st-hint${feedback.error ? ' qc-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </>
}
