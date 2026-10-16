import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options })
const apps = [[PRODUCT.executable, PRODUCT.bundleId], [PRODUCT.name, PRODUCT.previousBundles[0]], [COMPAT.previousProfile, COMPAT.previousBundle]]
const running = executable => run('pgrep', ['-f', `Contents/MacOS/${executable}$`]).status === 0
for (const [executable, bundle] of apps) if (running(executable)) run('osascript', ['-e', `tell application id "${bundle}" to quit`])
for (let attempt = 0; attempt < 100 && apps.some(([executable]) => running(executable)); attempt++) await setTimeout(100)
if (apps.some(([executable]) => running(executable))) throw new Error('Close the save warning in the app and try again.')
if (run('npm', ['run', 'dist'], { stdio: 'inherit' }).status !== 0) process.exit(1)
const result = run('open', ['release/Desktop-darwin-arm64/Desktop.app'])
if (result.status !== 0) throw new Error('Could not open the app')
