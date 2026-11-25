import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from '../src/types.ts'
import { normalizeObjectTypes } from '../src/objecttypes/model.ts'
import { indexedLibraryMatches, libraryPages, libraryTypePages, searchLibrary } from '../src/components/library/model.ts'
import { pageTextKey, SearchEngine } from '../src/search/engine.ts'
import { validateMeta } from '../src/workspace.ts'
import { createRequire } from 'node:module'
import { keepLegacyPrivateRoots } from '../src/components/sidebar/privateRoots.ts'

const { parseDeepLink, sanitizeWindowRoute } = createRequire(import.meta.url)('../electron/deep-links.cjs')
const types = normalizeObjectTypes([
  { id: 'resource', name: 'Recurso', properties: [], template: {} },
  { id: 'article', name: 'Artigo', parentTypes: ['resource'], properties: [], template: {} },
  { id: 'project', name: 'Projeto', properties: [], template: {} },
])
const page = (id: string, attributes: Partial<Page> = {}) => ({
  id, title: id, text: '', parentId: null, updatedAt: 0, ...attributes,
} as Page)
const pages = {
  db: page('db', { database: { properties: [], views: [] } as unknown as Page['database'] }),
  row: page('row', { parentId: 'db', title: 'Referência', text: 'Página pública', types: ['article', 'project'] }),
  child: page('child', { parentId: 'row', title: 'Edição' }),
  plain: page('plain', { title: 'Guia', updatedAt: 3 }),
  private: page('private', { title: 'Segredo', passwordLock: { rootId: 'private', hideTitle: true } }),
  secret: page('secret', { parentId: 'private', text: 'Segredo', types: ['resource'] }),
  trash: page('trash', { trashed: true }),
  hidden: page('hidden', { parentId: 'trash' }),
}

test('unified library projects canonical pages, database rows and subpages exactly once', () => {
  const all = libraryPages(pages, types, 'all', [])
  assert.deepEqual(all.map(({ id }) => id), ['plain', 'child', 'db', 'row'])
  assert.strictEqual(all.find(({ id }) => id === 'row'), pages.row)
  assert.strictEqual(pages.row.parentId, 'db')
  assert.deepEqual(pages.row.types, ['article', 'project'])
  assert.deepEqual(libraryPages(pages, types, 'untyped', []).map(({ id }) => id), ['plain', 'child'])
  assert.deepEqual(libraryPages(pages, types, 'recent', ['row', 'private', 'child', 'row', 'missing', 'secret']).map(({ id }) => id), ['row', 'child'])
})

test('library finds accent-insensitive text and indexes search with inherited type filters', () => {
  const all = libraryPages(pages, types, 'all', [])
  const resource = libraryTypePages(pages, types, 'resource')
  assert.deepEqual(searchLibrary(all, 'referencia publica', new Set(), resource).map(({ id }) => id), ['row'])
  assert.deepEqual(searchLibrary(all, 'arquivo sintético', new Set(['row', 'secret']), resource).map(({ id }) => id), ['row'])
  assert.deepEqual(searchLibrary(all, '', new Set(), libraryTypePages(pages, types, 'project')).map(({ id }) => id), ['row'])
  assert.deepEqual(searchLibrary(all, 'segredo', new Set(['secret'])), [])
})

test('library search uses indexed page IDs for attachment text and excludes protected descendants', () => {
  const engine = new SearchEngine()
  engine.sync(pages)
  engine.setRich('row', { key: pageTextKey(pages.row), segments: [{ text: 'Quasar azul', kind: 'pdf' }] })
  engine.setRich('secret', { key: pageTextKey(pages.secret), segments: [{ text: 'Quasar azul', kind: 'pdf' }] })
  const library = libraryPages(pages, types, 'all', [])
  const matches = indexedLibraryMatches(engine, 'quasar azul', pages)
  assert.deepEqual([...matches], ['row'])
  assert.deepEqual(searchLibrary(library, 'quasar azul', matches).map(({ id }) => id), ['row'])
})

test('library route survives normalization, links and detached windows', () => {
  const route = { type: 'library', scope: 'untyped' }
  const openTabs = [{ id: 'library-tab', route }, { id: 'invalid', route: { type: 'library', scope: 'bad' } }]
  assert.deepEqual(validateMeta({ pages: {}, settings: { openTabs } }).settings?.openTabs, [openTabs[0]])
  assert.deepEqual(parseDeepLink('workspace://library?scope=untyped'), route)
  assert.deepEqual(sanitizeWindowRoute(route), route)
  assert.equal(parseDeepLink('workspace://library?scope=bad'), null)
})

test('workspace load retains legacy trees and explicit placements without moving pages', () => {
  const [folder, child, loose, nested] = Array.from({ length: 4 }, () => crypto.randomUUID())
  const meta = validateMeta({ pages: {
    [folder]: page(folder), [child]: page(child, { parentId: folder }),
    [loose]: page(loose, { sidebarPrivate: false }), [nested]: page(nested, { parentId: loose }),
  }, settings: {} })
  const loaded = keepLegacyPrivateRoots(meta.pages)
  assert.equal(loaded[folder].sidebarPrivate, true)
  assert.equal(loaded[loose].sidebarPrivate, false)
  assert.equal(loaded[child].parentId, folder)
  assert.equal(loaded[nested].parentId, loose)
  assert.equal(meta.pages[folder].sidebarPrivate, undefined)
})
