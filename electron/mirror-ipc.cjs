const PRODUCT = require('../shared/product.json')
// IPC do espelho Markdown (D1). Texto claro, opt-in e somente leitura: ver electron/mirror.cjs.
// Nada grava com o espelho desligado, com o cofre do espaço bloqueado, ou sem as confirmações.
const fs = require('node:fs/promises')
const path = require('node:path')
const mirror = require('./mirror.cjs')
const backup = require('./backup.cjs')
const vault = require('./vault.cjs')

function registerMirrorIpc(deps) {
  const { trustedHandler, context, dataDir, userData, dialog, shell, app } = deps
  const documents = () => { try { return app.getPath('documents') } catch { return undefined } }
  const backupDirectory = async () => (await backup.readSettings(userData())).directory
  const busy = new Set()
  const vaultOf = id => { const dir = dataDir(id); return { enabled: vault.isEnabled(dir), locked: vault.isEnabled(dir) && vault.isLocked(dir) } }
  const settings = () => mirror.readSettings(userData(), documents())

  trustedHandler('np:mirrorSettings', async e => {
    const id = context(e).workspaceId, current = await settings()
    const state = await mirror.readState(userData(), id)
    return {
      ...current, defaultDirectory: mirror.defaultDirectory(documents()), vault: vaultOf(id),
      status: { ...state.status, root: state.root ?? null, hasFiles: Object.keys(state.files).length > 0 },
    }
  })
  trustedHandler('np:mirrorSettingsSet', async (_e, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('Configuração inválida')
    const clean = {}
    if ('enabled' in patch) { clean.enabled = patch.enabled === true; clean.acknowledged = patch.acknowledged === true }
    if (typeof patch.directory === 'string') clean.directory = patch.directory
    if ('vaultAcknowledged' in patch) clean.vaultAcknowledged = patch.vaultAcknowledged === true
    return mirror.writeSettings(userData(), clean, { documents: documents(), backupDirectory: await backupDirectory() })
  })
  trustedHandler('np:mirrorChooseFolder', async e => {
    const win = context(e).win, current = await settings()
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: `${PRODUCT.name}`, defaultPath: path.dirname(current.directory) })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  trustedHandler('np:mirrorSyncState', async e => {
    const id = context(e).workspaceId, current = await settings()
    if (!current.enabled) return null
    return mirror.syncState(userData(), id, current.directory)
  })
  trustedHandler('np:mirrorApply', async (e, payload) => {
    const id = context(e).workspaceId
    if (!payload || typeof payload !== 'object') throw new Error('Lote inválido')
    const current = await settings()
    if (!current.enabled) throw mirror.mirrorError('MIRROR_OFF', 'O espelho Markdown está desligado.', 'The Markdown mirror is off.')
    const state = vaultOf(id)
    if (state.locked) throw mirror.mirrorError('MIRROR_LOCKED', 'Desbloqueie o espaço para atualizar o espelho.', 'Unlock the workspace to update the mirror.')
    if (state.enabled && !current.vaultAcknowledged) throw mirror.mirrorError('MIRROR_NEEDS_VAULT_ACK', 'Este espaço tem senha: confirme que o espelho em texto claro anula essa proteção para as páginas espelhadas.', 'This workspace has a password: confirm that the clear-text mirror bypasses that protection for mirrored pages.')
    if (busy.has(id)) throw mirror.mirrorError('MIRROR_BUSY', 'O espelho já está sendo atualizado.', 'The mirror is already updating.')
    busy.add(id)
    try {
      const root = await mirror.assertMirrorDirectory(current.directory, { userData: userData(), backupDirectory: await backupDirectory() })
      if (typeof payload.error === 'string') { await mirror.recordError(userData(), id, payload.error); return null }
      return await mirror.applyBatch({ root, userData: userData(), workspaceId: id, workspaceName: String(payload.workspaceName ?? ''), payload })
    } catch (error) {
      await mirror.recordError(userData(), id, String(error.message ?? error).replace(/^[A-Z_]+: /, '').split(' / ')[0]).catch(() => {})
      throw error
    } finally { busy.delete(id) }
  })
  trustedHandler('np:mirrorReveal', async () => {
    const current = await settings()
    try { await fs.access(current.directory) } catch { throw mirror.mirrorError('MIRROR_EMPTY', 'A pasta do espelho ainda não existe.', 'The mirror folder does not exist yet.') }
    await shell.openPath(current.directory)
    return true
  })
  trustedHandler('np:mirrorRemove', async e => {
    const id = context(e).workspaceId, current = await settings()
    if (current.enabled) throw mirror.mirrorError('MIRROR_STILL_ON', 'Desligue o espelho antes de remover os arquivos.', 'Turn the mirror off before removing the files.')
    if (busy.has(id)) throw mirror.mirrorError('MIRROR_BUSY', 'O espelho está sendo atualizado.', 'The mirror is updating.')
    busy.add(id)
    try { return await mirror.removeMirrorFiles({ root: current.directory, userData: userData(), workspaceId: id }) } finally { busy.delete(id) }
  })
}

module.exports = { registerMirrorIpc }
