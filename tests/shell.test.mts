import test from 'node:test'
import assert from 'node:assert/strict'
import { searchPages, defaultSearchFilters, moveDestinations } from '../src/components/modals/search.mts'
import type { Page } from '../src/types.ts'
const page = (id: string, patch: Partial<Page> = {}): Page => ({ id, parentId: null, title: id, text: '', favorite: false, trashed: false, createdAt: 1, updatedAt: 100, icon: null, cover: null, coverPosition: 50, trashedAt: null, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, ...patch })
test('search normalizes accents, requires every word, and ranks title over body', () => {
  const pages = { a: page('a', { title: 'Reunião projeto' }), b: page('b', { text: 'reunião do projeto', updatedAt: 200 }), c: page('c', { title: 'reunião' }) }
  assert.deepEqual(searchPages(pages, 'reuniao projeto', defaultSearchFilters).map(p => p.id), ['a', 'b'])
})
test('search omits trashed descendants and cycles and intersects filters', () => {
  const pages = { a: page('a', { trashed: true }), b: page('b', { parentId: 'a' }), c: page('c', { parentId: 'd' }), d: page('d', { parentId: 'c' }), e: page('e', { favorite: true }), f: page('f', { parentId: 'e', favorite: true }), g: page('g') }
  assert.deepEqual(searchPages(pages, '', { ...defaultSearchFilters, scope: 'e', favorites: true, sort: 'title' }).map(p => p.id), ['e', 'f'])
  assert.deepEqual(searchPages(pages, '', defaultSearchFilters).map(p => p.id), ['e', 'f', 'g'])
})
test('date filter uses caller clock and does not alter pages', () => {
  const pages = { a: page('a', { updatedAt: 10 }), b: page('b', { updatedAt: 86400005 }) }
  const before = JSON.stringify(pages)
  assert.deepEqual(searchPages(pages, '', { ...defaultSearchFilters, updated: 'day' }, 86400020).map(p => p.id), ['b'])
  assert.equal(JSON.stringify(pages), before)
})
test('move targets exclude self, descendants, trashed and locked pages', () => {
  const pages = { a: page('a'), b: page('b', { parentId: 'a' }), c: page('c', { parentId: 'b' }), d: page('d', { locked: true }), e: page('e', { trashed: true }), f: page('f', { title: 'Área livre' }) }
  assert.deepEqual(moveDestinations(pages, 'a', 'area').map(p => p.id), ['f'])
})
test('database view lock still permits choosing it as a row destination', () => {
  const pages = { a: page('a'), db: page('db', { locked: true, database: { properties: [], views: [], activeViewId: '' } }) }
  assert.deepEqual(moveDestinations(pages, 'a').map(p => p.id), ['db'])
})
test('global search indexes property labels, options, relations and computed values', () => {
  const properties = [{ id: 'status', name: 'Status', type: 'select' as const, options: [{ id: 'done', name: 'Concluído', color: 'green' }] }, { id: 'relation', name: 'Projeto', type: 'relation' as const, relationDatabaseId: 'db' }, { id: 'amount', name: 'Valor', type: 'number' as const }, { id: 'double', name: 'Dobro', type: 'formula' as const, formula: 'prop("Valor") * 2' }]
  const pages = { db: page('db', { database: { properties, views: [], activeViewId: '' } }), row: page('row', { parentId: 'db', props: { status: 'done', relation: ['project'], amount: 42 } }), project: page('project', { title: 'Projeto Café', parentId: 'db' }) }
  assert.deepEqual(searchPages(pages, 'concluido cafe 84', { ...defaultSearchFilters, content: 'properties' }).map(p => p.id), ['row'])
  assert.deepEqual(searchPages(pages, 'concluido', { ...defaultSearchFilters, content: 'properties', propertyName: 'Valor' }).map(p => p.id), [])
})
test('global search supports exact phrases, OR terms, exclusions and creation ranges', () => {
  const pages = { a: page('a', { title: 'Plano azul', text: 'Projeto café', createdAt: new Date('2026-10-01T12:00:00').getTime() }), b: page('b', { title: 'Plano verde', text: 'Café projeto' }) }
  assert.deepEqual(searchPages(pages, '"projeto cafe" -verde', defaultSearchFilters).map(p => p.id), ['a'])
  assert.deepEqual(searchPages(pages, 'azul verde', { ...defaultSearchFilters, match: 'any' }).map(p => p.id), ['a', 'b'])
  assert.deepEqual(searchPages(pages, '', { ...defaultSearchFilters, dateField: 'created', after: '2026-10-01', before: '2026-10-01' }).map(p => p.id), ['a'])
})
