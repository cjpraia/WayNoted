// Assistente de IA da página (LocalAIModal) sobre a camada nova (src/ai, docs/AI.md §6).
// Regras de memória: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createLoader } from './fixtures/tsx-loader.mjs'
import * as uiShim from './fixtures/ui-shim.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')

let prepared = [], writes = [], properties = [], fail = false, cancels = 0
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const loader = createLoader({
  'src/store.ts': {
    getState: () => ({ pages: {} }), useStore: () => ({}),
    actions: { flushAll: async () => {}, flushMeta: async () => {}, setProp: (id, prop, value) => properties.push({ id, prop, value }), appendPageBlocks: async (id, blocks) => writes.push({ id, blocks }) },
    api: { loadDoc: async () => [{ content: 'private local context' }] },
    selectors: { isLive: () => true, page: () => ({ title: 'Page', locked: false, parentId: 'db' }), database: () => ({ properties: [{ id: 'summary', name: 'Summary', type: 'text' }] }) },
  },
  'src/i18n.ts': { useI18n: () => ({ locale: 'en-US', t }), t },
  'src/components/page/util.ts': { blocksToText: blocks => blocks.map(b => b.content).join('\n') },
  'src/components/ui/Select.tsx': { Select: uiShim.Select },
  'src/components/ui/Button.tsx': { Button: uiShim.Button, IconButton: uiShim.IconButton },
  'src/components/modals/search.mts': { propertySearchText: () => 'Summary: existing row value' },
})
const { setAIBridge } = await loader.load('src/ai/bridge.ts')
const { setAISettings } = await loader.load('src/ai/settingsStore.ts')
const { LocalAIModal } = await loader.load('src/components/modals/LocalAIModal.tsx')
const settings = { activeProvider: 'ollama', models: { ollama: '', openrouter: '', google: '' }, featureProviders: { assistant: '', ask: '', blocks: '' }, consent: { openrouter: null, google: null }, keys: { openrouter: { configured: false }, google: { configured: false } }, usage: {}, confirmEachSend: { openrouter: true, google: true } }
const listeners = new Set()
setAIBridge({
  aiGetSettings: async () => settings,
  aiListModels: async () => { if (fail) throw new Error('AI_OFFLINE'); return [{ id: 'local-model', name: 'local-model' }] },
  aiPrepare: async input => { prepared.push(input); return { requestId: 'r', provider: 'ollama', cloud: false, model: input.model, messages: [], tokens: 1, needsConfirmation: false, excluded: 0, redacted: false, sources: input.sources.length, keptIndexes: [] } },
  aiRun: async requestId => { listeners.forEach(l => l({ requestId, type: 'delta', text: '<script>' })); return { text: '<script>not executed</script>\n\nSecond paragraph', usage: {}, provider: 'ollama', model: 'local-model' } },
  aiCancel: async () => { cancels++ },
  onAIEvent: handler => { listeners.add(handler); return () => listeners.delete(handler) },
})
setAISettings(settings)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const click = async label => { const el = [...document.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(el, label); await act(async () => { el.click(); await sleep(10) }) }
const mount = async () => { const root = createRoot(document.getElementById('app')); await act(async () => { root.render(React.createElement(LocalAIModal, { pageId: 'page', onClose: () => {} })); await sleep(20) }); return root }

test('local generation only previews; inserting is explicit and treats generated markup as text', async () => {
  const root = await mount(); assert.equal(prepared.length, 0); assert.equal(writes.length, 0)
  assert.match(document.body.textContent, /Local/)
  await click('Generate preview'); assert.equal(prepared.length, 1)
  assert.equal(prepared[0].feature, 'assistant'); assert.equal(prepared[0].model, 'local-model')
  assert.match(prepared[0].sources[0].text, /private local context/); assert.match(prepared[0].sources[0].text, /existing row value/); assert.equal(prepared[0].sources[0].pageId, 'page')
  assert.equal(writes.length, 0)
  assert.equal(document.querySelectorAll('script').length, 0)
  await click('Add to page'); assert.equal(writes.length, 1); assert.equal(writes[0].blocks.length, 2); assert.equal(writes[0].blocks[0].type, 'paragraph'); assert.equal(writes[0].blocks[0].content[0].text, '<script>not executed</script>')
  await act(async () => root.unmount())
})

test('missing runtime produces an actionable error and cannot generate or persist content', async () => {
  fail = true; const before = prepared.length; const root = await mount()
  assert.match(document.querySelector('[role="alert"]').textContent, /Ollama/)
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === 'Generate preview').disabled, true)
  assert.equal(prepared.length, before); await act(async () => root.unmount()); fail = false
})

test('AI autofill applies a reviewed result to the selected text property only after explicit confirmation', async () => {
  const root = await mount()
  await act(async () => { const select = document.querySelectorAll('select')[1]; select.value = 'autofill'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await act(async () => { const select = document.querySelectorAll('select')[2]; select.value = 'summary'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click('Generate preview'); assert.equal(properties.length, 0)
  assert.equal(prepared.at(-1).operation, 'autofill')
  await click('Apply to property'); assert.equal(properties.length, 1); assert.equal(properties[0].prop, 'summary'); assert.match(properties[0].value, /Second paragraph/)
  const before = cancels; await act(async () => root.unmount()); assert.equal(cancels, before + 1)
})
