// Select estilizado e DialogActions no DOM (jsdom). Os asserts comparam strings, números e booleanos (nunca nós do DOM).
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
  let source = patch(await readFile(url, 'utf8'))
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
// O ícone real puxa lucide-react (pesado); o teste troca por um marcador simples.
const iconStub = `data:text/javascript,export const Icon=(p)=>null`
const selectUrl = await load('../src/components/ui/Select.tsx', (s) => s.replace("from './icons/Icon'", `from '${iconStub}'`))
const { Select } = await import(selectUrl)
const model = await import(await load('../src/components/ui/selectModel.ts'))
const { DialogActions } = await import(await load('../src/components/ui/DialogActions.tsx'))
const h = React.createElement
const press = (el, key) => act(async () => { el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })

let root
async function mount(node) {
  document.getElementById('app').innerHTML = ''
  root = createRoot(document.getElementById('app'))
  await act(async () => root.render(node))
}
const trigger = () => document.querySelector('button.np-select')
const options = () => [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)
const activeId = () => trigger().getAttribute('aria-activedescendant')
const activeText = () => document.getElementById(activeId())?.textContent ?? ''

function Harness({ initial = 'b', onPick }) {
  const [value, setValue] = React.useState(initial)
  return h(Select, { value, 'aria-label': 'Ordem', onChange: (e) => { setValue(e.target.value); onPick?.(e.target.value) } },
    h('option', { value: 'a' }, 'Alfa'), h('option', { value: 'b' }, 'Beta'), h('option', { value: 'c', disabled: true }, 'Gama (indisponível)'), h('option', { value: 'd' }, 'Delta'))
}

test('Select: o campo mostra o rótulo do valor atual e expõe os papéis de combobox/listbox', async () => {
  await mount(h(Harness))
  assert.equal(trigger().textContent, 'Beta')
  assert.equal(trigger().getAttribute('role'), 'combobox')
  assert.equal(trigger().getAttribute('aria-haspopup'), 'listbox')
  assert.equal(trigger().getAttribute('aria-expanded'), 'false')
  assert.equal(trigger().getAttribute('aria-label'), 'Ordem')
  assert.equal(document.querySelector('[role=listbox]') === null, true, 'lista fechada não existe no DOM')
})

test('Select: Enter abre com a opção atual ativa; setas pulam as desabilitadas; Enter escolhe', async () => {
  const picked = []
  await mount(h(Harness, { onPick: (v) => picked.push(v) }))
  trigger().focus()
  await press(trigger(), 'Enter')
  assert.equal(trigger().getAttribute('aria-expanded'), 'true')
  assert.deepEqual(options(), ['Alfa', 'Beta', 'Gama (indisponível)', 'Delta'])
  assert.equal(activeText(), 'Beta')
  await press(trigger(), 'ArrowDown')
  assert.equal(activeText(), 'Delta', 'a opção desabilitada é pulada')
  await press(trigger(), 'ArrowDown')
  assert.equal(activeText(), 'Delta', 'não dá a volta no fim')
  await press(trigger(), 'Enter')
  assert.deepEqual(picked, ['d'])
  assert.equal(trigger().textContent, 'Delta')
  assert.equal(trigger().getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement === trigger(), true, 'o foco volta ao campo')
})

test('Select: Home/End, busca por digitação e Escape sem escolher', async () => {
  const picked = []
  await mount(h(Harness, { onPick: (v) => picked.push(v) }))
  trigger().focus()
  await press(trigger(), 'ArrowDown')
  await press(trigger(), 'End'); assert.equal(activeText(), 'Delta')
  await press(trigger(), 'Home'); assert.equal(activeText(), 'Alfa')
  await press(trigger(), 'd'); assert.equal(activeText(), 'Delta', 'digitar "d" vai para Delta')
  await press(trigger(), 'Escape')
  assert.equal(trigger().getAttribute('aria-expanded'), 'false')
  assert.deepEqual(picked, [], 'Escape não altera o valor')
  assert.equal(trigger().textContent, 'Beta')
})

test('Select: clique escolhe, opção atual é aria-selected e o campo desabilitado não abre', async () => {
  const picked = []
  await mount(h(Harness, { onPick: (v) => picked.push(v) }))
  await act(async () => { trigger().click() })
  const selected = [...document.querySelectorAll('[role=option]')].filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent)
  assert.deepEqual(selected, ['Beta'])
  await act(async () => { document.querySelectorAll('[role=option]')[0].click() })
  assert.deepEqual(picked, ['a'])
  await mount(h(Select, { value: 'x', disabled: true }, h('option', { value: 'x' }, 'X')))
  await act(async () => { trigger().click() })
  assert.equal(document.querySelector('[role=listbox]') === null, true)
})

test('Select: <optgroup> vira cabeçalho de grupo e a lista plana mantém a ordem', () => {
  const list = model.parseOptions([
    h('optgroup', { key: 'g1', label: 'Páginas' }, h('option', { value: 'p1' }, 'Um'), h('option', { value: 'p2' }, 'Dois')),
    h('option', { key: 'x', value: 'z' }, 'Solto'),
  ])
  assert.deepEqual(list.map((o) => `${o.group ?? '-'}:${o.value}`), ['Páginas:p1', 'Páginas:p2', '-:z'])
})

test('selectModel: posição abre para cima quando falta espaço embaixo e nunca sai da janela', () => {
  const down = model.placeList({ left: 100, top: 100, bottom: 128, width: 200 }, { width: 1000, height: 800 }, 200)
  assert.equal(down.up, false)
  assert.equal(down.top, 132)
  const up = model.placeList({ left: 100, top: 700, bottom: 728, width: 200 }, { width: 1000, height: 760 }, 300)
  assert.equal(up.up, true)
  assert.equal(up.top < 700, true)
  const edge = model.placeList({ left: 980, top: 100, bottom: 128, width: 100 }, { width: 1000, height: 800 }, 100)
  assert.equal(edge.left + 160 <= 1000 - 8 + 1, true)
})

test('DialogActions: destrutivo dá o foco inicial ao Cancelar e coloca a confirmação por último', async () => {
  const calls = []
  await mount(h(DialogActions, { confirmLabel: 'Excluir 3 linhas', destructive: true, onConfirm: () => calls.push('ok'), onCancel: () => calls.push('cancel') }))
  const buttons = [...document.querySelectorAll('.np-dialog-actions button')]
  assert.deepEqual(buttons.map((b) => b.textContent), ['Cancelar', 'Excluir 3 linhas'])
  assert.equal(buttons[1].className.includes('np-btn--danger'), true)
  assert.equal(document.activeElement === buttons[0], true, 'Enter por engano nunca confirma a exclusão')
  await act(async () => { buttons[0].click() })
  assert.deepEqual(calls, ['cancel'])
})

test('DialogActions: ação não destrutiva é primária e não rouba o foco', async () => {
  await mount(h(React.Fragment, null, h('input', { id: 'campo' }), h(DialogActions, { confirmLabel: 'Importar', onConfirm: () => {}, onCancel: () => {} })))
  document.getElementById('campo').focus()
  const last = [...document.querySelectorAll('.np-dialog-actions button')].pop()
  assert.equal(last.className.includes('np-btn--primary'), true)
  assert.equal(document.activeElement === document.getElementById('campo'), true)
})

function MultiHarness({ onValues }) {
  const [values, setValues] = React.useState(['b'])
  return h(Select, { multiple: true, value: values, placeholder: 'Nenhum', 'aria-label': 'Tags', onValuesChange: (next) => { setValues(next); onValues?.(next) } },
    h('option', { value: 'a' }, 'Alfa'), h('option', { value: 'b' }, 'Beta'), h('option', { value: 'c' }, 'Gama'))
}

test('Select múltiplo: alterna itens sem fechar a lista, mantém a ordem das opções e resume no campo', async () => {
  const seen = []
  await mount(h(MultiHarness, { onValues: (v) => seen.push(v.join(',')) }))
  assert.equal(trigger().textContent, 'Beta')
  await act(async () => { trigger().click() })
  assert.equal(document.querySelector('[role=listbox]').getAttribute('aria-multiselectable'), 'true')
  await act(async () => { document.querySelectorAll('[role=option]')[2].click() })
  await act(async () => { document.querySelectorAll('[role=option]')[0].click() })
  assert.deepEqual(seen, ['b,c', 'a,b,c'])
  assert.equal(document.querySelector('[role=listbox]') !== null, true, 'a lista continua aberta')
  assert.equal(trigger().textContent, 'Alfa, Beta, Gama')
  await act(async () => { document.querySelectorAll('[role=option]')[1].click() })
  assert.equal(seen[2], 'a,c')
  assert.deepEqual([...document.querySelectorAll('[role=option]')].map((o) => o.getAttribute('aria-selected')), ['true', 'false', 'true'])
  await press(trigger(), 'Escape')
  assert.equal(document.querySelector('[role=listbox]') === null, true)
})

test('Select múltiplo: sem seleção mostra o texto de apoio', async () => {
  await mount(h(Select, { multiple: true, value: [], placeholder: 'Nenhum', onValuesChange: () => {} }, h('option', { value: 'a' }, 'Alfa')))
  assert.equal(trigger().textContent, 'Nenhum')
  assert.equal(trigger().querySelector('.is-placeholder') !== null, true)
})

test('Select: autoFocus foca o campo; valor controlado "" volta ao primeiro item após escolher', async () => {
  const picked = []
  await mount(h(Select, { autoFocus: true, value: '', 'aria-label': 'Mover', onChange: (e) => picked.push(e.target.value) }, h('option', { value: '' }, 'Escolha'), h('option', { value: 'x' }, 'X')))
  assert.equal(document.activeElement === trigger(), true)
  await act(async () => { trigger().click() })
  await act(async () => { document.querySelectorAll('[role=option]')[1].click() })
  assert.deepEqual(picked, ['x'])
  assert.equal(trigger().textContent, 'Escolha')
})

test('Select: opções numéricas e <option> sem value usam o texto como valor', async () => {
  const picked = []
  await mount(h(Select, { value: 7, onChange: (e) => picked.push(e.target.value) }, h('option', null, '7'), h('option', null, '30'), h('option', { value: 0 }, 'Sem limite')))
  assert.equal(trigger().textContent, '7')
  await act(async () => { trigger().click() })
  await act(async () => { document.querySelectorAll('[role=option]')[2].click() })
  assert.deepEqual(picked, ['0'])
})
