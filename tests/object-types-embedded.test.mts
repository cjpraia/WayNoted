// Campo incorporado fora do banco (docs/USAGE.md): o valor guardado em `props` passa a valer em `typeProps`.
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

const pages = () => getState().pages
const types = () => ops.objectTypes()
const { readTypeProps } = await import('../src/objecttypes/model.ts')

function makeDb() {
  const db = actions.createDatabase(null, 'table', { title: 'BD-Emb' })
  const schema = pages()[db].database!
  actions.updatePage(db, { database: { ...schema, properties: [...schema.properties, { id: 'p-nota', name: 'Nota', type: 'text' }] } }, false)
  return db
}

test('incorporar espelha o valor em typeProps e um só desfazer reverte tudo', async () => {
  const db = makeDb()
  const type = ops.createType({ name: 'Emb' })
  const row = actions.createRow(db, { 'p-nota': 'olá' })
  await ops.applyTypeStep(row, type, { template: false, incorporate: ['p-nota'], toast: false })
  assert.equal(pages()[row].typeProps?.['p-nota'], 'olá', 'espelhado')
  assert.equal(pages()[row].props?.['p-nota'], 'olá', 'props intacto')
  ops.undoTypes()
  assert.ok(pages()[row].typeProps?.['p-nota'] === undefined, 'desfeito')
  assert.equal(pages()[row].props?.['p-nota'], 'olá')
  ops.redoTypes()
  assert.equal(pages()[row].typeProps?.['p-nota'], 'olá')
})

test('linha que sai do banco mantém o valor do campo incorporado em typeProps (props vence enquanto no banco)', async () => {
  const db = makeDb()
  const type = ops.createType({ name: 'Emb2' })
  const row = actions.createRow(db, { 'p-nota': 'v1' })
  await ops.applyTypeStep(row, type, { template: false, incorporate: ['p-nota'], toast: false })
  actions.setProp(row, 'p-nota', 'v2') // dentro do banco: props
  assert.equal(pages()[row].props?.['p-nota'], 'v2')
  actions.movePage(row, null)
  assert.equal(pages()[row].typeProps?.['p-nota'], 'v2', 'o valor mais novo (props) migrou')
  const field = types().find((t) => t.id === type)!
  assert.equal(readTypeProps(types(), pages()[row])['p-nota'], 'v2')
  // Fora do banco o campo é do tipo: editar grava em typeProps e limpar não ressuscita o valor antigo de props.
  actions.setProp(row, 'p-nota', null)
  assert.ok(readTypeProps(types(), pages()[row])['p-nota'] === null, 'limpo continua limpo')
  const col = buildTypeCollection(pages(), types(), field, { title: 'Nome' })
  assert.ok(col.rows.find((r) => r.id === row)!.props?.['p-nota'] === null)
})

test('reparentPages também migra; sem duplicar quando já há valor em typeProps', async () => {
  const db = makeDb()
  const type = ops.createType({ name: 'Emb3' })
  const a = actions.createRow(db, { 'p-nota': 'A' })
  const b = actions.createRow(db, { 'p-nota': 'B' })
  await ops.applyTypeStep(a, type, { template: false, incorporate: ['p-nota'], toast: false })
  await ops.applyTypeStep(b, type, { template: false, toast: false })
  actions.reparentPages([a, b], null)
  assert.equal(pages()[a].typeProps?.['p-nota'], 'A')
  assert.equal(pages()[b].typeProps?.['p-nota'], 'B', 'campo vindo só de props (sem espelho anterior)')
  assert.equal(Object.keys(pages()[a].typeProps ?? {}).length, 1, 'sem chaves duplicadas')
})

test('leitura unificada: valor legado só em props aparece fora do banco', () => {
  const type = ops.createType({ name: 'Legado' })
  ops.addField(type, 'text', 'Nota')
  const field = types().find((t) => t.id === type)!.properties[0]
  const page = actions.createPage(null, { title: 'solta', types: [type], props: { [field.id]: 'antigo' } })
  assert.equal(readTypeProps(types(), pages()[page])[field.id], 'antigo')
  const col = buildTypeCollection(pages(), types(), types().find((t) => t.id === type)!, { title: 'Nome' })
  assert.equal(col.rows.find((r) => r.id === page)!.props?.[field.id], 'antigo')
})
