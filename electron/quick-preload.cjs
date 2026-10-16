// Ponte mínima da janela de nota rápida (não expõe a API completa do app).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('quickApi', {
  init: () => ipcRenderer.invoke('npq:init'),
  search: (query) => ipcRenderer.invoke('npq:search', query),
  destination: (id) => ipcRenderer.invoke('npq:destination', id),
  saveDraft: (draft) => ipcRenderer.invoke('npq:saveDraft', draft),
  save: (input) => ipcRenderer.invoke('npq:save', input),
  close: () => ipcRenderer.invoke('npq:close'),
  open: (pageId) => ipcRenderer.invoke('npq:open', pageId),
  // Ditado local: só iniciar, parar, cancelar, receber eventos e abrir o painel de permissão certo.
  dictationStart: (input) => ipcRenderer.invoke('npq:dictationStart', { locale: input?.locale }),
  dictationStop: () => ipcRenderer.invoke('npq:dictationStop'),
  dictationCancel: () => ipcRenderer.invoke('npq:dictationCancel'),
  openPrivacySettings: (pane) => ipcRenderer.invoke('npq:openPrivacySettings', pane),
  onDictationEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('npq:dictationEvent', listener)
    return () => ipcRenderer.removeListener('npq:dictationEvent', listener)
  },
  onShow: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('npq:show', listener)
    return () => ipcRenderer.removeListener('npq:show', listener)
  },
})
