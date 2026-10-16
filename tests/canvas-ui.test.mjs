// Lousa (jsdom): barra vertical com menus laterais e painel de propriedades.
// Regras: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import * as model from '../src/canvas/model.ts'
import * as templates from '../src/canvas/templates.ts'
import * as tools from '../src/components/canvas/tools.ts'
import * as sketch from '../src/canvas/sketch.ts'
import * as layers from '../src/canvas/layers.ts'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// React precisa ser carregado DEPOIS de existir um DOM: senão ele decide, na importação, usar o polyfill de eventos do IE.
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const h = React.createElement
globalThis.__cv = {
  useI18n: () => ({ locale: 'en-US', t }),
  ...model, ...templates, ...tools, ...sketch, ...layers,
  CanvasIcon: () => null,
  Swatches: ({ colors, value, onPick }) => h('div', { role: 'radiogroup' }, colors.map(c => h('button', { key: c, type: 'button', role: 'radio', 'aria-checked': value === c, 'aria-label': c, onClick: () => onPick(c) }))),
  IconButton: ({ label, title, active, onClick, disabled, children, ...rest }) => h('button', { type: 'button', ...rest, 'aria-label': label, title: title ?? label, 'aria-pressed': rest['aria-pressed'] ?? active ?? undefined, disabled, onClick }, children),
  Button: ({ children, onClick, disabled, ...rest }) => h('button', { type: 'button', disabled, onClick, ...rest }, children),
}

async function compile(file, name) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
    .replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => module === 'react' ? match
      : `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+) as (\w+)/g, '$1: $2')}=globalThis.__cv`)
  const out = await transformWithOxc(source, name, { jsx: { runtime: 'automatic' } })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_m, mod) => `from ${JSON.stringify(import.meta.resolve(mod))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const { BoardToolbar } = await compile('../src/components/canvas/Toolbar.tsx', 'Toolbar.tsx')
const { BoardInspector } = await compile('../src/components/canvas/Inspector.tsx', 'Inspector.tsx')
const { BoardLayers } = await compile('../src/components/canvas/Layers.tsx', 'Layers.tsx')
const container = document.getElementById('app')
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
const byLabel = (label) => container.querySelector(`[aria-label="${label}"]`)
const labels = () => [...container.querySelectorAll('button')].map(b => b.getAttribute('aria-label') ?? b.textContent)

test('vertical toolbar: tools with Figma/Excalidraw shortcuts, shape and template flyouts', async () => {
  const calls = []
  const props = { tool: 'select', readOnly: false, noteColor: 'yellow', penColor: 'default', penSize: 3, library: [], canSaveLibrary: false,
    onTool: x => calls.push(['tool', x]), onNoteColor: c => calls.push(['note', c]), onPenColor: () => {}, onPenSize: () => {}, onImage: () => calls.push(['image']), onPage: () => calls.push(['page']), onUndo: () => calls.push(['undo']), onRedo: () => {},
    onTemplate: id => calls.push(['template', id]), onLibraryInsert: () => {}, onLibrarySave: n => calls.push(['save', n]), onLibraryDelete: () => {} }
  const root = createRoot(container)
  await act(async () => root.render(h(BoardToolbar, props)))
  assert.equal(container.querySelector('[role="toolbar"]').getAttribute('aria-orientation'), 'vertical')
  assert.equal(byLabel('Select').getAttribute('title'), 'Select (V · 1)')
  assert.equal(byLabel('Lasso (freehand select)').getAttribute('title'), 'Lasso (freehand select) (Q)')
  await click(byLabel('Lasso (freehand select)'))
  assert.deepEqual(calls.at(-1), ['tool', 'lasso'])
  assert.equal(byLabel('Section (frame)').getAttribute('title'), 'Section (frame) (F)')
  await click(byLabel('Shapes'))
  assert.deepEqual(calls.at(-1), ['tool', 'rect'])
  assert.ok(labels().includes('Ellipse') && labels().includes('Diamond'), 'shape flyout open')
  await click(byLabel('Ellipse'))
  assert.deepEqual(calls.at(-1), ['tool', 'ellipse'])
  assert.ok(!labels().includes('Diamond'), 'flyout closes after picking')
  await click(byLabel('Templates'))
  const kanban = [...container.querySelectorAll('.cv-fly-item')].find(el => el.textContent.startsWith('Kanban'))
  assert.ok(kanban !== undefined)
  await click(kanban)
  assert.deepEqual(calls.at(-1), ['template', 'kanban'])
  await click(byLabel('Page or database (live card)'))
  assert.deepEqual(calls.at(-1), ['page'])
  await act(async () => root.render(h(BoardToolbar, { ...props, readOnly: true })))
  assert.deepEqual(labels(), ['Select', 'Lasso (freehand select)', 'Hand (pan)'], 'read-only whiteboard only navigates')
  await act(async () => root.render(h(BoardToolbar, { ...props, canSaveLibrary: true })))
  await click(byLabel('Library'))
  assert.ok(labels().includes('Save selection'))
  await act(async () => root.unmount())
})

test('properties panel: geometry fields, fill, stroke, hand-drawn level and fonts patch the selection', async () => {
  let current = { id: 's', type: 'shape', shape: 'rect', x: 10, y: 20, w: 200, h: 100, text: 'A', color: 'blue', fill: 'tint' }
  const patches = []
  const props = { objects: [current], onPatch: (fn, key) => { current = fn(current); patches.push(key ?? '') }, onAlign: () => {}, onReorder: () => {}, onLock: () => {}, onGroup: () => {}, onUngroup: () => {}, onDelete: () => {}, onDuplicate: () => {}, onEdit: () => {}, onSaveLibrary: () => patches.push('library') }
  const root = createRoot(container)
  await act(async () => root.render(h(BoardInspector, props)))
  const x = container.querySelector('input[aria-label="X"]')
  assert.equal(x.value, '10')
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setValue.call(x, '42'); x.dispatchEvent(new window.Event('input', { bubbles: true })) })
  await act(async () => { x.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })) })
  assert.equal(current.x, 42, 'typed X commits on blur')
  assert.equal(patches.at(-1), 'geom:s')
  await click([...container.querySelectorAll('.cv-seg button')].find(b => b.textContent === 'Hatch'))
  assert.equal(current.fill, 'hachure')
  await click(byLabel('Dotted'))
  assert.equal(current.strokeStyle, 'dotted')
  await click([...container.querySelectorAll('.cv-seg button')].find(b => b.textContent === 'Cartoonist'))
  assert.equal(current.sketch, 3)
  await click([...container.querySelectorAll('.cv-seg button')].find(b => b.textContent === 'Crisp'))
  assert.equal(current.sketch, undefined)
  await click([...container.querySelectorAll('.cv-seg button')].find(b => b.textContent === 'Hand'))
  assert.equal(current.font, 'hand')
  await click(byLabel('Save to library'))
  assert.equal(patches.at(-1), 'library')
  // Objeto travado: sem controles de edição, mas com destravar.
  await act(async () => root.render(h(BoardInspector, { ...props, objects: [{ ...current, locked: true }] })))
  assert.ok(container.querySelector('input[aria-label="X"]') === null, 'no geometry fields when locked')
  assert.ok(labels().includes('Unlock'))
  await act(async () => root.unmount())
})

test('hand-drawn style is offered for sticky notes and sections, not for text or images', async () => {
  for (const [object, offered] of [[{ id: 'n', type: 'note', x: 0, y: 0, w: 200, h: 200, text: '', color: 'yellow' }, true], [{ id: 's', type: 'section', x: 0, y: 0, w: 400, h: 300, title: '', color: 'gray' }, true], [{ id: 't', type: 'text', x: 0, y: 0, w: 200, h: 40, text: '', color: 'default', fontSize: 20 }, false]]) {
    let current = object
    const props = { objects: [current], onPatch: fn => { current = fn(current) }, onAlign: () => {}, onReorder: () => {}, onLock: () => {}, onGroup: () => {}, onUngroup: () => {}, onDelete: () => {}, onDuplicate: () => {}, onEdit: () => {}, onSaveLibrary: () => {} }
    const root = createRoot(container)
    await act(async () => root.render(h(BoardInspector, props)))
    const artist = [...container.querySelectorAll('.cv-seg button')].find(b => b.textContent === 'Artist')
    assert.equal(artist !== undefined, offered, `${object.type}: hand-drawn control`)
    if (offered) { await click(artist); assert.equal(current.sketch, 2) }
    await act(async () => root.unmount())
  }
})

test('layers panel: tree, select, rename, hide, lock and drag to reorder', async () => {
  const note = (id, x, y, extra = {}) => ({ id, type: 'note', x, y, w: 100, h: 80, text: id, color: 'yellow', ...extra })
  const objects = [{ id: 'S', type: 'section', x: 0, y: 0, w: 500, h: 300, title: 'Plano', color: 'gray' }, note('a', 20, 40), note('b', 200, 40, { hidden: true }), note('out', 900, 900, { locked: true })]
  const calls = []
  const props = { objects, selection: new Set(['a']), readOnly: false, cardTitle: () => 'Pagina', onSelect: (ids, add) => calls.push(['select', ids.join(','), add]), onPatch: (ids, patch) => calls.push(['patch', ids.join(','), JSON.stringify(patch)]), onMove: (id, target, pos) => calls.push(['move', id, target, pos]), onClose: () => calls.push(['close']) }
  const root = createRoot(container)
  await act(async () => root.render(h(BoardLayers, props)))
  const rows = () => [...container.querySelectorAll('[role="treeitem"]')]
  const names = () => rows().map(r => r.querySelector('.cv-layer-name')?.textContent)
  assert.deepEqual(names(), ['out', 'Plano', 'b', 'a'], 'front-most first; section children indented below their section')
  assert.deepEqual(rows().map(r => r.getAttribute('aria-level')), ['1', '1', '2', '2'])
  assert.equal(rows()[3].getAttribute('aria-selected'), 'true')
  assert.ok(rows()[2].className.includes('is-hidden') && rows()[0].className.includes('is-locked'))
  assert.equal(container.querySelector('[role="tree"]').getAttribute('aria-label'), 'Whiteboard objects, front to back')
  // clicar seleciona; ⇧ soma
  await click(rows()[2])
  assert.deepEqual(calls.at(-1), ['select', 'b', false])
  await act(async () => { rows()[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true })) })
  assert.deepEqual(calls.at(-1), ['select', 'a', true])
  // olho e cadeado
  await click(rows()[3].querySelector('[aria-label="Hide layer"]'))
  assert.deepEqual(calls.at(-1), ['patch', 'a', '{"hidden":true}'])
  await click(rows()[2].querySelector('[aria-label="Show layer"]'))
  assert.deepEqual(calls.at(-1), ['patch', 'b', '{"hidden":false}'])
  await click(rows()[0].querySelector('[aria-label="Unlock layer"]'))
  assert.deepEqual(calls.at(-1), ['patch', 'out', '{"locked":false}'])
  // ocultar a seção leva o conteúdo junto
  await click(rows()[1].querySelector('[aria-label="Hide layer"]'))
  const hideSection = calls.at(-1)
  assert.equal(hideSection[0], 'patch'); assert.deepEqual(hideSection[1].split(',').sort(), ['S', 'a', 'b'])
  // recolher seção esconde os filhos
  await click(rows()[1].querySelector('[aria-label="Collapse"]'))
  assert.deepEqual(names(), ['out', 'Plano'])
  await click(rows()[1].querySelector('[aria-label="Expand"]'))
  assert.equal(rows().length, 4)
  // renomear: duplo clique → campo → Enter (blur) grava; vazio limpa o nome
  await act(async () => { rows()[3].dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })) })
  const input = container.querySelector('input[aria-label="Layer name"]')
  assert.ok(input !== null, 'rename field opens')
  
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => { setValue.call(input, '  Meu card  '); input.dispatchEvent(new window.Event('input', { bubbles: true })) })
  await act(async () => { input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })) })
  assert.deepEqual(calls.at(-1), ['patch', 'a', '{"layerName":"Meu card"}'])
  assert.ok(container.querySelector('input[aria-label="Layer name"]') === null, 'field closes')
  // Esc cancela
  await act(async () => { rows()[3].dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })) })
  const count = calls.length
  const input2 = container.querySelector('input[aria-label="Layer name"]')
  await act(async () => { input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); input2.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })) })
  assert.equal(calls.length, count, 'Escape does not rename ' + JSON.stringify(calls.slice(-2)))
  // arrastar a nota "a" para cima da "out" (parte de cima da linha) → mover "above"
  const target = rows()[0]
  target.getBoundingClientRect = () => ({ top: 100, height: 28, left: 0, right: 200, bottom: 128, width: 200, x: 0, y: 100 })
  await act(async () => { rows()[3].dispatchEvent(new window.Event('dragstart', { bubbles: true })) })
  const over = new window.Event('dragover', { bubbles: true, cancelable: true }); over.clientY = 104
  await act(async () => { target.dispatchEvent(over) })
  assert.ok(target.className.includes('is-drop-above'), 'drop indicator above')
  const dropEvent = new window.Event('drop', { bubbles: true, cancelable: true }); dropEvent.clientY = 104
  await act(async () => { target.dispatchEvent(dropEvent) })
  assert.deepEqual(calls.at(-1), ['move', 'a', 'out', 'above'])
  // locked layers cannot be dragged
  assert.equal(rows()[0].getAttribute('draggable'), 'false')
  assert.equal(rows()[3].getAttribute('draggable'), 'true')
  // fechar
  await click(byLabel('Close layers'))
  assert.deepEqual(calls.at(-1), ['close'])
  // somente leitura: sem olho/cadeado/renomear/arrastar
  await act(async () => root.render(h(BoardLayers, { ...props, readOnly: true })))
  assert.ok(container.querySelector('[aria-label="Hide layer"]') === null && container.querySelector('[aria-label="Lock layer"]') === null)
  assert.equal(rows()[3].getAttribute('draggable'), 'false')
  await act(async () => root.unmount())
})
