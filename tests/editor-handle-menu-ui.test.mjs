import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { SLASH_CATALOG } from '../src/components/page/slashMenu/catalog.ts'
import { blockMenuText, blockMenuWordCount, blockMenuCharacterCount } from '../src/components/page/blockMenuStats.ts'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const block = { id: 'target', type: 'paragraph', content: [{ type: 'text', text: 'https://www.youtube.com/watch?v=O4ZRCC-LIU4', styles: {} }], children: [] }
const Menu = {
  Dropdown: ({ children, className }) => React.createElement('div', { className, role: 'menu' }, children),
  Item: ({ children, className, onClick }) => React.createElement('button', { type: 'button', className, onClick }, children),
}
const translate = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const Icon = () => null
globalThis.__columnCalls = []
globalThis.__blockMenuMocks = { SideMenuExtension: {}, SideMenu: () => null, useComponentsContext: () => ({ Generic: { Menu } }), useExtensionState: () => block, useBlockNoteEditor: () => ({ document: [] }), enclosingColumnList: () => (globalThis.__inColumns ? { id: 'list' } : null), undoColumns: (_editor, id) => { globalThis.__columnCalls.push(['undo', id]); return true }, deleteColumns: (_editor, id) => { globalThis.__columnCalls.push(['delete', id]); return true }, absoluteTime: () => 'today at 11:56 PM', blockMenuText, blockMenuWordCount, blockMenuCharacterCount, SLASH_CATALOG, useI18n: () => ({ locale: 'en-US', t: translate }), BlockIcon: Icon, ChevronRight: Icon, MessageSquareText: Icon, PaintRoller: Icon, Repeat2: Icon, Sparkles: Icon }
let source = await readFile(new URL('../src/components/page/BlockHandleMenu.tsx', import.meta.url), 'utf8')
source = source.replace(/import\s+type\s+[^\n]+\n/g, '').replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'\s*\n/g, (match, bindings, module) => module === 'react' ? match : `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')} = globalThis.__blockMenuMocks\n`)
const transformed = await transformWithOxc(source, 'BlockHandleMenu.tsx', { jsx: { runtime: 'automatic' } })
const code = transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { BlockHandleMenu } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('menu real do handle pesquisa, abre submenus, opera bloco selecionado e exibe contagem correta', async () => {
  const root = createRoot(document.getElementById('app'))
  const commands = [], suggestions = []
  const render = async (editable) => act(async () => root.render(React.createElement(BlockHandleMenu, { editable, updatedBy: 'Local user', updatedAt: Date.now(), onCommand: (item, id) => commands.push([item.id, id]), onSuggest: (id) => suggestions.push(id) })))
  const click = async (label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim().startsWith(label))
    assert.ok(button, label)
    await act(async () => button.click())
  }
  try {
    await render(true)
    assert.match(document.querySelector('.pg-block-menu-footer').textContent, /8 words, 43 characters/)
    assert.match(document.querySelector('.pg-block-menu-footer').textContent, /Page last edited by Local user/)
    await click('Color')
    await click('Red text')
    assert.deepEqual(commands.at(-1), ['text-color-red', 'target'])
    await click('‹ Back')
    await click('Suggest edits')
    assert.deepEqual(suggestions, ['target'])
    const search = document.querySelector('.pg-block-menu-search')
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; setter.call(search, 'Duplicate'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    assert.equal(document.querySelector('.pg-block-menu-search').value, 'Duplicate')
    assert.equal([...document.querySelectorAll('.pg-block-menu-item')].some((item) => item.textContent === 'Copy link to block'), false)
    const keys = []
    const captureKey = (event) => keys.push(event.key)
    document.addEventListener('keydown', captureKey)
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'x', bubbles: true })))
    document.removeEventListener('keydown', captureKey)
    assert.deepEqual(keys, ['Escape', 'ArrowUp', 'ArrowDown', 'Enter'])
    await click('Duplicate')
    assert.deepEqual(commands.at(-1), ['duplicate', 'target'])
    await render(false)
    await click('Duplicate')
    assert.equal(commands.length, 2)
  } finally { await act(async () => root.unmount()) }
})

test('menu do bloco dentro de colunas oferece Desfazer colunas e Excluir colunas (e some fora delas)', async () => {
  const root = createRoot(document.getElementById('app'))
  const render = async () => act(async () => root.render(React.createElement(BlockHandleMenu, { editable: true, onCommand: () => {}, onSuggest: () => {} })))
  const labels = () => [...document.querySelectorAll('.pg-block-menu button')].map((item) => item.textContent.trim())
  try {
    globalThis.__inColumns = false
    await render()
    assert.equal(labels().some((label) => /columns/i.test(label)), false)
    globalThis.__inColumns = true
    await render()
    assert.ok(labels().includes('Undo columns'))
    assert.ok(labels().includes('Delete columns'))
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Undo columns').click())
    await act(async () => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Delete columns').click())
    assert.deepEqual(globalThis.__columnCalls, [['undo', 'target'], ['delete', 'target']])
  } finally { await act(async () => root.unmount()); globalThis.__inColumns = false }
})
