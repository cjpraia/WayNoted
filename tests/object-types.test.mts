// Tipos de objeto ("supertags"): modelo, validação, aplicar/remover, herança, campos, coleção,
// desfazer, integridade e privacidade. docs/USAGE.md
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
const model = await import('../src/objecttypes/model.ts')
const ops = await import('../src/objecttypes/actions.ts')
const { buildTypeCollection } = await import('../src/objecttypes/collection.ts')
const { planConversion } = await import('../src/objecttypes/convert.ts')
const { validateMeta } = await import('../src/workspace.ts')
const { registeredTypes } = await import('../src/objecttypes/registry.ts')
const { searchWorkspace, defaultSearchFilters, parseTypeFilter } = await import('../src/components/modals/search.mts')

await actions.init()
const type = (id: string) => model.findType(ops.objectTypes(), id)!
const field = (typeId: string, name: string) => type(typeId).properties.find((p) => p.name === name)!

test('normalizeObjectTypes is tolerant: drops invalid entries, unsupported fields and unknown parents', () => {
  const list = model.normalizeObjectTypes([
    { id: 'a', name: 'Livro', color: 'nope', properties: [{ id: 'p1', name: 'Autor', type: 'text' }, { id: 'p2', name: 'F', type: 'formula', formula: '1' }, { id: 'p1', name: 'dup', type: 'text' }], parentTypes: ['missing', 'a'] },
    { id: 'a', name: 'duplicate' }, { name: 'sem id' }, 'lixo', null,
  ])
  assert.equal(list.length, 1)
  assert.equal(list[0].color, 'default')
  assert.deepEqual(list[0].properties.map((p) => p.id), ['p1'])
  assert.equal(list[0].parentTypes, undefined)
  assert.deepEqual(model.normalizeObjectTypes('x'), [])
})

test('validateMeta accepts old data and keeps or drops type data without refusing the workspace', () => {
  const page = { id: '00000000-0000-4000-8000-000000000001', parentId: null, title: 'P', createdAt: 1, updatedAt: 1, order: 0, coverPosition: 50, text: '' }
  const old = validateMeta({ pages: { [page.id]: page }, settings: {} })
  assert.equal(old.pages[page.id].types, undefined)
  assert.equal(old.settings.objectTypes, undefined)
  const typed = validateMeta({ pages: { [page.id]: { ...page, types: ['t', 't', 3], typeProps: { a: 'x', b: { bad: true } } } }, settings: { objectTypes: [{ id: 't', name: 'Livro', properties: [] }] } })
  assert.deepEqual(typed.pages[page.id].types, ['t'])
  assert.deepEqual(typed.pages[page.id].typeProps, { a: 'x' })
  assert.equal(typed.settings.objectTypes!.length, 1)
  const broken = validateMeta({ pages: { [page.id]: { ...page, types: 'x', typeProps: 5 } }, settings: { objectTypes: 'x' } })
  assert.equal(broken.pages[page.id].types, undefined)
  assert.equal(broken.pages[page.id].typeProps, undefined)
  assert.deepEqual(broken.settings.objectTypes, [])
})

test('presets create typed fields once; registry follows settings', () => {
  assert.equal(ops.objectTypes().filter((t) => t.preset).length, 8, 'native types seeded on open')
  actions.updateSettings({ objectTypes: [] })
  const ids = ops.createPresetTypes(['book', 'person', 'meeting'])
  assert.equal(ids.length, 3)
  assert.equal(ops.createPresetTypes(['book']).length, 0, 'preset not duplicated')
  assert.equal(registeredTypes().length, 3)
  const book = ops.objectTypes().find((t) => t.preset === 'book')!
  assert.ok(book.properties.some((p) => p.type === 'status'))
  assert.ok(Object.keys(book.template.values ?? {}).length > 0, 'status default value')
})

test('apply fills defaults only in empty fields, title template, remove keeps values until purge, undo/redo', () => {
  const book = ops.objectTypes().find((t) => t.preset === 'book')!.id
  const meeting = ops.objectTypes().find((t) => t.preset === 'meeting')!.id
  const status = field(book, model.findType(ops.objectTypes(), book)!.properties.find((p) => p.type === 'status')!.name)
  const page = actions.createPage(null, { title: 'Duna' })
  const untitled = actions.createPage(null, { title: '' })
  const r = ops.applyType([page], book)
  assert.deepEqual(r.applied, [page])
  assert.equal(getState().pages[page].typeProps![status.id], type(book).template.values![status.id])
  ops.applyType([untitled], meeting)
  assert.match(getState().pages[untitled].title, /\d{4}-\d{2}-\d{2}/, 'title template rendered')
  // Editing through setProp routes to typeProps (not props).
  const author = field(book, 'Autor')
  actions.setProp(page, author.id, 'Frank Herbert')
  assert.equal(getState().pages[page].typeProps![author.id], 'Frank Herbert')
  assert.equal(getState().pages[page].props, undefined)
  // Re-applying does not duplicate.
  assert.equal(ops.applyType([page], book, { toast: false }).applied.length, 0)
  ops.removeType([page], book)
  assert.equal(getState().pages[page].types, undefined)
  assert.equal(getState().pages[page].typeProps![author.id], 'Frank Herbert', 'values kept')
  assert.deepEqual(model.orphanTypeValues(ops.objectTypes(), getState().pages[page]).includes(author.id), true)
  assert.deepEqual(ops.restorableTypes(getState().pages[page]).map((t) => t.id), [book])
  ops.undoTypes()
  assert.deepEqual(getState().pages[page].types, [book], 'undo restores the type')
  ops.redoTypes()
  assert.equal(getState().pages[page].types, undefined, 'redo removes again')
  ops.purgeOrphans(page)
  assert.equal(getState().pages[page].typeProps, undefined, 'purge discards')
})

test('locked pages and password-locked pages are never modified', () => {
  const book = ops.objectTypes().find((t) => t.preset === 'book')!.id
  const locked = actions.createPage(null, { title: 'L', locked: true })
  const sealed = actions.createPage(null, { title: 'S' })
  actions.updatePage(sealed, { passwordLock: { rootId: sealed, hideTitle: false } }, false)
  const r = ops.applyType([locked, sealed], book, { toast: false })
  assert.deepEqual(r.applied, [])
  actions.updatePage(locked, { types: [book] })
  assert.equal(getState().pages[locked].types, undefined, 'updatePage refuses types on locked pages')
})

test('inheritance: parent fields first, cycles refused, subtype pages appear in parent collection', () => {
  const media = ops.createType({ name: 'Mídia', color: 'gray' })
  const year = ops.addField(media, 'number', 'Ano')!
  const film = ops.createType({ name: 'Filme', parentTypes: [media] })
  ops.addField(film, 'text', 'Diretor')
  assert.deepEqual(model.effectiveProperties(ops.objectTypes(), film).map((p) => p.name), ['Ano', 'Diretor'])
  ops.updateType(media, { parentTypes: [film] })
  assert.equal(type(media).parentTypes, undefined, 'cycle refused')
  const p = actions.createPage(null, { title: 'Solaris' })
  ops.applyType([p], film, { toast: false })
  actions.setProp(p, year, 1972)
  const collection = buildTypeCollection(getState().pages, ops.objectTypes(), type(media), { title: 'Nome' })
  assert.deepEqual(collection.rows.map((row) => row.id), [p])
  assert.equal(collection.rows[0].props![year], 1972)
  assert.equal(collection.db.id, model.typeSchemaId(media))
  // Same identity while page does not change (virtualized views rely on it).
  assert.ok(buildTypeCollection(getState().pages, ops.objectTypes(), type(media), { title: 'Nome' }).rows[0] === collection.rows[0])
})

test('collection: trash ignored, hidden-title locked pages omitted, locked values not projected; virtual schema writes back', () => {
  const kind = ops.createType({ name: 'Receita X' })
  const minutes = ops.addField(kind, 'number', 'Minutos')!
  const a = actions.createPage(null, { title: 'A' }), b = actions.createPage(null, { title: 'B' }), c = actions.createPage(null, { title: 'C' }), d = actions.createPage(null, { title: 'D' })
  ops.applyType([a, b, c, d], kind, { toast: false })
  for (const id of [a, b, c, d]) actions.setProp(id, minutes, 10)
  actions.trashPage(b)
  actions.updatePage(c, { passwordLock: { rootId: c, hideTitle: true } }, false)
  actions.updatePage(d, { passwordLock: { rootId: d, hideTitle: false } }, false)
  const collection = buildTypeCollection(getState().pages, ops.objectTypes(), type(kind), { title: 'Nome' })
  assert.deepEqual(collection.rows.map((row) => row.id).sort(), [a, d].sort())
  assert.equal(collection.hiddenCount, 1)
  assert.deepEqual(collection.rows.find((row) => row.id === d)!.props, {})
  // updateSchema on the virtual id (views, option creation) edits the type.
  actions.updateSchema(model.typeSchemaId(kind), (schema) => ({ ...schema, properties: schema.properties.map((p) => p.id === minutes ? { ...p, name: 'Tempo' } : p), views: schema.views.map((v) => ({ ...v, widths: { [minutes]: 180 } })) }))
  assert.equal(field(kind, 'Tempo').id, minutes)
  assert.equal(type(kind).collection!.views[0].widths[minutes], 180)
  // "+ Novo" in the collection creates a typed root page.
  const created = actions.createRow(model.typeSchemaId(kind), { [minutes]: 5 })
  assert.deepEqual(getState().pages[created].types, [kind])
  assert.equal(getState().pages[created].typeProps![minutes], 5)
})

test('field conversion reapplies safe conversion to every page (same rules as databases)', () => {
  const kind = ops.createType({ name: 'Conv' })
  const f = ops.addField(kind, 'text', 'Nível')!
  const ids = ['alto', 'baixo', 'alto', ''].map((value, i) => { const id = actions.createPage(null, { title: `c${i}` }); ops.applyType([id], kind, { toast: false }); if (value) actions.setProp(id, f, value); return id })
  assert.ok(ops.convertField(kind, f, 'select'))
  const prop = field(kind, 'Nível')
  assert.equal(prop.type, 'select')
  assert.deepEqual(prop.options!.map((o) => o.name).sort(), ['alto', 'baixo'])
  const value = getState().pages[ids[0]].typeProps![f]
  assert.equal(prop.options!.find((o) => o.id === value)!.name, 'alto')
  assert.ok(ops.convertField(kind, f, 'text'))
  assert.equal(getState().pages[ids[1]].typeProps![f], 'baixo')
  const plan = planConversion({ id: 'n', name: 'N', type: 'text' }, 'number', [])!
  assert.equal(plan.convert('1.234,5'), 1234.5)
  assert.equal(planConversion({ id: 'n', name: 'N', type: 'text' }, 'checkbox', [])!.convert('sim'), true)
})

test('delete type: remove discards values; convert writes "Campo: valor" into the body', async () => {
  const kind = ops.createType({ name: 'Temp' })
  const f = ops.addField(kind, 'text', 'Cor')!
  const p = actions.createPage(null, { title: 'Obj' })
  ops.applyType([p], kind, { toast: false })
  actions.setProp(p, f, 'azul')
  await native.saveDoc(p, [{ id: 'x', type: 'paragraph', content: [{ type: 'text', text: 'corpo', styles: {} }], children: [] }])
  assert.equal(await ops.deleteType(kind, 'convert'), 1)
  assert.equal(getState().pages[p].types, undefined)
  assert.equal(getState().pages[p].typeProps, undefined)
  assert.ok(JSON.stringify(documents.get(p)).includes('Cor: azul'))
  assert.equal(ops.objectTypes().some((t) => t.id === kind), false)
})

test('template is inserted into empty pages only; append on request', async () => {
  const kind = ops.createType({ name: 'Modelo', template: { blocks: [{ type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Seção', styles: {} }] }] } })
  const empty = actions.createPage(null, { title: 'vazia' })
  const full = actions.createPage(null, { title: 'cheia' })
  await native.saveDoc(full, [{ id: 'y', type: 'paragraph', content: [{ type: 'text', text: 'já tem', styles: {} }], children: [] }])
  ops.applyType([empty, full], kind, { toast: false })
  assert.equal(await ops.offerTemplate(empty, kind), 'inserted')
  assert.equal(await ops.offerTemplate(full, kind), 'ask')
  assert.ok(JSON.stringify(documents.get(empty)).includes('Seção'))
  assert.ok(!JSON.stringify(documents.get(full)).includes('Seção'))
  assert.ok(await ops.insertTemplate(full, kind, 'append'))
  assert.ok(JSON.stringify(documents.get(full)).includes('Seção'))
})

test('#tag detection, type search filter, field text indexed, locked values not searchable', () => {
  const book = ops.objectTypes().find((t) => t.preset === 'book')!
  assert.deepEqual(model.typeTagsIn('lendo #livro hoje', ops.objectTypes(), { types: [] }).map((t) => t.id), [book.id])
  assert.equal(model.typeTagsIn('lendo #livros', ops.objectTypes(), { types: [] }).length, 0)
  assert.equal(model.typeTagsIn('#Livro', ops.objectTypes(), { types: [book.id] }).length, 0)
  assert.deepEqual(parseTypeFilter('tipo:Livro duna'), { query: 'duna', types: ['Livro'] })
  assert.deepEqual(parseTypeFilter('type:"Livro de bolso" x'), { query: 'x', types: ['Livro de bolso'] })
  const author = book.properties.find((p) => p.name === 'Autor')!
  const p = actions.createPage(null, { title: 'Fundação' })
  ops.applyType([p], book.id, { toast: false })
  actions.setProp(p, author.id, 'Asimovski')
  const other = actions.createPage(null, { title: 'Fundação (não livro)' })
  const byType = searchWorkspace(getState().pages, 'tipo:Livro fundação', defaultSearchFilters).map((hit) => hit.page.id)
  assert.ok(byType.includes(p) && !byType.includes(other))
  assert.ok(searchWorkspace(getState().pages, 'asimovski', defaultSearchFilters).some((hit) => hit.page.id === p), 'field text indexed')
  assert.equal(searchWorkspace(getState().pages, 'tipo:Inexistente', defaultSearchFilters).length, 0)
  actions.updatePage(p, { passwordLock: { rootId: p, hideTitle: false } }, false)
  assert.ok(!searchWorkspace(getState().pages, 'asimovski', defaultSearchFilters).some((hit) => hit.page.id === p), 'locked values not searchable')
})

test('mergeImportedTypes keeps local definitions and adds missing fields', () => {
  const local = model.normalizeObjectTypes([{ id: 'x', name: 'Local', properties: [{ id: 'a', name: 'A', type: 'text' }] }])
  const merged = model.mergeImportedTypes(local, model.normalizeObjectTypes([{ id: 'x', name: 'Remoto', properties: [{ id: 'b', name: 'B', type: 'number' }] }, { id: 'y', name: 'Novo', properties: [] }]))
  assert.deepEqual(merged.map((t) => t.name), ['Local', 'Novo'])
  assert.deepEqual(merged[0].properties.map((p) => p.id), ['a', 'b'])
})

test('10 thousand objects: index and collection stay fast', () => {
  const kind = ops.createType({ name: 'Massa' })
  const f = ops.addField(kind, 'number', 'N')!
  const now = Date.now()
  const pages = Array.from({ length: 10_000 }, (_, i) => ({ id: crypto.randomUUID(), parentId: null, title: `obj ${i}`, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 1000 + i, fullWidth: false, smallText: false, font: 'default' as const, locked: false, text: '', types: [kind], typeProps: { [f]: i } }))
  actions.insertPages(pages)
  const started = performance.now()
  const collection = buildTypeCollection(getState().pages, ops.objectTypes(), type(kind), { title: 'Nome' })
  const first = performance.now() - started
  assert.equal(collection.rows.length, 10_000)
  const again = performance.now()
  buildTypeCollection(getState().pages, ops.objectTypes(), type(kind), { title: 'Nome' })
  assert.ok(first < 1500, `build ${first.toFixed(0)} ms`)
  assert.ok(performance.now() - again < 200, 'memoized rebuild')
})
