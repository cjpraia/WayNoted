// UI do construtor visual e do modo texto das consultas (jsdom). Asserts só comparam strings,
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
const { QueryTextEditor } = await import(await moduleURL(resolve(base, '../src/components/query/QueryTextEditor.tsx')))
const { defaultQuery } = await import('../src/query/model.ts')

const pages = fixturePages()
const start = () => defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'r1', field: 'Status', op: 'is', value: 'Em andamento' }] }, sorts: [{ field: 'Prazo', direction: 'asc' }] })
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent ?? '')
const click = async (el) => { assert.ok(el !== null && el !== undefined, 'elemento ausente'); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
const byText = (selector, wanted) => [...document.querySelectorAll(selector)].find((el) => (el.textContent ?? '').includes(wanted))

async function mountBuilder(locale = 'pt-BR', readOnly = false) {
  const root = createRoot(document.getElementById('app'))
  const state = { query: start(), changes: 0 }
  function Harness() {
    const [query, setQuery] = React.useState(state.query)
    return React.createElement(QueryBuilder, { query, pages, locale, readOnly, onChange: (next) => { state.query = next; state.changes++; setQuery(next) } })
  }
  await act(async () => root.render(React.createElement(Harness)))
  return { root, state }
}

test('construtor: frase legível, adicionar filtro, alternar E/OU, remover e ordenar', async () => {
  const { root, state } = await mountBuilder()
  try {
    const sentence = (document.querySelector('.qb')?.textContent ?? '')
    assert.ok(sentence.startsWith('Mostrar'), sentence)
    assert.ok(sentence.includes('Projetos') && sentence.includes('onde') && sentence.includes('Status é Em andamento') && sentence.includes('ordenar por'), sentence)
    await click(document.querySelector('[data-qb="add-filter"]'))
    assert.equal(state.query.filter.children.length, 2)
    assert.equal(text('[data-qb="rule"]').length, 2)
    await click(document.querySelector('.qb-connector'))
    assert.equal(state.query.filter.operator, 'or')
    assert.equal(document.querySelector('.qb-connector')?.textContent, 'ou')
    await click(document.querySelector('[data-qb="add-group"]'))
    assert.equal(state.query.filter.children.at(-1).kind, 'group')
    await click(document.querySelector('[data-qb="group"] [data-qb="add-in-group"]'))
    assert.equal(state.query.filter.children.at(-1).children.length, 1)
    await click(document.querySelectorAll('[data-qb="rule"] .qb-chip-x')[0])
    assert.equal(state.query.filter.children.filter((node) => node.kind === 'rule').length, 1)
    await click(document.querySelector('[data-qb="sort"] .dbv-pill'))
    assert.equal(state.query.sorts[0].direction, 'desc')
  } finally { await act(async () => root.unmount()) }
})

test('construtor: popovers de exibição, fonte, filtro (opções e datas relativas) e limite', async () => {
  const { root, state } = await mountBuilder()
  try {
    await click(document.querySelector('[data-qb="display"]'))
    assert.deepEqual(text('[role="menuitem"]').map((label) => label.trim()), ['Tabela', 'Lista', 'Galeria', 'Quadro', 'Contagem'])
    await click(byText('[role="menuitem"]', 'Quadro'))
    assert.equal(state.query.display, 'board')
    await click(document.querySelector('[data-qb="source"]'))
    const kinds = text('.qb-kind')
    assert.equal(kinds.length, 10)
    assert.ok(text('.qb-dblist .qb-option').some((label) => label.includes('Tarefas')))
    await click(byText('.qb-dblist .qb-option', 'Tarefas'))
    assert.deepEqual(state.query.source, { kind: 'database', databaseIds: [ID.tasks] })
    await click(byText('.qb-kind', 'Tarefas'))
    assert.equal(state.query.source.kind, 'tasks')
    await click(byText('.qb-kind', 'Um banco de dados'))
    await click(byText('.qb-dblist .qb-option', 'Projetos'))
    // Editor de filtro: opções vêm dos bancos da fonte; datas relativas por atalhos.
    await click(document.querySelector('[data-qb="rule"] .dbv-pill'))
    assert.deepEqual(text('[data-qb="rule-editor"] .qb-option').map((label) => label.trim()), ['Em andamento', 'Pausado', 'Concluído'])
    await click(byText('[data-qb="rule-editor"] .qb-option', 'Pausado'))
    assert.equal(state.query.filter.children[0].value, 'Pausado')
    const select = document.querySelector('[data-qb="rule-editor"] select')
    await act(async () => { select.value = 'Prazo'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(state.query.filter.children[0].field, 'Prazo')
    await click(byText('[data-qb="rule-editor"] .qb-preset', 'Próxima semana'))
    assert.equal(state.query.filter.children[0].value, '@nextWeek')
    assert.ok((document.querySelector('[data-qb="rule"]')?.textContent ?? '').includes('próxima semana'))
    await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await click(document.querySelector('[data-qb="limit"]'))
    await click(byText('.qb-preset', '20'))
    assert.equal(state.query.limit, 20)
  } finally { await act(async () => root.unmount()) }
})

test('construtor somente leitura e em inglês', async () => {
  const { root, state } = await mountBuilder('en-US', true)
  try {
    const sentence = document.querySelector('.qb')?.textContent ?? ''
    assert.ok(sentence.startsWith('Show') && sentence.includes('where') && sentence.includes('sort by'), sentence)
    assert.equal(document.querySelectorAll('[data-qb="add-filter"]').length, 0)
    assert.ok([...document.querySelectorAll('.qb button')].every((button) => button.disabled))
    await click(document.querySelector('[data-qb="display"]'))
    assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0)
    assert.equal(state.changes, 0)
  } finally { await act(async () => root.unmount()) }
})

test('modo texto: texto válido atualiza o modelo; erro mostra a posição; construtor reflete no texto', async () => {
  const root = createRoot(document.getElementById('app'))
  const state = { query: start(), changes: 0 }
  let setOuter = () => {}
  const context = { locale: 'pt-BR', databases: [{ id: ID.projects, title: 'Projetos' }, { id: ID.tasks, title: 'Tarefas' }], properties: ['Status', 'Prazo', 'Feito'], options: { Status: ['Em andamento', 'Pausado'] } }
  function Harness() {
    const [query, setQuery] = React.useState(state.query)
    setOuter = setQuery
    return React.createElement(QueryTextEditor, { id: 'q1', query, context, serialize: { locale: 'pt-BR', databaseName: (id) => pages[id]?.title }, locale: 'pt-BR', readOnly: false, onChange: (next) => { state.query = next; state.changes++; setQuery(next) } })
  }
  const type = async (value) => {
    const area = document.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, value)
      area.selectionStart = area.selectionEnd = value.length
      area.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  try {
    await act(async () => root.render(React.createElement(Harness)))
    assert.equal(document.querySelector('textarea')?.value, 'tabela de "Projetos" onde Status = "Em andamento" ordenar Prazo')
    assert.ok(text('.fx-overlay .fx-property').includes('Status'))
    await type('lista de "Tarefas" onde Feito = não ordenar Prazo decrescente limite 5')
    assert.equal(state.query.display, 'list')
    assert.deepEqual(state.query.source, { kind: 'database', databaseIds: [ID.tasks] })
    assert.equal(state.query.limit, 5)
    const changes = state.changes
    await type('lista de "Tarefas" onde Feito =')
    assert.equal(state.changes, changes, 'texto inválido não altera a consulta')
    assert.ok((document.querySelector('.fx-status')?.textContent ?? '').includes('Erro na posição 32'))
    assert.equal(document.querySelectorAll('.fx-error-mark').length > 0, true)
    assert.ok(text('.fx-suggestion-label').includes('hoje'))
    // O construtor muda a consulta → o texto acompanha.
    await act(async () => setOuter({ ...state.query, display: 'count' }))
    assert.ok((document.querySelector('textarea')?.value ?? '').startsWith('contagem de "Tarefas"'))
  } finally { await act(async () => root.unmount()) }
})
