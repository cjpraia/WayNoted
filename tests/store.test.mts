import COMPAT from '../shared/compatibility.ts'
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const history = new Map<string, any[]>()
let savedMeta: any = null, failWrite = false, loads = 0
let exported: any = null
let failDocWrite = false, failMetaAfterDoc = false
const native = {
  async loadMeta() { loads++; await new Promise(resolve => setTimeout(resolve, 1)); return null },
  async saveMeta(meta: unknown) { if (failWrite) throw new Error('Disco cheio'); savedMeta = structuredClone(meta) },
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[], options?: { checkpoint?: boolean }) {
    if (failDocWrite) throw new Error('Document disk full')
    if (options?.checkpoint && documents.has(id)) history.set(id, [{ id: 'before-restore', savedAt: Date.now(), blocks: structuredClone(documents.get(id)) }, ...(history.get(id) ?? [])])
    documents.set(id, structuredClone(doc))
    if (failMetaAfterDoc) { failMetaAfterDoc = false; failWrite = true }
  },
  async listDocVersions(id: string) { return structuredClone(history.get(id) ?? []) },
  async saveDocVersions(id: string, versions: any[]) { history.set(id, structuredClone(versions)) },
  async deleteDoc(id: string) { documents.delete(id) },
  async exportFile(_name: string, content: string) { exported = JSON.parse(content); return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, api, getState, selectors } = await import('../src/store.ts')
const { convertProperty, createOption, deleteOption, deleteProperty, duplicateProperty } = await import('../src/components/database/schemaOps.ts')

test('initialization is idempotent and initial content is indexed', async () => {
  await Promise.all([actions.init(), actions.init()])
  assert.equal(loads, 1)
  assert.equal(Object.keys(getState().pages).length, 1)
  assert.equal(getState().settings.locale, 'en-US')
  assert.equal(savedMeta.settings.locale, 'en-US')
  assert.equal(selectors.search('block').length, 1)
  assert.equal(Object.values(getState().pages)[0].title, 'Getting started')
  assert.match(JSON.stringify([...documents.values()]), /Welcome to/)
})

test('nested duplicate references the copied children and leaves the original unchanged', async () => {
  const root = actions.createPage(null, { title: 'Original' }), child = actions.createDatabase(root)
  const row = actions.createRow(child, {}, { title: 'Linha' })
  await native.saveDoc(root, [{ id: 'block', type: 'page', props: { pageId: child } }])
  await native.saveDoc(child, [])
  await native.saveDoc(row, [{ type: 'paragraph', content: 'Dados locais' }])
  const copy = await actions.duplicatePage(root)
  assert.ok(copy)
  const copiedDatabase = selectors.children(copy)[0]
  assert.notEqual(copiedDatabase.id, child)
  assert.equal((documents.get(copy)![0] as any).props.pageId, copiedDatabase.id)
  assert.equal((documents.get(root)![0] as any).props.pageId, child)
  assert.equal(selectors.children(copiedDatabase.id)[0].title, 'Linha')
  actions.movePage(copy, copiedDatabase.id)
  assert.equal(selectors.page(copy)?.parentId, null)
})

test('removing owned page blocks moves their children to trash, while reorder and links retain their sources', async () => {
  const owner = actions.createPage(null, { title: 'Owner' })
  const db = actions.createDatabase(owner, 'table', { blockOwnerId: owner })
  const external = actions.createDatabase(null)
  const sidebarChild = actions.createPage(owner, { title: 'Sidebar child' })
  const owned = { id: 'owned-db', type: 'page', props: { pageId: db, ownership: 'owned' } }
  const linked = { id: 'linked-db', type: 'page', props: { pageId: external, ownership: 'linked' } }
  await api.saveDoc(owner, [owned, linked, { id: 'legacy-link', type: 'page', props: { pageId: sidebarChild } }, { id: 'second-legacy-link', type: 'page', props: { pageId: sidebarChild, ownership: 'linked' } }])
  await api.saveDoc(owner, [{ id: 'list', type: 'bulletListItem', children: [owned] }, linked])
  assert.equal(selectors.page(db)?.trashed, false)
  await api.saveDoc(owner, [{ id: 'list', type: 'bulletListItem', children: [owned, { ...owned, id: 'second-reference' }] }])
  assert.equal(selectors.page(external)?.trashed, false)
  assert.equal(selectors.page(sidebarChild)?.trashed, false)
  await api.saveDoc(owner, [])
  assert.equal(selectors.children(owner).some(page => page.id === db), false)
  assert.equal(selectors.trash().some(page => page.id === db), true)
  assert.equal(savedMeta.pages[db].removedByBlock.ownerId, owner)
  await api.saveDoc(owner, [owned])
  assert.equal(selectors.page(db)?.trashed, false)
  await api.saveDoc(owner, [])
  actions.restorePage(db)
  await api.saveDoc(owner, [])
  await actions.recoverRemovedDatabaseBlocks(owner, [])
  assert.equal(selectors.page(db)?.trashed, false)
})

test('quick block deletion and retry after metadata failure retain reversible ownership changes', async () => {
  const owner = actions.createPage(null)
  const quick = actions.createDatabase(owner, 'table', { blockOwnerId: owner })
  await api.saveDoc(owner, [])
  assert.equal(selectors.page(quick)?.trashed, true)
  const legacy = actions.createDatabase(owner)
  await api.saveDoc(owner, [{ id: 'legacy', type: 'page', props: { pageId: legacy } }])
  failDocWrite = true
  await assert.rejects(api.saveDoc(owner, []), /Document disk full/)
  assert.equal(selectors.page(legacy)?.trashed, false)
  failDocWrite = false
  failMetaAfterDoc = true
  await assert.rejects(api.saveDoc(owner, []), /Disco cheio/)
  assert.equal(selectors.page(legacy)?.trashed, true)
  assert.deepEqual(documents.get(owner), [])
  failWrite = false
  await api.saveDoc(owner, [])
  assert.equal(savedMeta.pages[legacy].trashed, true)
})

test('legacy database repair requires historical owned blocks and excludes linked, manual and conflict candidates', async () => {
  const owner = actions.createPage(null)
  const legacy = actions.createDatabase(owner), sidebar = actions.createDatabase(owner), linked = actions.createDatabase(owner), rejected = actions.createDatabase(owner)
  history.set(owner, [
    { id: 'candidate', savedAt: 1, reason: 'conflict', blocks: [{ id: 'rejected', type: 'page', props: { pageId: rejected } }] },
    { id: 'committed', savedAt: 2, blocks: [{ id: 'old', type: 'page', props: { pageId: legacy } }, { id: 'link', type: 'page', props: { pageId: linked, ownership: 'linked' } }] },
  ])
  await actions.recoverRemovedDatabaseBlocks(owner, [])
  assert.equal(selectors.page(legacy)?.trashed, true)
  for (const id of [sidebar, linked, rejected]) assert.equal(selectors.page(id)?.trashed, false)
  actions.restorePage(legacy)
  await actions.recoverRemovedDatabaseBlocks(owner, [])
  assert.equal(selectors.page(legacy)?.trashed, false)
  assert.ok(documents.size)
})

test('moving a nested owned database saves destination and transfers parent before source removal', async () => {
  const source = actions.createPage(null), target = actions.createPage(null)
  const child = actions.createDatabase(source, 'table', { blockOwnerId: source })
  const blocks = [{ id: 'list', type: 'bulletListItem', children: [{ id: 'db', type: 'page', props: { pageId: child, ownership: 'owned' } }] }]
  await api.saveDoc(source, blocks)
  await actions.appendPageBlocks(target, blocks)
  await actions.reparentOwnedPageBlocks(source, target, blocks)
  await api.saveDoc(source, [])
  assert.equal(selectors.page(child)?.parentId, target)
  assert.equal(selectors.page(child)?.blockOwnerId, target)
  assert.equal(selectors.page(child)?.trashed, false)
  assert.equal(selectors.children(target).some(page => page.id === child), true)
  assert.ok((documents.get(target) as unknown[]).length)
})

test('moving and duplicating references preserves independent legacy and detached pages', async () => {
  const source = actions.createPage(null), target = actions.createPage(null)
  const legacy = actions.createPage(source)
  const detached = actions.createDatabase(source, 'table', { blockOwnerId: null })
  const linked = actions.createPage(source, { blockOwnerId: source })
  const blocks = [
    { id: 'legacy-reference', type: 'page', props: { pageId: legacy } },
    { id: 'detached-reference', type: 'page', props: { pageId: detached, ownership: 'owned' } },
    { id: 'linked-reference', type: 'page', props: { pageId: linked, ownership: 'linked' } },
  ]
  await actions.reparentOwnedPageBlocks(source, target, blocks)
  const copies = await actions.duplicateOwnedPageBlocks(source, blocks) as any[]
  for (const [index, id] of [legacy, detached, linked].entries()) {
    assert.equal(selectors.page(id)?.parentId, source)
    assert.equal(copies[index].props.pageId, id)
  }
})

test('undo and redo page conversions restore child ownership together with the document', async () => {
  for (const linked of [false, true]) {
    const source = actions.createPage(null), other = actions.createPage(null)
    const child = actions.createDatabase(source, 'table', { blockOwnerId: source })
    const before = [{ id: 'original', type: 'bulletListItem', children: [{ id: 'nested', type: 'page', props: { pageId: child, ownership: 'owned' } }] }]
    await api.saveDoc(source, before)
    const destination = actions.createPage(linked ? other : source, linked ? {} : { blockOwnerId: source })
    const after = [{ id: 'original', type: 'page', props: { pageId: destination, ownership: linked ? 'linked' : 'owned' }, children: [] }]
    await actions.appendPageBlocks(destination, before)
    const moved = await actions.reparentOwnedPageBlocks(source, destination, before)
    actions.updatePage(destination, { blockConversion: { sourceId: source, childIds: moved } }, false)
    await api.saveDoc(source, after)
    assert.equal(selectors.isLive(child), true)
    await api.saveDoc(source, before)
    assert.equal(selectors.page(child)?.parentId, source)
    assert.equal(selectors.isLive(child), true)
    assert.equal(selectors.page(destination)?.trashed, !linked)
    await api.saveDoc(source, after)
    assert.equal(selectors.page(child)?.parentId, destination)
    assert.equal(selectors.page(child)?.blockOwnerId, destination)
    assert.equal(selectors.isLive(child), true)
    assert.equal(selectors.isLive(destination), true)
    // A manual move cancels automatic ownership restoration.
    actions.movePage(child, other)
    await api.saveDoc(source, before)
    assert.equal(selectors.page(child)?.parentId, other)
    assert.equal(selectors.page(child)?.blockOwnerId, null)
  }
})

test('block duplication copies owned databases while sidebar duplication remains an independent child', async () => {
  const owner = actions.createPage(null), database = actions.createDatabase(owner, 'table', { blockOwnerId: owner })
  const row = actions.createRow(database, {}, { title: 'Original row' })
  const block = { id: 'original-block', type: 'page', props: { pageId: database, ownership: 'owned' } }
  await api.saveDoc(owner, [block])
  await api.saveDoc(row, [{ type: 'paragraph', content: 'Row body' }])
  const copied = await actions.duplicateOwnedPageBlocks(owner, [block]) as any[]
  const copiedId = copied[0].props.pageId
  assert.notEqual(copiedId, database)
  assert.notEqual(copied[0].id, block.id)
  assert.equal(selectors.rows(copiedId)[0].title, 'Original row')
  const sidebarCopy = await actions.duplicatePage(database)
  await api.saveDoc(owner, [block, ...copied])
  assert.equal(selectors.page(sidebarCopy!)?.trashed, false)
  assert.equal(selectors.page(sidebarCopy!)?.blockOwnerId, null)
  await api.saveDoc(owner, [block])
  assert.equal(selectors.page(copiedId)?.trashed, true)
  assert.equal(selectors.page(database)?.trashed, false)
})

test('new slash blocks remain searchable after saving and native indexing matches renderer text', async () => {
  const { createRequire } = await import('node:module')
  const { indexBlocks } = createRequire(import.meta.url)('../electron/content-index.cjs')
  const { blocksToText } = await import('../src/components/page/util.ts')
  const owner = actions.createPage(null)
  const blocks = [
    { type: 'tabs', props: { tabsJson: JSON.stringify([{ title: 'Release checklist', body: 'Review accessibility' }]) } },
    { type: 'aiMeetingNotes', props: { context: 'Budget meeting', output: 'Schedule prototype', prompt: 'Summarize decisions' } },
    { type: 'mermaid', props: { source: 'sequenceDiagram\nAlice->>Bob: Request approval' } },
    { type: 'htmlSandbox', props: { html: '<p>Local documentation</p>' } },
    { type: 'externalReference', props: { title: 'Design reference', url: 'https://example.com/mockup' } },
  ]
  await api.saveDoc(owner, blocks)
  for (const query of ['accessibility', 'Budget meeting', 'prototype', 'approval', 'documentation', 'mockup']) assert.ok(selectors.search(query).some(page => page.id === owner), query)
  assert.equal(indexBlocks(blocks).bodyText, blocksToText(blocks))
})

test('failed metadata save stays dirty and retry persists current edits', async () => {
  const page = actions.createPage(null, { title: 'Antes' })
  failWrite = true
  await assert.rejects(actions.flushMeta(), /Disco cheio/)
  assert.equal(getState().saveError, 'Disco cheio')
  actions.updatePage(page, { title: 'Depois' })
  failWrite = false
  await actions.flushMeta()
  assert.equal(savedMeta.pages[page].title, 'Depois')
  assert.equal(getState().saveError, null)
})

test('tab histories are independent and unavailable pages never open through history', async () => {
  const a = actions.createPage(null, { title: 'A' }), b = actions.createPage(null, { title: 'B' })
  actions.openPage(a)
  const first = getState().settings.activeTabId!
  actions.openInNewTab({ type: 'page', id: b })
  const second = getState().settings.activeTabId!
  actions.navigate({ type: 'home' })
  actions.activateTab(first)
  assert.deepEqual(getState().route, { type: 'page', id: a })
  actions.activateTab(second)
  actions.goBack()
  assert.deepEqual(getState().route, { type: 'page', id: b })
  actions.trashPage(b)
  actions.goBack()
  assert.notDeepEqual(getState().route, { type: 'page', id: b })
  actions.closeTab(second)
  assert.equal(getState().settings.activeTabId, first)
  await actions.flushMeta()
})

test('backup import remaps pages without replacing existing notes', async () => {
  const id = Object.keys(getState().pages)[0]
  const originalCount = Object.keys(getState().pages).length
  const copiedCount = await actions.importBackup({ format: COMPAT.record011, version: 1,
    meta: { pages: { [id]: getState().pages[id] }, settings: getState().settings }, documents: { [id]: documents.get(id) } })
  assert.equal(copiedCount, 1)
  assert.equal(Object.keys(getState().pages).length, originalCount + 1)
  assert.ok(getState().pages[id])
})

test('database lock protects structure but permits row data, and peek never mounts the same editor twice', async () => {
  const db = actions.createDatabase(null)
  const anotherView = actions.addView(db, 'board')!
  const property = selectors.database(db)!.properties.find(p => p.type === 'multiSelect')!
  const view = selectors.database(db)!.views[0]
  actions.updatePage(db, { locked: true })
  const row = actions.createRow(db, {}, { title: 'Registro' })
  actions.setProp(row, property.id, ['value'])
  assert.deepEqual(selectors.page(row)?.props?.[property.id], ['value'])
  actions.updateView(db, view.id, { name: 'Não pode mudar' })
  assert.notEqual(selectors.database(db)?.views[0].name, 'Não pode mudar')
  actions.activateView(db, anotherView)
  assert.equal(selectors.database(db)?.activeViewId, anotherView)
  deleteProperty(db, property.id)
  deleteOption(db, property.id, 'value')
  convertProperty(db, property.id, 'number')
  assert.equal(duplicateProperty(db, property.id), null)
  assert.equal(createOption(db, property.id, 'Novo'), null)
  assert.deepEqual(selectors.page(row)?.props?.[property.id], ['value'])
  assert.equal(selectors.database(db)?.properties.find(p => p.id === property.id)?.type, 'multiSelect')
  actions.openPage(db)
  actions.openPeek(row)
  assert.equal(getState().peekPageId, row)
  assert.deepEqual(getState().route, { type: 'page', id: db })
  actions.openPage(row)
  actions.openPeek(row)
  assert.equal(getState().peekPageId, null)
  await actions.flushMeta()
})

test('restore and backup preserve versions and remap their local page links', async () => {
  const source = actions.createPage(null, { title: 'Versões' }), target = actions.createPage(null, { title: 'Destino' })
  const old = [{ type: 'page', props: { pageId: target } }]
  await api.saveDoc(source, [{ type: 'paragraph', content: 'Atual' }])
  const revision = getState().docRevision
  await actions.restoreDocVersion(source, { id: 'old', savedAt: 10, blocks: old })
  assert.equal(getState().docRevision, revision + 1)
  assert.equal(history.get(source)?.[0].blocks[0].content, 'Atual')
  assert.equal(selectors.backlinks(target)[0].id, source)
  await actions.exportBackup()
  assert.equal(exported.versions[source][0].blocks[0].content, 'Atual')
  history.set(source, [{ id: 'linked', savedAt: 11, blocks: old }])
  await actions.exportBackup()
  const originalIds = new Set(Object.keys(getState().pages))
  await actions.importBackup(exported)
  const copies = Object.values(getState().pages).filter(page => !originalIds.has(page.id))
  const copiedSource = copies.find(page => page.title === 'Versões')!, copiedTarget = copies.find(page => page.title === 'Destino')!
  assert.equal(history.get(copiedSource.id)?.[0].blocks[0].props.pageId, copiedTarget.id)
  assert.equal(selectors.backlinks(copiedTarget.id)[0].id, copiedSource.id)
})

test('locked pages protect all content controls while comments and unlock remain available', async () => {
  const id = actions.createPage(null, { title: 'Locked', icon: '🔒', props: { value: 1 } })
  actions.updatePage(id, { locked: true })
  actions.updatePage(id, { title: 'Overwritten', cover: 'red', props: { value: 2 } })
  assert.equal(selectors.page(id)?.title, 'Locked'); assert.deepEqual(selectors.page(id)?.props, { value: 1 })
  await assert.rejects(actions.appendPageBlocks(id, [{ content: 'blocked' }]), /locked/)
  actions.toggleFavorite(id); assert.equal(selectors.page(id)?.favorite, true)
  actions.updatePage(id, { locked: false, title: 'Unlocked' }); assert.equal(selectors.page(id)?.title, 'Unlocked')
  await actions.flushMeta()
})

test('suggestions accept one literal match, reject independently and preserve metadata on restore', async () => {
  const id = actions.createPage(null, { title: 'Review', icon: '📝' })
  await api.saveDoc(id, [{ id: 'target-block', type: 'paragraph', content: [{ type: 'text', text: 'Original sentence', styles: { bold: true } }] }])
  actions.updatePage(id, { comments: [{ id: 'suggestion', author: 'You', body: 'Review', createdAt: 1, updatedAt: 1, resolved: false, blockId: 'target-block', suggestion: { originalText: 'Original', replacementText: 'Reviewed', status: 'open' } }] })
  await actions.applyPageSuggestion(id, 'suggestion', true)
  assert.equal((documents.get(id)![0] as any).content[0].text, 'Reviewed sentence')
  assert.equal(selectors.page(id)?.comments?.[0].suggestion?.status, 'accepted')
  const snapshot = { ...selectors.page(id)!, title: 'Old title', icon: '📚', props: { amount: 42 } }
  await actions.restoreDocVersion(id, { id: 'metadata', savedAt: 1, page: snapshot, blocks: [] })
  assert.equal(selectors.page(id)?.title, 'Old title'); assert.equal(selectors.page(id)?.icon, '📚'); assert.equal(selectors.page(id)?.props?.amount, 42)
})

test('synced content stays searchable after edits and backup import remaps shared blocks and reminders', async () => {
  const id = actions.createPage(null, { title: 'Shared' })
  const syncedId = actions.createSyncedBlock(id, [{ type: 'paragraph', content: 'First shared text' }])
  await api.saveDoc(id, [{ id: 'sync-block', type: 'syncedBlock', props: { syncedId } }])
  assert.ok(selectors.search('First shared').some(page => page.id === id))
  actions.updateSyncedBlock(syncedId, [{ type: 'paragraph', content: 'Updated shared text' }])
  assert.ok(selectors.search('Updated shared').some(page => page.id === id))
  actions.scheduleReminder(id, Date.now() + 10000, 'Remember')
  await actions.exportBackup()
  const oldIds = new Set(Object.keys(getState().pages))
  await actions.importBackup(exported)
  const copy = Object.values(getState().pages).find(page => page.title === 'Shared' && !oldIds.has(page.id))!
  const recordId = (documents.get(copy.id)![0] as any).props.syncedId
  assert.notEqual(recordId, syncedId); assert.equal(selectors.syncedBlock(recordId)?.sourcePageId, copy.id)
  assert.ok(Object.values(getState().notifications).some(item => item.pageId === copy.id))
})

test('rich database templates initialize before opening, keep retry state and never overwrite an existing body', async () => {
  const db = actions.createDatabase(null, 'table', { title: 'Template database' })
  actions.updateSchema(db, schema => ({ ...schema, defaultTemplateId: 'rich', templates: [{ id: 'rich', name: 'Rich', title: 'Initial title', props: {}, bodyBlocks: [{ id: 'source-block', type: 'paragraph', content: [{ type: 'text', text: 'Reusable body', styles: { bold: true } }] }] }] }))
  failDocWrite = true
  const row = actions.createRow(db)
  await assert.rejects(api.loadDoc(row), /Document disk full/)
  assert.ok(selectors.page(row)?.pendingTemplateBlocks)
  await actions.flushMeta()
  assert.ok(savedMeta.pages[row].pendingTemplateBlocks)
  failDocWrite = false
  const blocks = await api.loadDoc(row) as any[]
  assert.equal(blocks[0].content[0].text, 'Reusable body')
  assert.equal(blocks[0].content[0].styles.bold, true)
  assert.notEqual(blocks[0].id, 'source-block')
  assert.equal(selectors.page(row)?.pendingTemplateBlocks, undefined)
  actions.updatePage(row, { pendingTemplateBlocks: [{ content: 'Must not overwrite' }] })
  assert.deepEqual(await api.loadDoc(row), blocks)
  await actions.flushAll()
})

test('attachment retry after metadata failure is idempotent and conflicting IDs are rejected', async () => {
  const id = actions.createPage(null, { title: 'Append retry' }), blocks = [{ id: 'stable-payload', type: 'paragraph', content: 'Generated text' }]
  await actions.flushAll()
  failMetaAfterDoc = true
  await assert.rejects(actions.appendPageBlocks(id, blocks), /Disco cheio/)
  assert.equal(documents.get(id)?.length, 1)
  failWrite = false
  await actions.appendPageBlocks(id, blocks)
  assert.deepEqual(documents.get(id), blocks)
  await assert.rejects(actions.appendPageBlocks(id, [{ ...blocks[0], content: 'Different content' }]), /different content/)
})

test('synced block edits update backlinks while retaining direct page links', async () => {
  const source = actions.createPage(null), first = actions.createPage(null), next = actions.createPage(null), direct = actions.createPage(null)
  const syncedId = actions.createSyncedBlock(source, [{ type: 'page', props: { pageId: first } }])
  await api.saveDoc(source, [{ type: 'syncedBlock', props: { syncedId } }, { type: 'page', props: { pageId: direct } }])
  assert.ok(selectors.backlinks(first).some(page => page.id === source))
  actions.updateSyncedBlock(syncedId, [{ type: 'page', props: { pageId: next } }])
  assert.equal(selectors.backlinks(first).some(page => page.id === source), false)
  assert.ok(selectors.backlinks(next).some(page => page.id === source))
  assert.ok(selectors.backlinks(direct).some(page => page.id === source))
  await actions.flushMeta()
})

test('custom page layouts survive metadata saves, backup and remapping of related databases', async () => {
  const db = actions.createDatabase(null, 'board', { title: 'Layout source' }), related = actions.createDatabase(null, 'table', { title: 'Related layout' })
  const schema = selectors.database(db)!, visible = schema.properties.filter(property => property.type !== 'title')
  const layout = { pinnedPropertyIds: [visible[0].id], detailsPropertyIds: [visible[1].id], fullWidth: true, showPropertyIcons: false, tabs: [{ id: 'related-tab', name: 'Relations', databaseId: related, viewId: selectors.database(related)!.views[0].id }] }
  actions.updateSchema(db, schema => ({ ...schema, rowLayout: layout }))
  await actions.flushAll()
  assert.deepEqual(savedMeta.pages[db].database.rowLayout, layout)
  const backup = await actions.backupSnapshot(), before = new Set(Object.keys(getState().pages))
  await actions.importBackup(backup)
  const copies = Object.values(getState().pages).filter(page => !before.has(page.id)), imported = copies.find(page => page.title === 'Layout source')!, relatedCopy = copies.find(page => page.title === 'Related layout')!
  assert.equal(imported.database!.rowLayout!.tabs![0].databaseId, relatedCopy.id)
  assert.deepEqual(imported.database!.rowLayout!.pinnedPropertyIds, layout.pinnedPropertyIds)
})

test('tabs pin, group, close in bulk and reopen without duplicating pages', () => {
  const before = Object.keys(getState().pages).length
  actions.updateSettings({ openTabs: [], activeTabId: undefined })
  actions.openInNewTab({ type: 'home' })
  const first = getState().settings.activeTabId!
  actions.openInNewTab({ type: 'home' })
  const second = getState().settings.activeTabId!
  actions.openInNewTab({ type: 'home' })
  const third = getState().settings.activeTabId!
  actions.pinTab(second)
  assert.equal(getState().settings.openTabs![0].id, second)
  assert.equal(getState().settings.openTabs![0].pinned, true)
  actions.closeTabs(first, 'other')
  assert.deepEqual(getState().settings.openTabs!.map(tab => tab.id), [second, first])
  assert.equal(getState().settings.activeTabId, first)
  actions.reopenTab()
  assert.equal(getState().settings.openTabs!.length, 3)
  const reopened = getState().settings.activeTabId!
  assert.notEqual(reopened, third)
  const group = { id: 'group', name: 'Projetos' }
  actions.groupTab(first, group)
  actions.groupTab(reopened, group)
  assert.deepEqual(getState().settings.openTabs!.slice(-2).map(tab => tab.group), [group, group])
  actions.closeTabs(reopened, 'left')
  assert.deepEqual(getState().settings.openTabs!.map(tab => tab.id), [second, reopened])
  actions.closeTabs(second, 'right')
  assert.equal(getState().settings.openTabs!.length, 1)
  actions.closeTab(second)
  assert.equal(getState().settings.openTabs!.length, 1)
  assert.deepEqual(getState().route, { type: 'home' })
  actions.reopenTab()
  assert.equal(getState().settings.openTabs![0].pinned, true)
  assert.equal(Object.keys(getState().pages).length, before)
})
