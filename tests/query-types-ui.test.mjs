// UI das consultas com tipos de objeto (jsdom): filtro Tipo com seletor de tipos (ícone e cor), fonte "tipo",
// "não (…)", campos do tipo no seletor de campos e chip de opção com ícone. Asserts só comparam strings,
// números e booleanos — nunca nós do DOM (ver scripts/run-tests.mjs).
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
import { ID, fixturePages } from './fixtures/query-fixture.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'DOMRect', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

const urls = new Map()
async function moduleURL(path) {
  if (urls.has(path)) return urls.get(path)
  const loading = (async () => {
    let source = shimUi(await readFile(path, 'utf8'))
    source = source.replace(/^import '[^']+\.css'\s*$/gm, '')
    const output = await transformWithOxc(source, path, { jsx: { runtime: 'automatic' }, lang: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : 'js' })
    let code = output.code
    for (const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
      const specifier = match[1]
      let url
      if (!specifier.startsWith('.')) url = import.meta.resolve(specifier)
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
const { QueryBuilder } = await import(await moduleURL(resolve(base, '../src/components/query/QueryBuilder.tsx')))
const { OptionChip } = await import(await moduleURL(resolve(base, '../src/components/database/OptionChip.tsx')))
const { normalizeObjectTypes } = await import('../src/objecttypes/model.ts')
const { defaultQuery } = await import('../src/query/model.ts')


const types = normalizeObjectTypes([
  { id: 'tp', name: 'Pessoa', icon: 'lucide:user', color: 'blue', properties: [{ id: 'f-age', name: 'Idade', type: 'number' }] },
  { id: 'tt', name: 'Tags', icon: '🏷️', color: 'pink', properties: [] },
])
const pages = fixturePages()
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent ?? '')
const click = async (el) => { assert.ok(el !== null && el !== undefined, 'elemento ausente'); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
const byText = (selector, wanted) => [...document.querySelectorAll(selector)].find((el) => (el.textContent ?? '').includes(wanted))
const escape = () => act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

async function mount(query, extra = {}) {
  const root = createRoot(document.getElementById('app'))
  const state = { query, changes: 0 }
  function Harness() {
    const [current, setQuery] = React.useState(state.query)
    return React.createElement(QueryBuilder, { query: current, pages, locale: 'pt-BR', readOnly: false, types, onChange: (next) => { state.query = next; state.changes++; setQuery(next) }, ...extra })
  }
  await act(async () => root.render(React.createElement(Harness)))
  return { root, state }
}

test('filtro Tipo: "+ Filtro" sugere Tipo; seletor com ícone e cor; vários = qualquer um de; sem tipo', async () => {
  const { root, state } = await mount(defaultQuery())
  try {
    await click(document.querySelector('[data-qb="add-filter"]'))
    const added = state.query.filter.children[0]
    assert.equal(added.field, '@type')
    assert.equal(added.op, 'is')
    await click(document.querySelector('[data-qb="rule"] .dbv-pill'))
    assert.deepEqual(text('[data-qb="type-picker"] [role="option"]').map((label) => label.trim()), ['Pessoa', '🏷️Tags'])
    assert.equal(document.querySelectorAll('[data-qb="type-picker"] .db-chip-icon').length, 2)
    assert.equal(document.querySelectorAll('[data-qb="type-picker"] .db-color-blue').length, 1)
    await click(byText('[data-qb="type-picker"] [role="option"]', 'Pessoa'))
    assert.equal(state.query.filter.children[0].value, 'tp')
    await click(byText('[data-qb="type-picker"] [role="option"]', 'Tags'))
    assert.deepEqual(state.query.filter.children[0].value, ['tp', 'tt'])
    const chip = document.querySelector('[data-qb="rule"]')?.textContent ?? ''
    assert.ok(chip.includes('Tipo') && chip.includes('é qualquer um de') && chip.includes('Pessoa') && chip.includes('Tags'), chip)
    const ops = [...document.querySelectorAll('[data-qb="rule-editor"] select')][1]
    assert.deepEqual([...ops.querySelectorAll('option')].map((option) => option.textContent), ['é qualquer um de', 'não é nenhum de', 'tem algum tipo', 'não tem tipo'])
    await act(async () => { ops.value = 'isEmpty'; ops.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(state.query.filter.children[0].op, 'isEmpty')
    assert.equal(state.query.filter.children[0].value, null)
    assert.ok((document.querySelector('[data-qb="rule"]')?.textContent ?? '').includes('não tem tipo'))
    assert.equal(document.querySelectorAll('[data-qb="type-picker"]').length, 0)
    await escape()
  } finally { await act(async () => root.unmount()) }
})

test('fonte "Páginas de um tipo" e campos do tipo no seletor de campos', async () => {
  const { root, state } = await mount(defaultQuery())
  try {
    await click(document.querySelector('[data-qb="source"]'))
    await click(byText('.qb-kind', 'Páginas de um tipo'))
    assert.equal(state.query.source.kind, 'type')
    await click(byText('[data-qb="source-editor"] [role="option"]', 'Pessoa'))
    assert.deepEqual(state.query.source, { kind: 'type', typeIds: ['tp'] })
    assert.ok((document.querySelector('[data-qb="source"]')?.textContent ?? '').includes('Pessoa'))
    await escape()
    await click(document.querySelector('[data-qb="group"]'))
    const sections = [...document.querySelectorAll('[data-qb-section]')].map((el) => el.getAttribute('data-qb-section'))
    assert.deepEqual(sections.slice(0, 2), ['page', 'type:tp'])
    assert.ok(text('[role="menuitem"]').some((label) => label.includes('Campos de Pessoa')) || text('[data-qb-section="type:tp"]').some((label) => label.includes('Campos de Pessoa')))
    await click(byText('[data-qb-section="page"] [role="menuitem"]', 'Tipo'))
    assert.equal(state.query.groupBy, '@type')
  } finally { await act(async () => root.unmount()) }
})

test('"não (…)" alterna a negação de um grupo', async () => {
  const { root, state } = await mount(defaultQuery({ filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'group', id: 'g1', operator: 'or', children: [{ kind: 'rule', id: 'r', field: '@type', op: 'is', value: 'tt' }] }] } }))
  try {
    const toggle = document.querySelector('[data-qb="negate"]')
    assert.equal(toggle?.getAttribute('aria-pressed'), 'false')
    await click(toggle)
    assert.equal(state.query.filter.children[0].negate, true)
    assert.equal(document.querySelector('[data-qb="negate"]')?.getAttribute('aria-pressed'), 'true')
    assert.ok(document.querySelector('.qb-group--not') !== null)
    await click(document.querySelector('[data-qb="negate"]'))
    assert.equal(state.query.filter.children[0].negate, undefined)
  } finally { await act(async () => root.unmount()) }
})

test('chip de opção mostra o ícone (emoji ou ícone de linha), não o nome cru', async () => {
  const root = createRoot(document.getElementById('app'))
  try {
    await act(async () => root.render(React.createElement('div', null, React.createElement(OptionChip, { name: 'Pessoa', color: 'blue', icon: 'lucide:user' }), React.createElement(OptionChip, { name: 'Tags', color: 'pink', icon: '🏷️' }))))
    const chips = text('.db-chip')
    assert.deepEqual(chips.map((label) => label.replace(/\s+/g, '')), ['Pessoa', '🏷️Tags'])
    assert.equal(document.querySelectorAll('.db-chip [data-page-icon="glyph"]').length, 1)
    assert.ok(!chips[0].includes('user'), chips[0])
  } finally { await act(async () => root.unmount()) }
})
