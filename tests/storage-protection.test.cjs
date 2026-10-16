// U1: lousa e bloco sincronizado protegidos em todos os caminhos de escrita do armazenamento.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')

const page = id => ({ id, title: 'P', parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {} })
const scene = { id: 'canvas-1', type: 'canvas', props: { version: 1, objects: [{ id: 'o1', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'SECRET' }] }, children: [] }
const ref = { id: 'sb-1', type: 'syncedBlock', props: { syncedId: 'sync-1' }, children: [] }
const paragraph = { id: 'p1', type: 'paragraph', content: 'oi' }
async function temporary(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-protect-test-"))
  try {
    const store = createWorkspaceStorage(dir), canvasId = randomUUID(), syncedId = randomUUID()
    await store.saveMeta({ pages: { [canvasId]: page(canvasId), [syncedId]: page(syncedId) }, settings: { locale: 'pt-BR' }, syncedBlocks: { 'sync-1': { id: 'sync-1', sourcePageId: syncedId, blocks: [paragraph], updatedAt: 1 } } })
    await store.saveDoc(canvasId, [scene], { userEdit: true }); await store.saveDoc(syncedId, [ref, paragraph], { userEdit: true })
    await fn(store, { canvasId, syncedId, dir })
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
const code = name => error => error.code === name && error.message.startsWith(name)

test('saveDoc refuses to replace or delete a canvas or synced block unless the editor itself saves', async () => temporary(async (store, { canvasId, syncedId }) => {
  await assert.rejects(store.saveDoc(canvasId, [paragraph]), code('CANVAS_PROTECTED'))
  await assert.rejects(store.saveDoc(canvasId, []), code('CANVAS_PROTECTED'))
  await assert.rejects(store.saveDoc(canvasId, [{ ...scene, props: { ...scene.props, objects: [] } }]), code('CANVAS_PROTECTED'))
  await assert.rejects(store.saveDoc(syncedId, [paragraph]), code('SYNCED_BLOCK_PROTECTED'))
  await assert.rejects(store.saveDoc(syncedId, [{ ...ref, props: { syncedId: 'other' } }, paragraph]), code('SYNCED_BLOCK_PROTECTED'))
  assert.deepEqual(await store.loadDoc(canvasId), [scene]); assert.deepEqual(await store.loadDoc(syncedId), [ref, paragraph])
  // texto comum continua gravando, e o editor da própria página pode alterar tudo
  await store.saveDoc(syncedId, [ref, { ...paragraph, content: 'novo' }])
  const edited = { ...scene, props: { ...scene.props, objects: [] } }
  await store.saveDoc(canvasId, [edited], { userEdit: true })
  assert.deepEqual(await store.loadDoc(canvasId), [edited])
}))

test('saveDocs (imports) never overwrite an existing canvas or synced block, even when asking for userEdit', async () => temporary(async (store, { canvasId, syncedId }) => {
  await assert.rejects(store.saveDocs([{ id: canvasId, blocks: [paragraph], options: { userEdit: true } }]), code('CANVAS_PROTECTED'))
  await assert.rejects(store.saveDocs([{ id: syncedId, blocks: [paragraph] }]), code('SYNCED_BLOCK_PROTECTED'))
  const fresh = randomUUID()
  await store.saveMeta({ ...(await store.loadMeta()), pages: { ...(await store.loadMeta()).pages, [fresh]: page(fresh) } })
  await store.saveDocs([{ id: fresh, blocks: [scene], options: { base: null } }])
  assert.deepEqual(await store.loadDoc(fresh), [scene])
  assert.deepEqual(await store.loadDoc(canvasId), [scene])
}))

test('editDocument (local API / MCP / merge) is guarded for canvas and synced blocks', async () => temporary(async (store, { canvasId, syncedId }) => {
  const base = async id => JSON.stringify(await store.loadDoc(id))
  await assert.rejects(store.editDocument(canvasId, [paragraph], await base(canvasId)), code('CANVAS_PROTECTED'))
  await assert.rejects(store.editDocument(syncedId, [paragraph], await base(syncedId)), code('SYNCED_BLOCK_PROTECTED'))
  await store.editDocument(syncedId, [ref, { ...paragraph, content: 'via API' }], await base(syncedId))
  assert.equal((await store.loadDoc(syncedId))[1].content, 'via API')
}))

test('version restore goes through the same guard (history rows come back through saveDoc)', async () => temporary(async (store, { canvasId }) => {
  await store.saveDoc(canvasId, [scene, paragraph], { userEdit: true })
  const versions = await store.listVersions(canvasId)
  const withoutCanvas = [paragraph]
  await assert.rejects(store.saveDoc(canvasId, withoutCanvas, { checkpoint: true }), code('CANVAS_PROTECTED'))
  assert.ok(versions.length >= 1)
  await store.saveDoc(canvasId, withoutCanvas, { checkpoint: true, userEdit: true }) // escolha explícita confirmada
  assert.deepEqual(await store.loadDoc(canvasId), withoutCanvas)
}))

test('the meta never loses synced block records and mutateMeta cannot rewrite them', async () => temporary(async (store, { canvasId }) => {
  const meta = await store.loadMeta()
  await store.saveMeta({ pages: meta.pages, settings: meta.settings, syncedBlocks: {} }, meta)
  assert.ok((await store.loadMeta()).syncedBlocks['sync-1'], 'record restored')
  await assert.rejects(store.mutateMeta(current => ({ ...current, syncedBlocks: {} })), code('SYNCED_BLOCK_PROTECTED'))
  await assert.rejects(store.mutateMeta(current => ({ ...current, syncedBlocks: { 'sync-1': { ...current.syncedBlocks['sync-1'], blocks: [] } } })), code('SYNCED_BLOCK_PROTECTED'))
  await store.mutateMeta(current => ({ ...current, pages: { ...current.pages, [canvasId]: { ...current.pages[canvasId], title: 'ok' } } }))
  assert.equal((await store.loadMeta()).pages[canvasId].title, 'ok')
}))

test('the local API keeps the canvas (re-inserted) and answers 409 for synced block overwrites', async () => temporary(async (store, { canvasId, syncedId }) => {
  const service = await startLocalApi({ storage: store, token: 't', onChange: () => {} })
  const headers = { Authorization: 'Bearer t', 'Content-Type': 'application/json' }
  try {
    const status = async (id, blocks) => {
      const read = await fetch(`${service.url}/v1/pages/${id}/blocks`, { headers })
      const response = await fetch(`${service.url}/v1/pages/${id}/blocks`, { method: 'PUT', headers: { ...headers, 'If-Match': read.headers.get('etag') }, body: JSON.stringify(blocks) })
      return response.status
    }
    await status(canvasId, [{ type: 'paragraph', content: 'x' }])
    assert.ok((await store.loadDoc(canvasId)).some(block => JSON.stringify(block) === JSON.stringify(scene)), 'canvas intact')
    assert.equal(await status(canvasId, [{ id: 'canvas-1', type: 'canvas', props: { objects: [] } }]), 409)
    assert.equal(await status(syncedId, [{ type: 'paragraph', content: 'x' }]), 409)
    assert.deepEqual((await store.loadDoc(canvasId))[0], scene)
  } finally { await service.close() }
}))
