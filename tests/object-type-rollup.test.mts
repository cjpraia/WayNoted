import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page, Property } from '../src/types'
import { resolveValue } from '../src/components/database/derived.ts'
import { buildTypeCollection } from '../src/objecttypes/collection.ts'
import { normalizeObjectTypes, TITLE_FIELD_ID } from '../src/objecttypes/model.ts'
import { fieldValue } from '../src/query/engine.ts'
import { buildExportPackage } from '../src/export/package.ts'
import { packageToBackup } from '../src/export/importPackage.ts'
import { validateBackup } from '../src/workspace.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const R = id(1), P = id(2), C = id(3), DB = id(4), ROW = id(5), DB_PHONE = id(6)

function page(id: string, title: string, extra: Partial<Page> = {}): Page {
  return { id, title, parentId: null, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1,
    updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra }
}

function fixture() {
  const phone: Property = { id: 'phone', name: 'Telefone', type: 'phone' }
  const rollup: Property = { id: 'number', name: 'Telefone relacionado', type: 'rollup', rollup: { relationPropertyId: 'person', targetPropertyId: phone.id, aggregation: 'showOriginal' } }
  const fromDatabase: Property = { ...rollup, id: 'database-number', name: 'Telefone no banco', rollup: { relationPropertyId: 'database-people', targetPropertyId: phone.id, aggregation: 'showOriginal' } }
  const types = normalizeObjectTypes([
    { id: 'person-type', name: 'Pessoa', properties: [phone] },
    { id: 'client-type', name: 'Cliente', properties: [], parentTypes: ['person-type'] },
    { id: 'relation-type', name: 'Vínculos', properties: [
      { id: 'person', name: 'Pessoa relacionada', type: 'relation', relationTypeId: 'person-type' },
      { id: 'database-people', name: 'Pessoas no banco', type: 'relation', relationDatabaseId: DB },
    ] },
    { id: 'resource-type', name: 'Recurso', parentTypes: ['relation-type'], properties: [rollup, fromDatabase] },
  ])
  const database = {
    properties: [{ id: 'title', name: 'Nome', type: 'title' as const }, phone],
    views: [{ id: 'table', name: 'Tabela', type: 'table' as const, filters: [], sorts: [], hidden: [], widths: {} }],
    activeViewId: 'table',
  }
  const sourceValues = { person: [P, C], 'database-people': [DB_PHONE] }
  const pages = {
    [R]: page(R, 'Onboarding', { types: ['resource-type'], typeProps: sourceValues }),
    [P]: page(P, 'Marcelo', { types: ['person-type'], typeProps: { phone: '+55 11 90000-0000' } }),
    // Same field incorporated into a database: the actual column must win over the saved type copy.
    [C]: page(C, 'Cliente', { types: ['client-type'], parentId: DB, typeProps: { phone: 'antigo' }, props: { phone: '+55 21 90000-0000' } }),
    [DB]: page(DB, 'Agenda', { database }),
    [DB_PHONE]: page(DB_PHONE, 'Contato no banco', { parentId: DB, props: { phone: '+55 31 90000-0000' } }),
    [ROW]: page(ROW, 'Recurso dentro do banco', { parentId: DB, types: ['resource-type'], props: { phone: 'outro campo' }, typeProps: sourceValues }),
  }
  return { types, pages, rollup, fromDatabase }
}

test('type rollups resolve inherited fields, subtype candidates and database relations in pages, collections and queries', () => {
  const { types, pages, rollup, fromDatabase } = fixture()
  const expected = ['+55 11 90000-0000', '+55 21 90000-0000']
  assert.deepEqual(resolveValue(pages[R], rollup, pages, types), expected)
  assert.deepEqual(resolveValue(pages[ROW], rollup, pages, types), expected)
  assert.deepEqual(resolveValue(pages[ROW], fromDatabase, pages, types), ['+55 31 90000-0000'])
  assert.deepEqual(fieldValue(pages[ROW], rollup.id, pages, types).value, expected)
  const type = types.find(item => item.id === 'resource-type')!
  const collection = buildTypeCollection(pages, types, type, { title: 'Nome' })
  assert.deepEqual(collection.rows.map(row => resolveValue(row, rollup, pages, types)), [expected, expected])
  assert.equal(resolveValue(pages[R], { ...rollup, rollup: { ...rollup.rollup!, aggregation: 'count' } }, pages, types), 2)
})

test('rollups recalculate live and ignore pages protected by the related page or an ancestor', () => {
  const { types, pages, rollup, fromDatabase } = fixture()
  const titleFilter: Property = { ...rollup, rollup: { ...rollup.rollup!, filter: [
    { id: 'f', propertyId: TITLE_FIELD_ID, op: 'is', value: 'Marcelo' },
  ] } }
  assert.deepEqual(resolveValue(pages[R], titleFilter, pages, types), ['+55 11 90000-0000'])
  pages[P] = { ...pages[P], typeProps: { phone: '+55 11 91111-1111' } }
  assert.deepEqual(resolveValue(pages[R], titleFilter, pages, types), ['+55 11 91111-1111'])
  pages[P] = { ...pages[P], passwordLock: { rootId: P, hideTitle: false } }
  pages[DB] = { ...pages[DB], passwordLock: { rootId: DB, hideTitle: false } }
  assert.deepEqual(resolveValue(pages[R], rollup, pages, types), [])
  assert.equal(resolveValue(pages[R], fromDatabase, pages, types), null)
})

test('Markdown export renders the related phone while the round trip restores the formula and links', async () => {
  const { types, pages, rollup } = fixture()
  const { files, manifest } = await buildExportPackage({ pages, documents: {}, objectTypes: types, locale: 'pt-BR', workspaceName: 'WayNoted' }, {
    format: 'markdown', scope: 'workspace', includeFiles: true,
  })
  const file = manifest.pages.find(entry => entry.id === R)!.path
  assert.match(String(files[file]), /\+55 11 90000-0000/)
  const bytes = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, typeof value === 'string' ? new TextEncoder().encode(value) : value]))
  const { meta } = validateBackup(packageToBackup(bytes))
  const restored = meta.settings.objectTypes!.find(type => type.id === 'resource-type')!.properties.find(prop => prop.id === rollup.id)!
  assert.deepEqual(restored.rollup, rollup.rollup)
  assert.deepEqual(meta.pages[R].typeProps, pages[R].typeProps)
  assert.deepEqual(resolveValue(meta.pages[R], restored, meta.pages, meta.settings.objectTypes), ['+55 11 90000-0000', '+55 21 90000-0000'])
})
