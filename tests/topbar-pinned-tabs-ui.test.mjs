import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const t = (pt, en, vars = {}) => en.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? '')
let state
const unpinned = []
const noop = () => {}
globalThis.__topbar = {
  t, getLocale: () => 'en-US',
  useStore: () => state,
  selectors: new Proxy({ canGoBack: () => false, canGoForward: () => false, page: () => undefined, ancestors: () => [] }, { get: (target, key) => target[key] ?? (() => undefined) }),
  actions: new Proxy({ pinTab: id => { unpinned.push(id); state = { ...state, settings: { ...state.settings, openTabs: state.settings.openTabs.map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab) } } } }, { get: (target, key) => target[key] ?? noop }),
  shortcutHint: () => '', TabMenu: () => null, PageMenu: () => null, Popover: () => null, relativeTime: () => '', PageIcon: () => null, PageComments: () => null, MovePageDialog: () => null, BlockIcon: () => null, Icon: () => null, copyText: noop,
  useGraphSettings: () => ({ local: { open: false } }), toggleLocalGraph: noop,
}
let source = await readFile(new URL('../src/components/page/Topbar.tsx', import.meta.url), 'utf8')
source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
  if (module === 'react' || module === 'lucide-react') return match
  return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+) as (\w+)/g, '$1: $2')}=globalThis.__topbar`
}).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
const out = await transformWithOxc(source, 'Topbar.tsx', { jsx: { runtime: 'automatic' } })
const { Topbar } = await import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)

test('pinned tabs keep their title, show a pin button and unpin on click', async () => {
  state = { route: { type: 'home' }, settings: { activeTabId: 'c', sidebarCollapsed: false, openTabs: [
    { id: 'a', route: { type: 'home' }, pinned: true }, { id: 'b', route: { type: 'home' }, pinned: true }, { id: 'c', route: { type: 'home' } },
  ] } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(Topbar)))
  const tabs = [...document.querySelectorAll('.shell-tab')]
  assert.equal(tabs.length, 3)
  for (const tab of tabs.slice(0, 2)) {
    assert.equal(tab.querySelector('.shell-tab-select span').textContent, 'My day')
    assert.ok(tab.querySelector('.shell-tab-pin[aria-label^="Unpin tab"]'))
    assert.ok(tab.querySelector('.shell-tab-close') === null, 'pinned tab has no close button')
    assert.match(tab.querySelector('.shell-tab-select').getAttribute('aria-label'), /Pinned/)
  }
  assert.ok(tabs[1].classList.contains('is-pin-end'))
  assert.ok(tabs[2].querySelector('.shell-tab-pin') === null, 'normal tab has no pin')
  assert.ok(tabs[2].querySelector('.shell-tab-close'))
  await act(async () => tabs[0].querySelector('.shell-tab-pin').click())
  await act(async () => root.render(React.createElement(Topbar)))
  assert.deepEqual(unpinned, ['a'])
  const after = [...document.querySelectorAll('.shell-tab')]
  assert.ok(after[0].querySelector('.shell-tab-pin') === null, 'unpinned tab lost its pin')
  assert.ok(after[0].querySelector('.shell-tab-close'))
  await act(async () => root.unmount())
})
