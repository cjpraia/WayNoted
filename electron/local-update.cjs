const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')
const { randomUUID } = require('node:crypto')
const run = promisify(execFile)

function configuration(app, env) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !app.isPackaged) return null
  try {
    const checkout = fs.realpathSync(env.WORKSPACE_UPDATE_CHECKOUT)
    const node = fs.realpathSync(env.WORKSPACE_UPDATE_NODE)
    const npm = fs.realpathSync(env.WORKSPACE_UPDATE_NPM)
    fs.accessSync(node, fs.constants.X_OK)
    fs.accessSync(npm, fs.constants.X_OK)
    const build = path.join(checkout, 'build', 'local-update.mjs')
    if (!fs.statSync(build).isFile() || fs.realpathSync(build) !== build ||
        !fs.statSync(path.join(checkout, 'node_modules')).isDirectory()) return null
    return { checkout, node, npm, build }
  } catch { return null }
}

function start(command, args, options) {
  const child = spawn(command, args, options)
  const started = new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  return { child, started }
}

function launchEnvironment(config, source) {
  const env = {
    PATH: [path.dirname(config.node), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    WORKSPACE_UPDATE_CHECKOUT: config.checkout,
    WORKSPACE_UPDATE_NODE: config.node,
    WORKSPACE_UPDATE_NPM: config.npm,
  }
  for (const key of ['WORKSPACE_SIGN_IDENTITY', 'WORKSPACE_HARDENED_RUNTIME']) if (source[key]) env[key] = source[key]
  return env
}

async function checkTools(config) {
  try {
    const env = launchEnvironment(config, {})
    const options = { cwd: config.checkout, env: { ...process.env, ...env }, timeout: 5000 }
    const { stdout } = await run(config.node, ['--version'], options)
    if (Number(stdout.trim().match(/^v(\d+)/)?.[1]) < 24 || !/^v\d+\./.test(stdout)) throw new Error('Node.js 24+ is required.')
    await run(config.node, [config.npm, '--version'], options)
    await run('/usr/bin/xcrun', ['--find', 'swiftc'], options)
  } catch (error) {
    const permissionDenied = /\b(?:EPERM|EACCES)\b/.test(error.message)
    throw Object.assign(new Error(error.message), { code: permissionDenied ? 'UPDATE_CHECKOUT_PERMISSION' : 'UPDATE_TOOLS_MISSING' })
  }
}

async function prepare(config, test, launchEnv) {
  const logRoot = path.join(config.checkout, '.artifacts')
  fs.mkdirSync(logRoot, { recursive: true, mode: 0o700 })
  if (fs.realpathSync(logRoot) !== logRoot) throw new Error('Invalid build output directory.')
  const directory = fs.mkdtempSync(path.join(logRoot, 'update-'))
  const log = path.join(directory, 'update.log')
  const fd = fs.openSync(log, 'wx', 0o600)
  try {
    const result = start(config.node, [config.build, config.checkout, directory, config.npm, ...(test ? ['--test'] : [])], {
      env: { ...process.env, ...launchEnv }, cwd: config.checkout, stdio: ['ignore', fd, fd],
    })
    const exit = new Promise(resolve => result.child.once('close', resolve))
    await result.started
    if (await exit !== 0) throw new Error('See build log.')
    const bundle = fs.realpathSync(fs.readFileSync(path.join(directory, 'bundle'), 'utf8'))
    if (!bundle.startsWith(directory + path.sep) || !bundle.endsWith('.app')) throw new Error('Invalid build output.')
    return { directory, log, bundle }
  } catch (error) {
    throw new Error(error.message + '\n' + log, { cause: error })
  } finally { fs.closeSync(fd) }
}

function prepareHandoff(result, profile, config) {
  const token = randomUUID()
  const args = {
    pid: process.pid, profile, bundle: result.bundle, token,
    locale: config.locale, context: config.launchEnv,
  }
  const transfer = path.join(result.directory, 'handoff.json')
  fs.writeFileSync(transfer, JSON.stringify(args), { flag: 'wx', mode: 0o600 })
  // The external Node cannot read Electron's asar archive. Copy the exact running code into the private build directory.
  const supervisor = path.join(result.directory, 'supervisor.cjs')
  fs.writeFileSync(supervisor, fs.readFileSync(__filename), { flag: 'wx', mode: 0o600 })
  const log = fs.openSync(result.log, 'a')
  try {
    const startOptions = { detached: true, stdio: ['ignore', log, log] }
    return { ...start(config.node, [supervisor, transfer], startOptions), token }
  } finally { fs.closeSync(log) }
}

function acknowledgeStartup(profile, executable, env = process.env) {
  const directory = env.WORKSPACE_UPDATE_RESULT
  const token = env.WORKSPACE_UPDATE_TOKEN
  if (!directory || !path.isAbsolute(directory) || !/^[a-f0-9-]{36}$/.test(token ?? '')) return false
  delete env.WORKSPACE_UPDATE_RESULT
  delete env.WORKSPACE_UPDATE_TOKEN
  try {
    const transfer = JSON.parse(fs.readFileSync(path.join(directory, 'handoff.json'), 'utf8'))
    const executableDir = path.join(transfer.bundle, 'Contents', 'MacOS')
    if (token !== transfer.token || profile !== transfer.profile || path.dirname(executable) !== executableDir) return false
    fs.writeFileSync(path.join(directory, 'ready'), token, { flag: 'wx', mode: 0o600 })
    return true
  } catch (error) { console.error(error); return false }
}

function pidExists(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function supervise(transfer) {
  const directory = path.dirname(transfer)
  const { pid, profile, bundle, token, locale, context } = JSON.parse(fs.readFileSync(transfer, 'utf8'))
  const match = file => {
    try { return fs.readFileSync(path.join(directory, file), 'utf8') === token }
    catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }
  const deadline = Date.now() + 30000
  while (pidExists(pid) && Date.now() < deadline) await delay(125)
  if (pidExists(pid) || !match('quit')) return
  try {
    const args = ['-n', bundle]
    for (const [name, value] of Object.entries({
      ...context, WORKSPACE_USER_DATA: profile, WORKSPACE_UPDATE_RESULT: directory, WORKSPACE_UPDATE_TOKEN: token,
    })) args.push('--env', name + '=' + value)
    await run('/usr/bin/open', args)
    const startupDeadline = Date.now() + 60000
    while (!match('ready') && Date.now() < startupDeadline) await delay(250)
    if (!match('ready')) throw new Error('Updated app did not confirm startup.')
  } catch (error) {
    console.error(error)
    // A newer bundle may already have migrated the profile. Leave both bundles intact.
    const message = locale === 'pt-BR'
      ? 'O WayNoted atualizado não confirmou a abertura. O pacote anterior foi preservado. Consulte update.log em:'
      : 'The updated WayNoted did not confirm startup. The previous bundle was kept. See update.log in:'
    await run('/usr/bin/osascript', ['-e', 'on run argv\n display alert "WayNoted" message ((item 1 of argv) & return & (item 2 of argv)) as warning\nend run', '--', message, directory])
  }
}

module.exports = { configuration, launchEnvironment, checkTools, prepare, prepareHandoff, acknowledgeStartup }
if (require.main === module) supervise(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
