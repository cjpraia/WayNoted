// Assemble only passing, revision-matched installed builds. Publishing is a separate action.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import PRODUCT from '../shared/product.json' with { type: 'json' }
const root = path.resolve(process.argv[2] || '.artifacts/downloads')
const output = path.resolve(process.argv[3] || '.artifacts/publication')
const metadata = JSON.parse(await fs.readFile('package.json', 'utf8'))
const version = metadata.version
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A public release requires a final semantic version')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
const repo = PRODUCT.repositoryUrl
const run = process.env.GITHUB_RUN_ID
if (!run || !/^\d+$/.test(run)) throw new Error('GITHUB_RUN_ID is required')
const ci = `${repo}/actions/runs/${run}`
const reports = {}, downloads = {}, sums = []
const required = [
  'Installed app launches with native bridge', 'Keyboard creates a page and persists title and body',
  'Native Windows OCR recognizes real image text', 'Bundled CLI works without Node.js on PATH',
  'Installed MCP communicates over stdio and reads real persisted data', 'Real Windows DPAPI device encryption',
  'Version upgrade preserves password vault, page identity and full content',
  'macOS backup restores databases, Unicode, workspace password and protected pages on Windows',
  'Reinstall preserves vault access and notes',
]
await fs.mkdir(output, { recursive: true })
for (const arch of ['x64', 'arm64']) {
  const base = path.join(root, `windows-validation-unsigned-${arch}-${sourceCommit}`)
  const report = JSON.parse(await fs.readFile(path.join(base, '.artifacts', 'package-check', 'win32', 'results.json'), 'utf8'))
  if (report.error || report.platform !== 'win32' || report.arch !== arch || report.sourceCommit !== sourceCommit || required.some(name => !report.checks.some(check => check.name === name))) throw new Error(`Incomplete or mismatched ${arch} package report`)
  const upgrade = report.checks.find(check => check.name === required[6])
  if (upgrade.to !== version || upgrade.from === version) throw new Error('Upgrade did not exercise this release version')
  const name = `${PRODUCT.name}-Setup-${version}-win-${arch}.exe`
  const bytes = await fs.readFile(path.join(base, 'release', name))
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error('Invalid Windows executable')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const publishedSums = await fs.readFile(path.join(base, 'release', 'SHA256SUMS'), 'utf8')
  if (!publishedSums.trim().split(/\r?\n/).includes(`${hash}  ${name}`)) throw new Error(`Checksum mismatch: ${name}`)
  await fs.writeFile(path.join(output, name), bytes)
  sums.push(`${hash}  ${name}`)
  downloads[`win32-${arch}`] = `${repo}/releases/download/v${version}/${name}`
  reports[arch] = { ...report, artifact: name, sha256: hash, publisherSignature: 'unsigned' }
}
const verification = { version, sourceCommit, tree, ci, installedChecks: reports, hardwareCoverage: 'Microphone capture, Windows Hello interaction, and every hardware/display/accessibility configuration are not established by headless CI.' }
await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(verification, null, 2) + '\n')
await fs.writeFile(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n')
await fs.writeFile(path.join(output, 'updates.json'), JSON.stringify({ version, notes: { 'en-US': 'Windows desktop release for x64 and ARM64. Installer upgrades and encrypted macOS backup transfers verified.' }, downloads }, null, 2) + '\n')
await fs.writeFile(path.join(output, 'release-notes.md'), `# ${PRODUCT.name} ${version} for Windows

Installable desktop release for **Windows 11 x64 and ARM64**. Download Setup for your architecture, run it, and open ${PRODUCT.name} from Start. No Node.js, .NET installation, developer tools, or account are needed.

Includes pages and blocks, databases and properties, relations and rollups, queries, tasks, calendar views, daily notes, canvas, files, local API, bundled CLI/MCP, OCR, DPAPI, password vaults, and optional Windows Hello.

## Installation and updates

See the [Windows guide](${repo}/blob/v${version}/docs/WINDOWS.md). Updating with Setup and uninstalling preserve the profile at \`%APPDATA%\\WorkspaceData\`. Updates are manual. Use \`updates.json\` from this release as the optional manual update feed.

**The executables are unsigned.** Windows can show an unknown-publisher/SmartScreen warning; Smart App Control or organization policies may block unsigned applications. Publisher signing is not configured. Verify the source and SHA-256 checksums before installing; do not disable system protection.

## Verification

[Passing build and test workflow](${ci}) for source \`${sourceCommit}\`. Both architectures pass ${reports.x64.checks.length} installed-app checks, including actual installation, UI persistence, clipboard, quick capture, OCR, CLI/MCP without Node.js on PATH, DPAPI, vaults, restart, upgrade from ${reports.x64.checks.find(c => c.name === required[6]).from} to ${version}, uninstall/reinstall, and restoration of an encrypted backup created on macOS with database values and separately protected pages. See \`verification.json\` for the reports.

Microphone capture and Windows Hello interactions depend on hardware and have not been exercised by these automated checks. Offline dictation requires a compatible installed Windows SAPI recognizer; Brazilian Portuguese is not supported by the built-in engine. Audio-file transcription requires a separately configured local model/runtime. Apple-specific services remain macOS-only; the app's own notes, tasks, and calendar views work on Windows.

Use is licensed under PolyForm Noncommercial 1.0.0. Third-party notices and native licenses are bundled; Setup displays the project and Windows SDK license terms. Pull requests are welcome.
`)
console.log('Prepared verified Windows release', version, sourceCommit)
