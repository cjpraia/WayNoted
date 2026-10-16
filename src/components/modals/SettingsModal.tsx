import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Database, Download, Upload, FolderOpen, Info, Keyboard, Palette, Trash2, User, X, Zap } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import { t, useI18n } from '../../i18n'
import type { ActivityEntry, DocumentConflict, ThemeSetting } from '../../types'
import './SettingsModal.css'
import { QuickCaptureSettings, takeRequestedSettingsSection } from '../../quick/QuickCaptureSettings'
import { CalendarSettingsSection } from '../calendar/CalendarSettingsSection'
import { ShieldCheck } from 'lucide-react'
import { SecuritySettings } from '../../security/SecuritySettings'
import { ProductivitySettings } from '../productivity/ProductivitySettings'
import { ProductivityIcon } from '../productivity/ProductivityIcon'
import { CalendarCheck } from 'lucide-react'
import { DailyFlowSettings } from '../../daily/DailyFlowSettings'
import { Tag } from 'lucide-react'
import { TypesSettings } from '../objecttypes/TypesSettings'
import { ShortcutList } from '../shortcuts/ShortcutList'
import { Sparkles } from 'lucide-react'
import { AISettingsSection } from '../ai/AISettings'
import { UpdateCheck } from './UpdateCheck'
import { ThirdPartyNotices } from './ThirdPartyNotices'
import { Logo } from '../ui/Logo'
import { HelpCircle } from 'lucide-react'
import { HelpSettings } from './HelpSettings'
import { Select } from '../ui/Select'
import { Button, IconButton } from '../ui/Button'
import { BackupSettingsCard } from '../backup/BackupSettings'
import { MirrorSettingsCard } from '../mirror/MirrorSettings'
import { AgentSettingsCards } from '../../agent/AgentSettings'

type Section = 'account' | 'appearance' | 'data' | 'shortcuts' | 'about' | 'capture' | 'calendar' | 'security' | 'productivity' | 'daily' | 'types' | 'ai' | 'help'

/** Cartão de Configurações (Chunking): título, subtítulo e no máximo 7 linhas. */
function SettingsCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="st-card"><h3 className="st-card-h">{title}</h3><p className="st-card-sub">{subtitle}</p>{children}</section>
}

const SECTIONS = (): { id: Section; label: string; icon: typeof User | typeof ProductivityIcon }[] => [
  { id: 'account', label: t('Minha conta', 'My account'), icon: User },
  { id: 'appearance', label: t('Aparência', 'Appearance'), icon: Palette },
  { id: 'data', label: t('Dados', 'Data'), icon: Database },
  { id: 'security', label: t('Segurança e privacidade', 'Security & privacy'), icon: ShieldCheck },
  // IA: provedores (Ollama local por padrão; OpenRouter/Google opt-in), docs/AI.md
  { id: 'ai', label: t('IA', 'AI'), icon: Sparkles },
  { id: 'productivity', label: t('Produtividade', 'Productivity'), icon: ProductivityIcon },
  { id: 'daily', label: t('Fluxo diário', 'Daily flow'), icon: CalendarCheck },
  { id: 'types', label: t('Tipos', 'Types'), icon: Tag },
  { id: 'shortcuts', label: t('Atalhos', 'Shortcuts'), icon: Keyboard },
  { id: 'capture', label: t('Captura rápida', 'Quick capture'), icon: Zap },
  ...(window.api?.calendarStatus ? [{ id: 'calendar' as const, label: t('Calendário', 'Calendar'), icon: CalendarDays }] : []),
  { id: 'help', label: t('Ajuda', 'Help'), icon: HelpCircle },
  { id: 'about', label: t('Sobre', 'About'), icon: Info },
]

const THEMES = (): { id: ThemeSetting; label: string }[] => [
  { id: 'system', label: t('Usar configuração do sistema', 'Use system setting') },
  { id: 'light', label: t('Claro', 'Light') },
  { id: 'dark', label: t('Escuro', 'Dark') },
]

function ThemePreview({ kind }: { kind: ThemeSetting }) {
  const light = (
    <>
      <i className="st-pv-side" style={{ background: '#f9f8f7' }} />
      <i className="st-pv-main" style={{ background: '#fff' }}>
        <b style={{ background: 'rgba(55,53,47,.3)' }} />
        <b style={{ background: 'rgba(55,53,47,.15)', width: '70%' }} />
      </i>
    </>
  )
  const dark = (
    <>
      <i className="st-pv-side" style={{ background: '#202020' }} />
      <i className="st-pv-main" style={{ background: '#191919' }}>
        <b style={{ background: 'rgba(255,255,255,.35)' }} />
        <b style={{ background: 'rgba(255,255,255,.18)', width: '70%' }} />
      </i>
    </>
  )
  if (kind === 'system')
    return (
      <span className="st-pv">
        <span className="st-pv-half">{light}</span>
        <span className="st-pv-half st-pv-right">{dark}</span>
      </span>
    )
  return <span className="st-pv">{kind === 'light' ? light : dark}</span>
}

export function SettingsModal() {
  const { settings, pages } = useStore()
  useI18n()
  const [section, setSection] = useState<Section>(() => { const requested = takeRequestedSettingsSection(); return requested === 'capture' || requested === 'calendar' || requested === 'productivity' || requested === 'data' ? requested : 'account' })
  const [showNotices, setShowNotices] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [security, setSecurity] = useState<{ enabled: boolean; algorithm?: string; deviceCipher?: string } | null>(null)
  const [integration, setIntegration] = useState<{ enabled: boolean; url?: string } | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [conflicts, setConflicts] = useState<DocumentConflict[]>([])
  const [autoBackups, setAutoBackups] = useState<{ file: string; savedAt: number; size: number }[]>([])
  const [hookUrl, setHookUrl] = useState('')
  const [hookStatus, setHookStatus] = useState<{ hookId: string; sentAt?: number; error?: string }[]>([])
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = () => actions.setSettingsOpen(false)
  useEffect(() => {
    if (section !== 'data') return
    let canceled = false
    void actions.flushMeta().then(async () => {
      const [secure, localApi, events, backups, hooks, documents] = await Promise.all([api.securityInfo?.(), api.localApiInfo?.(), api.listActivity?.(), api.listAutoBackups?.(), api.webhookStatus?.(), api.listDocumentConflicts?.()])
      if (!canceled) { setSecurity(secure ?? null); setIntegration(localApi ?? null); setActivity(events ?? []); setAutoBackups(backups ?? []); setHookStatus(hooks ?? []); setConflicts(documents ?? []) }
    }).catch(error => !canceled && setFeedback({ text: String(error), error: true }))
    return () => { canceled = true }
  }, [section, settings.localApiEnabled, settings.webhooks])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      if (e.key === 'Tab') {
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([hidden]),select,[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previous?.focus() }
  }, [])

  const pageCount = Object.values(pages).filter((p) => selectors.isLive(p.id)).length
  const trash = selectors.trash()

  const perform = async (task: () => Promise<string>) => {
    setBusy(true); setFeedback(null)
    try { setFeedback({ text: await task() }) }
    catch (error) { setFeedback({ text: error instanceof Error ? error.message : t('Não foi possível concluir a operação.', 'Unable to complete the operation.'), error: true }) }
    finally { setBusy(false) }
  }

  const emptyTrash = () => {
    void perform(async () => {
      for (const p of selectors.trash()) await actions.deletePageForever(p.id)
      setConfirmTrash(false)
      return t('Lixeira esvaziada.', 'Trash emptied.')
    })
  }

  return (
    <div className="st-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} className="st-box" role="dialog" aria-modal="true" aria-label={t('Configurações', 'Settings')}>
        <nav className="st-nav" aria-label={t('Seções de configurações', 'Settings sections')}>
          <div className="st-nav-title">{t('Configurações', 'Settings')}</div>
          {SECTIONS().map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`st-nav-item${section === id ? ' is-active' : ''}`}
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
            >
              <Icon size={16} strokeWidth={1.7} aria-hidden /> {label}
            </button>
          ))}
        </nav>
        <div className="st-panel">
          <IconButton className="st-close" onClick={close} label={t('Fechar configurações', 'Close settings')}>
            <X size={18} aria-hidden />
          </IconButton>
          <div className="st-content">
            {section === 'account' && (
              <>
                <h2 className="st-h">{t('Minha conta', 'My account')}</h2>
                <div className="st-row st-row-col">
                  <label className="st-label" htmlFor="st-locale">{t('Idioma', 'Language')}</label>
                  <Select id="st-locale" value={settings.locale} onChange={e => actions.updateSettings({ locale: e.target.value === 'en-US' ? 'en-US' : 'pt-BR' })}>
                    <option value="pt-BR">Português (Brasil)</option><option value="en-US">English (United States)</option>
                  </Select>
                </div>
                <div className="st-row st-row-col">
                  <label className="st-label" htmlFor="st-user">{t('Nome preferido', 'Preferred name')}</label>
                  <input
                    id="st-user"
                    className="st-input"
                    value={settings.userName}
                    placeholder={t('Como devemos chamar você?', 'What should we call you?')}
                    onChange={(e) => actions.updateSettings({ userName: e.target.value })}
                  />
                  <span className="st-hint">{t('Usado na saudação da tela inicial.', 'Used in the home greeting.')}</span>
                </div>
                <div className="st-row st-row-col">
                  <label className="st-label" htmlFor="st-ws">{t('Nome do workspace', 'Workspace name')}</label>
                  <input
                    id="st-ws"
                    className="st-input"
                    value={settings.workspaceName}
                    placeholder={PRODUCT.name}
                    onChange={(e) => actions.updateSettings({ workspaceName: e.target.value })}
                  />
                </div>
                <div className="st-row st-row-col">
                  <label className="st-label"><input type="checkbox" checked={settings.pasteMarkdown !== false} onChange={e => actions.updateSettings({ pasteMarkdown: e.target.checked })} /> {t('Converter Markdown ao colar', 'Convert Markdown on paste')}</label>
                  <span className="st-hint">{t('Texto com títulos, listas, tabelas ou código entra já formatado. ⌘⇧V cola sempre como texto simples.', 'Text with headings, lists, tables or code is pasted formatted. ⌘⇧V always pastes plain text.')}</span>
                </div>
              </>
            )}
            {section === 'appearance' && (
              <>
                <h2 className="st-h">{t('Aparência', 'Appearance')}</h2>
                <div className="st-label">{t('Tema', 'Theme')}</div>
                <div className="st-hint st-mb">{t(`Escolha como o ${PRODUCT.name} deve aparecer neste Mac.`, `Choose how ${PRODUCT.name} appears on this Mac.`)}</div>
                <div className="st-themes" role="radiogroup" aria-label={t('Tema', 'Theme')}>
                  {THEMES().map((t) => (
                    <button
                      key={t.id}
                      role="radio"
                      aria-checked={settings.theme === t.id}
                      aria-label={t.label}
                      className={`st-theme${settings.theme === t.id ? ' is-selected' : ''}`}
                      onClick={() => actions.updateSettings({ theme: t.id })}
                    >
                      <ThemePreview kind={t.id} />
                      <span className="st-theme-label">{t.label}</span>
                    </button>
                  ))}
                </div>
                <div className="st-label">{t('Fonte dos títulos', 'Title font')}</div>
                <div className="st-hint st-mb">{t('Usada no título das páginas, na saudação do Meu dia e nos títulos das telas.', 'Used for page titles, the My day greeting and screen titles.')}</div>
                <div className="st-title-fonts" role="radiogroup" aria-label={t('Fonte dos títulos', 'Title font')}>
                  {([["workspace", `${PRODUCT.name}`, 'var(--font-display)'], ['system', t('Sistema', 'System'), 'var(--font-sans)']] as const).map(([id, label, family]) => {
                    const selected = (settings.titleFont ?? "workspace") === id
                    return <button key={id} type="button" role="radio" aria-checked={selected} className={`st-title-font${selected ? ' is-selected' : ''}`} onClick={() => actions.updateSettings({ titleFont: id })}>
                      <span className="st-title-font-sample" style={{ fontFamily: id === "workspace" ? "'Newsreader Variable', 'Newsreader', ui-serif, Georgia, serif" : family }}>{t('Bom dia', 'Good morning')}</span>
                      <span className="st-title-font-name">{label}{id === "workspace" ? ' · Newsreader' : ''}</span>
                    </button>
                  })}
                </div>
                <div className="st-row st-row-col">
                  <label className="st-label"><input type="checkbox" checked={settings.dimWhileTyping !== false} onChange={e => actions.updateSettings({ dimWhileTyping: e.target.checked })} /> {t('Atenuar a interface ao escrever', 'Dim the interface while writing')}</label>
                  <span className="st-hint">{t('Depois de 3 s de digitação contínua, a barra lateral, as abas e as ações do topo ficam mais discretas. Mover o mouse traz tudo de volta.', 'After 3 s of continuous typing, the sidebar, tabs and top actions fade. Moving the mouse brings them back.')}</span>
                </div>
              </>
            )}
            {section === 'data' && (
              <>
                <h2 className="st-h">{t('Dados', 'Data')}</h2>
                <p className="st-p">
                  {window.api ? t('Suas páginas e arquivos ficam neste Mac.', 'Your pages and files stay on this Mac.') : t('Nesta prévia, suas páginas ficam no armazenamento local deste navegador.', 'In this preview, your pages stay in this browser’s local storage.')} {t('Nada sai deste computador a menos que você ative um provedor de IA em nuvem (Configurações → IA); nesse caso, só o que você enviar a ele.', 'Nothing leaves this computer unless you turn on a cloud AI provider (Settings → AI); in that case, only what you send to it.')}
                </p>
                {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`st-feedback${feedback.error ? ' is-error' : ''}`}>{feedback.text}</p>}
                <SettingsCard title={t('Seus dados', 'Your data')} subtitle={t('Onde ficam e como são protegidos.', 'Where they live and how they are protected.')}>
                {security && <div className="st-row st-row-col"><span className="st-label">{t('Proteção dos arquivos', 'File protection')}</span><span className="st-hint">{security.deviceCipher === 'none' || !security.deviceCipher ? t('Por padrão os dados ficam no seu Mac em arquivos locais (só o seu usuário lê). Para cifrá-los, ative a senha do espaço em Segurança e privacidade. Backups exportados manualmente são portáveis e não criptografados.', 'By default your data stays on your Mac in local files (readable only by your user). To encrypt it, turn on the workspace password in Security & privacy. Manually exported backups are portable and unencrypted.') : t('Arquivos cifrados com AES-256-GCM e chave guardada no Keychain (opção ativada em Segurança e privacidade). Backups exportados manualmente são portáveis e não criptografados.', 'Files are encrypted with AES-256-GCM and a key kept in the Keychain (option turned on in Security & privacy). Manually exported backups are portable and unencrypted.')}</span></div>}
                <div className="st-row st-row-between">
                  <div><div className="st-label">{t("Importar do Markdown Vault", "Import from Markdown Vault")}</div><div className="st-hint">{t('Escolha a pasta do vault: notas viram páginas hierárquicas, [[links]] são ligados, anexos copiados e o front-matter vira tabela de propriedades.', 'Choose the vault folder: notes become nested pages, [[links]] are connected, attachments copied, and front-matter becomes a properties table.')}</div></div>
                  <Button disabled={busy} onClick={() => { close(); window.dispatchEvent(new Event(COMPAT.record034)) }}><Upload size={14} aria-hidden /> {t("Importar do Markdown Vault…", "Import from Markdown Vault…")}</Button>
                </div>
                {window.api?.appleNotesFolders && <div className="st-row st-row-between">
                  <div><div className="st-label">{t('Importar do Apple Notes', 'Import from Apple Notes')}</div><div className="st-hint">{t('Lê as notas direto do app Notas (o macOS pede permissão uma vez), sem alterar nada nele. Pastas viram páginas, imagens coladas são copiadas e notas protegidas por senha são ignoradas. Há prévia e dá para desfazer.', 'Reads your notes straight from the Notes app (macOS asks permission once) without changing anything in it. Folders become pages, pasted images are copied and password-protected notes are skipped. There is a preview and you can undo.')}</div></div>
                  <Button disabled={busy} onClick={() => { close(); window.dispatchEvent(new Event(COMPAT.record032)) }}><Upload size={14} aria-hidden /> {t('Importar do Apple Notes…', 'Import from Apple Notes…')}</Button>
                </div>}
                <div className="st-row st-row-between">
                  <div><div className="st-label">{t("Importar do ENEX Archive", "Import from ENEX Archive")}</div><div className="st-hint">{t("Escolha arquivos .enex exportados do ENEX Archive: cada nota vira uma página, com anexos, tarefas, tabelas e etiquetas. Há prévia antes de importar e dá para desfazer.", "Choose .enex files exported from ENEX Archive: each note becomes a page, with attachments, tasks, tables and tags. You get a preview before importing and can undo.")}</div></div>
                  <Button disabled={busy} onClick={() => { close(); window.dispatchEvent(new Event(COMPAT.record035)) }}><Upload size={14} aria-hidden /> {t("Importar do ENEX Archive…", "Import from ENEX Archive…")}</Button>
                </div>
                {window.api &&
                <div className="st-row st-row-between">
                  <div>
                    <div className="st-label">{t('Pasta de dados', 'Data folder')}</div>
                    <div className="st-hint">{t('Abra a pasta onde suas páginas ficam armazenadas.', 'Open the folder where your pages are stored.')}</div>
                  </div>
                  <Button onClick={() => void perform(async () => { await api.revealDataFolder(); return t('Pasta de dados aberta.', 'Data folder opened.') })} aria-label={t('Mostrar pasta de dados no Finder', 'Show data folder in Finder')}>
                    <FolderOpen size={14} aria-hidden /> {t('Mostrar pasta de dados no Finder', 'Show data folder in Finder')}
                  </Button>
                </div>
                }
                <div className="st-row st-row-between">
                  <div>
                    <div className="st-label">{t('Páginas', 'Pages')}</div>
                    <div className="st-hint">{pageCount} {pageCount === 1 ? t('página', 'page') : t('páginas', 'pages')}</div>
                  </div>
                </div>
                </SettingsCard>
                {window.api?.backupSettings && <SettingsCard title={t('Backup externo', 'External backup')} subtitle={t('Cópias verificadas fora da pasta de dados e restauração do espaço inteiro.', 'Verified copies outside the data folder and full workspace restore.')}><BackupSettingsCard /></SettingsCard>}
                {window.api?.mirrorSettings && <SettingsCard title={t('Espelho Markdown', 'Markdown mirror')} subtitle={t('Cópia somente leitura das páginas em arquivos .md, em texto claro. Opcional.', 'Read-only copy of your pages as .md files, in clear text. Optional.')}><MirrorSettingsCard /></SettingsCard>}
                <SettingsCard title={t('Cópias e importação', 'Copies and import')} subtitle={t('Histórico, backups e entrada de dados de outros lugares.', 'History, backups and importing from elsewhere.')}>
                <div className="st-row st-row-between">
                  <div><label className="st-label" htmlFor="st-history">{t('Histórico de versões', 'Version history')}</label><div className="st-hint">{t('Padrão: tudo nas últimas 24 h, 1 por hora por 7 dias, 1 por dia por 90 dias, até 200 por página. Versões fixadas nunca são apagadas. Aplica-se nas próximas gravações.', 'Default: everything for 24 h, hourly for 7 days, daily for 90 days, up to 200 per page. Pinned versions are never deleted. Applies to future saves.')}</div></div>
                  <Select id="st-history" value={settings.historyPolicy ?? 'default'} onChange={e => actions.updateSettings({ historyPolicy: e.target.value as 'default' | 'long' | 'unlimited' })}>
                    <option value="default">{t('Padrão', 'Default')}</option><option value="long">{t('Mais longo', 'Longer')}</option><option value="unlimited">{t('Sem limite', 'Unlimited')}</option>
                  </Select>
                  {settings.historyPolicy === 'unlimited' && <div className="st-hint">{t('Atenção: sem limite, o histórico (com imagens e anexos) pode ocupar muito espaço em disco.', 'Warning: with no limit, history (with images and attachments) can use a lot of disk space.')}</div>}
                </div>
                {window.api && <div className="st-row st-row-col">
                  <label className="st-label"><input type="checkbox" checked={settings.automaticBackup?.enabled ?? false} onChange={e => actions.updateSettings({ automaticBackup: { intervalHours: 24, keep: 7, ...settings.automaticBackup, enabled: e.target.checked } })} /> {t('Backup automático do workspace', 'Automatic workspace backup')}</label>
                  <span className="st-hint">{t('Salva conteúdo, imagens, propriedades e histórico na pasta backups enquanto o app está aberto.', 'Saves content, images, properties, and history in the backups folder while the app is open.')}</span>
                  {settings.automaticBackup?.enabled && <div className="st-row st-row-between">
                    <label>{t('Intervalo', 'Interval')} <Select value={settings.automaticBackup.intervalHours} onChange={e => actions.updateSettings({ automaticBackup: { ...settings.automaticBackup!, intervalHours: Number(e.target.value) } })}>
                      <option value={1}>{t('1 hora', '1 hour')}</option><option value={6}>{t('6 horas', '6 hours')}</option><option value={24}>{t('Diariamente', 'Daily')}</option>
                    </Select></label>
                    <label>{t('Cópias', 'Copies')} <Select value={settings.automaticBackup.keep} onChange={e => actions.updateSettings({ automaticBackup: { ...settings.automaticBackup!, keep: Number(e.target.value) } })}><option>7</option><option>30</option><option>90</option></Select></label>
                  </div>}
                  {autoBackups.length > 0 && <label>{t('Recuperar cópia como páginas adicionais', 'Recover a copy as additional pages')} <Select value="" onChange={e => {
                    const file = e.target.value
                    if (file) void perform(async () => { const backup = await api.loadAutoBackup!(file); const count = await actions.importBackup(backup); return t('{count} páginas recuperadas.', '{count} pages recovered.', { count }) })
                  }}><option value="">{t('Escolher backup…', 'Choose backup…')}</option>{autoBackups.map(backup => <option key={backup.file} value={backup.file}>{new Date(backup.savedAt).toLocaleString(settings.locale)}</option>)}</Select></label>}
                </div>}
                <div className="st-row st-row-between">
                  <div><div className="st-label">{t('Backup completo', 'Full backup')}</div><div className="st-hint">{t('Páginas, conteúdo, imagens locais, bancos de dados e configurações em um arquivo JSON.', 'Pages, content, local images, databases, and settings in one JSON file.')}</div></div>
                  <Button disabled={busy} onClick={() => void perform(async () => await actions.exportBackup() ? t('Backup exportado.', 'Backup exported.') : t('Exportação cancelada.', 'Export canceled.'))}><Download size={14} aria-hidden /> {t('Exportar backup', 'Export backup')}</Button>
                </div>
                <div className="st-row st-row-between">
                  <div><div className="st-label">{t('Importar backup', 'Import backup')}</div><div className="st-hint">{t('Adiciona as páginas do backup e mantém suas páginas atuais. Os links internos acompanham as novas cópias.', 'Adds the backup pages alongside your current pages. Internal links follow the new copies.')}</div></div>
                  <Button disabled={busy} onClick={() => importRef.current?.click()}><Upload size={14} aria-hidden /> {t('Importar backup', 'Import backup')}</Button>
                  <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => {
                    const file = e.target.files?.[0]; e.target.value = ''
                    if (file) void perform(async () => { const count = await actions.importBackup(JSON.parse(await file.text())); return t('{count} páginas importadas.', '{count} pages imported.', { count }) })
                  }} />
                </div>
                <div className="st-row st-row-between">
                  <div><div className="st-label">{t("Importar do Export Bundle", "Import from Export Bundle")}</div><div className="st-hint">{t("Traz páginas, bancos de dados, imagens e links de uma exportação do Export Bundle (Markdown & CSV ou HTML) para uma nova página.", "Brings pages, databases, images, and links from a Export Bundle export (Markdown & CSV or HTML) into a new page.")}</div></div>
                  <Button disabled={busy} onClick={() => { close(); window.dispatchEvent(new Event(COMPAT.record033)) }}><Upload size={14} aria-hidden /> {t("Importar do Export Bundle…", "Import from Export Bundle…")}</Button>
                </div>
                </SettingsCard>
                <SettingsCard title={t('Integrações locais', 'Local integrations')} subtitle={t('Programas deste Mac que podem ler suas páginas.', 'Programs on this Mac that can read your pages.')}>
                {api.localApiInfo && <div className="st-row st-row-col">
                  <label className="st-label"><input type="checkbox" checked={settings.localApiEnabled ?? false} onChange={e => actions.updateSettings({ localApiEnabled: e.target.checked })} /> {t('API local para integrações', 'Local API for integrations')}</label>
                  <span className="st-hint">{t('Acessível somente neste Mac, com token. Permite ler e editar páginas por programas locais.', 'Available only on this Mac, with a token. Allows local programs to read and edit pages.')}</span>
                  {integration?.enabled && <><code>{integration.url}/v1/pages</code><Button disabled={!api.copyLocalApiToken || busy} onClick={() => void perform(async () => { await api.copyLocalApiToken!(); return t('Token copiado.', 'Token copied.') })}>{t('Copiar token da API', 'Copy API token')}</Button></>}
                </div>}
                {api.webhookStatus && <div className="st-row st-row-col st-row-stack">
                  <div className="st-label">{t('Webhooks locais', 'Local webhooks')}</div>
                  <span className="st-hint">{t('Envia eventos assinados para programas neste Mac. Somente http://127.0.0.1 com porta; sem endereços externos.', 'Sends signed events to programs on this Mac. Only http://127.0.0.1 with a port; no external addresses.')}</span>
                  {(settings.webhooks ?? []).map(hook => <div key={hook.id} className="st-webhook"><label><input type="checkbox" checked={hook.enabled} onChange={e => actions.updateSettings({ webhooks: settings.webhooks!.map(item => item.id === hook.id ? { ...item, enabled: e.target.checked } : item) })}/>{hook.url}</label><Button onClick={() => void perform(async () => { if (api.copyText) await api.copyText(hook.secret); else await navigator.clipboard.writeText(hook.secret); return t('Segredo copiado.', 'Secret copied.') })}>{t('Copiar segredo', 'Copy secret')}</Button><Button onClick={() => actions.updateSettings({ webhooks: settings.webhooks!.filter(item => item.id !== hook.id) })}>{t('Remover', 'Remove')}</Button><span className="st-hint">{hookStatus.filter(item => item.hookId === hook.id).at(-1)?.error ?? t('Entrega local com repetição em caso de falha.', 'Local delivery with retry on failure.')}</span></div>)}
                  <input className="st-input" value={hookUrl} onChange={e => setHookUrl(e.target.value)} placeholder="http://127.0.0.1:8000/events" aria-label={t('Endereço do webhook local', 'Local webhook address')} />
                  <Button disabled={!hookUrl.trim() || (settings.webhooks?.length ?? 0) >= 10} onClick={() => {
                    try {
                      const url = new URL(hookUrl.trim())
                      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash) throw new Error(t('Use http://127.0.0.1 com uma porta local.', 'Use http://127.0.0.1 with a local port.'))
                      actions.updateSettings({ webhooks: [...settings.webhooks ?? [], { id: crypto.randomUUID(), url: url.href, secret: crypto.randomUUID() + crypto.randomUUID(), enabled: true, createdAt: Date.now() }] }); setHookUrl('')
                    } catch (error) { setFeedback({ text: String(error), error: true }) }
                  }}>{t('Adicionar webhook', 'Add webhook')}</Button>
                </div>}
                </SettingsCard>
                {api.agentOverview && <AgentSettingsCards Card={SettingsCard} />}
                <SettingsCard title={t('Atividade e recuperação', 'Activity and recovery')} subtitle={t('O que mudou e o que pode ser recuperado.', 'What changed and what can be recovered.')}>
                {api.listActivity && <div className="st-row st-row-col">
                  <div className="st-label">{t('Atividade local', 'Local activity')}</div>
                  <label className="st-hint">{t('Reter eventos', 'Keep events')} <Select value={settings.activityLimit ?? 2000} onChange={e => actions.updateSettings({ activityLimit: Number(e.target.value) })}><option value={0}>{t('Sem limite', 'Unlimited')}</option><option value={500}>500</option><option value={2000}>2000</option><option value={10000}>10000</option></Select></label>
                  <ol className="st-activity">{activity.slice(0, 30).map(item => <li key={item.id}><button onClick={() => { if (pages[item.pageId]) { actions.openPage(item.pageId); close() } }}>{item.pageTitle || t('Sem título', 'Untitled')}</button><span>{new Date(item.at).toLocaleString(settings.locale)} · {item.author} · {({ 'page.created': t('Página criada', 'Page created'), 'page.updated': t('Propriedades alteradas', 'Properties changed'), 'page.trashed': t('Movida para a lixeira', 'Moved to trash'), 'page.restored': t('Restaurada', 'Restored'), 'page.deleted': t('Excluída', 'Deleted'), 'content.updated': t('Conteúdo editado', 'Content edited'), 'ai.cloud.request': t('Pedido de IA em nuvem ({fields})', 'Cloud AI request ({fields})', { fields: (item.fields ?? []).join(', ') }) } as Record<string, string>)[item.action] ?? item.action}</span></li>)}</ol>
                  <Button onClick={() => void perform(async () => { await api.exportFile(`${PRODUCT.name}-activity.json`, JSON.stringify(await api.listActivity?.(), null, 2)); return t('Atividade exportada.', 'Activity exported.') })}>{t('Exportar atividade completa', 'Export full activity')}</Button>
                </div>}
                {conflicts.length > 0 && <div className="st-row st-row-col">
                  <div className="st-label">{t('Edições preservadas de páginas excluídas', 'Preserved edits from deleted pages')}</div>
                  <p className="st-hint">{t('Outra janela excluiu a página enquanto você editava. Recupere o conteúdo como uma nova página; a cópia de segurança será mantida.', 'Another window deleted the page while you were editing. Recover the content as a new page; the recovery copy will be kept.')}</p>
                  {conflicts.map(record => <div key={record.id} className="st-row st-row-between"><span>{record.page.title || t('Sem título', 'Untitled')} · {new Date(record.savedAt).toLocaleString(settings.locale)}</span><Button disabled={busy} onClick={() => void perform(async () => {
                    const recovered = { ...record.page, id: record.pageId, parentId: null, locked: false, trashed: false, trashedAt: null }
                    await actions.importBackup({ format: COMPAT.record011, version: 1, exportedAt: new Date().toISOString(), meta: { pages: { [record.pageId]: recovered }, settings: { ...settings, personalTemplates: [] } }, documents: { [record.pageId]: record.blocks } })
                    return t('Edições recuperadas como nova página.', 'Edits recovered as a new page.')
                  })}>{t('Recuperar', 'Recover')}</Button></div>)}
                </div>}
                </SettingsCard>
                <SettingsCard title={t('Lixeira', 'Trash')} subtitle={t('A ação destrutiva fica por último.', 'The destructive action comes last.')}>
                <div className="st-row st-row-between">
                  <div>
                    <div className="st-label">{t('Lixeira', 'Trash')}</div>
                    <div className="st-hint">{trash.length} {trash.length === 1 ? t('item na lixeira', 'item in trash') : t('itens na lixeira', 'items in trash')}</div>
                  </div>
                  {confirmTrash ? (
                    <div className="st-confirm">
                      <span className="st-hint">{t('Excluir {count} itens para sempre?', 'Permanently delete {count} items?', { count: trash.length })}</span>
                      <Button onClick={() => setConfirmTrash(false)} aria-label={t('Cancelar', 'Cancel')}>{t('Cancelar', 'Cancel')}</Button>
                      <Button variant="danger" disabled={busy} onClick={emptyTrash} aria-label={t('Confirmar esvaziar lixeira', 'Confirm empty trash')}>{t('Esvaziar', 'Empty')}</Button>
                    </div>
                  ) : (
                    <Button variant="danger-quiet" disabled={trash.length === 0} onClick={() => setConfirmTrash(true)} aria-label={t('Esvaziar lixeira', 'Empty trash')}>
                      <Trash2 size={14} aria-hidden /> {t('Esvaziar lixeira', 'Empty trash')}
                    </Button>
                  )}
                </div>
                </SettingsCard>
              </>
            )}
            {section === 'security' && <SecuritySettings />}
            {section === 'ai' && <AISettingsSection />}
            {section === 'productivity' && <ProductivitySettings />}
            {section === 'daily' && <DailyFlowSettings />}
            {section === 'types' && <TypesSettings />}
            {section === 'shortcuts' && (
              <>
                <h2 className="st-h">{t('Atalhos', 'Shortcuts')}</h2>
                <ShortcutList editable />
              </>
            )}
            {section === 'calendar' && <CalendarSettingsSection />}
            {section === 'capture' && (
              <>
                <h2 className="st-h">{t('Captura rápida', 'Quick capture')}</h2>
                <QuickCaptureSettings />
              </>
            )}
            {section === 'help' && <HelpSettings />}
            {section === 'about' && (
              <>
                <h2 className="st-h">{t('Sobre', 'About')}</h2>
                {showNotices ? <ThirdPartyNotices onClose={() => setShowNotices(false)} /> : <>
                <div className="st-about">
                  <Logo size={36} className="st-about-name" />
                  <div className="st-hint">{t('Versão 1.0.0', 'Version 1.0.0')}</div>
                  <p className="st-p">{t('App de notas local para macOS', 'Local notes app for macOS')}</p>
                  <Button onClick={() => setShowNotices(true)}>{t('Avisos de terceiros e licenças', 'Third-party notices and licenses')}</Button>
                </div>
                <UpdateCheck />
                </>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
