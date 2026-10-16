// Conector do Claude/MCP e comando `workspace` no PATH (A2). Nada aqui edita arquivos de outros apps:
// só devolve o trecho de configuração para o usuário copiar e, após confirmação no app, cria/remove o
// link simbólico ~/.local/bin/workspace -> Desktop.app/Contents/Resources/bin/workspace.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const shellQuote = value => /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`

/** Trechos prontos: JSON de `mcpServers` (Claude Desktop, Cursor...) e o comando do Claude Code. `token` é opcional (cliente nomeado). */
function connectorSnippets({ command, args = ['mcp'], token } = {}) {
  const server = { command, args, ...(token ? { env: { WORKSPACE_API_TOKEN: token } } : {}) }
  const json = JSON.stringify({ mcpServers: { workspace: server } }, null, 2)
  const env = token ? ` -e WORKSPACE_API_TOKEN=${shellQuote(token)}` : ''
  const claudeCode = `claude mcp add workspace${env} -- ${[command, ...args].map(shellQuote).join(' ')}`
  return { json, claudeCode }
}

/** Caminho do executável `workspace` para o app atual (null fora do app empacotado). */
const cliBinPath = ({ packaged, resourcesPath }) => packaged && resourcesPath ? path.join(resourcesPath, 'bin', "workspace") : null
const cliLinkPath = (home = os.homedir()) => path.join(home, '.local', 'bin', "workspace")

/** 'missing' | 'linked' (aponta para este app) | 'stale' (link para outro lugar) | 'file' (arquivo comum, não tocar). */
async function cliStatus({ binPath, home }) {
  const link = cliLinkPath(home)
  let stat
  try { stat = await fs.lstat(link) } catch (error) { if (error.code === 'ENOENT') return { path: link, state: 'missing' }; throw error }
  if (!stat.isSymbolicLink()) return { path: link, state: 'file' }
  const target = await fs.readlink(link)
  return { path: link, state: binPath && path.resolve(path.dirname(link), target) === binPath ? 'linked' : 'stale', target }
}

async function installCli({ binPath, home }) {
  if (!binPath) throw Object.assign(new Error('CLI_UNAVAILABLE'), { code: 'CLI_UNAVAILABLE' })
  try { await fs.access(binPath) } catch { throw Object.assign(new Error('CLI_UNAVAILABLE'), { code: 'CLI_UNAVAILABLE' }) }
  const status = await cliStatus({ binPath, home })
  if (status.state === 'file') throw Object.assign(new Error('CLI_PATH_OCCUPIED'), { code: 'CLI_PATH_OCCUPIED', path: status.path })
  await fs.mkdir(path.dirname(status.path), { recursive: true })
  if (status.state === 'stale') await fs.unlink(status.path)
  if (status.state !== 'linked') await fs.symlink(binPath, status.path)
  return { path: status.path, state: 'linked' }
}

async function uninstallCli({ binPath, home }) {
  const status = await cliStatus({ binPath, home })
  if (status.state === 'linked' || status.state === 'stale') await fs.unlink(status.path)
  else if (status.state === 'file') throw Object.assign(new Error('CLI_PATH_OCCUPIED'), { code: 'CLI_PATH_OCCUPIED', path: status.path })
  return { path: status.path, state: 'missing' }
}

module.exports = { connectorSnippets, cliBinPath, cliLinkPath, cliStatus, installCli, uninstallCli, shellQuote }
