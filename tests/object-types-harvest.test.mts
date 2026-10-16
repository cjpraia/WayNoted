// Campos retroativos (docs/USAGE.md, "Campos retroativos"): descoberta, incorporar em lote, dispensa e caminhos de aplicar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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
const harvest = await import('../src/objecttypes/harvest.ts')
const model = await import('../src/objecttypes/model.ts')

await actions.init()
const pages = () => getState().pages
const types = () => ops.objectTypes()
const prefs = () => getState().settings.objectTypesPrefs ?? {}

/** Banco com Recursos (relação), Criado em, Nota (texto) e uma fórmula; `n` linhas já marcadas com o tipo (vazio). */
function scenario(title: string, rows: number, typeName = title) {
  const db = actions.createDatabase(null, 'table', { title })
  const schema = pages()[db].database!
  const ids = { recursos: `${title}-rec`, criado: `${title}-cri`, nota: `${title}-not`, total: `${title}-tot` }
  actions.updatePage(db, { database: { ...schema, properties: [...schema.properties,
    { id: ids.recursos, name: 'Recursos', type: 'relation', relationDatabaseId: db },
    { id: ids.criado, name: 'Criado em', type: 'createdTime' },
    { id: ids.nota, name: 'Nota', type: 'text' },
    { id: ids.total, name: 'Total', type: 'formula', formula: '1' }] } }, false)
  const typeId = ops.createType({ name: typeName })
  const list: string[] = []
  for (let i = 0; i < rows; i++) list.push(actions.createRow(db, i < 5 ? { [ids.nota]: `n${i}`, [ids.recursos]: [db] } : {}))
  ops.applyType(list, typeId, { toast: false })
  return { db, typeId, rows: list, ids }
}

test('harvest lists database fields the type lacks, with page and filled counts', () => {
  const s = scenario('BD-Tags', 7, 'Tags')
  const h = harvest.harvestType(pages(), types(), s.typeId)
  assert.equal(h.pageCount, 7)
  const byName = new Map(h.fields.map((f) => [f.property.name, f]))
  for (const name of ['Recursos', 'Criado em', 'Nota', 'Tags']) assert.ok(byName.has(name), `${name} found`)
  assert.ok(!byName.has('Total'), 'formula is not harvestable')
  assert.equal(byName.get('Recursos')!.pageIds.length, 7)
  assert.equal(byName.get('Recursos')!.filled, 5)
  assert.equal(byName.get('Criado em')!.filled, 7, 'automatic fields always count as filled')
  assert.equal(byName.get('Nota')!.source, 'database')
})

test('already-has rule: same id, or same name and field type, is skipped', () => {
  const s = scenario('BD-Ja', 3, 'Ja')
  ops.addField(s.typeId, 'text', 'nota')
  ops.updateType(s.typeId, { properties: [...types().find((t) => t.id === s.typeId)!.properties, { id: s.ids.recursos, name: 'Rel', type: 'relation' }] })
  const names = harvest.harvestType(pages(), types(), s.typeId).fields.map((f) => f.property.name)
  assert.ok(!names.includes('Nota') && !names.includes('Recursos'), 'name+type and id both count as present')
  assert.ok(names.includes('Criado em'))
})

test('loose values: page left the database, props and typeProps with a known definition', () => {
  const s = scenario('BD-Solta', 2, 'Solta')
  const loose = actions.createPage(null, { title: 'solta' })
  ops.applyType([loose], s.typeId, { toast: false })
  actions.updatePage(loose, { props: { [s.ids.nota]: 'x', unknown: 'y' }, typeProps: { [s.ids.recursos]: [s.db] } }, false)
  const h = harvest.harvestType(pages(), types(), s.typeId)
  const nota = h.fields.find((f) => f.property.id === s.ids.nota)!
  assert.ok(nota.pageIds.includes(loose))
  assert.equal(h.fields.find((f) => f.property.id === s.ids.recursos)!.source, 'database')
  assert.equal(h.fields.find((f) => f.property.id === 'unknown'), undefined, 'no definition anywhere: cannot become a field')
  assert.equal(h.pageCount, 3)
})

test('incorporate keeps ids and values, mirrors typeProps, never duplicates, one undo for the whole batch', () => {
  const a = scenario('BD-A', 4, 'Alfa')
  const b = scenario('BD-B', 3, 'Beta')
  const fieldIds = (typeId: string, names: string[]) => harvest.harvestType(pages(), types(), typeId).fields.filter((f) => names.includes(f.property.name)).map((f) => f.property.id)
  const total = ops.incorporateHarvested([
    { typeId: a.typeId, fieldIds: fieldIds(a.typeId, ['Recursos', 'Criado em']) },
    { typeId: b.typeId, fieldIds: fieldIds(b.typeId, ['Nota']) },
  ], { toast: false })
  assert.equal(total, 3)
  const alfa = types().find((t) => t.id === a.typeId)!
  assert.deepEqual(alfa.properties.map((p) => p.id), [a.ids.recursos, a.ids.criado])
  assert.equal(types().find((t) => t.id === b.typeId)!.properties[0].id, b.ids.nota)
  const row = pages()[a.rows[0]]
  assert.equal(JSON.stringify(row.props![a.ids.recursos]), JSON.stringify([a.db]), 'props untouched')
  assert.equal(JSON.stringify(row.typeProps![a.ids.recursos]), JSON.stringify([a.db]), 'mirrored to typeProps')
  assert.equal(model.readTypeProps(types(), row)[a.ids.recursos] !== undefined, true)
  assert.equal(pages()[b.rows[0]].typeProps![b.ids.nota], 'n0')
  const again = harvest.harvestType(pages(), types(), a.typeId).fields.map((f) => f.property.name)
  assert.ok(!again.includes('Recursos') && !again.includes('Criado em'), 'no longer offered')
  assert.equal(ops.incorporateHarvested([{ typeId: a.typeId, fieldIds: [a.ids.recursos] }], { toast: false }), 0, 'second run adds nothing (no duplicates)')
  assert.equal(types().find((t) => t.id === a.typeId)!.properties.length, 2)
})

test('undo of a batch reverts every type and mirrored value in one step', () => {
  const a = scenario('BD-U1', 3, 'U1')
  const b = scenario('BD-U2', 3, 'U2')
  const pick = (s: typeof a) => ({ typeId: s.typeId, fieldIds: [s.ids.nota] })
  assert.equal(ops.incorporateHarvested([pick(a), pick(b)], { toast: false }), 2)
  assert.equal(pages()[a.rows[0]].typeProps?.[a.ids.nota], 'n0')
  ops.undoTypes()
  assert.equal(types().find((t) => t.id === a.typeId)!.properties.length, 0)
  assert.equal(types().find((t) => t.id === b.typeId)!.properties.length, 0)
  assert.equal(pages()[a.rows[0]].typeProps?.[a.ids.nota], undefined)
  assert.equal(pages()[b.rows[0]].typeProps?.[b.ids.nota], undefined)
  ops.redoTypes()
  assert.equal(types().find((t) => t.id === b.typeId)!.properties.length, 1)
})

test('dismissal is remembered per type, reopenable, and deleting a field does not bring it back', () => {
  const s = scenario('BD-D', 2, 'Dispensa')
  const h = harvest.harvestType(pages(), types(), s.typeId)
  ops.dismissHarvest(s.typeId, h.fields.map((f) => f.property.id))
  assert.equal(harvest.pendingFields(h, prefs().harvestDismissed?.[s.typeId]).length, 0)
  assert.equal(harvest.reviewList(new Map([[s.typeId, h]]), prefs().harvestDismissed).length, 0)
  assert.equal(harvest.reviewList(new Map([[s.typeId, h]]), prefs().harvestDismissed, true).length, 1)
  ops.restoreHarvest(s.typeId)
  assert.equal(harvest.pendingFields(h, prefs().harvestDismissed?.[s.typeId]).length, h.fields.length)
  ops.incorporateHarvested([{ typeId: s.typeId, fieldIds: [s.ids.nota] }], { toast: false })
  ops.deleteField(s.typeId, s.ids.nota)
  const left = harvest.pendingFields(harvest.harvestType(pages(), types(), s.typeId), prefs().harvestDismissed?.[s.typeId])
  assert.ok(!left.some((f) => f.property.id === s.ids.nota), 'deleted on purpose: stays out')
})

test('same name and type with a different id is flagged and comes unchecked', () => {
  const x = scenario('BD-X1', 2, 'Dup')
  const db2 = actions.createDatabase(null, 'table', { title: 'BD-X2' })
  const schema2 = pages()[db2].database!
  actions.updatePage(db2, { database: { ...schema2, properties: [...schema2.properties, { id: 'other-nota', name: 'Nota', type: 'text' }] } }, false)
  const row = actions.createRow(db2, {})
  ops.applyType([row], x.typeId, { toast: false })
  const notas = harvest.harvestType(pages(), types(), x.typeId).fields.filter((f) => f.property.name === 'Nota')
  assert.equal(notas.length, 2)
  assert.equal(notas.filter((f) => f.duplicateOf).length, 1)
})

test('silent paths (new row with default type, apply without dialog) are covered by the retroactive review', async () => {
  const s = scenario('BD-S', 2, 'Silenciosa')
  ops.setNewRowType(s.db, s.typeId)
  const row = ops.createRowOfType(s.db, s.typeId, { [s.ids.nota]: 'z' })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.ok(pages()[row].types?.includes(s.typeId))
  const h = harvest.harvestType(pages(), types(), s.typeId)
  assert.equal(h.pageCount, 3)
  assert.ok(h.fields.some((f) => f.property.id === s.ids.nota && f.pageIds.includes(row)))
})

test('thousands of pages harvest quickly and deterministically', () => {
  const db = actions.createDatabase(null, 'table', { title: 'BD-Big' })
  const schema = pages()[db].database!
  actions.updatePage(db, { database: { ...schema, properties: [...schema.properties, { id: 'big-a', name: 'A', type: 'text' }, { id: 'big-b', name: 'B', type: 'number' }, { id: 'big-c', name: 'C', type: 'checkbox' }] } }, false)
  const typeId = ops.createType({ name: 'Big' })
  const next = { ...pages() }
  for (let i = 0; i < 3000; i++) next[`big-${i}`] = { id: `big-${i}`, parentId: db, title: `r${i}`, text: '', locked: false, trashed: false, updatedAt: 1, createdAt: 1, icon: null, types: [typeId], props: i % 2 ? { 'big-a': 'x' } : {} } as never
  const started = performance.now()
  const first = harvest.harvestType(next, types(), typeId)
  const elapsed = performance.now() - started
  const second = harvest.harvestType(next, types(), typeId)
  assert.ok(elapsed < 1500, `took ${elapsed}ms`)
  assert.equal(first.pageCount, 3000)
  assert.equal(JSON.stringify(first.fields.map((f) => f.property.id)), JSON.stringify(second.fields.map((f) => f.property.id)))
  assert.equal(first.fields.find((f) => f.property.id === 'big-a')!.filled, 1500)
})

test('no component or action applies a type without the incorporate flow', () => {
  // Fora do módulo de ações e do fluxo central (applyTypeFlow), ninguém chama applyType/applyTypeStep direto.
  // store.ts: ação 'addType' das automações (sem interface; silenciosa, coberta pela revisão retroativa).
  const allowed = new Set(['src/objecttypes/actions.ts', 'src/components/objecttypes/TypePicker.tsx', 'src/store.ts'])
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!/\.(ts|tsx)$/.test(name) || allowed.has(path.replace(/\\/g, '/'))) continue
      if (/\b(applyType|applyTypeStep)\(/.test(readFileSync(path, 'utf8'))) offenders.push(path)
    }
  }
  walk('src')
  assert.equal(offenders.join(','), '')
})
