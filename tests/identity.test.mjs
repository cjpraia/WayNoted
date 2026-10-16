import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.mjs'
const root = new URL('..', import.meta.url)
const forbidden = [COMPAT.previousProfile, ...Object.entries(COMPAT).filter(([key]) => key.startsWith('sourceProduct')).map(([, value]) => value)].map(value => value.toLowerCase())
const forbiddenText = new RegExp(`\\b(?:${forbidden.join('|')})\\b`, 'i')
function* walk(directory) {
  directory = directory instanceof URL ? fileURLToPath(directory) : directory
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['gen', 'node_modules', '.git'].includes(entry.name)) continue
    if (path.basename(directory) === 'build' && entry.name === 'native') continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(file)
    else yield file
  }
}
test('source uses neutral identifiers and keeps the public product name in its registry', () => {
  const findings = []
  for (const folder of ['src', 'electron', 'native', 'scripts', 'tests', 'clipper', 'docs', 'build']) {
    for (const file of walk(new URL(folder, root))) {
      if (!/\.(?:[cm]?[jt]sx?|css|html|swift|md|plist)$/.test(file)) continue
      const text = fs.readFileSync(file, 'utf8').toLowerCase()
      if (forbiddenText.test(text) || forbidden.some(value => path.relative(fileURLToPath(root), file).toLowerCase().includes(value))) findings.push(path.relative(fileURLToPath(root), file))
    }
  }
  assert.deepEqual(findings, [])
  assert.equal(JSON.parse(fs.readFileSync(new URL('package.json', root))).productName, PRODUCT.name)
  assert.equal(PRODUCT.executable, 'Desktop')
  assert.equal(PRODUCT.profileDirectory, 'WorkspaceData')
})
