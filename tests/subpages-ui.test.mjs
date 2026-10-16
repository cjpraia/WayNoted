// Seção "Subpáginas" (ChildPages) e barra de seleção: interface em jsdom. Asserções só com strings/números/booleans
// (nunca nós do DOM). docs/USAGE.md
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
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const plan = await import('../src/subpages/plan.ts')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const calls = []
const record = (name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(' ')) }
const mk = (id, title, extra = {}) => ({ id, parentId: 'root', title, icon: null, order: Number(id.slice(1)), updatedAt: Date.now(), types: undefined, ...extra })
let pages
const reset = () => {
  pages = { root: { id: 'root', parentId: null, title: 'Raiz', bodyOutboundPageIds: [] }, c1: mk('c1', 'Elza', { types: ['person'] }), c2: mk('c2', 'Eliane'), c3: mk('c3', 'Citada') }
}
reset()
const types = [{ id: 'person', name: 'Pessoa', color: 'blue', properties: [] }]
const mocks = {
  useI18n: () => ({ t, locale: 'en-US' }),
  useStore: () => ({ pages, settings: { objectTypes: types } }),
  actions: { openPage: record('openPage'), openInNewTab: (r) => record('openInNewTab')(r.id), movePage: record('movePage'), trashPage: record('trashPage'), restorePage: record('restorePage'), reportSaveError: () => {}, appendPageBlocks: record('append') },
  selectors: { children: (id) => Object.values(pages).filter((p) => p.parentId === id).sort((a, b) => a.order - b.order) },
  isLockedPage: (page) => !!page?.passwordLock && !page.passwordLock.unlocked,
  protectedTitle: (page, label) => page.passwordLock?.hideTitle && !page.passwordLock.unlocked ? label : null,
  pageTypes: (list, page) => (page.types ?? []).map((id) => list.find((x) => x.id === id)).filter(Boolean),
  typeDataHidden: () => false,
  PageIcon: () => React.createElement('i', { className: 'icon' }),
  DbPopover: ({ children }) => React.createElement('div', { className: 'pop' }, children),
  Menu: ({ children }) => React.createElement('div', { role: 'menu' }, children), MenuSep: () => null,
  MenuItem: ({ label, onClick }) => React.createElement('button', { className: 'mi', onClick }, label),
  MovePageDialog: ({ pageId }) => React.createElement('div', { className: 'move' }, 'move ' + pageId),
  showToast: (toast) => record('toast')(toast.message),
  convertibleSubpageCount: () => 2,
  openSubpagesDialog: record('openSubpagesDialog'),
  uncitedChildren: plan.uncitedChildren,
}
globalThis.__subpagesUi = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__subpagesUi`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const { ChildPages } = await load('../src/components/page/ChildPages.tsx')
const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())
const mount = async (props = {}) => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ChildPages, { pageId: 'root', locked: false, editorRef: { current: null }, ...props })))
  return root
}

test('lista só as subpáginas ainda não citadas no corpo, com tipo e na ordem da árvore', async () => {
  reset(); pages.root.bodyOutboundPageIds = ['c3']
  const root = await mount()
  assert.deepEqual(text('.cp-title'), ['Elza', 'Eliane'])
  assert.deepEqual(text('.cp-chip'), ['Pessoa'])
  assert.match(text('.cp-toggle')[0], /Subpages \(2\)/)
  assert.equal(document.querySelectorAll('.cp-convert').length, 1)
  await act(async () => root.unmount())
})

test('sem filhas, só com filhas citadas ou em banco: nada aparece', async () => {
  reset(); pages.root.bodyOutboundPageIds = ['c1', 'c2', 'c3']
  let root = await mount()
  assert.equal(document.querySelectorAll('[data-child-pages]').length, 0, 'todas citadas no corpo')
  await act(async () => root.unmount())
  reset(); pages.root.database = { properties: [] }
  root = await mount()
  assert.equal(document.querySelectorAll('[data-child-pages]').length, 0, 'bancos têm linhas, não subpáginas')
  await act(async () => root.unmount())
  reset(); pages = { root: pages.root }; delete pages.root.database
  root = await mount()
  assert.equal(document.querySelectorAll('[data-child-pages]').length, 0, 'sem filhas')
  await act(async () => root.unmount())
})

test('recolher lembra o estado por página; abrir e ⌘-clique', async () => {
  reset(); calls.length = 0
  let root = await mount()
  await act(async () => document.querySelector('.cp-toggle').click())
  assert.equal(document.querySelectorAll('.cp-list').length, 0)
  assert.equal(document.querySelector('.cp-toggle').getAttribute('aria-expanded'), 'false')
  await act(async () => root.unmount())
  root = await mount()
  assert.equal(document.querySelectorAll('.cp-list').length, 0, 'continua recolhida ao voltar')
  await act(async () => document.querySelector('.cp-toggle').click())
  await act(async () => document.querySelector('.cp-open').click())
  assert.ok(calls.includes('openPage c1'))
  await act(async () => document.querySelector('.cp-open').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, metaKey: true })))
  assert.ok(calls.includes('openInNewTab c1'))
  await act(async () => root.unmount())
})

test('menu do item: Abrir, Inserir no texto, Mover para… e Excluir com aviso para desfazer', async () => {
  reset(); calls.length = 0
  const inserted = []
  const editor = { isEditable: true, document: [{ id: 'b1' }], isFocused: () => false, getTextCursorPosition: () => ({ block: { id: 'b1' } }), insertBlocks: (blocks, ref, where) => inserted.push(JSON.stringify([blocks[0].props, ref.id, where])) }
  const root = await mount({ editorRef: { current: editor } })
  await act(async () => document.querySelectorAll('.cp-more')[1].click())
  assert.deepEqual(text('.mi'), ['Open', 'Open in new tab', 'Insert in text', 'Move to…', 'Delete'])
  await act(async () => [...document.querySelectorAll('.mi')].find((b) => b.textContent === 'Insert in text').click())
  assert.equal(inserted.length, 1)
  assert.match(inserted[0], /"pageId":"c2"/)
  assert.match(inserted[0], /"ownership":"linked"/)
  assert.deepEqual(text('.cp-title'), ['Elza', 'Citada'], 'sai da seção ao entrar no texto')
  await act(async () => document.querySelectorAll('.cp-more')[0].click())
  await act(async () => [...document.querySelectorAll('.mi')].find((b) => b.textContent === 'Move to…').click())
  assert.equal(text('.move')[0], 'move c1')
  await act(async () => root.unmount())
})

test('Alt+↓ reordena pelo teclado usando o índice entre todas as irmãs', async () => {
  reset(); calls.length = 0
  const root = await mount()
  await act(async () => document.querySelector('.cp-open').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })))
  assert.ok(calls.some((c) => c === 'movePage c1 root 1'), calls.join(';'))
  await act(async () => root.unmount())
})

test('protegidas mostram só o rótulo neutro, sem tipo nem data; bloqueada esconde ações de edição', async () => {
  reset(); pages.c1.passwordLock = { rootId: 'c1', hideTitle: true }
  let root = await mount({ locked: true })
  assert.deepEqual(text('.cp-title'), ['Protected page', 'Eliane', 'Citada'])
  assert.equal(document.querySelectorAll('.cp-chip').length, 0, 'sem tipo vazando')
  assert.equal(document.querySelectorAll('.cp-date').length, 2)
  assert.equal(document.querySelectorAll('.cp-grip').length, 0, 'bloqueada: sem arrastar')
  assert.equal(document.querySelectorAll('.cp-convert').length, 0, 'bloqueada: sem converter')
  await act(async () => document.querySelectorAll('.cp-more')[1].click())
  assert.deepEqual(text('.mi'), ['Open', 'Open in new tab'])
  await act(async () => root.unmount())
  reset()
})

test('botão da seção abre a conversão', async () => {
  reset(); calls.length = 0
  const root = await mount()
  await act(async () => document.querySelector('.cp-convert').click())
  assert.ok(calls.includes('openSubpagesDialog {"kind":"subpages","pageId":"root"}'))
  await act(async () => root.unmount())
})
