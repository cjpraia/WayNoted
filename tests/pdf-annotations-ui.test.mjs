// Painel "Anotações" e barra do visualizador de PDF no DOM (jsdom). Asserts comparam strings, números e booleanos (nunca nós do DOM).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { shimUi } from './fixtures/ui-shim.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

const cache = new Map()
async function load(rel) {
  const url = new URL(rel, import.meta.url)
  if (cache.has(url.href)) return cache.get(url.href)
  let source = shimUi(await readFile(url, 'utf8'))
  for (const dep of [...source.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])) {
    const file = /\.tsx?$/.test(dep) ? dep : (await readFile(new URL(dep + '.tsx', url)).then(() => dep + '.tsx', () => dep + '.ts'))
    source = source.split(`'${dep}'`).join(`'${await load(new URL(file, url).href)}'`)
  }
  const out = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' }, lang: url.pathname.endsWith('x') ? 'tsx' : 'ts' })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, dataUrl)
  return dataUrl
}
const { AnnotationPanel } = await import(await load('../src/components/pdf/AnnotationPanel.tsx'))
const { PdfToolbar, TOOLS } = await import(await load('../src/components/pdf/PdfToolbar.tsx'))
const { ANN_COLORS } = await import(await load('../src/components/pdf/annotations.ts'))
const h = React.createElement
const tFor = (locale) => (pt, en) => (locale === 'en-US' ? en : pt)
const ann = (patch) => ({ id: 'a', kind: 'highlight', page: 1, color: 'yellow', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }], created: 1, updated: 1, ...patch })
const list = [
  ann({ id: 'a', page: 1, quote: 'Primeiro trecho', text: 'comentário um' }), ann({ id: 'b', page: 2, color: 'green', quote: 'Segundo trecho' }),
  ann({ id: 'c', page: 2, kind: 'note', rects: undefined, x: 0.5, y: 0.5, color: 'blue', text: 'uma nota' }),
]
const text = (sel) => document.querySelector(sel)?.textContent ?? '<none>'
const count = (sel) => document.querySelectorAll(sel).length
const click = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
let root
async function mount(element) {
  document.getElementById('app').replaceChildren()
  root = createRoot(document.getElementById('app'))
  await act(async () => root.render(element))
}
const panelProps = (extra = {}) => ({ t: tFor('en-US'), annotations: list, selectedId: null, color: null, onColor() {}, query: '', onQuery() {}, onJump() {}, onCopy() {}, onInsert() {}, canInsert: true, formatDate: () => '01/01/26', ...extra })

test('panel lists annotations grouped by page with kind, color, date, quote and comment', async () => {
  await mount(h(AnnotationPanel, panelProps()))
  assert.equal(count('.pdf-panel section'), 2)
  assert.deepEqual([...document.querySelectorAll('.pdf-list h4')].map((x) => x.textContent), ['Page 1', 'Page 2'])
  assert.equal(count('.pdf-item'), 3)
  assert.equal(text('.pdf-item-meta'), 'Highlight · Yellow · 01/01/26')
  assert.equal(text('.pdf-item-quote'), 'Primeiro trecho')
  assert.equal(text('.pdf-item-text'), 'comentário um')
  assert.equal(document.querySelector('.pdf-panel').getAttribute('aria-label'), 'Annotations')
  assert.equal(text('.pdf-panel-count'), '3')
  await act(async () => root.unmount())
})

test('panel is localized in pt-BR and shows the empty state', async () => {
  await mount(h(AnnotationPanel, panelProps({ t: tFor('pt-BR'), annotations: [] })))
  assert.equal(document.querySelector('.pdf-panel').getAttribute('aria-label'), 'Anotações')
  assert.ok(text('.pdf-empty').startsWith('Nenhuma anotação ainda'))
  assert.equal(document.querySelectorAll('.pdf-panel-foot button[disabled]').length, 2)
  await act(async () => root.unmount())
})

test('panel filter, search, jump and the two export actions call back', async () => {
  const calls = []
  await mount(h(AnnotationPanel, panelProps({ onColor: (c) => calls.push(['color', c]), onQuery: (q) => calls.push(['query', q]), onJump: (a) => calls.push(['jump', a.id]), onCopy: () => calls.push(['copy']), onInsert: () => calls.push(['insert']) })))
  const swatches = [...document.querySelectorAll('.pdf-filter .pdf-swatch')]
  assert.equal(swatches.length, ANN_COLORS.length)
  assert.deepEqual(swatches.map((s) => s.getAttribute('aria-label')), ['Yellow', 'Green', 'Blue', 'Pink', 'Orange'])
  await click(swatches[1])
  const input = document.querySelector('.pdf-search input')
  assert.equal(input.getAttribute('aria-label'), 'Search annotations')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'seg'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click(document.querySelectorAll('.pdf-item')[2])
  const [copy, insert] = [...document.querySelectorAll('.pdf-panel-foot button')]
  assert.equal(copy.textContent.trim(), 'Copy highlights as Markdown')
  assert.equal(insert.textContent.trim(), 'Insert highlights into the page')
  await click(copy); await click(insert)
  assert.deepEqual(calls, [['color', 'green'], ['query', 'seg'], ['jump', 'c'], ['copy'], ['insert']])
  await act(async () => root.unmount())
})

test('panel filters by color and by search text, and marks the selected item', async () => {
  await mount(h(AnnotationPanel, panelProps({ color: 'green' })))
  assert.equal(count('.pdf-item'), 1)
  assert.equal(text('.pdf-item-quote'), 'Segundo trecho')
  await act(async () => root.render(h(AnnotationPanel, panelProps({ query: 'NOTA', selectedId: 'c' }))))
  assert.equal(count('.pdf-item'), 1)
  assert.equal(document.querySelector('.pdf-item').getAttribute('aria-current'), 'true')
  await act(async () => root.render(h(AnnotationPanel, panelProps({ query: 'inexistente' }))))
  assert.equal(count('.pdf-item'), 0)
  assert.ok(text('.pdf-empty').startsWith('No annotations match'))
  await act(async () => root.unmount())
})

const barProps = (extra = {}) => ({
  t: tFor('en-US'), name: 'livro.pdf', page: 2, total: 5, onPage() {}, zoom: 1, onZoom() {}, onRotate() {}, annotate: false, onAnnotate() {}, tool: 'highlight', onTool() {}, color: 'yellow', onColor() {},
  penSize: 'medium', onPenSize() {}, canUndo: false, canRedo: true, onUndo() {}, onRedo() {}, panelOpen: false, onPanel() {}, count: 2, onExport() {}, exporting: false, ...extra,
})

test('toolbar hides tools until annotate mode is on, and every control has an accessible name', async () => {
  const calls = []
  await mount(h(PdfToolbar, barProps({ onAnnotate: (v) => calls.push(['annotate', v]), onPage: (n) => calls.push(['page', n]), onZoom: (z) => calls.push(['zoom', z]), onExport: () => calls.push(['export']) })))
  assert.equal(count('.pdf-tools'), 0)
  const toggle = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Annotate'))
  assert.equal(toggle.getAttribute('aria-pressed'), 'false')
  await click(toggle)
  assert.equal(text('.pdf-pageno'), '2 / 5')
  await click(document.querySelector('[aria-label="Next page"]'))
  await click(document.querySelector('[aria-label="Zoom in"]'))
  const exportButton = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Export with annotations'))
  await click(exportButton)
  assert.deepEqual(calls, [['annotate', true], ['page', 3], ['zoom', 1.25], ['export']])
  const unnamed = [...document.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).length
  assert.equal(unnamed, 0)
  await act(async () => root.unmount())
})

test('toolbar tool buttons, colors, pen size and undo/redo state in annotate mode', async () => {
  const calls = []
  await mount(h(PdfToolbar, barProps({ annotate: true, tool: 'pen', onTool: (x) => calls.push(['tool', x]), onColor: (c) => calls.push(['color', c]), onRedo: () => calls.push(['redo']), onUndo: () => calls.push(['undo']) })))
  const tools = [...document.querySelectorAll('.pdf-tools .pdf-group:first-child button')]
  assert.equal(tools.length, TOOLS.length)
  assert.deepEqual(tools.map((b) => b.getAttribute('aria-pressed')), TOOLS.map((x) => String(x === 'pen')))
  assert.ok(tools.every((b) => b.getAttribute('aria-label').length > 3))
  await click(tools[0])
  await click(document.querySelector('.pdf-tools [aria-label="Pink"]'))
  assert.equal(document.querySelector('.pdf-tools [aria-label="Yellow"]').getAttribute('aria-pressed'), 'true')
  assert.equal(count('[aria-label="Pen thickness"]'), 1)
  assert.equal(document.querySelector('[aria-label="Undo annotation"]').disabled, true)
  assert.equal(document.querySelector('[aria-label="Redo annotation"]').disabled, false)
  await click(document.querySelector('[aria-label="Redo annotation"]'))
  await click(document.querySelector('[aria-label="Undo annotation"]'))
  assert.deepEqual(calls, [['tool', 'select'], ['color', 'pink'], ['redo']])
  await act(async () => root.render(h(PdfToolbar, barProps({ annotate: true, tool: 'highlight' }))))
  assert.equal(count('[aria-label="Pen thickness"]'), 0)
  await act(async () => root.unmount())
})

test('toolbar: export is disabled with no annotations or while exporting; read-only blocks annotate', async () => {
  await mount(h(PdfToolbar, barProps({ count: 0 })))
  const find = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label))
  assert.equal(find('Export with annotations').disabled, true)
  await act(async () => root.render(h(PdfToolbar, barProps({ readOnly: true }))))
  assert.equal(find('Annotate').disabled, true)
  await act(async () => root.render(h(PdfToolbar, barProps({ exporting: true }))))
  assert.equal(find('Export with annotations').disabled, true)
  await act(async () => root.unmount())
})
