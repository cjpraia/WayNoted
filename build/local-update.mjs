// The launch context points to a local checkout. Build only a private copy of its app sources.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { captureSourceBuild } from './source-build-info.mjs'
import PRODUCT from '../shared/product.json' with { type: 'json' }

const [checkout, runDirectory, npm, testFlag] = process.argv.slice(2)
const snapshot = path.join(runDirectory, 'source')
const inputs = ['src', 'electron', 'shared', 'clipper', 'native', 'build', 'index.html', 'quick.html',
  '.gitignore', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md']
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: checkout, encoding: 'utf8' })
const files = new Set(git('ls-files', '-co', '--exclude-standard', '-z', '--', ...inputs).split('\0').filter(Boolean))
const sourceBefore = captureSourceBuild(checkout)
if (!sourceBefore) throw new Error('Could not identify the local source.')
fs.mkdirSync(snapshot, { mode: 0o700 })
for (const relative of files) {
  if (relative.startsWith('build/native/') || relative.startsWith('electron/gen/')) continue
  const file = path.join(checkout, relative)
  const stat = fs.lstatSync(file, { throwIfNoEntry: false })
  if (!stat) continue // A tracked deletion is part of the local update.
  if (!stat.isFile() || file !== fs.realpathSync(file)) throw new Error('Source contains a non-regular file: ' + relative)
  const target = path.join(snapshot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(file, target)
  fs.chmodSync(target, stat.mode & 0o777)
  fs.utimesSync(target, stat.atime, stat.mtime)
}
const gitDir = git('rev-parse', '--absolute-git-dir').trim()
const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: snapshot, GIT_OPTIONAL_LOCKS: '0' }
const sourceAfter = captureSourceBuild(checkout)
if (sourceAfter?.fingerprint !== sourceBefore.fingerprint) throw new Error('Local code changed while preparing the build. Try again.')
fs.symlinkSync(fs.realpathSync(path.join(checkout, 'node_modules')), path.join(snapshot, 'node_modules'), 'dir')
const run = testFlag === '--test' ? 'dist:test' : 'dist'
execFileSync(process.execPath, [npm, 'run', run], { cwd: snapshot, env, stdio: 'inherit' })
const bundle = path.join(snapshot, testFlag === '--test' ? 'release-test' : 'release', 'Desktop-darwin-arm64', PRODUCT.executable + '.app')
const signature = target => execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], { stdio: 'inherit' })
signature(bundle)
const readPlist = (target, key) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(target, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
if (readPlist(bundle, 'CFBundleIdentifier') !== PRODUCT.bundleId + (testFlag === '--test' ? '.test' : '')) throw new Error('Incorrect bundle identity.')
fs.writeFileSync(path.join(runDirectory, 'bundle'), bundle, { flag: 'wx', mode: 0o600 })
