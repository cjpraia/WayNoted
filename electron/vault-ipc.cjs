const PRODUCT = require('../shared/product.json')
// IPC, auto-lock and Touch ID wiring for the workspace vault and password-protected pages.
const vault = require('./vault.cjs')
const vaultWorkspace = require('./vault-workspace.cjs')
const pageLocks = require('./vault-pages.cjs')
const { atomicWrite } = require('./storage.cjs')
const { purgeBrowserStorage } = require('./browser-storage.cjs')

function registerVaultIpc(deps) {
  const { trustedHandler, contexts, dataDir, storage, flushRenderer, broadcast, configureLocalApi, safeStorage, systemPreferences, powerMonitor, drainAll, nativeT } = deps
  const activity = new Map()
  const busy = new Set()
  const ctxOf = event => { const ctx = contexts.get(event.sender.id); if (!ctx) throw new Error('Janela indisponível'); return ctx }
  const windowsOf = id => [...contexts.values()].filter(ctx => ctx.workspaceId === id && !ctx.win.isDestroyed()).map(ctx => ctx.win)
  const workspaceIds = () => [...new Set(['default', ...[...contexts.values()].map(ctx => ctx.workspaceId)])]
  // Só Touch ID/biometria: o Keychain NÃO é consultado aqui (nem ao abrir Configurações). Ele só é tocado ao ATIVAR ou usar o Touch ID.
  const touchIdAvailable = () => { try { return process.platform === 'darwin' && !!systemPreferences?.canPromptTouchID?.() } catch { return false } }
  // Rascunhos da captura rápida guardados só na memória enquanto o espaço estava bloqueado.
  const afterUnlock = id => { void Promise.resolve(deps.onUnlocked?.(id)).catch(console.error) }
  const flushAll = id => Promise.all(windowsOf(id).map(win => flushRenderer(win))).then(drainAll)
  async function publishMeta(id) { try { broadcast(id, { meta: await storage(id).loadMeta() }) } catch (error) { console.error(error) } }
  function pageSettings(dir) { try { return pageLocks.settings(dir) } catch { return null } }
  async function status(id) {
    const dir = dataDir(id), result = await vaultWorkspace.status(dir)
    return { ...result, workspaceId: id, touchIdAvailable: touchIdAvailable(), pages: result.locked ? null : { settings: pageSettings(dir), roots: (() => { try { return pageLocks.list(dir) } catch { return [] } })() } }
  }
  async function exclusive(id, operation) {
    if (busy.has(id)) throw vault.vaultError('VAULT_BUSY', 'Outra operação de segurança está em andamento.', 'Another security operation is in progress.')
    busy.add(id)
    try { return await operation() } finally { busy.delete(id) }
  }

  // Chromium's IndexedDB (search cache) is clear text and LevelDB keeps deleted values until
  // compaction: whenever protection changes (vault on/lock/unlock, page lock/unlock) the whole
  // store is dropped from disk, then the windows are told to reopen their in-memory index.
  // A second pass runs a little later to catch writes that were in flight with the old state.
  const purgeTimers = new Map()
  async function purgeBrowserCaches(win, id) {
    const session = win?.webContents?.session ?? deps.session
    const userData = deps.userData?.()
    try { await purgeBrowserStorage(session, userData) } catch (error) { console.error(error) }
    if (!id) return
    broadcast(id, { cacheReset: true })
    clearTimeout(purgeTimers.get(id))
    const timer = setTimeout(() => {
      purgeTimers.delete(id)
      void purgeBrowserStorage(session?.isDestroyed?.() ? deps.session : session, userData).then(() => broadcast(id, { cacheReset: true })).catch(console.error)
    }, deps.trailingPurgeMs ?? 2500)
    timer.unref?.()
    purgeTimers.set(id, timer)
  }
  const firstWindow = id => windowsOf(id)[0]
  /** Flushes pending edits, forgets every key and reloads the windows (the UI and its memory are discarded). */
  async function lockWorkspace(id, reason = 'manual') {
    const dir = dataDir(id)
    if (!vault.isEnabled(dir) || vault.isLocked(dir) || busy.has(id)) return false
    try { await flushAll(id) }
    catch (error) {
      if (reason === 'manual') throw error
      activity.set(dir, Date.now() - Math.max(0, (vault.state(dir).header?.settings?.autoLockMinutes ?? 15) - 1) * 60000)
      return false
    }
    await configureLocalApi(id, false).catch(console.error)
    vault.lock(dir)
    await purgeBrowserCaches(firstWindow(id), null)
    for (const win of windowsOf(id)) win.webContents.reload()
    return true
  }
  async function relockPage(id, rootId, reason = 'manual') {
    const dir = dataDir(id)
    if (!pageLocks.isUnlocked(dir, rootId)) return false
    try { await flushAll(id) } catch (error) { if (reason === 'manual') throw error; pageLocks.touch(dir, rootId); return false }
    pageLocks.relock(dir, rootId)
    await publishMeta(id)
    await purgeBrowserCaches(firstWindow(id), id)
    return true
  }

  trustedHandler('np:vaultStatus', e => status(ctxOf(e).workspaceId))
  trustedHandler('np:vaultActivity', e => { const dir = dataDir(ctxOf(e).workspaceId); if (!vault.isLocked(dir)) activity.set(dir, Date.now()) })
  trustedHandler('np:vaultUnlock', async (e, password) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id)
    await vaultWorkspace.unlock(dir, password); activity.set(dir, Date.now()); afterUnlock(id); await purgeBrowserCaches(ctxOf(e).win, id); return status(id)
  })
  trustedHandler('np:vaultUnlockTouchID', async e => {
    const ctx = ctxOf(e), dir = dataDir(ctx.workspaceId)
    if (!touchIdAvailable()) throw vault.vaultError('TOUCH_ID_UNAVAILABLE', 'Touch ID indisponível neste Mac.', 'Touch ID is unavailable on this Mac.')
    await systemPreferences.promptTouchID(nativeT(`desbloquear o espaço do ${PRODUCT.name}`, `unlock the ${PRODUCT.name} workspace`, ctx.win))
    await vaultWorkspace.unlockWithKeychain(dir, safeStorage); activity.set(dir, Date.now()); afterUnlock(ctx.workspaceId); await purgeBrowserCaches(ctx.win, ctx.workspaceId); return status(ctx.workspaceId)
  })
  trustedHandler('np:vaultUnlockRecovery', async (e, recoveryKey, newPassword) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id)
    await vaultWorkspace.unlockWithRecovery(dir, recoveryKey, newPassword); activity.set(dir, Date.now()); afterUnlock(id); await purgeBrowserCaches(ctxOf(e).win, id); return status(id)
  })
  trustedHandler('np:vaultEnable', async (e, password, options = {}) => {
    const ctx = ctxOf(e), id = ctx.workspaceId, dir = dataDir(id)
    if (options?.acknowledged !== true) throw new Error(nativeT('Confirme que entendeu que sem a senha e sem a chave de recuperação os dados são irrecuperáveis.', 'Confirm you understand that without the password and the recovery key the data cannot be recovered.', ctx.win))
    return exclusive(id, async () => {
      await flushAll(id)
      // O rascunho antigo em texto claro (raiz dos dados) entra na pasta do espaço e é apagado
      // antes da recifragem; o novo fica cifrado pelo cofre junto com o resto.
      await deps.beforeVaultChange?.(id)
      const result = await vaultWorkspace.enable(dir, password, { locale: ctx.locale, hint: options.hint })
      activity.set(dir, Date.now())
      await purgeBrowserCaches(ctx.win, id)
      return { recoveryKey: result.recoveryKey, status: await status(id) }
    })
  })
  trustedHandler('np:vaultDisable', async (e, password) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id)
    return exclusive(id, async () => { await flushAll(id); await deps.beforeVaultChange?.(id); await vaultWorkspace.disable(dir, password); return status(id) })
  })
  trustedHandler('np:vaultChangePassword', async (e, oldPassword, newPassword, options = {}) => { const id = ctxOf(e).workspaceId; await vaultWorkspace.changePassword(dataDir(id), oldPassword, newPassword, { hint: options?.hint }); return status(id) })
  trustedHandler('np:vaultRegenerateRecovery', async (e, password) => vaultWorkspace.regenerateRecovery(dataDir(ctxOf(e).workspaceId), password))
  trustedHandler('np:vaultSetOptions', async (e, patch) => { const id = ctxOf(e).workspaceId; await vaultWorkspace.setOptions(dataDir(id), patch ?? {}); return status(id) })
  trustedHandler('np:vaultSetTouchID', async (e, enabled) => {
    const ctx = ctxOf(e), dir = dataDir(ctx.workspaceId)
    if (enabled) {
      if (!touchIdAvailable()) throw vault.vaultError('TOUCH_ID_UNAVAILABLE', 'Touch ID indisponível neste Mac.', 'Touch ID is unavailable on this Mac.')
      await systemPreferences.promptTouchID(nativeT('ativar o desbloqueio por Touch ID', 'turn on Touch ID unlock', ctx.win))
      await vaultWorkspace.enableTouchId(dir, safeStorage)
    } else await vaultWorkspace.disableTouchId(dir)
    return status(ctx.workspaceId)
  })
  trustedHandler('np:vaultLock', async e => lockWorkspace(ctxOf(e).workspaceId, 'manual'))

  /* ----------------------------- protected pages ---------------------------- */
  trustedHandler('np:pageLockInfo', e => { const dir = dataDir(ctxOf(e).workspaceId); return { settings: pageLocks.settings(dir), roots: pageLocks.list(dir) } })
  trustedHandler('np:pageProtect', async (e, pageId, password, options = {}) => {
    const id = ctxOf(e).workspaceId
    return exclusive(id, async () => {
      await flushAll(id)
      const meta = await storage(id).protectPages(pageId, password, { includeChildren: !!options.includeChildren, hideTitle: !!options.hideTitle, hint: options.hint })
      broadcast(id, { meta })
      await purgeBrowserCaches(ctxOf(e).win, id)
      return meta
    })
  })
  trustedHandler('np:pageUnlock', async (e, pageId, password) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id), rootId = pageLocks.rootOf(dir, pageId)
    if (!rootId) return publishMeta(id)
    await pageLocks.unlock(dir, rootId, password)
    await storage(id).resealProtected(rootId)
    const meta = await storage(id).loadMeta(); broadcast(id, { meta }); await purgeBrowserCaches(ctxOf(e).win, id); return meta
  })
  trustedHandler('np:pageRelock', async (e, rootId) => relockPage(ctxOf(e).workspaceId, String(rootId), 'manual'))
  trustedHandler('np:pageActivity', (e, rootId) => pageLocks.touch(dataDir(ctxOf(e).workspaceId), String(rootId)))
  trustedHandler('np:pageUnprotect', async (e, pageId, password) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id), rootId = pageLocks.rootOf(dir, pageId)
    if (!rootId) return storage(id).loadMeta()
    await pageLocks.unlock(dir, rootId, password)
    return exclusive(id, async () => { await flushAll(id); const meta = await storage(id).unprotectPages(rootId); broadcast(id, { meta }); return meta })
  })
  trustedHandler('np:pageProtectChildren', async (e, pageId, pageIds) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id), rootId = pageLocks.rootOf(dir, String(pageId))
    if (!rootId) throw new Error('NOT_PROTECTED')
    const result = await storage(id).protectChildren(rootId, Array.isArray(pageIds) ? pageIds.map(String) : undefined)
    broadcast(id, { meta: result.meta })
    await purgeBrowserCaches(ctxOf(e).win, id)
    return result
  })
  trustedHandler('np:pageLockHint', (e, pageId) => pageLocks.hintOf(dataDir(ctxOf(e).workspaceId), String(pageId)))
  trustedHandler('np:pageChangePassword', async (e, pageId, oldPassword, newPassword, options = {}) => {
    const dir = dataDir(ctxOf(e).workspaceId), rootId = pageLocks.rootOf(dir, pageId)
    if (!rootId) throw new Error('NOT_PROTECTED')
    await pageLocks.changePassword(dir, rootId, oldPassword, newPassword, atomicWrite, { hint: options?.hint })
  })
  trustedHandler('np:pageSetOptions', async (e, patch) => pageLocks.setOptions(dataDir(ctxOf(e).workspaceId), patch ?? {}, atomicWrite))
  trustedHandler('np:pageSetHideTitle', async (e, pageId, hideTitle) => {
    const id = ctxOf(e).workspaceId, dir = dataDir(id), rootId = pageLocks.rootOf(dir, pageId)
    if (!rootId) throw new Error('NOT_PROTECTED')
    await pageLocks.setHideTitle(dir, rootId, hideTitle, atomicWrite)
    const meta = await storage(id).refreshProtectedMeta(); broadcast(id, { meta }); return meta
  })

  /* ------------------------------- auto-lock -------------------------------- */
  async function tick() {
    const now = Date.now()
    for (const id of workspaceIds()) {
      const dir = dataDir(id)
      if (vault.isEnabled(dir) && !vault.isLocked(dir)) {
        const minutes = vault.state(dir).header?.settings?.autoLockMinutes ?? 15
        if (!activity.has(dir)) activity.set(dir, now)
        if (minutes > 0 && now - activity.get(dir) >= minutes * 60000) { await lockWorkspace(id, 'idle').catch(console.error); continue }
      }
      if (vault.isLocked(dir)) continue
      const settings = pageSettings(dir)
      if (!settings?.relockMinutes) continue
      for (const { rootId, lastActivity } of pageLocks.unlockedRoots(dir)) if (now - lastActivity >= settings.relockMinutes * 60000) await relockPage(id, rootId, 'idle').catch(console.error)
    }
  }
  const timer = setInterval(() => void tick().catch(console.error), 15000)
  timer.unref?.()
  const onSleep = () => {
    for (const id of workspaceIds()) {
      const dir = dataDir(id)
      for (const { rootId } of (() => { try { return pageLocks.unlockedRoots(dir) } catch { return [] } })()) void relockPage(id, rootId, 'sleep').catch(console.error)
      if (vault.isEnabled(dir) && !vault.isLocked(dir) && vault.state(dir).header?.settings?.lockOnSleep !== false) void lockWorkspace(id, 'sleep').catch(console.error)
    }
  }
  powerMonitor?.on('suspend', onSleep)
  powerMonitor?.on('lock-screen', onSleep)
  return { lockWorkspace, relockPage, tick, stop: () => clearInterval(timer) }
}

module.exports = { registerVaultIpc }
