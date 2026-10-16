// Real installed-application checks. Always use a disposable profile, never personal notes.
import { _electron } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
const run = promisify(execFile)
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const installer = option('installer')
const baselineInstaller = option('baseline-installer')
const portableBackup = option('portable-backup')
if (installer && !process.env.CI && !process.argv.includes('--allow-install')) throw new Error('Installer checks replace and uninstall the selected app. Use a disposable Windows environment and pass --allow-install explicitly.')
let appPath = option('app') || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkspaceDesktop', 'Desktop.exe') : path.resolve('release/Desktop-darwin-arm64/Desktop.app/Contents/MacOS/Desktop'))
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-package-'))
const profile = path.join(directory, 'profile with spaces — á')
const artifacts = path.resolve('.artifacts', 'package-check', process.platform)
await fs.mkdir(artifacts, { recursive: true }); await fs.mkdir(path.join(profile, 'data'), { recursive: true })
await fs.writeFile(path.join(profile, 'data', 'meta.json'), JSON.stringify({ pages: {}, settings: { locale: 'en-US', localApiEnabled: true }, notifications: {}, syncedBlocks: {} }))
const result = { platform: process.platform, arch: process.arch, sourceCommit: process.env.GITHUB_SHA || null, checks: [] }
let application
const check = (name, details = {}) => { result.checks.push({ name, ...details }); console.log('PASS:', name) }
const env = { ...process.env, WORKSPACE_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
if (process.platform === 'win32') {
  // The installed app and launcher must work without the runner's Node/.NET tools.
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'path') delete env[name]
  env.PATH = [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';')
}
async function launch() {
  application = await _electron.launch({ executablePath: appPath, env, timeout: 90000 })
  const page = await application.firstWindow({ timeout: 90000 })
  await page.waitForFunction(() => !!window.api?.runtimeInfo, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('.shell-tabs') || document.querySelector('input[type=password]'), undefined, { timeout: 60000 })
  return page
}
async function eventually(fn) {
  const deadline = Date.now() + 20000
  let last
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value } catch (error) { last = error }; await new Promise(resolve => setTimeout(resolve, 200)) }
  throw last || new Error('Timed out waiting for persisted content')
}
async function uninstall() {
  const names = await fs.readdir(path.dirname(appPath))
  const file = names.find(name => /^Uninstall.*\.exe$/i.test(name)); assert.ok(file)
  await run(path.join(path.dirname(appPath), file), ['/S'], { timeout: 180000, windowsHide: true })
}
try {
  if (baselineInstaller && !installer) throw new Error('An upgrade check requires both installers')
  if (installer) { assert.equal(process.platform, 'win32'); await run(path.resolve(baselineInstaller || installer), ['/S'], { timeout: 180000, windowsHide: true }); check('Installer completes as current user') }
  let page = await launch()
  if (baselineInstaller) {
    const startingVersion = await application.evaluate(({ app }) => app.getVersion())
    await page.keyboard.press('Control+n')
    const oldTitle = page.locator('textarea.pg-title')
    await oldTitle.fill('Upgrade preservation check'); await oldTitle.press('End'); await oldTitle.press('Enter')
    const oldEditor = page.locator('[contenteditable="true"]:visible').first()
    await oldEditor.click(); await page.keyboard.type('Content created by the previous installed version.')
    const oldPage = await eventually(async () => Object.values((await page.evaluate(() => window.api.loadMeta())).pages).find(item => item.title === 'Upgrade preservation check'))
    await eventually(async () => JSON.stringify(await page.evaluate(id => window.api.loadDoc(id), oldPage.id)).includes('Content created by the previous installed version.'))
    await page.evaluate(() => window.api.vaultEnable('Upgrade-package-check-42!', { acknowledged: true }))
    await application.close(); application = undefined
    await run(path.resolve(installer), ['/S'], { timeout: 180000, windowsHide: true })
    page = await launch()
    const installedVersion = await application.evaluate(({ app }) => app.getVersion())
    assert.equal(installedVersion, JSON.parse(await fs.readFile('package.json', 'utf8')).version)
    assert.notEqual(installedVersion, startingVersion)
    assert.ok((await page.evaluate(() => window.api.vaultStatus())).locked)
    await page.evaluate(() => window.api.vaultUnlock('Upgrade-package-check-42!')); await page.reload()
    // The preload bridge exists before React mounts its save/close listener.
    // Wait for the unlocked shell before requesting another security operation.
    await page.locator('.shell-tabs').waitFor({ state: 'visible', timeout: 60000 })
    assert.equal((await page.evaluate(() => window.api.loadMeta())).pages[oldPage.id].title, 'Upgrade preservation check')
    assert.ok(JSON.stringify(await page.evaluate(id => window.api.loadDoc(id), oldPage.id)).includes('Content created by the previous installed version.'))
    check('Version upgrade preserves password vault, page identity and full content', { from: startingVersion, to: installedVersion })
    await page.evaluate(() => window.api.vaultDisable('Upgrade-package-check-42!')); await page.reload()
    await page.locator('.shell-tabs').waitFor({ state: 'visible', timeout: 60000 })
  }
  const runtime = await page.evaluate(() => window.api.runtimeInfo())
  assert.equal(runtime.platform, process.platform); check('Installed app launches with native bridge')
  const api = await page.evaluate(() => window.api.localApiInfo())
  assert.ok(api.enabled && api.url.startsWith('http://127.0.0.1:'))
  const client = await page.evaluate(() => window.api.agentCreateClient({ name: 'Disposable package check', scopes: ['read', 'write'], autoWrite: true }))
  const headers = { Authorization: 'Bearer ' + client.token, 'Content-Type': 'application/json' }
  const request = async (route, method = 'GET', body, extra = {}) => {
    const response = await fetch(api.url.replace(/\/v1\/pages$/, '') + route, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${await (response.ok ? Promise.resolve('') : response.text())}`)
    return response.json()
  }
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n')
  const title = page.locator('textarea.pg-title'); await title.waitFor({ state: 'visible', timeout: 30000 })
  await title.fill('Windows package persistence check'); await page.locator('.bn-editor').first().waitFor({ state: 'attached', timeout: 30000 }); await title.press('End'); await title.press('Enter')
  const editor = page.locator('[contenteditable="true"]:visible').first(); await editor.click(); await page.keyboard.type('Persistent content from the installed Windows application.')
  const created = await eventually(async () => (await request('/v1/pages')).results.find(item => item.title === 'Windows package persistence check'))
  await eventually(async () => JSON.stringify(await request(`/v1/pages/${created.id}/blocks`)).includes('Persistent content from the installed Windows application.'))
  check('Keyboard creates a page and persists title and body')
  await page.evaluate(() => window.api.copyText('Windows clipboard check'))
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'Windows clipboard check'); check('System clipboard')
  await page.screenshot({ path: path.join(artifacts, 'editor.png') })
  if (process.platform === 'win32') {
    await page.evaluate(() => window.api.showQuickCapture())
    const quick = await eventually(async () => (await application.windows()).find(item => item.url().includes('quick.html')))
    await quick.locator('.qn-title').fill('Quick capture installed check')
    await quick.locator('.qn-body').fill('Saved from the native floating window.')
    await quick.locator('.qn-body').press('Control+Enter')
    const captured = await eventually(async () => (await request('/v1/pages')).results.find(item => item.title === 'Quick capture installed check'))
    assert.ok(JSON.stringify(await request(`/v1/pages/${captured.id}/blocks`)).includes('Saved from the native floating window.'))
    check('Native quick capture saves through Ctrl+Enter')
    const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 150; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 150); ctx.fillStyle = 'black'; ctx.font = '48px Segoe UI'; ctx.fillText('WINDOWS OCR CHECK 12345', 20, 90); return canvas.toDataURL('image/png') })
    const ocr = await page.evaluate(data => window.api.ocrImage(data), image)
    assert.ok(ocr.ok && /WINDOWS OCR CHECK/.test(ocr.text), JSON.stringify(ocr)); check('Native Windows OCR recognizes real image text')
    const dictation = await page.evaluate(() => window.api.dictationStatus('en-US'))
    check('Offline speech capability queried', { recognizerAvailable: !!dictation.recognizer, audioCaptureTested: false })
    const cli = path.join(path.dirname(appPath), 'resources', 'bin', 'workspace.exe')
    const { stdout } = await run(cli, ['whoami', '--json'], { env: { ...env, WORKSPACE_API_URL: api.url, WORKSPACE_API_TOKEN: client.token }, windowsHide: true, timeout: 20000 })
    assert.ok(JSON.parse(stdout)); check('Bundled CLI works without Node.js on PATH')
    const child = spawn(cli, ['mcp'], { env: { ...env, WORKSPACE_API_URL: api.url, WORKSPACE_API_TOKEN: client.token }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const pending = new Map(); let sequence = 0
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => { try { const value = JSON.parse(line); if (pending.has(value.id)) { pending.get(value.id)(value); pending.delete(value.id) } } catch {} })
    const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => reject(new Error('MCP request timed out: ' + method)), 20000); pending.set(id, value => { clearTimeout(timer); value.error ? reject(new Error(value.error.message)) : resolve(value.result) }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
    try {
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Package check', version: '1' } })
      const tools = await rpc('tools/list', {}); assert.ok(tools.tools.some(tool => tool.name === 'update_row_properties'))
      const search = await rpc('tools/call', { name: 'search_pages', arguments: { query: 'Windows package persistence check' } })
      assert.ok(!search.isError && JSON.stringify(search).includes('Windows package persistence check')); check('Installed MCP communicates over stdio and reads real persisted data')
    } finally { lines.close(); child.stdin.end(); child.kill() }

    const device = await page.evaluate(() => window.api.deviceCipherSet(true)); assert.equal(device.mode, 'keychain'); check('Real Windows DPAPI device encryption')
  }
  const vault = await page.evaluate(() => window.api.vaultEnable('Disposable-package-check-42!', { acknowledged: true }))
  assert.ok(vault.recoveryKey); check('Password vault encrypts disposable workspace')
  await page.evaluate(() => window.api.vaultLock()).catch(() => {})
  await page.locator('input[type=password]').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.evaluate(() => window.api.vaultUnlock('Disposable-package-check-42!'))
  await page.reload(); await page.locator('.shell-tabs').waitFor({ state: 'visible', timeout: 60000 })
  check('Vault lock and password unlock')
  await application.close(); application = undefined
  page = await launch()
  const status = await page.evaluate(() => window.api.vaultStatus())
  assert.ok(status.enabled && status.locked)
  await page.evaluate(() => window.api.vaultUnlock('Disposable-package-check-42!'))
  await page.reload()
  await eventually(async () => (await page.locator('body').innerText()).includes('Windows package persistence check'))
  check('Encrypted data survives an application restart')
  await application.close(); application = undefined
  if (installer && process.platform === 'win32') {
    const standardProfile = path.join(process.env.APPDATA, 'WorkspaceData'); await fs.mkdir(standardProfile, { recursive: true })
    const sentinel = path.join(standardProfile, 'package-check-' + Date.now() + '.txt'); await fs.writeFile(sentinel, 'Preserve user data')
    try {
      const names = await fs.readdir(path.dirname(appPath)); const uninstaller = names.find(name => /^Uninstall.*\.exe$/i.test(name)); assert.ok(uninstaller)
      await run(path.join(path.dirname(appPath), uninstaller), ['/S'], { timeout: 180000, windowsHide: true })
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'Preserve user data'); check('Uninstall preserves the standard profile')
      await run(path.resolve(installer), ['/S'], { timeout: 180000, windowsHide: true })
      page = await launch(); await page.evaluate(() => window.api.vaultUnlock('Disposable-package-check-42!')); await page.reload()
      await eventually(async () => (await page.locator('body').innerText()).includes('Windows package persistence check')); check('Reinstall preserves vault access and notes')
      await application.close(); application = undefined
    } finally { await fs.rm(sentinel, { force: true }) }
    const standardApp = appPath
    await uninstall()
    const customDirectory = path.join(directory, 'custom installation — café')
    // NSIS requires /D to be last and unquoted, including paths with spaces.
    await run(path.resolve(installer), ['/S', '/D=' + customDirectory], { timeout: 180000, windowsHide: true, windowsVerbatimArguments: true })
    appPath = path.join(customDirectory, 'Desktop.exe')
    await fs.access(appPath)
    await run(path.resolve(installer), ['/S'], { timeout: 180000, windowsHide: true })
    await fs.access(appPath)
    await assert.rejects(fs.access(standardApp), { code: 'ENOENT' })
    page = await launch()
    await page.evaluate(() => window.api.vaultUnlock('Disposable-package-check-42!')); await page.reload()
    await page.locator('.shell-tabs').waitFor({ state: 'visible', timeout: 60000 })
    assert.equal((await page.evaluate(() => window.api.loadMeta())).pages[created.id].title, 'Windows package persistence check')
    const currentApi = await page.evaluate(() => window.api.localApiInfo())
    const cli = path.join(customDirectory, 'resources', 'bin', 'workspace.exe')
    const response = await run(cli, ['whoami', '--json'], { env: { ...env, WORKSPACE_API_URL: currentApi.url, WORKSPACE_API_TOKEN: client.token }, windowsHide: true, timeout: 20000 })
    assert.ok(JSON.parse(response.stdout))
    check('Custom installation path with spaces and Unicode survives reinstall')
    await application.close(); application = undefined
    // Keep testing the installed custom path. An uninstaller may launch its
    // cleanup process asynchronously; immediately reinstalling elsewhere races
    // the previous InstallLocation registry cleanup.
  }
  if (portableBackup) {
    const fixture = JSON.parse(await fs.readFile(path.join(portableBackup, 'fixture.json'), 'utf8'))
    if (process.platform === 'win32') assert.equal(fixture.platform, 'darwin', 'The transfer fixture must actually originate on macOS')
    env.WORKSPACE_USER_DATA = path.join(directory, 'transferred profile — á')
    page = await launch()
    await page.evaluate(directory => window.api.backupSettingsSet({ directory, enabled: false }), path.resolve(portableBackup))
    const restored = await page.evaluate(id => window.api.backupRestore(id), fixture.id)
    assert.ok(restored.restored > 0)
    await page.reload()
    await page.locator('input[type=password]').first().waitFor({ state: 'visible', timeout: 30000 })
    await page.evaluate(password => window.api.vaultUnlock(password), fixture.password)
    await page.reload()
    await page.locator('.shell-tabs').waitFor({ state: 'visible', timeout: 60000 })
    const meta = await page.evaluate(() => window.api.loadMeta())
    assert.equal(meta.pages[fixture.ids.row].title, 'Transferred row — café')
    assert.equal(meta.pages[fixture.ids.row].props.city, 'São Paulo')
    assert.ok(meta.pages[fixture.ids.database].database.properties.some(item => item.id === 'city'))
    assert.ok(JSON.stringify(await page.evaluate(id => window.api.loadDoc(id), fixture.ids.row)).includes('Cross-platform row content'))
    await page.evaluate(({ id, password }) => window.api.pageUnlock(id, password), { id: fixture.ids.protected, password: fixture.pagePassword })
    assert.ok(JSON.stringify(await page.evaluate(id => window.api.loadDoc(id), fixture.ids.protected)).includes('Protected content survives operating system transfer.'))
    check('macOS backup restores databases, Unicode, workspace password and protected pages on Windows', { sourcePlatform: fixture.platform })
    await application.close(); application = undefined
  }
  if (installer && process.platform === 'win32') await uninstall()
} catch (error) { result.error = error.stack; if (application) { const pages = await application.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(artifacts, 'failure.html'), await pages[0].content()).catch(() => {}) } }; throw error }
finally { if (application) await application.close().catch(() => {}); await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(result, null, 2)); await fs.rm(directory, { recursive: true, force: true }).catch(() => {}) }
