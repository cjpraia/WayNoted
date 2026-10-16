const COMPAT = require('../shared/compatibility.cjs')
// Sem Keychain por padrão (docs/SECURITY.md): espaço novo, espaço antigo cifrado com a chave do
// dispositivo (migração atômica, interrupções, negação do Keychain) e espaço com senha do espaço.
// Nenhum teste toca o Keychain real: `safeStorage` é sempre um espião/simulação em memória.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const secure = require('../electron/secure-storage.cjs')
const { setStorageCodec, readJson, atomicWrite, drain } = require('../electron/storage.cjs')
const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
const vault = require('../electron/vault.cjs')
const vaultWorkspace = require('../electron/vault-workspace.cjs')
const migration = require('../electron/vault-migration.cjs')
const pageLocks = require('../electron/vault-pages.cjs')
const { isEncrypted, seal, MAGIC } = require('../electron/encryption.cjs')
const { createKeyStore } = require('../electron/ai/keys.cjs')
const { createKeychain } = require('../electron/keychain.cjs')

const KDF = { N: 2 ** 14, r: 8, p: 1 }
const SECRET = 'SEGREDO-SEM-CHAVEIRO-9Z'
const WS2 = '44444444-4444-4444-8444-444444444444'
const P1 = '11111111-1111-4111-8111-111111111111'

function spy({ deny = false } = {}) {
  const calls = []
  return {
    calls,
    isEncryptionAvailable() { calls.push('isEncryptionAvailable'); return true },
    encryptString(text) { calls.push('encryptString'); return Buffer.from(`kc:${text}`) },
    decryptString(bytes) { calls.push('decryptString'); if (deny) throw new Error('denied by user'); return bytes.toString().replace('kc:', '') },
  }
}
function page(id, title) { return { id, parentId: null, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: `${title} ${SECRET}`, bodyText: SECRET } }
const blocks = text => [{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]
async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), "workspace-kcfree-")) }
async function teardown(root) { await drainWorkspaces(); await drain(); setStorageCodec(null); vault.setDeviceKey(null); for (const dir of [...vault.unlockedDirs()]) vault.lock(dir); await fs.rm(root, { recursive: true, force: true }) }
async function populate(root) {
  const dirs = [path.join(root, 'data'), path.join(root, 'workspaces', WS2, 'data')]
  for (const [index, dir] of dirs.entries()) {
    const store = createWorkspaceStorage(dir)
    await store.saveMeta({ pages: { [P1]: page(P1, `Diário ${index}`) }, settings: { locale: 'pt-BR', historyLimit: 0 }, notifications: {}, syncedBlocks: {} })
    await store.saveDoc(P1, blocks(`primeira ${SECRET} ${index}`)); await store.saveDoc(P1, blocks(`segunda ${SECRET} ${index}`))
    await atomicWrite(path.join(dir, 'backups', '1700000000000.json'), JSON.stringify({ note: SECRET }))
    await atomicWrite(path.join(dir, 'attachments', 'a.bin'), Buffer.from(`binário ${SECRET}`))
  }
  await atomicWrite(path.join(root, 'workspaces.json'), JSON.stringify([{ id: WS2, name: 'Segundo', createdAt: 1 }]))
  await atomicWrite(path.join(root, 'quick-capture.json'), JSON.stringify({ shortcut: 'Alt+N' }))
  await drainWorkspaces(); await drain()
  return dirs
}
async function walkAll(root, rel = '') {
  const out = []
  for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const next = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...await walkAll(root, next)); else if (entry.isFile() && !entry.name.endsWith('.tmp')) out.push(next)
  }
  return out
}
async function snapshot(root) { const out = {}; for (const rel of await walkAll(root)) out[rel] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, rel))).digest('hex'); return out }
async function logical(root, dirs) { const out = []; for (const dir of dirs) { const s = createWorkspaceStorage(dir); out.push(JSON.parse(JSON.stringify({ ...(await s.backup()), exportedAt: 0 }))) } return out }
const isBackupPath = rel => rel.includes('.pre-keychain-migration')
async function assertNoDeviceCipher(root) {
  for (const rel of await walkAll(root)) if (!isBackupPath(rel) && rel !== 'storage-key.keychain') assert.equal((await fs.readFile(path.join(root, rel))).subarray(0, 8).toString() === 'NPENC01\n', false, `${rel} still uses the device cipher`)
}
/** Spaço no formato antigo: chave no "Keychain" simulado, arquivos NPENC01, sem arquivo de modo. */
async function legacyRoot(fake) {
  const root = await tmp()
  await secure.initializeSecureStorage(root, fake, { deviceCipher: 'keychain' })
  const dirs = await populate(root), before = await logical(root, dirs)
  await drainWorkspaces(); await drain(); setStorageCodec(null); vault.setDeviceKey(null)
  await fs.rm(path.join(root, secure.MODE_FILE))
  return { root, dirs, before }
}

test('(a) new space: no safeStorage call at startup nor in normal use; plain 0600 files', async () => {
  const root = await tmp(), fake = spy()
  try {
    const status = await secure.initializeSecureStorage(root, fake)
    assert.equal(status.deviceCipher, 'none'); assert.equal(status.keyProtection, 'none')
    const dirs = await populate(root)
    const store = createWorkspaceStorage(dirs[0])
    assert.equal((await store.loadDoc(P1))[0].content[0].text, `segunda ${SECRET} 0`)
    assert.equal((await store.loadMeta()).pages[P1].title, 'Diário 0')
    assert.equal((await createWorkspaceStorage(dirs[0]).search?.('x'))?.length ?? 0, 0)
    const keys = createKeyStore({ safeStorage: fake })
    assert.equal((await keys.status(dirs[0])).openrouter.configured, false)
    await keys.set(dirs[0], 'openrouter', 'sk-or-sessao-12345', { storage: 'session' })
    assert.equal(await keys.get(dirs[0], 'openrouter'), 'sk-or-sessao-12345')
    assert.deepEqual(fake.calls, [], 'safeStorage must not be touched')
    assert.equal(await fs.access(path.join(root, secure.KEY_FILE)).then(() => true, () => false), false)
    const meta = await fs.readFile(path.join(dirs[0], 'meta.json'))
    assert.equal(isEncrypted(meta), false); JSON.parse(meta.toString('utf8'))
    assert.equal((await fs.stat(path.join(dirs[0], 'meta.json'))).mode & 0o777, 0o600)
    assert.equal((await fs.stat(dirs[0])).mode & 0o777, 0o700)
    assert.equal((await fs.stat(root)).mode & 0o777, 0o700)
    // second launch: still nothing
    setStorageCodec(null); await secure.initializeSecureStorage(root, fake)
    assert.deepEqual(fake.calls, [])
  } finally { await teardown(root) }
})

test('(a) instrumented wrapper: nothing is recorded when the app only opens and saves', async () => {
  const root = await tmp(), trace = path.join(root, 'trace.log')
  try {
    const real = spy()
    const kc = createKeychain({ real, testHooks: true, env: { WORKSPACE_TEST_TRACE_SAFESTORAGE: '1', WORKSPACE_TEST_TRACE_FILE: trace } })
    await secure.initializeSecureStorage(root, kc)
    await populate(root)
    assert.equal(kc.callCount, 0); assert.deepEqual(real.calls, [])
    assert.equal(await fs.access(trace).then(() => true, () => false), false)
    await secure.setDeviceCipher(root, kc, true)
    assert.ok(kc.callCount > 0 && (await fs.readFile(trace, 'utf8')).includes('safeStorage.'), 'opt-in uses and traces the Keychain')
  } finally { await teardown(root) }
})

test('(c) workspace password: enable/lock/unlock/disable never touch the Keychain, header is plain', async () => {
  const root = await tmp(), fake = spy()
  try {
    await secure.initializeSecureStorage(root, fake)
    const [dir] = await populate(root)
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF })
    vault.lock(dir)
    for (const rel of await migration.walk(dir)) if (rel !== vault.HEADER_FILE) assert.equal((await fs.readFile(path.join(dir, rel))).includes(Buffer.from(SECRET)), false, `${rel} leaks`)
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, vault.HEADER_FILE), 'utf8')).format, COMPAT.record019)
    await assert.rejects(vaultWorkspace.unlock(dir, 'errada-errada'), /WRONG_PASSWORD/)
    await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.equal((await createWorkspaceStorage(dir).loadDoc(P1))[0].content[0].text, `segunda ${SECRET} 0`)
    // AI key goes to the vault-encrypted file, not the Keychain
    const keys = createKeyStore({ safeStorage: fake, isFileProtected: d => vault.isEnabled(d) })
    assert.equal((await keys.set(dir, 'google', 'AIzaVaultKey1234')).storage, 'file')
    assert.equal(await keys.get(dir, 'google'), 'AIzaVaultKey1234')
    assert.equal((await fs.readFile(path.join(dir, 'ai-keys.json'))).includes(Buffer.from('AIzaVaultKey1234')), false)
    await vaultWorkspace.disable(dir, 'senha-do-espaco')
    assert.deepEqual(fake.calls, [])
  } finally { await teardown(root) }
})

test('(b) legacy: the app dialog comes BEFORE any Keychain access; "Agora não" keeps reading as before', async () => {
  const fake = spy(), { root, dirs, before } = await legacyRoot(fake)
  try {
    fake.calls.length = 0
    const order = []
    const status = await secure.initializeSecureStorage(root, fake, { confirmMigration: () => { order.push(`dialog@${fake.calls.length}`); return 'later' } })
    assert.deepEqual(order, ['dialog@0'])
    assert.equal(status.legacyPending, true); assert.equal(status.deviceCipher, 'legacy')
    assert.deepEqual(await logical(root, dirs), before)
    assert.equal(await secure.readMode(root), null, 'nothing is persisted when postponed')
    assert.deepEqual(await secure.deviceCipherStatus(root), { mode: 'legacy', backups: { exists: false, count: 0, expiresAt: null } })
    // new writes still use the old layer while postponed
    await createWorkspaceStorage(dirs[0]).saveDoc(P1, blocks('novo'))
    await drainWorkspaces(); await drain()
    assert.equal(isEncrypted(await fs.readFile(path.join(dirs[0], 'meta.json'))), true)
  } finally { await teardown(root) }
})

test('(b) legacy: full migration is verified, atomic, keeps a 14-day encrypted backup and never touches the Keychain again', async () => {
  const fake = spy(), { root, dirs, before } = await legacyRoot(fake)
  try {
    const oldFiles = await snapshot(root)
    assert.ok(Object.entries(oldFiles).some(([rel]) => rel.startsWith('data/')))
    fake.calls.length = 0
    const status = await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
    assert.equal(status.deviceCipher, 'none'); assert.ok(status.migrated.dirs >= 2 && status.migrated.root === 2)
    assert.deepEqual([...new Set(fake.calls)], ['isEncryptionAvailable', 'decryptString'], 'one last Keychain read, no writes')
    await assertNoDeviceCipher(root)
    assert.deepEqual(await logical(root, dirs), before, 'identical content after migration')
    // old encrypted copy kept as backup and still byte-identical to the original
    for (const dir of dirs) {
      const rel = path.relative(root, dir).split(path.sep).join('/')
      const backup = await snapshot(path.join(root, rel + secure.BACKUP_SUFFIX))
      for (const [file, hash] of Object.entries(backup)) assert.equal(oldFiles[`${rel}/${file}`], hash, `${rel}/${file} backup differs`)
      assert.ok(Object.keys(backup).length > 0)
    }
    assert.equal(isEncrypted(await fs.readFile(path.join(root, secure.ROOT_BACKUP, 'workspaces.json'))), true)
    const info = await secure.deviceCipherStatus(root)
    assert.equal(info.mode, 'none'); assert.equal(info.backups.exists, true); assert.ok(info.backups.expiresAt > Date.now() + 13 * 86400000)
    for (const extra of ['.vault-new', '.vault-old', '.vault-journal']) await assert.rejects(fs.access(dirs[0] + extra))
    // next launches: zero Keychain calls
    fake.calls.length = 0; setStorageCodec(null)
    const again = await secure.initializeSecureStorage(root, fake, { confirmMigration: () => assert.fail('must not ask again') })
    assert.equal(again.deviceCipher, 'none'); assert.deepEqual(fake.calls, [])
    assert.deepEqual(await logical(root, dirs), before)
    // backups: kept until expiry, then removed automatically (also the unused key file)
    assert.equal(await secure.purgeExpiredBackups(root, Date.now() + 13 * 86400000), false)
    assert.equal((await secure.deviceCipherStatus(root)).backups.exists, true)
    assert.equal(await secure.purgeExpiredBackups(root, Date.now() + 15 * 86400000), true)
    assert.equal((await secure.deviceCipherStatus(root)).backups.exists, false)
    assert.equal(await fs.access(path.join(root, secure.KEY_FILE)).then(() => true, () => false), false)
    assert.deepEqual(await logical(root, dirs), before)
  } finally { await teardown(root) }
})

test('(b) legacy: user can delete the backup earlier', async () => {
  const fake = spy(), { root, dirs, before } = await legacyRoot(fake)
  try {
    await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
    await secure.removeMigrationBackups(root)
    const info = await secure.deviceCipherStatus(root)
    assert.equal(info.backups.exists, false)
    assert.equal((await createWorkspaceStorage(dirs[1]).loadMeta()).pages[P1].title, 'Diário 1')
  } finally { await teardown(root) }
})

test('(b) legacy: denied Keychain or missing key deletes nothing and writes nothing', async () => {
  const fake = spy(), { root, dirs, before } = await legacyRoot(fake)
  try {
    const snap = await snapshot(root)
    for (const choice of ['continue', 'later']) {
      setStorageCodec(null)
      await assert.rejects(secure.initializeSecureStorage(root, spy({ deny: true }), { confirmMigration: () => choice }), error => error.code === 'KEYCHAIN_DENIED')
      assert.deepEqual(await snapshot(root), snap, `files untouched after denial (${choice})`)
    }
    await assert.rejects(secure.initializeSecureStorage(root, { isEncryptionAvailable: () => false }, { confirmMigration: () => 'continue' }), error => error.code === 'KEYCHAIN_UNAVAILABLE')
    assert.deepEqual(await snapshot(root), snap)
    // "try again" after the user allows it works
    const status = await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
    assert.equal(status.deviceCipher, 'none')
    await secure.removeMigrationBackups(root)
    // missing key: files stay as they are
    const second = await legacyRoot(fake)
    await fs.rm(path.join(second.root, secure.KEY_FILE))
    const snap2 = await snapshot(second.root); setStorageCodec(null)
    await assert.rejects(secure.initializeSecureStorage(second.root, fake, { confirmMigration: () => 'continue' }), error => error.code === 'DEVICE_KEY_MISSING')
    assert.deepEqual(await snapshot(second.root), snap2)
    await fs.rm(second.root, { recursive: true, force: true })
  } finally { await teardown(root) }
})

for (const failAt of ['copy', 'verify', 'swap-before', 'swap-middle', 'swap-after', 'root']) {
  test(`(b) legacy: interruption at "${failAt}" loses nothing and the next launch finishes the migration`, async () => {
    const fake = spy(), { root, dirs, before } = await legacyRoot(fake)
    try {
      const oldFiles = await snapshot(root)
      await assert.rejects(secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue', failAt }), /SIMULATED_CRASH/)
      setStorageCodec(null)
      // mid-crash state is still readable by the old key (launch with "later" first)
      if (failAt !== 'swap-middle') {
        await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'later' })
        assert.deepEqual(await logical(root, dirs), before, 'mixed state readable')
        setStorageCodec(null)
      }
      const status = await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
      assert.equal(status.deviceCipher, 'none')
      await assertNoDeviceCipher(root)
      assert.deepEqual(await logical(root, dirs), before)
      for (const extra of ['.vault-new', '.vault-old', '.vault-journal']) await assert.rejects(fs.access(dirs[0] + extra))
      const backup = await snapshot(path.join(root, 'data' + secure.BACKUP_SUFFIX))
      for (const [file, hash] of Object.entries(backup)) assert.equal(oldFiles[`data/${file}`], hash)
      assert.ok(Object.keys(backup).length > 0)
    } finally { await teardown(root) }
  })
}

test('(b) legacy + workspace password: vault files untouched, header migrated, unlock never needs the Keychain', async () => {
  const fake = spy(), root = await tmp()
  try {
    await secure.initializeSecureStorage(root, fake, { deviceCipher: 'keychain' })
    const [dir] = await populate(root)
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF }); vault.lock(dir)
    await drainWorkspaces(); await drain(); setStorageCodec(null); vault.setDeviceKey(null)
    await fs.rm(path.join(root, secure.MODE_FILE))
    const vaultFile = path.join(dir, 'meta.json'), vaultBytes = await fs.readFile(vaultFile)
    assert.equal(vaultBytes.subarray(0, 8).toString(), 'NPVLT01\n')
    vault.setEnabled(dir, undefined); vault.state(dir).header = null
    await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
    assert.deepEqual(await fs.readFile(vaultFile), vaultBytes, 'vault ciphertext untouched')
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, vault.HEADER_FILE), 'utf8')).format, COMPAT.record019)
    fake.calls.length = 0
    await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.equal((await createWorkspaceStorage(dir).loadDoc(P1))[0].content[0].text, `segunda ${SECRET} 0`)
    assert.deepEqual(fake.calls, [])
  } finally { await teardown(root) }
})

test('(b) hand-written old-format files (independent of the current writer) are migrated', async () => {
  const root = await tmp(), fake = spy()
  try {
    const key = crypto.randomBytes(32)
    await fs.writeFile(path.join(root, secure.KEY_FILE), fake.encryptString(key.toString('base64')))
    const meta = JSON.stringify({ pages: { [P1]: page(P1, 'Antigo') }, settings: { locale: 'pt-BR' }, notifications: {}, syncedBlocks: {} })
    await fs.mkdir(path.join(root, 'data'), { recursive: true })
    await fs.writeFile(path.join(root, 'data', 'meta.json'), seal(Buffer.from(meta), key, MAGIC))
    await fs.writeFile(path.join(root, 'workspaces.json'), seal(Buffer.from('[]'), key, MAGIC))
    fake.calls.length = 0
    await secure.initializeSecureStorage(root, fake, { confirmMigration: () => 'continue' })
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data', 'meta.json'), 'utf8')).pages[P1].title, 'Antigo')
    assert.equal((await fs.readFile(path.join(root, 'workspaces.json'), 'utf8')), '[]')
  } finally { await teardown(root) }
})

test('opt-in: Keychain cipher can be turned on and off at runtime without losing data', async () => {
  const root = await tmp(), fake = spy()
  try {
    await secure.initializeSecureStorage(root, fake)
    const dirs = await populate(root), before = await logical(root, dirs)
    await secure.setDeviceCipher(root, fake, true)
    assert.equal((await secure.deviceCipherStatus(root)).mode, 'keychain')
    for (const rel of await walkAll(root)) if (rel.endsWith('.json') && !['storage-key.keychain', secure.MODE_FILE].includes(rel)) assert.equal(isEncrypted(await fs.readFile(path.join(root, rel))), true, `${rel} should be sealed`)
    assert.deepEqual(await logical(root, dirs), before)
    // restart in keychain mode reads with the key
    setStorageCodec(null); await secure.initializeSecureStorage(root, fake)
    assert.deepEqual(await logical(root, dirs), before)
    await createWorkspaceStorage(dirs[0]).saveDoc(P1, blocks('depois')); await drainWorkspaces(); await drain()
    await secure.setDeviceCipher(root, fake, false)
    await assertNoDeviceCipher(root)
    assert.equal((await secure.deviceCipherStatus(root)).backups.exists, true)
    assert.equal((await createWorkspaceStorage(dirs[0]).loadDoc(P1))[0].content[0].text, 'depois')
    fake.calls.length = 0; setStorageCodec(null); await secure.initializeSecureStorage(root, fake)
    assert.deepEqual(fake.calls, [])
  } finally { await teardown(root) }
})

test('AI keys: Keychain only when the user saves/uses a key (lazy); session keys never persist', async () => {
  const root = await tmp(), fake = spy()
  try {
    await secure.initializeSecureStorage(root, fake)
    const [dir] = await populate(root)
    const keys = createKeyStore({ safeStorage: fake })
    assert.deepEqual(fake.calls, [])
    assert.equal((await keys.set(dir, 'openrouter', 'sk-or-guardada-12345')).storage, 'keychain')
    assert.deepEqual(fake.calls, ['isEncryptionAvailable', 'encryptString'])
    fake.calls.length = 0
    assert.equal((await keys.status(dir)).openrouter.storage, 'keychain'); assert.deepEqual(fake.calls, [], 'status never touches the Keychain')
    assert.equal(await keys.get(dir, 'openrouter'), 'sk-or-guardada-12345'); assert.deepEqual(fake.calls, ['isEncryptionAvailable', 'decryptString'])
    assert.equal((await keys.set(dir, 'openrouter', 'sk-or-so-sessao-123', { storage: 'session' })).storage, 'session')
    assert.equal((await keys.status(dir)).openrouter.configured, true)
    assert.equal((await fs.readFile(path.join(dir, 'ai-keys.json'), 'utf8')).includes('sessao'), false)
    assert.equal((await createKeyStore({ safeStorage: fake }).status(dir)).openrouter.configured, false, 'a new session has no key')
  } finally { await teardown(root) }
})

test('static guard: only the lazy wrapper receives Electron safeStorage; startup/UI paths never call it', async () => {
  const fsSync = require('node:fs')
  const electronDir = path.resolve(__dirname, '..', 'electron')
  const files = []
  const walk = dir => { for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.cjs') || f.endsWith('.mjs')) files.push(f) } }
  walk(electronDir)
  const direct = files.filter(f => /\bsafeStorage\s*\.\s*(encryptString|decryptString|isEncryptionAvailable)\b/.test(fsSync.readFileSync(f, 'utf8'))).map(f => path.relative(electronDir, f)).sort()
  assert.deepEqual(direct, ['ai/keys.cjs', 'secure-storage.cjs', 'vault-workspace.cjs'], 'unexpected safeStorage users')
  const main = fsSync.readFileSync(path.join(electronDir, 'main.cjs'), 'utf8')
  assert.equal(/safeStorage\s*\.\s*(encryptString|decryptString|isEncryptionAvailable)/.test(main), false)
  assert.ok(main.includes('createKeychain({ real: electronSafeStorage'), 'main must wrap the real safeStorage')
  assert.equal((main.match(/electronSafeStorage/g) ?? []).length, 2)
  const vaultIpc = fsSync.readFileSync(path.join(electronDir, 'vault-ipc.cjs'), 'utf8')
  assert.equal(/touchIdAvailable = \(\) => [^\n]*isEncryptionAvailable/.test(vaultIpc), false, 'Settings must not query the Keychain to show Touch ID')
})
