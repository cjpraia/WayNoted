// UX dos tipos (docs/USAGE.md): aplicar com aviso e desfazer que inclui o corpo, tipos prontos ocultos
// sem apagar nada (migração), galeria, remover descartando valores, rota da coleção e ponte para banco.
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
const { presetType } = await import('../src/objecttypes/presets.ts')
const visibility = await import('../src/objecttypes/visibility.ts')
const bridge = await import('../src/objecttypes/bridge.ts')
const { clearToasts, visibleToasts } = await import('../src/components/ui/toastQueue.ts')

await actions.init()
const docText = (id: string) => JSON.stringify(documents.get(id) ?? [])
const para = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })

test('old workspace with 7 starter types and 2 in use: only those 2 are listed; nothing is deleted', () => {
  // Simula dados antigos: os 7 prontos criados em lote, sem `adoptedAt`.
  const old = (['person', 'project', 'meeting', 'book', 'task', 'recipe', 'idea'] as const).map((id) => { const type = presetType(id, 'pt-BR'); delete type.adoptedAt; return type })
  actions.updateSettings({ objectTypes: old })
  const person = old[0].id, project = old[1].id
  const ana = actions.createPage(null, { title: 'Ana' }), bia = actions.createPage(null, { title: 'Bia' }), site = actions.createPage(null, { title: 'Site' })
  ops.applyType([ana, bia], person, { toast: false })
  ops.applyType([site], project, { toast: false })
  const listed = visibility.sidebarTypes(getState().pages, ops.objectTypes())
  assert.deepEqual(listed.map((entry) => entry.type.name), ['Pessoa', 'Projeto'], 'by usage, no zero counters')
  assert.deepEqual(listed.map((entry) => entry.count), [2, 1])
  assert.equal(visibility.hiddenStarterTypes(getState().pages, ops.objectTypes()).length, 5)
  assert.equal(ops.objectTypes().length, 7, 'hidden, not deleted')
})

test('gallery: entries know which starters are adopted; “Use” shows a hidden one again without duplicating', () => {
  const entries = visibility.allGalleryEntries(getState().pages, ops.objectTypes(), 'pt-BR')
  assert.equal(entries.length, 9)
  const person = entries.find((entry) => entry.preset === 'person')!
  assert.equal(person.adopted, true)
  assert.equal(visibility.fieldSummary(person.fields), 'E-mail, Telefone, Empresa +2')
  const book = entries.find((entry) => entry.preset === 'book')!
  assert.equal(book.adopted, false)
  const id = ops.adoptStarterType('book')!
  assert.equal(id, book.existing!.id, 'reuses the hidden type')
  assert.equal(ops.objectTypes().length, 7)
  assert.ok(visibility.sidebarTypes(getState().pages, ops.objectTypes()).some((entry) => entry.type.id === id), 'adopted type listed even with 0 pages')
})

test('new workspace: no types until the user picks one in the gallery', () => {
  actions.updateSettings({ objectTypes: [] })
  assert.equal(visibility.sidebarTypes(getState().pages, ops.objectTypes()).length, 0)
  const id = ops.adoptStarterType('person')!
  assert.equal(ops.objectTypes().length, 1, 'created only on choice')
  assert.ok(ops.objectTypes()[0].adoptedAt)
  assert.equal(visibility.sidebarTypes(getState().pages, ops.objectTypes())[0].type.id, id)
})

test('applyTypeStep: fields + icon (only without own icon) + template at the top; one undo reverts all, body included', async () => {
  const project = ops.adoptStarterType('project')!
  const page = actions.createPage(null, { title: 'teste1' })
  await native.saveDoc(page, [para('mine', 'meu texto')])
  clearToasts()
  const result = await ops.applyTypeStep(page, project, { template: true })
  assert.deepEqual(result, { applied: true, fields: 4, template: true, icon: true })
  assert.deepEqual(getState().pages[page].types, [project])
  assert.equal(getState().pages[page].icon, ops.objectTypes().find((t) => t.id === project)!.icon)
  const doc = documents.get(page) as { id: string }[]
  assert.ok(docText(page).includes('Objetivo'))
  assert.equal(doc[doc.length - 1].id, 'mine', 'template goes before the existing text')
  assert.equal(visibleToasts()[0].message, 'Tipo Projeto aplicado · 4 campos · modelo inserido')
  assert.equal(visibleToasts()[0].actionLabel, 'Desfazer')
  // O desfazer do aviso tira campos, ícone e os blocos do modelo; o texto do usuário fica.
  visibleToasts()[0].onAction!()
  await ops.typesBodySettled()
  assert.equal(getState().pages[page].types, undefined)
  assert.equal(getState().pages[page].icon ?? null, null)
  assert.ok(!docText(page).includes('Objetivo'), 'template removed from the body')
  assert.ok(docText(page).includes('meu texto'))
  ops.redoTypes()
  await ops.typesBodySettled()
  assert.deepEqual(getState().pages[page].types, [project])
  assert.ok(docText(page).includes('Objetivo'), 'redo puts the template back')
})

test('applyTypeStep keeps the page icon, replaces an empty body, and skips the template when unchecked', async () => {
  const person = ops.objectTypes().find((t) => t.preset === 'person')!.id
  const withIcon = actions.createPage(null, { title: 'Eliane', icon: '🙂' })
  const r1 = await ops.applyTypeStep(withIcon, person, { template: true })
  assert.equal(r1.icon, false)
  assert.equal(getState().pages[withIcon].icon, '🙂')
  assert.ok(docText(withIcon).includes('Sobre'), 'empty body receives the template')
  const plain = actions.createPage(null, { title: 'Elza' })
  const r2 = await ops.applyTypeStep(plain, person, { template: false, toast: false })
  assert.equal(r2.template, false)
  assert.ok(!docText(plain).includes('Sobre'))
  assert.deepEqual(await ops.applyTypeStep(plain, person), { applied: false, fields: 0, template: false, icon: false }, 'already typed')
})

test('remove type: keep values (restorable) or discard them', () => {
  const person = ops.objectTypes().find((t) => t.preset === 'person')!
  const email = person.properties.find((p) => p.type === 'email')!.id
  const a = actions.createPage(null, { title: 'A' }), b = actions.createPage(null, { title: 'B' })
  ops.applyType([a, b], person.id, { toast: false })
  actions.setProp(a, email, 'a@x.com'); actions.setProp(b, email, 'b@x.com')
  ops.removeType([a], person.id)
  assert.equal(getState().pages[a].typeProps![email], 'a@x.com', 'kept')
  ops.removeType([b], person.id, { discard: true })
  assert.equal(getState().pages[b].typeProps?.[email], undefined, 'discarded')
  ops.undoTypes()
  assert.equal(getState().pages[b].typeProps![email], 'b@x.com', 'undo brings values back')
})

test('collection route is valid only while the type exists', () => {
  const person = ops.objectTypes().find((t) => t.preset === 'person')!.id
  actions.navigate({ type: 'objectType', id: person })
  assert.deepEqual(getState().route, { type: 'objectType', id: person })
  actions.navigate({ type: 'objectType', id: 'missing' })
  assert.equal(getState().route.type, 'home')
})

test('bridge: “Turn into a database” makes the type pages rows of a new database (fields kept), and ⌘Z restores', () => {
  const kind = ops.createType({ name: 'Contato' })
  const phone = ops.addField(kind, 'phone', 'Telefone')!
  const parent = actions.createPage(null, { title: 'pessoas - testes' })
  const x = actions.createPage(parent, { title: 'X' }), y = actions.createPage(null, { title: 'Y' })
  ops.applyType([x, y], kind, { toast: false })
  actions.setProp(x, phone, '1234')
  const preview = bridge.previewTypeToDatabase(kind)!
  assert.equal(preview.title, 'Contatos')
  assert.deepEqual(preview.eligible.map((p) => p.id).sort(), [x, y].sort())
  const { dbId, moved } = bridge.convertTypeToDatabase(kind)
  assert.equal(moved, 2)
  const db = getState().pages[dbId]
  assert.ok(db.database!.properties.some((p) => p.id === phone), 'type field became a property (same id)')
  assert.equal(getState().pages[x].parentId, dbId)
  assert.equal(getState().pages[x].props![phone], '1234')
  assert.deepEqual(getState().pages[x].types, [kind], 'type stays applied')
  actions.undoDatabase()
  assert.equal(getState().pages[x].parentId, parent, 'undo puts the page back where it was')
  assert.equal(getState().pages[y].parentId, null)
})
