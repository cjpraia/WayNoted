const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { acknowledgeStartup, prepare, checkTools } = require('../electron/local-update.cjs')

test('only the expected updated executable and profile can confirm startup', () => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'waynoted-update-'))
  try {
    const token = randomUUID()
    const bundle = path.join(directory, 'New.app')
    const profile = path.join(directory, 'profile')
    const executable = path.join(bundle, 'Contents', 'MacOS', 'Desktop')
    fs.writeFileSync(path.join(directory, 'handoff.json'), JSON.stringify({ token, bundle, profile }))
    const env = () => ({ WORKSPACE_UPDATE_RESULT: directory, WORKSPACE_UPDATE_TOKEN: token })
    assert.equal(acknowledgeStartup('other profile', executable, env()), false)
    assert.equal(acknowledgeStartup(profile, path.join(directory, 'Desktop'), env()), false)
    assert.equal(fs.existsSync(path.join(directory, 'ready')), false)
    const once = env()
    assert.equal(acknowledgeStartup(profile, executable, once), true)
    assert.equal(acknowledgeStartup(profile, executable, once), false)
    assert.equal(fs.readFileSync(path.join(directory, 'ready'), 'utf8'), token)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('failed build reports the log and never creates a handoff', async () => {
  const checkout = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'waynoted-update-'))
  try {
    const build = path.join(checkout, 'fail.cjs')
    fs.writeFileSync(build, 'console.error("example build error"); process.exit(3)')
    await assert.rejects(prepare({ checkout, build, node: process.execPath, npm: 'unused' }, true, {}), /update\.log/)
    const [directory] = fs.readdirSync(path.join(checkout, '.artifacts'))
    const run = path.join(checkout, '.artifacts', directory)
    assert.match(fs.readFileSync(path.join(run, 'update.log'), 'utf8'), /example build error/)
    assert.equal(fs.existsSync(path.join(run, 'handoff.json')), false)
  } finally { fs.rmSync(checkout, { recursive: true, force: true }) }
})

test('an unavailable builder is reported before compilation', async () => {
  await assert.rejects(checkTools({ checkout: os.tmpdir(), node: '/missing/waynoted-node', npm: '/missing/waynoted-npm' }), { code: 'UPDATE_TOOLS_MISSING' })
})
