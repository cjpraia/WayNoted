// Mini calendário do painel do fluxo diário (jsdom). Regras: nunca comparar nós do DOM em asserts.
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
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__miniTest = { t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')) }

let source = await readFile(new URL('../src/daily/MiniMonth.tsx', import.meta.url), 'utf8')
source = source.replace("import { t } from '../i18n'", 'const { t } = globalThis.__miniTest')
  .replace("import { hasTaskDrag } from '../tasks/taskDrag'", 'const hasTaskDrag = () => false')
  .replace("from './dailyCore'", `from ${JSON.stringify(new URL('../src/daily/dailyCore.ts', import.meta.url).href)}`)
const compiled = await transformWithOxc(shimUi(source), 'MiniMonth.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { MiniMonth } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('mini calendário: semana no domingo ou segunda, hoje destacado, pontos e navegação', async () => {
  const picks = [], months = []
  const marks = (day) => day === '2026-10-07' ? { note: true, tasks: 2, overdue: false, events: 1 } : day === '2026-10-05' ? { note: false, tasks: 1, overdue: true, events: 0 } : undefined
  const root = createRoot(document.getElementById('app'))
  const render = (weekStart) => act(async () => root.render(React.createElement(MiniMonth, { year: 2026, month: 10, selected: '2026-10-12', today: '2026-10-07', weekStart, locale: 'pt-BR', marks, onPick: d => picks.push(d), onMonth: (y, m) => months.push(`${y}-${m}`) })))
  await render(0)
  const cells = () => [...document.querySelectorAll('[data-dl-day]')]
  assert.equal(cells().length, 42)
  assert.equal(cells()[0].getAttribute('data-dl-day'), '2026-09-27', 'começa no domingo')
  assert.equal(document.querySelector('.dl-month-title').textContent, 'Outubro de 2026')
  const today = document.querySelector('.dl-day.is-today')
  assert.equal(today.getAttribute('data-dl-day'), '2026-10-07')
  assert.equal(today.getAttribute('aria-current'), 'date')
  assert.equal(today.querySelectorAll('.dl-dot').length, 3, 'nota + tarefas + eventos')
  assert.match(today.getAttribute('aria-label'), /nota diária · 2 tarefas · 1 eventos/)
  assert.equal(document.querySelectorAll('.dl-dot.is-overdue').length, 1)
  assert.equal(document.querySelector('.dl-day.is-selected').getAttribute('data-dl-day'), '2026-10-12')
  assert.equal(document.querySelectorAll('.dl-day.is-out').length, 42 - 31)
  await act(async () => { cells()[10].click() })
  assert.deepEqual(picks, ['2026-10-07'])
  await act(async () => { document.querySelector('[aria-label="Mês anterior"]').click() })
  await act(async () => { document.querySelector('[aria-label="Próximo mês"]').click() })
  assert.deepEqual(months, ['2026-9', '2026-11'])
  // Setas do teclado movem a seleção.
  await act(async () => { document.querySelector('.dl-day.is-selected').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
  assert.equal(picks.at(-1), '2026-10-19')
  await render(1)
  assert.equal(cells()[0].getAttribute('data-dl-day'), '2026-09-28', 'começa na segunda')
  assert.equal(document.querySelector('.dl-wd').textContent.toUpperCase(), 'S')
  await act(async () => root.unmount())
})
