import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLDivElement']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const source = await readFile(new URL('../src/components/page/PasteUrlMenu.tsx', import.meta.url), 'utf8')
const transformed = await transformWithOxc(source, 'PasteUrlMenu.tsx', { jsx: { runtime: 'automatic' } })
const code = transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { PasteUrlMenu } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const t = (_pt, en) => en

test('link comum mostra Mention, URL, Bookmark e Embed na ordem da referência', async () => {
  const root = createRoot(document.getElementById('app'))
  const chosen = [], dismissed = [], resumed = []
  const props = { url: 'https://example.com', left: 12, top: 20, videoEnabled: false, isCurrent: () => true, onChoose: (choice) => { chosen.push(choice); return true }, onDismiss: (reason) => dismissed.push(reason), onResume: () => resumed.push(true), t }
  const key = async (name) => act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })))
  const selected = () => document.querySelector('.pg-paste-url-menu button[data-selected]')?.textContent.trim()
  const leaked = [], listen = (event) => leaked.push(event.key)
  document.addEventListener('keydown', listen)
  try {
    await act(async () => root.render(React.createElement(PasteUrlMenu, props)))
    assert.equal(document.activeElement.getAttribute('role'), 'menu')
    assert.equal(selected(), 'Mention')
    assert.deepEqual([...document.querySelectorAll('.pg-paste-url-menu button')].map(button => button.textContent.trim()), ['Mention', 'URL', 'Bookmark', 'Embed'])
    assert.equal(document.querySelectorAll('.pg-paste-url-menu button[data-selected]').length, 1)
    assert.equal(document.querySelectorAll('.pg-paste-url-menu button:disabled').length, 0)
    await key('ArrowDown')
    assert.equal(selected(), 'URL')
    await key('ArrowDown')
    assert.equal(selected(), 'Bookmark')
    await key('ArrowDown')
    assert.equal(selected(), 'Embed')
    await key('ArrowDown')
    assert.equal(selected(), 'Mention')
    await key('ArrowUp')
    assert.equal(selected(), 'Embed')
    await key('Enter')
    assert.deepEqual(chosen, ['embed'])
    assert.deepEqual(resumed, [true])
    assert.deepEqual(leaked, [])
    assert.deepEqual(dismissed, [])
  } finally { document.removeEventListener('keydown', listen); await act(async () => root.unmount()) }
})

test('Escape fecha sem escolher, e captura obsoleta não sequestra teclas', async () => {
  const root = createRoot(document.getElementById('app'))
  const chosen = [], dismissed = [], resumed = [], leaked = []
  let current = true
  const props = { url: 'https://example.com', left: 0, top: 0, videoEnabled: true, isCurrent: () => current, onChoose: (choice) => { chosen.push(choice); return true }, onDismiss: (reason) => dismissed.push(reason), onResume: () => resumed.push(true), t }
  const listen = (event) => leaked.push(event.key)
  document.addEventListener('keydown', listen)
  try {
    await act(async () => root.render(React.createElement(PasteUrlMenu, props)))
    const menu = document.querySelector('.pg-paste-url-menu')
    assert.deepEqual([...menu.querySelectorAll('button')].map(button => button.textContent.trim()), ['Mention', 'Embed video', 'Bookmark', 'URL'])
    await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.deepEqual(dismissed, ['escape'])
    assert.deepEqual(chosen, [])
    assert.deepEqual(resumed, [true])
    assert.deepEqual(leaked, [])
    current = false
    await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    assert.deepEqual(dismissed, ['escape', 'stale'])
    assert.deepEqual(resumed, [true])
    assert.deepEqual(leaked, ['ArrowDown'])
    await act(async () => menu.querySelector('button').click())
    assert.deepEqual(chosen, [])
  } finally { document.removeEventListener('keydown', listen); await act(async () => root.unmount()) }
})

test('blur para outro diálogo e escolha recusada não retomam foco do editor', async () => {
  const root = createRoot(document.getElementById('app'))
  const dismissed = [], resumed = []
  const props = { url: 'https://example.com', left: 0, top: 0, videoEnabled: false, isCurrent: () => true,
    onChoose: () => false, onDismiss: (reason) => dismissed.push(reason), onResume: () => resumed.push(true), t }
  try {
    await act(async () => root.render(React.createElement(PasteUrlMenu, props)))
    const menu = document.querySelector('.pg-paste-url-menu')
    await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    assert.deepEqual(resumed, [])
    const other = document.createElement('input')
    document.body.append(other)
    await act(async () => other.focus())
    assert.deepEqual(dismissed, ['blur'])
    assert.deepEqual(resumed, [])
    other.remove()
  } finally { await act(async () => root.unmount()) }
})
