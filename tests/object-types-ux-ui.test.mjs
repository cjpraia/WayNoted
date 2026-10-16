// Interface da descoberta de tipos (jsdom): galeria "Explorar tipos", confirmação de aplicar, guia
// "Página, banco ou tipo?", barra lateral sem contador zero, popover do chip, coleção como página e painel
// simplificado. Asserções só com strings/números/booleans (nunca nós do DOM). docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const model = await import('../src/objecttypes/model.ts')
const visibility = await import('../src/objecttypes/visibility.ts')
const { presetType } = await import('../src/objecttypes/presets.ts')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const person = { ...presetType('person', 'en-US', 1, (() => { let n = 0; return () => `p${n++}` })()), adoptedAt: 1 }
const project = { ...presetType('project', 'en-US', 1, (() => { let n = 0; return () => `j${n++}` })()) }
delete project.adoptedAt
const recipe = { ...presetType('recipe', 'en-US', 1, (() => { let n = 0; return () => `r${n++}` })()) }
delete recipe.adoptedAt
let types = [person, project, recipe]
const page = (id, extra = {}) => ({ id, parentId: null, title: id, text: '', locked: false, trashed: false, updatedAt: 1, ...extra })
let pages = { ana: page('ana', { types: [person.id] }), bia: page('bia', { types: [person.id], typeProps: { [person.properties[0].id]: 'b@x.com' } }), site: page('site') }
let prefs = {}
let missing = 1
const calls = []
const record = (name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(' ')); return name === 'adoptStarterType' ? 'new-id' : undefined }
const settings = () => ({ objectTypes: types, objectTypesPrefs: prefs })
const mocks = {
  Button: ({ variant, className, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-btn' + (variant ? ' np-btn--' + variant : '') + (className ? ' ' + className : ''), ...rest }),
  IconButton: ({ label, className, children, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-icon-btn' + (className ? ' ' + className : ''), 'aria-label': label, ...rest }, children),
  Select: ({ children, value, onChange, ...rest }) => React.createElement('select', { value, onChange, ...rest }, children),
  copyText: async () => {},
  useI18n: () => ({ t, locale: 'en-US' }), useStore: () => ({ pages, settings: settings(), route: { type: 'objectType', id: person.id } }),
  actions: { reportSaveError: () => {}, openPage: record('openPage'), createPage: () => 'np', createDatabase: () => 'nd', setSettingsOpen: () => {}, navigate: record('navigate'), undoDatabase: () => {} },
  PageIcon: ({ value }) => React.createElement('span', { className: 'icon' }, String(value ?? '')),
  BlockIcon: () => null,
  DialogActions: ({ confirmLabel, onConfirm, onCancel }) => React.createElement('div', null, React.createElement('button', { className: 'cancel', onClick: onCancel }, 'Cancel'), React.createElement('button', { className: 'confirm', onClick: onConfirm }, confirmLabel)),
  ...model, ...visibility,
  objectTypes: () => types,
  undoTypes: () => {}, adoptStarterType: record('adoptStarterType'), createType: () => 'scratch', createObject: () => 'obj',
  applySummary: (id) => { const type = types.find((x) => x.id === id); return { name: type.name, fields: type.properties.map((p) => p.name), hasTemplate: true } },
  openTypeCollection: record('openTypeCollection'), openTypesGallery: record('openTypesGallery'), openTypesGuide: record('openTypesGuide'), openTypesManager: record('openTypesManager'),
  patchTypesUi: () => {}, setTypesPrefs: (patch) => { prefs = { ...prefs, ...patch }; calls.push('setTypesPrefs ' + JSON.stringify(patch)) }, showTypesToast: record('toast'), typesPrefs: () => prefs, useTypesUi: () => ({}),
  applyTypeFlow: async (...args) => { record('applyTypeFlow')(...args); return 1 },
  TypesIntro: () => null, typesIntroText: () => 'A type gives any page fields and a template.',
  DND_TYPE: 'x', dragSet: () => [], applyType: () => {}, expandTargets: () => [],
  DbPopover: ({ children }) => React.createElement('div', { className: 'pop' }, children), Menu: ({ children }) => React.createElement('div', null, children),
  MenuItem: ({ label, onClick, hint }) => React.createElement('button', { className: 'mi', onClick }, label, hint ? ` (${hint})` : ''), MenuLabel: ({ children }) => React.createElement('p', { className: 'ml' }, children), MenuSep: () => null,
  PropTypeIcon: () => null, removeType: record('removeType'),
  EmptyState: ({ title, children, action }) => React.createElement('div', { className: 'np-empty' }, React.createElement('b', null, title), children, action),
  TypeCollection: ({ type, empty }) => React.createElement('div', { className: 'coll' }, 'collection of ' + type.name, empty),
  DeleteTypeDialog: ({ type }) => React.createElement('div', { className: 'del-dialog' }, 'delete ' + type.name), Popover: ({ children }) => React.createElement('div', { className: 'pop-menu' }, children), menuKeyNav: () => {},
  moveSidebarType: record('moveSidebarType'), setTypeSidebarHidden: record('setTypeSidebarHidden'), missingNativeCount: () => missing, restoreNative: record('restoreNative'), convertTypeToDatabase: () => ({ dbId: 'db', moved: 0 }), previewTypeToDatabase: () => null,
  normalizeSearch: (s) => s.toLowerCase(),
  ReviewBadge: () => null, ReviewHost: () => null, HarvestNotice: () => null, useHarvests: () => ({ harvests: new Map(), dismissed: {} }), pendingFields: () => [],
  UntypedPages: () => null, useReorder: () => ({ row: () => ({}), grip: () => null, dragId: null }), reorderField: () => {}, moveField: () => {},
}
globalThis.__typesUx = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}=globalThis.__typesUx`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())
const button = (label) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === label)

const gallery = await load('../src/components/objecttypes/TypesGallery.tsx')
const { SidebarTypes } = await load('../src/components/objecttypes/SidebarTypes.tsx')
const { TypeCollectionPage } = await load('../src/components/objecttypes/TypeCollectionPage.tsx')

test('gallery lists ready-made types with fields; “Use” creates only on choice and opens the collection', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(gallery.TypesGallery, { onClose: record('close') })))
  // Só o que ainda não foi criado: Pessoa (já nativo e adotado) não aparece.
  assert.equal(text('.ot-gcard strong').length, 8)
  assert.ok(!text('.ot-gcard strong').includes('Person'), 'created types are not offered again')
  assert.equal(text('.ot-gcard strong')[0], 'Project')
  assert.equal(text('.ot-gcard[data-preset="book"] small')[0], 'Fields: Author, Reading status, Rating +2')
  assert.equal(text('.ot-gcard[data-preset="book"] .np-btn')[0], 'Use')
  await act(async () => button('Restore built-in types').click())
  assert.ok(calls.includes('restoreNative'))
  calls.length = 0
  await act(async () => document.querySelector('.ot-gcard[data-preset="book"] .np-btn').click())
  assert.ok(calls.includes('adoptStarterType book'))
  assert.ok(calls.includes('openTypeCollection new-id'))
  assert.ok(calls.some((call) => call.startsWith('toast Type Book is ready')))
  // With pages: the choice applies the type to them instead.
  calls.length = 0
  await act(async () => root.render(React.createElement(gallery.TypesGallery, { pageIds: ['site'], onClose: () => {} })))
  assert.equal(text('.ot-gcard[data-preset="project"] .np-btn')[0], 'Use')
  const usedAll = types
  types = [person, ...['project', 'meeting', 'book', 'task', 'recipe', 'idea', 'resource', 'company'].map((id) => ({ ...presetType(id, 'en-US', 1), adoptedAt: 1 }))]
  missing = 0
  await act(async () => root.render(React.createElement(gallery.TypesGallery, { onClose: () => {} })))
  assert.equal(text('.ot-gcard').length, 0, 'everything created: the gallery has nothing to offer')
  assert.equal(text('[data-ot="gallery-empty"]').length, 1)
  assert.equal(button('Restore built-in types') === undefined, true)
  types = usedAll; missing = 1
  await act(async () => root.unmount())
})

test('apply dialog explains what changes; “Insert template” and “Don’t ask again” are honoured', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(gallery.ApplyTypeDialog, { pageId: 'site', typeId: project.id, onClose: () => {} })))
  assert.equal(text('#ot-apply-title')[0], 'Apply the Project type?')
  assert.match(text('.ot-dialog p')[0], /add 4 fields \(Status, Deadline, Priority, Owner\) and insert the template at the top/)
  const [template, dontAsk] = document.querySelectorAll('.ot-dialog input[type="checkbox"]')
  assert.equal(template.checked, true)
  await act(async () => template.click())
  assert.match(text('.ot-dialog p')[0], /add 4 fields \(Status, Deadline, Priority, Owner\)\./, 'text follows the checkbox')
  await act(async () => dontAsk.click())
  await act(async () => document.querySelector('.confirm').click())
  assert.ok(calls.some((call) => call.startsWith('setTypesPrefs') && call.includes('"confirmOff":true') && call.includes('"insertTemplate":false')))
  assert.ok(calls.some((call) => call.startsWith(`applyTypeFlow ["site"] ${project.id} false {"confirmed":true,"template":false}`)))
  await act(async () => root.unmount())
})

test('guide “Page, database or type?” shows three cards with an action each', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(gallery.TypesGuide)))
  assert.deepEqual(text('.ot-guide-card h4'), ['Page', 'Database', 'Type'])
  assert.deepEqual(text('.ot-guide-card .np-btn'), ['New page', 'New database', 'Explore types'])
  await act(async () => button('Explore types').click())
  assert.ok(calls.includes('openTypesGallery'))
  await act(async () => root.unmount())
})

test('sidebar lists only types in use or adopted, never a “0”, and opens the collection page', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(SidebarTypes)))
  assert.deepEqual(text('.sb-row-title'), ['Person'], 'unused starters hidden')
  assert.deepEqual(text('.sb-row-count'), ['2'])
  assert.equal(document.querySelector('.sb-row').getAttribute('aria-current'), 'page')
  await act(async () => document.querySelector('.sb-row').click())
  assert.ok(calls.includes(`openTypeCollection ${person.id} false`))
  // Adopted with 0 pages: listed without a counter.
  types = [person, { ...project, adoptedAt: 2 }, recipe]
  await act(async () => root.render(React.createElement(SidebarTypes)))
  assert.deepEqual(text('.sb-row-title'), ['Person', 'Project'])
  assert.deepEqual(text('.sb-row-count'), ['2'])
  types = [person, project, recipe]
  await act(async () => root.unmount())
})

test('sidebar lists native types with 0 pages (no counter) and the item menu hides, moves and deletes', async () => {
  const saved = types
  types = [{ ...person }, ...['project', 'meeting', 'task'].map((id) => ({ ...presetType(id, 'en-US', 1, (() => { let n = 0; return () => `${id}${n++}` })()), adoptedAt: 1 }))]
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(SidebarTypes)))
  assert.deepEqual(text('.sb-row-title'), ['Person', 'Project', 'Meeting', 'Task'], 'used first, then native order')
  assert.deepEqual(text('.sb-row-count'), ['2'], 'zero counters never show')
  // Menu pelo botão de ações do item.
  await act(async () => document.querySelectorAll('.ot-sb-more')[1].click())
  assert.deepEqual(text('.pop-menu .mi'), ['Hide from sidebar', 'Move up', 'Move down', 'Delete type…'])
  await act(async () => button('Hide from sidebar').click())
  assert.ok(calls.includes(`setTypeSidebarHidden ${types[1].id} true`))
  await act(async () => document.querySelectorAll('.ot-sb-more')[2].click())
  await act(async () => button('Move down').click())
  assert.ok(calls.some((call) => call.startsWith('moveSidebarType ') && call.endsWith(' 1')))
  await act(async () => document.querySelectorAll('.ot-sb-more')[3].click())
  await act(async () => button('Delete type…').click())
  assert.equal(text('.del-dialog')[0], 'delete Task')
  // Um tipo marcado como oculto some da barra (a escolha é respeitada).
  types = types.map((type) => type.preset === 'meeting' ? { ...type, sidebarHidden: true } : type)
  await act(async () => root.render(React.createElement(SidebarTypes)))
  assert.deepEqual(text('.sb-row-title'), ['Person', 'Project', 'Task'])
  await act(async () => root.unmount())
  types = saved
})

test('collection page: title, description, “pages stay where they are”, Edit type and an actionable empty state', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(TypeCollectionPage, { typeId: person.id })))
  assert.equal(text('.ot-page-title h1')[0], 'Person')
  assert.equal(text('.ot-page-title p')[0], 'Contacts, colleagues and friends')
  assert.match(text('.ot-page-note')[0], /2 page\(s\) with this type\. Pages stay where they are\. See where/)
  assert.equal(text('.coll')[0].startsWith('collection of Person'), true)
  await act(async () => button('Edit type').click())
  assert.ok(calls.includes(`openTypesManager ${person.id}`))
  await act(async () => root.render(React.createElement(TypeCollectionPage, { typeId: project.id })))
  assert.equal(text('.np-empty b')[0], 'No pages with the Project type yet')
  await act(async () => button('New Project page').click())
  assert.ok(calls.includes('openPage obj'))
  await act(async () => root.render(React.createElement(TypeCollectionPage, { typeId: 'missing' })))
  assert.ok(calls.includes('navigate {"type":"home"}'), 'deleted type goes home')
  await act(async () => root.unmount())
})

test('simplified “Edit type” panel: Fields and Template tabs, Advanced collapsed, link to the collection', async () => {
  Object.assign(mocks, {
    getState: () => ({ pages }), EmojiPicker: () => null, iconLabel: () => '', PropDisplay: () => null, PropertyEditor: () => null, OptionChip: ({ name }) => React.createElement('span', null, name),
    propertyTypeLabel: (type) => type, blocksToText: () => 'Goal', availableTemplates: () => [], FieldTypeMenu: () => null,
    addField: record('addField'), canRedoTypes: () => false, canUndoTypes: () => false, convertField: () => {}, deleteField: () => {}, deleteType: async () => 0, duplicateType: () => {},
    editTemplateAsPage: async () => null, moveField: () => {}, redoTypes: () => {}, setFieldDefault: () => {}, setTemplateBlocks: () => {}, setTemplateFromPage: async () => {}, undoTypes: () => {}, updateField: () => {}, updateType: record('updateType'),
  })
  const { TypeEditorPanel, TypesManager } = await load('../src/components/objecttypes/TypesManager.tsx')
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  await act(async () => root.render(React.createElement(TypeEditorPanel, { typeId: person.id })))
  assert.deepEqual(text('.ot-tab'), ['Fields', 'Template'], 'no “Objects” tab: the collection is a page now')
  assert.equal(document.querySelector('.ot-advanced').open, false, 'advanced options start collapsed')
  assert.equal(text('.ot-advanced summary')[0], 'Advanced')
  assert.match(text('.ot-advanced')[0], /Inherits fields from/)
  assert.equal(document.querySelectorAll('.ot-list').length, 0, 'single type, no list')
  await act(async () => document.querySelector('.ot-detail-pages').click())
  assert.ok(calls.includes(`openTypeCollection ${person.id}`))
  // Manager: unused starters hidden until “Show unused types”.
  await act(async () => root.render(React.createElement(TypesManager, { onOpenPage: () => {} })))
  assert.deepEqual(text('.ot-list-item > span:nth-child(2)').slice(0, 1), ['Person'])
  assert.deepEqual(text('.ot-list-item .ot-count').slice(0, 1), ['2'])
  assert.match(text('.ot-list-toggle')[0], /Show unused types \(2\)/)
  prefs = { showUnused: true }
  await act(async () => root.render(React.createElement(TypesManager, { onOpenPage: () => {} })))
  assert.deepEqual(text('.ot-list-item > span:nth-child(2)').slice(0, 3), ['Person', 'Project', 'Recipe'])
  assert.deepEqual(text('.ot-list-item .ot-count').slice(0, 3), ['2', 'unused', 'unused'])
  prefs = {}
  await act(async () => root.unmount())
})
