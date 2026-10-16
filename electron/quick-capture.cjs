const PRODUCT = require('../shared/product.json')
// Captura rápida no macOS: atalho global, janela flutuante estilo Spotlight e captura de seleção.
const electron = require('electron')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { atomicWrite, readJson } = require('./storage.cjs')
const core = require('./quick-capture-core.cjs')
const { createQuickDrafts } = require('./quick-drafts.cjs')

const WIDTH = 640, HEIGHT = 460

/**
 * deps: { userData(), dataDir(wsId), isLocked(wsId), storage(wsId), broadcast(wsId, change), activeWorkspace(), isDev,
 *         devURL, distDir, openRoute(wsId, route), showMain(command?), onPrefsChanged(prefs) }
 * As preferências globais (atalhos, menu, início) ficam na raiz com a cifra do dispositivo; o
 * rascunho e a caixa de entrada de cada espaço ficam na pasta dele (ver quick-drafts.cjs).
 */
function createQuickCapture(deps) {
  let markStarted
  const startedPromise = new Promise(resolve => { markStarted = resolve })
  let prefs = null, win = null, target = 'default', prefill = null, saving = false, registered = [], dictationPending = false
  const prefsFile = () => path.join(deps.userData(), 'quick-capture.json')
  const isLocked = ws => !!deps.isLocked?.(ws)
  const drafts = createQuickDrafts({ userData: deps.userData, dataDir: deps.dataDir, isLocked })
  const lockedMessage = () => `VAULT_LOCKED: Desbloqueie o ${PRODUCT.name} para salvar. O rascunho foi mantido. / Unlock ${PRODUCT.name} to save. Your draft was kept.`

  async function loadPrefs() {
    if (!prefs) prefs = core.normalizePrefs(await readJson(prefsFile()).catch(() => null))
    return prefs
  }
  /** Caixa de entrada do espaço (cifrada com ele); migra a entrada antiga guardada na raiz. */
  async function inboxFor(ws) {
    const stored = await drafts.loadInbox(ws)
    const legacy = prefs.inbox[ws]
    if (legacy) {
      if (!stored) await drafts.saveInbox(ws, legacy)
      const { [ws]: _moved, ...rest } = prefs.inbox
      prefs = { ...prefs, inbox: rest }
      await atomicWrite(prefsFile(), JSON.stringify(prefs))
      return stored ?? legacy
    }
    return stored ?? undefined
  }

  function quickURL() { return deps.isDev ? new URL('/quick.html', deps.devURL).href : null }
  function isQuickFrame(event) {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return false
    try {
      const url = new URL(event.senderFrame.url)
      if (deps.isDev) return url.origin === new URL(deps.devURL).origin && url.pathname === '/quick.html'
      return url.protocol === 'file:' && fileURLToPath(url) === path.join(deps.distDir, 'quick.html')
    } catch { return false }
  }
  function handle(channel, fn) {
    electron.ipcMain.handle(channel, (event, ...args) => {
      if (!isQuickFrame(event)) throw new Error('Origem de dados inválida')
      return fn(...args)
    })
  }

  async function workspaceMeta() { return await deps.storage(target).loadMeta() }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win
    const { BrowserWindow } = electron
    win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      // NSPanel não ativa o app: o foco volta sozinho para o app anterior ao fechar (como Spotlight/Raycast).
      ...require('./platform.cjs').quickChrome(), alwaysOnTop: true, skipTaskbar: true, hasShadow: true, roundedCorners: true,
      title: `${PRODUCT.name}`, webPreferences: { preload: path.join(__dirname, 'quick-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
    })
    win.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    // Durante o pedido de microfone do macOS a janela perde o foco sem que o usuário tenha saído.
    win.on('blur', () => { if (!saving && !dictationPending && win?.isVisible() && !win.webContents.isDevToolsOpened()) hide() })
    win.on('close', event => { if (!deps.quitting()) { event.preventDefault(); hide() } })
    win.on('closed', () => { win = null })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('will-attach-webview', event => event.preventDefault())
    if (deps.isDev) win.loadURL(quickURL())
    else win.loadFile(path.join(deps.distDir, 'quick.html'))
    return win
  }

  function position(window) {
    const { screen } = electron
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    window.setBounds({ x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(area.y + Math.max(40, area.height * 0.2)), width: WIDTH, height: HEIGHT })
  }

  async function show(data = null) {
    target = deps.activeWorkspace()
    prefill = data
    const window = ensureWindow()
    position(window)
    const reveal = () => {
      if (window.isDestroyed()) return
      window.webContents.send('npq:show', { prefill, workspaceId: target })
      window.show(); window.focus()
    }
    if (window.webContents.isLoading()) window.webContents.once('did-finish-load', reveal)
    else reveal()
  }
  function cancelDictation() { try { if (win && !win.isDestroyed()) deps.dictation?.cancel(win.webContents.id) } catch { /* sessão já encerrada */ } }
  function hide() { if (win && !win.isDestroyed() && win.isVisible()) { cancelDictation(); win.hide() } }
  function toggle() { if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hide(); else void show() }
  function captureSelection() { void show(core.clipboardCapture(electron.clipboard)) }
  function handleUrl(value) {
    const data = core.parseCaptureLink(value)
    if (!data) return false
    void startedPromise.then(() => show(data)); return true
  }

  function registerShortcuts() {
    const { globalShortcut } = electron
    for (const accelerator of registered) globalShortcut.unregister(accelerator)
    registered = []
    const status = {}
    for (const [key, fn] of [['shortcut', toggle], ['captureShortcut', captureSelection]]) {
      const accelerator = prefs[key]
      if (!accelerator) { status[key] = 'off'; continue }
      let ok = false
      try { ok = globalShortcut.register(accelerator, fn) } catch { ok = false }
      if (ok) registered.push(accelerator)
      status[key] = ok ? 'ok' : 'busy'
    }
    return status
  }
  let shortcutStatus = {}

  function applyLoginItem() {
    // Só o app empacotado entra nos itens de início; em desenvolvimento a preferência fica apenas salva.
    if (electron.app.isPackaged) electron.app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin })
  }

  async function getSettings() {
    await loadPrefs()
    const openAtLogin = electron.app.isPackaged ? electron.app.getLoginItemSettings().openAtLogin : prefs.openAtLogin
    return { shortcut: prefs.shortcut, captureShortcut: prefs.captureShortcut, showTray: prefs.showTray, trayTasks: prefs.trayTasks, trayCount: prefs.trayCount, openAtLogin, status: shortcutStatus, loginItemSupported: electron.app.isPackaged }
  }
  async function updateSettings(patch) {
    await loadPrefs()
    if (!patch || typeof patch !== 'object') throw new Error('Preferências inválidas')
    const next = { ...prefs }
    for (const key of ['shortcut', 'captureShortcut']) if (patch[key] !== undefined) {
      if (patch[key] !== '' && !core.isValidAccelerator(patch[key])) throw new Error('Atalho inválido / Invalid shortcut')
      next[key] = patch[key]
    }
    if (next.shortcut && next.shortcut === next.captureShortcut) throw new Error('Os dois atalhos são iguais / Both shortcuts are the same')
    for (const key of ['showTray', 'trayTasks', 'trayCount', 'openAtLogin']) if (typeof patch[key] === 'boolean') next[key] = patch[key]
    const previous = prefs
    prefs = core.normalizePrefs(next)
    shortcutStatus = registerShortcuts()
    const failed = ['shortcut', 'captureShortcut'].find(key => patch[key] && shortcutStatus[key] === 'busy')
    if (failed) { prefs = previous; shortcutStatus = registerShortcuts(); throw new Error('Este atalho já está em uso por outro app / This shortcut is already used by another app') }
    if (previous.openAtLogin !== prefs.openAtLogin) applyLoginItem()
    await atomicWrite(prefsFile(), JSON.stringify(prefs))
    deps.onPrefsChanged?.(prefs)
    return getSettings()
  }

  async function save(input) {
    saving = true
    try {
      await loadPrefs()
      if (isLocked(target)) throw new Error(lockedMessage())
      const store = deps.storage(target)
      const meta = await store.loadMeta().catch(error => { if (error?.code === 'VAULT_LOCKED') throw new Error(lockedMessage()); throw error })
      if (!meta) throw new Error(`Abra o ${PRODUCT.name} uma vez antes de capturar notas / Open ${PRODUCT.name} once before capturing notes`)
      const pageId = require('node:crypto').randomUUID()
      const inboxId = await inboxFor(target)
      const plan = core.applyQuickNote(meta, input, { inboxId, pageId })
      await store.saveDoc(pageId, plan.blocks)
      const { assignSequences } = await import('./meta-merge.mjs')
      let result = plan
      const next = await store.mutateMeta(current => {
        result = core.applyQuickNote(current, input, { inboxId, pageId })
        return assignSequences(current, result.meta)
      })
      if (result.inboxId && inboxId !== result.inboxId) await drafts.saveInbox(target, result.inboxId)
      deps.broadcast(target, { meta: next })
      await drafts.clear(target)
      return { pageId: result.pageId, parentId: result.parentId, workspaceId: target }
    } finally { saving = false }
  }
  function registerIpc() {
    handle('npq:init', async () => {
      const { draft, locked } = await drafts.load(target)
      // Bloqueado: nada do espaço é lido (nem idioma/tema/nome); a janela mostra só o aviso.
      const meta = locked ? null : await workspaceMeta().catch(error => { if (error?.code === 'VAULT_LOCKED') return null; throw error })
      const settings = meta?.settings ?? {}
      const locale = settings.locale === 'en-US' || (!meta && /^en/i.test((electron.app?.getPreferredSystemLanguages?.()[0] ?? electron.app?.getLocale?.() ?? ''))) ? 'en-US' : 'pt-BR'
      return { locale, theme: settings.theme ?? 'system', workspaceName: locked ? `${PRODUCT.name}` : settings.workspaceName || `${PRODUCT.name}`, draft, prefill, workspaceId: target, locked: locked || isLocked(target) }
    })
    handle('npq:search', async query => isLocked(target) ? [] : core.searchDestinations(await workspaceMeta(), typeof query === 'string' ? query.slice(0, 200) : ''))
    handle('npq:destination', async id => {
      if (isLocked(target)) return null
      const meta = await workspaceMeta()
      return typeof id === 'string' ? core.destinationInfo(meta, id) : null
    })
    handle('npq:saveDraft', async value => {
      if (!value || typeof value !== 'object' || JSON.stringify(value).length > 2 * 1024 * 1024) throw new Error('Rascunho inválido')
      return drafts.save(target, value)
    })
    handle('npq:save', input => save(input))
    handle('npq:close', () => hide())
    // Ditado local (mesmo helper do app principal, reconhecimento on-device). Só a janela rápida validada chega aqui;
    // a sessão é encerrada ao ocultar a janela, e o idioma e os painéis aceitos são listas fechadas.
    handle('npq:dictationStart', async input => {
      const locale = input?.locale
      if (!deps.dictation || !win || win.isDestroyed()) throw new Error('NATIVE_UNSUPPORTED: Dictation unavailable.')
      if (locale !== 'pt-BR' && locale !== 'en-US') throw new Error('UNSUPPORTED_LOCALE: Unsupported locale.')
      const sender = win.webContents
      dictationPending = true
      try { return await deps.dictation.start(sender.id, { locale }, payload => { if (!sender.isDestroyed()) sender.send('npq:dictationEvent', payload) }) } finally { dictationPending = false }
    })
    handle('npq:dictationStop', () => { if (win && !win.isDestroyed()) deps.dictation?.stop(win.webContents.id) })
    handle('npq:dictationCancel', () => cancelDictation())
    // Permissão negada: oculta a nota (o rascunho fica) e abre o painel certo; ao reabrir a nota o renderer tenta de novo.
    handle('npq:openPrivacySettings', async pane => {
      hide()
      return deps.openPrivacyPane?.(pane, undefined, ['microphone', 'speech', 'dictation'])
    })
    handle('npq:open', async pageId => {
      hide()
      if (typeof pageId === 'string') deps.openRoute(target, { type: 'page', id: pageId })
    })
  }

  async function start() {
    await loadPrefs()
    // Rascunho antigo em texto claro na raiz: migra para o espaço ativo (cifrado) e apaga.
    await drafts.purgeLegacy(deps.activeWorkspace()).catch(console.error)
    shortcutStatus = registerShortcuts()
    if (prefs.openAtLogin) applyLoginItem()
    markStarted()
    return prefs
  }
  function destroyWindow() { if (win && !win.isDestroyed()) win.destroy() }
  function stop() {
    try { electron.globalShortcut.unregisterAll() } catch { /* app encerrando */ }
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Grava rascunhos guardados só na memória (antes de bloquear/ativar/desativar a senha). */
  async function flushDrafts(ws) {
    if (ws) { await drafts.purgeLegacy(ws).catch(console.error); await drafts.flush(ws).catch(console.error) }
    else await drafts.flushAll()
  }

  return { flushDrafts, drafts, start, stop, destroyWindow, show, hide, toggle, captureSelection, handleUrl, registerIpc, getSettings, updateSettings, save, prefs: () => prefs, window: () => win }
}

module.exports = { createQuickCapture }
