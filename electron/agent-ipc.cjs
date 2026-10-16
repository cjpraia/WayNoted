// IPC de agentes (A1/A2): clientes e escopos, fila de aprovação, registro de chamadas, trecho do conector MCP
// e instalação do comando `workspace` no PATH. A lógica está em agent-access.cjs e agent-connector.cjs.
const os = require('node:os')
const path = require('node:path')
const connector = require('./agent-connector.cjs')

function registerAgentIpc(deps) {
  const { trustedHandler, context, accessFor, apiInfo, dialog, nativeT, app } = deps
  const ws = e => context(e).workspaceId
  const paths = () => {
    const packaged = !!app.isPackaged
    const binPath = connector.cliBinPath({ packaged, resourcesPath: process.resourcesPath })
    // Fora do app empacotado (desenvolvimento) o comando é o próprio repositório.
    const command = binPath ?? 'node'
    const args = binPath ? ['mcp'] : [path.join(__dirname, 'cli.cjs'), 'mcp']
    return { packaged, binPath, command, args }
  }

  trustedHandler('np:agentOverview', async e => {
    const id = ws(e), access = accessFor(id), info = await apiInfo(id)
    const { binPath } = paths()
    return { apiEnabled: info.enabled, url: info.url ?? null, clients: await access.listClients(), settings: await access.settings(), pending: access.listPending(), pairing: access.pairingState(), cli: { available: !!binPath, ...(binPath ? await connector.cliStatus({ binPath, home: os.homedir() }) : {}) } }
  })
  // B1: código de pareamento do web clipper (5 min, uso único). Exige a API local ligada; o token nunca é exibido.
  trustedHandler('np:clipperPairStart', async e => {
    const id = ws(e), info = await apiInfo(id)
    if (!info.enabled) throw Object.assign(new Error('API_DISABLED'), { code: 'API_DISABLED' })
    return { ...accessFor(id).startPairing(), url: info.url }
  })
  trustedHandler('np:clipperPairCancel', e => accessFor(ws(e)).cancelPairing())
  trustedHandler('np:agentPending', e => accessFor(ws(e)).listPending())
  trustedHandler('np:agentCreateClient', async (e, input) => {
    const access = accessFor(ws(e)), created = await access.createClient({ name: input?.name, scopes: input?.scopes, autoWrite: input?.autoWrite === true })
    const { command, args } = paths()
    return { client: created.client, token: created.token, snippets: connector.connectorSnippets({ command, args, token: created.token }) }
  })
  trustedHandler('np:agentUpdateClient', (e, id, patch) => accessFor(ws(e)).updateClient(String(id), { name: patch?.name, scopes: patch?.scopes, autoWrite: patch?.autoWrite }))
  trustedHandler('np:agentRevokeClient', (e, id) => accessFor(ws(e)).revokeClient(String(id)))
  trustedHandler('np:agentUpdateSettings', (e, patch) => accessFor(ws(e)).updateSettings({ timeoutSec: patch?.timeoutSec, legacyNoticeShown: patch?.legacyNoticeShown === true ? true : undefined }))
  trustedHandler('np:agentDecide', (e, id, decision, options) => accessFor(ws(e)).decide(String(id), decision === 'approve' ? 'approve' : 'reject', { grantHour: options?.grantHour === true }))
  trustedHandler('np:agentRevokeGrant', (e, clientId) => accessFor(ws(e)).revokeGrant(String(clientId)))
  trustedHandler('np:agentLog', (e, limit) => accessFor(ws(e)).listLog(Number(limit) || 200))
  trustedHandler('np:agentLogClear', e => accessFor(ws(e)).clearLog())
  trustedHandler('np:agentConnector', async () => {
    const { command, args, binPath } = paths()
    return { ...connector.connectorSnippets({ command, args }), command, packaged: !!binPath }
  })
  trustedHandler('np:agentInstallCli', async e => {
    const { binPath } = paths(), home = os.homedir(), win = context(e).win
    if (!binPath) throw Object.assign(new Error('CLI_UNAVAILABLE'), { code: 'CLI_UNAVAILABLE' })
    const link = connector.cliLinkPath(home)
    // Só depois da confirmação do usuário (nada é instalado sozinho).
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: [nativeT('Instalar', 'Install', win), nativeT('Cancelar', 'Cancel', win)], defaultId: 1, cancelId: 1,
      message: nativeT("Instalar o comando workspace no PATH?", "Install the workspace command in your PATH?", win),
      detail: nativeT(`Cria o link simbólico ${link} apontando para ${binPath}. Nenhum outro arquivo é alterado.`, process.platform === 'win32' ? `Adds ${path.dirname(binPath)} to your user PATH. Open a new terminal afterward. No administrator access is needed.` : `Creates the symbolic link ${link} pointing to ${binPath}. No other file is changed.`, win),
    })
    if (response !== 0) return { cancelled: true }
    return { ...(await connector.installCli({ binPath, home })), cancelled: false }
  })
  trustedHandler('np:agentUninstallCli', async e => {
    const { binPath } = paths(), win = context(e).win, link = connector.cliLinkPath(os.homedir())
    const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: [nativeT('Remover', 'Remove', win), nativeT('Cancelar', 'Cancel', win)], defaultId: 1, cancelId: 1, message: nativeT("Remover o comando workspace do PATH?", "Remove the workspace command from your PATH?", win), detail: nativeT(`Remove o link simbólico ${link}.`, process.platform === 'win32' ? 'Removes this application’s CLI directory from your user PATH. Open a new terminal afterward.' : `Removes the symbolic link ${link}.`, win) })
    if (response !== 0) return { cancelled: true }
    return { ...(await connector.uninstallCli({ binPath, home: os.homedir() })), cancelled: false }
  })
}

module.exports = { registerAgentIpc }
