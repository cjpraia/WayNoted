// Página da linha: campos do banco e do tipo numa lista única; "+ Adicionar campo" com duas seções (neste banco / neste tipo).
// Asserções só com strings/booleans (nunca nós do DOM). docs/USAGE.md
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
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)

const tr = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const schema = { properties: [{ id: 'title', name: 'Name', type: 'title' }, { id: 'p1', name: 'Status', type: 'text' }, { id: 'shared', name: 'Shared', type: 'text' }], views: [], rowLayout: {} }
const db = { id: 'db', title: 'Database', database: schema, locked: false }
const row = { id: 'row', parentId: 'db', title: 'Row', props: { p1: 'x' }, types: ['tags'], locked: false }
const tags = { id: 'tags', name: 'Tags', color: 'blue', icon: '', properties: [{ id: 'shared', name: 'Shared', type: 'text' }, { id: 'tf1', name: 'Autor', type: 'text' }] }
let types = [tags]
const calls = []
const mocks = {
  t: tr, actions: { setProp() {}, updatePage() {}, updateSchema() {}, undoDatabase() {}, createRow: () => 'x', openPeek() {} },
  getState: () => ({ pages: { db, row } }),
  selectors: { page: (id) => (id === 'row' ? row : db), parentDatabase: () => db, rows: () => [row] },
  useStore: () => ({}),
  getValue: (r, p) => r.props?.[p.id] ?? null, isEmptyValue: (v) => v == null || v === '',
  PropDisplay: ({ value }) => React.createElement('span', { className: 'value' }, String(value)),
  PropTypeIcon: () => null, PropertyEditor: () => null, openUrl() {},
  NewPropertyMenu: ({ onPick }) => React.createElement('div', { className: 'new-prop-menu' }, React.createElement('button', { onClick: () => onPick('text') }, 'pick-db-text')),
  PropertyMenu: () => null, addProperty: (id, kind) => { calls.push(`addProperty ${id} ${kind}`); return 'newp' }, moveProperty() {},
  moveRelative: (list) => list, announceReorder() {}, useReorder: () => ({ row: () => ({}), grip: () => null, dragId: null }),
  isComputedProperty: () => false, CellComments: () => null, canAssignSubitemParent: () => false, subitemsFor: () => [], unresolvedDependencies: () => [],
  Select: (props) => React.createElement('select', props),
  TypeFieldRows: ({ divideFirst }) => React.createElement('div', { className: 'type-rows', 'data-divide': String(divideFirst), role: 'row' }, 'type-field-rows'),
  FieldTypeMenu: ({ onPick }) => React.createElement('div', { className: 'field-type-menu' }, React.createElement('button', { onClick: () => onPick('text') }, 'pick-type-text')),
  PageIcon: () => null,
  DbPopover: ({ children }) => React.createElement('div', { className: 'pop' }, children),
  Menu: ({ children }) => React.createElement('div', { role: 'menu' }, children),
  MenuItem: ({ label, onClick }) => React.createElement('button', { role: 'menuitem', onClick }, label),
  MenuLabel: ({ children }) => React.createElement('div', { className: 'menu-label' }, children),
  objectTypes: () => types, addField: (typeId, kind) => { calls.push(`addField ${typeId} ${kind}`); return 'tf-new' },
  pageTypes: (list, page) => (page.types ?? []).map((id) => list.find((type) => type.id === id)).filter(Boolean),
  pageTypeFields: (list, page) => (page.types ?? []).flatMap((id) => list.filter((type) => type.id === id).flatMap((type) => type.properties.map((property) => ({ type, property })))),
  typeDataHidden: () => false,
}
globalThis.__unified = mocks
async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')} = globalThis.__unified`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const { RowProperties } = await load('../src/components/database/RowProperties.tsx')
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())
const click = async (el) => { await act(async () => { el.click(); await new Promise((resolve) => setTimeout(resolve, 5)) }) }

test('um só grupo "Propriedades" com campos do banco e do tipo, e um só botão "Adicionar campo"', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(RowProperties, { pageId: 'row' })))
  assert.equal(document.querySelectorAll('[role="table"]').length, 1, 'uma tabela só')
  assert.equal(document.querySelectorAll('.type-rows').length, 1, 'campos do tipo dentro da mesma tabela')
  assert.equal(document.querySelector('.type-rows').closest('[role="table"]') !== null, true)
  assert.equal(document.querySelector('.type-rows').getAttribute('data-divide'), 'true', 'divisória sutil quando há campos do banco')
  assert.deepEqual(text('.dbv-rp-add span'), ['Add field'], 'um botão só')
  assert.equal(document.querySelectorAll('.dbv-rp-add').length, 1)
  await act(async () => root.unmount())
})

test('menu único: seção "In this database" e seção "In this type"; cada uma cria no lugar certo', async () => {
  calls.length = 0
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(RowProperties, { pageId: 'row' })))
  await click(document.querySelector('.dbv-rp-add'))
  assert.deepEqual(text('.menu-label'), ['In this database', 'In this type'])
  assert.deepEqual(text('[role="menuitem"]'), ['Database property', 'Tags field'])
  await click([...document.querySelectorAll('[role="menuitem"]')][1])
  await click(document.querySelector('.field-type-menu button'))
  assert.deepEqual(calls, ['addField tags text'])
  await click(document.querySelector('.dbv-rp-add'))
  await click([...document.querySelectorAll('[role="menuitem"]')][0])
  await click(document.querySelector('.new-prop-menu button'))
  assert.deepEqual(calls, ['addField tags text', 'addProperty db text'])
  await act(async () => root.unmount())
})

test('sem tipo na página: continua "Add a property" direto (sem menu intermediário); banco bloqueado oferece só o tipo', async () => {
  const root = createRoot(document.getElementById('app'))
  row.types = []
  await act(async () => root.render(React.createElement(RowProperties, { pageId: 'row' })))
  assert.equal(document.querySelectorAll('.type-rows').length, 1)
  assert.deepEqual(text('.dbv-rp-add span'), ['Add a property'])
  await click(document.querySelector('.dbv-rp-add'))
  assert.equal(document.querySelectorAll('.new-prop-menu').length, 1, 'abre direto o tipo de propriedade')
  row.types = ['tags']; db.locked = true
  await act(async () => root.render(React.createElement(RowProperties, { pageId: 'row', typeLocked: false })))
  await click(document.querySelector('.dbv-rp-add'))
  assert.equal(document.querySelectorAll('.field-type-menu').length, 1, 'banco bloqueado: só campo do tipo, direto')
  db.locked = false
  await act(async () => root.unmount())
})

test('página trancada: sem botão de adicionar nos campos do tipo e campos ficam só leitura', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(RowProperties, { pageId: 'row', typeLocked: true })))
  await click(document.querySelector('.dbv-rp-add'))
  assert.equal(document.querySelectorAll('.new-prop-menu').length, 1, 'trancada pelo tipo: o menu de tipo não aparece, só o do banco')
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0)
  await act(async () => root.unmount())
})
