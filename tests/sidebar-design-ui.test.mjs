import PRODUCT from '../shared/product.json' with { type: 'json' }
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
import { renderToStaticMarkup } from 'react-dom/server'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'localStorage']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
dom.window.HTMLElement.prototype.attachEvent = () => {}
dom.window.HTMLElement.prototype.detachEvent = () => {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function moduleUrl(source, filename) {
  const result = await transformWithOxc(shimUi(source), filename, { jsx: { runtime: 'automatic' } })
  const code = result.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

const iconSource = await readFile(new URL('../src/components/ui/BlockIcon.tsx', import.meta.url), 'utf8')
const iconUrl = await moduleUrl(iconSource, 'BlockIcon.tsx')
const { BlockIcon } = await import(iconUrl)
const catalogSource = await readFile(new URL('../src/components/page/slashMenu/catalog.ts', import.meta.url), 'utf8')
const { SLASH_CATALOG } = await import(await moduleUrl(catalogSource, 'catalog.ts'))
let viewSource = await readFile(new URL('../src/components/database/icons.tsx', import.meta.url), 'utf8')
viewSource = viewSource.replace("import { BlockIcon } from '../ui/BlockIcon'", `import { BlockIcon } from ${JSON.stringify(iconUrl)}`)
const { ViewTypeIcon } = await import(await moduleUrl(viewSource, 'icons.tsx'))

const menuEvents = []
const suggestionComponents = { SuggestionMenu: {
  Root: ({ children, ...props }) => React.createElement('div', props, children),
  Label: ({ children, ...props }) => React.createElement('div', props, children),
  Item: ({ item, isSelected, onClick, ...props }) => React.createElement('button', { ...props, 'aria-selected': isSelected, onClick }, item.title),
  EmptyItem: ({ children, ...props }) => React.createElement('div', props, children),
  Loader: props => React.createElement('div', props),
} }
globalThis.__slashMenuDesignTest = { useComponentsContext: () => suggestionComponents, useExtension: () => ({ closeMenu: () => menuEvents.push('close') }), useI18n: () => ({ t: (_pt, en) => en }) }
let menuSource = await readFile(new URL('../src/components/page/slashMenu/Menu.tsx', import.meta.url), 'utf8')
menuSource = menuSource.replace(/^import \{ SuggestionMenu as SuggestionMenuExtension \} from .*$/m, 'const SuggestionMenuExtension = {}')
  .replace(/^import \{ useComponentsContext, useExtension, type DefaultReactSuggestionItem, type SuggestionMenuProps \} from .*$/m, 'const { useComponentsContext, useExtension } = globalThis.__slashMenuDesignTest')
  .replace(/^import \{ useI18n \} from .*$/m, 'const { useI18n } = globalThis.__slashMenuDesignTest')
  .replace(/^import \{ EMPTY_SLASH_GROUP \} from .*$/m, "const EMPTY_SLASH_GROUP = '__empty__'")
const { LocalSlashMenu } = await import(await moduleUrl(menuSource, 'Menu.tsx'))

test('database views and page blocks use distinct shared monochrome glyphs', () => {
  for (const type of ['table', 'board', 'gallery', 'list', 'feed', 'dashboard', 'calendar', 'timeline', 'map', 'chart', 'form']) {
    const html = renderToStaticMarkup(React.createElement(ViewTypeIcon, { type }))
    assert.match(html, new RegExp(`data-block-icon="${type}"`))
    assert.match(html, /<path|<rect|<circle/)
  }
  assert.notEqual(renderToStaticMarkup(React.createElement(BlockIcon, { name: 'database-inline' })), renderToStaticMarkup(React.createElement(BlockIcon, { name: 'database-full-page' })))
  const fallbackIds = SLASH_CATALOG.filter(item => renderToStaticMarkup(React.createElement(BlockIcon, { name: item.id })).includes('data-block-icon-fallback="true"')).map(item => item.id)
  assert.deepEqual(fallbackIds, [], `Local slash commands still use the generic plus icon: ${fallbackIds.join(', ')}`)
})

test('slash menu keeps a visible Close menu footer that dismisses the menu', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(React.createElement(LocalSlashMenu, { items: [{ title: 'Text', group: 'Basic blocks' }], selectedIndex: 0, onItemClick: () => {} })))
  const footer = host.querySelector('.pg-slash-menu-footer')
  assert.equal(footer?.textContent, 'Close menuesc')
  assert.equal(footer?.querySelector('kbd')?.textContent, 'esc')
  await act(async () => footer.click())
  assert.deepEqual(menuEvents, ['close'])
  await act(async () => root.unmount())
  host.remove()
})

const page = { id: 'p1', title: 'Projects', database: null, icon: null }
const state = { settings: { sidebarCollapsed: false, sidebarWidth: 280, workspaceName: `${PRODUCT.name}`, userName: '', expanded: {}, recent: ['p1'] }, route: { type: 'page', id: 'p1' }, notifications: {} }
const calls = []
const actions = {
  setSearchOpen: value => calls.push(['search', value]),
  setInboxOpen: value => calls.push(['inbox', value]),
  setSettingsOpen: value => calls.push(['settings', value]),
  navigate: route => calls.push(['navigate', route.type]),
  updateSettings: value => { calls.push(['updateSettings', value]); Object.assign(state.settings, value) },
  createPage: () => 'new',
  createDatabase: () => 'db',
  openPage: id => calls.push(['openPage', id]),
}
let recentList = [page]
const selectors = { favorites: () => [], recent: limit => recentList.slice(0, limit), children: () => [page], page: () => page, trash: () => [] }
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const mocks = {
  t, actions, api: { listWorkspaces: async () => [] }, selectors, useStore: () => state,
  MenuItem: ({ icon, label, onClick }) => React.createElement('button', { role: 'menuitem', onClick }, icon, label),
  Popover: ({ children, label }) => React.createElement('div', { className: 'test-popover', role: 'dialog', 'aria-label': label }, children),
  menuKeyNav: () => {}, PageMenu: () => null, RenamePopover: () => null,
  protectedTitle: () => null, PageNode: () => null, PageTree: () => null, TreeContext: React.createContext(null), applyDrop: () => {},
  TreePageIcon: ({ page }) => React.createElement(BlockIcon, { name: page.database ? 'database' : 'page' }),
  TooltipLayer: () => null,
  BlockIcon,
}
globalThis.__sidebarDesignTest = mocks
let trashSource = await readFile(new URL('../src/components/sidebar/TrashPopover.tsx', import.meta.url), 'utf8')
trashSource = trashSource.replace(/^import \{ t, getLocale \} from .*$/m, 'const { t } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ actions, selectors, useStore \} from .*$/m, 'const { actions, selectors, useStore } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ Popover \} from .*$/m, 'const { Popover } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ PageIcon \} from .*$/m, 'const { PageIcon } = globalThis.__sidebarDesignTest')
mocks.PageIcon = mocks.TreePageIcon
mocks.TrashPopover = (await import(await moduleUrl(trashSource, 'TrashPopover.tsx'))).TrashPopover
let sidebarSource = await readFile(new URL('../src/components/sidebar/Sidebar.tsx', import.meta.url), 'utf8')
sidebarSource = sidebarSource.replace(/^import \{ t \} from .*$/m, 'const { t } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ actions, api, selectors, useStore \} from .*$/m, 'const { actions, api, selectors, useStore } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ MenuItem, Popover, menuKeyNav, type Anchor \} from .*$/m, 'const { MenuItem, Popover, menuKeyNav } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ PageMenu, RenamePopover \} from .*$/m, 'const { PageMenu, RenamePopover } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ PageIcon as TreePageIcon, PageNode, PageTree, TreeContext, applyDrop, type DropTarget, type TreeCtx \} from .*$/m, 'const { TreePageIcon, PageNode, PageTree, TreeContext, applyDrop } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ TooltipLayer \} from .*$/m, 'const { TooltipLayer } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ TrashPopover \} from .*$/m, 'const { TrashPopover } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ protectedTitle \} from .*$/m, 'const { protectedTitle } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ BlockIcon \} from .*$/m, 'const { BlockIcon } = globalThis.__sidebarDesignTest')
  .replace(/^import \{ shortcutHint \} from .*$/m, 'const shortcutHint = () => ""')
  .replace(/^import \{ Icon \} from .*$/m, 'const Icon = () => null')
  .replace(/^import type .*$/gm, '')
  .replace(/^import '\.\/sidebar\.css'$/m, '')
  .replace(/^import \{ ProductivityIcon \} from .*$/m, 'const ProductivityIcon = () => null')
  .replace(/^import \{ DailyFlowNav \} from .*$/m, 'const DailyFlowNav = () => null')
  .replace(/^import \{ SidebarTypes \} from .*$/m, 'const SidebarTypes = () => null')
  .replace(/^import \{ openTypesManager \} from .*$/m, 'const openTypesManager = () => {}')
  .replace(/^import \{ openTypesGallery \} from .*$/m, 'const openTypesGallery = () => {}')
  .replace(/^import \{ sidebarTypes \} from .*$/m, 'const sidebarTypes = () => []')
  .replace(/^import \{ SelectionBar, SelectionMenu \} from .*$/m, 'const SelectionBar = () => null, SelectionMenu = () => null')
  .replace(/^import \{ clearSelection, selectedIds \} from .*$/m, 'const clearSelection = () => {}, selectedIds = () => []')
  .replace(/^import \{ toggleAskPanel, useAskPanel \} from .*$/m, 'const toggleAskPanel = () => {}, useAskPanel = () => ({ open: false })')
  .replace(/^import \{ CanvasIcon \} from .*$/m, 'const CanvasIcon = () => null')
  .replace(/^import \{ createCanvas \} from .*$/m, 'const createCanvas = () => "board"')
const { Sidebar } = await import(await moduleUrl(sidebarSource, 'Sidebar.tsx'))

test('sidebar navigation and workspace menu open the connected local actions', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(Sidebar)))
  async function click(element) { assert.ok(element); await act(async () => { element.click(); await Promise.resolve() }) }
  await click(document.querySelector('.sb-search'))
  await click(document.querySelector('.sb-quick-home'))
  await click(document.querySelector('.sb-quick-icon'))
  assert.deepEqual(calls.slice(0, 3), [['search', true], ['navigate', 'home'], ['inbox', true]])
  assert.match(document.querySelector('.sb-recents').textContent, /Projects/)
  assert.equal(document.querySelector('.sb-footer [aria-label="Trash"]'), null)

  await click(document.querySelector('.sb-footer .sb-ws-btn'))
  await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Settings'))
  assert.deepEqual(calls.at(-1), ['settings', true])
  await click(document.querySelector('.sb-footer .sb-ws-btn'))
  await click([...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Trash'))
  assert.match(document.querySelector('[role="dialog"][aria-label="Trash"]')?.textContent ?? '', /Trash is empty/)
  await act(async () => root.unmount())
})

test('sidebar recents: 5 by default, expand up to 15, collapse again, state persisted in settings.recentExpanded', async () => {
  recentList = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, title: `Recent ${i}`, database: null, icon: null }))
  state.route = { type: 'page', id: 'r0' }
  state.settings.recentExpanded = false
  const root = createRoot(document.getElementById('app'))
  const render = () => act(async () => root.render(React.createElement(Sidebar)))
  const rows = () => [...document.querySelectorAll('.sb-recents .sb-row:not(.sb-recents-more)')].map(row => row.textContent)
  const more = () => document.querySelector('.sb-recents-more')
  await render()
  assert.equal(rows().length, 5)
  assert.equal(more().textContent, 'Show 10 more')
  assert.equal(more().getAttribute('aria-expanded'), 'false')

  await act(async () => { more().click() })
  assert.deepEqual(calls.at(-1), ['updateSettings', { recentExpanded: true }])
  assert.equal(state.settings.recentExpanded, true, 'expanded state is stored in settings')
  await render()
  assert.equal(rows().length, 15, 'expands to at most 15')
  assert.equal(more().textContent, 'Show less')
  assert.equal(more().getAttribute('aria-expanded'), 'true')

  await act(async () => { more().click() })
  assert.deepEqual(calls.at(-1), ['updateSettings', { recentExpanded: false }])
  await render()
  assert.equal(rows().length, 5)

  // Active page beyond the first 5: it becomes the first row (still 5 rows) and is marked active.
  state.route = { type: 'page', id: 'r9' }
  await render()
  assert.equal(rows().length, 5)
  assert.equal(rows()[0], 'Recent 9')
  assert.ok(document.querySelector('.sb-recents .sb-row--active')?.textContent === 'Recent 9', 'active row is marked')
  assert.ok(!rows().includes('Recent 4'), 'oldest visible row gives way')

  // Few recents: no toggle at all.
  recentList = recentList.slice(0, 4)
  await render()
  assert.ok(more() === null, 'no toggle with 5 or fewer recents')
  await act(async () => root.unmount())
  recentList = [page]; state.route = { type: 'page', id: 'p1' }
})
