import PRODUCT from '../shared/product.json' with { type: 'json' }
// Pós-empacotamento: confere o helper nativo e as strings de permissão no Info.plist final e assina o .app.
// Identidade: WORKSPACE_SIGN_IDENTITY (padrão "-" = ad-hoc). Com uma identidade estável (build/make-signing-identity.sh)
// o macOS reconhece o app entre builds e não repete os pedidos de permissão. Veja docs/DISTRIBUTION.md.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADHOC_WARNING, appSignArgs, checkSignature, helperSignArgs, isAdhoc, parseCodesignInfo, parseDesignatedRequirement, signingIdentity } from './signing.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = path.resolve(root, process.argv[2] || 'release/Desktop-darwin-arm64/Desktop.app')
const helper = path.join(app, 'Contents', 'Resources', "workspace-native")
const infoPlist = path.join(app, 'Contents', 'Info.plist')
const REQUIRED_KEYS = ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription', 'NSRemindersFullAccessUsageDescription', 'NSRemindersUsageDescription']

if (process.platform !== 'darwin') { console.log('[sign] macOS only; skipping.'); process.exit(0) }
if (!fs.existsSync(app)) throw new Error(`[sign] app not found: ${app}`)
if (!fs.existsSync(helper)) throw new Error("[sign] Contents/Resources/workspace-native is missing; run npm run build:native before packaging.")

// A2: CLI e MCP embarcados (Resources/bin/workspace roda o Electron como Node) e o núcleo gerado por `npm run build:agent`.
const cliBin = path.join(app, 'Contents', 'Resources', 'bin', "workspace")
if (!fs.existsSync(cliBin)) throw new Error("[sign] Contents/Resources/bin/workspace is missing; check --extra-resource=build/bin in the dist script.")
const appDir = path.join(app, 'Contents', 'Resources', 'app'), asarFile = path.join(app, 'Contents', 'Resources', 'app.asar')
const archiveEntries = fs.existsSync(asarFile)
  ? execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs'), 'list', asarFile], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')
  : []
const includesFile = file => fs.existsSync(path.join(appDir, file)) || archiveEntries.includes('/' + file)
const inApp = includesFile('electron/gen/agent-runtime.mjs')
if (!inApp) throw new Error('[sign] electron/gen/agent-runtime.mjs is missing from the app; run npm run build:agent before packaging.')
for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
  if (!includesFile(file)) throw new Error(`[sign] Required distribution notice is missing from the app: ${file}`)
}
fs.chmodSync(cliBin, 0o755)

const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlist], { encoding: 'utf8' }))
for (const suffix of ['', ' (Renderer)', ' (GPU)', ' (Plugin)']) {
  const name = 'Electron Helper' + suffix
  const electronHelper = path.join(app, 'Contents', 'Frameworks', name + '.app', 'Contents', 'MacOS', name)
  if (!fs.existsSync(electronHelper)) throw new Error(`[sign] Neutral Electron Helper executable is missing: ${name}`)
}
const missing = REQUIRED_KEYS.filter(key => typeof info[key] !== 'string' || !info[key])
if (missing.length) throw new Error(`[sign] Info.plist is missing: ${missing.join(', ')}`)

const identity = signingIdentity()
const options = { hardened: process.env.WORKSPACE_HARDENED_RUNTIME === '1', entitlements: path.join(root, 'build', 'entitlements.plist') }
if (isAdhoc(identity)) console.warn(ADHOC_WARNING)
else console.log(`[sign] identidade: ${identity}`)

execFileSync('codesign', helperSignArgs(identity, helper, options), { stdio: 'inherit' })
execFileSync('codesign', appSignArgs(identity, app, options), { stdio: 'inherit' })
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })

// Confere o resultado: mesma identidade no app e no helper e requirement que não depende do cdhash.
// `codesign -dv` escreve em stderr; `-d -r-` escreve em stdout: juntamos os dois.
function codesignText(args, target) {
  const result = spawnSync('codesign', [...args, target], { encoding: 'utf8' })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}
const problems = checkSignature({
  identity,
  app: parseCodesignInfo(codesignText(['-dv', '--verbose=2'], app)),
  helper: parseCodesignInfo(codesignText(['-dv', '--verbose=2'], helper)),
  appRequirement: parseDesignatedRequirement(codesignText(['-d', '-r-'], app)),
  helperRequirement: parseDesignatedRequirement(codesignText(['-d', '-r-'], helper)),
})
if (problems.length) throw new Error(`[sign] verificação da assinatura falhou:\n- ${problems.join('\n- ')}`)
console.log(`[sign] signed ${path.relative(root, app)} (${info.CFBundleIdentifier}) with ${isAdhoc(identity) ? 'ad-hoc signature' : `"${identity}"`}`)

// Fumaça da CLI empacotada: `workspace help` precisa rodar com o Electron embutido.
const cliHelp = spawnSync(cliBin, ['help'], { encoding: 'utf8', timeout: 20000 })
if (cliHelp.status !== 0 || !(cliHelp.stdout ?? '').includes(PRODUCT.name + ' CLI')) throw new Error(`[sign] a CLI empacotada não respondeu a "help" (status ${cliHelp.status}): ${cliHelp.stderr ?? ''}`)
console.log("[sign] CLI embarcada ok: Contents/Resources/bin/workspace")
