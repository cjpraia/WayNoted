// Configurações → Atalhos (jsdom): gravar, cancelar com Esc, conflito, aviso reservado, restaurar padrão. Nunca comparar nós do DOM em asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi } from './fixtures/ui-shim.mjs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)

const href = path => JSON.stringify(new URL(path, import.meta.url).href)
const listeners = new Set()
let settings = {}
const menuCalls = []
globalThis.__sc = {
  t: (pt, en, vars) => en.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')),
  useStore: () => { const [, force] = React.useReducer(x => x + 1, 0); React.useEffect(() => { listeners.add(force); return () => listeners.delete(force) }, []); return { settings } },
  actions: { updateSettings: patch => { settings = { ...settings, ...patch }; listeners.forEach(fn => fn()) } },
  api: { setShortcutAccelerators: async (map, recording) => { menuCalls.push([JSON.stringify(map), !!recording]) } },
  showUndoToast: () => 0,
}
let source = await readFile(new URL('../src/components/shortcuts/ShortcutList.tsx', import.meta.url), 'utf8')
source = shimUi(source
  .replace(/import \{ actions, api, useStore \} from '[^']*'/, 'const { actions, api, useStore } = globalThis.__sc')
  .replace(/import \{ useI18n \} from '[^']*'/, "const useI18n = () => ({ t: globalThis.__sc.t, locale: 'en-US' })")
  .replace(/import \{ showUndoToast \} from '[^']*'/, 'const { showUndoToast } = globalThis.__sc')
  .replace(/from '\.\.\/\.\.\/shortcuts'/, `from ${href('../src/shortcuts.ts')}`)
  .replace(/import '\.\/ShortcutList\.css'/, ''))
const compiled = await transformWithOxc(source, 'ShortcutList.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { ShortcutList } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const key = (init) => new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
const button = (id) => document.querySelector(`button.sc-key[aria-label*="${id}"]`)
const press = async (el, init) => act(async () => { el.dispatchEvent(key(init)) })

test('lista todos os atalhos; só os personalizáveis têm botão de gravação', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ShortcutList, { editable: true })))
  const { SHORTCUTS } = await import('../src/shortcuts.ts')
  const rows = document.querySelectorAll('.sc-row').length
  assert.equal(rows, SHORTCUTS.length, 'todas as linhas da tabela única aparecem')
  const rebind = SHORTCUTS.filter(def => def.rebind)
  const buttons = document.querySelectorAll('button.sc-key').length
  assert.equal(buttons, rebind.reduce((sum, def) => sum + def.keys.length, 0))
  assert.ok(document.querySelectorAll('kbd').length > buttons, 'atalhos fixos continuam como <kbd>')
  const first = button('Change the shortcut for Page graph')
  assert.ok(first !== null, 'botão tem nome acessível com comando e atalho atual')
  assert.match(first.getAttribute('aria-label'), /currently ⌘G/)
  await act(async () => root.unmount())
})

test('grava, anuncia, cancela com Esc, bloqueia conflito e avisa reservado', async () => {
  settings = {}
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ShortcutList, { editable: true })))
  const status = () => document.querySelector('.sc-sr').textContent
  let el = button('Change the shortcut for Page graph')
  await act(async () => { el.click() })
  assert.match(status(), /Recording the shortcut for Page graph/)
  assert.equal(menuCalls.at(-1)[1], true, 'menu nativo para de registrar aceleradores durante a gravação')
  el = button('Recording the shortcut for Page graph')
  assert.ok(el !== null)
  // Só modificador: continua esperando.
  await press(el, { key: 'Meta', code: 'MetaLeft', metaKey: true })
  assert.ok(button('Recording the shortcut for Page graph') !== null)
  // Esc cancela sem alterar.
  await press(el, { key: 'Escape', code: 'Escape' })
  assert.equal(settings.shortcutOverrides, undefined)
  assert.match(status(), /cancelled/)
  assert.equal(menuCalls.at(-1)[1], false)
  // Tecla sem ⌘/⌃ é recusada.
  await act(async () => { button('Change the shortcut for Page graph').click() })
  await press(button('Recording'), { key: 'j', code: 'KeyJ' })
  assert.match(document.querySelector('.sc-message').textContent, /⌘ or ⌃/)
  // Conflito com outro comando do app: bloqueia e diz com quem.
  await press(button('Recording'), { key: 'k', code: 'KeyK', metaKey: true })
  assert.match(document.querySelector('.sc-message').textContent, /Already used by: Search and run commands/)
  assert.equal(settings.shortcutOverrides, undefined)
  // Atalho livre: grava, persiste nas settings e a lista mostra o novo.
  await press(button('Recording'), { key: 'y', code: 'KeyY', metaKey: true, shiftKey: true })
  assert.deepEqual(settings.shortcutOverrides, { graph: ['⇧⌘Y'] })
  assert.ok(button('currently ⇧⌘Y') !== null)
  assert.match(status(), /Shortcut for Page graph.*: ⇧⌘Y/)
  assert.ok(document.querySelector('.sc-badge') !== null, 'linha marcada como alterada')
  // Reservado do sistema: pede confirmação.
  await act(async () => { button('Change the shortcut for Page graph').click() })
  await press(button('Recording'), { key: ' ', code: 'Space', ctrlKey: true })
  assert.match(document.querySelector('.sc-message').textContent, /Reserved by the system/)
  assert.deepEqual(settings.shortcutOverrides, { graph: ['⇧⌘Y'] }, 'ainda não gravou')
  const confirm = [...document.querySelectorAll('.sc-confirm button')].find(b => /Use anyway/.test(b.textContent))
  assert.ok(confirm !== undefined)
  await act(async () => { confirm.click() })
  assert.deepEqual(settings.shortcutOverrides, { graph: ['⌃Space'] })
  // Restaurar o padrão do comando.
  const restore = document.querySelector('.sc-reset')
  assert.ok(restore !== null)
  await act(async () => { restore.click() })
  assert.deepEqual(settings.shortcutOverrides, {})
  await act(async () => root.unmount())
})

test('"Restaurar todos" limpa tudo e o filtro "Alterados" lista só o que mudou', async () => {
  settings = { shortcutOverrides: { graph: ['⌘⇧Y'], search: ['⌘K', '⌘⇧O'] } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ShortcutList, { editable: true })))
  const select = document.querySelector('.sc-toolbar select')
  await act(async () => { select.value = 'custom'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  assert.equal(document.querySelectorAll('.sc-row').length, 2)
  const all = [...document.querySelectorAll('.sc-toolbar button')].find(b => /Restore all/.test(b.textContent))
  await act(async () => { all.click() })
  assert.deepEqual(settings.shortcutOverrides, {})
  await act(async () => root.unmount())
})
