const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { drain } = require('../electron/storage.cjs')

const page = (id, extra = {}) => ({ id, title: 'P', parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {}, ...extra })

test('a crash between the document and the meta recovers to a consistent state on reopen', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-crash-test-"))
  const realRename = fs.rename
  try {
    const owner = randomUUID(), child = randomUUID(), wrapper = randomUUID()
    const base = { pages: { [owner]: page(owner), [child]: page(child, { parentId: owner, blockOwnerId: owner }) }, settings: { locale: 'pt-BR' } }
    const store = createWorkspaceStorage(dir)
    await store.saveMeta(base)
    const withBlock = [{ id: 'blk', type: 'page', props: { pageId: child, ownership: 'owned' }, children: [] }]
    await store.saveDoc(owner, withBlock)
    // Remover o bloco muda o meta (página-filha vai para a lixeira): o journal é gravado, depois o doc, depois o meta.
    // Simula queda/disco cheio ao gravar o meta.
    fs.rename = async (from, to) => { if (path.basename(to) === 'meta.json') throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); return realRename.call(fs, from, to) }
    await assert.rejects(store.saveDoc(owner, []), /ENOSPC/)
    fs.rename = realRename
    await drain()
    assert.ok((await fs.readdir(dir)).includes('content-transaction.json'), 'journal kept for recovery')
    // Reabrir: a transação pendente é concluída; doc e meta ficam coerentes.
    const reopened = createWorkspaceStorage(dir)
    const meta = await reopened.loadMeta()
    assert.deepEqual(await reopened.loadDoc(owner), [])
    assert.equal(meta.pages[child].trashed, true)
    assert.ok(!(await fs.readdir(dir)).includes('content-transaction.json'))
    assert.ok(!(await fs.readdir(path.join(dir, 'docs'))).some(name => name.endsWith('.tmp')))
  } finally { fs.rename = realRename; await fs.rm(dir, { recursive: true, force: true }) }
})

test('a failed document write leaves the previous document and meta untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-crash2-test-"))
  const realRename = fs.rename
  try {
    const id = randomUUID(), store = createWorkspaceStorage(dir)
    await store.saveMeta({ pages: { [id]: page(id) }, settings: { locale: 'pt-BR' } })
    await store.saveDoc(id, [{ id: 'a', type: 'paragraph', content: 'one' }])
    fs.rename = async (from, to) => { if (path.dirname(to).endsWith('docs')) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); return realRename.call(fs, from, to) }
    await assert.rejects(store.saveDoc(id, [{ id: 'a', type: 'paragraph', content: 'two' }]), /ENOSPC/)
    fs.rename = realRename
    assert.deepEqual(await store.loadDoc(id), [{ id: 'a', type: 'paragraph', content: 'one' }])
    assert.equal((await store.loadMeta()).pages[id].title, 'P')
  } finally { fs.rename = realRename; await fs.rm(dir, { recursive: true, force: true }) }
})
