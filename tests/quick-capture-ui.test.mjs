import PRODUCT from '../shared/product.json' with { type: 'json' }
// Nota rápida com o espaço bloqueado: aviso claro, botão Salvar desativado e rascunho preservado.
// (Nunca passar nós do DOM para assert: só strings/booleans.)
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
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'KeyboardEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.matchMedia = matchMedia; globalThis.matchMedia = matchMedia
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const saved = [], saves = []
let lockedState = true
dom.window.quickApi = {
  init: async () => ({ locale: 'pt-BR', theme: 'light', workspaceName: `${PRODUCT.name}`, draft: { title: 'Ideia guardada', body: 'texto do rascunho' }, prefill: null, workspaceId: 'default', locked: lockedState }),
  search: async () => [], destination: async () => null,
  saveDraft: async draft => { saved.push(JSON.stringify(draft)); return { locked: lockedState } },
  save: async input => { saves.push(input); if (lockedState) throw new Error("Error invoking remote method 'npq:save': Error: VAULT_LOCKED: Desbloqueie"); return { pageId: 'p', parentId: 'q', workspaceId: 'default' } },
  dictationStart: async () => ({ sessionId: 1 }), dictationStop: async () => {}, dictationCancel: async () => {}, onDictationEvent: () => () => {}, openPrivacySettings: async () => {},
  close: async () => {}, open: async () => {}, onShow: () => () => {},
}
globalThis.__quickTest = {
  translate: (_locale, pt, _en, vars = {}) => pt.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? '')),
  markdownToBlocks: text => text ? [{ type: 'paragraph', content: text }] : [],
  blocksPlainText: blocks => blocks.map(block => block.content).join('\n'),
}
let source = await readFile(new URL('../src/quick/QuickNote.tsx', import.meta.url), 'utf8')
source = source.replace("import { translate, type Locale } from '../localization'", 'const { translate } = globalThis.__quickTest')
  .replace("import { markdownToBlocks, blocksPlainText } from './markdown'", 'const { markdownToBlocks, blocksPlainText } = globalThis.__quickTest')
  .replace("from './voice'", `from ${JSON.stringify(new URL('../src/quick/voice.ts', import.meta.url).href)}`)
  .replace("from './tokens'", `from ${JSON.stringify(new URL('../src/quick/tokens.ts', import.meta.url).href)}`)
const compiled = await transformWithOxc(source, 'QuickNote.tsx', { jsx: { runtime: 'automatic' }, lang: 'tsx' })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const QuickNote = mod.QuickNote ?? mod.default
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test(`espaço bloqueado: mostra "Desbloqueie o ${PRODUCT.name} para salvar", desativa Salvar e mantém o rascunho`, async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => { root.render(React.createElement(QuickNote)); await wait(20) })
  const alert = [...document.querySelectorAll('[role="alert"]')].map(el => el.textContent).join(' ')
  assert.match(alert, new RegExp(`Desbloqueie o ${PRODUCT.name} para salvar`, ""))
  const saveButton = [...document.querySelectorAll('button')].find(button => /Salvar/.test(button.textContent))
  assert.equal(!!saveButton, true)
  assert.equal(saveButton.disabled, true)
  assert.equal(document.querySelector('.qn-title').value, 'Ideia guardada')
  assert.equal(document.querySelector('.qn-body').value, 'texto do rascunho')
  // ⌘↵ com o espaço bloqueado não tenta salvar a nota: só guarda o rascunho.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true })); await wait(20) })
  assert.equal(saves.length, 0)
  assert.ok(saved.some(item => item.includes('texto do rascunho')), 'draft kept')
  await act(async () => root.unmount())
})

test('botão de microfone: presente, nomeado, liga o ditado local e vira "Parar"', async () => {
  const started = []
  dom.window.quickApi.dictationStart = async input => { started.push(input.locale); return { sessionId: 1 } }
  lockedState = false
  const root = createRoot(document.getElementById('app'))
  await act(async () => { root.render(React.createElement(QuickNote)); await wait(20) })
  const mic = document.querySelector('.qn-mic')
  assert.equal(!!mic, true)
  assert.equal(mic.getAttribute('aria-label'), 'Ditar com a voz')
  assert.equal(mic.disabled, false)
  await act(async () => { mic.click(); await wait(20) })
  assert.deepEqual(started, ['pt-BR'])
  assert.equal(document.querySelector('.qn-mic').getAttribute('aria-label'), 'Parar ditado')
  assert.equal(document.querySelector('.qn-mic').getAttribute('aria-pressed'), 'true')
  await act(async () => root.unmount())
  lockedState = true
})
