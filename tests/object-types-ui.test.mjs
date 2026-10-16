// Interface dos tipos de objeto (jsdom): cabeçalho com chips, campos do tipo, valores guardados e
// sugestão por #tag. Asserções só com strings/números/booleans (nunca nós do DOM).
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

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const BOOK = 'book', PERSON = 'person'
let types = model.normalizeObjectTypes([
  { id: BOOK, name: 'Livro', icon: '📚', color: 'brown', description: 'Leituras', properties: [{ id: 'author', name: 'Autor', type: 'text' }, { id: 'rating', name: 'Nota', type: 'number' }] },
  { id: PERSON, name: 'Pessoa', icon: '👤', color: 'blue', properties: [{ id: 'email', name: 'E-mail', type: 'email' }] },
])
let page = { id: 'p1', parentId: null, title: 'Duna #Pessoa', text: '', locked: false, types: [BOOK], typeProps: { author: 'Frank Herbert', gone: 'valor antigo' } }
const calls = []
const record = (name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(' ')) }
const mocks = {
  Button: ({ variant, className, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-btn' + (variant ? ' np-btn--' + variant : '') + (className ? ' ' + className : ''), ...rest }),
  IconButton: ({ label, className, children, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-icon-btn' + (className ? ' ' + className : ''), 'aria-label': label, ...rest }, children),
  Select: ({ children, value, onChange, ...rest }) => React.createElement('select', { value, onChange, ...rest }, children),
  copyText: async () => {},
  useI18n: () => ({ t, locale: 'en-US' }), useStore: () => ({ pages: { p1: page } }),
  actions: { setProp: record('setProp'), reportSaveError: () => {} },
  selectors: { parentDatabase: () => undefined },
  PropDisplay: ({ value }) => React.createElement('span', { className: 'value' }, String(value)), PropTypeIcon: () => null, PropertyEditor: () => null, openUrl: () => {},
  resolveValue: (row, prop) => row.props?.[prop.id] ?? null, isComputedProperty: () => false,
  DbPopover: ({ children }) => React.createElement('div', { className: 'pop' }, children), Menu: ({ children }) => React.createElement('div', null, children),
  MenuItem: ({ label, onClick }) => React.createElement('button', { className: 'mi', onClick }, label), MenuLabel: ({ children }) => React.createElement('p', null, children), MenuSep: () => null,
  propertyTypeLabel: (type) => type,
  PageIcon: ({ value }) => React.createElement('span', { className: 'icon' }, value),
  ...model,
  objectTypes: () => types, addField: record('addField'), convertField: record('convertField'), deleteField: record('deleteField'), purgeOrphans: record('purgeOrphans'), removeType: record('removeType'), updateField: record('updateField'),
  restorableTypes: () => [],
  openTypesManager: record('openTypesManager'), openTypeCollection: record('openTypeCollection'),
  TypePicker: ({ pageIds }) => React.createElement('div', { className: 'picker' }, 'picker for ' + pageIds.join(',')),
  applyTypeFlow: async (...args) => { record('applyTypeFlow')(...args) },
}
Object.assign(mocks, { useReorder: () => ({ row: () => ({}), grip: () => null, dragId: null }), reorderField: () => {}, moveField: () => {} })
globalThis.__objectTypesUi = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__objectTypesUi`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const { TypeHeader, TypeFields, TypeTagSuggestion, TypeChipPopover } = await load('../src/components/objecttypes/PageTypes.tsx')
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())

test('header shows a colored chip per type and the “+ Type” button; × removes the type', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TypeHeader, { page, locked: false })))
  assert.deepEqual(text('.ot-chip .ot-chip-name'), ['Livro'])
  assert.equal(document.querySelector('.ot-chip').className.includes('db-color-brown'), true)
  assert.equal(text('.ot-add')[0], 'Type')
  await act(async () => document.querySelector('.ot-add').click())
  assert.equal(text('.picker')[0], 'picker for p1')
  await act(async () => document.querySelector('.ot-chip-x').click())
  assert.ok(calls.includes('removeType ["p1"] book'))
  await act(async () => root.render(React.createElement(TypeHeader, { page: { ...page, types: undefined }, locked: true })))
  assert.equal(document.querySelectorAll('.ot-head').length, 0, 'locked page without types shows nothing')
  await act(async () => root.unmount())
})

test('fields panel lists the type fields with values, edits checkbox in place and offers to discard kept values', async () => {
  const root = createRoot(document.getElementById('app'))
  dom.window.confirm = () => true
  await act(async () => root.render(React.createElement(TypeFields, { page, locked: false })))
  assert.deepEqual(text('.dbv-rp-name'), ['Autor', 'Nota'])
  assert.deepEqual(text('.dbv-rp-value .value'), ['Frank Herbert'])
  assert.deepEqual(text('.dbv-rp-empty'), ['Empty'])
  assert.match(text('.ot-orphans')[0], /1 kept value/)
  const discard = [...document.querySelectorAll('.ot-orphans button')].find((el) => el.textContent === 'Discard')
  await act(async () => discard.click())
  assert.ok(calls.includes('purgeOrphans p1'))
  await act(async () => [...document.querySelectorAll('.dbv-rp-add')][0].click())
  assert.equal(document.querySelectorAll('.pop').length, 1, 'field type menu opens')
  await act(async () => root.render(React.createElement(TypeFields, { page: { ...page, passwordLock: { rootId: 'p1', hideTitle: false } }, locked: false })))
  assert.equal(text('.ot-locked')[0], 'Fields hidden while the page is locked.')
  assert.equal(document.querySelectorAll('.dbv-rp-value').length, 0, 'no values while locked')
  await act(async () => root.unmount())
})

test('#tag suggestion offers the matching type and applies it; dismiss hides it', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TypeTagSuggestion, { page, locked: false })))
  assert.match(text('.ot-suggest')[0], /#Pessoa/)
  await act(async () => [...document.querySelectorAll('.ot-suggest button')].find((el) => el.textContent.includes('Apply')).click())
  assert.ok(calls.some((call) => call.startsWith('applyTypeFlow ["p1"] person')))
  await act(async () => [...document.querySelectorAll('.ot-suggest button')].find((el) => el.textContent === 'Dismiss').click())
  assert.equal(document.querySelectorAll('.ot-suggest').length, 0)
  await act(async () => root.render(React.createElement(TypeTagSuggestion, { page: { ...page, title: 'sem tag' }, locked: false })))
  assert.equal(document.querySelectorAll('.ot-suggest').length, 0)
  await act(async () => root.unmount())
})

test('chip popover shows the type fields, opens the collection, and removes keeping or discarding values', async () => {
  const root = createRoot(document.getElementById('app'))
  calls.length = 0
  const anchor = document.createElement('span')
  const render = () => root.render(React.createElement(TypeChipPopover, { page, type: types[0], anchor, locked: false, onClose: () => {} }))
  await act(async () => render())
  assert.deepEqual(text('.ot-chip-pop-fields span'), ['Autor', 'Nota'])
  await act(async () => [...document.querySelectorAll('.mi')].find((el) => el.textContent === 'Open collection').click())
  assert.ok(calls.includes('openTypeCollection book'))
  await act(async () => [...document.querySelectorAll('.mi')].find((el) => el.textContent === 'Remove type from this page…').click())
  assert.match(text('p')[0], /Remove Livro\? 1 filled field/)
  await act(async () => [...document.querySelectorAll('.mi')].find((el) => el.textContent === 'Remove and discard the values').click())
  assert.ok(calls.includes('removeType ["p1"] book {"discard":true}'))
  await act(async () => root.unmount())
})
