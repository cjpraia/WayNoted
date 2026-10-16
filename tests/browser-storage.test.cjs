const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { residualFiles, scrubResidue, purgeBrowserStorage } = require('../electron/browser-storage.cjs')
const { registerVaultIpc } = require('../electron/vault-ipc.cjs')

const MARKER = 'MARCADOR-TEXTO-CLARO-9Z'
function fakeUserData() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-browser-storage-"))
  const idb = path.join(root, 'IndexedDB', 'file__0.indexeddb.leveldb')
  fs.mkdirSync(idb, { recursive: true })
  fs.writeFileSync(path.join(idb, '000003.log'), `...${MARKER}...`)
  fs.writeFileSync(path.join(idb, '000005.ldb'), `xx${MARKER}xx`)
  fs.writeFileSync(path.join(idb, 'MANIFEST-000001'), 'm')
  fs.mkdirSync(path.join(root, 'Local Storage', 'leveldb'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Local Storage', 'leveldb', 'keep.log'), 'ui prefs only')
  return root
}
const containsMarker = root => {
  const hits = []
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (fs.readFileSync(p).includes(Buffer.from(MARKER))) hits.push(p) } }
  walk(root)
  return hits
}

test('scrubResidue removes the leveldb (.log and .ldb) but keeps unrelated stores', () => {
  const root = fakeUserData()
  try {
    assert.equal(containsMarker(root).length, 2)
    assert.ok(residualFiles(root).length >= 3)
    scrubResidue(root)
    assert.equal(containsMarker(root).length, 0)
    assert.equal(residualFiles(root).length, 0)
    assert.ok(fs.existsSync(path.join(root, 'Local Storage', 'leveldb', 'keep.log')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('purgeBrowserStorage clears through the session and clears again if files were left behind', async () => {
  const root = fakeUserData()
  const calls = []
  // The browser only deletes on the second pass (e.g. a connection re-created the store in between).
  const session = { clearStorageData: async options => { calls.push(options); if (calls.filter(c => c.storages).length >= 2) scrubResidue(root) }, flushStorageData: async () => { calls.push('flush') } }
  try {
    const result = await purgeBrowserStorage(session, root)
    assert.deepEqual(calls[0].storages, ['indexdb', 'cachestorage', 'serviceworkers'])
    assert.ok(calls.includes('flush'))
    assert.equal(result.residual.length, 0)
    assert.equal(containsMarker(root).length, 0)
    await purgeBrowserStorage({ clearStorageData: async () => { throw new Error('boom') } }, root) // never throws
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('protecting a page (and its children) purges the browser storage and tells the windows to reset', async () => {
  const root = fakeUserData()
  const handlers = new Map(), broadcasts = []
  const cleared = []
  const session = { clearStorageData: async o => { cleared.push(o); scrubResidue(root) }, flushStorageData: async () => {} }
  const win = { isDestroyed: () => false, webContents: { id: 1, session, reload() {} } }
  const contexts = new Map([[1, { workspaceId: 'default', win, locale: 'pt-BR' }]])
  const meta = { pages: {}, settings: {}, notifications: {}, syncedBlocks: {} }
  const store = { protectPages: async () => meta, protectChildren: async () => ({ meta }), loadMeta: async () => meta }
  const api = registerVaultIpc({
    trustedHandler: (channel, fn) => handlers.set(channel, fn), contexts, dataDir: () => path.join(root, 'data'), storage: () => store,
    flushRenderer: async () => {}, broadcast: (id, change) => broadcasts.push(change), configureLocalApi: async () => {}, safeStorage: null, systemPreferences: null,
    powerMonitor: null, drainAll: async () => {}, nativeT: pt => pt, userData: () => root, session, trailingPurgeMs: 20,
  })
  try {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true })
    const event = { sender: { id: 1 } }
    await handlers.get('np:pageProtect')(event, 'page-1', 'senha-forte-1', { includeChildren: true })
    assert.equal(cleared.length, 1)
    assert.equal(containsMarker(root).length, 0, 'clear text must be gone right after protecting')
    assert.ok(broadcasts.some(change => change.cacheReset === true))
    assert.ok(broadcasts.some(change => change.meta))
    // Writes that were in flight with the old state are swept by the trailing pass.
    fs.mkdirSync(path.join(root, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true })
    fs.writeFileSync(path.join(root, 'IndexedDB', 'file__0.indexeddb.leveldb', '000007.log'), MARKER)
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.ok(cleared.length >= 2)
    assert.equal(containsMarker(root).length, 0)
  } finally { api.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
