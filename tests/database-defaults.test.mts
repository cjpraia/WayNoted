import test from 'node:test'
import assert from 'node:assert/strict'

// Padrões de bancos: nada de agrupamento/propriedades automáticos que o usuário não pediu; ⌘Z de banco.
const native = {
  async loadMeta() { return null }, async saveMeta() {},
  async loadDoc() { return [] }, async saveDoc() {}, async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {},
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { addProperty, convertProperty, deleteProperty } = await import('../src/components/database/schemaOps.ts')
const schemaOf = (id: string) => getState().pages[id].database!
const types = (id: string) => schemaOf(id).properties.map((p) => p.type).join(',')

test('banco novo = Nome + Tags; Status só no quadro e Data só em calendário/linha do tempo', async () => {
  await actions.init()
  assert.equal(types(actions.createDatabase(null)), 'title,multiSelect')
  assert.equal(types(actions.createDatabase(null, 'list')), 'title,multiSelect')
  const board = actions.createDatabase(null, 'board')
  assert.equal(types(board), 'title,status,multiSelect')
  assert.equal(schemaOf(board).views[0].groupBy, schemaOf(board).properties[1].id)
  const cal = actions.createDatabase(null, 'calendar')
  assert.equal(types(cal), 'title,multiSelect,date')
  assert.equal(schemaOf(cal).views[0].dateProp, schemaOf(cal).properties[2].id)
  assert.equal(schemaOf(actions.createDatabase(null)).views[0].groupBy ?? null, null)
})

test('adicionar Status/Seleção não agrupa tabelas; o quadro continua agrupando', async () => {
  const id = actions.createDatabase(null)
  actions.addView(id, 'board')
  assert.ok(schemaOf(id).properties.some((p) => p.type === 'status'), 'quadro sem Status ganha um')
  actions.addView(id, 'list'); actions.addView(id, 'gallery')
  const before = schemaOf(id).views.length
  addProperty(id, 'status'); addProperty(id, 'select')
  assert.equal(schemaOf(id).views.length, before)
  for (const view of schemaOf(id).views) {
    if (view.type === 'board') assert.ok(!!view.groupBy)
    else assert.ok(!view.groupBy, `${view.type} não deve agrupar`)
  }
})

test('remover/converter a propriedade de agrupamento desliga o agrupamento da tabela', async () => {
  const id = actions.createDatabase(null)
  const sel = addProperty(id, 'select'), other = addProperty(id, 'status')
  const table = schemaOf(id).views[0].id
  actions.updateView(id, table, { groupBy: sel })
  actions.addView(id, 'board')
  deleteProperty(id, sel)
  const views = schemaOf(id).views
  assert.ok(!views.find((x) => x.id === table)!.groupBy, 'tabela sem agrupamento')
  assert.equal(views.find((x) => x.type === 'board')!.groupBy, other, 'quadro troca para outra propriedade')
  actions.updateView(id, table, { groupBy: other })
  convertProperty(id, other, 'text')
  assert.ok(!schemaOf(id).views.find((x) => x.id === table)!.groupBy)
})

test('⌘Z de banco desfaz célula, exclusão de linha e exclusão de propriedade', async () => {
  const id = actions.createDatabase(null)
  const num = addProperty(id, 'number')
  const row = actions.createRow(id, {}, { title: 'L' })
  actions.setProp(row, num, 5)
  assert.equal(getState().pages[row].props[num], 5)
  assert.ok(actions.undoDatabase())
  assert.ok(getState().pages[row].props?.[num] === undefined)
  assert.ok(actions.redoDatabase())
  assert.equal(getState().pages[row].props[num], 5)
  actions.setProp(row, num, 7)
  deleteProperty(id, num)
  assert.ok(!schemaOf(id).properties.some((p) => p.id === num))
  assert.ok(actions.undoDatabase())
  assert.ok(schemaOf(id).properties.some((p) => p.id === num))
  assert.equal(getState().pages[row].props[num], 7, 'o valor volta junto com a propriedade')
  actions.trashPage(row)
  assert.equal(getState().pages[row].trashed, true)
  assert.ok(actions.undoDatabase())
  assert.equal(getState().pages[row].trashed, false)
})
