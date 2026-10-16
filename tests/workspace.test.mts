import COMPAT from '../shared/compatibility.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneDocument, defaultSettings, documentLinks, foldSearch, remapReferences, validateBackup, validateMeta } from '../src/workspace.ts'

const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002'
const page = (id: string, parentId: string | null = null) => ({ id, parentId, title: 'Projeto', text: '', order: 0, createdAt: 1, updatedAt: 1, coverPosition: 50 })

test('metadata validates legacy optional fields and rejects broken hierarchies without changing input', () => {
  const raw = { pages: { [a]: page(a), [b]: page(b, a) }, settings: { ...defaultSettings } }
  assert.equal(validateMeta(raw).pages[b].locked, false)
  assert.equal(raw.pages[b].parentId, a)
  assert.throws(() => validateMeta({ ...raw, pages: { [b]: page(b, a) } }), /pai ausente/)
  assert.throws(() => validateMeta({ ...raw, pages: { [a]: page(a, b), [b]: page(b, a) } }), /circular/)
  assert.throws(() => validateMeta({ ...raw, pages: { [a]: { ...page(a), id: b } } }), /inválidos/)
})

test('incomplete or foreign backups fail before import', () => {
  const raw = { format: COMPAT.record011, version: 1, meta: { pages: { [a]: page(a) }, settings: defaultSettings }, documents: {} }
  assert.throws(() => validateBackup(raw), /não contém/)
  assert.throws(() => validateBackup({ ...raw, version: 2 }), /versão 1/)
  assert.deepEqual(validateBackup({ ...raw, documents: { [a]: [] } }).documents[a], [])
})

test('copy remaps nested databases, page mentions and relation values while preserving prose and external references', () => {
  const map = { [a]: 'copy-a', [b]: 'copy-b' }
  const input = { pageId: b, related: [a, 'external'], href: `workspace://page/${a}`, title: `Texto ${a}`, schema: { relationDatabaseId: a } }
  const output = remapReferences(input, map)
  assert.equal(output.pageId, 'copy-b')
  assert.deepEqual(output.related, ['copy-a', 'external'])
  assert.equal(output.href, 'workspace://page/copy-a')
  assert.equal(output.title, input.title)
  assert.equal(output.schema.relationDatabaseId, 'copy-a')
  assert.equal(input.pageId, b)
  const blocks = [{ id: 'old', type: 'page', props: { pageId: b }, children: [{ id: 'child', type: 'paragraph' }] }]
  const copied = cloneDocument(blocks, map) as typeof blocks
  assert.notEqual(copied[0].id, 'old')
  assert.notEqual(copied[0].children[0].id, 'child')
  assert.equal(copied[0].props.pageId, 'copy-b')
  assert.equal(blocks[0].id, 'old')
})

test('Portuguese search folds accents and case', () => {
  assert.equal(foldSearch('AÇÃO • Reunião'), 'acao • reuniao')
})

test('invalid database schemas and property values fail before workspace activation', () => {
  const database = { properties: [{ id: 'title', type: 'title', name: 'Nome' }], views: [{ id: 'table', type: 'table', name: 'Tabela', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'table' }
  const raw = { pages: { [a]: { ...page(a), database } }, settings: defaultSettings }
  assert.ok(validateMeta(raw).pages[a].database)
  const invalids = [
    { properties: [null], views: [null], activeViewId: 'broken' },
    { ...database, activeViewId: 'missing' },
    { ...database, properties: [{ id: 'text', type: 'text', name: 'No title' }] },
    { ...database, views: [{ ...database.views[0], filters: [null] }] },
    { ...database, views: [{ ...database.views[0], widths: { title: -1 } }] },
  ]
  for (const invalid of invalids) assert.throws(() => validateMeta({ ...raw, pages: { [a]: { ...page(a), database: invalid } } }), /esquema/)
  const linked = { properties: [], views: [{ ...database.views[0], filters: [{ id: 'filter', propertyId: 'title', op: 'contains', value: 'a' }], sorts: [{ propertyId: 'title', direction: 'asc' }] }], activeViewId: 'table', linkedSourceId: a }
  const linkedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const linkedMeta = validateMeta({ pages: { [a]: { ...page(a), database }, [linkedId]: { ...page(linkedId), database: linked } }, settings: defaultSettings })
  assert.deepEqual(linkedMeta.pages[linkedId].database, linked)
  assert.throws(() => validateMeta({ ...raw, pages: { [a]: { ...page(a), database: { ...linked, linkedSourceId: 'invalid' } } } }), /esquema/)
  assert.throws(() => validateMeta({ ...raw, pages: { [a]: { ...page(a), props: { broken: { unknown: true } } } } }), /propriedades inválidos/)
})

test('backup validation preserves version bodies and rejects invalid history', () => {
  const version = { id: 'version-id', savedAt: 123, blocks: [{ type: 'paragraph', content: 'Antes' }] }
  const backup = { format: COMPAT.record011, version: 1, meta: { pages: { [a]: page(a) }, settings: defaultSettings }, documents: { [a]: [] }, versions: { [a]: [version] } }
  assert.deepEqual(validateBackup(backup).versions?.[a], [version])
  assert.throws(() => validateBackup({ ...backup, versions: { [a]: [{ ...version, blocks: null }] } }), /versão de conteúdo inválida/)
})

test('backlink index includes nested blocks and local mentions, not prose or external URLs', () => {
  const blocks = [{ props: { pageId: a }, content: [{ type: 'link', href: `workspace://page/${b}` }, { text: a }, { href: `https://example.com/${a}` }], children: [{ props: { pageId: a } }] }]
  assert.deepEqual(documentLinks(blocks), [a, b])
})

test('each database view retains its page opening mode through backup and rejects unknown modes', () => {
  const view = { id: 'table', type: 'table', name: 'Table', filters: [], sorts: [], hidden: [], widths: {} }
  const database = { properties: [{ id: 'title', type: 'title', name: 'Name' }], views: [view], activeViewId: 'table' }
  for (const openPagesIn of ['side', 'center', 'full']) {
    const meta = { pages: { [a]: { ...page(a), database: { ...database, views: [{ ...view, openPagesIn }] } } }, settings: defaultSettings }
    const backup = validateBackup({ format: COMPAT.record011, version: 1, meta, documents: { [a]: [] } })
    assert.equal(backup.meta.pages[a].database?.views[0].openPagesIn, openPagesIn)
  }
  for (const openPagesIn of ['popup', null, {}, 12]) assert.throws(() => validateMeta({ pages: { [a]: { ...page(a), database: { ...database, views: [{ ...view, openPagesIn }] } } }, settings: defaultSettings }), /esquema/)
})

test('table column display options survive persistence and reject malformed values', () => {
  const view = { id: 'table', type: 'table', name: 'Tabela', filters: [], sorts: [], hidden: [], widths: {}, wrappedColumns: ['title'], frozenColumns: 1, showPageIcon: false }
  const database = { properties: [{ id: 'title', type: 'title', name: 'Nome' }], views: [view], activeViewId: 'table' }
  const raw = { pages: { [a]: { ...page(a), database } }, settings: defaultSettings }
  const saved = validateMeta(JSON.parse(JSON.stringify(raw))).pages[a].database!.views[0]
  assert.deepEqual(saved.wrappedColumns, ['title'])
  assert.equal(saved.frozenColumns, 1)
  assert.equal(saved.showPageIcon, false)
  for (const patch of [{ wrappedColumns: 'title' }, { wrappedColumns: [1] }, { showPageIcon: 'false' }]) {
    assert.throws(() => validateMeta({ ...raw, pages: { [a]: { ...page(a), database: { ...database, views: [{ ...view, ...patch }] } } } }), /inválido/)
  }
})

test('pinned tabs and named groups survive workspace persistence', () => {
  const tabs = [{ id: 'pin', route: { type: 'home' }, pinned: true }, { id: 'group-tab', route: { type: 'page', id: a }, group: { id: 'project', name: 'Projetos' } }]
  const raw = { pages: { [a]: page(a) }, settings: { ...defaultSettings, openTabs: tabs, activeTabId: 'pin' } }
  assert.deepEqual(validateMeta(JSON.parse(JSON.stringify(raw))).settings.openTabs, tabs)
})

test('tab of a type collection is restored while the type exists and dropped when it is gone', () => {
  const type = { id: '00000000-0000-4000-8000-0000000000aa', name: 'Livro', icon: null, color: 'blue', description: '', properties: [], template: {}, createdAt: 1, updatedAt: 1 }
  const tabs = [{ id: 't1', route: { type: 'objectType', id: type.id } }, { id: 't2', route: { type: 'objectType', id: 'sumiu' } }]
  const base = { pages: { [a]: page(a) } }
  const kept = validateMeta(JSON.parse(JSON.stringify({ ...base, settings: { ...defaultSettings, objectTypes: [type], openTabs: tabs, activeTabId: 't1' } }))).settings.openTabs
  assert.deepEqual(kept?.map((tab) => tab.id), ['t1'])
  const gone = validateMeta(JSON.parse(JSON.stringify({ ...base, settings: { ...defaultSettings, openTabs: tabs, activeTabId: 't1' } }))).settings.openTabs
  assert.deepEqual(gone ?? [], [])
})


test('new profiles use English while existing and legacy language preferences are preserved', () => {
  assert.equal(defaultSettings.locale, 'en-US')
  const pages = { [a]: page(a) }
  assert.equal(validateMeta({ pages, settings: { ...defaultSettings } }).settings.locale, 'en-US')
  assert.equal(validateMeta({ pages, settings: { ...defaultSettings, locale: 'pt-BR' } }).settings.locale, 'pt-BR')
  assert.equal(validateMeta({ pages, settings: {} }).settings.locale, 'pt-BR', 'metadata without a locale keeps its legacy language')
})
