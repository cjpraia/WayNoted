const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadMeta: () => ipcRenderer.invoke('np:loadMeta'),
  saveMeta: (meta, base) => ipcRenderer.invoke('np:saveMeta', meta, base),
  saveMetaDelta: (request) => ipcRenderer.invoke('np:saveMetaDelta', request),
  loadDoc: (id) => ipcRenderer.invoke('np:loadDoc', id),
  saveDoc: (id, blocks, options) => ipcRenderer.invoke('np:saveDoc', id, blocks, options),
  saveDocs: (entries) => ipcRenderer.invoke('np:saveDocs', entries),
  listDocVersions: (id) => ipcRenderer.invoke('np:listDocVersions', id),
  saveDocVersions: (id, versions) => ipcRenderer.invoke('np:saveDocVersions', id, versions),
  deleteDoc: (id) => ipcRenderer.invoke('np:deleteDoc', id),
  exportFile: (defaultName, content) => ipcRenderer.invoke('np:exportFile', defaultName, content),
  exportBinaryFile: (defaultName, bytes) => ipcRenderer.invoke('np:exportBinaryFile', defaultName, bytes),
  pickImage: () => ipcRenderer.invoke('np:pickImage'),
  pickFiles: () => ipcRenderer.invoke('np:pickFiles'),
  pickBundleExport: (kind) => ipcRenderer.invoke("np:pickExport BundleExport", kind),
  setEmbedMode: (mode) => ipcRenderer.invoke('np:setEmbedMode', mode),
  setShortcutAccelerators: (accelerators, recording) => ipcRenderer.invoke('np:setShortcutAccelerators', accelerators, recording === true),
  fetchLinkPreview: (url) => ipcRenderer.invoke('np:fetchLinkPreview', url),
  openExternalPage: (url) => ipcRenderer.invoke('np:openExternalPage', url),
  checkForUpdates: (feedUrl) => ipcRenderer.invoke('np:checkForUpdates', feedUrl),
  openUpdatePage: () => ipcRenderer.invoke('np:openUpdatePage'),
  readThirdPartyNotices: () => ipcRenderer.invoke('np:readThirdPartyNotices'),
  revealThirdPartyNotices: () => ipcRenderer.invoke('np:revealThirdPartyNotices'),
  exportPDF: (name) => ipcRenderer.invoke('np:exportPDF', name),
  saveExport: (input) => ipcRenderer.invoke('np:saveExport', input),
  exportPagePDF: (name) => ipcRenderer.invoke('np:exportPagePDF', name),
  revealExport: (target) => ipcRenderer.invoke('np:revealExport', target),
  openWindow: (route) => ipcRenderer.invoke('np:openWindow', route),
  listWorkspaces: () => ipcRenderer.invoke('np:listWorkspaces'),
  createWorkspace: (name) => ipcRenderer.invoke('np:createWorkspace', name),
  openWorkspace: (id) => ipcRenderer.invoke('np:openWorkspace', id),
  isSchedulerLeader: () => ipcRenderer.invoke('np:isSchedulerLeader'),
  securityInfo: () => ipcRenderer.invoke('np:securityInfo'),
  deviceCipherStatus: () => ipcRenderer.invoke('np:deviceCipherStatus'),
  deviceCipherSet: (enabled) => ipcRenderer.invoke('np:deviceCipherSet', !!enabled),
  deviceCipherRemoveBackups: () => ipcRenderer.invoke('np:deviceCipherRemoveBackups'),
  deviceCipherOpenFolder: () => ipcRenderer.invoke('np:deviceCipherOpenFolder'),
  // Segurança e privacidade (electron/vault-ipc.cjs)
  vaultStatus: () => ipcRenderer.invoke('np:vaultStatus'),
  vaultActivity: () => ipcRenderer.invoke('np:vaultActivity'),
  vaultUnlock: (password) => ipcRenderer.invoke('np:vaultUnlock', password),
  vaultUnlockTouchID: () => ipcRenderer.invoke('np:vaultUnlockTouchID'),
  vaultUnlockRecovery: (recoveryKey, newPassword) => ipcRenderer.invoke('np:vaultUnlockRecovery', recoveryKey, newPassword),
  vaultEnable: (password, options) => ipcRenderer.invoke('np:vaultEnable', password, options),
  vaultDisable: (password) => ipcRenderer.invoke('np:vaultDisable', password),
  vaultChangePassword: (oldPassword, newPassword, options) => ipcRenderer.invoke('np:vaultChangePassword', oldPassword, newPassword, options),
  vaultRegenerateRecovery: (password) => ipcRenderer.invoke('np:vaultRegenerateRecovery', password),
  vaultSetOptions: (patch) => ipcRenderer.invoke('np:vaultSetOptions', patch),
  vaultSetTouchID: (enabled) => ipcRenderer.invoke('np:vaultSetTouchID', enabled),
  vaultLock: () => ipcRenderer.invoke('np:vaultLock'),
  pageLockInfo: () => ipcRenderer.invoke('np:pageLockInfo'),
  pageProtect: (pageId, password, options) => ipcRenderer.invoke('np:pageProtect', pageId, password, options),
  pageUnlock: (pageId, password) => ipcRenderer.invoke('np:pageUnlock', pageId, password),
  pageRelock: (rootId) => ipcRenderer.invoke('np:pageRelock', rootId),
  pageActivity: (rootId) => ipcRenderer.invoke('np:pageActivity', rootId),
  pageUnprotect: (pageId, password) => ipcRenderer.invoke('np:pageUnprotect', pageId, password),
  pageChangePassword: (pageId, oldPassword, newPassword, options) => ipcRenderer.invoke('np:pageChangePassword', pageId, oldPassword, newPassword, options),
  pageLockHint: (pageId) => ipcRenderer.invoke('np:pageLockHint', pageId),
  pageProtectChildren: (pageId, pageIds) => ipcRenderer.invoke('np:pageProtectChildren', pageId, pageIds),
  pageSetOptions: (patch) => ipcRenderer.invoke('np:pageSetOptions', patch),
  pageSetHideTitle: (pageId, hideTitle) => ipcRenderer.invoke('np:pageSetHideTitle', pageId, hideTitle),
  quickCaptureSettings: () => ipcRenderer.invoke('np:quickCaptureSettings'),
  updateQuickCaptureSettings: (patch) => ipcRenderer.invoke('np:updateQuickCaptureSettings', patch),
  showQuickCapture: () => ipcRenderer.invoke('np:showQuickCapture'),
  quickDraftInfo: () => ipcRenderer.invoke('np:quickDraftInfo'),
  localApiInfo: () => ipcRenderer.invoke('np:localApiInfo'),
  agentOverview: () => ipcRenderer.invoke('np:agentOverview'),
  agentPending: () => ipcRenderer.invoke('np:agentPending'),
  clipperPairStart: () => ipcRenderer.invoke('np:clipperPairStart'),
  clipperPairCancel: () => ipcRenderer.invoke('np:clipperPairCancel'),
  agentCreateClient: (input) => ipcRenderer.invoke('np:agentCreateClient', input),
  agentUpdateClient: (id, patch) => ipcRenderer.invoke('np:agentUpdateClient', id, patch),
  agentRevokeClient: (id) => ipcRenderer.invoke('np:agentRevokeClient', id),
  agentUpdateSettings: (patch) => ipcRenderer.invoke('np:agentUpdateSettings', patch),
  agentDecide: (id, decision, options) => ipcRenderer.invoke('np:agentDecide', id, decision, options),
  agentRevokeGrant: (clientId) => ipcRenderer.invoke('np:agentRevokeGrant', clientId),
  agentLog: (limit) => ipcRenderer.invoke('np:agentLog', limit),
  agentLogClear: () => ipcRenderer.invoke('np:agentLogClear'),
  agentConnector: () => ipcRenderer.invoke('np:agentConnector'),
  agentInstallCli: () => ipcRenderer.invoke('np:agentInstallCli'),
  agentUninstallCli: () => ipcRenderer.invoke('np:agentUninstallCli'),
  onAgentEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('np:agentEvent', listener)
    return () => ipcRenderer.removeListener('np:agentEvent', listener)
  },
  copyLocalApiToken: () => ipcRenderer.invoke('np:copyLocalApiToken'),
  copyText: (value) => ipcRenderer.invoke('np:copyText', value),
  ocrImage: (dataUrl) => ipcRenderer.invoke('np:ocrImage', dataUrl),
  traySetTasks: (snapshot) => ipcRenderer.invoke('np:traySetTasks', snapshot),
  trayTaskResult: (result) => ipcRenderer.invoke('np:trayTaskResult', result),
  onTrayCompleteTask: (handler) => {
    const listener = (_event, id) => { if (typeof id === 'string') handler(id) }
    ipcRenderer.on('np:trayCompleteTask', listener)
    return () => ipcRenderer.removeListener('np:trayCompleteTask', listener)
  },
  listActivity: () => ipcRenderer.invoke('np:listActivity'),
  productivityLoad: () => ipcRenderer.invoke('np:productivityLoad'),
  productivityRecord: (delta) => ipcRenderer.invoke('np:productivityRecord', delta),
  productivityBackfill: (days) => ipcRenderer.invoke('np:productivityBackfill', days),
  productivityClear: () => ipcRenderer.invoke('np:productivityClear'),
  webhookStatus: () => ipcRenderer.invoke('np:webhookStatus'),
  saveMetaConflict: (meta) => ipcRenderer.invoke('np:saveMetaConflict', meta),
  listDocumentConflicts: () => ipcRenderer.invoke('np:listDocumentConflicts'),
  snapshotBackup: () => ipcRenderer.invoke('np:snapshotBackup'),
  listAutoBackups: () => ipcRenderer.invoke('np:listAutoBackups'),
  loadAutoBackup: (file) => ipcRenderer.invoke('np:loadAutoBackup', file),
  backupSettings: () => ipcRenderer.invoke('np:backupSettings'),
  backupSettingsSet: (patch) => ipcRenderer.invoke('np:backupSettingsSet', patch),
  backupChooseFolder: () => ipcRenderer.invoke('np:backupChooseFolder'),
  backupRevealFolder: () => ipcRenderer.invoke('np:backupRevealFolder'),
  backupList: (verify) => ipcRenderer.invoke('np:backupList', verify),
  backupNow: () => ipcRenderer.invoke('np:backupNow'),
  backupDescribe: (id) => ipcRenderer.invoke('np:backupDescribe', id),
  backupRestore: (id) => ipcRenderer.invoke('np:backupRestore', id),
  // Espelho Markdown em texto claro, opt-in (electron/mirror-ipc.cjs)
  mirrorSettings: () => ipcRenderer.invoke('np:mirrorSettings'),
  mirrorSettingsSet: (patch) => ipcRenderer.invoke('np:mirrorSettingsSet', patch),
  mirrorChooseFolder: () => ipcRenderer.invoke('np:mirrorChooseFolder'),
  mirrorSyncState: () => ipcRenderer.invoke('np:mirrorSyncState'),
  mirrorApply: (payload) => ipcRenderer.invoke('np:mirrorApply', payload),
  mirrorReveal: () => ipcRenderer.invoke('np:mirrorReveal'),
  mirrorRemove: () => ipcRenderer.invoke('np:mirrorRemove'),
  draftLoad: (pageId, windowId) => ipcRenderer.invoke('np:draftLoad', pageId, windowId),
  draftSave: (pageId, windowId, blocks) => ipcRenderer.invoke('np:draftSave', pageId, windowId, blocks),
  draftDelete: (pageId, windowId) => ipcRenderer.invoke('np:draftDelete', pageId, windowId),
  // IA (electron/ai/ipc.cjs, docs/AI.md): a chave nunca volta ao renderer.
  aiGetSettings: () => ipcRenderer.invoke('np:aiGetSettings'),
  aiUpdateSettings: (patch) => ipcRenderer.invoke('np:aiUpdateSettings', patch),
  aiSetKey: (provider, key, options) => ipcRenderer.invoke('np:aiSetKey', provider, key, options),
  aiRemoveKey: (provider) => ipcRenderer.invoke('np:aiRemoveKey', provider),
  aiConsent: (provider, granted) => ipcRenderer.invoke('np:aiConsent', provider, granted),
  aiStatus: () => ipcRenderer.invoke('np:aiStatus'),
  aiListModels: (provider) => ipcRenderer.invoke('np:aiListModels', provider),
  aiTest: (provider) => ipcRenderer.invoke('np:aiTest', provider),
  aiPrepare: (input) => ipcRenderer.invoke('np:aiPrepare', input),
  aiRun: (requestId, options) => ipcRenderer.invoke('np:aiRun', requestId, options),
  aiCancel: (requestId) => ipcRenderer.invoke('np:aiCancel', requestId),
  aiEmbed: (texts) => ipcRenderer.invoke('np:aiEmbed', texts),
  aiEmbedStatus: (options) => ipcRenderer.invoke('np:aiEmbedStatus', options),
  aiLoadIndex: () => ipcRenderer.invoke('np:aiLoadIndex'),
  aiSaveIndex: (data) => ipcRenderer.invoke('np:aiSaveIndex', data),
  aiLoadChats: () => ipcRenderer.invoke('np:aiLoadChats'),
  aiSaveChats: (data) => ipcRenderer.invoke('np:aiSaveChats', data),
  onAIEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('np:aiEvent', listener)
    return () => ipcRenderer.removeListener('np:aiEvent', listener)
  },
  pickTranscriptionModel: () => ipcRenderer.invoke('np:pickTranscriptionModel'),
  transcribeAudio: (input) => ipcRenderer.invoke('np:transcribeAudio', input),
  cancelTranscription: () => ipcRenderer.invoke('np:cancelTranscription'),
  calendarStatus: () => ipcRenderer.invoke('np:calendarStatus'),
  calendarRequestAccess: () => ipcRenderer.invoke('np:calendarRequestAccess'),
  calendarList: () => ipcRenderer.invoke('np:calendarList'),
  calendarEvents: (input) => ipcRenderer.invoke('np:calendarEvents', input),
  calendarCreateEvent: (input) => ipcRenderer.invoke('np:calendarCreateEvent', input),
  calendarUpdateEvent: (input) => ipcRenderer.invoke('np:calendarUpdateEvent', input),
  calendarDeleteEvent: (input) => ipcRenderer.invoke('np:calendarDeleteEvent', input),
  openPrivacySettings: (pane) => ipcRenderer.invoke('np:openPrivacySettings', pane),
  remindersStatus: () => ipcRenderer.invoke('np:remindersStatus'),
  remindersRequestAccess: () => ipcRenderer.invoke('np:remindersRequestAccess'),
  remindersEnsureList: (input) => ipcRenderer.invoke('np:remindersEnsureList', input),
  remindersList: (input) => ipcRenderer.invoke('np:remindersList', input),
  remindersUpsert: (input) => ipcRenderer.invoke('np:remindersUpsert', input),
  remindersComplete: (input) => ipcRenderer.invoke('np:remindersComplete', input),
  remindersDelete: (input) => ipcRenderer.invoke('np:remindersDelete', input),
  dictationStatus: (locale) => ipcRenderer.invoke('np:dictationStatus', locale),
  dictationStart: (input) => ipcRenderer.invoke('np:dictationStart', input),
  dictationStop: () => ipcRenderer.invoke('np:dictationStop'),
  dictationCancel: () => ipcRenderer.invoke('np:dictationCancel'),
  onDictationEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('np:dictationEvent', listener)
    return () => ipcRenderer.removeListener('np:dictationEvent', listener)
  },
  onNavigate: (handler) => {
    const listener = (_event, route) => handler(route)
    ipcRenderer.on('np:navigate', listener)
    ipcRenderer.send('np:navigationReady')
    return () => ipcRenderer.removeListener('np:navigate', listener)
  },
  onDataChanged: (handler) => {
    const listener = (_event, change) => handler(change)
    ipcRenderer.on('np:dataChanged', listener)
    return () => ipcRenderer.removeListener('np:dataChanged', listener)
  },
  revealDataFolder: () => ipcRenderer.invoke('np:revealDataFolder'),
  onBeforeClose: (handler) => {
    const listener = async (_event, token) => {
      try { await handler(); ipcRenderer.send('np:closeResult', token, null) }
      catch (error) { ipcRenderer.send('np:closeResult', token, error?.message || 'Falha ao salvar as alterações.') }
    }
    ipcRenderer.on('np:beforeClose', listener)
    ipcRenderer.send('np:rendererReady')
    return () => ipcRenderer.removeListener('np:beforeClose', listener)
  },
  appleNotesFolders: () => ipcRenderer.invoke('np:appleNotesFolders'),
  appleNotesBatch: (folderId, offset, limit) => ipcRenderer.invoke('np:appleNotesBatch', folderId, offset, limit),
  appleNotesCancel: () => ipcRenderer.invoke('np:appleNotesCancel'),
  openMarkdownFile: () => ipcRenderer.invoke('np:openMarkdownFile'),
  externalFileCheck: (id) => ipcRenderer.invoke('np:externalFileCheck', id),
  externalFileReload: (id) => ipcRenderer.invoke('np:externalFileReload', id),
  externalFileSave: (id, text, options) => ipcRenderer.invoke('np:externalFileSave', id, text, options),
  externalFileRelease: (id) => ipcRenderer.invoke('np:externalFileRelease', id),
  onExternalFile: (handler) => {
    const listener = (_event, file) => handler(file)
    ipcRenderer.on('np:externalFile', listener)
    ipcRenderer.send('np:externalFileReady')
    return () => ipcRenderer.removeListener('np:externalFile', listener)
  },
  onCommand: (handler) => {
    const listener = (_event, command) => handler(command)
    ipcRenderer.on('np:command', listener)
    return () => ipcRenderer.removeListener('np:command', listener)
  },
})
