// Tipos nativos desde o início (docs/USAGE.md): semeadura única e idempotente, sem duplicar por preset,
// sem recriar o excluído, nome pelo idioma, ordem da barra lateral e galeria só com o que falta.
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const stored: { meta: unknown } = { meta: null }
const native = {
  async loadMeta() { return stored.meta },
  async saveMeta(meta: unknown) { stored.meta = structuredClone(meta) },
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { seedNativeTypes, restoreNativeTypes, missingNativePresets } = await import('../src/objecttypes/native.ts')
const { NATIVE_PRESETS, presetType } = await import('../src/objecttypes/presets.ts')
const visibility = await import('../src/objecttypes/visibility.ts')
const { normalizeObjectTypes } = await import('../src/objecttypes/model.ts')
const { actions, getState } = await import('../src/store.ts')
const ops = await import('../src/objecttypes/actions.ts')

const ids = () => { let n = 0; return () => `id${n++}` }

test('new workspace: all 8 native types are created, adopted, in native order, in the app language', () => {
  const seed = seedNativeTypes(undefined, undefined, 'en-US', 10, ids())!
  assert.deepEqual(seed.types.map((t) => t.name), ['Person', 'Project', 'Meeting', 'Task', 'Book', 'Idea', 'Resource', 'Company'])
  assert.deepEqual(seed.types.map((t) => t.preset), [...NATIVE_PRESETS])
  assert.ok(seed.types.every((t) => t.adoptedAt === 10))
  assert.equal(seed.prefs.nativeTypesSeeded, true)
  assert.ok(!seed.types.some((t) => t.preset === 'recipe'), 'Recipe stays gallery-only')
  const pt = seedNativeTypes([], {}, 'pt-BR', 10, ids())!
  assert.equal(pt.types[6].name, 'Recurso'); assert.equal(pt.types[7].name, 'Empresa')
  const resource = pt.types[6]
  assert.deepEqual(resource.properties.map((p) => p.name), ['URL', 'Fonte', 'Status de leitura', 'Nota', 'Tags'])
  assert.deepEqual(resource.properties[2].options!.map((o) => o.group), ['todo', 'progress', 'complete'])
  assert.equal(resource.properties[4].type, 'multiSelect')
  assert.deepEqual(pt.types[7].properties.map((p) => p.type), ['url', 'select', 'text', 'text'])
})

test('idempotent: the flag makes a second run a no-op', () => {
  const first = seedNativeTypes([], {}, 'pt-BR', 1, ids())!
  assert.equal(seedNativeTypes(first.types, first.prefs, 'pt-BR', 2, ids()), null)
})

test('existing workspace: matches by preset id (never by name), keeps user types, fills only what is missing', () => {
  const user = { ...presetType('person', 'pt-BR', 1, ids()), name: 'Tags', adoptedAt: 1 } // preset person, nome do usuário
  const plainResource = { ...presetType('book', 'pt-BR', 1, ids()), id: 'mine', name: 'Recurso', preset: undefined, adoptedAt: 1 } // "Recurso" do usuário, sem preset
  delete (plainResource as { preset?: string }).preset
  const legacy = (() => { const t = presetType('project', 'pt-BR', 1, ids()); delete t.adoptedAt; return t })() // legado oculto
  const recipe = (() => { const t = presetType('recipe', 'pt-BR', 1, ids()); delete t.adoptedAt; return t })()
  const seed = seedNativeTypes([user, plainResource, legacy, recipe], {}, 'pt-BR', 5, ids())!
  assert.equal(seed.types.filter((t) => t.preset === 'person').length, 1, 'no duplicate Person')
  assert.equal(seed.types.find((t) => t.preset === 'person')!.name, 'Tags', 'user type untouched')
  assert.equal(seed.types.find((t) => t.id === 'mine')!.name, 'Recurso', 'user "Recurso" untouched')
  const nativeResource = seed.types.find((t) => t.preset === 'resource')!
  assert.notEqual(nativeResource.id, 'mine'); assert.equal(nativeResource.name, 'Recurso (nativo)', 'created despite the name clash, disambiguated')
  assert.ok(seed.types.find((t) => t.preset === 'project')!.adoptedAt, 'legacy hidden starter becomes visible')
  assert.equal(seed.types.find((t) => t.preset === 'recipe')!.adoptedAt, undefined, 'recipe stays hidden')
  assert.equal(seed.types.length, 4 + 8 - 2, 'person and project reused')
})

test('a type the user deleted is not recreated; restore recreates it', () => {
  const seed = seedNativeTypes([], { nativeTypesDismissed: ['company'] }, 'en-US', 1, ids())!
  assert.ok(!seed.types.some((t) => t.preset === 'company'))
  assert.deepEqual(missingNativePresets(seed.types), ['company'])
  const restored = restoreNativeTypes(seed.types, seed.prefs, 'en-US', 2, ids())
  assert.equal(restored.created.length, 1)
  assert.equal(restored.types.at(-1)!.name, 'Company')
  assert.equal(restored.prefs.nativeTypesDismissed, undefined)
  assert.equal(restoreNativeTypes(restored.types, restored.prefs, 'en-US', 3, ids()).created.length, 0, 'restore is idempotent')
})

test('old data without the new fields loads: normalizer tolerates missing/invalid sidebarHidden', () => {
  const [a, b] = normalizeObjectTypes([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', sidebarHidden: true }])
  assert.equal(a.sidebarHidden, undefined); assert.equal(b.sidebarHidden, true)
})

test('store: opening a fresh workspace seeds once; delete is remembered; hide and move are respected', async () => {
  await actions.init()
  const types = () => ops.objectTypes()
  assert.equal(types().length, 8)
  assert.equal(getState().settings.objectTypesPrefs?.nativeTypesSeeded, true)
  assert.equal(ops.ensureNativeTypes(), false, 'second run is a no-op')
  assert.equal(types().length, 8)
  // Barra lateral: sempre os nativos, mesmo com 0 páginas, na ordem nativa.
  const side = () => visibility.sidebarSectionTypes(getState().pages, types(), getState().settings.objectTypesPrefs)
  assert.deepEqual(side().map((e) => e.type.preset), [...NATIVE_PRESETS])
  assert.ok(side().every((e) => e.count === 0))
  // Uso reordena: Livro com 2 páginas sobe.
  const book = types().find((t) => t.preset === 'book')!.id
  ops.applyType([actions.createPage(null, { title: 'L1' }), actions.createPage(null, { title: 'L2' })], book, { toast: false })
  assert.equal(side()[0].type.id, book); assert.equal(side()[0].count, 2)
  // Ocultar.
  const idea = types().find((t) => t.preset === 'idea')!.id
  ops.setTypeSidebarHidden(idea, true)
  assert.ok(!side().some((e) => e.type.id === idea)); assert.equal(types().length, 8, 'hidden, not deleted')
  ops.setTypeSidebarHidden(idea, false)
  assert.ok(side().some((e) => e.type.id === idea))
  // Mover (ordem manual respeitada).
  const order = side().map((e) => e.type.id)
  ops.moveSidebarType(order, order[1], -1)
  assert.equal(side()[0].type.id, order[1])
  // Galeria: só presets não criados (Receita).
  assert.deepEqual(visibility.galleryEntries(getState().pages, types(), 'en-US').map((e) => e.preset), ['recipe'])
  // Excluir: some, fica lembrado e a galeria passa a oferecê-lo; Restaurar recria.
  const company = types().find((t) => t.preset === 'company')!.id
  await ops.deleteType(company, 'remove')
  assert.ok(!types().some((t) => t.id === company))
  assert.deepEqual(getState().settings.objectTypesPrefs?.nativeTypesDismissed, ['company'])
  assert.deepEqual(visibility.galleryEntries(getState().pages, types(), 'en-US').map((e) => e.preset).sort(), ['company', 'recipe'])
  assert.equal(ops.missingNativeCount(), 1)
  assert.equal(ops.restoreNative(), 1)
  assert.ok(types().some((t) => t.preset === 'company'))
  assert.equal(getState().settings.objectTypesPrefs?.nativeTypesDismissed, undefined)
})
