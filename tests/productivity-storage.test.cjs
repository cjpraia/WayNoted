// productivity.json: gravação/mescla no processo principal, várias janelas e cofre do espaço.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { initializeSecureStorage } = require('../electron/secure-storage.cjs')
const { setStorageCodec, drain } = require('../electron/storage.cjs')
const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
const vault = require('../electron/vault.cjs')
const vaultWorkspace = require('../electron/vault-workspace.cjs')

const KDF = { N: 2 ** 14, r: 8, p: 1 }
const PAGE = '11111111-1111-4111-8111-111111111111'
const keychain = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`kc:${text}`), decryptString: bytes => bytes.toString().replace('kc:', '') }
const page = { id: PAGE, parentId: null, title: 'Diário', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '' }

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-productivity-test-"))
  await initializeSecureStorage(root, keychain, { deviceCipher: 'keychain' })
  const dir = path.join(root, 'data'), store = createWorkspaceStorage(dir)
  await store.saveMeta({ pages: { [PAGE]: page }, settings: { locale: 'pt-BR', historyLimit: 0 }, notifications: {}, syncedBlocks: {} })
  return { root, dir, store }
}
async function teardown(root) { await drainWorkspaces(); await drain(); setStorageCodec(null); for (const dir of [...vault.unlockedDirs()]) vault.lock(dir); await fs.rm(root, { recursive: true, force: true }) }
const delta = (n, start) => ({ at: start, days: { '2026-10-07': { words: n, edits: 1, hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 1 : 0)), pages: { [PAGE]: [n, 1] } } }, spans: [[start, start + 1000]] })

test('concurrent deltas from several windows are summed without loss (transaction + atomic write)', async () => {
  const { root, dir, store } = await setup()
  try {
    assert.deepEqual((await store.productivity.load()).days, {})
    const other = createWorkspaceStorage(dir) // segunda janela do mesmo espaço
    const start = new Date('2026-10-07T09:00:00').getTime()
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? store : other).productivity.record(delta(i + 1, start + i * 1000))))
    const data = await store.productivity.load()
    const day = data.days['2026-10-07']
    assert.equal(day.words, 210)
    assert.equal(day.edits, 20)
    assert.equal(day.hours[9], 20)
    assert.deepEqual(day.pages[PAGE], [210, 20])
    assert.equal(day.sessions, 1, 'twenty overlapping bursts are one session')
    const text = await fs.readFile(path.join(dir, 'productivity.json'), 'utf8').catch(() => '')
    assert.equal(text.includes('Diário'), false, 'never titles or content')
    const filled = await store.productivity.backfill({ '2026-09-01': { words: 5 }, '2026-10-07': { words: 1000 } })
    assert.equal(filled.days['2026-09-01'].estimated, true)
    assert.equal(filled.days['2026-10-07'].words, 210)
    assert.equal((await store.productivity.backfill({ '2026-09-02': { words: 5 } })).days['2026-09-02'], undefined, 'only once')
    const cleared = await store.productivity.clear()
    assert.deepEqual(cleared.days, {})
    assert.deepEqual((await store.productivity.load()).days, {})
  } finally { await teardown(root) }
})

test('with a workspace password the file is encrypted; while locked nothing is read or written', async () => {
  const { root, dir, store } = await setup()
  try {
    await store.productivity.record(delta(7, new Date('2026-10-07T09:00:00').getTime()))
    await vaultWorkspace.enable(dir, 'senha-do-espaco', { kdf: KDF })
    const file = path.join(dir, 'productivity.json')
    const raw = await fs.readFile(file)
    assert.equal(raw.subarray(0, 8).toString(), 'NPVLT01\n', 'migrated with the rest of the workspace')
    await store.productivity.record(delta(3, new Date('2026-10-07T10:00:00').getTime()))
    const after = await fs.readFile(file)
    assert.equal(after.subarray(0, 8).toString(), 'NPVLT01\n')
    assert.equal(after.includes(Buffer.from(PAGE)), false, 'page ids are not readable on disk')
    assert.equal((await store.productivity.load()).days['2026-10-07'].words, 10)
    vault.lock(dir)
    const before = await fs.readFile(file)
    assert.deepEqual(await store.productivity.record(delta(1, Date.now())), { locked: true })
    assert.equal(await store.productivity.load(), null)
    assert.deepEqual(await store.productivity.clear(), { locked: true })
    assert.ok((await fs.readFile(file)).equals(before), 'locked workspace: file untouched')
    await vaultWorkspace.unlock(dir, 'senha-do-espaco')
    assert.equal((await store.productivity.load()).days['2026-10-07'].words, 10)
  } finally { await teardown(root) }
})
