const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { CURRENT_SCHEMA_VERSION, migrateMeta, assertSchemaReadable, migrations } = require('../electron/migrations/index.cjs')

const page = id => ({ id, title: 'P', parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {} })
async function temporary(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-schema-test-")); try { await fn(dir) } finally { await fs.rm(dir, { recursive: true, force: true }) } }
const meta = (id, extra = {}) => ({ pages: { [id]: page(id) }, settings: { locale: 'pt-BR' }, ...extra })

test('every registered migration is sequential and data without a version counts as v1', () => {
  migrations.reduce((previous, migration) => { assert.equal(migration.to, previous + 1); return migration.to }, 1)
  const id = randomUUID()
  const result = migrateMeta(meta(id))
  assert.equal(result.from, 1); assert.equal(result.to, CURRENT_SCHEMA_VERSION); assert.equal(result.meta.schemaVersion, CURRENT_SCHEMA_VERSION)
  const again = migrateMeta(result.meta)
  assert.equal(again.changed, false); assert.equal(again.from, CURRENT_SCHEMA_VERSION)
  assert.deepEqual(result.meta.pages, meta(id).pages)
})

test('each migration step runs once, in order, from the stored version', () => {
  const calls = []
  const list = [{ to: 2, run: m => { calls.push(2); return { ...m, a: 1 } } }, { to: 3, run: m => { calls.push(3); return { ...m, b: 2 } } }]
  const result = migrateMeta({ pages: {} }, list)
  assert.deepEqual(calls, [2, 3]); assert.equal(result.meta.schemaVersion, 3); assert.equal(result.meta.b, 2)
  calls.length = 0
  migrateMeta({ pages: {}, schemaVersion: 2 }, list); assert.deepEqual(calls, [3])
})

test('opening newer data with this app is refused without writing anything', async () => temporary(async dir => {
  const id = randomUUID(), file = path.join(dir, 'meta.json')
  const newer = JSON.stringify({ ...meta(id), schemaVersion: CURRENT_SCHEMA_VERSION + 1, future: { keep: true } })
  await fs.writeFile(file, newer)
  const store = createWorkspaceStorage(dir)
  await assert.rejects(store.loadMeta(), error => error.code === 'SCHEMA_TOO_NEW' && error.message.includes(dir) && /mais nova/.test(error.message) && /newer/.test(error.message))
  await assert.rejects(store.saveMeta(meta(id)), /SCHEMA_TOO_NEW/)
  await assert.rejects(store.saveDoc(id, []), /SCHEMA_TOO_NEW/)
  await assert.rejects(store.backup(), /SCHEMA_TOO_NEW/)
  assert.equal(await fs.readFile(file, 'utf8'), newer)
  assert.deepEqual((await fs.readdir(dir)).sort(), ['meta.json'])
  assert.throws(() => assertSchemaReadable({ schemaVersion: 999 }, dir), /SCHEMA_TOO_NEW/)
}))

test('v1 data migrates on first open with a pre-migration copy, and is idempotent', async () => temporary(async dir => {
  const id = randomUUID(), file = path.join(dir, 'meta.json')
  const original = JSON.stringify(meta(id)) // sem schemaVersion = v1
  await fs.writeFile(file, original); await fs.writeFile(path.join(dir, 'activity.json'), '[]')
  const store = createWorkspaceStorage(dir)
  const loaded = await store.loadMeta()
  assert.equal(loaded.pages[id].title, 'P')
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion, CURRENT_SCHEMA_VERSION)
  const [backup] = await fs.readdir(path.join(dir, 'migration-backups'))
  assert.match(backup, /^schema-v1-/)
  assert.equal(await fs.readFile(path.join(dir, 'migration-backups', backup, 'meta.json'), 'utf8'), original)
  assert.ok((await fs.readdir(path.join(dir, 'migration-backups', backup))).includes('activity.json'))
  await createWorkspaceStorage(dir).loadMeta()
  assert.equal((await fs.readdir(path.join(dir, 'migration-backups'))).length, 1)
}))

test('new writes stamp the schema version and backups carry it', async () => temporary(async dir => {
  const id = randomUUID(), store = createWorkspaceStorage(dir)
  await store.saveMeta(meta(id)); await store.saveDoc(id, [{ id: 'b', type: 'paragraph' }])
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')).schemaVersion, CURRENT_SCHEMA_VERSION)
  assert.equal((await store.backup()).schemaVersion, CURRENT_SCHEMA_VERSION)
}))
