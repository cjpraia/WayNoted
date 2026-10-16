// Prévia de importação de CSV (jsdom): a escolha de tipo por coluna no Select chega como onType(índice, tipo)
// e, via replanColumn, define o tipo final de cada propriedade criada. Asserts só com strings/números/booleanos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const { createRoot } = await import('react-dom/client')

const cache = new Map()
async function load(rel, patch = (s) => s) {
  const url = new URL(rel, import.meta.url)
  if (cache.has(url.href)) return cache.get(url.href)
  let source = inlineProductSource(patch(await readFile(url, 'utf8'))).replace(/^import '[^']+\.css'\s*$/gm, '')
  for (const dep of [...source.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])) {
    if (/\/i18n$/.test(dep)) { source = source.split(`'${dep}'`).join(`'data:text/javascript,export const t=(pt)=>pt'`); continue }
    const file = /\.tsx?$/.test(dep) ? dep : (await readFile(new URL(dep + '.tsx', url)).then(() => dep + '.tsx', () => dep + '.ts'))
    source = source.split(`'${dep}'`).join(`'${await load(new URL(file, url).href)}'`)
  }
  const out = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' }, lang: url.pathname.endsWith('x') ? 'tsx' : 'ts' })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom\/server|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, dataUrl)
  return dataUrl
}
const iconStub = `data:text/javascript,export const Icon=(p)=>null`
await load('../src/components/ui/Select.tsx', (s) => s.replace("from './icons/Icon'", `from '${iconStub}'`))
const { CsvImportPreview } = await import(await load('../src/components/database/CsvImportPreview.tsx', (s) => s.replace("from '../ui/Select'", `from '${cache.get(new URL('../src/components/ui/Select.tsx', import.meta.url).href)}'`)))
const { inferColumn, replanColumn, convertPlannedCell } = await import(await load('../src/components/database/csvInfer.ts'))
const h = React.createElement

const CSV = [['nome', 'status', 'prazo', 'valor'], ['A', 'Aberto', '2026-01-02', '10'], ['B', 'Feito', '2026-02-03', '1.234,50'], ['C', 'Aberto', '2026-03-04', '7']]
const cellsOf = (i) => CSV.slice(1).map((r) => r[i])
const initial = () => CSV[0].map((header, index) => index === 0
  ? { index, header, role: 'title' }
  : { index, header, role: 'new', plan: inferColumn(index, header, cellsOf(index), 'pt-BR') })

// Mesma lógica de DatabaseView.changeCsvType (troca de tipo → replanColumn).
let state, confirmed = 0
function Harness() {
  const [columns, setColumns] = React.useState(initial)
  state = columns
  const onType = (index, type) => setColumns((cur) => cur.map((c) => c.index === index && c.plan ? { ...c, plan: replanColumn(c.plan, type, cellsOf(index), 'pt-BR') } : c))
  return h(CsvImportPreview, { fileName: 't.csv', rowCount: 3, columns, sample: CSV.slice(1), busy: false, onType, onConfirm: () => { confirmed++ }, onCancel: () => {} })
}

let root
async function chooseType(header, label) {
  const trigger = [...document.querySelectorAll('button[role=combobox]')].find((b) => b.getAttribute('aria-label') === `Tipo da propriedade ${header}`)
  assert.ok(trigger != null, `select da coluna ${header}`)
  await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const option = [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.trim() === label)
  assert.ok(option != null, `opção ${label}`)
  await act(async () => { option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
}
const types = () => state.filter((c) => c.role === 'new').map((c) => `${c.header}:${c.plan.type}`).join(',')
const shownTypes = () => [...document.querySelectorAll('button[role=combobox]')].map((b) => b.textContent.trim()).join(',')

test('tipos inferidos aparecem nos selects e a troca por coluna atualiza o plano final', async () => {
  document.getElementById('app').innerHTML = ''
  root = createRoot(document.getElementById('app'))
  await act(async () => root.render(h(Harness)))
  assert.equal(types(), 'status:text,prazo:date,valor:number')
  assert.equal(shownTypes(), 'Texto,Data,Número')

  await chooseType('status', 'Seleção')
  assert.equal(types(), 'status:select,prazo:date,valor:number')
  await chooseType('prazo', 'Texto')
  await chooseType('valor', 'Ignorar')
  assert.equal(types(), 'status:select,prazo:text,valor:ignore')
  assert.equal(shownTypes(), 'Seleção,Texto,Ignorar')

  // Propriedades que o import criaria: tudo que não é "ignorar", com o tipo escolhido.
  const created = state.filter((c) => c.role === 'new' && c.plan.type !== 'ignore').map((c) => `${c.plan.header}:${c.plan.type}`)
  assert.equal(created.join(','), 'status:select,prazo:text')
})

test('número e data escolhidos manualmente convertem as células; tipo errado conta problemas', async () => {
  await chooseType('prazo', 'Data')
  await chooseType('valor', 'Número')
  const prazo = state.find((c) => c.header === 'prazo').plan, valor = state.find((c) => c.header === 'valor').plan
  assert.equal(prazo.type, 'date'); assert.equal(valor.type, 'number')
  assert.equal(convertPlannedCell(valor, '1.234,50').value, 1234.5)
  assert.equal(convertPlannedCell(prazo, '2026-02-03').value.start, '2026-02-03')
  await chooseType('status', 'Número')
  assert.equal(state.find((c) => c.header === 'status').plan.problems, 3)
  await chooseType('status', 'Texto')
  assert.equal(state.find((c) => c.header === 'status').plan.problems, 0)
})

test('Importar chama onConfirm e a coluna de título não tem select', async () => {
  const before = confirmed
  const button = [...document.querySelectorAll('footer button')].find((b) => b.textContent.startsWith('Importar'))
  assert.ok(button != null, 'botão importar')
  await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  assert.equal(confirmed, before + 1)
  assert.equal(document.querySelectorAll('button[role=combobox]').length, 3)
  await act(async () => root.unmount())
})
