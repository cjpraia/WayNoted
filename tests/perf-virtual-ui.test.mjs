// Virtualização no DOM (jsdom): a tabela com milhares de linhas só monta as visíveis + margem,
// com espaçadores que preservam a altura total; editar uma célula re-renderiza só aquela linha.
// Regras de memória: nada de nós do DOM em asserts — só números/strings/booleanos.
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
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' || name.endsWith('AnimationFrame') ? dom.window[name].bind(dom.window) : dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const virtual = await import('../src/components/database/virtual/useVirtualRows.ts')
let cellRenders = 0
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const known = {
  t, getLocale: () => 'en-US', useVirtualRows: virtual.useVirtualRows,
  actions: {}, selectors: { rows: () => [] }, getState: () => ({ pages: {}, settings: {} }),
  getValue: (row, prop) => prop.type === 'title' ? row.title : row.props?.[prop.id] ?? null, isEmptyValue: (v) => v == null || v === '',
  defaultsForNewRow: () => ({}), isComputedProperty: () => false, matchingRowColor: () => undefined,
  PropDisplay: ({ value }) => { cellRenders++; return React.createElement('span', null, String(value)) },
  calculateColumn: () => '', CALC_LABELS: { none: 'Nenhum' },
}
// Qualquer outro import vira um componente vazio: o teste não quebra quando a tabela ganha módulos novos.
const mocks = new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => null) })
globalThis.__perfVirtual = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__perfVirtual`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' } })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
// Seleção de linhas real (hook com estado), para o cabeçalho "selecionar tudo".
Object.assign(known, await import('../src/components/database/rowSelection.ts'))
const { TableView } = await load('../src/components/database/TableView.tsx')

const properties = [{ id: 'title', name: 'Name', type: 'title' }, { id: 'n', name: 'N', type: 'number' }, { id: 'x', name: 'X', type: 'text' }]
const schema = { properties, views: [], activeViewId: 'v' }
const view = { id: 'v', name: 'T', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
const db = { id: 'db', title: 'DB', locked: false, database: schema }
const makeRows = (count) => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, parentId: 'db', title: `Row ${i}`, order: i, locked: false, props: { n: i, x: `x${i}` } }))

test('tabela virtualizada: 5000 linhas → só dezenas no DOM, espaçadores com a altura total', async () => {
  const root = createRoot(document.getElementById('app'))
  const rows = makeRows(5000)
  const props = { db, schema, view, visibleProps: properties, readOnly: false, onOpenRow: () => {} }
  await act(async () => root.render(React.createElement(TableView, { ...props, rows })))
  const rendered = document.querySelectorAll('.tb-row').length
  assert.ok(rendered > 0 && rendered < 120, `linhas no DOM: ${rendered}`)
  const pads = [...document.querySelectorAll('.tb-virtual-pad')].map((el) => parseFloat(el.style.height) || 0)
  const total = pads.reduce((s, h) => s + h, 0) + rendered * 34
  assert.equal(Math.round(total), 5000 * 34)
  assert.equal(document.querySelector('.tb-row [data-cell="r0:title"]') !== null, true)
  assert.equal(document.querySelector('[data-cell="r4999:title"]') === null, true)

  // Edita uma célula: só a linha nova re-renderiza (memo por linha).
  cellRenders = 0
  const edited = [...rows]; edited[1] = { ...rows[1], props: { ...rows[1].props, x: 'novo' } }
  await act(async () => root.render(React.createElement(TableView, { ...props, rows: edited })))
  assert.ok(cellRenders > 0 && cellRenders <= properties.length, `células re-renderizadas: ${cellRenders}`)
  assert.equal(document.querySelector('[data-cell="r1:x"]')?.textContent, 'novo')
  await act(async () => root.unmount())
})

test('tabela pequena (abaixo do limite) continua sem virtualização', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TableView, { db, schema, view, visibleProps: properties, readOnly: false, onOpenRow: () => {}, rows: makeRows(50) })))
  assert.equal(document.querySelectorAll('.tb-row').length, 50)
  assert.equal(document.querySelectorAll('.tb-virtual-pad').length, 0)
  await act(async () => root.unmount())
})
