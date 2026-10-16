import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.ts'
import { BackupRecovery, showRestoredNotice } from './components/backup/BackupSettings'
import { humanError } from './onboarding/humanError'
import { Component, useEffect, useState, type ReactNode, type CSSProperties } from 'react'
import { actions, api, getState, useStore } from './store'
import { effectiveEmbedMode } from './components/page/videoEmbed'
import { Sidebar } from './components/sidebar/Sidebar'
import { Topbar } from './components/page/Topbar'
import { PageView } from './components/page/PageView'
import { CanvasView } from './components/canvas/CanvasView'
import { DatabaseView } from './components/database/DatabaseView'
import { HomeView } from './components/home/HomeView'
import { SearchModal, requestSearchQuery } from './components/modals/SearchModal'
import { SettingsModal } from './components/modals/SettingsModal'
import { CalendarLinkSync } from './components/calendar/CalendarLinkSync'
import { InboxModal } from './components/modals/InboxModal'
import { ObjectTypesHost } from './components/objecttypes/ObjectTypesHost'
import { TypeCollectionPage } from './components/objecttypes/TypeCollectionPage'
import { SubpagesHost } from './subpages/SubpagesHost'
import { ExportDialogHost } from './components/modals/ExportDialog'
import { openExportDialog } from './export/run'
import { BundleImportHost, openBundleImport } from "./components/modals/ImportDialog"
import { ExternalFileHost } from './openfile/ExternalFileHost'
import { AppleNotesImportHost, openAppleNotesImport } from './components/modals/AppleNotesImportDialog'
import { t, useI18n } from './i18n'
import { PagePeek } from './components/PagePeek'
import { GraphView } from './components/graph/GraphView'
import { ProductivityView } from './components/productivity/ProductivityView'
import { scheduleBackfill } from './activity/session'
import { startMirror } from './mirror/controller'
import { LocalGraphPanel } from './components/graph/LocalGraphPanel'
import { useGraphSettings } from './graph/settings'
import { assertCanClose } from './close-guards'
import { SkipLink, MAIN_ID } from './a11y/SkipLink'
import { syncDocumentLang } from './a11y/lang'
import './styles/app-state.css'
import { FocusModeLayer } from './focus/FocusLayer'
import { focusMode } from './focus/focusMode'
import { installDimChrome } from './focus/dimChrome'
import { requestSettingsSection } from './quick/QuickCaptureSettings'
import { VaultGate } from './security/VaultGate'
import { PageLockGate } from './security/PageLockGate'
import { PageLockDialogHost } from './security/PageLockDialog'
import { TasksView } from './tasks/TasksView'
import { ReviewView } from './review/ReviewView'
import { startTaskIndex } from './tasks/taskIndex'
import { startTrayTasks } from './tray/trayTasks'
import { CalendarPanel, toggleCalendarPanel } from './daily/CalendarPanel'
// IA: painel "Perguntar às suas notas" (⌘J) e diálogos de consentimento/prévia (docs/AI.md).
import { AskPanel } from './components/ai/AskPanel'
import { AIPromptsHost } from './components/ai/AIPromptsHost'
import { AgentApprovalHost } from './agent/AgentApprovalHost'
import { toggleAskPanel, useAskPanel } from './ai/panel'
import { openDailyNote, openRelativeDay } from './daily/dailyNotes'
import { LogoMark } from './components/ui/Logo'
import { ToastHost } from './components/ui/Toast'
import { TemplatePromptHost } from './components/modals/TemplatePromptDialog'
import { VoiceTasksHost } from './voice/VoiceTasksDialog'
import { ScheduleTaskHost, TaskEventSyncHost } from './tasks/ScheduleTask'
import { RemindersSyncHost } from './reminders/RemindersUi'
import { ViewStateKeeper } from './navigation/ViewStateKeeper'
import { findShortcutHit, menuAccelerators, sanitizeOverrides, setShortcutOverridesSource, type ShortcutOverrides } from './shortcuts'

// Dicas, comandos e o menu leem os atalhos efetivos das settings (validadas uma vez por objeto).
let sanitizedFrom: unknown, sanitized: ShortcutOverrides = {}
setShortcutOverridesSource(() => {
  const raw = getState().settings.shortcutOverrides
  if (raw !== sanitizedFrom) { sanitizedFrom = raw; sanitized = sanitizeOverrides(raw) }
  return sanitized
})
/** Comandos que fecham o que estiver aberto: antes, confirmam que dá para sair (rascunho/edição pendente). */
const GUARDED_SHORTCUTS = new Set(['tab-next', 'search', 'new-page', 'new-tab', 'close-tab', 'reload', 'settings', 'back-forward', 'graph', 'new-window'])

class PageBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="app-state" role="alert"><h2>{t('Não foi possível exibir esta página', 'Unable to display this page')}</h2>
      <p>{t('O conteúdo salvo permanece no seu dispositivo.', 'Your saved content remains on this device.')}</p>
      <button onClick={() => actions.navigate({ type: 'home' })}>{t('Voltar ao início', 'Back to home')}</button></div>
  }
}

function runCommand(command: string) {
  // ⌘⇧V do menu Editar (Electron): a próxima colagem entra como texto simples (paste/useSmartPaste).
  if (command === 'paste-plain') { window.dispatchEvent(new Event('np:paste-plain')); return }
  const state = getState()
  // Comandos da barra de menus podem chegar antes de a janela terminar de carregar.
  if (!state.ready) { if (!state.initError && (command === 'search' || command === 'settings')) void actions.init().then(() => getState().ready && runCommand(command)); return }
  if (command === 'focus-mode') { focusMode.fromCommand(); return }
  if (command === 'settings') { requestSettingsSection('capture'); actions.setSettingsOpen(true); return }
  try { assertCanClose() } catch (error) { actions.reportSaveError(error); return }
  if (command === 'new-page') actions.openPage(actions.createPage(null))
  else if (command === 'new-tab') actions.openInNewTab({ type: 'home' })
  else if (command === 'reopen-tab') actions.reopenTab()
  else if (command === 'close-tab' && state.settings.activeTabId) actions.closeTab(state.settings.activeTabId)
  // O menu nativo captura ⌘K antes da página: dentro de um campo de texto de célula ele vira "Link".
  else if (command === 'search') { if (document.activeElement?.closest('.ed-inline')) window.dispatchEvent(new Event('np:cell-link')); else actions.setSearchOpen(true) }
  else if (command === 'export') openExportDialog()
  else if (command === 'new-window') void actions.flushAll().then(() => api.openWindow?.(state.route)).catch(actions.reportSaveError)
  else if (command === "import-bundle") { actions.setSettingsOpen(false); openBundleImport() }
  else if (command === "import-markdown") { actions.setSettingsOpen(false); openBundleImport("markdown") }
  else if (command === 'open-markdown-file') window.dispatchEvent(new Event(COMPAT.record023))
  else if (command === 'import-apple-notes') { actions.setSettingsOpen(false); openAppleNotesImport() }
  else if (command === "import-archive") { actions.setSettingsOpen(false); openBundleImport("archive") }
  // Fluxo diário (src/daily, src/tasks): menu Arquivo e atalhos.
  else if (command === 'daily-today' || command === 'daily-yesterday' || command === 'daily-tomorrow') void openRelativeDay(command === 'daily-today' ? 0 : command === 'daily-yesterday' ? -1 : 1).catch(actions.reportSaveError)
  else if (command === 'tasks') actions.navigate({ type: 'tasks' })
  else if (command === 'home') actions.navigate({ type: 'home' })
  else if (command === 'calendar-panel') toggleCalendarPanel()
  else if (command === 'ask') toggleAskPanel()
  else if (command === 'reload') void actions.flushAll().then(() => { assertCanClose(); window.location.reload() }).catch(actions.reportSaveError)
}

function useResolvedTheme(): 'light' | 'dark' {
  const { settings } = useStore()
  const [query] = useState(() => window.matchMedia('(prefers-color-scheme: dark)'))
  const [systemDark, setSystemDark] = useState(query.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  if (settings.theme === 'system') return systemDark ? 'dark' : 'light'
  return settings.theme
}

/** Segurança: a tela de desbloqueio vem antes de qualquer dado do espaço (src/security). */
export function App() { return <VaultGate><AppShell /></VaultGate> }

function AppShell() {
  const state = useStore()
  const theme = useResolvedTheme()
  const graphSettings = useGraphSettings()
  const { locale } = useI18n()
  const askPanel = useAskPanel()

  // `lang` do <html> segue o idioma do app (leitor de tela escolhe a voz por ele).
  useEffect(() => { syncDocumentLang(locale) }, [locale])
  useEffect(() => { showRestoredNotice() }, [])

  useEffect(() => {
    void actions.init()
    startTaskIndex()
    const stopTrayTasks = startTrayTasks()
    const removeClose = api.onBeforeClose?.(async () => { await actions.flushAll(); assertCanClose() })
    const removeCommand = api.onCommand?.(runCommand)
    const removeNavigate = api.onNavigate?.(route => {
      void actions.init().then(() => {
        assertCanClose()
        if (route.type === 'page' && !getState().pages[route.id]) throw new Error(t('A página deste link não está neste dispositivo.', 'The linked page is not on this device.'))
        if (route.type === 'page') actions.openPage(route.id, route)
        else if (route.type === 'daily') void openDailyNote(route.date).catch(actions.reportSaveError)
        else if (route.type === 'search') { requestSearchQuery(route.q); actions.setSearchOpen(true) }
        else if (route.type === 'new') actions.openPage(actions.createPage(null, route.title ? { title: route.title } : {}))
        else actions.navigate(route)
      }).catch(actions.reportSaveError)
    })
    const tick = async () => {
      if (!api.isSchedulerLeader || await api.isSchedulerLeader()) await actions.tickScheduledTasks()
    }
    const timer = setInterval(() => void tick().catch(actions.reportSaveError), 5000)
    return () => { removeClose?.(); removeCommand?.(); removeNavigate?.(); clearInterval(timer); stopTrayTasks() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  // Fonte dos títulos (Configurações → Aparência): Newsreader por padrão ou fonte do sistema.
  useEffect(() => {
    document.documentElement.dataset.titleFont = state.settings.titleFont === 'system' ? 'system' : "workspace"
  }, [state.settings.titleFont])
  // Atenção seletiva: esmaece o cromo após 3 s de digitação contínua (Configurações → Aparência).
  useEffect(() => installDimChrome(document.documentElement, () => getState().settings.dimWhileTyping !== false, () => focusMode.get().active), [])
  // Produtividade: reconstrução única do histórico anterior, em segundo plano (src/activity).
  useEffect(() => { if (state.ready && state.settings.productivity?.enabled !== false) scheduleBackfill() }, [state.ready])
  useEffect(() => (state.ready ? startMirror() : undefined), [state.ready]) // espelho Markdown: só age se o usuário o ligou
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  // Vídeos online: o processo principal só libera o <iframe> do player quando o modo permite (electron/local-policy.cjs).
  const embedMode = effectiveEmbedMode(state.settings)
  useEffect(() => { void Promise.resolve(api.setEmbedMode?.(embedMode)).catch(() => {}) }, [embedMode])
  // Atalhos personalizados que o menu nativo também registra (Arquivo, Visualizar…).
  const shortcutOverrides = state.settings.shortcutOverrides
  useEffect(() => { void Promise.resolve(api.setShortcutAccelerators?.(menuAccelerators())).catch(() => {}) }, [shortcutOverrides])

  useEffect(() => {
    // Atalhos globais da janela: a tabela efetiva (padrão + personalizados) vem de src/shortcuts.ts;
    // os comandos só de menu (exportar, fechar janela) chegam pelo menu nativo.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const hit = findShortcutHit(e)
      if (!hit) return
      const { id, slot } = hit
      if (GUARDED_SHORTCUTS.has(id)) {
        try { assertCanClose() } catch (error) { e.preventDefault(); actions.reportSaveError(error); return }
      }
      const run = (action: () => void) => { e.preventDefault(); action() }
      switch (id) {
        case 'tab-next': return run(() => {
          const tabs = getState().settings.openTabs ?? []
          const active = tabs.findIndex(t => t.id === getState().settings.activeTabId)
          const next = tabs[(active + (slot === 1 ? -1 : 1) + tabs.length) % tabs.length]
          if (next) actions.activateTab(next.id)
        })
        case 'search': return run(() => actions.setSearchOpen(!getState().searchOpen))
        case 'new-page': return run(() => actions.openPage(actions.createPage(null)))
        case 'new-window': if (api.openWindow) run(() => runCommand('new-window')); return
        case 'new-tab': case 'reopen-tab': case 'close-tab': case 'reload': case 'daily-today': case 'calendar-panel': return run(() => runCommand(id))
        case 'ask': return run(toggleAskPanel)
        case 'sidebar': if (getState().peekPageId) return; return run(() => actions.updateSettings({ sidebarCollapsed: !getState().settings.sidebarCollapsed }))
        case 'productivity': return run(() => { if (getState().route.type === 'productivity') actions.goBack(); else actions.navigate({ type: 'productivity' }) })
        case 'graph': return run(() => { if (getState().route.type === 'graph') actions.goBack(); else actions.navigate({ type: 'graph' }) })
        case 'settings': return run(() => actions.setSettingsOpen(true))
        case 'back-forward': return run(() => { if (slot === 1) actions.goForward(); else actions.goBack() })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Janela estreita: recolhe a barra lateral uma vez ao cruzar o limite (Lei de Hick/Fitts: o conteúdo precisa de espaço).
  // O usuário pode reabrir com ⌘\; só volta a recolher se a janela alargar e estreitar de novo.
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 760px)')
    const apply = () => { if (narrow.matches && !getState().settings.sidebarCollapsed) actions.updateSettings({ sidebarCollapsed: true }) }
    apply()
    narrow.addEventListener('change', apply)
    return () => narrow.removeEventListener('change', apply)
  }, [])

  if (!state.ready) return <div className="app-state" role={state.initError ? 'alert' : 'status'}>
    {!state.initError && <LogoMark size={44} className="np-loading-mark" />}
    <h1>{state.initError ? t('Não foi possível abrir suas páginas', 'Unable to open your pages') : t(`Abrindo o ${PRODUCT.name}…`, `Opening ${PRODUCT.name}…`)}</h1>
    {state.initError && <><p>{state.initError}</p><button onClick={() => void actions.init()}>{t('Tentar novamente', 'Try again')}</button>
      {window.api && <button onClick={() => void api.revealDataFolder().catch(actions.reportSaveError)}>{t('Abrir pasta de dados', 'Open data folder')}</button>}
      {window.api && <BackupRecovery />}</>}
  </div>

  const { route } = state
  return (
    <div className={`app${state.peekPageId && state.peekMode === 'side' ? ' has-side-peek' : ''}`} style={{ '--peek-width': `${state.peekWidth}px` } as CSSProperties}>
      <SkipLink />
      <Sidebar />
      <main className="app-main" id={MAIN_ID} tabIndex={-1} aria-label={t('Conteúdo', 'Content')}>
        <Topbar />
        {state.saveError && <div className="app-save-error" role="alert">
          <span title={state.saveError}>{state.conflictMeta ? <>{t('Falha ao salvar:', 'Save failed:')} {state.saveError}</> : humanError('save', state.saveError, t).text}</span>
          {state.conflictMeta ? <>
            <button onClick={() => void actions.exportConflict().catch(actions.reportSaveError)}>{t('Exportar minhas alterações', 'Export my edits')}</button>
            <button onClick={() => void actions.loadSavedMeta().catch(actions.reportSaveError)}>{t('Carregar versão salva', 'Load saved version')}</button>
          </> : <button onClick={() => void actions.flushAll().catch(actions.reportSaveError)}>{t('Tentar novamente', 'Try again')}</button>}
        </div>}
        <div className="app-content">
          <PageBoundary key={route.type === 'page' || route.type === 'objectType' ? route.id : route.type}>
          {route.type === 'page' && state.pages[route.id]?.database ? (
            <PageLockGate key={route.id} pageId={route.id}><DatabaseView key={route.id} pageId={route.id} /></PageLockGate>
          ) : route.type === 'page' && state.pages[route.id]?.canvas ? (
            <PageLockGate key={route.id} pageId={route.id}><CanvasView key={route.id} pageId={route.id} theme={theme} /></PageLockGate>
          ) : route.type === 'page' && state.pages[route.id] ? (
            <PageLockGate key={route.id} pageId={route.id}><PageView key={route.id} pageId={route.id} theme={theme} /></PageLockGate>
          ) : route.type === 'tasks' ? (
            <TasksView />
          ) : route.type === 'review' ? (
            <ReviewView />
          ) : route.type === 'graph' ? (
            <GraphView />
          ) : route.type === 'productivity' ? (
            <ProductivityView />
          ) : route.type === 'objectType' ? (
            <TypeCollectionPage key={route.id} typeId={route.id} />
          ) : (
            <HomeView />
          )}
          </PageBoundary>
        </div>
      </main>
      {state.settings.dailyFlow?.panelOpen && <CalendarPanel />}
      {askPanel.open && <AskPanel />}
      {graphSettings.local.open && route.type === 'page' && state.pages[route.id] && <LocalGraphPanel pageId={route.id} />}
      {state.peekPageId && <PageLockGate pageId={state.peekPageId} peek><PagePeek theme={theme} /></PageLockGate>}
      {state.searchOpen && <SearchModal />}
      {state.settingsOpen && <SettingsModal />}
      <CalendarLinkSync />
      {state.inboxOpen && <InboxModal />}
      <ExportDialogHost />
      <ObjectTypesHost />
      <SubpagesHost />
      <ToastHost />
      <TemplatePromptHost />
      <VoiceTasksHost />
      <ScheduleTaskHost />
      <TaskEventSyncHost />
      <RemindersSyncHost />
      <ViewStateKeeper />
      <BundleImportHost />
      <ExternalFileHost />
      <AppleNotesImportHost />
      <PageLockDialogHost />
      <FocusModeLayer />
      <AIPromptsHost />
      <AgentApprovalHost />
    </div>
  )
}
