// Visualização vinculada (docs/USAGE.md): seletor de fonte (lógica pura), menu `/`
// e store (propriedades compartilhadas com a fonte, trocar fonte, visões da fonte, desvincular, ⌘Z).
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return null },
  async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] },
  async saveDocVersions() {},
  async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } } })
const { actions, getState, selectors } = await import('../src/store.ts')
const { addProperty, deleteProperty, renameProperty } = await import('../src/components/database/schemaOps.ts')
const linked = await import('../src/components/database/linkedSource.ts')
const { SLASH_CATALOG, slashSubtext } = await import('../src/components/page/slashMenu/catalog.ts')

const page = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, icon: null, parentId: null, trashed: false, updatedAt: 1, ...extra }) as any
const db = (id: string, extra: Record<string, unknown> = {}) => page(id, { database: { properties: [{ id: 't', name: 'Nome', type: 'title' }], views: [{ id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v' }, ...extra })

test('seletor: só bancos de verdade, com caminho, recentes primeiro e busca por nome ou caminho', () => {
  const pages = {
    home: page('Casa'), proj: page('Projetos', { parentId: 'home' }),
    tasks: db('Tarefas', { parentId: 'proj', updatedAt: 5 }), books: db('Livros', { updatedAt: 9 }),
    note: page('Nota'), gone: db('Lixo', { trashed: true }),
    view: page('Vinculada', { database: { properties: [], views: [], activeViewId: 'x', linkedSourceId: 'tasks' } }),
    combo: page('Combinado', { database: { properties: [], views: [], activeViewId: 'x', sourceDatabaseIds: ['tasks'] } }),
    r1: page('r1', { parentId: 'tasks' }), r2: page('r2', { parentId: 'tasks' }),
  }
  for (const [id, p] of Object.entries(pages)) p.id = id
  const all = linked.linkableSources(pages, { workspaceName: 'Meu espaço' })
  assert.deepEqual(all.map((s) => s.id), ['books', 'tasks'], 'sem páginas comuns, vinculadas, combinadas ou na lixeira; mais editado primeiro')
  const tasks = all.find((s) => s.id === 'tasks')!
  assert.deepEqual(tasks.path, ['Meu espaço', 'Casa', 'Projetos'])
  assert.equal(tasks.rowCount, 2)
  assert.deepEqual(linked.linkableSources(pages, { recent: ['tasks'] }).map((s) => s.id), ['tasks', 'books'], 'usados recentemente primeiro')
  assert.deepEqual(linked.linkableSources(pages, { query: 'projetos' }).map((s) => s.id), ['tasks'], 'busca também no caminho')
  assert.deepEqual(linked.linkableSources(pages, { query: 'livr' }).map((s) => s.id), ['books'])
  assert.deepEqual(linked.linkableSources(pages, { exclude: ['books'] }).map((s) => s.id), ['tasks'])
  assert.equal(linked.linkableSources(pages, { query: 'zzz' }).length, 0)
})

test('seletor: "Mostrar mais" vai de 5 para 20 e depois todos; raiz segue o vínculo sem ciclo', () => {
  assert.deepEqual([0, 1, 2].map((step) => linked.visibleSourceCount(step, 30)), [5, 20, 30])
  assert.equal(linked.visibleSourceCount(0, 3), 3)
  const pages: any = { a: page('a', { database: { linkedSourceId: 'b' } }), b: page('b', { database: { linkedSourceId: 'a' } }) }
  assert.ok(['a', 'b'].includes(linked.resolveLinkedRoot(pages, 'a')), 'ciclo não trava')
})

test('trocar fonte recomeça com uma tabela limpa; visões da fonte não são duplicadas', () => {
  const current: any = { properties: [], views: [{ id: 'old', name: 'Quadro', type: 'board', filters: [{ id: 'f', propertyId: 'p', op: 'is', value: 'x' }], sorts: [], hidden: [], widths: {} }], activeViewId: 'old', linkedSourceId: 'a' }
  const next = linked.relinkedSchema(current, 'b', 'Tabela')
  assert.equal(next.linkedSourceId, 'b')
  assert.equal(next.views.length, 1)
  assert.equal(next.views[0].type, 'table')
  assert.equal(next.views[0].filters.length, 0)
  const sourceView: any = { id: 'sv', name: 'Por status', type: 'board', filters: [], sorts: [], hidden: [], widths: {}, groupBy: 's' }
  const first = linked.adoptSourceView(current, sourceView)
  assert.equal(first.added, true)
  assert.equal(first.schema.views.at(-1)!.sourceViewId, 'sv')
  assert.equal(first.schema.views.at(-1)!.groupBy, 's')
  const again = linked.adoptSourceView(first.schema, sourceView)
  assert.equal(again.added, false)
  assert.equal(again.schema.views.length, first.schema.views.length)
  assert.equal(again.viewId, first.viewId)
})

test('menu /: "Visualização vinculada" fica no grupo Banco de dados, entre os 7 primeiros, com descrição', () => {
  const database = SLASH_CATALOG.filter((item) => item.category === 'Database').map((item) => item.id)
  const at = database.indexOf('linked-data-source')
  assert.ok(at >= 0 && at < 7, `posição ${at}`)
  const item = SLASH_CATALOG.find((entry) => entry.id === 'linked-data-source')!
  assert.equal(slashSubtext(item, false, 'pt-BR'), 'Mostrar um banco existente aqui')
  assert.equal(slashSubtext(item, true, 'pt-BR'), 'Banco de dados')
  assert.equal(slashSubtext(item, false, 'en-US'), 'Show an existing database here')
})

test('store: criar, renomear e excluir propriedade pela visão vinculada altera a fonte, com ⌘Z', async () => {
  await actions.init()
  const source = actions.createDatabase(null, 'table', { title: 'Recursos' })
  const view = linked.freshLinkedView('Tabela')
  const linkedId = actions.createPage(null, { database: linked.linkedSchema(source, view) })
  const sibling = actions.createPage(null, { database: linked.linkedSchema(source, linked.freshLinkedView('Tabela')) })
  const row = actions.createRow(linkedId, {}, { title: 'Linha' })
  assert.equal(selectors.page(row)?.parentId, source, 'nova linha vai para a fonte')
  let events = 0
  const off = actions.onLinkedSchemaEdit((event) => { if (event.dbId === linkedId && event.sourceId === source) events++ })
  const before = selectors.database(source)!.properties.length
  const prop = addProperty(linkedId, 'number')
  assert.equal(selectors.database(source)!.properties.length, before + 1, 'propriedade criada na fonte')
  assert.ok(selectors.database(linkedId)!.properties.some((p) => p.id === prop), 'visível na visão vinculada')
  assert.ok(selectors.database(sibling)!.properties.some((p) => p.id === prop), 'e nas outras visões da fonte')
  assert.equal(getState().pages[linkedId].database!.views.length, 1, 'visões desta visualização intactas')
  assert.equal(events, 1)
  renameProperty(linkedId, prop, 'Horas')
  assert.equal(selectors.database(source)!.properties.find((p) => p.id === prop)?.name, 'Horas')
  actions.updatePage(row, { props: { [prop]: 3 } })
  actions.updateView(linkedId, view.id, { sorts: [{ propertyId: prop, direction: 'asc' }] })
  assert.equal(selectors.database(source)!.views[0].sorts.length, 0, 'ordenação é só desta visão')
  deleteProperty(linkedId, prop)
  assert.ok(!selectors.database(source)!.properties.some((p) => p.id === prop), 'excluída na fonte')
  assert.equal(getState().pages[linkedId].database!.views[0].sorts.length, 0, 'ordenação da propriedade excluída limpa')
  assert.equal(selectors.page(row)?.props?.[prop], undefined, 'valor da linha removido')
  assert.ok(actions.undoDatabase(), '⌘Z desfaz a exclusão')
  assert.ok(selectors.database(source)!.properties.some((p) => p.id === prop), 'propriedade volta na fonte')
  assert.equal(selectors.page(row)?.props?.[prop], 3, 'valor da linha volta')
  off()
})

test('store: fonte bloqueada recusa edição de propriedade pela visão vinculada', async () => {
  const source = actions.createDatabase(null, 'table', { title: 'Travado' })
  const linkedId = actions.createPage(null, { database: linked.linkedSchema(source, linked.freshLinkedView('Tabela')) })
  actions.updatePage(source, { locked: true })
  const before = selectors.database(source)!.properties.length
  addProperty(linkedId, 'text')
  assert.equal(selectors.database(source)!.properties.length, before)
})

test('store: trocar fonte, mostrar visão da fonte e converter em banco independente, todos com ⌘Z', async () => {
  const a = actions.createDatabase(null, 'table', { title: 'A' }), b = actions.createDatabase(null, 'board', { title: 'B' })
  actions.createRow(a, {}, { title: 'a1' }); actions.createRow(a, {}, { title: 'a2' })
  const linkedId = actions.createPage(null, { database: linked.linkedSchema(a, linked.freshLinkedView('Tabela')) })
  assert.equal(actions.relinkDatabase(linkedId, linkedId), false, 'não vincula a si mesma')
  assert.ok(actions.relinkDatabase(linkedId, b))
  assert.equal(getState().pages[linkedId].database!.linkedSourceId, b)
  assert.ok(actions.undoDatabase())
  assert.equal(getState().pages[linkedId].database!.linkedSourceId, a)
  const sourceViewId = getState().pages[a].database!.views[0].id
  const shown = actions.adoptSourceView(linkedId, sourceViewId)
  assert.ok(shown)
  assert.equal(actions.adoptSourceView(linkedId, sourceViewId), shown, 'segunda vez só ativa')
  assert.equal(getState().pages[linkedId].database!.views.length, 2)
  assert.ok(await actions.convertLinkedToIndependent(linkedId))
  const own = getState().pages[linkedId].database!
  assert.equal(own.linkedSourceId, undefined)
  assert.equal(selectors.rows(linkedId).length, 2, 'linhas copiadas')
  assert.equal(selectors.rows(a).length, 2, 'fonte intacta')
  assert.equal(own.views.length, 2, 'visões mantidas')
  assert.ok(actions.undoDatabase())
  assert.equal(getState().pages[linkedId].database!.linkedSourceId, a, '⌘Z volta a vincular')
  assert.equal(selectors.rows(linkedId).length, 2, 'mostra de novo as linhas da fonte')
  assert.ok(selectors.rows(a).every((row) => row.parentId === a))
})
