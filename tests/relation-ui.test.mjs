import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { translate } from '../src/localization.ts'
import { planRelationMirror } from '../src/components/database/engines.ts'

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
globalThis.__relationUI = {
  getState: () => ({ pages }), t, useI18n: () => ({ locale, t }), getLocale: () => locale,
  actions: {
    updateSchema: (id, update) => { if (!pages[id].locked) { pages[id] = { ...pages[id], database: update(pages[id].database) }; refresh() } },
    updatePage: (id, patch) => { pages[id] = { ...pages[id], ...patch }; refresh() },
    setProp: (rowId, propId, value) => {
      const mirror = planRelationMirror(pages, rowId, propId, value)
      pages[rowId] = { ...pages[rowId], props: { ...pages[rowId].props, [propId]: value } }
      for (const patch of mirror) pages[patch.rowId] = { ...pages[patch.rowId], props: { ...pages[patch.rowId].props, [patch.propertyId]: patch.value } }
      refresh()
    },
    createRow: (dbId, props, init) => { const id = 'new' + Object.keys(pages).length; pages[id] = { id, parentId: dbId, title: '', icon: null, cover: null, order: 99, trashed: false, createdAt: 1, updatedAt: 1, props, ...init }; refresh(); return id },
    createDatabase: (parentId, _type, init) => { const id = 'db' + Object.keys(pages).length; pages[id] = { id, parentId, title: '', icon: null, cover: null, order: 0, trashed: false, createdAt: 1, updatedAt: 1, database: { properties: [{ id: 'name', name: 'Nome', type: 'title' }], views: [], activeViewId: '' }, ...init }; refresh(); return id },
    openPeek: () => {},
    reportSaveError: (error) => { throw error },
  },
}
const urls = new Map()
async function moduleURL(path) {
  if (urls.has(path)) return urls.get(path)
  const loading = (async () => {
    let source = await readFile(path, 'utf8')
    source = source.replace(/^import '[^']+\.css'\s*$/gm, '')
    const output = await transformWithOxc(source, path, { jsx: { runtime: 'automatic' } })
    let code = output.code
    for (const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]) {
      const specifier = match[1]
      let url
      if (/(?:^|\/)store(?:\.ts)?$/.test(specifier)) url = 'data:text/javascript,' + encodeURIComponent('export const {actions,getState}=globalThis.__relationUI')
      else if (/(?:^|\/)i18n(?:\.ts)?$/.test(specifier)) url = 'data:text/javascript,' + encodeURIComponent('export const {t,useI18n,getLocale}=globalThis.__relationUI')
      else if (!specifier.startsWith('.')) url = import.meta.resolve(specifier)
      else {
        let dependency = resolve(dirname(path), specifier)
        if (!extname(dependency)) for (const extension of ['.ts', '.tsx']) { try { await access(dependency + extension); dependency += extension; break } catch {} }
        if (!extname(dependency)) for (const index of ['/index.ts', '/index.tsx']) { try { await access(dependency + index); dependency += index; break } catch {} }
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
const { RelationEditor } = await import(await moduleURL(resolve(base, '../src/components/database/editors/RelationEditor.tsx')))
const { PropertyMenu } = await import(await moduleURL(resolve(base, '../src/components/database/PropertyMenu.tsx')))
const { PropDisplay } = await import(await moduleURL(resolve(base, '../src/components/database/PropDisplay.tsx')))
const { addProperty } = await import(await moduleURL(resolve(base, '../src/components/database/schemaOps.ts')))
const page = (id, extra = {}) => ({ id, parentId: null, title: id, icon: null, cover: null, order: 0, trashed: false, createdAt: 1, updatedAt: 1, ...extra })
const schema = (properties) => ({ properties, views: [{ id: 'table', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'table' })
function fixture() {
  pages = {
    home: page('home', { title: 'Pessoal' }),
    t1: page('t1', { parentId: 'home', database: schema([{ id: 'name', name: 'Nome', type: 'title' }, { id: 'rel', name: 'T2', type: 'relation', relationDatabaseId: 't2' }]) }),
    t2: page('t2', { title: 'T2', parentId: 'home', database: schema([{ id: 'name', name: 'Nome', type: 'title' }]) }),
    a: page('a', { title: 'teste 1', parentId: 't1', order: 1, props: { rel: [] } }),
    c: page('c', { title: 'teste 3', parentId: 't2', order: 1 }),
    d: page('d', { title: 'teste 4', parentId: 't2', order: 2 }),
  }
}
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent)
async function type(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
async function key(el, name) { await act(async () => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }))) }
async function click(el) { await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))) }

function editorHarness(root, rowId = 'a') {
  function Harness() {
    const [, rerender] = React.useReducer((n) => n + 1, 0)
    refresh = rerender
    const property = pages.t1.database.properties.find((p) => p.id === 'rel')
    return React.createElement(RelationEditor, { dbId: 't1', property, value: pages[rowId].props.rel ?? [], anchor: { x: 10, y: 10 }, onChange: (value) => globalThis.__relationUI.actions.setProp(rowId, 'rel', value), onClose: () => {} })
  }
  return act(async () => root.render(React.createElement(Harness)))
}

test('popover da relação: selecionadas, selecionar mais, busca, teclado, criar e desvincular', async () => {
  locale = 'pt-BR'; fixture()
  const root = createRoot(document.getElementById('app'))
  try {
    await editorHarness(root)
    const input = document.querySelector('.db-relpick-search input')
    assert.ok(input, 'campo de busca')
    assert.equal(input.placeholder, 'Vincular ou criar uma página…')
    assert.equal(document.querySelector('.db-relpick-in').textContent, 'EmT2')
    assert.deepEqual(texts('.db-relpick-label > span'), ['Selecionar uma página'])
    assert.deepEqual(texts('.db-relpick-title'), ['teste 3', 'teste 4'])
    await click(document.querySelectorAll('.db-relpick-item')[1])
    assert.deepEqual(pages.a.props.rel, ['d'])
    assert.deepEqual(texts('.db-relpick-label > span'), ['1 selecionada', 'Selecionar mais'])
    assert.deepEqual(texts('.db-relpick-title'), ['teste 4', 'teste 3'])
    // Teclado: ↓ vai para "teste 3", Enter vincula.
    await key(input, 'ArrowDown'); await key(input, 'Enter')
    assert.deepEqual(pages.a.props.rel, ['d', 'c'])
    assert.equal(document.querySelector('.db-relpick-label > span').textContent, '2 selecionadas')
    // Busca filtra as duas listas; texto sem página oferece Criar, que cria no banco alvo e vincula.
    await type(input, 'TESTE 4')
    assert.deepEqual(texts('.db-relpick-title'), ['teste 4'])
    assert.equal(document.querySelector('.db-relpick-create'), null)
    await type(input, 'Nova tarefa')
    assert.equal(texts('.db-relpick-title').length, 0)
    assert.equal(document.querySelector('.db-relpick-create').textContent, '“Nova tarefa”')
    await key(input, 'Enter')
    const created = Object.values(pages).find((p) => p.title === 'Nova tarefa')
    assert.ok(created && created.parentId === 't2', 'página criada no banco alvo')
    assert.deepEqual(pages.a.props.rel, ['d', 'c', created.id])
    assert.equal(input.value, '')
    // − desvincula; ⋯ → Limpar todas.
    await click(document.querySelector('.db-relpick-remove'))
    assert.deepEqual(pages.a.props.rel, ['c', created.id])
    await click(document.querySelector('.db-relpick-more'))
    const clear = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('Limpar todas'))
    assert.ok(clear, 'Limpar todas'); await click(clear)
    assert.deepEqual(pages.a.props.rel, [])
    // ⋯ → Filtros e ordenação continua acessível.
    await click(document.querySelector('.db-relpick-more'))
    const rules = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('Filtros e ordenação'))
    assert.ok(rules, 'Filtros e ordenação'); await click(rules)
    assert.ok(document.querySelector('.db-relpick-rules .db-rules'), 'editor de filtros aberto')
  } finally { await act(async () => root.unmount()); refresh = () => {} }
})

test('popover da relação em banco grande renderiza em lotes com "Mostrar mais"', async () => {
  locale = 'en-US'; fixture()
  for (let i = 0; i < 5000; i++) pages['p' + i] = page('p' + i, { parentId: 't2', title: 'Page ' + i, order: 10 + i })
  const root = createRoot(document.getElementById('app'))
  try {
    const started = performance.now()
    await editorHarness(root)
    assert.equal(document.querySelectorAll('.db-relpick-item').length, 51)
    const more = document.querySelector('.db-relpick-action')
    assert.match(more.textContent, /Show 50 more/)
    await click(more)
    assert.equal(document.querySelectorAll('.db-relpick-item').length, 101)
    await type(document.querySelector('.db-relpick-search input'), 'page 4999')
    assert.deepEqual(texts('.db-relpick-title'), ['Page 4999'])
    assert.ok(performance.now() - started < 5000, 'fluido com 5.000 páginas')
  } finally { await act(async () => root.unmount()); refresh = () => {} }
})

test('“Relacionada a”: escolhe a fonte com trilha, liga a relação bidirecional e preserva dados', async () => {
  locale = 'pt-BR'; fixture()
  pages.a.props.rel = undefined
  const id = addProperty('t1', 'relation')
  pages.a.props[id] = []
  const root = createRoot(document.getElementById('app'))
  function Harness() {
    const [, rerender] = React.useReducer((n) => n + 1, 0); refresh = rerender
    return React.createElement(PropertyMenu, { dbId: 't1', property: pages.t1.database.properties.find((p) => p.id === id), anchor: { x: 10, y: 10 }, onClose: () => {} })
  }
  try {
    await act(async () => root.render(React.createElement(Harness)))
    assert.equal(document.querySelector('.db-dsp-head').textContent.startsWith('Relacionada a'), true)
    assert.equal(document.querySelector('.db-dsp-search').placeholder, 'Vincular a uma fonte de dados…')
    assert.deepEqual(texts('.db-dsp-title'), ['t1', 'T2'])
    assert.deepEqual(texts('.db-dsp-path'), ['Pessoal', 'Pessoal'])
    await type(document.querySelector('.db-dsp-search'), 't2')
    await key(document.querySelector('.db-dsp-search'), 'Enter')
    const prop = () => pages.t1.database.properties.find((p) => p.id === id)
    assert.equal(prop().relationDatabaseId, 't2')
    assert.equal(prop().name, 'T2 2', 'nome padrão vira o nome do banco')
    // Dados existentes antes de ligar a bidirecional são levados ao espelho.
    pages.a = { ...pages.a, props: { ...pages.a.props, [id]: ['c'] } }
    const toggle = document.querySelector('[role="switch"]')
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.match(toggle.textContent, /Mostrar em T2/)
    await click(toggle)
    const mirrorId = prop().relationMirrorPropertyId
    const mirror = pages.t2.database.properties.find((p) => p.id === mirrorId)
    assert.ok(mirror && mirror.type === 'relation' && mirror.relationDatabaseId === 't1' && mirror.relationMirrorPropertyId === id, 'espelho criado e pareado')
    assert.equal(mirror.name, 't1')
    assert.deepEqual(pages.c.props[mirrorId], ['a'])
    // Nome do espelho editável.
    const nameInput = document.getElementById(`relation-mirror-${id}`)
    await type(nameInput, 'Tarefas t1')
    await act(async () => nameInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: false })))
    await key(nameInput, 'Enter')
    assert.equal(pages.t2.database.properties.find((p) => p.id === mirrorId).name, 'Tarefas t1')
    // Desligar desfaz o pareamento sem apagar propriedade nem valores.
    await click(document.querySelector('[role="switch"]'))
    assert.equal(prop().relationMirrorPropertyId, undefined)
    assert.equal(pages.t2.database.properties.find((p) => p.id === mirrorId).relationMirrorPropertyId, undefined)
    assert.deepEqual(pages.c.props[mirrorId], ['a'])
  } finally { await act(async () => root.unmount()); refresh = () => {} }
})

test('célula de relação mostra ícone + título sublinhado (sem chip)', async () => {
  locale = 'pt-BR'; fixture()
  const root = createRoot(document.getElementById('app'))
  try {
    await act(async () => root.render(React.createElement(PropDisplay, { property: pages.t1.database.properties[1], value: ['c', 'missing', 'd'] })))
    assert.deepEqual(texts('.db-relation-link .db-relation-title'), ['teste 3', 'teste 4'])
    assert.equal(document.querySelectorAll('.db-relation-link .db-relation-icon svg').length, 2)
  } finally { await act(async () => root.unmount()) }
})
