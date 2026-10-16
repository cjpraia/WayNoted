import PRODUCT from '../shared/product.json' with { type: 'json' }
// IA na interface (jsdom): painel "Perguntar", consentimento, prévia do envio e Configurações → IA.
// Regras de memória: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createLoader } from './fixtures/tsx-loader.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// React detecta o DOM ao carregar: importar só depois de definir os globais do jsdom.
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const page = (id, extra = {}) => ({ id, parentId: null, title: 'Untitled', icon: null, trashed: false, updatedAt: Date.now(), text: '', ...extra })
const pages = {
  [P(1)]: page(P(1), { title: 'Projeto Atlas' }),
  [P(2)]: page(P(2), { title: 'Diário', passwordLock: { rootId: P(2), hideTitle: false, unlocked: true } }),
  [P(3)]: page(P(3), { title: 'Antigo', trashed: true }),
  [P(4)]: page(P(4), { title: 'Receitas' }),
}
const docs = {
  [P(1)]: [{ id: 'h1', type: 'heading', props: { level: 2 }, content: 'Decisões' }, { id: 'b1', type: 'paragraph', content: 'Decidimos usar SQLite para o cache local do projeto.' }],
  [P(2)]: [{ id: 'x', type: 'paragraph', content: 'SQLite PROTECTED-SECRET no diário.' }],
  [P(3)]: [{ id: 'y', type: 'paragraph', content: 'SQLite TRASHED-SECRET antigo.' }],
  [P(4)]: [{ id: 'z', type: 'paragraph', content: 'Bolo de cenoura com cobertura.' }],
}
const calls = { openPage: [], append: [] }
const state = { ready: true, pages, route: { type: 'page', id: P(4) }, settings: { locale: 'en-US' } }
const ancestry = (id, all) => { const chain = []; let p = all[id]; while (p) { if (p.trashed || chain.includes(p.id)) return null; chain.push(p.id); p = p.parentId ? all[p.parentId] : undefined } return chain }
const loader = createLoader({
  'src/store.ts': {
    actions: { openPage: (id, options) => calls.openPage.push({ id, blockId: options?.blockId ?? '' }), appendPageBlocks: async (id, blocks) => calls.append.push({ id, text: blocks.map(b => b.content?.[0]?.text ?? '').join('\n') }), flushAll: async () => {}, flushMeta: async () => {}, setProp: () => {} },
    getState: () => state, useStore: () => state, subscribe: () => () => {}, loadDocForIndex: async id => docs[id] ?? [],
    api: { loadDoc: async id => docs[id] ?? [] },
    selectors: { page: id => pages[id], isLive: () => true, database: () => null },
  },
  'src/i18n.ts': { useI18n: () => ({ locale: 'en-US', t }), t },
  'src/components/modals/search.mts': { ancestry, propertySearchText: () => '' },
})
const { setAIBridge } = await loader.load('src/ai/bridge.ts')
const { setAISettings } = await loader.load('src/ai/settingsStore.ts')
const { runAI } = await loader.load('src/ai/client.ts')
const { AskPanel } = await loader.load('src/components/ai/AskPanel.tsx')
const { AIPromptsHost } = await loader.load('src/components/ai/AIPromptsHost.tsx')
const { AISettingsSection } = await loader.load('src/components/ai/AISettings.tsx')
const { openAskPanel } = await loader.load('src/ai/panel.ts')
const indexRunner = await loader.load('src/ai/indexRunner.ts')

const KEY = 'sk-or-v1-UI-SECRET-0000abcd'
function settings(extra = {}) {
  return { activeProvider: 'ollama', models: { ollama: 'llama3.2:3b', openrouter: 'openai/gpt-4o-mini', google: '' }, embeddingModel: 'nomic-embed-text', embeddingBackend: 'auto', temperature: 0.3, maxTokens: 1024, featureProviders: { assistant: '', ask: '', blocks: '' }, ollamaEndpoint: 'http://127.0.0.1:11434', blockCloud: false, consent: { openrouter: null, google: null }, confirmEachSend: { openrouter: true, google: true }, redact: false, openrouterAttribution: false, askTopK: 6, keys: { openrouter: { configured: true, last4: 'abcd' }, google: { configured: false } }, usage: { [new Date().toISOString().slice(0, 7)]: { openrouter: { requests: 3, promptTokens: 1200, completionTokens: 300, estimated: true } } }, ...extra }
}
function fakeBridge(overrides = {}) {
  const listeners = new Set()
  const log = { prepare: [], run: [], cancel: [], consent: [], update: [], setKey: [] }
  let current = settings()
  const bridge = {
    log, listeners,
    aiGetSettings: async () => current,
    aiUpdateSettings: async patch => { log.update.push(patch); current = { ...current, ...patch, models: { ...current.models, ...patch.models }, featureProviders: { ...current.featureProviders, ...patch.featureProviders }, confirmEachSend: { ...current.confirmEachSend, ...patch.confirmEachSend } }; return current },
    aiSetKey: async (provider, key) => { log.setKey.push({ provider, length: key.length }); return current },
    aiRemoveKey: async () => current,
    aiConsent: async (provider, granted) => { log.consent.push({ provider, granted }); current = { ...current, consent: { ...current.consent, [provider]: granted ? { grantedAt: 1, version: 1 } : null } }; return current },
    aiStatus: async () => ({ ollama: { state: 'offline' }, openrouter: { state: 'no-consent' }, google: { state: 'no-key' } }),
    aiListModels: async () => [{ id: 'llama3.2:3b', name: 'llama3.2:3b' }],
    aiTest: async () => ({ ok: true }),
    aiPrepare: async input => { log.prepare.push(input); return { requestId: `r${log.prepare.length}`, provider: 'ollama', cloud: false, model: 'llama3.2:3b', messages: [{ role: 'user', content: input.prompt }], tokens: 42, needsConfirmation: false, excluded: 0, redacted: false, sources: input.sources.length, keptIndexes: input.sources.map((_, i) => i) } },
    aiRun: async (requestId, options) => { log.run.push({ requestId, confirmed: !!options?.confirmed }); for (const piece of ['Usamos ', 'SQLite ', '[1].']) listeners.forEach(l => l({ requestId, type: 'delta', text: piece })); return { text: 'Usamos SQLite [1].', usage: { promptTokens: 1, completionTokens: 1, estimated: true }, provider: 'ollama', model: 'llama3.2:3b' } },
    aiCancel: async requestId => { log.cancel.push(requestId ?? '') },
    aiEmbed: async () => { throw new Error('AI_OFFLINE') },
    aiLoadIndex: async () => null, aiSaveIndex: async () => {}, aiLoadChats: async () => null, aiSaveChats: async () => {},
    onAIEvent: handler => { listeners.add(handler); return () => listeners.delete(handler) },
    ...overrides,
  }
  return bridge
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = () => document.body.textContent
const buttons = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
async function click(label) { const el = buttons(label)[0]; assert.ok(el, `button ${label}`); await act(async () => { el.click(); await sleep(5) }) }
async function waitFor(check, label, ms = 3000) { const start = Date.now(); while (!check()) { if (Date.now() - start > ms) assert.fail(`timeout: ${label}`); await act(async () => { await sleep(20) }) } }
async function mount(element) { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); await act(async () => { root.render(element); await sleep(5) }); return { unmount: async () => { await act(async () => root.unmount()); host.remove() } } }
async function typeInto(selector, value) {
  const el = document.querySelector(selector)
  assert.ok(el, selector)
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => { (el.tagName === 'TEXTAREA' ? setter : Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set).call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
}

test('Ask panel retrieves locally, never sends protected/trashed pages, streams and renders clickable citations', async () => {
  const bridge = fakeBridge()
  setAIBridge(bridge); setAISettings(settings())
  const view = await mount(React.createElement(React.Fragment, null, React.createElement(AskPanel), React.createElement(AIPromptsHost)))
  await waitFor(() => /\d+ excerpts/.test(text()) && !/Indexing/.test(text()), 'index built')
  assert.match(text(), /words only|word search/)
  assert.match(text(), /Local/) // indicador permanente
  await typeInto('.ai-composer textarea', 'O que decidimos sobre o SQLite?')
  await click('Ask')
  await waitFor(() => bridge.log.run.length === 1 && !document.querySelector('.ai-typing'), 'answer')
  const sent = JSON.stringify(bridge.log.prepare[0])
  assert.equal(bridge.log.prepare[0].feature, 'ask'); assert.equal(bridge.log.prepare[0].operation, 'notes')
  assert.match(sent, /Decidimos usar SQLite/)
  assert.equal(sent.includes('PROTECTED-SECRET') || sent.includes('TRASHED-SECRET') || sent.includes('Bolo de cenoura'), false)
  const cite = [...document.querySelectorAll('.ai-cite')]
  assert.equal(cite.length, 1); assert.match(cite[0].getAttribute('aria-label'), /Projeto Atlas/)
  await act(async () => { cite[0].click() })
  assert.deepEqual(calls.openPage.at(-1), { id: P(1), blockId: 'b1' })
  assert.match(text(), /Projeto Atlas › Decisões/)
  await click('Insert in current page')
  assert.equal(calls.append.at(-1).id, P(4)); assert.match(calls.append.at(-1).text, /Usamos SQLite \[1\]\./); assert.match(calls.append.at(-1).text, /Sources: \[1\] Projeto Atlas/)
  // Sem trechos relevantes: responde sem chamar o modelo.
  await typeInto('.ai-composer textarea', 'xyzzy quux inexistente')
  await click('Ask')
  await waitFor(() => /did not find anything in your notes/.test(text()), 'no results')
  assert.equal(bridge.log.prepare.length, 1)
  await view.unmount()
})

test('Stop cancels a streaming answer', async () => {
  let release
  const bridge = fakeBridge({ aiRun: (requestId) => new Promise((resolve, reject) => { bridge.listeners.forEach(l => l({ requestId, type: 'delta', text: 'parcial ' })); release = () => reject(new Error('AI_CANCELLED')) }) })
  bridge.aiCancel = async id => { bridge.log.cancel.push(id); release?.() }
  setAIBridge(bridge); setAISettings(settings())
  const view = await mount(React.createElement(AskPanel))
  await waitFor(() => /\d+ excerpts/.test(text()) && !/Indexing/.test(text()), 'index')
  await typeInto('.ai-composer textarea', 'SQLite cache')
  await click('Ask')
  await waitFor(() => buttons('Stop').length === 1 && /parcial/.test(text()), 'streaming')
  await click('Stop')
  await waitFor(() => buttons('Stop').length === 0, 'stopped')
  assert.equal(bridge.log.cancel.length >= 1, true)
  assert.match(text(), /Request cancelled/)
  assert.match(text(), /parcial/)
  await view.unmount()
})

test('first cloud use asks for explicit consent with the exact statement; each send shows the preview with tokens and Send/Cancel', async () => {
  let consentGiven = false
  const bridge = fakeBridge({
    aiPrepare: async input => {
      bridge.log.prepare.push(input)
      if (!consentGiven) throw new Error("Error invoking remote method 'np:aiPrepare': Error: AI_CONSENT_REQUIRED|detail=openrouter")
      return { requestId: `c${bridge.log.prepare.length}`, provider: 'openrouter', cloud: true, model: 'openai/gpt-4o-mini', messages: [{ role: 'system', content: 'SYSTEM-TEXT' }, { role: 'user', content: 'Question: Q\n<excerpts>[1] EXCERPT-TEXT</excerpts>' }], tokens: 42, needsConfirmation: true, excluded: 2, redacted: true, sources: 1, keptIndexes: [0] }
    },
  })
  bridge.aiConsent = async (provider, granted) => { bridge.log.consent.push({ provider, granted }); consentGiven = granted; return settings() }
  setAIBridge(bridge)
  const view = await mount(React.createElement(AIPromptsHost))
  const input = { feature: 'ask', operation: 'notes', prompt: 'Q', sources: [{ pageId: P(1), text: 'EXCERPT-TEXT' }], locale: 'en-US' }
  let outcome = null
  const first = runAI(input).then(() => { outcome = 'sent' }, error => { outcome = error.message })
  await waitFor(() => /Use OpenRouter\?/.test(text()), 'consent dialog')
  assert.match(text(), new RegExp(`The selected text\\/excerpts from your notes and your question will be sent to OpenRouter; its policy applies; ${PRODUCT.name} sends nothing else\\.`, ""))
  await click('Authorize OpenRouter')
  assert.deepEqual(bridge.log.consent, [{ provider: 'openrouter', granted: true }])
  await waitFor(() => /Send to OpenRouter\?/.test(text()), 'preview dialog')
  assert.match(text(), /≈ 42 tokens/); assert.match(text(), /EXCERPT-TEXT/); assert.match(text(), /SYSTEM-TEXT/); assert.match(text(), /2 excerpt\(s\) excluded/); assert.match(text(), /phones and long numbers hidden/)
  await click('Cancel')
  await first
  assert.equal(outcome, 'AI_CANCELLED'); assert.equal(bridge.log.run.length, 0); assert.equal(bridge.log.cancel.at(-1), 'c2')
  const second = runAI(input).then(result => { outcome = result.text })
  await waitFor(() => /Send to OpenRouter\?/.test(text()), 'preview again')
  await click('Send')
  await second
  assert.equal(outcome, 'Usamos SQLite [1].'); assert.deepEqual(bridge.log.run.at(-1), { requestId: 'c3', confirmed: true })
  await view.unmount()
  // Sem o host de diálogos montado, nada que precise de confirmação sai.
  const lone = runAI(input).then(() => 'sent', error => error.message)
  assert.equal(await lone, 'AI_CANCELLED')
})

test('Settings → AI shows status, masks the key, blocks cloud and asks consent before choosing a cloud provider', async () => {
  const bridge = fakeBridge()
  setAIBridge(bridge); setAISettings(settings())
  const view = await mount(React.createElement(React.Fragment, null, React.createElement(AISettingsSection), React.createElement(AIPromptsHost)))
  await waitFor(() => /Offline/.test(text()), 'status')
  assert.match(text(), /Awaiting authorization/); assert.match(text(), /No key/)
  assert.match(text(), /saved ••••abcd/)
  assert.equal(text().includes(KEY), false)
  assert.match(text(), /Install it from ollama\.com/)
  assert.match(text(), /1,200/) // contador de uso local
  const keyInput = document.querySelector('input[type=password]')
  await typeInto('input[type=password]', KEY)
  await click('Save key')
  assert.deepEqual(bridge.log.setKey, [{ provider: 'openrouter', length: KEY.length }])
  assert.equal(keyInput.value, '')
  const block = [...document.querySelectorAll('input[type=checkbox]')][0]
  await act(async () => { block.click(); await sleep(5) })
  assert.equal(bridge.log.update.some(patch => patch.blockCloud === true), true)
  await act(async () => { block.click(); await sleep(5) })
  const radios = [...document.querySelectorAll('input[name=ai-provider]')]
  await act(async () => { radios[1].click(); await sleep(5) })
  await waitFor(() => /Use OpenRouter\?/.test(text()), 'consent before choosing')
  await click('Cancel')
  assert.equal(bridge.log.update.some(patch => patch.activeProvider === 'openrouter'), false)
  await act(async () => { radios[1].click(); await sleep(5) })
  await waitFor(() => /Use OpenRouter\?/.test(text()), 'consent again')
  await click('Authorize OpenRouter')
  await waitFor(() => bridge.log.update.some(patch => patch.activeProvider === 'openrouter'), 'provider switched')
  await view.unmount()
})

test('panel scope "this selection" is offered when text is selected', async () => {
  setAIBridge(fakeBridge()); setAISettings(settings())
  const host = document.createElement('div'); host.dataset.pageId = P(1); host.textContent = 'Decidimos usar SQLite'; document.body.appendChild(host)
  const range = document.createRange(); range.selectNodeContents(host); window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
  openAskPanel()
  const view = await mount(React.createElement(AskPanel))
  const select = document.querySelector('.ai-panel-tools button.np-select')
  assert.equal(select.textContent, 'This selection')
  await view.unmount(); host.remove()
})

test('Settings → AI → Embeddings (A3b): shows the engine in use, offers the Apple download only when missing, and never downloads by itself', async () => {
  const calls = []
  let downloaded = false
  const missing = { mode: 'auto', backend: 'none', model: '', ollama: { available: false }, apple: { available: false, reason: 'ASSETS_MISSING' } }
  const ready = { mode: 'auto', backend: 'apple', model: 'apple-nl-contextual', ollama: { available: false }, apple: { available: true, dimension: 512 } }
  const bridge = fakeBridge({ aiEmbedStatus: async options => { calls.push(options?.download === true); if (options?.download) downloaded = true; return downloaded ? ready : missing } })
  setAIBridge(bridge); setAISettings(settings())
  const view = await mount(React.createElement(AISettingsSection))
  await waitFor(() => document.querySelector('[data-testid="ai-embed-state"]')?.textContent.includes('Apple language resources are not downloaded'), 'status shown')
  assert.deepEqual(calls, [false], 'only a status check at open')
  assert.match(text(), /Embeddings \(local semantic search\)/); assert.match(text(), /no text leaves it/)
  await click('Download Apple resources')
  await waitFor(() => /In use: Apple embeddings/.test(text()), 'ready after download')
  assert.deepEqual(calls.slice(0, 2), [false, true]); assert.equal(buttons('Download Apple resources').length, 0)
  await view.unmount()
})

test('Index (A3b): Ollama -> Apple -> words; Apple batches are small, protected/trashed pages stay out, switching engines drops old vectors, and the saved index is keyed by engine', async () => {
  const texts = [], saved = []
  const status = { current: { mode: 'auto', backend: 'apple', model: 'apple-nl-contextual', ollama: { available: false }, apple: { available: true, dimension: 4 } } }
  // Vetor determinístico por texto: 4 dimensões a partir de hashes simples.
  const embed = text => [1, 0, 0, 0].map((_, i) => ((text.length * (i + 3)) % 7) + 1)
  const bridge = fakeBridge({ aiEmbedStatus: async () => status.current, aiEmbed: async batch => { texts.push(batch); return batch.map(embed) }, aiSaveIndex: async data => { saved.push(data) } })
  setAIBridge(bridge); setAISettings(settings())
  await indexRunner.refreshEmbeddingBackend()
  await waitFor(() => indexRunner.askIndexProgress().semantic === 'on' && indexRunner.askIndexProgress().embedded > 0 && indexRunner.askIndexProgress().embedded === indexRunner.askIndexProgress().chunks, 'apple embeddings done', 8000)
  assert.equal(indexRunner.askIndexProgress().backend, 'apple')
  assert.ok(texts.length >= 1 && texts.every(batch => batch.length <= 8), 'lotes pequenos para o Apple')
  const sent = JSON.stringify(texts)
  assert.equal(sent.includes('PROTECTED-SECRET') || sent.includes('TRASHED-SECRET'), false)
  assert.match(sent, /Decidimos usar SQLite/)
  // A busca pede o vetor da pergunta ao mesmo motor e usa a centralização do Apple.
  const hits = await indexRunner.searchNotes('cache local', { k: 3 })
  assert.ok(hits.length >= 1); assert.equal(texts.at(-1)[0], 'cache local')
  await waitFor(() => saved.length > 0, 'índice salvo', 6000)
  assert.equal(saved.at(-1).embeddingModel, 'apple:apple-nl-contextual')
  // Trocar para o Ollama (outro motor): vetores antigos saem e tudo é reembutido.
  status.current = { mode: 'ollama', backend: 'ollama', model: 'nomic-embed-text', ollama: { available: true }, apple: { available: false, reason: 'DISABLED' } }
  const before = texts.length
  await indexRunner.refreshEmbeddingBackend()
  await waitFor(() => indexRunner.askIndexProgress().backend === 'ollama' && texts.length > before && indexRunner.askIndexProgress().embedded === indexRunner.askIndexProgress().chunks, 'reembed with ollama', 8000)
  assert.ok(texts.slice(before).some(batch => batch.length > 8 || batch.length >= 1))
  // Sem nenhum motor: só palavras, sem pedir vetores.
  status.current = { mode: 'off', backend: 'none', model: '', ollama: { available: false }, apple: { available: false, reason: 'DISABLED' } }
  const calls = texts.length
  await indexRunner.refreshEmbeddingBackend()
  await waitFor(() => indexRunner.askIndexProgress().semantic === 'unavailable', 'words only')
  assert.equal(texts.length, calls)
  assert.equal((await indexRunner.searchNotes('SQLite', { k: 3 })).length >= 1, true, 'léxico segue funcionando')
  assert.equal(texts.length, calls, 'nenhum vetor de pergunta é pedido sem motor')
})
