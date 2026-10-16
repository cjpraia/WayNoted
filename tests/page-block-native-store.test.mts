import COMPAT from '../shared/compatibility.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { setStorageCodec } = require('../electron/storage.cjs')

test('renderer and native ownership transactions converge after deletion, retry and undo without metadata conflicts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), COMPAT.record076))
  const native = createWorkspaceStorage(directory)
  Object.assign(globalThis, { window: { api: {
    loadMeta: native.loadMeta, saveMeta: native.saveMeta, loadDoc: native.loadDoc, saveDoc: native.saveDoc,
    listDocVersions: native.listVersions, saveDocVersions: native.importVersions,
  }, addEventListener() {} } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
  const { actions, api, selectors } = await import('../src/store.ts')
  try {
    await actions.init()
    const owner = actions.createPage(null), child = actions.createDatabase(owner, 'table', { blockOwnerId: owner })
    const block = { id: 'db', type: 'page', props: { pageId: child, ownership: 'owned' } }
    await api.saveDoc(owner, [block])
    let fail = true
    setStorageCodec({ encode: (file: string, bytes: unknown) => { if (file === path.join(directory, 'meta.json') && fail) { fail = false; throw new Error('Interrupted ownership metadata') }; return bytes }, decode: (_file: string, bytes: unknown) => bytes })
    await assert.rejects(api.saveDoc(owner, []), /Interrupted ownership/)
    await api.saveDoc(owner, [])
    assert.equal(selectors.page(child)?.trashed, true)
    assert.equal((await native.loadMeta()).pages[child].trashed, true)
    assert.deepEqual(await native.loadDoc(owner), [])
    await api.saveDoc(owner, [block])
    assert.equal(selectors.page(child)?.trashed, false)
    assert.equal((await native.loadMeta()).pages[child].trashed, false)
    assert.equal((await fs.readdir(directory)).includes('content-transaction.json'), false)
    const original = [{ id: 'list', type: 'bulletListItem', children: [block] }]
    await api.saveDoc(owner, original)
    const converted = actions.createPage(owner, { blockOwnerId: owner })
    await actions.appendPageBlocks(converted, original)
    const transferred = await actions.reparentOwnedPageBlocks(owner, converted, original)
    actions.updatePage(converted, { blockConversion: { sourceId: owner, childIds: transferred } }, false)
    await actions.flushMeta()
    const wrapper = [{ id: 'list', type: 'page', props: { pageId: converted, ownership: 'owned' }, children: [] }]
    await api.saveDoc(owner, wrapper)
    fail = true
    await assert.rejects(api.saveDoc(owner, original), /Interrupted ownership/)
    await api.saveDoc(owner, original)
    assert.equal(selectors.page(child)?.parentId, owner)
    assert.equal(selectors.isLive(child), true)
    assert.equal((await native.loadMeta()).pages[child].parentId, owner)
    assert.equal((await native.loadMeta()).pages[converted].trashed, true)
    await api.saveDoc(owner, wrapper)
    assert.equal(selectors.page(child)?.parentId, converted)
    assert.equal(selectors.isLive(child), true)
    assert.equal((await native.loadMeta()).pages[child].parentId, converted)
    assert.equal((await native.loadMeta()).pages[converted].trashed, false)
    assert.equal((await fs.readdir(directory)).includes('content-transaction.json'), false)
    await actions.flushAll()
  } finally {
    setStorageCodec(null)
    await actions.flushAll()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
