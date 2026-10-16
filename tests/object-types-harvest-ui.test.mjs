// Interface dos campos retroativos (jsdom): aviso em Editar tipo → Campos e "Revisar tipos". Asserções só com
// strings/números/booleans (nunca nós do DOM). docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
const { createRoot } = await import('react-dom/client')
const model = await import('../src/objecttypes/model.ts')
const harvest = await import('../src/objecttypes/harvest.ts')

const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const mk = (id, name) => ({ id, name, icon: null, color: 'blue', description: '', properties: [], template: {}, createdAt: 1, updatedAt: 1, adoptedAt: 1 })
const types = [mk('ty', 'Tags'), mk('ty2', 'Projeto')]
const page = (id, extra = {}) => ({ id, parentId: null, title: id, text: '', locked: false, trashed: false, updatedAt: 1, icon: null, ...extra })
const db = (id, props) => page(id, { database: { properties: props, views: [], activeViewId: 'v' } })
let pages = {}
let dismissed = {}
const calls = []
const record = (name) => (...args) => { calls.push([name, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(' ')) }
const mocks = {
  Button: ({ variant, className, type = 'button', ...rest }) => React.createElement('button', { type, className: 'np-btn' + (variant ? ' np-btn--' + variant : ''), ...rest }),
  IconButton: ({ label, children, type = 'button', ...rest }) => React.createElement('button', { type, 'aria-label': label, ...rest }, children),
  useI18n: () => ({ t, locale: 'en-US' }),
  useStore: () => ({ pages, settings: { objectTypes: types, objectTypesPrefs: { harvestDismissed: dismissed } } }),
  PageIcon: () => null, PropTypeIcon: () => null, propertyTypeLabel: (type) => type,
  ...model, ...harvest,
  dismissHarvest: record('dismiss'), incorporateHarvested: record('incorporate'), restoreHarvest: record('restore'),
  openTypesManager: record('manager'), openTypesReview: () => record('review')(), patchTypesUi: () => {}, useTypesUi: () => ({ review: false }),
}
globalThis.__harvestUi = mocks

async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}=globalThis.__harvestUi`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' }, lang: 'tsx' })
  return import(`data:text/javascript;base64,${Buffer.from(out.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)).toString('base64')}`)
}
const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.trim())
const button = (label) => [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === label)
const root = createRoot(document.getElementById('app'))
const render = (element) => act(async () => root.render(element))
const { HarvestNotice, ReviewTypesDialog, ReviewBadge } = await load('../src/components/objecttypes/Harvest.tsx')

function seed() {
  pages = {
    bd: db('bd', [{ id: 'pt', name: 'Nome', type: 'title' }, { id: 'rec', name: 'Recursos', type: 'relation' }, { id: 'cri', name: 'Criado em', type: 'createdTime' }]),
    bd2: db('bd2', [{ id: 'pt2', name: 'Nome', type: 'title' }, { id: 'pr', name: 'Prazo', type: 'date' }]),
  }
  for (let i = 0; i < 7; i++) pages[`r${i}`] = page(`r${i}`, { parentId: 'bd', types: ['ty'], props: i < 3 ? { rec: ['x'] } : {} })
  pages.q = page('q', { parentId: 'bd2', types: ['ty2'], props: { pr: '2026-01-01' } })
  dismissed = {}
}

test('notice shows the count, all fields checked, “in 7 of 7 pages”, and incorporates only the ticked ones', async () => {
  seed()
  await render(React.createElement(HarvestNotice, { typeId: 'ty' }))
  assert.equal(texts('.ot-harvest-title')[0], '2 fields from the pages of this type are not in the type yet')
  assert.equal([...document.querySelectorAll('.ot-inc-list input')].every((el) => el.checked), true)
  const notes = texts('.ot-inc-list small')
  assert.ok(notes[0].startsWith('in 7 of 7 pages · 3 with a value'), notes[0])
  assert.ok(notes[1].startsWith('in 7 of 7 pages · 7 with a value'), notes[1])
  await act(async () => document.querySelectorAll('.ot-inc-list input')[1].click())
  calls.length = 0
  await act(async () => button('Add selected').click())
  assert.equal(calls[0], 'incorporate [{"typeId":"ty","fieldIds":["rec"]}]')
})

test('“Not now” dismisses the listed fields; a dismissed type shows only a quiet reopen link', async () => {
  seed()
  await render(React.createElement(HarvestNotice, { typeId: 'ty' }))
  calls.length = 0
  await act(async () => button('Not now').click())
  assert.equal(calls[0], 'dismiss ty ["rec","cri"]')
  dismissed = { ty: ['rec', 'cri'] }
  await render(React.createElement(HarvestNotice, { typeId: 'ty' }))
  assert.equal(document.querySelectorAll('.ot-harvest').length, 0)
  assert.ok(texts('.ot-harvest-skipped')[0].startsWith('2 page field(s) dismissed.'))
  calls.length = 0
  await act(async () => button('Review').click())
  assert.equal(calls[0], 'restore ty')
})

test('nothing missing: the notice renders nothing and the badge is absent', async () => {
  seed()
  pages = Object.fromEntries(Object.entries(pages).filter(([id]) => !id.startsWith('r') && id !== 'q'))
  await render(React.createElement(HarvestNotice, { typeId: 'ty' }))
  assert.equal(document.querySelectorAll('.ot-harvest, .ot-harvest-skipped').length, 0)
  await render(React.createElement(ReviewBadge, {}))
  assert.equal(document.querySelectorAll('[data-ot="review-badge"]').length, 0)
})

test('badge counts pending fields and opens the review', async () => {
  seed()
  await render(React.createElement(ReviewBadge, {}))
  assert.equal(texts('[data-ot="review-badge"]')[0], '3 fields to review')
  calls.length = 0
  await act(async () => document.querySelector('[data-ot="review-badge"]').click())
  assert.equal(calls[0], 'review')
})

test('review types: lists every type with missing fields, preview, and one batch call for the selection', async () => {
  seed()
  await render(React.createElement(ReviewTypesDialog, { onClose: record('close') }))
  const heads = texts('.ot-review-head strong')
  assert.equal(heads.join(','), 'Tags,Projeto')
  assert.ok(texts('[data-ot="review-preview"]')[0].startsWith('Will add 3 field(s) to 2 type(s); 11 value(s) kept.'), texts('[data-ot="review-preview"]')[0])
  // Desmarcar o tipo Projeto inteiro.
  await act(async () => document.querySelectorAll('.ot-review-head input')[1].click())
  assert.ok(texts('[data-ot="review-preview"]')[0].startsWith('Will add 2 field(s) to 1 type(s)'), texts('[data-ot="review-preview"]')[0])
  // Desmarcar um campo de Tags.
  await act(async () => document.querySelector('.ot-review-type .ot-inc-list input').click())
  assert.ok(texts('[data-ot="review-preview"]')[0].startsWith('Will add 1 field(s) to 1 type(s)'))
  calls.length = 0
  await act(async () => button('Add everything selected').click())
  assert.equal(calls[0], 'incorporate [{"typeId":"ty","fieldIds":["cri"]}]')
  assert.ok(calls.includes('close'), 'dialog closes after the batch')
})
