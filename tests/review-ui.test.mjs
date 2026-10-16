// Sessão de revisão (jsdom): revelar com Espaço, notas 1–4 pelo teclado, progresso, ⌘Z e fim da sessão.
// Nunca comparar nós do DOM em asserts (comparar strings/números/booleanos).
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
import { addCards, applyRating, undoRating } from '../src/review/reviewCore.ts'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'KeyboardEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 9, 10).getTime()
let settings = addCards(undefined, ['a', 'b'], NOW)
const opened = []
const contents = { a: { front: 'Pergunta A', back: 'Resposta A' }, b: { front: 'Pergunta B', back: 'Resposta B' } }
globalThis.__rv = {
  t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')),
  useI18n: () => ({ locale: 'pt-BR' }),
  PageIcon: () => null,
  ProgressBar: ({ value, label }) => React.createElement('div', { role: 'progressbar', 'aria-valuenow': Math.round(value * 100) }, label),
  getState: () => ({ settings: { review: settings } }),
  cardContent: async key => ({ key, pageId: key, title: 'Página ' + key, icon: null, kind: 'page', ...contents[key] }),
  rateCard: (key, grade, now) => { const result = applyRating(settings, key, grade, now); if (!result) return null; settings = result.settings; return result.undo },
  undoRate: entry => { settings = undoRating(settings, entry) },
  reviewSettings: () => settings,
  openCardSource: key => opened.push(key),
}
const href = path => JSON.stringify(new URL(path, import.meta.url).href)
let source = await readFile(new URL('../src/review/ReviewSession.tsx', import.meta.url), 'utf8')
source = source
  .replace(/import \{ t, useI18n \} from '\.\.\/i18n'/, 'const { t, useI18n } = globalThis.__rv')
  .replace(/import \{ PageIcon \} from '[^']*'/, 'const { PageIcon } = globalThis.__rv')
  .replace(/import \{ ProgressBar \} from '[^']*'/, 'const { ProgressBar } = globalThis.__rv')
  .replace(/import \{ getState \} from '\.\.\/store'/, 'const { getState } = globalThis.__rv')
  .replace(/import \{ intervalLabel, scheduleAll, type Grade \} from '\.\/fsrs'/, `import { intervalLabel, scheduleAll } from ${href('../src/review/fsrs.ts')}`)
  .replace(/import \{ paramsOf, reviewStats, type CardKey, type UndoEntry \} from '\.\/reviewCore'/, `import { paramsOf, reviewStats } from ${href('../src/review/reviewCore.ts')}`)
  .replace(/import \{[^}]*\} from '\.\/reviewActions'/, 'const { cardContent, openCardSource, rateCard, reviewSettings, undoRate } = globalThis.__rv')
  .replace(/import '\.\/review\.css'/, '')
const compiled = await transformWithOxc(shimUi(source), 'ReviewSession.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { ReviewSession } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const key = async (k, extra = {}) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })); await new Promise(r => setTimeout(r, 5)) }) }
const text = selector => document.querySelector(selector)?.textContent ?? null

test('Espaço revela, 1–4 dão a nota, De novo volta a aparecer e ⌘Z desfaz', async () => {
  const root = createRoot(document.getElementById('app'))
  let closed = 0
  await act(async () => { root.render(React.createElement(ReviewSession, { keys: ['a', 'b'], onClose: () => { closed++ }, now: () => NOW })); await new Promise(r => setTimeout(r, 5)) })
  assert.equal(text('[data-test="rv-front"]'), 'Pergunta A')
  assert.ok(document.querySelector('[data-test="rv-back"]') === null, 'verso escondido')
  await key('3')
  assert.equal(settings.cards.a.reps, 0, 'nota antes de revelar é ignorada')
  await key(' ')
  assert.equal(text('[data-test="rv-back"]'), 'Resposta A')
  const labels = [...document.querySelectorAll('.rv-grade-when')].map(el => el.textContent)
  assert.deepEqual(labels, ['10 min', '1 dia', '4 dias', '14 dias'])
  await key('1') // De novo: A volta depois de B
  assert.equal(settings.cards.a.lapses, 0, 'cartão novo não conta lapso')
  assert.equal(settings.cards.a.phase, 'learning')
  assert.equal(text('[data-test="rv-front"]'), 'Pergunta B')
  assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '0')
  await key(' '); await key('3')
  assert.equal(settings.cards.b.phase, 'review')
  assert.equal(text('[data-test="rv-front"]'), 'Pergunta A', 'o cartão errado reaparece na mesma sessão')
  assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '50')
  // ⌘Z desfaz a nota de B.
  await key('z', { metaKey: true })
  assert.equal(settings.cards.b.phase, 'new')
  assert.equal(text('[data-test="rv-front"]'), 'Pergunta B')
  await key(' '); await key('4')
  assert.equal(settings.cards.b.reps, 1)
  await key(' '); await key('2')
  assert.match(text('.rv-done h2'), /Sessão concluída/)
  assert.match(text('.rv-done p'), /2 cartões revisados/)
  assert.equal(settings.log['2026-10-09'][0], 3, 'três notas gravadas depois do desfazer')
  await key('Escape')
  assert.equal(closed, 1)
  await act(async () => root.unmount())
})

test('Abrir leva à página e fecha a sessão', async () => {
  settings = addCards(undefined, ['a'], NOW)
  const root = createRoot(document.getElementById('app'))
  let closed = 0
  await act(async () => { root.render(React.createElement(ReviewSession, { keys: ['a'], onClose: () => { closed++ }, now: () => NOW })); await new Promise(r => setTimeout(r, 5)) })
  const open = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Abrir')
  assert.ok(open !== undefined)
  await act(async () => { open.click() })
  assert.deepEqual(opened, ['a'])
  assert.equal(closed, 1)
  await act(async () => root.unmount())
})
