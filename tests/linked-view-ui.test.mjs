// UI (jsdom) da visualização vinculada (docs/USAGE.md): bloco sem fonte, seletor
// "Vincular fonte de dados" (busca, caminho, teclado, Esc devolve o foco), painel "Nova visualização"
// com "Visualizações em <fonte>" e, no DatabaseView, propriedades editáveis ("+") na visão vinculada.
// Regras de memória: nada de nós do DOM em asserts — só strings, números e booleanos.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === 'function' && /^[a-z]/.test(name) ? dom.window[name].bind(dom.window) : dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
// React DOM carregado depois do jsdom: assim detecta o evento `input` (onChange) como num navegador.
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const calls = []
let pages = {}
const state = { get pages() { return pages }, settings: { recent: [], workspaceName: 'Space' }, peekPageId: null }
const linked = await import('../src/components/database/linkedSource.ts')
const known = {
  t, getLocale: () => 'en-US', useStore: () => state, getState: () => state,
  selectors: { page: (id) => pages[id], isLive: (id) => !!pages[id] && !pages[id].trashed, database: (id) => pages[id]?.database },
  actions: {
    createPage: (parentId, init) => { const id = `new-${calls.length}`; pages[id] = { id, parentId, title: '', ...init }; calls.push(['createPage', parentId, JSON.stringify(init.database?.linkedSourceId ?? null)]); return id },
    createDatabase: (parentId) => { const id = 'fresh-db'; pages[id] = { id, parentId, title: 'New', database: { properties: [], views: [], activeViewId: '' } }; calls.push(['createDatabase', parentId]); return id },
    flushMeta: async () => {}, reportSaveError: () => {}, openPage: (id) => calls.push(['openPage', id]),
    addView: (dbId, type) => calls.push(['addView', type]), adoptSourceView: (dbId, viewId) => { calls.push(['adopt', viewId]); return 'x' },
    relinkDatabase: (dbId, id) => { calls.push(['relink', id]); return true }, convertLinkedToIndependent: async () => true,
  },
  Icon: ({ name }) => React.createElement('i', { 'data-icon': name }),
  PageIcon: () => null, ViewTypeIcon: ({ type }) => React.createElement('i', { 'data-view': type }),
  ...linked,
}
globalThis.__linkedUi = new Proxy(known, { get: (target, name) => (name in target ? target[name] : () => null) })

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'react-dom' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '')}=globalThis.__linkedUi`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: file.endsWith('.ts') ? 'ts' : 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
Object.assign(known, await load('../src/components/database/ui/Popover.tsx'))
Object.assign(known, await load('../src/components/ui/Button.tsx'))
Object.assign(known, await load('../src/components/ui/PanelHeader.tsx'))
Object.assign(known, await load('../src/components/ui/illustrations/Illustration.tsx'))
Object.assign(known, await load('../src/components/database/LinkSourcePicker.tsx'))
Object.assign(known, await load('../src/components/database/LinkedSourceBlock.tsx'))
Object.assign(known, await load('../src/components/database/LinkedViewChrome.tsx'))

const db = (id, title, extra = {}) => ({ id, title, icon: null, parentId: null, trashed: false, updatedAt: 1, database: { properties: [{ id: 't', name: 'Name', type: 'title' }], views: [{ id: `${id}-v`, name: 'By status', type: 'board', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: `${id}-v` }, ...extra })
function seed(count = 2) {
  pages = { home: { id: 'home', title: 'Home', parentId: null, trashed: false, updatedAt: 1 }, note: { id: 'note', title: 'Plain note', parentId: null, trashed: false, updatedAt: 1 } }
  pages.res = db('res', 'BD-Recursos', { parentId: 'home', updatedAt: 50 })
  for (let i = 1; i < count; i++) pages[`db${i}`] = db(`db${i}`, `Base ${i} with a very long name to check truncation`, { updatedAt: 10 - i })
}
const text = (selector) => document.querySelector(selector)?.textContent ?? ''
const all = (selector) => [...document.querySelectorAll(selector)]
const key = async (target, k) => act(async () => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true })))

test('bloco sem fonte: estado vazio, seletor com só bancos, caminho, busca, teclado e Esc devolve o foco', async () => {
  seed(8); calls.length = 0
  const host = document.createElement('div'); host.className = 'pg-root'; host.dataset.pageId = 'home'; document.body.appendChild(host)
  const updates = []
  const editor = { isEditable: true, updateBlock: (id, update) => updates.push([id, JSON.stringify(update.props)]) }
  const root = createRoot(host)
  await act(async () => root.render(React.createElement(known.LinkedSourceBlock, { blockId: 'b1', editor })))
  assert.equal(text('.lsb .np-empty-title'), 'Linked view')
  assert.equal(text('.lsb-chip'), 'Table')
  const button = all('.lsb button').find((el) => el.textContent === 'Link a data source')
  assert.ok(button, 'botão primário')
  await act(async () => button.click())
  const input = document.querySelector('.lsp-input')
  assert.ok(document.activeElement === input, 'foco no campo de busca')
  assert.equal(text('.lsp .np-panel-head-title'), 'Link a data source')
  const titles = () => all('.lsp-item:not(.lsp-more) .lsp-item-title').map((el) => el.textContent)
  assert.equal(titles()[0], 'New empty database')
  assert.ok(!titles().includes('Plain note'), 'sem páginas comuns')
  assert.equal(all('.lsp-item').filter((el) => el.querySelector('.lsp-item-path')).length, 5, '5 fontes antes de "Mostrar mais"')
  assert.equal(text('.lsp-section'), 'Existing data sources')
  assert.equal(all('.lsp-item-path')[0].textContent, 'Space / Home', 'caminho em cinza')
  assert.ok(text('.lsp-more').startsWith('Show more'))
  await act(async () => document.querySelector('.lsp-more').click())
  assert.equal(all('.lsp-item-path').length, 8, 'mostra o resto')
  // Busca filtra na hora; ↓/Enter escolhe.
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'recursos'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(titles(), ['BD-Recursos'])
  assert.equal(input.getAttribute('aria-activedescendant'), all('.lsp-item')[0].id)
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'zzz'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.ok(text('.lsp-empty').includes('No database matches'), 'nenhum resultado')
  await key(input, 'Escape')
  assert.ok(document.querySelector('.lsp') === null, 'Esc fecha')
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)))
  assert.ok(document.activeElement === button, 'foco volta ao botão')
  // Reabre, escolhe pelo teclado: o bloco passa a apontar para a nova visualização vinculada.
  await act(async () => button.click())
  const again = document.querySelector('.lsp-input')
  await key(again, 'ArrowDown')
  await key(again, 'Enter')
  assert.deepEqual(calls.find((call) => call[0] === 'createPage'), ['createPage', 'home', '"res"'])
  assert.equal(updates.length, 1)
  assert.ok(updates[0][1].includes('"display":"inline"'))
  await act(async () => root.unmount())
  host.remove()
})

test('seletor: nenhum banco no espaço explica e mantém "Novo banco vazio"', async () => {
  pages = { note: { id: 'note', title: 'Plain note', parentId: null, trashed: false, updatedAt: 1 } }; calls.length = 0
  const anchor = document.createElement('button'); document.body.appendChild(anchor)
  const root = createRoot(document.getElementById('app'))
  let created = 0
  await act(async () => root.render(React.createElement(known.LinkSourcePicker, { anchor, title: 'Link', onPick() {}, onCreateNew: () => { created++ }, onClose() {} })))
  assert.ok(text('.lsp-empty').includes('no databases'))
  await key(document.querySelector('.lsp-input'), 'Enter')
  assert.equal(created, 1)
  await act(async () => root.unmount())
  anchor.remove()
})

test('painel "Nova visualização": 4 layouts, "Mais layouts" com voltar e "Visualizações em <fonte>"', async () => {
  seed(1); calls.length = 0
  pages.lv = { id: 'lv', title: '', parentId: 'home', database: { properties: [], views: [{ id: 'mine', name: 'Table', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'mine', linkedSourceId: 'res' } }
  const anchor = document.createElement('button'); document.body.appendChild(anchor)
  const root = createRoot(document.getElementById('app'))
  let closed = 0
  await act(async () => root.render(React.createElement(known.AddViewPanel, { dbId: 'lv', anchor, views: pages.lv.database.views, onClose: () => { closed++ } })))
  const labels = () => all('.lvc-addview .dbv-menu-label').map((el) => el.textContent)
  assert.deepEqual(labels().slice(0, 5), ['Table view', 'Board view', 'List view', 'Gallery view', 'More layouts'])
  assert.ok(all('.dbv-menu-section').some((el) => el.textContent === 'Views on BD-Recursos'))
  assert.ok(labels().includes('By status'))
  assert.ok(text('.lvc-tip').includes('Properties are shared with “BD-Recursos”'), 'aviso da primeira vez')
  await act(async () => all('.lvc-addview .dbv-menu-item').find((el) => el.textContent.includes('More layouts')).click())
  assert.equal(text('.lvc-addview .np-panel-head-title'), 'More layouts')
  assert.ok(labels().includes('Calendar view'))
  await act(async () => document.querySelector('.lvc-addview [aria-label="Back"]').click())
  await act(async () => all('.lvc-addview .dbv-menu-item').find((el) => el.textContent.includes('By status')).click())
  assert.deepEqual(calls.at(-1), ['adopt', 'res-v'])
  assert.equal(closed, 1)
  await act(async () => root.unmount())
  anchor.remove()
})

test('cabeçalho: ↗ + nome da fonte abre a fonte; indicador "Vinculado a" tem trocar fonte', async () => {
  seed(3); calls.length = 0
  pages.lv = { id: 'lv', title: '', parentId: 'home', database: { properties: [], views: [], activeViewId: '', linkedSourceId: 'res' } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(known.LinkedTitle, { dbId: 'lv', readOnly: false })))
  const title = document.querySelector('.lvc-title')
  assert.equal(title.textContent, 'BD-Recursos', 'sem o placeholder "New database"')
  assert.equal(title.getAttribute('title'), 'Open BD-Recursos')
  await act(async () => title.click())
  assert.deepEqual(calls.at(-1), ['openPage', 'res'])
  const badge = document.querySelector('.lvc-badge')
  assert.equal(badge.textContent, 'Linked', 'não repete o nome já mostrado no título')
  assert.equal(badge.getAttribute('aria-label'), 'Linked to BD-Recursos: source options')
  await act(async () => badge.click())
  const items = all('.dbv-menu-item').map((el) => el.textContent)
  assert.deepEqual(items.slice(0, 3), ['Open source', 'Change source…', 'Convert to independent database'])
  await act(async () => all('.dbv-menu-item')[1].click())
  assert.ok(document.querySelector('.lsp'), 'abre o seletor para trocar a fonte')
  assert.ok(!all('.lsp-item-title').some((el) => el.textContent === ''), 'itens com nome')
  await act(async () => all('.lsp-item').find((el) => el.textContent.includes('Base 1')).click())
  assert.deepEqual(calls.at(-1), ['relink', 'db1'])
  await act(async () => root.unmount())
})

test('DatabaseView vinculado: título ↗ da fonte, sem a linha "Fonte:" e propriedades editáveis (+) como na fonte', async () => {
  seed(1); calls.length = 0
  const view = { id: 'mine', name: 'Table', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
  pages.lv = { id: 'lv', title: '', parentId: 'home', locked: false, database: { properties: [], views: [view], activeViewId: 'mine', linkedSourceId: 'res' } }
  const merged = { ...pages.lv.database, properties: pages.res.database.properties }
  let seen = null
  Object.assign(known, await import('../src/components/database/rowSelection.ts'), {
    normalizeSearch: (value) => value.toLowerCase(), applyView: (rows) => rows, visibleProperties: (schema) => schema.properties, groupableProperty: () => undefined, groupsFor: () => [],
    viewBodyClasses: () => '', dbEvents: { on: () => () => {}, emit() {} }, getValue: () => null, valueToText: () => '',
    TableView: (props) => { seen = props.schemaLocked; return React.createElement('div', { className: 'tb-mock' }, props.schemaLocked ? '' : React.createElement('button', { 'aria-label': 'Add property' }, '+')) },
  })
  known.selectors = { ...known.selectors, database: (id) => (id === 'lv' ? merged : pages[id]?.database), rows: () => [] }
  known.actions = { ...known.actions, onLinkedSchemaEdit: () => () => {}, undoDatabase: () => false, redoDatabase: () => false, activateView() {} }
  const { DatabaseView } = await load('../src/components/database/DatabaseView.tsx')
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(DatabaseView, { pageId: 'lv', embedded: true })))
  assert.equal(seen, false, 'esquema editável na visão vinculada')
  assert.ok(document.querySelector('.tb-mock [aria-label="Add property"]'), '"+" de nova propriedade')
  assert.equal(text('.lvc-title'), 'BD-Recursos')
  assert.ok(!document.body.textContent.includes('Source:'), 'sem a linha "Fonte:" solta')
  assert.ok(!document.body.textContent.includes('New database'), 'sem o placeholder')
  // Fonte bloqueada: volta a bloquear o esquema.
  pages.res.locked = true
  await act(async () => root.render(React.createElement(DatabaseView, { pageId: 'lv', embedded: true, key: 'locked' })))
  assert.equal(seen, true, 'fonte bloqueada bloqueia o esquema')
  pages.res.locked = false
  await act(async () => root.unmount())
})
