// Canais IPC da IA (docs/AI.md). Todos via `trustedHandler` (frame principal do app); streaming
// pelo evento `np:aiEvent`. Nada aqui devolve a chave: só `{ configured, last4 }`.
const vault = require('../vault.cjs')
const pageLocks = require('../vault-pages.cjs')
const { createAIService } = require('./service.cjs')

function registerAIIpc({ trustedHandler, context, dataDir, storage, safeStorage, isFileProtected, fetchImpl }) {
  const service = createAIService({
    dataDir, safeStorage, isFileProtected, fetchImpl,
    loadMeta: ws => storage(ws).loadMeta(),
    isProtected: (ws, pageId) => { try { return pageLocks.isProtected(dataDir(ws), pageId) } catch { return true } },
    recordActivity: (ws, entry) => storage(ws).recordActivity?.([entry]),
  })
  const ws = event => {
    const id = context(event).workspaceId
    if (vault.isLocked(dataDir(id))) throw new Error('VAULT_LOCKED')
    return id
  }
  const owner = event => event.sender.id
  const controllers = new Map()
  const cancellable = async (event, operation) => {
    const key = owner(event)
    controllers.get(key)?.abort()
    const controller = new AbortController(); controllers.set(key, controller)
    try { return await operation(controller.signal) } finally { if (controllers.get(key) === controller) controllers.delete(key) }
  }
  trustedHandler('np:aiGetSettings', e => service.getSettings(ws(e)))
  trustedHandler('np:aiUpdateSettings', (e, patch) => service.updateSettings(ws(e), patch))
  trustedHandler('np:aiSetKey', async (e, provider, key, options) => { await service.setKey(ws(e), provider, key, { storage: options?.storage === 'session' ? 'session' : 'auto' }); return service.getSettings(ws(e)) })
  trustedHandler('np:aiRemoveKey', async (e, provider) => { await service.removeKey(ws(e), provider); return service.getSettings(ws(e)) })
  trustedHandler('np:aiConsent', (e, provider, granted) => service.setConsent(ws(e), provider, granted))
  trustedHandler('np:aiStatus', e => service.status(ws(e)))
  trustedHandler('np:aiListModels', (e, provider) => cancellable(e, signal => service.listModels(ws(e), provider, signal)))
  trustedHandler('np:aiTest', (e, provider) => cancellable(e, signal => service.test(ws(e), provider, signal)))
  trustedHandler('np:aiPrepare', (e, input) => service.prepare(ws(e), owner(e), input))
  trustedHandler('np:aiRun', (e, requestId, options) => {
    const sender = e.sender
    return service.run(owner(e), requestId, options, payload => { if (!sender.isDestroyed?.()) sender.send('np:aiEvent', payload) })
  })
  trustedHandler('np:aiCancel', (e, requestId) => { service.cancel(owner(e), typeof requestId === 'string' ? requestId : undefined); controllers.get(owner(e))?.abort() })
  trustedHandler('np:aiEmbed', (e, texts) => service.embed(ws(e), texts))
  trustedHandler('np:aiEmbedStatus', (e, options) => service.embedStatus(ws(e), { download: options?.download === true }))
  trustedHandler('np:aiLoadIndex', e => service.loadFile(ws(e), 'index'))
  trustedHandler('np:aiSaveIndex', (e, data) => service.saveFile(ws(e), 'index', data))
  trustedHandler('np:aiLoadChats', e => service.loadFile(ws(e), 'chats'))
  trustedHandler('np:aiSaveChats', (e, data) => service.saveFile(ws(e), 'chats', data))
  return { service, closeWindow: id => { service.cancel(id); controllers.get(id)?.abort(); controllers.delete(id) } }
}
module.exports = { registerAIIpc }
