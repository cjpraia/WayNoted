const PRODUCT = require('../shared/product.json')
// IPC do backup externo (F3): configurações, lista, "Fazer backup agora", verificação, restauração completa
// e o agendador. Toda a lógica de arquivos está em backup.cjs (testável sem Electron).
const fs = require('node:fs/promises')
const path = require('node:path')
const backup = require('./backup.cjs')
const vault = require('./vault.cjs')

function registerBackupIpc(deps) {
  const { trustedHandler, context, contexts, dataDir, userData, dialog, shell, flushRenderer, drainAll, resetWorkspace } = deps
  const currentSchema = () => Number(deps.currentSchema?.()) || backup.SUPPORTED_SCHEMA
  const running = new Map()
  const windowsOf = id => [...contexts.values()].filter(ctx => ctx.workspaceId === id && !ctx.win.isDestroyed()).map(ctx => ctx.win)
  const vaultOf = id => {
    const dir = dataDir(id), enabled = vault.isEnabled(dir)
    return { enabled, key: enabled && !vault.isLocked(dir) ? vault.getKey(dir) : null }
  }
  // Uma operação por vez por espaço. Um pedido de backup que chega durante outro backup (ex.: o automático disparado ao
  // escolher a pasta) se junta a ele e recebe o mesmo resultado; qualquer outro pedido espera a vez, sem erro.
  async function exclusive(id, operation, kind = 'other') {
    for (;;) {
      const current = running.get(id)
      if (!current) break
      if (kind === 'backup' && current.kind === 'backup') return current.promise
      await current.promise.then(() => {}, () => {})
    }
    const promise = (async () => { try { return await operation() } finally { running.delete(id) } })()
    running.set(id, { kind, promise })
    return promise
  }
  async function run(id, kind, { flush } = {}) {
    const settings = await backup.readSettings(userData())
    backup.assertOutsideData(settings.directory, userData())
    return exclusive(id, async () => {
      if (flush) await Promise.all(windowsOf(id).map(win => flushRenderer(win)))
      await drainAll()
      const made = await backup.createBackup({ dataDir: dataDir(id), destRoot: settings.directory, workspaceId: id, kind, schemaVersion: currentSchema(), vault: vaultOf(id) })
      const removed = await backup.applyRetention(settings.directory, id, settings.retention) // só depois de a nova cópia estar verificada
      return { id: made.id, createdAt: made.manifest.createdAt, removed: removed.length }
    }, 'backup')
  }
  const view = list => list.map(({ id, kind, createdAt, size, fileCount, encrypted, schemaVersion, verified, healthy, problems }) => ({ id, kind, createdAt, size, fileCount, encrypted, schemaVersion, verified, healthy, problems }))

  trustedHandler('np:backupSettings', async () => {
    const settings = await backup.readSettings(userData())
    return { ...settings, defaultDirectory: backup.defaultDirectory(userData()), icloud: await backup.suggestICloud() }
  })
  trustedHandler('np:backupSettingsSet', async (_e, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('Configuração inválida')
    const clean = {}
    if ('enabled' in patch) clean.enabled = !!patch.enabled
    if ('intervalHours' in patch) clean.intervalHours = Number(patch.intervalHours)
    if (typeof patch.directory === 'string') clean.directory = patch.directory
    if (patch.retention && typeof patch.retention === 'object') clean.retention = { daily: Number(patch.retention.daily), weekly: Number(patch.retention.weekly), monthly: Number(patch.retention.monthly) }
    return backup.writeSettings(userData(), clean)
  })
  trustedHandler('np:backupChooseFolder', async e => {
    const win = context(e).win
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: `${PRODUCT.name}` })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  trustedHandler('np:backupRevealFolder', async () => {
    const settings = await backup.readSettings(userData())
    await fs.mkdir(settings.directory, { recursive: true, mode: 0o700 })
    await shell.openPath(settings.directory)
    return true
  })
  trustedHandler('np:backupList', async (e, verify) => {
    const settings = await backup.readSettings(userData())
    return view(await backup.listBackups(settings.directory, context(e).workspaceId, { verify: verify === 'full' ? 'full' : 'quick' }))
  })
  trustedHandler('np:backupNow', e => run(context(e).workspaceId, 'manual', { flush: true }))
  trustedHandler('np:backupDescribe', async (e, id) => {
    const settings = await backup.readSettings(userData())
    return backup.describeBackup(backup.setPath(settings.directory, context(e).workspaceId, id))
  })
  trustedHandler('np:backupRestore', async (e, id) => {
    const ctx = context(e), workspaceId = ctx.workspaceId, dir = dataDir(workspaceId)
    const settings = await backup.readSettings(userData())
    const setDir = backup.setPath(settings.directory, workspaceId, id)
    return exclusive(workspaceId, async () => {
      await Promise.all(windowsOf(workspaceId).map(win => flushRenderer(win)))
      await drainAll()
      const result = await backup.restoreFull({ setDir, dataDir: dir, destRoot: settings.directory, workspaceId, schemaVersion: currentSchema(), vault: vaultOf(workspaceId) })
      // Esquecer tudo o que estava em memória sobre a pasta antiga (chaves, estado do cofre, índices) e recarregar as janelas.
      vault.lock(dir)
      vault.state(dir).enabled = undefined
      vault.state(dir).header = null
      resetWorkspace(workspaceId)
      // A janela que pediu recarrega depois que o usuário confirma o aviso de conclusão (a interface chama window.location.reload()).
      for (const win of windowsOf(workspaceId)) if (win !== ctx.win) win.webContents.reload()
      return result
    }, 'restore')
  })

  /** Chamado pelo agendador (main.cjs) para cada espaço aberto: faz a cópia se estiver na hora. */
  async function autoBackup(workspaceId) {
    const settings = await backup.readSettings(userData())
    if (!settings.enabled || running.has(workspaceId)) return null
    if (vault.isEnabled(dataDir(workspaceId)) && vault.isLocked(dataDir(workspaceId))) return null
    const sets = await backup.listBackups(settings.directory, workspaceId, { verify: 'none' })
    if (!backup.isDue(sets, settings.intervalHours)) return null
    return run(workspaceId, 'auto')
  }
  /** Na abertura: se uma restauração caiu entre as duas renomeações, devolve a pasta antiga. */
  async function recoverAll() {
    const root = userData(), ids = ['default']
    try { ids.push(...(await fs.readdir(path.join(root, 'workspaces')))) } catch { /* sem outros espaços */ }
    for (const id of ids) { try { if (await backup.recoverInterruptedRestore(dataDir(id))) console.warn(`[backup] restauração interrompida recuperada: ${id}`) } catch { /* id inválido */ } }
  }
  return { autoBackup, recoverAll, backupNow: id => run(id, 'manual', { flush: true }) }
}

module.exports = { registerBackupIpc }
