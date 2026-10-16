// Arrastar no Quadro e na Lista virtualizados (jsdom), com o hook real de ponteiro (shared/useDrag.ts)
// e a virtualização real: gestos pointerdown → vários pointermove → pointerup sobre um layout
// simulado (getBoundingClientRect calculado a partir da ordem dos nós e da rolagem).
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

const dom = new JSDOM('<!doctype html><body><div id="scroller" style="overflow-y:auto"><div id="app"></div></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
const W = dom.window
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'getComputedStyle' || name.endsWith('AnimationFrame') ? W[name].bind(W) : W[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(W, 'innerHeight', { configurable: true, value: 600 })
Object.defineProperty(W, 'innerWidth', { configurable: true, value: 1000 })

// ---------- layout simulado ----------
const scroller = document.getElementById('scroller')
let scrollTop = 0, contentHeight = 100000
Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 600 })
Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => 1000 })
Object.defineProperty(scroller, 'scrollWidth', { configurable: true, get: () => 1000 })
Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => contentHeight })
Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = Math.max(0, Math.min(contentHeight - 600, v)); scroller.dispatchEvent(new W.Event('scroll')) } })
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} })
const ROW = 32, CARD = 64, GAP = 8, HEADER = 40, COL_W = 250, COL_STEP = 260
const itemHeight = (el) => el.classList.contains('ls-row') || el.classList.contains('bd-card') ? (el.classList.contains('ls-row') ? ROW : CARD) : parseFloat(el.style?.height) || 0
W.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this === scroller) return rect(0, 0, 1000, 600)
  if (this.classList.contains('ls-rows')) return rect(0, -scrollTop, 800, contentHeight)
  if (this.classList.contains('bd-board')) return rect(0, -scrollTop, 1000, contentHeight)
  if (this.dataset.bdCol) { const i = [...this.parentElement.children].filter((c) => c.dataset.bdCol).indexOf(this); return rect(i * COL_STEP, -scrollTop, COL_W, contentHeight) }
  if (this.classList.contains('bd-col-cards')) { const col = this.closest('[data-bd-col]').getBoundingClientRect(); return rect(col.left, col.top + HEADER, COL_W, contentHeight) }
  const parent = this.parentElement
  if (parent && (parent.classList.contains('ls-rows') || parent.classList.contains('bd-col-cards'))) {
    const box = parent.getBoundingClientRect(), gap = parent.classList.contains('bd-col-cards') ? GAP : 0
    let top = box.top
    for (const sibling of parent.children) { if (sibling === this) break; top += itemHeight(sibling) + gap }
    return rect(box.left, top, box.width, itemHeight(this))
  }
  return rect(0, 0, 0, 0)
}
document.elementFromPoint = () => document.body

// ---------- store simulada ----------
let pages = {}
const calls = []
const order = () => Object.values(pages).filter((p) => p.parentId === 'db').sort((a, b) => a.order - b.order)
const known = {
  t: (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? '')),
  getState: () => ({ pages }),
  selectors: { rows: () => order() },
  actions: {
    movePage: (id, parentId, index) => { calls.push(['move', id, index]); const rest = order().filter((p) => p.id !== id); rest.splice(index, 0, pages[id]); rest.forEach((p, i) => { pages[p.id] = { ...p, order: i } }) },
    setProp: (id, propId, value) => { calls.push(['set', id, value]); pages[id] = { ...pages[id], props: { ...pages[id].props, [propId]: value } } },
    updateSchema() {},
  },
  getValue: (row, prop) => (prop.type === 'title' ? row.title : row.props?.[prop.id] ?? null),
  matchingRowColor: () => undefined, shownProps: () => [], OPTION_COLORS: [], randomColor: () => 'blue', optionColorLabel: () => '', coverCss: () => ({}),
  useRowMenu: () => ({ openMenu() {}, menuNode: null, menuRowId: null }),
  useRowCreation: () => ({ editingId: null, create() {}, stopEditing() {}, rename() {} }),
  useCardPropEditor: () => ({ propHandlers: () => ({}), editorNode: null }),
  RenameButton: () => null,
  ...(await import('../src/components/database/views/shared/cardNav.ts')),
  insertionIndex: (_db, rowId, beforeId, afterId) => {
    const siblings = order().filter((p) => p.id !== rowId)
    if (beforeId) { const i = siblings.findIndex((p) => p.id === beforeId); if (i >= 0) return i }
    if (afterId) { const i = siblings.findIndex((p) => p.id === afterId); if (i >= 0) return i + 1 }
    return undefined
  },
  indexFromY: (items, y) => { for (let i = 0; i < items.length; i++) { const r = items[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i } return items.length },
  ...(await import('../src/components/database/grouping.ts')),
  groupRows: (rows, prop) => {
    const groups = [{ option: null, rows: [] }, ...(prop.options ?? []).map((option) => ({ option, rows: [] }))]
    for (const row of rows) (groups.find((g) => g.option?.id === row.props?.[prop.id]) ?? groups[0]).rows.push(row)
    return groups
  },
}
const mocks = new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => null) })
globalThis.__dragVirtual = mocks

async function load(file, extra = {}) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__dragVirtual`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: file.endsWith('.ts') ? 'ts' : 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
Object.assign(known, await import('../src/components/database/virtual/useVirtualRows.ts'))
Object.assign(known, await load('../src/components/database/views/shared/useDrag.ts'))
const { ListView } = await load('../src/components/database/views/ListView.tsx')
const { BoardView } = await load('../src/components/database/views/BoardView.tsx')

// ---------- gestos ----------
const frame = () => new Promise((resolve) => setTimeout(resolve, 20))
const pointer = (type, target, x, y) => target.dispatchEvent(new W.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true }))
if (!W.PointerEvent) W.PointerEvent = class extends W.MouseEvent { constructor(type, init = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
const rowEl = (id) => document.querySelector(`[data-row-id="${id}"]`)
const center = (id) => { const r = rowEl(id).getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] }
/** pointerdown no item, `steps` movimentos até cada ponto (com pausa opcional), depois pointerup/Esc/pointercancel. */
async function gesture(id, points, end = 'up') {
  let [x, y] = center(id)
  await act(async () => { pointer('pointerdown', rowEl(id), x, y); await frame() })
  for (const [tx, ty, waitMs = 0] of points) {
    const sx = x, sy = y
    for (let i = 1; i <= 6; i++) { x = sx + ((tx - sx) * i) / 6; y = sy + ((ty - sy) * i) / 6; await act(async () => { pointer('pointermove', window, x, y); await frame() }) }
    if (waitMs) await act(async () => { await new Promise((resolve) => setTimeout(resolve, waitMs)); pointer('pointermove', window, x, y); await frame() })
  }
  const state = { ghost: !!document.querySelector('.vw-drag-ghost'), line: !!document.querySelector('.ls-drop-line, .bd-drop-line') }
  await act(async () => {
    if (end === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (end === 'cancel') pointer('pointercancel', window, x, y)
    pointer('pointerup', window, x, y)
    await frame()
  })
  return { ...state, ghostAfter: !!document.querySelector('.vw-drag-ghost') }
}

const view = { id: 'v', name: 'V', type: 'list', filters: [], sorts: [], hidden: [], widths: {} }
const db = { id: 'db', title: 'DB', locked: false }
function seed(count, status) {
  pages = {}
  for (let i = 0; i < count; i++) pages[`r${i}`] = { id: `r${i}`, parentId: 'db', title: `Row ${i}`, order: i, locked: false, text: '', props: { s: status ? status(i) : null } }
  calls.length = 0
}

test('Lista virtualizada (2500 linhas): reordenar, Esc, pointercancel e rolagem automática até fora da janela', async () => {
  seed(2500); scrollTop = 0; contentHeight = 2500 * ROW
  const schema = { properties: [{ id: 't', name: 'Name', type: 'title' }], views: [view], activeViewId: 'v' }
  const root = createRoot(document.getElementById('app'))
  const render = () => act(async () => root.render(React.createElement(ListView, { db, schema, view, rows: order(), visibleProps: [], readOnly: false, onOpenRow() {} })))
  await render()
  const rendered = document.querySelectorAll('.ls-row').length
  assert.ok(rendered > 10 && rendered < 200, `linhas no DOM: ${rendered}`)

  // Reordenar: r0 para logo antes de r5 (índice 4 entre os demais).
  const [, y5] = center('r5')
  const moved = await gesture('r0', [[30, y5 - 10]])
  assert.equal(moved.ghost, true); assert.equal(moved.line, true); assert.equal(moved.ghostAfter, false)
  assert.deepEqual(calls.at(-1), ['move', 'r0', 4])
  await render()
  assert.equal(order().map((p) => p.id).slice(0, 6).join(','), 'r1,r2,r3,r4,r0,r5')

  // Esc e pointercancel cancelam sem mover.
  calls.length = 0
  await gesture('r1', [[30, center('r8')[1]]], 'escape')
  await gesture('r1', [[30, center('r8')[1]]], 'cancel')
  assert.equal(calls.length, 0)
  assert.equal(document.body.classList.contains('vw-dragging'), false)

  // Rolagem automática: segurar perto da borda inferior leva até linhas que nem estavam montadas.
  const outside = 'r200'
  assert.equal(rowEl(outside) === null, true)
  let [x, y] = center('r2')
  await act(async () => { pointer('pointerdown', rowEl('r2'), x, y); await frame() })
  for (let i = 1; i <= 6; i++) await act(async () => { pointer('pointermove', window, x, y + ((590 - y) * i) / 6); await frame() })
  for (let i = 0; i < 400 && scrollTop < 6000; i++) await act(async () => { await frame() })
  await act(async () => { pointer('pointermove', window, x, 300); await frame(); await frame() })
  assert.ok(scrollTop >= 6000, `rolou ${scrollTop}px`)
  assert.equal(rowEl(outside) !== null, true, 'linha antes fora da janela agora montada')
  // Solta antes da linha sob o ponteiro (agora montada pela virtualização).
  const under = [...document.querySelectorAll('.ls-row')].find((el) => { const r = el.getBoundingClientRect(); return r.top <= 300 && r.bottom > 300 })
  const underId = under.dataset.rowId
  const lineNext = document.querySelector('.ls-drop-line')?.nextElementSibling?.dataset.rowId ?? ''
  calls.length = 0
  await act(async () => { pointer('pointerup', window, x, 300); await frame() })
  assert.equal(calls.length, 1)
  const ids = order().map((p) => p.id)
  assert.ok(ids.indexOf('r2') > 150, `nova posição ${ids.indexOf('r2')}`)
  assert.equal(ids[ids.indexOf('r2') + 1], lineNext || underId)
  await act(async () => root.unmount())
})

test('Quadro virtualizado (2400 cartões): entre colunas, dentro da coluna, coluna vazia no fim, Esc e rolagem automática', async () => {
  const options = [{ id: 'a', name: 'A', color: 'blue' }, { id: 'b', name: 'B', color: 'green' }, { id: 'c', name: 'C', color: 'red' }]
  seed(2400, (i) => options[i % 3].id); scrollTop = 0; contentHeight = 800 * (CARD + GAP) + HEADER
  const schema = { properties: [{ id: 't', name: 'Name', type: 'title' }, { id: 's', name: 'Status', type: 'status', options }], views: [], activeViewId: 'v' }
  const boardView = { ...view, type: 'board', groupBy: 's' }
  const root = createRoot(document.getElementById('app'))
  const render = () => act(async () => root.render(React.createElement(BoardView, { db, schema, view: boardView, rows: order(), visibleProps: [], readOnly: false, onOpenRow() {} })))
  await render()
  const colIds = (key) => [...document.querySelectorAll(`[data-bd-col="${key}"] [data-row-id]`)].map((el) => el.dataset.rowId)
  const cards = document.querySelectorAll('.bd-card').length
  assert.ok(cards > 10 && cards < 300, `cartões no DOM: ${cards}`)
  assert.equal(document.querySelector('[data-bd-col="__none__"]') === null, true)

  // Entre colunas: primeiro de A (r0) para antes do 2º cartão de B (r4).
  const bSecond = colIds('b')[1]
  const [bx, by] = center(bSecond)
  let result = await gesture('r0', [[bx, by - 20]])
  assert.equal(result.line, true)
  assert.deepEqual(calls.slice(-2).map((c) => c.slice(0, 2).join(':')), ['set:r0', 'move:r0'])
  assert.equal(pages.r0.props.s, 'b')
  await render()
  assert.equal(colIds('b').indexOf('r0'), 1)

  // Dentro da coluna: r3 (1º de A agora) para depois do 3º cartão de A.
  calls.length = 0
  const a = colIds('a')
  await gesture(a[0], [[center(a[3])[0], center(a[3])[1] - 20]])
  assert.equal(calls.some((c) => c[0] === 'set'), false, JSON.stringify(calls) + JSON.stringify(a.slice(0, 4)))
  await render()
  assert.equal(colIds('a').indexOf(a[0]), 2, JSON.stringify(calls) + colIds('a').slice(0, 4).join(','))

  // Coluna vazia "Sem Status": só aparece durante o arraste e no FIM (não desloca as colunas sob o ponteiro).
  calls.length = 0
  let [x, y] = center(colIds('c')[0])
  const firstC = colIds('c')[0]
  await act(async () => { pointer('pointerdown', rowEl(firstC), x, y); await frame() })
  await act(async () => { pointer('pointermove', window, x + 10, y + 10); await frame() })
  const cols = [...document.querySelectorAll('[data-bd-col]')].map((el) => el.dataset.bdCol)
  assert.equal(cols.join(','), 'a,b,c,__none__')
  const noneLeft = 3 * COL_STEP + 60
  for (let i = 1; i <= 6; i++) await act(async () => { pointer('pointermove', window, x + ((noneLeft - x) * i) / 6, 200); await frame() })
  assert.equal(document.querySelector('.bd-col-target')?.dataset.bdCol, '__none__')
  await act(async () => { pointer('pointerup', window, noneLeft, 200); await frame() })
  assert.equal(pages[firstC].props.s, null)

  // Esc cancela.
  calls.length = 0
  await render()
  await gesture(colIds('b')[0], [[center(colIds('a')[2])[0], center(colIds('a')[2])[1]]], 'escape')
  assert.equal(calls.length, 0)

  // Rolagem automática dentro da coluna B até cartões fora da janela virtual.
  await render()
  const dragged = colIds('b')[2]
  ;[x, y] = center(dragged)
  await act(async () => { pointer('pointerdown', rowEl(dragged), x, y); await frame() })
  for (let i = 1; i <= 6; i++) await act(async () => { pointer('pointermove', window, x, y + ((592 - y) * i) / 6); await frame() })
  for (let i = 0; i < 400 && scrollTop < 6000; i++) await act(async () => { await frame() })
  await act(async () => { pointer('pointermove', window, x, 300); await frame(); await frame() })
  assert.ok(scrollTop >= 6000, `rolou ${scrollTop}px`)
  const skip = Number(document.querySelector('[data-bd-col="b"] .bd-col-cards').dataset.skip)
  assert.ok(skip > 50, `cartões acima da janela: ${skip}`)
  const lineNext = document.querySelector('[data-bd-col="b"] .bd-drop-line')?.nextElementSibling?.dataset.rowId
  calls.length = 0
  await act(async () => { pointer('pointerup', window, x, 300); await frame() })
  const bOrder = order().filter((p) => p.props.s === 'b').map((p) => p.id)
  assert.ok(bOrder.indexOf(dragged) > 50, `posição na coluna: ${bOrder.indexOf(dragged)}`)
  assert.equal(bOrder[bOrder.indexOf(dragged) + 1], lineNext)
  await act(async () => root.unmount())
})

// Encerra o laço de requestAnimationFrame do jsdom (senão o processo não termina).
test.after(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); W.close() })
