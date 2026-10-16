const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { legacyEnv, userDataPath } = require('../electron/brand.cjs')
const { parseDeepLink } = require('../electron/deep-links.cjs')

test('rebranding reuses the full existing profile and does not select a new empty profile', () => {
  const parent = '/tmp/appdata'
  assert.equal(userDataPath(parent, p => p === path.join(parent, COMPAT.record002)), path.join(parent, COMPAT.record002))
  assert.equal(userDataPath(parent, () => false), path.join(parent, PRODUCT.profileDirectory))
  assert.equal(userDataPath(parent, () => true), path.join(parent, PRODUCT.profileDirectory))
})
test('old MCP and launcher environment names still work, with explicit new names winning', () => {
  const env = legacyEnv({ [COMPAT.record003]: 'old-fixture', [COMPAT.record004]: '/tmp/legacy', WORKSPACE_API_TOKEN: 'current-fixture' })
  assert.equal(env.WORKSPACE_API_TOKEN, 'current-fixture')
  assert.equal(env.WORKSPACE_USER_DATA, '/tmp/legacy')
  for (const prefix of PRODUCT.previousEnvironmentPrefixes) assert.equal(legacyEnv({ [prefix + 'API_URL']: 'http://127.0.0.1:1234' }).WORKSPACE_API_URL, 'http://127.0.0.1:1234')
})
test('old and new page and daily links route identically without losing block targets', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  for (const route of [`page/${id}#block=old-block`, 'home', 'daily/2026-10-15', 'tasks', `type/${id}`]) {
    assert.deepEqual(parseDeepLink(`workspace://${route}`), parseDeepLink(`${COMPAT.record005}//${route}`))
    assert.ok(parseDeepLink(`workspace://${route}`))
    for (const scheme of PRODUCT.protocolAliases) assert.deepEqual(parseDeepLink(`${scheme}://${route}`), parseDeepLink(`workspace://${route}`))
  }
  assert.equal(parseDeepLink(COMPAT.record006), null)
  assert.equal(parseDeepLink("workspace://user@home"), null)
})

test('profile migration moves files atomically to a neutral folder and keeps the encryption identity', () => {
  const fs = require('node:fs'), os = require('node:os')
  const { resolveProfile } = require('../electron/brand.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-move-'))
  try {
    const previous = path.join(root, COMPAT.previousProfile)
    fs.mkdirSync(previous)
    fs.writeFileSync(path.join(previous, 'existing-data'), 'preserved')
    const profile = resolveProfile(root)
    assert.equal(path.basename(profile.directory), PRODUCT.profileDirectory)
    assert.equal(profile.keychainName, COMPAT.previousProfile)
    assert.equal(fs.readFileSync(path.join(profile.directory, 'existing-data'), 'utf8'), 'preserved')
    assert.equal(fs.existsSync(previous), false)
    assert.deepEqual(resolveProfile(root), profile)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('new and custom profiles persist a neutral keychain identity independent of the public name', () => {
  const fs = require('node:fs'), os = require('node:os')
  const { resolveProfile } = require('../electron/brand.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-identity-'))
  try {
    for (const custom of [undefined, path.join(root, 'custom-profile')]) {
      const profile = resolveProfile(root, custom)
      assert.equal(profile.keychainName, PRODUCT.keychainIdentity)
      assert.notEqual(profile.keychainName, PRODUCT.name)
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile.directory, 'profile-identity.json'), 'utf8')).keychainName, PRODUCT.keychainIdentity)
      assert.deepEqual(resolveProfile(root, custom), profile)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
