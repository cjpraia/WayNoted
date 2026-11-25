import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import brand from '../electron/brand.cjs'

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
function checked(command, args, options) {
  const result = run(command, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `${command} failed (${result.status ?? result.signal}).`)
  return result.stdout?.trim()
}

const modes = process.argv.slice(2)
const remote = modes.includes('--remote-main')
const rebuild = modes.includes('--rebuild')
const test = modes.includes('--test')
if (modes.some(mode => !['--remote-main', '--rebuild', '--test'].includes(mode)) || remote && rebuild) throw new Error('Invalid launcher arguments.')
brand.legacyEnv()
const artifacts = path.join(root, '.artifacts')
const appData = path.join(os.homedir(), 'Library', 'Application Support')
const override = process.env.WORKSPACE_USER_DATA
if (test && (!override || !fs.realpathSync(override).startsWith(artifacts + path.sep))) {
  throw new Error('A test launch requires a dedicated profile inside the project .artifacts folder.')
}
const profile = () => path.resolve(override || brand.userDataPath(appData))
const bundleId = PRODUCT.bundleId + (test ? '.test' : '')
const appName = PRODUCT.executable + '.app'
const bundlePath = (source, testBuild = test) => path.join(source, testBuild ? 'release-test' : 'release', 'Desktop-darwin-arm64', appName)
const localBundle = bundlePath(root)
const insideProject = bundle => bundle === localBundle || bundle.startsWith(artifacts + path.sep)
const bundleIdentity = bundle => checked('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')])

function processForPid(pid) {
  return run('/bin/ps', ['-www', '-p', String(pid), '-o', 'command=']).stdout?.trim()
}

function runningForProfile() {
  let lock
  try { lock = fs.readlinkSync(path.join(profile(), 'SingletonLock')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const pid = Number(lock.match(/-(\d+)$/)?.[1])
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Não foi possível identificar a instância ativa. / Could not identify the active instance.')
  const fullCommand = processForPid(pid)
  if (!fullCommand) return null
  const bundle = fullCommand.match(/^(\/.*?\.app)\/Contents\/MacOS\/[\w.-]+(?:\s|$)/)?.[1]
  if (!bundle || !insideProject(bundle) || bundleIdentity(bundle) !== bundleId) {
    throw new Error('O perfil está aberto em outra instalação. Feche-a antes de continuar. / This profile is open in another installation. Close it to continue.')
  }
  return { pid, bundle }
}

function directory(prefix) {
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 })
  if (fs.realpathSync(artifacts) !== artifacts) throw new Error('Invalid build output directory.')
  return fs.mkdtempSync(path.join(artifacts, prefix))
}

function sameDependencies(source) {
  const readLock = folder => {
    const lock = JSON.parse(fs.readFileSync(path.join(folder, 'package-lock.json'), 'utf8'))
    delete lock.version
    if (lock.packages?.['']) delete lock.packages[''].version
    return JSON.stringify(lock)
  }
  return fs.existsSync(path.join(root, 'node_modules')) && readLock(root) === readLock(source)
}

function buildRemote(npm) {
  const remoteUrl = checked('/usr/bin/git', ['remote', 'get-url', 'origin'])
  if (remoteUrl !== PRODUCT.repositoryUrl && remoteUrl !== PRODUCT.repositoryUrl + '.git') throw new Error('Unexpected WayNoted origin.')
  const launchRef = 'refs/waynoted-build/main'
  checked('/usr/bin/git', ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', 'refs/heads/main:' + launchRef], { stdio: 'inherit' })
  const commit = checked('/usr/bin/git', ['rev-parse', launchRef])
  console.log('Compilando origin/main', commit.slice(0, 8))
  const source = path.join(directory('main-build-'), 'source')
  checked('/usr/bin/git', ['worktree', 'add', '--detach', source, commit], { stdio: 'inherit' })
  if (sameDependencies(source)) fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(source, 'node_modules'), 'dir')
  else checked(npm, ['ci'], { cwd: source, stdio: 'inherit' })
  checked(npm, ['run', test ? 'dist:test' : 'dist'], { cwd: source, stdio: 'inherit' })
  return { bundle: bundlePath(source), commit, checkout: source }
}

function buildLocal(npm) {
  const runDirectory = directory('update-')
  checked(process.execPath, ['build/local-update.mjs', root, runDirectory, npm, ...(test ? ['--test'] : [])], { stdio: 'inherit' })
  const bundle = fs.realpathSync(fs.readFileSync(path.join(runDirectory, 'bundle'), 'utf8'))
  if (!bundle.startsWith(runDirectory + path.sep) || !bundle.endsWith('.app')) throw new Error('Invalid build output.')
  return { bundle, commit: checked('/usr/bin/git', ['rev-parse', 'HEAD']), checkout: root }
}

async function waitForSafeClose(active) {
  console.log('Compilação pronta. Salve e encerre o WayNoted para abrir esta versão.')
  console.log('Build ready. Save and quit WayNoted to open this version.')
  for (let i = 0; i < 600; i++) {
    const stillRunning = runningForProfile()
    if (!stillRunning) return
    if (stillRunning.pid !== active.pid) throw new Error('O WayNoted foi reaberto durante a espera. / WayNoted reopened while waiting.')
    await delay(100)
  }
  throw new Error('O app continua aberto. A compilação ficou preservada. / The app is still open. The build was kept.')
}

async function launch() {
  const active = runningForProfile()
  if (active && !remote && !rebuild) {
    checked('/usr/bin/open', ['-a', active.bundle])
    return
  }
  if (active && rebuild) {
    throw new Error('O WayNoted já está aberto. Use Visualizar → Recompilar e reiniciar WayNoted. / WayNoted is already open. Use the View menu.')
  }
  const npm = fs.realpathSync(checked('/usr/bin/which', ['npm']))
  const result = remote ? buildRemote(npm) : buildLocal(npm)
  checked('/usr/bin/codesign', ['--verify', '--deep', '--strict', result.bundle])
  if (bundleIdentity(result.bundle) !== bundleId) throw new Error('Incorrect bundle identity.')

  const current = runningForProfile()
  if (current && !remote) {
    if (rebuild) throw new Error('O WayNoted abriu durante a compilação. Use o menu Visualizar. / WayNoted opened during the build. Use the View menu.')
    checked('/usr/bin/open', ['-a', current.bundle])
    return
  }
  if (current) await waitForSafeClose(current)

  const launchEnv = {
    WORKSPACE_UPDATE_CHECKOUT: result.checkout,
    WORKSPACE_UPDATE_NODE: process.execPath,
    WORKSPACE_UPDATE_NPM: npm,
  }
  for (const key of ['WORKSPACE_SIGN_IDENTITY', 'WORKSPACE_HARDENED_RUNTIME', 'WORKSPACE_USER_DATA']) {
    if (process.env[key]) launchEnv[key] = process.env[key]
  }
  const args = Object.entries(launchEnv).flatMap(([key, value]) => ['--env', key + '=' + value])
  checked('/usr/bin/open', ['-n', result.bundle, ...args])
  let opened
  for (let i = 0; i < 180; i++) {
    opened = runningForProfile()
    if (opened?.bundle === result.bundle) break
    await delay(100)
  }
  if (opened?.bundle === result.bundle) {
    await delay(1500)
    opened = runningForProfile()
  }
  if (opened?.bundle !== result.bundle) throw new Error('A nova instância não confirmou a abertura. / The new instance did not confirm startup.')
  const version = checked('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(result.bundle, 'Contents', 'Info.plist')])
  console.log(`WayNoted ${version} · ${result.commit.slice(0, 8)} · ${result.bundle}`)
}

launch().catch(error => { console.error(error.message); process.exitCode = 1 })
