import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { windowsConfig } from '../build/windows-config.mjs'
const require = createRequire(import.meta.url)
const { appDataRoot, windowChrome, quickChrome, capabilities } = require('../electron/platform.cjs')
const { connectorSnippets, cliBinPath } = require('../electron/agent-connector.cjs')
const { openPrivacyPane } = require('../electron/native-helper.cjs')
const { createBiometric } = require('../electron/biometric.cjs')
const { userPath } = require('../electron/windows-cli.cjs')
const { createOcr } = require('../electron/ocr.cjs')

test('Windows paths and windows use platform conventions and stable generic identities', () => {
  assert.equal(appDataRoot({ platform: 'win32', env: { APPDATA: 'D:\\Profile\\Roaming' }, home: 'C:\\Users\\A B' }), 'D:\\Profile\\Roaming')
  assert.equal(appDataRoot({ platform: 'win32', env: {}, home: 'C:\\Users\\A B' }), 'C:\\Users\\A B\\AppData\\Roaming')
  assert.equal(appDataRoot({ platform: 'darwin', env: {}, home: '/Users/A' }), '/Users/A/Library/Application Support')
  assert.equal(windowChrome('win32').titleBarStyle, 'default')
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset')
  assert.equal(quickChrome('win32').transparent, false)
  assert.equal(capabilities('win32').nativeEmbeddings, false)
  assert.equal(capabilities('win32').ocr, true)
  assert.equal(cliBinPath({ packaged: true, resourcesPath: 'C:\\Program Files\\Workspace\\resources', platform: 'win32' }), 'C:\\Program Files\\Workspace\\resources\\bin\\workspace.exe')
})

test('Windows package preserves profiles and does not auto-publish or require elevation', () => {
  const config = windowsConfig({ arch: 'x64', signed: true })
  assert.equal(config.executableName, 'Desktop')
  assert.equal(config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(config.nsis.perMachine, false)
  assert.equal(config.nsis.allowElevation, false)
  assert.equal(config.win.forceCodeSigning, true)
  assert.equal(config.publish, null)
  assert.throws(() => windowsConfig({ arch: 'ia32' }), /Unsupported/)
})

test('Windows privacy links use a closed OS-specific allowlist', async () => {
  let url
  await openPrivacyPane('microphone', value => { url = value }, undefined, 'win32')
  assert.equal(url, 'ms-settings:privacy-microphone')
  assert.throws(() => openPrivacyPane('microphone', () => {}, ['speech'], 'win32'), /inválido/)
  assert.throws(() => openPrivacyPane('ms-settings:evil', () => {}, undefined, 'win32'), /inválido/)
})

test('MCP snippets preserve executable paths and PowerShell quoting without shell wrapping', () => {
  const command = "C:\\Users\\O'Brien\\resources\\bin\\workspace.exe"
  const snippets = connectorSnippets({ command, token: "token'example", platform: 'win32' })
  const server = JSON.parse(snippets.json).mcpServers.workspace
  assert.equal(server.command, command)
  assert.deepEqual(server.args, ['mcp'])
  assert.ok(snippets.claudeCode.includes("O''Brien"))
  assert.equal(server.env.WORKSPACE_API_TOKEN, "token'example")
})

test('CLI installation only changes the user PATH and safely passes paths with quotes', async () => {
  let script
  const run = async (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.ok(options.windowsHide)
    script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
    return { stdout: '{"installed":true}' }
  }
  const state = await userPath("C:\\Users\\O'Brien\\resources\\bin\\workspace.exe", 'install', run)
  assert.equal(state.state, 'linked'); assert.equal(state.restartTerminal, true)
  assert.ok(script.includes("O''Brien")); assert.ok(script.includes('CurrentUser'))
  assert.ok(!script.includes('LocalMachine'))
  await assert.rejects(userPath('C:\\bad;value\\workspace.exe', 'install', run), /INVALID_PATH/)
})

test('Windows Hello never treats mere device availability as successful user verification', async () => {
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(12345n)
  let input
  const biometric = createBiometric({ platform: 'win32', available: () => ({ available: true }), run: async (args, value) => { input = value; return args[1] === 'status' ? { available: true } : { verified: false } } })
  assert.equal(await biometric.available(), true)
  await assert.rejects(biometric.verify({ getNativeWindowHandle: () => handle }, 'Unlock'), /BIOMETRIC_REJECTED/)
  assert.deepEqual(input, { window: 12345, message: 'Unlock' })
})

test('Windows OCR uses the native helper on a temporary file and cleans it after recognition', async () => {
  let file
  const image = 'data:image/png;base64,iVBORw0KGgo='
  const ocr = createOcr({ platform: 'win32', nativeRun: async (args, input) => { file = input.file; assert.deepEqual(args, ['ocr']); assert.ok((await fs.stat(file)).isFile()); return { text: 'Recognized text\n' } } })
  assert.deepEqual(await ocr.recognize(image), { ok: true, text: 'Recognized text' })
  await assert.rejects(fs.stat(file), { code: 'ENOENT' })
})
