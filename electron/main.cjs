const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
require('./brand.cjs').legacyEnv()
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeTheme, screen, Notification, safeStorage: electronSafeStorage, clipboard, systemPreferences, powerMonitor } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const localPolicy = require('./local-policy.cjs')
const { atomicWrite, readJson, drain } = require('./storage.cjs')
const { drainDocuments } = require('./document-history.cjs')
const { createWorkspaceStorage, drainWorkspaces, metaChangedByDocument } = require('./workspace-storage.cjs')
const { parseDeepLink, sanitizeWindowRoute, metaHasObjectType } = require('./deep-links.cjs')
const { randomUUID } = require('node:crypto')
const secureStorage = require('./secure-storage.cjs')
const { createKeychain } = require('./keychain.cjs')
const vault = require('./vault.cjs')
const browserStorage = require('./browser-storage.cjs')
const pageLocks = require('./vault-pages.cjs')
const { registerVaultIpc } = require('./vault-ipc.cjs')
const { startLocalApi } = require('./local-api.cjs')
const { createAgentAccess } = require('./agent-access.cjs')
const { registerAgentIpc } = require('./agent-ipc.cjs')
const { createOpenFiles, registerOpenFileIpc, isOpenablePath } = require('./open-file.cjs')
const { registerNoticesIpc } = require('./notices-ipc.cjs')
const { registerAppleNotesIpc } = require('./apple-notes.cjs')
const openFiles = createOpenFiles()
const { registerAIIpc } = require('./ai/ipc.cjs')
let aiIpc = null
const { registerBackupIpc } = require('./backup-ipc.cjs')
const { registerMirrorIpc } = require('./mirror-ipc.cjs')
let backupService = null
const { deliverWebhooks } = require('./local-webhooks.cjs')
const webhookBusy = new Set()
const transcriptionControllers = new Map()
const transcribeAudio = require('./transcription.cjs').createTranscriber()
const { fetchLinkPreview, destination } = require('./link-preview.cjs')
const { registerExportIpc } = require('./export.cjs')
const { registerBundleImport } = require("./bundle-import.cjs")
const { registerUpdateCheck } = require('./update-check.cjs')
const { registerCalendarIpc } = require('./calendar.cjs')
const { registerRemindersIpc } = require('./apple-reminders.cjs')
const { registerDictationIpc, createDefaultDictationService } = require('./dictation.cjs')
const { registerPrivacySettingsIpc, openPrivacyPane } = require('./native-helper.cjs')
const { createQuickCapture } = require('./quick-capture.cjs')
const { createTray } = require('./tray.cjs')
const { createTrayTasks } = require('./tray-tasks.cjs')
const ocr = require('./ocr.cjs').createOcr()
let securityStatus = { enabled: false, reason: 'initializing' }
// Único acesso ao Keychain: invólucro preguiçoso (nada é chamado na inicialização no modo padrão).
const safeStorage = createKeychain({ real: electronSafeStorage, testHooks: !app.isPackaged })
// Um só serviço de ditado: a janela principal e a nota rápida (sessões por janela).
const dictationService = createDefaultDictationService()
const localApis = new Map()
const agentAccesses = new Map()
let deviceCipherBusy = false

const profile = require('./brand.cjs').resolveProfile(app.getPath('appData'), process.env.WORKSPACE_USER_DATA)
// Preserve the encryption identity while keeping paths independent of the display name.
app.setName(profile.keychainName)
app.setPath('userData', profile.directory)

const IS_DEV = process.env.WORKSPACE_DEV === '1'
const DEV_URL = process.env.WORKSPACE_DEV_URL || 'http://localhost:5310'
const ENTRY_FILE = path.resolve(__dirname, '..', 'dist', 'index.html')
const POLICY = { isDev: IS_DEV, devURL: DEV_URL, entryFile: ENTRY_FILE }

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

/* ------------------------------------------------------------------ */
/* Armazenamento                                                       */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const contexts = new Map(), storages = new Map()
// Modo de incorporação de vídeos por janela (informado pelo renderer; padrão 'always').
const embedModes = new Map()
const catalogFile = () => path.join(app.getPath('userData'), 'workspaces.json')
const dataDir = (id = 'default') => {
  if (id !== 'default' && !UUID_RE.test(id)) throw new Error('Workspace inválido')
  return id === 'default' ? path.join(app.getPath('userData'), 'data') : path.join(app.getPath('userData'), 'workspaces', id, 'data')
}
function storage(id = 'default') { if (!storages.has(id)) storages.set(id, createWorkspaceStorage(dataDir(id))); return storages.get(id) }
function context(event) { const value = contexts.get(event.sender.id); if (!value) throw new Error('Janela indisponível'); return value }
// Janelas auxiliares (nota rápida) não têm contexto e não contam como janela principal.
function focused() { const isMain = win => win && contexts.has(win.webContents.id); const win = BrowserWindow.getFocusedWindow(); return isMain(win) ? win : BrowserWindow.getAllWindows().find(isMain) }
function focusedWorkspace() { const win = focused(); return win ? contexts.get(win.webContents.id)?.workspaceId ?? 'default' : 'default' }
async function workspaceList() {
  const catalog = await readJson(catalogFile()) ?? []
  if (!Array.isArray(catalog)) throw new Error('Lista de workspaces inválida; arquivo preservado.')
  const result = [{ id: 'default', name: `${PRODUCT.name}`, createdAt: 0 }, ...catalog]
  for (const item of result) {
    if (vault.isLocked(dataDir(item.id))) { item.locked = true; continue }
    const meta = await storage(item.id).loadMeta(); if (meta?.settings.workspaceName) item.name = meta.settings.workspaceName === COMPAT.record002 ? `${PRODUCT.name}` : meta.settings.workspaceName
  }
  return result
}
function broadcast(workspaceId, change, except) {
  for (const [senderId, ctx] of contexts) if (ctx.workspaceId === workspaceId && senderId !== except && !ctx.win.isDestroyed()) ctx.win.webContents.send('np:dataChanged', change)
}
function nativeT(pt, en, win = focused()) { return contexts.get(win?.webContents.id)?.locale === 'en-US' ? en : pt }

function isInternalURL(value) {
  return localPolicy.isInternalURL(value, POLICY)
}

function trustedHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.senderFrame !== event.sender.mainFrame || !isInternalURL(event.senderFrame.url)) throw new Error('Origem de dados inválida')
    return handler(event, ...args)
  })
}

function registerIpc() {
  // Segurança e privacidade: senha do espaço, auto-bloqueio, Touch ID e páginas protegidas.
  registerVaultIpc({ userData: () => app.getPath('userData'), session: require('electron').session?.defaultSession, trustedHandler, contexts, dataDir, storage, flushRenderer, broadcast, configureLocalApi, safeStorage, systemPreferences, powerMonitor, nativeT, drainAll: () => quickCapture.flushDrafts().then(drainWorkspaces).then(drainDocuments).then(drain), beforeVaultChange: id => quickCapture.flushDrafts(id), onUnlocked: id => quickCapture.flushDrafts(id) })
  registerExportIpc({ trustedHandler, context, dialog, app, shell, atomicWrite, nativeT })
  // Backup externo verificado + restauração completa (docs/DEVELOPMENT.md F3).
  backupService = registerBackupIpc({ trustedHandler, context, contexts, dataDir, userData: () => app.getPath('userData'), dialog, shell, flushRenderer, drainAll: () => quickCapture.flushDrafts().then(drainWorkspaces).then(drainDocuments).then(drain), resetWorkspace: id => storages.delete(id) })
  // Espelho Markdown em texto claro, opt-in e somente leitura (docs/DEVELOPMENT.md D1).
  registerMirrorIpc({ trustedHandler, context, dataDir, userData: () => app.getPath('userData'), dialog, shell, app })
  // Agentes (A1/A2): clientes com escopos, aprovação de escritas, registro de chamadas, conector MCP e CLI no PATH.
  registerAgentIpc({ trustedHandler, context, accessFor: agentAccessFor, apiInfo: localApiState, dialog, nativeT, app })
  // B5: abrir .md avulso sem importar (o renderer só conhece fileId, nunca caminhos).
  registerOpenFileIpc({ trustedHandler, context, dialog, nativeT, openFiles })
  registerNoticesIpc({ trustedHandler, app, shell })
  // D3b: importar Apple Notes por Automação (somente leitura; o macOS pede a permissão uma vez).
  registerAppleNotesIpc({ trustedHandler })
  registerBundleImport({ handle: trustedHandler, dialog, windowFor: event => context(event).win, translate: nativeT })
  registerUpdateCheck({ trustedHandler, shell, app })
  registerCalendarIpc(trustedHandler)
  registerRemindersIpc(trustedHandler)
  registerDictationIpc(trustedHandler, dictationService)
  registerPrivacySettingsIpc(trustedHandler)
  trustedHandler('np:setShortcutAccelerators', (_e, value, recording) => {
    const next = {}
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const id of MENU_SHORTCUT_IDS) {
      const accelerator = value[id]
      if (typeof accelerator === 'string' && /^(?:(?:CmdOrCtrl|Ctrl|Alt|Shift)\+){0,4}(?:[A-Z0-9]|F\d{1,2}|Space|Tab|Return|Escape|Up|Down|Left|Right|Plus|Backspace|Delete|[\\[\],.;'`/=-])$/.test(accelerator)) next[id] = accelerator
    }
    const recordingNext = recording === true
    if (JSON.stringify(next) === JSON.stringify(shortcutAccelerators) && recordingNext === recordingShortcut) return
    shortcutAccelerators = next
    recordingShortcut = recordingNext
    buildMenu()
  })
  trustedHandler('np:setEmbedMode', (e, mode) => { embedModes.set(e.sender.id, ['always', 'click', 'never'].includes(mode) ? mode : 'never') })
  trustedHandler('np:fetchLinkPreview', (_e, url) => fetchLinkPreview(url))
  trustedHandler('np:openExternalPage', async (_e, url) => {
    await destination(url)
    await shell.openExternal(url)
  })
  trustedHandler('np:pickTranscriptionModel', async e => {
    const ctx = context(e)
    const result = await dialog.showOpenDialog(ctx.win, { properties: ['openFile'], filters: [{ name: 'Whisper GGML', extensions: ['bin'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    ctx.transcriptionModels ??= new Set(); ctx.transcriptionModels.add(result.filePaths[0]); return result.filePaths[0]
  })
  trustedHandler('np:transcribeAudio', async (e, input) => {
    const ctx = context(e)
    if (!ctx.transcriptionModels?.has(input?.modelPath)) throw new Error(nativeT('Selecione um modelo Whisper local nesta janela.', 'Select a local Whisper model in this window.', ctx.win))
    transcriptionControllers.get(e.sender.id)?.abort()
    const controller = new AbortController(); transcriptionControllers.set(e.sender.id, controller)
    try { return await transcribeAudio(input, controller.signal) }
    finally { if (transcriptionControllers.get(e.sender.id) === controller) transcriptionControllers.delete(e.sender.id) }
  })
  trustedHandler('np:cancelTranscription', e => transcriptionControllers.get(e.sender.id)?.abort())
  // IA: provedores configuráveis (Ollama local por padrão; nuvem opt-in). docs/AI.md
  // Chave de IA no arquivo só se ele já é cifrado por algo que o usuário ativou (senha do espaço ou cifra do Keychain).
  aiIpc = registerAIIpc({ trustedHandler, context, dataDir, storage, safeStorage, isFileProtected: dir => vault.isEnabled(dir) || secureStorage.mode() === 'keychain' })
  trustedHandler('np:securityInfo', () => ({ ...securityStatus, deviceCipher: secureStorage.mode() }))
  // Cifra do dispositivo (Keychain): desligada por padrão; ligar é opt-in explícito (docs/SECURITY.md).
  trustedHandler('np:deviceCipherStatus', () => secureStorage.deviceCipherStatus())
  trustedHandler('np:deviceCipherSet', async (_e, enabled) => {
    if (deviceCipherBusy) throw new Error('DEVICE_CIPHER_BUSY')
    deviceCipherBusy = true
    try {
      await Promise.all([...contexts.values()].map(ctx => flushRenderer(ctx.win)))
      await quickCapture.flushDrafts().then(drainWorkspaces).then(drainDocuments).then(drain)
      securityStatus = await secureStorage.setDeviceCipher(app.getPath('userData'), safeStorage, !!enabled)
      return secureStorage.deviceCipherStatus()
    } finally { deviceCipherBusy = false }
  })
  trustedHandler('np:deviceCipherRemoveBackups', async () => { await secureStorage.removeMigrationBackups(app.getPath('userData')); return secureStorage.deviceCipherStatus() })
  trustedHandler('np:deviceCipherOpenFolder', () => shell.openPath(app.getPath('userData')).then(() => true))
  trustedHandler('np:quickCaptureSettings', () => quickCapture.getSettings())
  trustedHandler('np:updateQuickCaptureSettings', (_e, patch) => quickCapture.updateSettings(patch))
  trustedHandler('np:showQuickCapture', () => quickCapture.show().then(() => true))
  // Só informa se existe rascunho de captura pendente (sem expor o texto) — cartão "Continuar" do Meu dia.
  trustedHandler('np:quickDraftInfo', async e => {
    try {
      const { draft, locked } = await quickCapture.drafts.load(context(e).workspaceId)
      return !locked && !!draft && !!(String(draft.title ?? '').trim() || String(draft.body ?? '').trim())
    } catch { return false }
  })
  trustedHandler('np:localApiInfo', e => localApiState(context(e).workspaceId))
  trustedHandler('np:copyLocalApiToken', async e => {
    const id = context(e).workspaceId, meta = await storage(id).loadMeta()
    if (!meta?.settings.localApiEnabled) throw new Error('API local desativada')
    await configureLocalApi(id, true)
    const token = localApis.get(id)?.token
    if (!token) throw new Error('Token da API indisponível')
    clipboard.writeText(token)
  })
  trustedHandler('np:ocrImage', (_e, dataUrl) => ocr.recognize(dataUrl))
  // C3a: retrato das tarefas de hoje (renderer -> main) e resultado da conclusão feita pelo menu da barra.
  trustedHandler('np:traySetTasks', (event, payload) => {
    const ctx = contexts.get(event.sender.id)
    if (!ctx) return false
    trayTasks.set(event.sender.id, ctx.workspaceId, payload)
    tray.refreshTitle()
    return true
  })
  trustedHandler('np:trayTaskResult', (event, result) => {
    if (!result || typeof result !== 'object' || result.ok !== false || !contexts.has(event.sender.id)) return false
    if (Notification.isSupported()) new Notification({ title: nativeT('Não foi possível concluir a tarefa', 'Could not complete the task'), body: String(result.message ?? '').slice(0, 200), silent: true }).show()
    return true
  })
  trustedHandler('np:copyText', (_e, value) => {
    if (typeof value !== 'string' || value.length > 10000) throw new Error('Texto inválido')
    clipboard.writeText(value)
  })
  trustedHandler('np:listActivity', e => storage(context(e).workspaceId).listActivity())
  trustedHandler('np:productivityLoad', e => storage(context(e).workspaceId).productivity.load())
  trustedHandler('np:productivityRecord', (e, delta) => storage(context(e).workspaceId).productivity.record(delta))
  trustedHandler('np:productivityBackfill', (e, days) => storage(context(e).workspaceId).productivity.backfill(days))
  trustedHandler('np:productivityClear', e => storage(context(e).workspaceId).productivity.clear())
  trustedHandler('np:saveMetaConflict', (e, meta) => storage(context(e).workspaceId).saveMetaConflict(meta))
  trustedHandler('np:listDocumentConflicts', e => storage(context(e).workspaceId).listDocumentConflicts())
  trustedHandler('np:snapshotBackup', e => storage(context(e).workspaceId).backup())
  trustedHandler('np:webhookStatus', async e => Object.values(await readJson(path.join(dataDir(context(e).workspaceId), 'webhook-deliveries.json')) ?? {}).slice(-50))
  trustedHandler('np:listAutoBackups', async e => {
    const directory = path.join(dataDir(context(e).workspaceId), 'backups')
    let names
    try { names = await fsp.readdir(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    return Promise.all(names.filter(file => /^\d{13}\.json$/.test(file)).sort().reverse().map(async file => ({ file, savedAt: Number(file.slice(0, 13)), size: (await fsp.stat(path.join(directory, file))).size })))
  })
  trustedHandler('np:loadAutoBackup', async (e, file) => {
    if (!/^\d{13}\.json$/.test(file)) throw new Error('Backup inválido')
    const value = await readJson(path.join(dataDir(context(e).workspaceId), 'backups', file))
    if (value?.format !== COMPAT.record011) throw new Error('Backup indisponível')
    return value
  })
  trustedHandler('np:draftLoad', (e, id, owner) => {
    const ctx = context(e); ctx.draftOwner = owner
    const active = [...contexts.values()].filter(c => c.workspaceId === ctx.workspaceId && c !== ctx).map(c => c.draftOwner).filter(Boolean)
    return storage(ctx.workspaceId).draftLoad(id, owner, active)
  })
  trustedHandler('np:draftSave', (e, id, owner, blocks) => { const ctx = context(e); ctx.draftOwner = owner; return storage(ctx.workspaceId).draftSave(id, owner, blocks) })
  trustedHandler('np:draftDelete', (e, id, owner) => storage(context(e).workspaceId).draftDelete(id, owner))
  trustedHandler('np:loadMeta', async e => {
    const ctx = context(e)
    const meta = await storage(ctx.workspaceId).loadMeta()
    if (meta !== null && (!meta || typeof meta !== 'object' || Array.isArray(meta))) throw new Error('Arquivo de páginas inválido; o original foi preservado.')
    ctx.locale = meta === null ? 'en-US' : meta?.settings?.locale ?? 'pt-BR'
    if (focused() === ctx.win) buildMenu()
    // Base da gravação incremental: a janela pode mandar só a diferença já na 1ª gravação (seq -1).
    // Abas são por janela: a secundária começa sem as abas gravadas (sessão da janela principal).
    const { stripWindowTabs } = await import('./window-tabs.mjs')
    const mine = ctx.secondary ? stripWindowTabs(meta) : meta
    ctx.metaBase = mine; ctx.metaSeq = (ctx.metaSeq ?? 0) + 1; ctx.metaLoadSeq = ctx.metaSeq
    return mine
  })

  trustedHandler('np:saveMeta', async (e, meta, base) => {
    const ctx = context(e)
    if (ctx.secondary) meta = (await import('./window-tabs.mjs')).shieldWindowTabs(meta, base)
    const merged = await storage(ctx.workspaceId).saveMeta(meta, base)
    const changedLocale = ctx.locale !== merged.settings.locale
    ctx.locale = merged.settings.locale ?? 'pt-BR'
    if (changedLocale && focused() === ctx.win) buildMenu()
    await configureLocalApi(ctx.workspaceId, !!merged.settings.localApiEnabled)
    broadcast(ctx.workspaceId, { meta: merged }, e.sender.id)
    return merged
  })
  // Gravação incremental (bancos/espaços grandes): ver electron/meta-patch.mjs. `seq` identifica a
  // última base que ESTA janela recebeu; se não bater (ou faltar), a janela reenvia o meta completo.
  trustedHandler('np:saveMetaDelta', async (e, request) => {
    const ctx = context(e), { applyMetaPatch, diffMeta, validMetaPatch } = await import('./meta-patch.mjs')
    let proposed, base
    const knownBase = request?.seq != null && ctx.metaBase && (request.seq === ctx.metaSeq || (request.seq === -1 && ctx.metaLoadSeq === ctx.metaSeq))
    if (knownBase && validMetaPatch(request.patch)) {
      base = ctx.metaBase; proposed = applyMetaPatch(base, request.patch)
    } else if (request?.meta && typeof request.meta === 'object') {
      proposed = request.meta; base = request.base ?? null
    } else return { resync: true }
    // Janela secundária nunca grava as próprias abas (ver electron/window-tabs.mjs).
    if (ctx.secondary) proposed = (await import('./window-tabs.mjs')).shieldWindowTabs(proposed, base)
    const merged = await storage(ctx.workspaceId).saveMeta(proposed, base)
    const changedLocale = ctx.locale !== merged.settings.locale
    ctx.locale = merged.settings.locale ?? 'pt-BR'
    if (changedLocale && focused() === ctx.win) buildMenu()
    await configureLocalApi(ctx.workspaceId, !!merged.settings.localApiEnabled)
    broadcast(ctx.workspaceId, { meta: merged }, e.sender.id)
    ctx.metaBase = merged; ctx.metaSeq = (ctx.metaSeq ?? 0) + 1
    return { seq: ctx.metaSeq, patch: diffMeta(proposed, merged) }
  })

  trustedHandler('np:loadDoc', async (e, id) => {
    const doc = await storage(context(e).workspaceId).loadDoc(id)
    if (doc !== null && !Array.isArray(doc)) throw new Error('Conteúdo de página inválido; o original foi preservado.')
    return doc
  })

  trustedHandler('np:saveDoc', async (e, id, blocks, options) => {
    const ctx = context(e)
    const saved = await storage(ctx.workspaceId).saveDoc(id, blocks, options)
    // Só devolve/difunde o meta quando o documento o alterou: com dezenas de milhares de páginas,
    // mandar o meta inteiro a cada gravação de documento travava a janela por centenas de ms.
    const meta = metaChangedByDocument(saved) ? saved : undefined
    broadcast(ctx.workspaceId, { documentId: id, ...(meta ? { meta } : {}) }, e.sender.id)
    return meta
  })

  // Lote de documentos (importações): uma transação e um único aviso às outras janelas.
  trustedHandler('np:saveDocs', async (e, entries) => {
    if (!Array.isArray(entries) || entries.length > 5000) throw new Error('Lote inválido')
    const ctx = context(e), result = await storage(ctx.workspaceId).saveDocs(entries)
    if (entries.length) broadcast(ctx.workspaceId, { documentId: entries[entries.length - 1].id }, e.sender.id)
    return result
  })
  trustedHandler('np:listDocVersions', async (e, id) => storage(context(e).workspaceId).listVersions(id))
  trustedHandler('np:saveDocVersions', async (e, id, versions) => storage(context(e).workspaceId).importVersions(id, versions))

  trustedHandler('np:deleteDoc', async (e, id) => {
    await storage(context(e).workspaceId).deleteDoc(id)
  })

  trustedHandler('np:exportFile', async (e, defaultName, content) => {
    const win = BrowserWindow.fromWebContents(e.sender) || undefined
    const safeName = path.basename(String(defaultName || 'nota.md')).replace(/[\\/:*?"<>|]/g, '-')
    const opts = {
      defaultPath: path.join(app.getPath('documents'), safeName),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await atomicWrite(res.filePath, String(content ?? ''))
    return true
  })
  trustedHandler('np:exportBinaryFile', async (e, defaultName, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024 * 1024) throw new Error('Arquivo inválido ou maior que 1 GB.')
    const name = path.basename(String(defaultName || `${PRODUCT.name}.zip`)).replace(/[\\/:*?"<>|]/g, '-')
    const result = await dialog.showSaveDialog(context(e).win, { defaultPath: path.join(app.getPath('documents'), name), properties: ['createDirectory', 'showOverwriteConfirmation'] })
    if (result.canceled || !result.filePath) return false
    await atomicWrite(result.filePath, Buffer.from(bytes)); return true
  })

  const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
  trustedHandler('np:pickImage', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || undefined
    const opts = {
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: Object.keys(IMAGE_MIME) }],
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const file = res.filePaths[0]
    const mime = IMAGE_MIME[path.extname(file).slice(1).toLowerCase()]
    if (!mime) return null
    const buf = await fsp.readFile(file)
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  trustedHandler('np:pickFiles', async e => {
    const win = context(e).win
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async file => {
      const stat = await fsp.stat(file)
      if (stat.size > 100 * 1024 * 1024) throw new Error(nativeT('O limite por anexo é 100 MB.', 'The limit per attachment is 100 MB.', win))
      const mimeType = IMAGE_MIME[path.extname(file).slice(1).toLowerCase()] ?? ({ pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', mp3: 'audio/mpeg', mp4: 'video/mp4' })[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
      return { id: randomUUID(), name: path.basename(file), mimeType, size: stat.size, data: `data:${mimeType};base64,${(await fsp.readFile(file)).toString('base64')}` }
    }))
  })
  trustedHandler('np:exportPDF', async (e, defaultName) => {
    const win = context(e).win
    const safeName = path.basename(String(defaultName || `${PRODUCT.name}.pdf`)).replace(/[\\/:*?"<>|]/g, '-')
    const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safeName), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath) return false
    await atomicWrite(result.filePath, await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }))
    return true
  })
  trustedHandler('np:openWindow', async (e, route) => {
    createWindow(context(e).workspaceId, sanitizeWindowRoute(route))
  })
  trustedHandler('np:listWorkspaces', async e => (await workspaceList()).map(item => ({ ...item, current: item.id === context(e).workspaceId })))
  trustedHandler('np:isSchedulerLeader', async e => [...contexts.values()].find(c => c.workspaceId === context(e).workspaceId)?.win.webContents.id === e.sender.id)
  let catalogTransaction = Promise.resolve()
  trustedHandler('np:createWorkspace', async (e, name) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Error('Nome de workspace inválido')
    const item = { id: randomUUID(), name: name.trim(), createdAt: Date.now() }
    const operation = catalogTransaction.catch(() => {}).then(async () => {
      const catalog = await readJson(catalogFile()) ?? []
      await storage(item.id).saveMeta({ pages: {}, settings: { locale: context(e).locale, theme: 'system', workspaceName: item.name, userName: '', sidebarWidth: 240, sidebarCollapsed: false, expanded: {}, recent: [], historyLimit: 0 }, notifications: {}, syncedBlocks: {} })
      await atomicWrite(catalogFile(), JSON.stringify([...catalog, item]))
    })
    catalogTransaction = operation; await operation; return item
  })
  trustedHandler('np:openWorkspace', async (_e, id) => {
    if (!(await workspaceList()).some(item => item.id === id)) throw new Error('Workspace indisponível')
    createWindow(id)
  })
  trustedHandler('np:revealDataFolder', async e => {
    const directory = dataDir(context(e).workspaceId)
    await fsp.mkdir(directory, { recursive: true })
    const err = await shell.openPath(directory)
    if (err) throw new Error(err)
  })
}

/* ------------------------------------------------------------------ */
/* Janela                                                              */
/* ------------------------------------------------------------------ */

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  const def = { width: 1280, height: 800 }
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    if (!s || typeof s.width !== 'number' || typeof s.height !== 'number') return def
    const out = { width: Math.max(720, s.width), height: Math.max(480, s.height), maximized: !!s.maximized, fullScreen: !!s.fullScreen }
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return s.x < b.x + b.width - 40 && s.x + out.width > b.x + 40 && s.y >= b.y - 10 && s.y < b.y + b.height - 40
      })
      if (visible) {
        out.x = s.x
        out.y = s.y
      }
    }
    return out
  } catch {
    return def
  }
}

function saveWindowState(win) {
  try {
    const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...b, maximized: win.isMaximized(), fullScreen: win.isFullScreen() }),
    )
  } catch {
    /* ignora */
  }
}

let quitRequested = false
const renderersReady = new Set()
const closeRequests = new Map()
ipcMain.on('np:navigationReady', event => {
  if (event.senderFrame !== event.sender.mainFrame || !isInternalURL(event.senderFrame.url)) return
  const ctx = contexts.get(event.sender.id)
  if (!ctx) return
  ctx.navigationReady = true
  if (ctx.route) { event.sender.send('np:navigate', ctx.route); ctx.route = null }
  if (ctx.command) { event.sender.send('np:command', ctx.command); ctx.command = null }
})

ipcMain.on('np:externalFileReady', event => {
  if (event.senderFrame !== event.sender.mainFrame || !isInternalURL(event.senderFrame.url)) return
  const ctx = contexts.get(event.sender.id)
  if (!ctx) return
  ctx.externalReady = true
  for (const file of ctx.pendingFiles ?? []) event.sender.send('np:externalFile', file)
  ctx.pendingFiles = []
})

ipcMain.on('np:rendererReady', (event) => {
  if (event.senderFrame === event.sender.mainFrame && isInternalURL(event.senderFrame.url)) renderersReady.add(event.sender.id)
})
ipcMain.on('np:closeResult', (event, token, error) => {
  const request = closeRequests.get(token)
  if (!request || request.senderId !== event.sender.id || event.senderFrame !== event.sender.mainFrame || !isInternalURL(event.senderFrame.url)) return
  closeRequests.delete(token)
  clearTimeout(request.timer)
  if (error) request.reject(new Error(String(error)))
  else request.resolve()
})

function flushRenderer(win) {
  if (!renderersReady.has(win.webContents.id)) return drainDocuments().then(drain)
  return new Promise((resolve, reject) => {
    const token = require('node:crypto').randomUUID()
    const timer = setTimeout(() => {
      closeRequests.delete(token)
      reject(new Error('A página ainda não confirmou a gravação. Tente fechar novamente.'))
    }, 15000)
    closeRequests.set(token, { senderId: win.webContents.id, resolve, reject, timer })
    win.webContents.send('np:beforeClose', token)
  }).then(drainWorkspaces).then(drainDocuments).then(drain)
}

function sendCommand(command) { focused()?.webContents.send('np:command', command) }
function pasteAsPlainText() {
  const contents = focused()?.webContents
  if (!contents || contents.isDestroyed()) return
  contents.send('np:command', 'paste-plain')
  setTimeout(() => { if (!contents.isDestroyed()) contents.pasteAndMatchStyle() }, 30)
}

function isHttpUrl(url) {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

function createWindow(workspaceId = 'default', route = null) {
  const st = loadWindowState()
  const win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 720,
    minHeight: 480,
    title: `${PRODUCT.name}`,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 11 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  const senderId = win.webContents.id
  // Secundária = já existe outra janela viva neste espaço; só a principal grava/restaura as abas.
  const secondary = [...contexts.values()].some(c => c.workspaceId === workspaceId && !c.win.isDestroyed())
  contexts.set(senderId, { win, workspaceId, locale: 'en-US', route, navigationReady: false, secondary })
  win.on('focus', buildMenu)
  win.on('focus', () => { lastWorkspace = workspaceId })
  // All content and fonts stay on this device. Opening a link is an explicit external-browser action.
  // Exceção única: o <iframe> do player de vídeo (lista fechada, modo escolhido em Configurações → Segurança e privacidade).
  const requestSession = win.webContents.session
  requestSession.webRequest.onBeforeRequest((details, callback) => {
    const mode = embedModes.get(details.webContentsId) ?? 'always'
    callback({ cancel: !(localPolicy.canRequest(details.url, POLICY) || localPolicy.canEmbedRequest(details, mode)) })
  })
  requestSession.webRequest.onBeforeSendHeaders({ urls: localPolicy.EMBED_HOSTS.map(host => `https://${host}/*`) }, (details, callback) => {
    const referer = localPolicy.embedRefererFor(details)
    if (referer) details.requestHeaders.Referer = referer
    callback({ requestHeaders: details.requestHeaders })
  })
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = webContents && contexts.has(webContents.id) && isInternalURL(details.requestingUrl || webContents.getURL())
    callback(Boolean(trusted && permission === 'media' && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video')))
  })
  if (st.maximized) win.maximize()
  if (st.fullScreen) win.setFullScreen(true)
  win.once('ready-to-show', () => win.show())

  let timer = null
  const debounced = () => {
    clearTimeout(timer)
    timer = setTimeout(() => !win.isDestroyed() && saveWindowState(win), 400)
  }
  win.on('resize', debounced)
  win.on('move', debounced)
  let closing = false
  win.on('close', (event) => {
    event.preventDefault()
    if (closing) return
    closing = true
    saveWindowState(win)
    flushRenderer(win).then(() => {
      win.destroy()
      if (quitRequested && ![...contexts.values()].some(c => !c.win.isDestroyed())) app.quit()
    }).catch(async error => {
      closing = false
      quitRequested = false
      if (!win.isDestroyed()) await dialog.showMessageBox(win, { type: 'error', title: nativeT('Não foi possível salvar', 'Could not save', win),
        message: nativeT('A janela ficou aberta para preservar suas alterações.', 'This window remained open to preserve your edits.', win), detail: error.message, buttons: [nativeT('Voltar à página', 'Return to page', win)] })
    })
  })
  win.on('closed', () => {
    clearTimeout(timer)
    trayTasks.drop(senderId); tray.refreshTitle()
    renderersReady.delete(senderId)
    contexts.delete(senderId)
    embedModes.delete(senderId)
    aiIpc?.closeWindow(senderId)
    transcriptionControllers.get(senderId)?.abort(); transcriptionControllers.delete(senderId)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (parseDeepLink(url)) void openDeepLink(url)
    if (isHttpUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (isInternalURL(url)) return
    e.preventDefault()
    if (parseDeepLink(url)) void openDeepLink(url)
    if (isHttpUrl(url)) shell.openExternal(url)
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())

  if (IS_DEV) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

// Atalhos personalizados do menu (Configurações → Atalhos): id do comando → acelerador do Electron.
// O renderer envia só o que difere do padrão; ids e formato são validados aqui.
const MENU_SHORTCUT_IDS = ['new-page', 'new-window', 'new-tab', 'daily-today', 'reopen-tab', 'close-tab', 'search', 'export', 'close-window', 'focus', 'calendar-panel', 'reload']
let shortcutAccelerators = {}
// Gravando um atalho novo (Configurações): o menu não registra aceleradores, para a tecla chegar à página.
let recordingShortcut = false
const accel = (id, fallback) => recordingShortcut ? undefined : shortcutAccelerators[id] || fallback

function buildMenu() {
  const template = [
    {
      label: `${PRODUCT.name}`,
      submenu: [
        { role: 'about', label: nativeT(`Sobre o ${PRODUCT.name}`, `About ${PRODUCT.name}`) },
        { type: 'separator' },
        { role: 'services', label: nativeT('Serviços', 'Services') },
        { type: 'separator' },
        { role: 'hide', label: nativeT(`Ocultar o ${PRODUCT.name}`, `Hide ${PRODUCT.name}`) },
        { role: 'hideOthers', label: nativeT('Ocultar Outros', 'Hide Others') },
        { role: 'unhide', label: nativeT('Mostrar Tudo', 'Show All') },
        { type: 'separator' },
        { role: 'quit', label: nativeT(`Encerrar o ${PRODUCT.name}`, `Quit ${PRODUCT.name}`) },
      ],
    },
    {
      label: nativeT('Arquivo', 'File'),
      submenu: [
        { label: nativeT('Nova página', 'New page'), accelerator: accel('new-page', 'CmdOrCtrl+N'), click: () => sendCommand('new-page') },
        { label: nativeT('Nova janela', 'New window'), accelerator: accel('new-window', 'CmdOrCtrl+Shift+N'), click: () => { const ctx = [...contexts.values()].find(c => c.win === BrowserWindow.getFocusedWindow() && c.navigationReady); if (ctx) ctx.win.webContents.send('np:command', 'new-window'); else createWindow(focusedWorkspace()) } },
        { label: nativeT('Nova nota rápida', 'New quick note'), accelerator: quickCapture.prefs()?.shortcut || undefined, registerAccelerator: false, click: () => void quickCapture.show() },
        { label: nativeT('Nova aba', 'New tab'), accelerator: accel('new-tab', 'CmdOrCtrl+T'), click: () => sendCommand('new-tab') },
        { type: 'separator' },
        // Fluxo diário (src/daily): ⌘⌥D é do sistema (Dock), por isso ⌘⇧D.
        { label: nativeT('Nota de hoje', 'Today’s note'), accelerator: accel('daily-today', 'CmdOrCtrl+Shift+D'), click: () => sendCommand('daily-today') },
        { label: nativeT('Nota de ontem', 'Yesterday’s note'), click: () => sendCommand('daily-yesterday') },
        { label: nativeT('Nota de amanhã', 'Tomorrow’s note'), click: () => sendCommand('daily-tomorrow') },
        { label: nativeT('Tarefas', 'Tasks'), click: () => sendCommand('tasks') },
        { type: 'separator' },
        { label: nativeT('Reabrir última aba fechada', 'Reopen last closed tab'), accelerator: accel('reopen-tab', 'CmdOrCtrl+Shift+T'), click: () => sendCommand('reopen-tab') },
        { label: nativeT('Fechar aba', 'Close tab'), accelerator: accel('close-tab', 'CmdOrCtrl+W'), click: () => sendCommand('close-tab') },
        { label: nativeT('Buscar', 'Search'), accelerator: accel('search', 'CmdOrCtrl+K'), click: () => sendCommand('search') },
        { label: nativeT('Abrir arquivo Markdown…', 'Open Markdown file…'), click: () => sendCommand('open-markdown-file') },
        { label: nativeT('Exportar…', 'Export…'), accelerator: accel('export', 'CmdOrCtrl+Shift+E'), click: () => sendCommand('export') },
        { type: 'separator' },
        { label: nativeT('Importar', 'Import'), submenu: [{ label: nativeT("Importar do Export Bundle…", "Import from Export Bundle…"), click: () => sendCommand("import-bundle") }, { label: nativeT("Importar do Markdown Vault…", "Import from Markdown Vault…"), click: () => sendCommand("import-markdown") }, { label: nativeT('Importar do Apple Notes…', 'Import from Apple Notes…'), click: () => sendCommand('import-apple-notes') }, { label: nativeT("Importar do ENEX Archive (.enex)…", "Import from ENEX Archive (.enex)…"), click: () => sendCommand("import-archive") }] },
        { type: 'separator' },
        {
          label: nativeT('Abrir Pasta de Dados', 'Open data folder'),
          click: async () => {
            const directory = dataDir(focusedWorkspace())
            await fsp.mkdir(directory, { recursive: true })
            shell.openPath(directory)
          },
        },
        { type: 'separator' },
        { role: 'close', label: nativeT('Fechar Janela', 'Close window'), accelerator: recordingShortcut ? 'F19' : accel('close-window', 'CmdOrCtrl+Shift+W') },
      ],
    },
    {
      label: nativeT('Editar', 'Edit'),
      submenu: [
        { role: 'undo', label: nativeT('Desfazer', 'Undo') },
        { role: 'redo', label: nativeT('Refazer', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: nativeT('Recortar', 'Cut') },
        { role: 'copy', label: nativeT('Copiar', 'Copy') },
        { role: 'paste', label: nativeT('Colar', 'Paste') },
        { role: 'pasteAndMatchStyle', label: nativeT('Colar e Manter o Estilo', 'Paste and match style') },
        // ⌘⇧V: colar como texto simples (sem converter Markdown/HTML). O item existe só para o atalho
        // chegar ao main: document.execCommand('paste') é bloqueado no renderer. O renderer é avisado
        // primeiro e, logo depois, uma colagem nativa só com text/plain é disparada.
        { label: nativeT('Colar como Texto Simples', 'Paste as plain text'), accelerator: 'CmdOrCtrl+Shift+V', click: () => pasteAsPlainText() },
        { role: 'selectAll', label: nativeT('Selecionar Tudo', 'Select all') },
      ],
    },
    {
      label: nativeT('Visualizar', 'View'),
      submenu: [
        { role: 'resetZoom', label: nativeT('Tamanho Real', 'Actual size') },
        { role: 'zoomIn', label: nativeT('Aumentar Zoom', 'Zoom in') },
        { role: 'zoomOut', label: nativeT('Diminuir Zoom', 'Zoom out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: nativeT('Tela Cheia', 'Full screen') },
        { label: nativeT('Modo foco', 'Focus mode'), accelerator: accel('focus', 'CmdOrCtrl+Shift+F'), click: () => sendCommand('focus-mode') },
        { label: nativeT('Painel de calendário', 'Calendar panel'), accelerator: accel('calendar-panel', 'CmdOrCtrl+Shift+C'), click: () => sendCommand('calendar-panel') },
        { type: 'separator' },
        { label: nativeT('Recarregar', 'Reload'), accelerator: accel('reload', 'CmdOrCtrl+R'), click: () => sendCommand('reload') },
        { role: 'toggleDevTools', label: nativeT('Ferramentas do Desenvolvedor', 'Developer tools') },
      ],
    },
    {
      label: nativeT('Janela', 'Window'),
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: nativeT('Minimizar', 'Minimize') },
        { role: 'zoom', label: nativeT('Ampliar', 'Zoom') },
        { type: 'separator' },
        { role: 'front', label: nativeT('Trazer Tudo para a Frente', 'Bring all to front') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ------------------------------------------------------------------ */

const pendingLinks = []
async function openDeepLink(value) {
  const route = parseDeepLink(value)
  if (!route) return
  if (!app.isReady()) { pendingLinks.push(value); return }
  let workspaceId = focusedWorkspace()
  if (route.type === 'page') for (const item of await workspaceList()) {
    if (item.locked) continue
    const meta = await storage(item.id).loadMeta()
    if (meta?.pages[route.id]) { workspaceId = item.id; break }
  }
  // Coleção de tipo: abre no espaço que tem o tipo; se ele sumiu, o renderer cai no Meu dia (validRoute).
  else if (route.type === 'objectType') for (const item of await workspaceList()) {
    if (item.locked) continue
    if (metaHasObjectType(await storage(item.id).loadMeta(), route.id)) { workspaceId = item.id; break }
  }
  const ctx = [...contexts.values()].find(c => c.workspaceId === workspaceId && !c.win.isDestroyed())
  if (!ctx) { createWindow(workspaceId, route); return }
  if (ctx.win.isMinimized()) ctx.win.restore()
  ctx.win.show(); ctx.win.focus()
  if (ctx.navigationReady) ctx.win.webContents.send('np:navigate', route)
  else ctx.route = route
}
/** B5: "Abrir com…" / Arquivo → Abrir arquivo Markdown… — lê o arquivo (validado) e entrega à janela ativa. */
const pendingFiles = []
async function openExternalFile(file) {
  if (!isOpenablePath(file)) return
  if (!app.isReady()) { pendingFiles.push(file); return }
  let view
  try { view = await openFiles.open(file) } catch (error) { dialog.showErrorBox(`${PRODUCT.name}`, String(error.message).replace(/^[A-Z_]+: /, '')); return }
  const workspaceId = activeWorkspace()
  let ctx = [...contexts.values()].find(c => c.workspaceId === workspaceId && !c.win.isDestroyed())
  if (!ctx) ctx = contexts.get(createWindow(workspaceId).webContents.id)
  if (ctx.win.isMinimized()) ctx.win.restore()
  app.show(); ctx.win.show(); ctx.win.focus()
  if (ctx.externalReady) ctx.win.webContents.send('np:externalFile', view)
  else (ctx.pendingFiles ??= []).push(view)
}
app.on('open-file', (event, file) => { event.preventDefault(); void openExternalFile(file).catch(console.error) })
app.on('open-url', (event, value) => { event.preventDefault(); if (quickCapture.handleUrl(value)) return; void openDeepLink(value).catch(console.error) })
app.on('second-instance', (_event, argv) => {
  if (argv.some(arg => quickCapture.handleUrl(arg))) return
  const documents = argv.slice(1).filter(isOpenablePath)
  if (documents.length) { for (const file of documents.slice(0, 10)) void openExternalFile(file).catch(console.error); return }
  const value = argv.find(arg => parseDeepLink(arg))
  if (value) void openDeepLink(value).catch(console.error)
  else { const win = focused() ?? createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus() }
})

app.on('before-quit', () => { quitRequested = true; quickCapture.destroyWindow(); for (const access of agentAccesses.values()) { access.close(); void access.flush() } })
// Com senha do espaço o cache do Chromium (IndexedDB) nunca fica em disco: varre no início e na saída.
function scrubBrowserStorageIfVaulted() {
  try {
    let ids = ['default']
    try { const catalog = JSON.parse(fs.readFileSync(catalogFile(), 'utf8')); if (Array.isArray(catalog)) ids = ['default', ...catalog.map(item => item?.id).filter(id => typeof id === 'string' && UUID_RE.test(id))] } catch { /* sem catálogo */ }
    if (ids.some(id => vault.isEnabled(dataDir(id)))) browserStorage.scrubResidue(app.getPath('userData'))
  } catch (error) { console.error(error) }
}
app.on('will-quit', () => quickCapture.stop())
app.on('quit', scrubBrowserStorageIfVaulted)

/* ------------------------------------------------------------------ */
/* Captura rápida e barra de menus                                     */
/* ------------------------------------------------------------------ */

let lastWorkspace = 'default'
function activeWorkspace() { const win = BrowserWindow.getFocusedWindow(); return (win && contexts.get(win.webContents.id)?.workspaceId) ?? lastWorkspace }
function showMain(command) {
  const workspaceId = activeWorkspace()
  let ctx = [...contexts.values()].find(c => c.workspaceId === workspaceId && !c.win.isDestroyed())
  if (!ctx) ctx = contexts.get(createWindow(workspaceId).webContents.id)
  if (ctx.win.isMinimized()) ctx.win.restore()
  app.show(); app.focus({ steal: true }); ctx.win.show(); ctx.win.focus()
  if (!command) return
  if (ctx.navigationReady) ctx.win.webContents.send('np:command', command)
  else ctx.command = command
}
const quickCapture = createQuickCapture({
  userData: () => app.getPath('userData'), dataDir, isLocked: id => vault.isLocked(dataDir(id)), storage, broadcast, activeWorkspace, isDev: IS_DEV, devURL: DEV_URL, distDir: path.dirname(ENTRY_FILE),
  dictation: dictationService, openPrivacyPane,
  quitting: () => quitRequested, openRoute: (_id, route) => void openDeepLink(`workspace://page/${route.id}`).catch(console.error),
  onPrefsChanged: prefs => { tray.setVisible(prefs.showTray); tray.refreshTitle(); buildMenu() },
})
/** Retrato somente-leitura das tarefas de hoje/atrasadas enviado pelo renderer (C3a); nada é lido de disco aqui. */
const trayTasks = createTrayTasks()
const tray = createTray({
  todayTasks: () => { const workspaceId = activeWorkspace(); return vault.isLocked(dataDir(workspaceId)) ? null : trayTasks.forWorkspace(workspaceId)?.snapshot ?? null },
  taskPrefs: () => ({ trayTasks: quickCapture.prefs()?.trayTasks !== false, trayCount: quickCapture.prefs()?.trayCount === true }),
  // Concluir pelo menu = pedir ao renderer dono do item que use a mesma rota da Caixa de tarefas (guardas de página bloqueada/protegida incluídas).
  completeTask: id => {
    const owner = trayTasks.ownerOf(activeWorkspace(), id)
    const ctx = owner === null ? null : contexts.get(owner)
    if (!ctx || ctx.win.isDestroyed()) { showMain('home'); return }
    ctx.win.webContents.send('np:trayCompleteTask', id)
  },
  openToday: () => showMain('home'),
  t: (pt, en) => nativeT(pt, en, [...contexts.values()].find(c => c.workspaceId === activeWorkspace())?.win ?? focused()),
  shortcut: () => quickCapture.prefs()?.shortcut,
  recents: async () => {
    const workspaceId = activeWorkspace()
    if (vault.isLocked(dataDir(workspaceId))) return []
    const meta = await storage(workspaceId).loadMeta()
    const { isLivePage } = require('./content-index.cjs')
    return (meta?.settings.recent ?? []).filter(id => meta.pages[id] && isLivePage(id, meta.pages)).slice(0, 5).map(id => ({ id, title: meta.pages[id].title, workspaceId }))
  },
  quickNote: () => void quickCapture.show(),
  search: () => showMain('search'),
  openApp: () => showMain(),
  openPage: item => void openDeepLink(`workspace://page/${item.id}`).catch(console.error),
  preferences: () => showMain('settings'),
  quit: () => app.quit(),
})

let schedulerBusy = false
let apiConfig = Promise.resolve()
/** Permissões e fila de aprovação de agentes por espaço; pedidos novos abrem o app e chegam aos renderers. */
function agentAccessFor(id) {
  if (!agentAccesses.has(id)) agentAccesses.set(id, createAgentAccess({
    directory: dataDir(id),
    notify: event => {
      for (const ctx of contexts.values()) if (ctx.workspaceId === id && !ctx.win.isDestroyed()) ctx.win.webContents.send('np:agentEvent', event)
      if (event.type === 'pending') showMain()
    },
  }))
  return agentAccesses.get(id)
}
async function localApiState(id) {
  const meta = await storage(id).loadMeta()
  await configureLocalApi(id, !!meta?.settings.localApiEnabled)
  const service = localApis.get(id)
  return service ? { enabled: true, url: service.url } : { enabled: false }
}
function configureLocalApi(id, enabled) {
  const next = apiConfig.catch(() => {}).then(async () => {
    const current = localApis.get(id)
    if (!enabled && current) { agentAccesses.get(id)?.close(); await current.close(); localApis.delete(id) }
    if (!enabled || current) return
    const file = path.join(dataDir(id), 'api-token.json')
    let secret = await readJson(file)
    if (!secret) { secret = { token: require('node:crypto').randomBytes(32).toString('hex') }; await atomicWrite(file, JSON.stringify(secret)) }
    const access = agentAccessFor(id)
    await access.load(); await access.adoptLegacyToken(secret.token)
    const service = await startLocalApi({ storage: pageLocks.guardForApi(storage(id)), token: secret.token, access, port: secret.port || 0, onChange: change => broadcast(id, change) })
    const activePort = Number(new URL(service.url).port)
    if (secret.port !== activePort) { secret.port = activePort; await atomicWrite(file, JSON.stringify(secret)) }
    localApis.set(id, { ...service, token: secret.token })
  })
  apiConfig = next; return next
}
async function tickDesktop() {
  if (schedulerBusy) return
  schedulerBusy = true
  try {
    const { collectDueReminders } = await import('./reminders.mjs')
    const { reconcileDateReminders } = await import('./recurrence.mjs')
    for (const workspace of await workspaceList()) {
      if (workspace.locked) continue
      const store = storage(workspace.id)
      let due = [], datedChanged = false
      const meta = await store.mutateMeta(current => {
        const now = Date.now()
        const result = collectDueReminders(current.notifications ?? {}, current.pages, now, randomUUID)
        due = result.due
        // Lembretes de datas de banco (recorrentes): agenda a ocorrência atual/próxima de forma idempotente.
        const dated = reconcileDateReminders(result.notifications, current.pages, now, { locale: current.settings?.locale })
        datedChanged = dated.changed
        return due.length || dated.changed ? { ...current, notifications: dated.notifications } : current
      })
      if (!meta) continue
      if (datedChanged && !due.length) broadcast(workspace.id, { meta })
      if (!webhookBusy.has(workspace.id)) {
        webhookBusy.add(workspace.id)
        void deliverWebhooks(pageLocks.guardForApi(store), meta.settings).catch(console.error).finally(() => webhookBusy.delete(workspace.id))
      }
      await configureLocalApi(workspace.id, !!meta.settings.localApiEnabled)
      if (due.length) broadcast(workspace.id, { meta })
      for (const item of due) if (Notification.isSupported()) {
        const notification = new Notification({ title: item.title || `${PRODUCT.name}`, body: item.body || meta.pages[item.pageId]?.title || '', silent: false })
        notification.on('click', () => {
          void openDeepLink(`workspace://page/${item.pageId}`).catch(console.error)
          void store.mutateMeta(current => current.notifications?.[item.id] ? ({ ...current, notifications: { ...current.notifications, [item.id]: { ...current.notifications[item.id], readAt: Date.now() } } }) : current).then(updated => updated && broadcast(workspace.id, { meta: updated })).catch(console.error)
        })
        notification.show()
      }
      const backup = meta.settings.automaticBackup
      if (backup?.enabled) {
        const directory = path.join(dataDir(workspace.id), 'backups')
        await fsp.mkdir(directory, { recursive: true })
        const files = (await fsp.readdir(directory)).filter(file => /^\d{13}\.json$/.test(file)).sort().reverse()
        const interval = Math.max(1, Number(backup.intervalHours) || 24) * 3600000
        if (!files.length || Date.now() - Number(files[0].slice(0, 13)) >= interval) {
          const snapshot = await store.backup()
          const file = `${Date.now()}.json`
          await atomicWrite(path.join(directory, file), JSON.stringify(snapshot))
          for (const old of files.slice(Math.max(0, (Number(backup.keep) || 7) - 1))) await fsp.unlink(path.join(directory, old))
        }
      }
      // Backup externo verificado (F3): falhas aqui nunca interrompem o agendador.
      await backupService?.autoBackup(workspace.id).catch(error => console.error('[backup]', error?.message ?? error))
    }
  } finally { schedulerBusy = false }
}

/* Cifra antiga do Keychain: avisa ANTES do prompt do macOS e só então toca o Keychain (uma última vez). */
// app.getLocale() segue os idiomas empacotados no app (quase sempre en-US); o idioma do Mac vem de getPreferredSystemLanguages().
const appIsEnglish = () => {
  const langs = app.getPreferredSystemLanguages?.() ?? []
  const first = String(langs[0] ?? app.getLocale?.() ?? '').toLowerCase()
  return first.startsWith('en')
}
const bootText = (pt, en) => appIsEnglish() ? en : pt
const TEST_CHOICE = !app.isPackaged ? process.env.WORKSPACE_TEST_MIGRATION_CHOICE : undefined
async function bootSecureStorage() {
  const root = app.getPath('userData')
  const options = {
    failAt: !app.isPackaged ? process.env.WORKSPACE_TEST_MIGRATION_FAIL_AT || undefined : undefined,
    confirmMigration: async () => {
      if (TEST_CHOICE) return TEST_CHOICE
      const { response } = await dialog.showMessageBox({
        type: 'info', buttons: [bootText('Continuar', 'Continue'), bootText('Agora não', 'Not now')], defaultId: 0, cancelId: 1,
        title: `${PRODUCT.name}`, message: bootText(`O ${PRODUCT.name} vai remover a cifra antiga do chaveiro`, `${PRODUCT.name} will remove the old keychain encryption`),
        detail: bootText('Para parar de pedir a senha do chaveiro toda vez que você abre o app. O macOS pedirá a senha do chaveiro uma última vez — clique em Permitir. Seus dados serão convertidos com verificação, e a cópia antiga será mantida por 14 dias como backup (você pode apagá-la antes em Configurações → Dados).\n\nSe escolher "Agora não", o app abre normalmente e oferece de novo na próxima vez.', 'This stops macOS from asking for your keychain password every time you open the app. macOS will ask for the keychain password one last time — click Allow. Your data is converted with verification, and the old copy is kept for 14 days as a backup (you can delete it sooner in Settings → Data).\n\nIf you choose "Not now", the app opens normally and offers this again next time.'),
      })
      return response === 0 ? 'continue' : 'later'
    },
  }
  for (;;) {
    try { return await secureStorage.initializeSecureStorage(root, safeStorage, options) }
    catch (error) {
      if (TEST_CHOICE || !['KEYCHAIN_DENIED', 'DEVICE_KEY_MISSING', 'KEYCHAIN_UNAVAILABLE'].includes(error?.code)) throw error
      // Nada foi alterado nem apagado. O usuário escolhe o que fazer.
      const { response } = await dialog.showMessageBox({
        type: 'warning', buttons: [bootText('Tentar de novo', 'Try again'), bootText('Abrir pasta de dados', 'Open data folder'), bootText('Sair', 'Quit')], defaultId: 0, cancelId: 2,
        title: `${PRODUCT.name}`, message: bootText('Não foi possível usar a chave do chaveiro', 'Could not use the keychain key'),
        detail: bootText('Nenhum dado foi apagado ou alterado. Se você negou o acesso, clique em "Tentar de novo" e depois em Permitir. Seus arquivos estão na pasta de dados.', 'No data was deleted or changed. If you denied access, click "Try again" and then Allow. Your files are in the data folder.'),
      })
      if (response === 1) await shell.openPath(root)
      if (response === 2) { const quit = new Error('USER_QUIT'); quit.code = 'USER_QUIT'; throw quit }
    }
  }
}

if (gotLock) app.whenReady().then(async () => {
  // Em desenvolvimento, o Dock mostra o ícone do aplicativo (o app empacotado usa build/icon.icns via electron-packager).
  if (!app.isPackaged && process.platform === 'darwin') {
    try { const icon = require('electron').nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.icns')); if (!icon.isEmpty()) app.dock?.setIcon(icon) } catch { /* ícone opcional */ }
  }
  securityStatus = await bootSecureStorage()
  void secureStorage.purgeExpiredBackups(app.getPath('userData')).catch(console.error)
  if (app.isPackaged) { app.setAsDefaultProtocolClient("workspace"); app.setAsDefaultProtocolClient(COMPAT.record007) }
  scrubBrowserStorageIfVaulted()
  registerIpc()
  await backupService.recoverAll().catch(console.error)
  quickCapture.registerIpc()
  const capturePrefs = await quickCapture.start().catch(error => { console.error(error); return null })
  buildMenu()
  tray.setVisible(!!capturePrefs?.showTray)
  // Aberto no início da sessão com o ícone na barra de menus: fica em segundo plano até ser chamado.
  if (!(capturePrefs?.showTray && app.getLoginItemSettings().wasOpenedAtLogin)) createWindow()
  for (const value of [...pendingLinks, ...process.argv.filter(arg => parseDeepLink(arg))]) await openDeepLink(value)
  for (const file of [...pendingFiles.splice(0), ...process.argv.slice(1).filter(isOpenablePath)].slice(0, 10)) await openExternalFile(file)
  const timer = setInterval(() => void tickDesktop().catch(console.error), 5000)
  timer.unref()
  void tickDesktop().catch(console.error)
  app.once('will-quit', () => clearInterval(timer))
  app.on('activate', () => {
    if (contexts.size === 0) createWindow(lastWorkspace)
  })
}).catch(error => { if (error?.code !== 'USER_QUIT') dialog.showErrorBox(`${PRODUCT.name}`, error.message); app.quit() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
