// Synthetic cross-platform transfer fixture. Never reads a personal profile.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { initializeSecureStorage } = require('../electron/secure-storage.cjs')
const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
const { drain, setStorageCodec } = require('../electron/storage.cjs')
const vault = require('../electron/vault.cjs')
const vaultWorkspace = require('../electron/vault-workspace.cjs')
const backup = require('../electron/backup.cjs')
const output = path.resolve(process.argv[2] || '.artifacts/portable-backup')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-transfer-'))
const dir = path.join(root, 'data')
const ids = { database: '11111111-1111-4111-8111-111111111111', row: '22222222-2222-4222-8222-222222222222', protected: '33333333-3333-4333-8333-333333333333' }
// Public test passwords, exclusively for generated synthetic data.
const password = 'Portable-workspace-check-42!'
const pagePassword = 'Portable-page-check-42!'
const page = (id, title, extra = {}) => ({ id, parentId: null, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra })
const blocks = text => [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]
try {
  await initializeSecureStorage(root, null, { deviceCipher: 'none' })
  const store = createWorkspaceStorage(dir)
  await store.saveMeta({ pages: {
    [ids.database]: page(ids.database, 'Transferred database', { database: { properties: [{ id: 'name', name: 'Name', type: 'title' }, { id: 'city', name: 'City', type: 'text' }], views: [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'table' } }),
    [ids.row]: page(ids.row, 'Transferred row — café', { parentId: ids.database, props: { city: 'São Paulo' } }),
    [ids.protected]: page(ids.protected, 'Protected transfer'),
  }, settings: { locale: 'en-US' }, notifications: {}, syncedBlocks: {} })
  await store.saveDoc(ids.row, blocks('Cross-platform row content with Unicode: café.'))
  await store.saveDoc(ids.protected, blocks('Protected content survives operating system transfer.'))
  await store.protectPages(ids.protected, pagePassword, { hideTitle: true })
  await vaultWorkspace.enable(dir, password, { locale: 'en-US' })
  await drainWorkspaces(); await drain()
  const made = await backup.createBackup({ dataDir: dir, destRoot: output, workspaceId: 'default', vault: { enabled: true, key: vault.getKey(dir) } })
  assert.ok((await backup.verifyBackup(made.path)).ok)
  await fs.writeFile(path.join(output, 'fixture.json'), JSON.stringify({ platform: process.platform, id: made.id, ids, password, pagePassword }, null, 2))
  console.log('Created encrypted synthetic backup on', process.platform)
} finally {
  await drainWorkspaces(); await drain(); setStorageCodec(null); vault.lock(dir)
  await fs.rm(root, { recursive: true, force: true })
}
