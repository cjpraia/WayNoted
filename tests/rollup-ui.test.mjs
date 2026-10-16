import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi } from './fixtures/ui-shim.mjs'
import React, { act } from 'react'
import { translate } from '../src/localization.ts'
import { resolveValue } from '../src/components/database/derived.ts'
import { validateMeta } from '../src/workspace.ts'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'DOMRect']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
dom.window.HTMLElement.prototype.attachEvent = () => {}
dom.window.HTMLElement.prototype.detachEvent = () => {}
let pages, locale = 'pt-BR', refresh = () => {}
const t = (pt, en, variables) => translate(locale, pt, en, variables)
// Only the persistence boundary and locale subscription are replaced. The menu,
// popover, icons, labels, schema operations and calculation engine are production code.
globalThis.__rollupUI = {
  getState: () => ({ pages }), t, useI18n: () => ({ locale, t }),
  actions: {
    updateSchema: (id, update) => { if (!pages[id].locked) { pages[id] = { ...pages[id], database: update(pages[id].database) }; refresh() } },
    updatePage: (id, patch) => { pages[id] = { ...pages[id], ...patch }; refresh() },
    trackDbUndo: (_label, _id, fn) => fn(),
  },
}
const urls = new Map()
async function moduleURL(path) {
  if (urls.has(path)) return urls.get(path)
  const loading = (async () => {
    let source = await readFile(path, 'utf8')
    source = source.replace(/^import '[^']+\.css'\s*$/gm, '')
    const output = await transformWithOxc(shimUi(source), path, { jsx: { runtime: 'automatic' } })
    let code = output.code
    for (const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
      const specifier = match[1]
      let url
      if (/(?:^|\/)store(?:\.ts)?$/.test(specifier)) url = 'data:text/javascript,' + encodeURIComponent('export const {actions,getState}=globalThis.__rollupUI')
      else if (/(?:^|\/)i18n(?:\.ts)?$/.test(specifier)) url = 'data:text/javascript,' + encodeURIComponent('export const {t,useI18n}=globalThis.__rollupUI')
      else if (!specifier.startsWith('.')) url = import.meta.resolve(specifier)
      else {
        let dependency = resolve(dirname(path), specifier)
        if (!extname(dependency)) for (const extension of ['.ts', '.tsx']) { try { await access(dependency + extension); dependency += extension; break } catch {} }
        url = await moduleURL(dependency)
      }
      code = code.replace(match[0], `from ${JSON.stringify(url)}`)
    }
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  })()
  urls.set(path, loading)
  return loading
}
const base = dirname(fileURLToPath(import.meta.url))
const { NewPropertyMenu, PropertyMenu } = await import(await moduleURL(resolve(base, '../src/components/database/PropertyMenu.tsx')))
const { addProperty } = await import(await moduleURL(resolve(base, '../src/components/database/schemaOps.ts')))
const page = (id, extra = {}) => ({ id, parentId: null, title: id, icon: null, cover: null, order: 0, trashed: false, createdAt: 1, updatedAt: 1, ...extra })
const schema = (properties) => ({ properties, views: [{ id: 'table', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'table' })
function fixture() {
  pages = {
    orders: page('orders', { database: schema([{ id: 'name', name: 'Nome', type: 'title' }, { id: 'items', name: 'Itens', type: 'relation', relationDatabaseId: 'items' }]) }),
    items: page('items', { database: schema([{ id: 'name', name: 'Nome', type: 'title' }, { id: 'price', name: 'Preço', type: 'number' }]) }),
    first: page('first', { parentId: 'items', props: { price: 10 } }),
    second: page('second', { parentId: 'items', props: { price: 5 } }),
    order: page('order', { parentId: 'orders', props: { items: ['first', 'second'] } }),
  }
}
async function change(id, value) {
  const el = document.getElementById(id)
  assert.ok(el, id)
  await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
async function search(value) {
  const input = document.querySelector('input[aria-label="' + t('Buscar tipo de propriedade', 'Search property type') + '"]')
  assert.ok(input)
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  return input
}

test('create Rollup through the searchable property menu, configure it, recalculate and persist in both locales', async () => {
  for (const language of ['pt-BR', 'en-US']) {
    locale = language; fixture()
    let propertyId
    const root = createRoot(document.getElementById('app'))
    function Harness() {
      const [, rerender] = React.useReducer(n => n + 1, 0)
      refresh = rerender
      const [id, setId] = React.useState(null)
      return id ? React.createElement(PropertyMenu, { dbId: 'orders', property: pages.orders.database.properties.find(p => p.id === id), anchor: { x: 10, y: 10 }, onClose: () => {} })
        : React.createElement(NewPropertyMenu, { anchor: { x: 10, y: 10 }, onClose: () => {}, onPick: type => { propertyId = addProperty('orders', type); setId(propertyId) } })
    }
    try {
      await act(async () => root.render(React.createElement(Harness)))
      for (const alias of ['rollup', 'resumo', 'agregacao']) {
        await search(alias)
        assert.deepEqual([...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent), ['Rollup'])
      }
      const input = await search('rollup')
      await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      const property = () => pages.orders.database.properties.find(p => p.id === propertyId)
      assert.equal(property().type, 'rollup'); assert.equal(property().name, 'Rollup')
      assert.equal(document.getElementById(`rollup-target-${propertyId}`).disabled, true)
      assert.equal(document.getElementById(`rollup-calculate-${propertyId}`).disabled, true)
      await change(`rollup-relation-${propertyId}`, 'items')
      await change(`rollup-target-${propertyId}`, 'price')
      assert.equal(resolveValue(pages.order, property(), pages), 2)
      await change(`rollup-calculate-${propertyId}`, 'sum')
      assert.deepEqual(property().rollup, { relationPropertyId: 'items', targetPropertyId: 'price', aggregation: 'sum' })
      assert.equal(resolveValue(pages.order, property(), pages), 15)
      pages.second.props.price = 20
      assert.equal(resolveValue(pages.order, property(), pages), 30)
      pages.second.trashed = true
      assert.equal(resolveValue(pages.order, property(), pages), 10)
      // Real saved pages use UUIDs; remap only fixture page identities before validation.
      const pageIds = Object.fromEntries(Object.keys(pages).map(key => [key, crypto.randomUUID()]))
      const portable = Object.fromEntries(Object.entries(structuredClone(pages)).map(([key, value]) => {
        value.id = pageIds[key]; value.parentId = value.parentId ? pageIds[value.parentId] : null
        for (const prop of value.database?.properties ?? []) if (prop.relationDatabaseId) prop.relationDatabaseId = pageIds[prop.relationDatabaseId]
        for (const [prop, values] of Object.entries(value.props ?? {})) if (Array.isArray(values)) value.props[prop] = values.map(id => pageIds[id] ?? id)
        return [value.id, value]
      }))
      const saved = validateMeta(JSON.parse(JSON.stringify({ pages: portable, settings: {}, version: 1 })))
      assert.deepEqual(saved.pages[pageIds.orders].database.properties.find(p => p.id === propertyId).rollup, property().rollup)
      await change(`rollup-relation-${propertyId}`, '')
      assert.equal(property().rollup.targetPropertyId, '')
      assert.equal(resolveValue(pages.order, property(), pages), null)
      assert.equal(document.getElementById(`rollup-target-${propertyId}`).disabled, true)
    } finally { await act(async () => root.unmount()); refresh = () => {} }
  }
})

test('Rollup never silently selects another relation when the configured relation or database is removed', async () => {
  locale = 'pt-BR'; fixture()
  const id = addProperty('orders', 'rollup')
  let property = pages.orders.database.properties.find(p => p.id === id)
  property.rollup = { relationPropertyId: 'missing', targetPropertyId: 'price', aggregation: 'sum' }
  const root = createRoot(document.getElementById('app'))
  const render = () => root.render(React.createElement(PropertyMenu, { dbId: 'orders', property, anchor: { x: 10, y: 10 }, onClose: () => {} }))
  try {
    await act(async () => render())
    assert.equal(document.getElementById(`rollup-relation-${id}`).value, '')
    assert.equal(document.getElementById(`rollup-target-${id}`).disabled, true)
    property.rollup.relationPropertyId = 'items'; pages.items.trashed = true
    await act(async () => render())
    assert.equal(document.getElementById(`rollup-relation-${id}`).disabled, true)
    assert.match(document.querySelector('[role="status"]').textContent, /Adicione uma propriedade Relação/)
    assert.equal(document.getElementById(`rollup-calculate-${id}`).disabled, true)
    await act(async () => root.render(React.createElement(PropertyMenu, { dbId: 'orders', property, readOnly: true, anchor: { x: 10, y: 10 }, onClose: () => {} })))
    assert.equal(Boolean(document.querySelector('.db-property-config')), false)
  } finally { await act(async () => root.unmount()) }
})

test('changing an existing property to Rollup leaves its configuration open', async () => {
  locale = 'en-US'; fixture()
  const id = addProperty('orders', 'text')
  pages.order.props[id] = 'Previous text'
  let closed = false
  const root = createRoot(document.getElementById('app'))
  function Harness() {
    const [, rerender] = React.useReducer(n => n + 1, 0); refresh = rerender
    return React.createElement(PropertyMenu, { dbId: 'orders', property: pages.orders.database.properties.find(p => p.id === id), anchor: { x: 10, y: 10 }, onClose: () => { closed = true } })
  }
  try {
    await act(async () => root.render(React.createElement(Harness)))
    const typeButton = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.querySelector('.dbv-menu-label')?.textContent === 'Type')
    assert.ok(typeButton); await act(async () => typeButton.click())
    await search('rollup')
    const rollup = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === 'Rollup')
    assert.ok(rollup); await act(async () => rollup.click())
    assert.equal(closed, false)
    assert.equal(pages.orders.database.properties.find(p => p.id === id).type, 'rollup')
    assert.equal(pages.order.props[id], undefined)
    assert.ok(document.getElementById(`rollup-relation-${id}`))
  } finally { await act(async () => root.unmount()); refresh = () => {} }
})
