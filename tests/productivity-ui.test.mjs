// Painel de Produtividade (jsdom). Regras: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi, Select as ShimSelect } from './fixtures/ui-shim.mjs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as stats from '../src/activity/stats.ts'
import * as books from '../src/activity/books.ts'
import { protectedAncestor } from '../src/security/pageLock.ts'
import { normalizeData } from '../electron/productivity-data.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const page = (id, extra = {}) => ({ id, parentId: null, title: `Page ${id.slice(-2)}`, icon: null, trashed: false, ...extra })
const pages = {
  [P(1)]: page(P(1), { title: 'Novel draft' }),
  [P(2)]: page(P(2), { title: 'Secret diary', passwordLock: { rootId: P(2), hideTitle: false } }),
  [P(3)]: page(P(3), { title: 'Tasks DB', database: { properties: [] } }),
  [P(4)]: page(P(4), { title: 'Row', parentId: P(3) }),
  [P(5)]: page(P(5), { title: 'Old trash', trashed: true }),
}
const today = '2026-10-07'
const days = {}
for (let i = 0; i < 365; i += 3) {
  const key = stats.addDays(today, -i)
  days[key] = { words: (i % 7) * 40, edits: (i % 5) + 1, tasks: i % 4 === 0 ? 1 : 0, created: i % 9 === 0 ? 1 : 0, hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? (i % 5) + 1 : 0)), estimated: i > 300 }
}
days[today] = { words: 120, edits: 3, tasks: 1, created: 1, hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 3 : 0)), pages: { [P(1)]: [100, 2], [P(2)]: [900, 9], [P(4)]: [20, 1], [P(5)]: [50, 5] } }
const data = normalizeData({ days })

let settings = { locale: 'en-US', productivity: {} }
const calls = []
const mocks = {
  t, useI18n: () => ({ locale: 'en-US', t }),
  actions: { navigate: route => calls.push(['navigate', route.type]), openPage: id => calls.push(['open', id]), openInNewTab: () => {}, updateSettings: () => {}, setSettingsOpen: () => calls.push(['settings']) },
  selectors: { isLive: id => !pages[id]?.trashed },
  useStore: () => ({ settings, pages }),
  productivity: { today: () => today },
  requestSettingsSection: section => calls.push(['section', section]),
  protectedAncestor, ...stats, ...books,
  cancelBackfill: () => {}, useBackfillStatus: () => ({ running: false, done: 0, total: 0, error: null }),
  useProductivityData: () => ({ data, loaded: true }),
  PageIcon: () => null, ProductivityIcon: () => null,
}
mocks.Select = ShimSelect
globalThis.__pd = mocks

async function compile(file, name) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
    .replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => module === 'react' || module === 'lucide-react' ? match
      : `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+) as (\w+)/g, '$1: $2')}=globalThis.__pd`)
  const out = await transformWithOxc(shimUi(source), name, { jsx: { runtime: 'automatic' } })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, mod) => `from ${JSON.stringify(import.meta.resolve(mod))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
Object.assign(mocks, await compile('../src/components/productivity/Heatmap.tsx', 'Heatmap.tsx'))
const { ProductivityView } = await compile('../src/components/productivity/ProductivityView.tsx', 'ProductivityView.tsx')

const text = selector => document.querySelector(selector)?.textContent ?? ''
const cardValue = id => text(`[data-card="${id}"] .pd-card-value`)
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const click = async label => { const el = button(label); assert.ok(el !== undefined, `button ${label}`); await act(async () => { el.click() }) }

test('overview: cards, period filters, heatmap grid, hours chart, week comparison, book sentence', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ProductivityView)))
  assert.equal(document.querySelectorAll('.pd-card').length, 8)
  const all = stats.summarize(data, 'all', today)
  assert.equal(cardValue('words'), new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(all.words), 'large numbers are compact')
  assert.equal(cardValue('edits'), all.edits.toLocaleString('en-US'))
  assert.match(cardValue('peak'), /9\s?PM/)
  assert.match(text('.pd-est'), /estimated earlier history/)
  assert.equal(document.querySelectorAll('.pd-heat-col').length, 53)
  assert.equal(document.querySelectorAll('.pd-heat-col .pd-cell').length, 371)
  assert.ok(document.querySelectorAll('.pd-cell.pd-l4').length > 0)
  assert.ok(document.querySelectorAll('.pd-cell.is-est').length > 0, 'estimated days are marked')
  assert.equal(document.querySelectorAll('.pd-hour').length, 24)
  assert.equal(document.querySelectorAll('.pd-week tbody tr').length, 4)
  assert.match(text('.pd-fun'), /length of “/)
  await click('Today')
  assert.equal(cardValue('words'), '120')
  assert.equal(cardValue('tasks'), '1')
  await click('7d')
  assert.equal(cardValue('words'), String(stats.summarize(data, '7d', today).words))
  // Teclado no mapa: foco + seta mostra a dica do dia.
  const grid = document.querySelector('.pd-heat-grid')
  for (let i = 0; i < 3; i++) await act(async () => { grid.focus(); grid.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
  assert.match(text('.pd-heat [role="status"]'), /October 4, 2026/)
  assert.match(text('.pd-heat [role="status"]'), /words/)
  assert.match(text('.pd-bubble'), /October 4, 2026/)
  // Métrica do mapa
  const select = document.querySelector('.pd-heat select')
  await act(async () => { select.value = 'tasks'; select.dispatchEvent(new window.Event('change', { bubbles: true })) })
  assert.match(grid.getAttribute('aria-label'), /tasks heatmap/)
  await act(async () => root.unmount())
})

test('pages & databases: protected and trashed pages never listed; rows add to their database', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ProductivityView)))
  await click('Pages & databases')
  const body = document.body.textContent
  assert.ok(body.includes('Novel draft'))
  assert.ok(body.includes('Tasks DB'))
  assert.equal(body.includes('Secret diary'), false)
  assert.equal(body.includes('Old trash'), false)
  assert.equal(body.includes('Row'), false, 'rows appear only through their database')
  await click('Novel draft100 words · 2 edits')
  assert.deepEqual(calls.at(-1), ['open', P(1)])
  await act(async () => root.unmount())
})

test('optional goal ring and tracking-off notice; no nagging without a goal', async () => {
  settings = { locale: 'en-US', productivity: { dailyGoal: 240 } }
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ProductivityView)))
  assert.equal(text('.pd-goal-pct'), '50%')
  assert.equal(document.querySelector('.pd-off') === null, true)
  settings = { locale: 'en-US', productivity: { enabled: false } }
  await act(async () => root.render(React.createElement(ProductivityView, { key: 'off' })))
  assert.match(text('.pd-off'), /tracking is off/)
  assert.equal(document.querySelector('.pd-goal') === null, true)
  await click('Set a daily goal (optional)')
  assert.deepEqual(calls.slice(-2), [['section', 'productivity'], ['settings']])
  await act(async () => root.unmount())
})
