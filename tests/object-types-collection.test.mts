// Coleção do tipo com o motor de filtros/ordem/agrupamento dos bancos (docs/USAGE.md): visão virtual que persiste no tipo e tem ⌘Z.
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return null },
  async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const ops = await import('../src/objecttypes/actions.ts')
const { buildTypeCollection } = await import('../src/objecttypes/collection.ts')

await actions.init()

await actions.init()
const { applyView } = await import('../src/components/database/lib.ts')
const { typeSchemaId } = await import('../src/objecttypes/model.ts')
const pages = () => getState().pages
const types = () => ops.objectTypes()

function setup() {
  const typeId = ops.createType({ name: 'Livro' })
  ops.addField(typeId, 'text', 'Autor')
  ops.addField(typeId, 'number', 'Nota')
  const props = types().find((t) => t.id === typeId)!.properties
  const [autor, nota] = props
  const mk = (title: string, a: string, n: number) => ops.createObject(typeId, { [autor.id]: a, [nota.id]: n }, { title })
  mk('B', 'Ana', 5); mk('A', 'Bia', 3); mk('C', 'Ana', 4)
  ops.ensureCollection(typeId)
  return { typeId, autor, nota }
}
const collection = (typeId: string) => buildTypeCollection(pages(), types(), types().find((t) => t.id === typeId)!, { title: 'Nome' })

test('filtro e ordem da coleção usam o motor dos bancos, persistem no tipo e entram no ⌘Z', () => {
  const { typeId, autor, nota } = setup()
  const dbId = typeSchemaId(typeId)
  let c = collection(typeId)
  assert.equal(applyView(c.rows, c.schema, c.view).length, 3)
  actions.updateView(dbId, c.view.id, { filters: [{ id: 'f1', propertyId: autor.id, op: 'equals', value: 'Ana' }], sorts: [{ propertyId: nota.id, direction: 'asc' }] })
  c = collection(typeId)
  assert.deepEqual(applyView(c.rows, c.schema, c.view).map((r) => r.title), ['C', 'B'], 'filtrado por Autor e ordenado por Nota')
  const saved = types().find((t) => t.id === typeId)!.collection!.views[0]
  assert.equal(saved.filters.length, 1, 'persistido no tipo')
  assert.equal(saved.sorts[0].propertyId, nota.id)
  assert.ok(ops.canUndoTypes())
  ops.undoTypes()
  c = collection(typeId)
  assert.equal(c.view.filters.length, 0, 'desfeito')
  assert.equal(applyView(c.rows, c.schema, c.view).length, 3)
  ops.redoTypes()
  assert.equal(collection(typeId).view.filters.length, 1)
})

test('ajustes seguidos da mesma coleção viram um passo; um só desfazer', () => {
  const { typeId, autor } = setup()
  const dbId = typeSchemaId(typeId)
  const viewId = collection(typeId).view.id
  actions.updateView(dbId, viewId, { filters: [{ id: 'f1', propertyId: autor.id, op: 'contains', value: 'A' }] })
  actions.updateView(dbId, viewId, { filters: [{ id: 'f1', propertyId: autor.id, op: 'contains', value: 'An' }] })
  actions.updateView(dbId, viewId, { groupBy: undefined, sorts: [{ propertyId: autor.id, direction: 'desc' }] })
  assert.equal(ops.undoTypes() !== null, true)
  assert.equal(collection(typeId).view.filters.length, 0, 'um só desfazer volta ao estado sem filtros')
  assert.equal(collection(typeId).view.sorts.length, 0)
})

test('valores de páginas não mudam ao filtrar a coleção', () => {
  const { typeId, autor } = setup()
  const before = JSON.stringify(Object.values(pages()).map((p) => p.typeProps))
  actions.updateView(typeSchemaId(typeId), collection(typeId).view.id, { filters: [{ id: 'f9', propertyId: autor.id, op: 'isEmpty', value: null }] })
  assert.equal(JSON.stringify(Object.values(pages()).map((p) => p.typeProps)), before)
})

test('collection layouts: Calendar and Timeline appear only when the type has a date field', async () => {
  const { collectionLayouts } = await import('../src/objecttypes/collection.ts')
  assert.deepEqual(collectionLayouts({ properties: [{ id: 'a', name: 'Name', type: 'title' }] }), ['table', 'board', 'gallery', 'list'])
  assert.deepEqual(collectionLayouts({ properties: [{ id: 'a', name: 'Name', type: 'title' }, { id: 'd', name: 'Due', type: 'date' }] }), ['table', 'board', 'gallery', 'list', 'calendar', 'timeline'])
})

test('timeline view in a type collection: switching converts the active view and keeps the date property', async () => {
  const typeId = ops.createType({ name: 'Evento', properties: [{ id: 'dt', name: 'Quando', type: 'date' }] } as never) as string
  ops.ensureCollection(typeId)
  const type = ops.objectTypes().find((item) => item.id === typeId)!
  const { schema, view, db } = buildTypeCollection(pages(), ops.objectTypes(), type, { title: 'Nome' })
  const { changeViewType } = await import('../src/components/database/settings/model.ts')
  const patch = changeViewType(schema, view, 'timeline')
  actions.updateView(db.id, view.id, patch)
  const next = buildTypeCollection(pages(), ops.objectTypes(), ops.objectTypes().find((item) => item.id === typeId)!, { title: 'Nome' })
  assert.equal(next.view.type, 'timeline')
  assert.ok(next.schema.properties.some((prop) => prop.id === next.view.dateProp && prop.type === 'date'))
})
