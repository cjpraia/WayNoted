import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// react-dom inspects `document` when it loads (input event support): import it after the globals exist.
const { createRoot } = await import('react-dom/client')
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const calls = []
window.api = {
  vaultStatus: async () => ({}),
  pageProtect: async (...args) => { calls.push(['protect', ...args]); return {} },
  pageLockHint: async () => 'cor favorita',
  pageChangePassword: async (...args) => { calls.push(['change', ...args]) },
  pageProtectChildren: async (...args) => { calls.push(['children', ...args]); return { added: 1 } },
}
const page = { id: 'p1', parentId: null, title: 'Diary' }
globalThis.__pageLockDialog = { t, getLocale: () => 'en-US', actions: { flushAll: async () => {} }, getState: () => ({ pages: { p1: globalThis.__pageLockDialog.page, ...globalThis.__pageLockDialog.extra } }), extra: {}, useStore: () => ({ pages: { p1: globalThis.__pageLockDialog.page } }), page }

globalThis.__pageLockDialog.h = React.createElement
let source = await readFile(new URL('../src/security/PageLockDialog.tsx', import.meta.url), 'utf8')
source = source.replace("import { actions, getState, useStore } from '../store'", 'const { actions, getState, useStore } = globalThis.__pageLockDialog')
  .replace("import { t, getLocale } from '../i18n'", 'const { t, getLocale } = globalThis.__pageLockDialog')
  .replace("import './security.css'", '')
  // Button compartilhado: stub mínimo (o teste só precisa de <button> com type/onClick/disabled).
  .replace("import { Button } from '../components/ui/Button'", "const Button = ({ variant, type = 'button', ...rest }) => globalThis.__pageLockDialog.h('button', { type, ...rest })")
  .replace("from '../a11y/useModalFocus'", `from ${JSON.stringify(new URL('../src/a11y/useModalFocus.ts', import.meta.url).href)}`)
  .replace("from './api'", `from ${JSON.stringify(new URL('../src/security/api.ts', import.meta.url).href)}`)
  .replace("from './validation'", `from ${JSON.stringify(new URL('../src/security/validation.ts', import.meta.url).href)}`)
  .replace("from './pageLock'", `from ${JSON.stringify(new URL('../src/security/pageLock.ts', import.meta.url).href)}`)
const out = await transformWithOxc(source, 'PageLockDialog.tsx', { jsx: { runtime: 'automatic' } })
const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { PageLockDialogHost, openPageLockDialog } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
async function type(label, value) {
  const input = document.querySelector(`input[aria-label="${label}"]`)
  assert.ok(input !== null, `field ${label}`)
  await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}
const errorText = () => document.querySelector('.sec-error')?.textContent ?? ''
async function submit() { await act(async () => { document.querySelector('form').requestSubmit(); await Promise.resolve() }) }

test('page password dialog: validation message is live and clears as soon as the input is valid', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(PageLockDialogHost)))
  await act(async () => openPageLockDialog('p1'))
  assert.equal(document.querySelector('#sec-page-title')?.textContent, 'Protect page with a password')
  assert.match(document.body.textContent, /Do not write the password here/)

  await type('Page password', 'short'); await type('Confirm password', 'short')
  await submit()
  assert.equal(errorText(), 'Use a password with at least 8 characters.')
  assert.equal(calls.length, 0, 'short password never reaches the main process')

  // The reported bug: both fields fixed to 12 characters but the old error stayed visible.
  await type('Page password', 'twelve-chars'); await type('Confirm password', 'twelve-chars')
  assert.equal(errorText(), '', 'error cleared once both fields are valid')

  await type('Confirm password', 'twelve-charX')
  assert.equal(errorText(), 'Passwords do not match.')
  await type('Confirm password', 'twelve-chars')
  assert.equal(errorText(), '')

  await type('Password hint (optional)', 'it is TWELVE-CHARS')
  assert.equal(errorText(), 'The hint cannot contain the password.')
  await type('Password hint (optional)', 'my usual pattern')
  assert.equal(errorText(), '')
  await submit()
  assert.deepEqual(calls.at(-1), ['protect', 'p1', 'twelve-chars', { includeChildren: true, hideTitle: false, hint: 'my usual pattern' }])
  await act(async () => root.unmount())
})

test('changing a page password pre-fills and validates the hint', async () => {
  globalThis.__pageLockDialog.page = { ...page, passwordLock: { rootId: 'p1', hideTitle: false, unlocked: true } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(PageLockDialogHost)))
  await act(async () => openPageLockDialog('p1'))
  assert.match(document.body.textContent, /The password hint is removed too/)
  const change = [...document.querySelectorAll('input[type="radio"]')][1]
  await act(async () => { change.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(document.querySelector('input[aria-label="Password hint (optional)"]')?.value, 'cor favorita')
  await type('Current password', 'old-password')
  await type('New password', 'new-password-1'); await type('Confirm new password', 'new-password-1')
  assert.equal(errorText(), '')
  await submit()
  assert.deepEqual(calls.at(-1), ['change', 'p1', 'old-password', 'new-password-1', { hint: 'cor favorita' }])
  await act(async () => root.unmount())
})

test('repair: a protected page offers to protect its unprotected subpages', async () => {
  const locked = { rootId: 'p1', hideTitle: false, inherit: true, unlocked: true }
  globalThis.__pageLockDialog.page = { ...page, passwordLock: locked }
  globalThis.__pageLockDialog.extra = { a: { id: 'a', parentId: 'p1', title: 'teste 1', passwordLock: locked }, b: { id: 'b', parentId: 'p1', title: 'teste 9' } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(PageLockDialogHost)))
  await act(async () => openPageLockDialog('p1'))
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Protect unprotected subpages (1)')
  assert.ok(button !== undefined, 'repair action listed with the count')
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.deepEqual(calls.at(-1), ['children', 'p1'])
  await act(async () => root.unmount())
})
