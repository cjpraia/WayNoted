// UI (jsdom) do painel "Configurações da visualização", do menu da aba e da seleção na tabela.
// Regras de memória: nada de nós do DOM em asserts — só strings, números e booleanos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === 'function' && /^[a-z]/.test(name) ? dom.window[name].bind(dom.window) : dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const calls = []
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const known = {
  t, getLocale: () => 'en-US',
  actions: {
    updateView: (dbId, viewId, patch) => calls.push(['updateView', JSON.stringify(patch)]),
    changeViewType: (dbId, viewId, type) => { calls.push(['changeViewType', type]); return true },
    updatePage: (id, patch) => calls.push(['updatePage', JSON.stringify(patch)]),
    activateView: () => {}, openPage: (id) => calls.push(['openPage', id]), reportSaveError: () => {},
  },
  selectors: { page: (id) => ({ id, title: 'Source DB' }), rows: () => [] },
  getState: () => ({ pages: {}, settings: {} }),
  copyText: async (text) => { calls.push(['copy', text]) },
  Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  PropTypeIcon: () => null, ViewTypeIcon: () => null, PageIcon: () => null, objectTypes: () => [], setNewRowType: () => {},
  moveProperty: (...args) => calls.push(['moveProperty', args.slice(1).join(',')]),
  getValue: (row, prop) => prop.type === 'title' ? row.title : row.props?.[prop.id] ?? null, isEmptyValue: (v) => v == null || v === '',
  isComputedProperty: () => false, matchingRowColor: () => undefined, defaultsForNewRow: () => ({}),
  PropDisplay: ({ value }) => React.createElement('span', null, String(value)),
}
const mocks = new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => null) })
globalThis.__viewSettings = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'react-dom' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__viewSettings`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '').replace(/^export type \{[^}]*\} from '[^']+'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: file.endsWith('.ts') ? 'ts' : 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
Object.assign(known, await import('../src/components/database/settings/model.ts'))
Object.assign(known, await import('../src/components/database/filterTree.ts'))
Object.assign(known, await import('../src/components/database/rowSelection.ts'))
Object.assign(known, await import('../src/components/database/virtual/useVirtualRows.ts'))
Object.assign(known, await load('../src/components/database/ui/Popover.tsx'))
Object.assign(known, await load('../src/components/database/settings/ui.tsx'))
Object.assign(known, await load('../src/components/database/settings/types.ts'))
Object.assign(known, await load('../src/components/database/settings/screens.tsx'))
Object.assign(known, await load('../src/components/database/settings/screens2.tsx'))
const { ViewSettingsPanel } = await load('../src/components/database/settings/ViewSettingsPanel.tsx')
const { ViewTabMenu } = await load('../src/components/database/settings/ViewTabMenu.tsx')
const { TableView } = await load('../src/components/database/TableView.tsx')

const schema = { properties: [{ id: 'title', name: 'Name', type: 'title' }, { id: 'status', name: 'Status', type: 'status', options: [{ id: 'a', name: 'A', color: 'blue' }] }, { id: 'notes', name: 'Notes', type: 'text' }], views: [], activeViewId: 'v' }
const view = { id: 'v', name: 'Table', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
const db = { id: 'db', title: 'DB', locked: false, database: schema }
const ctx = { db, schema, view, readOnly: false, schemaLocked: false, dataReadOnly: false, rowCount: 3, canDeleteView: true, onImportCsv() {}, onExportCsv() {}, onCreateLinked() {}, onDuplicateView() {}, onDeleteView() {} }
const text = (selector) => document.querySelector(selector)?.textContent ?? ''
const buttonByText = (label) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim().startsWith(label))
const click = async (label) => { const el = buttonByText(label); assert.ok(el, `botão ${label}`); await act(async () => el.click()) }
const key = async (k) => act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true })))

test('painel: tela principal, subtela Layout, Esc volta um nível e depois fecha', async () => {
  calls.length = 0
  const anchor = document.createElement('div'); document.body.appendChild(anchor)
  let closed = 0
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ViewSettingsPanel, { ctx, anchor, onClose: () => { closed++ } })))
  assert.equal(text('.vs-header-title'), 'View settings')
  const labels = [...document.querySelectorAll('.vs-screen .vs-row .vs-row-label')].map((el) => el.textContent)
  for (const label of ['Layout', 'Property visibility', 'Filter', 'Sort', 'Group', 'Sub-group', 'Conditional color', 'Source', 'Edit properties', 'Automations', 'More settings', 'Manage data sources', 'Lock database']) assert.ok(labels.includes(label), `linha ${label}`)
  assert.ok(!labels.includes('AI Autofill'), 'sem funcionalidade falsa')
  assert.equal(text('[data-vs-id="visibility"] .vs-row-value'), '3')
  await click('Layout')
  assert.equal(text('.vs-header-title'), 'Layout')
  assert.equal(document.querySelectorAll('.vs-layout').length, 11)
  assert.equal(text('.vs-layout.is-current'), 'Table')
  await click('Board')
  assert.deepEqual(calls.at(-1), ['changeViewType', 'board'])
  await click('Show row numbers')
  assert.deepEqual(calls.at(-1), ['updateView', '{"rowNumbers":true}'])
  await key('Escape')
  assert.equal(text('.vs-header-title'), 'View settings')
  assert.equal(closed, 0)
  assert.equal(document.activeElement?.getAttribute('data-vs-id'), 'layout', 'foco volta à linha que abriu a subtela')
  await key('Escape')
  assert.equal(closed, 1)
  await act(async () => root.unmount())
})

test('painel: setas percorrem linhas; visibilidade oculta/mostra todas; filtro e copiar link', async () => {
  calls.length = 0
  const anchor = document.createElement('div'); document.body.appendChild(anchor)
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ViewSettingsPanel, { ctx: { ...ctx, view: { ...view, hidden: ['notes'] } }, anchor, onClose() {} })))
  const body = document.querySelector('.vs-body')
  await act(async () => body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  assert.ok(document.activeElement?.hasAttribute('data-vs-nav'), 'primeira linha focada')
  await click('Property visibility')
  assert.equal(text('.vs-header-title'), 'Property visibility')
  const sections = [...document.querySelectorAll('.vs-section > span')].map((el) => el.textContent)
  assert.deepEqual(sections, ['Shown in table', 'Hidden in table'])
  await click('Hide all')
  assert.deepEqual(calls.at(-1), ['updateView', '{"hidden":["status","notes"]}'])
  await click('Show all')
  assert.deepEqual(calls.at(-1), ['updateView', '{"hidden":[]}'])
  assert.equal(document.querySelector('.vs-eye[disabled]')?.getAttribute('aria-label'), 'Hide Name', 'título fixo')
  await act(async () => root.render(React.createElement(ViewSettingsPanel, { key: 'copy', ctx, anchor, onClose() {} })))
  await click('More settings')
  await click('Copy link to view')
  assert.deepEqual(calls.at(-1), ['copy', "workspace://page/db#view=v"])
  await act(async () => root.unmount())
})

test('menu da aba: Exibir como converte no lugar; Editar visualização abre o painel', async () => {
  calls.length = 0
  const anchor = document.createElement('div'); document.body.appendChild(anchor)
  const opened = []
  const root = createRoot(document.getElementById('app'))
  const render = () => root.render(React.createElement(ViewTabMenu, { db, view, anchor, canDelete: false, canOpenFull: true, onRename() {}, onDuplicate() {}, onDelete() {}, onOpenSettings: (s) => opened.push(s), onClose() {} }))
  await act(async () => render())
  const items = [...document.querySelectorAll('.dbv-menu-item .dbv-menu-label')].map((el) => el.textContent)
  assert.deepEqual(items, ['Rename', 'Display as', 'Edit view', 'Source', 'Copy link to view', 'Open as full page', 'Hide data source titles', 'Duplicate view', 'Delete view'])
  assert.equal(buttonByText('Delete view').disabled, true, 'última visualização não pode ser excluída')
  await click('Display as')
  const types = [...document.querySelectorAll('.dbv-popover')].at(-1).querySelectorAll('.dbv-menu-item').length
  assert.equal(types, 11)
  await click('Calendar')
  assert.deepEqual(calls.at(-1), ['changeViewType', 'calendar'])
  await act(async () => render())
  await click('Edit view')
  assert.deepEqual(opened, ['main'])
  await act(async () => root.unmount())
})

test('tabela: "selecionar tudo" marca 5000 linhas sem renderizá-las; Shift estende; Esc limpa', async () => {
  const properties = schema.properties
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, parentId: 'db', title: `Row ${i}`, order: i, locked: false, props: {} }))
  let api = null
  function Harness() {
    const selection = known.useRowSelection(rows.map((r) => r.id))
    api = selection
    return React.createElement(TableView, { db, schema, view, rows, visibleProps: properties, readOnly: false, onOpenRow() {}, selection })
  }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(Harness)))
  const head = document.querySelector('.tb-head-gutter .tb-select')
  assert.ok(head !== null, 'caixa do cabeçalho')
  await act(async () => head.click())
  assert.equal(api.size, 5000)
  assert.equal(api.state, 'all')
  const rendered = document.querySelectorAll('.tb-row').length
  assert.ok(rendered < 150, `linhas no DOM: ${rendered}`)
  assert.equal(document.querySelectorAll('.tb-row--selected').length, rendered)
  await act(async () => head.click())
  assert.equal(api.size, 0)
  const boxes = () => [...document.querySelectorAll('.tb-row .tb-select')]
  await act(async () => boxes()[1].click())
  await act(async () => boxes()[4].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, shiftKey: true })))
  assert.equal(api.size, 4)
  assert.equal(api.state, 'some')
  assert.equal(document.querySelector('.tb-head-gutter .tb-select').indeterminate, true)
  await act(async () => document.querySelector('.tb').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(api.size, 0)
  await act(async () => document.querySelector('.tb').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })))
  assert.equal(api.size, 5000, '⌘A seleciona tudo')
  await act(async () => root.unmount())
})
