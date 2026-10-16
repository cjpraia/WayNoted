// Ajustes pós-teste dos tipos (docs/USAGE.md): incorporar campos da página, reordenar, páginas sem tipo,
// tipo das novas linhas (explícito e sugerido) e tipos como modelos.
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } },
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
const adjust = await import('../src/objecttypes/adjust.ts')
const { buildTypeCollection } = await import('../src/objecttypes/collection.ts')
const { clearToasts, visibleToasts } = await import('../src/components/ui/toastQueue.ts')

await actions.init()
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const pages = () => getState().pages
const types = () => ops.objectTypes()

/** Banco (já nasce com Tags) com as propriedades de teste (Etiquetas multisseleção, Nota texto, Total fórmula) e uma linha. */
function makeDatabase(title: string) {
  const db = actions.createDatabase(null, 'table', { title })
  const schema = pages()[db].database!
  const tagsId = 'prop-tags', noteId = 'prop-note', formulaId = 'prop-formula'
  actions.updatePage(db, { database: { ...schema, properties: [...schema.properties, { id: tagsId, name: 'Etiquetas', type: 'multiSelect', options: [{ id: 'o1', name: 'a', color: 'blue' }] }, { id: noteId, name: 'Nota', type: 'text' }, { id: formulaId, name: 'Total', type: 'formula', formula: '1' }] } }, false)
  return { db, tagsId, noteId, formulaId }
}

test('extraFieldsFor: lists database fields the type lacks (not formulas, not same name+type), with filled counts', () => {
  const { db, tagsId, noteId } = makeDatabase('BD-Extras')
  const type = ops.createType({ name: 'Ideia' })
  ops.addField(type, 'text', 'Nota')
  const row = actions.createRow(db, { [tagsId]: ['o1'], [noteId]: 'x' })
  const other = actions.createRow(db, {})
  const extras = adjust.extraFieldsFor(pages(), types(), [row, other], type)
  const names = extras.map((extra) => extra.property.name)
  assert.ok(names.includes('Etiquetas') && names.includes('Tags'), 'database fields the type lacks')
  assert.ok(!names.includes('Nota') && !names.includes('Total'), 'Nota already exists in the type (same name and type); Total is a formula')
  const etiquetas = extras.find((extra) => extra.property.name === 'Etiquetas')!
  assert.equal(etiquetas.filled, 1)
  assert.deepEqual(etiquetas.pageIds, [row, other])
  const loose = actions.createPage(null, { title: 'solta' })
  assert.deepEqual(adjust.extraFieldsFor(pages(), types(), [loose], type), [], 'loose page: nothing to add')
})

test('applyTypeStep with incorporate: fields join the type keeping ids and values; one undo reverts type and page', async () => {
  const { db, tagsId } = makeDatabase('BD-Tags')
  const type = ops.createType({ name: 'Rótulos' })
  const row = actions.createRow(db, { [tagsId]: ['o1'] })
  clearToasts()
  const result = await ops.applyTypeStep(row, type, { template: false, incorporate: [tagsId] })
  assert.equal(result.applied, true)
  assert.equal(result.incorporated, 1)
  const added = types().find((candidate) => candidate.id === type)!.properties
  assert.deepEqual(added.map((prop) => prop.id), [tagsId], 'same id: the value keeps working')
  assert.deepEqual(added[0].options?.map((option) => option.name), ['a'])
  assert.deepEqual(pages()[row].props?.[tagsId], ['o1'], 'value preserved')
  assert.match(visibleToasts()[0].message, /1 da página/)
  // O campo incorporado aparece uma vez só no banco e a coleção do tipo mostra o valor.
  const collection = buildTypeCollection(pages(), types(), types().find((candidate) => candidate.id === type)!, { title: 'Nome' })
  assert.deepEqual(collection.rows.find((r) => r.id === row)!.props?.[tagsId], ['o1'])
  ops.undoTypes()
  assert.equal(types().find((candidate) => candidate.id === type)!.properties.length, 0, 'undo removes the field from the type')
  assert.equal(pages()[row].types, undefined)
  assert.deepEqual(pages()[row].props?.[tagsId], ['o1'], 'undo never touches the page value')
})

test('applyTypeStep with incorporate: [] adds nothing; batch applyType incorporates and undoes together', () => {
  const { db, tagsId, noteId } = makeDatabase('BD-Lote')
  const type = ops.createType({ name: 'Lote' })
  const rows = [actions.createRow(db, { [tagsId]: ['o1'] }), actions.createRow(db, { [noteId]: 'n' })]
  const none = ops.applyType([rows[0]], type, { toast: false, incorporate: [] })
  assert.equal(none.applied.length, 1)
  assert.equal(types().find((candidate) => candidate.id === type)!.properties.length, 0)
  const rest = ops.applyType([rows[1]], type, { toast: false, incorporate: [noteId] })
  assert.equal(rest.applied.length, 1)
  assert.deepEqual(types().find((candidate) => candidate.id === type)!.properties.map((prop) => prop.name), ['Nota'])
  ops.undoTypes()
  assert.equal(types().find((candidate) => candidate.id === type)!.properties.length, 0)
  assert.equal(pages()[rows[1]].types, undefined)
})

test('moveRelative / moveStep are pure and stable; reorderField and moveField are undoable', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(adjust.moveRelative(list, 'a', 'c', true).map((x) => x.id), ['b', 'c', 'a'])
  assert.deepEqual(adjust.moveRelative(list, 'c', 'a', false).map((x) => x.id), ['c', 'a', 'b'])
  assert.ok(adjust.moveRelative(list, 'b', 'a', true) === list, 'no change returns the same list')
  assert.ok(adjust.moveRelative(list, 'a', 'zzz', true) === list)
  assert.deepEqual(adjust.moveStep(list, 'b', -1).map((x) => x.id), ['b', 'a', 'c'])
  assert.ok(adjust.moveStep(list, 'a', -1) === list, 'edge')
  const type = ops.createType({ name: 'Ordem' })
  const a = ops.addField(type, 'text', 'A')!, b = ops.addField(type, 'number', 'B')!, c = ops.addField(type, 'date', 'C')!
  const order = () => types().find((candidate) => candidate.id === type)!.properties.map((prop) => prop.id)
  ops.reorderField(type, a, c, true)
  assert.deepEqual(order(), [b, c, a])
  ops.moveField(type, a, -1)
  assert.deepEqual(order(), [b, a, c])
  ops.undoTypes()
  assert.deepEqual(order(), [b, c, a], 'undo of the key move')
  ops.undoTypes()
  assert.deepEqual(order(), [a, b, c], 'undo of the drag')
})

test('untypedPages: normal pages and rows only; no typed, databases, boards, locked, trashed, daily rows or template pages', () => {
  const plain = actions.createPage(null, { title: 'Sem tipo alfa' })
  const typed = actions.createPage(null, { title: 'Com tipo' })
  const type = ops.createType({ name: 'Qualquer' })
  ops.applyType([typed], type, { toast: false })
  const trashed = actions.createPage(null, { title: 'Lixo', trashed: true })
  const locked = actions.createPage(null, { title: 'Travada', locked: true })
  const { db } = makeDatabase('BD-Sem tipo')
  const dbRow = actions.createRow(db, {}, { title: 'Linha sem tipo' })
  const dailyDb = makeDatabase('BD-Diário').db
  const dailyRow = actions.createRow(dailyDb, {}, { title: 'Nota diária' })
  const source = actions.createPage(null, { title: 'Página-modelo' })
  ops.updateType(type, { template: { sourcePageId: source } })
  const ids = adjust.untypedPages(pages(), types(), { excludeDatabaseIds: new Set([dailyDb]) }).map((page) => page.id)
  assert.ok(ids.includes(plain) && ids.includes(dbRow), 'normal page and database row')
  for (const excluded of [typed, trashed, locked, db, dailyRow, source]) assert.ok(!ids.includes(excluded), `excluded ${pages()[excluded]?.title}`)
  assert.deepEqual(adjust.untypedPages(pages(), types(), { query: 'alfa' }).map((page) => page.id), [plain])
})

test('dominantRowType needs ≥ 2 rows with the type and at least half of the rows', () => {
  const { db } = makeDatabase('BD-Dominante')
  const type = ops.createType({ name: 'Dom' })
  const rows = [actions.createRow(db, {}), actions.createRow(db, {}), actions.createRow(db, {}), actions.createRow(db, {})]
  assert.equal(adjust.dominantRowType(pages(), types(), db), null)
  ops.applyType([rows[0]], type, { toast: false })
  assert.equal(adjust.dominantRowType(pages(), types(), db), null, 'only one row')
  ops.applyType([rows[1]], type, { toast: false })
  assert.equal(adjust.dominantRowType(pages(), types(), db)?.type.id, type, '2 of 4 = 50%')
  assert.equal(adjust.dominantRowType(pages(), types(), db, new Set([rows[3]]))?.type.id, type)
  actions.createRow(db, {})
  assert.equal(adjust.dominantRowType(pages(), types(), db), null, '2 of 5 < 50%')
})

test('new rows: explicit “type of new rows” applies silently; dominant type is suggested once with Undo / Don’t use', async () => {
  // Explícito.
  const { db } = makeDatabase('BD-Explícito')
  const type = ops.createType({ name: 'Padrão', template: { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Corpo do tipo', styles: {} }] }] } })
  ops.setNewRowType(db, type)
  clearToasts()
  const row = actions.createRow(db, {})
  await settle()
  assert.deepEqual(pages()[row].types, [type])
  assert.ok(JSON.stringify(documents.get(row) ?? []).includes('Corpo do tipo'), 'type body inserted')
  assert.equal(visibleToasts().length, 0, 'no notice for the explicit setting')
  ops.setNewRowType(db, null)
  const plain = actions.createRow(db, {})
  await settle()
  assert.equal(pages()[plain].types, undefined, 'null = none')

  // Sugerido pelo dominante.
  const second = makeDatabase('BD-Sugerido').db
  const dom = ops.createType({ name: 'Tags' }) // mesmo nome da propriedade padrão do banco: o tipo é outra coisa
  ops.applyType([actions.createRow(second, {}), actions.createRow(second, {}), actions.createRow(second, {})], dom, { toast: false })
  assert.equal(pages()[second].database!.newRowTypeId, undefined)
  clearToasts()
  const created = actions.createRow(second, {})
  await settle()
  assert.deepEqual(pages()[created].types, [dom])
  assert.equal(pages()[second].database!.newRowTypeId, dom)
  const toast = visibleToasts().at(-1)!
  assert.equal(toast.message, 'Novas linhas deste banco usarão o tipo Tags')
  assert.equal(toast.actionLabel, 'Desfazer')
  assert.equal(toast.secondaryLabel, 'Não usar')
  toast.onSecondary!()
  assert.equal(pages()[second].database!.newRowTypeId, null, '“Não usar” records the refusal')
  assert.equal(pages()[created].types, undefined)
  const again = actions.createRow(second, {})
  await settle()
  assert.equal(pages()[again].types, undefined, 'never suggested again')

  // Desfazer volta ao estado "nunca decidido".
  const third = makeDatabase('BD-Desfazer').db
  ops.applyType([actions.createRow(third, {}), actions.createRow(third, {})], dom, { toast: false })
  clearToasts()
  const made = actions.createRow(third, {})
  await settle()
  visibleToasts().at(-1)!.onAction!()
  assert.equal(pages()[third].database!.newRowTypeId, undefined)
  assert.equal(pages()[made].types, undefined)
})

test('createRowOfType: the row is born with the type, its fields and its template; the database rule does not add a second type', async () => {
  const { db } = makeDatabase('BD-Modelo-de-tipo')
  const other = ops.createType({ name: 'Outro' })
  ops.setNewRowType(db, other)
  const type = ops.createType({ name: 'Reunião 2', template: { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pauta do tipo', styles: {} }] }] } })
  ops.addField(type, 'text', 'Local')
  const row = ops.createRowOfType(db, type)
  await settle()
  assert.deepEqual(pages()[row].types, [type])
  assert.ok(JSON.stringify(documents.get(row) ?? []).includes('Pauta do tipo'))
})

test('typesAsTemplates keeps the usage order and skips names already offered as templates', () => {
  const a = ops.createType({ name: 'Projeto' }), b = ops.createType({ name: 'Livro' })
  const entries = [{ type: types().find((t) => t.id === b)!, count: 3 }, { type: types().find((t) => t.id === a)!, count: 1 }]
  assert.deepEqual(adjust.typesAsTemplates(entries, ['Reunião', 'projeto']).map((entry) => entry.type.name), ['Livro'])
})
