// Compila o helper nativo (EventKit + Speech) com swiftc e assina com a identidade de WORKSPACE_SIGN_IDENTITY (padrão: ad-hoc).
// Saída: build/native/workspace-native — embutido no .app em Contents/Resources pelo `--extra-resource` do script `dist`.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADHOC_WARNING, helperSignArgs, isAdhoc, signingIdentity } from './signing.mjs'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['main.swift', 'Calendar.swift', 'Reminders.swift', 'Dictation.swift', 'Embedding.swift'].map(file => path.join(root, 'native', file))
const plist = path.join(root, 'native', 'Info.plist')
const output = path.join(root, 'build', 'native', "workspace-native")
const arch = process.env.WORKSPACE_NATIVE_ARCH || (process.arch === 'x64' ? 'x86_64' : 'arm64')
const force = process.argv.includes('--force')

if (process.platform === 'win32') {
  await import('./build-windows-native.mjs')
  process.exit(0)
}

if (process.platform !== 'darwin') {
  console.log('[native] macOS only; skipping helper build.')
  process.exit(0)
}

// Generated from the same registry as the desktop app; no brand-dependent paths.
const identitySource = path.join(root, 'build', 'native', 'ProductIdentity.swift')
const schemes = [PRODUCT.protocol, COMPAT.previousProtocol, ...(PRODUCT.protocolAliases ?? [])]
const identityText = `import Foundation\nfunc isWorkspaceLink(_ value: String) -> Bool {\n  guard let url = URL(string: value), let scheme = url.scheme, url.user == nil, url.password == nil, url.port == nil else { return false }\n  return ${JSON.stringify(schemes)}.contains(scheme)\n}\n`
fs.mkdirSync(path.dirname(identitySource), { recursive: true })
if (!fs.existsSync(identitySource) || fs.readFileSync(identitySource, 'utf8') !== identityText) fs.writeFileSync(identitySource, identityText)
sources.push(identitySource)

const newest = Math.max(...[...sources, plist, fileURLToPath(import.meta.url)].map(file => fs.statSync(file).mtimeMs))
if (!force && fs.existsSync(output) && fs.statSync(output).mtimeMs > newest) {
  console.log(`[native] ${path.relative(root, output)} is up to date.`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(output), { recursive: true })
const args = [
  '-O', '-swift-version', '5', '-target', `${arch}-apple-macos12.0`,
  ...sources, '-o', output,
  '-framework', 'EventKit', '-framework', 'Speech', '-framework', 'AVFoundation', '-framework', 'CoreGraphics', '-framework', 'NaturalLanguage',
  // Info.plist embutido: identificador e textos de permissão também valem para o executável isolado.
  '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist,
]
console.log(`[native] swiftc (${arch}) → ${path.relative(root, output)}`)
execFileSync('xcrun', ['swiftc', ...args], { stdio: 'inherit' })
// Mesma identidade do .app (WORKSPACE_SIGN_IDENTITY); o sign-app.mjs reassina e confere depois do empacotamento.
const identity = signingIdentity()
if (isAdhoc(identity)) console.warn(ADHOC_WARNING)
execFileSync('codesign', helperSignArgs(identity, output), { stdio: 'inherit' })
console.log('[native] done.')
