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

test('failed metadata transfer leaves source and converted page recoverable after later owner save', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), COMPAT.record075))
  const native = createWorkspaceStorage(directory)
  Object.assign(globalThis, { window: { api: {
    loadMeta: native.loadMeta, saveMeta: native.saveMeta, loadDoc: native.loadDoc, saveDoc: native.saveDoc,
    listDocVersions: native.listVersions, saveDocVersions: native.importVersions,
  }, addEventListener() {} } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
  const { actions, api, selectors } = await import('../src/store.ts')
  try {
    await actions.init()
    const owner = actions.createPage(null)
    const child = actions.createPage(owner, { blockOwnerId: owner })
    const source = [{ id: 'list', type: 'bulletListItem', content: [{ type: 'text', text: 'Parent', styles: { bold: true } }], children: [{ id: 'child-block', type: 'page', props: { pageId: child, ownership: 'owned' }, children: [] }] }]
    await api.saveDoc(owner, source)
    const converted = actions.createPage(owner, { title: 'Parent', blockOwnerId: owner })
    await actions.flushMeta()
    await actions.appendPageBlocks(converted, source)
    let fail = true
    setStorageCodec({ encode: (file: string, bytes: unknown) => {
      if (file === path.join(directory, 'meta.json') && fail) { fail = false; throw new Error('Injected metadata failure') }
      return bytes
    }, decode: (_file: string, bytes: unknown) => bytes })
    await assert.rejects(actions.reparentOwnedPageBlocks(owner, converted, source), /Injected metadata failure/)
    // This is the conversion handler's recovery path: never trash a destination
    // that already contains copied content or reparented children.
    actions.updatePage(converted, { blockOwnerId: null }, false)
    await actions.flushMeta()
    assert.equal(selectors.page(child)?.parentId, converted)
    assert.equal(selectors.isLive(child), true)
    assert.equal(selectors.isLive(converted), true)
    assert.equal(selectors.page(converted)?.blockOwnerId, null)
    assert.deepEqual(await native.loadDoc(owner), source)
    assert.deepEqual(await native.loadDoc(converted), source)
    await api.saveDoc(owner, source)
    assert.equal(selectors.isLive(converted), true)
    assert.equal(selectors.isLive(child), true)
    const persisted = await native.loadMeta()
    assert.equal(persisted.pages[converted].blockOwnerId, null)
    assert.equal(persisted.pages[child].parentId, converted)
    await actions.flushAll()
  } finally {
    setStorageCodec(null)
    await actions.flushAll()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
