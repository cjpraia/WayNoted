// Interface dos ajustes pós-teste (jsdom): "Sem tipo (N)" na coleção, diálogo de incorporar campos, alça de
// reordenar (arrastar e ⌥↑/⌥↓) e aba nova de bancos relacionados. Asserções só com strings/números/booleans
// (nunca nós do DOM). docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
// react-dom decide o suporte ao evento `input` ao ser carregado: precisa vir depois de o DOM existir.
const { createRoot } = await import('react-dom/client')
const model = await import('../src/objecttypes/model.ts')
const adjust = await import('../src/objecttypes/adjust.ts')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const type = { id: 'ty', name: 'Tags', icon: null, color: 'blue', description: '', properties: [], template: {}, createdAt: 1, updatedAt: 1, adoptedAt: 1 }
const page = (id, extra = {}) => ({ id, parentId: null, title: id, text: '', locked: false, trashed: false, updatedAt: 1, icon: null, ...extra })
let pages = {}
const calls = []
const record = (name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(' ')) }
const mocks = {
  Button: ({ variant, className, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-btn' + (variant ? ' np-btn--' + variant : '') + (className ? ' ' + className : ''), ...rest }),
  IconButton: ({ label, className, children, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-icon-btn' + (className ? ' ' + className : ''), 'aria-label': label, ...rest }, children),
  Select: ({ children, value, onChange, ...rest }) => React.createElement('select', { value, onChange, ...rest }, children),
  copyText: async () => {},
  useI18n: () => ({ t, locale: 'en-US' }), t, useStore: () => ({ pages, settings: { objectTypes: [type] } }),
  actions: { openPage: record('openPage'), reportSaveError: () => {} },
  PageIcon: () => null, PropTypeIcon: () => null,
  DialogActions: () => null, BlockIcon: () => null, EmptyState: () => null,
  ...model, ...adjust,
  dailyDatabaseId: () => null,
  applyTypeFlow: async (...args) => { record('applyTypeFlow')(...args); return 1 },
  applySummary: () => ({ name: 'Tags', fields: [], hasTemplate: false }),
  useDialogKeys: () => ({ current: null }),
  showToast: record('toast'),
  patchTypesUi: () => {}, openTypesManager: () => {}, openTypesGallery: () => {}, openTypesGuide: () => {}, openTypeCollection: () => {}, setTypesPrefs: () => {}, showTypesToast: () => {}, typesPrefs: () => ({}), useTypesUi: () => ({}),
  adoptStarterType: () => 'x', createType: () => 'x', undoTypes: () => {}, TypesIntro: () => null, typesIntroText: () => '', fieldSummary: () => '', galleryEntries: () => [],
}
globalThis.__adjustUi = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}=globalThis.__adjustUi`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())
const button = (label) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === label)
const root = createRoot(document.getElementById('app'))
const render = (element) => act(async () => root.render(element))
const change = (el, value) => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }

const { UntypedPages, UNTYPED_PAGE } = await load('../src/components/objecttypes/UntypedPages.tsx')
const { useReorder } = await load('../src/components/objecttypes/useReorder.tsx')
mocks.useReorder = useReorder
const { IncorporateDialog } = await load('../src/components/objecttypes/TypesGallery.tsx')

test('“No type (N)” is collapsed, searchable, applies one page or a selection, and pages the list', async () => {
  pages = { typed: page('typed', { types: ['ty'] }), ana: page('ana', { title: 'Ana' }), bia: page('bia', { title: 'Bia' }) }
  for (let i = 0; i < 60; i++) pages[`n${i}`] = page(`n${i}`, { title: `Nota ${i}`, updatedAt: 100 - i })
  await render(React.createElement(UntypedPages, { type, pathOf: () => 'Private' }))
  assert.equal(texts('.ot-untyped-head span')[0], 'No type (62)', 'typed page not counted')
  assert.equal(document.querySelectorAll('.ot-untyped-row').length, 0, 'collapsed by default')
  assert.equal(document.querySelector('.ot-untyped-head').getAttribute('aria-expanded'), 'false')
  await act(async () => document.querySelector('.ot-untyped-head').click())
  assert.equal(document.querySelectorAll('.ot-untyped-row').length, UNTYPED_PAGE, 'first page only')
  const more = () => [...document.querySelectorAll('button')].find((el) => el.textContent.startsWith('Load 12 more'))
  assert.ok(more() !== undefined, 'load more shows the rest')
  await act(async () => more().click())
  assert.equal(document.querySelectorAll('.ot-untyped-row').length, 62)
  // Busca.
  await act(async () => change(document.querySelector('.ot-untyped-search'), 'ana'))
  assert.deepEqual(texts('.ot-untyped-title span'), ['Ana'])
  calls.length = 0
  if (!document.querySelector('.ot-untyped-row .np-btn')) throw new Error(document.querySelector('.ot-untyped-row').outerHTML.slice(0,600))
  await act(async () => document.querySelector('.ot-untyped-row .np-btn').click())
  assert.equal(calls[0], 'applyTypeFlow ["ana"] ty')
  // Seleção múltipla.
  await act(async () => change(document.querySelector('.ot-untyped-search'), ''))
  await act(async () => document.querySelector('.ot-untyped-all input').click())
  assert.ok(button('Apply Tags to 50 page(s)') !== undefined, 'select all = the shown page')
  await act(async () => change(document.querySelector('.ot-untyped-search'), 'bia'))
  await act(async () => document.querySelector('.ot-untyped-row input').click())
  calls.length = 0
  await act(async () => button('Apply Tags to 51 page(s)').click())
  assert.ok(calls[0].startsWith('applyTypeFlow ["') && calls[0].endsWith('] ty') && calls[0].includes('"bia"'), 'batch goes through the same apply flow')
  assert.equal(document.querySelector('.ot-untyped-all input').checked, false, 'selection cleared after applying')
})

test('incorporate dialog: all fields start checked; “Add selected” passes ids, “Don’t add” passes none', async () => {
  const fields = [{ property: { id: 'p1', name: 'Etiquetas', type: 'multiSelect' }, pageIds: ['a'], filled: 1 }, { property: { id: 'p2', name: 'Nota', type: 'text' }, pageIds: ['a'], filled: 0 }]
  calls.length = 0
  await render(React.createElement(IncorporateDialog, { pageIds: ['a'], typeId: 'ty', includeChildren: false, fields, options: {}, onClose: record('close') }))
  assert.deepEqual(texts('.ot-inc-list li span'), ['Etiquetas', 'Nota'])
  assert.equal([...document.querySelectorAll('.ot-inc-list input')].every((el) => el.checked), true)
  assert.equal(texts('.ot-dialog h3')[0], 'Add the page’s fields to the type?')
  await act(async () => document.querySelectorAll('.ot-inc-list input')[1].click())
  await act(async () => button('Add selected').click())
  assert.ok(calls.some((c) => c.startsWith('applyTypeFlow ["a"] ty false') && c.includes('"incorporate":["p1"]') && c.includes('"confirmed":true')), calls.join(' | '))
  calls.length = 0
  await act(async () => button('Don’t add').click())
  assert.ok(calls.some((c) => c.includes('"incorporate":[]')), calls.join(' | '))
})

test('reorder handle: drag and drop calls onMove with before/after; Alt+Arrow calls onStep; no handle when disabled', async () => {
  const moves = []
  function Rows({ enabled = true }) {
    const reorder = useReorder((id, target, after) => moves.push(`move ${id} ${target} ${after}`), (id, delta) => moves.push(`step ${id} ${delta}`), { enabled })
    return React.createElement('div', null, ['a', 'b', 'c'].map((id) => React.createElement('div', { key: id, id: `row-${id}`, ...reorder.row(id) }, reorder.grip(id, id.toUpperCase()))))
  }
  await render(React.createElement(Rows))
  const grips = document.querySelectorAll('button.ot-grip')
  assert.equal(grips.length, 3)
  assert.equal(grips[0].getAttribute('draggable'), 'true')
  assert.ok(grips[0].getAttribute('aria-label').includes('⌥↑'), 'keyboard hint in the label')
  const dt = { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' }
  const fire = (el, type, extra = {}) => act(async () => { const event = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { dataTransfer: dt, clientY: 0, ...extra }); el.dispatchEvent(event) })
  await fire(grips[0], 'dragstart')
  const target = document.getElementById('row-c')
  target.getBoundingClientRect = () => ({ top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100 })
  await fire(target, 'dragover', { clientY: 15 })
  assert.equal(target.getAttribute('data-drop'), 'after', 'drop indicator below the lower half')
  assert.equal(document.getElementById('row-a').getAttribute('data-dragging'), 'true')
  await fire(target, 'drop')
  assert.deepEqual(moves, ['move a c true'])
  assert.equal(document.getElementById('row-c').getAttribute('data-drop'), null, 'indicator cleared')
  moves.length = 0
  await act(async () => grips[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })))
  await act(async () => grips[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })))
  await act(async () => grips[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  assert.deepEqual(moves, ['step b -1', 'step b 1'], 'plain arrows do nothing')
  await render(React.createElement(Rows, { enabled: false }))
  assert.equal(document.querySelectorAll('button.ot-grip').length, 0)
})

test('new related-database tab is named after its database, filtered by the relation, and never a generic “New tab”', async () => {
  const { newTab } = await load('../src/components/database/RowLayoutSettings.tsx')
  const projects = { id: 'projects', title: 'BD-Projetos', database: { properties: [{ id: 'title', name: 'Name', type: 'title' }] } }
  const tasks = { id: 'tasks', title: 'BD-Tarefas', database: { properties: [{ id: 'rel', name: 'Projeto', type: 'relation', relationDatabaseId: 'projects' }] } }
  const notes = { id: 'notes', title: 'BD-Notas', database: { properties: [] } }
  let tab = newTab('projects', [projects, notes, tasks])
  assert.equal(tab.name, 'BD-Tarefas')
  assert.equal(tab.databaseId, 'tasks')
  assert.equal(tab.relationPropertyId, 'rel', 'only rows related to the open page')
  tab = newTab('projects', [projects, notes])
  assert.equal(tab.databaseId, 'notes', 'no relation: another database, not itself')
  assert.equal(tab.relationPropertyId, undefined)
  tab = newTab('projects', [projects])
  assert.equal(tab.databaseId, 'projects')
  assert.notEqual(tab.name, 'New tab')
  assert.notEqual(tab.name, 'Nova aba')
})
