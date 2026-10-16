const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID, randomBytes } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { encrypt, decrypt } = require('../electron/encryption.cjs')
const { parseDeepLink } = require('../electron/deep-links.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')
const { setStorageCodec } = require('../electron/storage.cjs')

const page = id => ({ id, title: 'Original', parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {} })
async function temporary(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-desktop-test-")); try { await fn(createWorkspaceStorage(dir), dir) } finally { await fs.rm(dir, { recursive: true, force: true }) } }

test('separate windows merge independent edits and reject conflicting fields without data loss', async () => temporary(async store => {
  const id = randomUUID(), second = randomUUID(), base = { pages: { [id]: page(id), [second]: page(second) }, settings: { locale: 'pt-BR' } }
  await store.saveMeta(base)
  const left = structuredClone(base), right = structuredClone(base)
  left.pages[id].title = 'Window A'; right.pages[second].title = 'Window B'
  await Promise.all([store.saveMeta(left, base), store.saveMeta(right, base)])
  const current = await store.loadMeta()
  assert.equal(current.pages[id].title, 'Window A'); assert.equal(current.pages[second].title, 'Window B')
  const conflicting = structuredClone(base); conflicting.pages[id].title = 'Conflict'
  await assert.rejects(store.saveMeta(conflicting, base), /CONCURRENT_CHANGE/)
  assert.equal((await store.loadMeta()).pages[id].title, 'Window A')
}))

test('full history includes metadata, exceeds 50 by default and preserves conflicting editor content', async () => temporary(async store => {
  const id = randomUUID(), base = { pages: { [id]: page(id) }, settings: { userName: 'Local author', historyLimit: 0 } }
  await store.saveMeta(base); await store.saveDoc(id, [{ text: 'start' }])
  await store.saveMeta({ ...base, pages: { [id]: { ...base.pages[id], title: 'Renamed', props: { price: 19 } } } }, base)
  let versions = await store.listVersions(id)
  assert.equal(versions[0].page.title, 'Original'); assert.equal(versions[0].reason, 'metadata')
  for (let i = 0; i < 55; i++) await store.saveDoc(id, [{ text: String(i) }])
  versions = await store.listVersions(id); assert.equal(versions.length, 56)
  await assert.rejects(store.saveDoc(id, [{ text: 'candidate' }], { base: JSON.stringify([{ text: 'stale' }]) }), /DOC_CONFLICT/)
  assert.deepEqual(await store.loadDoc(id), [{ text: '54' }])
  assert.equal((await store.listVersions(id))[0].reason, 'conflict')
  assert.deepEqual((await store.listVersions(id))[0].blocks, [{ text: 'candidate' }])
  const backup = await store.backup()
  assert.ok(backup.versions[id].length > 50); assert.ok(backup.activity.some(item => item.action === 'content.updated'))
}))

test('draft recovery excludes live windows and restores an abandoned draft after restart', async () => temporary(async store => {
  const id = randomUUID(), live = randomUUID(), abandoned = randomUUID(), fresh = randomUUID()
  await store.draftSave(id, live, [{ text: 'active' }]); await store.draftSave(id, abandoned, [{ text: 'recover' }])
  assert.deepEqual(await store.draftLoad(id, fresh, [live]), [{ text: 'recover' }])
  await store.draftDelete(id, fresh)
  assert.equal(await store.draftLoad(id, fresh, [live]), null)
  assert.deepEqual(await store.draftLoad(id, live), [{ text: 'active' }])
}))

test('concurrent database inserts receive distinct sequential IDs', async () => temporary(async store => {
  const dbId = randomUUID(), a = randomUUID(), b = randomUUID()
  const base = { pages: { [dbId]: { ...page(dbId), database: { properties: [], views: [], nextSequence: 1 } } }, settings: {} }
  await store.saveMeta(base)
  const left = structuredClone(base), right = structuredClone(base)
  left.pages[a] = { ...page(a), parentId: dbId, sequence: 1 }; right.pages[b] = { ...page(b), parentId: dbId, sequence: 1 }
  left.pages[dbId].database.nextSequence = 2; right.pages[dbId].database.nextSequence = 2
  await Promise.all([store.saveMeta(left, base), store.saveMeta(right, base)])
  const current = await store.loadMeta()
  assert.deepEqual([current.pages[a].sequence, current.pages[b].sequence].sort(), [1, 2])
}))

test('authenticated encryption rejects tampering and wrong keys, preserving legacy plaintext reads', () => {
  const key = randomBytes(32), content = Buffer.from('{"title":"private note"}')
  const encrypted = encrypt(content, key)
  assert.equal(encrypted.includes(Buffer.from('private note')), false)
  assert.deepEqual(decrypt(encrypted, key), content)
  assert.deepEqual(decrypt(content, key), content)
  const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] ^= 1
  assert.throws(() => decrypt(tampered, key)); assert.throws(() => decrypt(encrypted, randomBytes(32)))
})

test('deep links accept local page/block/view identifiers and reject other schemes and traversal', () => {
  const id = randomUUID()
  assert.deepEqual(parseDeepLink(`workspace://page/${id}#block=block-1&view=view-1`), { type: 'page', id, blockId: 'block-1', viewId: 'view-1' })
  for (const url of ['javascript:alert(1)', `https://page/${id}`, "workspace://page/../../private", `workspace://user@page/${id}`, `workspace://page/${id}/extra`]) assert.equal(parseDeepLink(url), null)
})

test('local API requires a token, rejects browser origins, checks document versions and honors locks', async () => temporary(async store => {
  const id = randomUUID(), meta = { pages: { [id]: page(id) }, settings: { locale: 'en-US' } }
  await store.saveMeta(meta)
  const changes = [], service = await startLocalApi({ storage: store, token: 'local-test-token', onChange: change => changes.push(change) })
  const headers = { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' }
  try {
    assert.equal((await fetch(`${service.url}/v1/pages`)).status, 401)
    assert.equal((await fetch(`${service.url}/v1/pages`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403)
    const response = await fetch(`${service.url}/v1/pages/${id}/blocks`, { headers }), tag = response.headers.get('etag')
    assert.equal(response.status, 200)
    const blocks = [{ type: 'paragraph', content: [{ text: 'Local API note' }] }]
    assert.equal((await fetch(`${service.url}/v1/pages/${id}/blocks`, { method: 'PUT', headers, body: JSON.stringify(blocks) })).status, 412)
    assert.equal((await fetch(`${service.url}/v1/pages/${id}/blocks`, { method: 'PUT', headers: { ...headers, 'If-Match': tag }, body: JSON.stringify(blocks) })).status, 200)
    assert.deepEqual(await store.loadDoc(id), blocks); assert.ok(changes.some(change => change.documentId === id))
    await store.mutateMeta(current => ({ ...current, pages: { ...current.pages, [id]: { ...current.pages[id], locked: true } } }))
    assert.equal((await fetch(`${service.url}/v1/pages/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'Blocked' }) })).status, 423)
    const parentId = randomUUID(), childId = randomUUID()
    await store.mutateMeta(current => ({ ...current, pages: { ...current.pages, [parentId]: { ...page(parentId), trashed: true }, [childId]: { ...page(childId), parentId } } }))
    const listed = await (await fetch(`${service.url}/v1/pages`, { headers })).json()
    assert.equal(listed.results.some(page => page.id === childId), false)
    for (const suffix of ['', '/blocks']) assert.equal((await fetch(`${service.url}/v1/pages/${childId}${suffix}`, { headers })).status, 404)
    assert.equal((await fetch(`${service.url}/v1/pages`, { method: 'POST', headers, body: JSON.stringify({ title: 'Invalid child', parentId: childId }) })).status, 400)
  } finally { await service.close() }
}))

test('a failed content metadata write is recovered from its journal before the next read', async () => temporary(async (store, directory) => {
  const id = randomUUID(), target = randomUUID()
  await store.saveMeta({ pages: { [id]: page(id), [target]: page(target) }, settings: {} })
  await store.saveDoc(id, [{ type: 'paragraph', content: 'Before' }])
  const before = JSON.stringify(await store.loadDoc(id))
  let fail = true
  setStorageCodec({ encode: (file, bytes) => { if (file === path.join(directory, 'meta.json') && fail) { fail = false; throw new Error('simulated metadata disk failure') }; return bytes }, decode: (_file, bytes) => bytes })
  try {
    const blocks = [{ type: 'paragraph', content: [{ type: 'link', href: `workspace://page/${target}`, content: [{ text: 'After' }] }] }]
    await assert.rejects(store.editDocument(id, blocks, before), /simulated metadata/)
    assert.ok((await fs.readdir(directory)).includes('content-transaction.json'))
    const recovered = await store.loadMeta()
    assert.equal(recovered.pages[id].text, 'After')
    assert.deepEqual(recovered.pages[id].outboundPageIds, [target])
    assert.deepEqual(await store.loadDoc(id), blocks)
    assert.equal((await fs.readdir(directory)).includes('content-transaction.json'), false)
  } finally { setStorageCodec(null) }
}))

test('owned database deletion is recovered together with its body after an interrupted metadata write', async () => temporary(async (store, directory) => {
  const owner = randomUUID(), child = randomUUID(), linked = randomUUID()
  const owned = { id: 'owned', type: 'page', props: { pageId: child, ownership: 'owned' } }
  const reference = { id: 'reference', type: 'page', props: { pageId: linked, ownership: 'linked' } }
  await store.saveMeta({ pages: { [owner]: page(owner), [child]: { ...page(child), parentId: owner, blockOwnerId: owner }, [linked]: page(linked) }, settings: {} })
  await store.saveDoc(owner, [owned, reference])
  let fail = true
  setStorageCodec({ encode: (file, bytes) => { if (file === path.join(directory, 'meta.json') && fail) { fail = false; throw new Error('ownership metadata disk failure') }; return bytes }, decode: (_file, bytes) => bytes })
  try {
    await assert.rejects(store.saveDoc(owner, [], { base: JSON.stringify([owned, reference]), ownershipAt: 1234 }), /ownership metadata/)
    assert.ok((await fs.readdir(directory)).includes('content-transaction.json'))
    const reopened = createWorkspaceStorage(directory)
    const recovered = await reopened.loadMeta()
    assert.deepEqual(await reopened.loadDoc(owner), [])
    assert.equal(recovered.pages[child].trashed, true)
    assert.equal(recovered.pages[child].trashedAt, 1234)
    assert.equal(recovered.pages[linked].trashed, undefined)
    assert.equal((await fs.readdir(directory)).includes('content-transaction.json'), false)
    await reopened.saveDoc(owner, [owned])
    assert.equal((await reopened.loadMeta()).pages[child].trashed, false)
    const current = await reopened.loadMeta()
    await reopened.saveMeta({ ...current, pages: { ...current.pages, [child]: { ...current.pages[child], trashed: true, removedByBlock: undefined } } }, current)
    await reopened.saveDoc(owner, [owned, reference])
    assert.equal((await reopened.loadMeta()).pages[child].trashed, true)
  } finally { setStorageCodec(null) }
}))

test('conflicting document saves cannot delete owned children and quick removals retain recovery markers', async () => temporary(async store => {
  const owner = randomUUID(), child = randomUUID()
  await store.saveMeta({ pages: { [owner]: page(owner), [child]: { ...page(child), parentId: owner, blockOwnerId: owner } }, settings: {} })
  const block = { id: 'owned', type: 'page', props: { pageId: child, ownership: 'owned' } }
  await store.saveDoc(owner, [block])
  await assert.rejects(store.saveDoc(owner, [], { base: '[]' }), /DOC_CONFLICT/)
  assert.notEqual((await store.loadMeta()).pages[child].trashed, true)
  await store.saveDoc(owner, [], { base: JSON.stringify([block]) })
  assert.equal((await store.loadMeta()).pages[child].removedByBlock.ownerId, owner)
  const rapid = randomUUID(), current = await store.loadMeta()
  await store.saveMeta({ ...current, pages: { ...current.pages, [rapid]: { ...page(rapid), parentId: owner, blockOwnerId: owner } } }, current)
  await store.saveDoc(owner, [])
  assert.equal((await store.loadMeta()).pages[rapid].trashed, true)
}))

test('deleted-page tombstones preserve late edits separately from permanent cleanup', async () => temporary(async (store, directory) => {
  const id = randomUUID(), base = { pages: { [id]: page(id) }, settings: {} }
  await store.saveMeta(base)
  await store.saveDoc(id, [{ text: 'old' }])
  await store.saveMeta({ ...base, pages: {} }, base)
  await assert.rejects(store.saveDoc(id, [{ text: 'latest unsaved work' }], { base: JSON.stringify([{ text: 'old' }]), page: page(id) }), /DOC_DELETED/)
  await store.deleteDoc(id)
  assert.equal(await store.loadDoc(id), null)
  const reopened = createWorkspaceStorage(directory), conflicts = await reopened.listDocumentConflicts()
  assert.equal(conflicts.length, 1)
  assert.deepEqual(conflicts[0].blocks, [{ text: 'latest unsaved work' }])
  assert.equal(conflicts[0].page.id, id)
  await assert.rejects(reopened.saveDoc(id, [{ text: 'after cleanup' }]), /DOC_DELETED/)
  assert.equal((await reopened.listDocumentConflicts()).length, 2)
  const freshId = randomUUID()
  await reopened.saveDoc(freshId, [{ text: 'staged import' }])
  assert.deepEqual(await reopened.loadDoc(freshId), [{ text: 'staged import' }])
}))

test('concurrent parent deletion cannot commit orphaned or cyclic page metadata', async () => temporary(async store => {
  const parentId = randomUUID(), childId = randomUUID(), base = { pages: { [parentId]: page(parentId) }, settings: {} }
  await store.saveMeta(base)
  const withChild = { ...base, pages: { ...base.pages, [childId]: { ...page(childId), parentId } } }
  await store.saveMeta({ ...base, pages: {} }, base)
  await assert.rejects(store.saveMeta(withChild, base), /CONCURRENT_CHANGE/)
  assert.deepEqual((await store.loadMeta()).pages, {})
  await assert.rejects(store.saveMeta({ ...base, pages: { [parentId]: { ...page(parentId), parentId: childId }, [childId]: { ...page(childId), parentId } } }), /CONCURRENT_CHANGE/)
  assert.deepEqual((await store.loadMeta()).pages, {})
}))

test('home tab links open locally and reject extra authority or path fields', () => {
  assert.deepEqual(parseDeepLink("workspace://home"), { type: 'home' })
  assert.equal(parseDeepLink("workspace://home/other"), null)
  assert.equal(parseDeepLink("workspace://user@home"), null)
})

test('deep links de atalhos: daily, tasks, graph, productivity, search e new com validação estrita', () => {
  assert.deepEqual(parseDeepLink("workspace://daily/2026-10-08"), { type: 'daily', date: '2026-10-08' })
  assert.deepEqual(parseDeepLink("workspace://tasks"), { type: 'tasks' })
  assert.deepEqual(parseDeepLink("workspace://graph/"), { type: 'graph' })
  assert.deepEqual(parseDeepLink("workspace://productivity"), { type: 'productivity' })
  assert.deepEqual(parseDeepLink("workspace://search?q=reuni%C3%A3o%20semanal"), { type: 'search', q: 'reunião semanal' })
  assert.deepEqual(parseDeepLink("workspace://new?title=Ideia"), { type: 'new', title: 'Ideia' })
  assert.deepEqual(parseDeepLink("workspace://new"), { type: 'new', title: '' })
  const refused = [
    "workspace://daily/2026-02-30", "workspace://daily/2026-13-01", "workspace://daily/2026-1-1", "workspace://daily", "workspace://daily/2026-10-08/x", "workspace://daily/2026-10-08?a=1", "workspace://daily/2026-10-08#x",
    "workspace://tasks/extra", "workspace://tasks?x=1", "workspace://graph#x", "workspace://user@tasks", "workspace://tasks:99",
    "workspace://search", "workspace://search?q=", "workspace://search?q=%20", "workspace://search?q=a&x=1", "workspace://search?q=a&q=b", `workspace://search?q=${'a'.repeat(201)}`, "workspace://search?q=a%00b", "workspace://search/x?q=a",
    "workspace://new?title=a&x=1", "workspace://new?x=1", "workspace://new/extra?title=a", "workspace://new?title=a%0Ab", `workspace://new?title=${'a'.repeat(201)}`,
    "workspace://delete/all", "workspace://unknown", "workspace://capture/../x", 'file:///etc/passwd', '', null, undefined, 42,
  ]
  for (const url of refused) assert.equal(parseDeepLink(url), null, String(url).slice(0, 60))
})

test('local API keeps the free canvas intact: opaque summary, merge on replace, CANVAS_PROTECTED on scene writes', async () => temporary(async store => {
  const id = randomUUID(), meta = { pages: { [id]: page(id) }, settings: { locale: 'en-US' } }
  await store.saveMeta(meta)
  const scene = { id: 'canvas-1', type: 'canvas', props: { version: 1, objects: [{ id: 'o1', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'CENA-SECRETA', color: 'yellow' }, { id: 'o2', type: 'note', x: 5, y: 5, w: 10, h: 10, text: 'dois', color: 'blue' }] }, children: [] }
  await store.saveDoc(id, [scene])
  const service = await startLocalApi({ storage: store, token: 'canvas-token', onChange: () => {} })
  const headers = { Authorization: 'Bearer canvas-token', 'Content-Type': 'application/json' }
  const url = `${service.url}/v1/pages/${id}/blocks`
  const read = async () => { const response = await fetch(url, { headers }); return { tag: response.headers.get('etag'), text: await response.text() } }
  const put = async (tag, blocks) => { const response = await fetch(url, { method: 'PUT', headers: { ...headers, 'If-Match': tag }, body: JSON.stringify(blocks) }); return { status: response.status, body: await response.text() } }
  try {
    const first = await read(), results = JSON.parse(first.text).results
    assert.ok(!first.text.includes('CENA-SECRETA'), 'the scene must not be dumped')
    assert.equal(results[0].type, 'canvas'); assert.equal(results[0].props.opaque, true); assert.equal(results[0].props.objects, 2)
    // Empty list: the canvas survives.
    assert.equal((await put(first.tag, [])).status, 200)
    assert.deepEqual(await store.loadDoc(id), [scene])
    // Text block added next to the placeholder: canvas kept, text saved.
    const second = await read()
    const placeholder = JSON.parse(second.text).results[0]
    const text = { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'olá', styles: {} }], children: [] }
    assert.equal((await put(second.tag, [placeholder, text])).status, 200)
    assert.deepEqual(await store.loadDoc(id), [scene, text])
    // Writing a scene through the API is refused.
    const third = await read()
    const forged = await put(third.tag, [{ ...scene, props: { version: 1, objects: [] } }])
    assert.equal(forged.status, 409); assert.equal(JSON.parse(forged.body).code, 'CANVAS_PROTECTED')
    // A stale revision (canvas changed after the read) is refused instead of overwriting.
    const stale = await read(), stalePlaceholder = JSON.parse(stale.text).results[0]
    const changed = { ...scene, props: { ...scene.props, objects: [...scene.props.objects, { id: 'o3', type: 'note', x: 1, y: 1, w: 1, h: 1, text: 'novo', color: 'red' }] } }
    await store.saveDoc(id, [changed, text], { userEdit: true })
    const lost = await put(stale.tag, [stalePlaceholder])
    assert.ok(lost.status === 409 || lost.status === 412)
    assert.deepEqual(await store.loadDoc(id), [changed, text])
    // Concurrent replaces: never a corrupted scene.
    const base = await read(), holder = JSON.parse(base.text).results
    const results2 = await Promise.all([1, 2, 3].map(n => put(base.tag, [holder[0], { ...text, id: 'c' + n }])))
    assert.ok(results2.filter(item => item.status === 200).length >= 1)
    const finalDoc = await store.loadDoc(id)
    assert.deepEqual(finalDoc.find(block => block.type === 'canvas'), changed)
  } finally { await service.close() }
}))

test('storage.editDocument refuses a write that would change or drop the canvas block', async () => temporary(async store => {
  const id = randomUUID()
  await store.saveMeta({ pages: { [id]: page(id) }, settings: { locale: 'en-US' } })
  const scene = { id: 'canvas-1', type: 'canvas', props: { version: 1, objects: [] }, children: [] }
  await store.saveDoc(id, [scene])
  await assert.rejects(store.editDocument(id, [], JSON.stringify([scene])), /CANVAS_PROTECTED/)
  assert.deepEqual(await store.loadDoc(id), [scene])
}))
