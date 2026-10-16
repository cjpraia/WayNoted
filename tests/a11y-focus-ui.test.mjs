// Acessibilidade — comportamento no jsdom: diálogo prende o Tab e devolve o foco; skip link leva o foco ao <main>.
// Regra de memória: nunca passar nós do DOM a assert.equal/deepEqual (use ids/strings/booleans).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body><div id="app"></div></body></html>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'KeyboardEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act, useRef } = await import('react')
const { createRoot } = await import('react-dom/client')
globalThis.__a11y = { useI18n: () => ({ locale: 'en-US', t: (_pt, en) => en }) }

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'\.\.\/i18n'/g, (_m, bindings) => `const ${bindings} = globalThis.__a11y`)
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' } })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { useModalFocus, trapTarget } = await load('../src/a11y/useModalFocus.ts')
const { SkipLink, MAIN_ID } = await load('../src/a11y/SkipLink.tsx')

const mount = async node => {
  const host = document.getElementById('app')
  const root = createRoot(host)
  await act(async () => { root.render(node) })
  return { host, unmount: async () => { await act(async () => { root.unmount() }) } }
}
const press = (target, key, shiftKey = false) => {
  const event = new dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

function Dialog() {
  const ref = useRef(null)
  useModalFocus(ref)
  return React.createElement('div', { ref, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Teste', tabIndex: -1 },
    React.createElement('button', { id: 'first' }, 'Um'), React.createElement('input', { id: 'middle' }), React.createElement('button', { id: 'last' }, 'Fim'), React.createElement('button', { id: 'off', disabled: true }, 'x'))
}
function Opener() {
  const [open, setOpen] = React.useState(false)
  return React.createElement(React.Fragment, null, React.createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Abrir'),
    open && React.createElement(Dialog), React.createElement('button', { id: 'close-all', onClick: () => setOpen(false) }, 'Fechar'))
}

test('trapTarget: dá a volta nas pontas e deixa o navegador seguir no meio', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(id => Object.assign(document.createElement('button'), { id }))
  assert.equal(trapTarget([a, b, c], c, false)?.id, 'a')
  assert.equal(trapTarget([a, b, c], a, true)?.id, 'c')
  assert.ok(trapTarget([a, b, c], b, false) === null)
  assert.ok(trapTarget([], a, false) === null)
  assert.equal(trapTarget([a, b], document.body, false)?.id, 'a')
})

test('diálogo: foco inicial no primeiro controle, Tab/Shift+Tab presos e foco devolvido ao fechar', async () => {
  const { host, unmount } = await mount(React.createElement(Opener))
  const opener = host.querySelector('#opener')
  opener.focus()
  await act(async () => { opener.click() })
  assert.equal(document.activeElement.id, 'first')
  const last = host.querySelector('#last')
  last.focus()
  assert.ok(press(last, 'Tab'), 'Tab no último deve ser interceptado')
  assert.equal(document.activeElement.id, 'first')
  assert.ok(press(host.querySelector('#first'), 'Tab', true))
  assert.equal(document.activeElement.id, 'last')
  host.querySelector('#middle').focus()
  assert.ok(!press(host.querySelector('#middle'), 'Tab'), 'no meio o Tab segue o navegador')
  await act(async () => { host.querySelector('#close-all').click() })
  assert.equal(document.activeElement.id, 'opener')
  await unmount()
})

test('skip link: texto no idioma, href para o main e clique move o foco', async () => {
  const { host, unmount } = await mount(React.createElement('div', null, React.createElement(SkipLink), React.createElement('main', { id: MAIN_ID, tabIndex: -1 }, 'conteúdo')))
  const link = host.querySelector('a.np-skip-link')
  assert.equal(link.textContent, 'Skip to content')
  assert.equal(link.getAttribute('href'), `#${MAIN_ID}`)
  link.focus()
  await act(async () => { link.click() })
  assert.equal(document.activeElement.id, MAIN_ID)
  await unmount()
})
