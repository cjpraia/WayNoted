// Diálogo "Extrair texto" (B6a) em jsdom: prévia editável, Inserir abaixo, Copiar, progresso e Cancelar do PDF.
// Regras de memória: nunca passar nós do DOM a assert — só strings/números/booleans.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createLoader } from './fixtures/tsx-loader.mjs'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const loader = createLoader({ 'src/i18n.ts': { useI18n: () => ({ locale: 'en-US', t }), t } })
const { ExtractTextDialog } = await loader.load('src/components/page/ExtractTextDialog.tsx')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = () => document.body.textContent
const buttons = label => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
async function click(label) { const el = buttons(label)[0]; assert.ok(el, `button ${label}`); await act(async () => { el.click(); await sleep(5) }) }
async function waitFor(check, label, ms = 3000) { const start = Date.now(); while (!check()) { if (Date.now() - start > ms) assert.fail(`timeout: ${label}`); await act(async () => { await sleep(15) }) } }
async function mount(element) { const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); await act(async () => { root.render(element); await sleep(5) }); return { unmount: async () => { await act(async () => root.unmount()); host.remove() } } }
const area = () => document.querySelector('textarea')
async function type(value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setter.call(area(), value); area().dispatchEvent(new dom.window.Event('input', { bubbles: true })); await sleep(5) })
}

test('imagem: prévia editável, Inserir abaixo manda parágrafos editados e fecha; Copiar usa a área de transferência', async () => {
  const inserted = [], copied = []
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied.push(value) } } })
  let closed = 0
  const view = await mount(React.createElement(ExtractTextDialog, {
    target: { blockId: 'img1', kind: 'image', data: 'data:image/png;base64,AAAA', name: 'nota.png' }, editable: true,
    onInsert: paragraphs => inserted.push(paragraphs), onClose: () => { closed++ },
    deps: { canOcr: () => true, recognize: async () => 'NOTA FISCAL\nTotal: 10,00\n\nObrigado pela preferência.' },
  }))
  await waitFor(() => !!area() && area().value.length > 0, 'texto extraído')
  assert.match(text(), /nota\.png/); assert.match(text(), /Portuguese and English/)
  assert.equal(buttons('Insert below')[0].disabled, false)
  await type('Primeiro parágrafo\n\nSegundo, editado')
  await click('Copy'); assert.deepEqual(copied, ['Primeiro parágrafo\n\nSegundo, editado'])
  await click('Insert below')
  assert.deepEqual(inserted, [['Primeiro parágrafo', 'Segundo, editado']]); assert.equal(closed, 1)
  await view.unmount()
})

test('PDF escaneado: progresso página a página e Cancelar mantém o texto parcial', async () => {
  let release = null, rendered = 0
  const source = {
    numPages: 3, textOf: async () => '', destroy: () => {},
    renderPng: async () => { rendered++; return 'data:image/png;base64,P' },
  }
  const view = await mount(React.createElement(ExtractTextDialog, {
    target: { blockId: 'pdf1', kind: 'pdf', data: 'data:application/pdf;base64,AA', name: 'scan.pdf' }, editable: true, onInsert: () => {}, onClose: () => {},
    deps: { openPdf: async () => source, canOcr: () => true, recognize: () => new Promise(resolve => { release = text => resolve(text) }) },
  }))
  await waitFor(() => /Reading page 1 of 3 with Vision/.test(text()), 'progresso da página 1')
  assert.equal(document.querySelectorAll('[role="progressbar"]').length, 1)
  assert.equal(buttons('Insert below')[0].disabled, true, 'não insere enquanto roda')
  await act(async () => { release('Texto da página 1'); await sleep(30) })
  await waitFor(() => /Reading page 2 of 3/.test(text()), 'progresso da página 2')
  await click('Cancel') // primeiro botão "Cancel" (da barra) ou do rodapé: ambos cancelam a extração
  await act(async () => { release('Texto da página 2'); await sleep(30) })
  await waitFor(() => /Cancelled: the text from the pages already read was kept/.test(text()), 'cancelado')
  assert.equal(area().value, 'Texto da página 1\n\nTexto da página 2')
  assert.equal(rendered, 2, 'a página 3 não foi lida')
  assert.equal(buttons('Insert below')[0].disabled, false)
  await view.unmount()
})

test('página bloqueada não insere, mas copia; Vision indisponível mostra o motivo', async () => {
  const lockedView = await mount(React.createElement(ExtractTextDialog, {
    target: { blockId: 'i', kind: 'image', data: 'data:image/png;base64,AAAA' }, editable: false, onInsert: () => assert.fail('não deve inserir'), onClose: () => {},
    deps: { canOcr: () => true, recognize: async () => 'Texto' },
  }))
  await waitFor(() => !!area() && area().value === 'Texto', 'texto')
  assert.equal(buttons('Insert below')[0].disabled, true); assert.equal(buttons('Copy')[0].disabled, false)
  await lockedView.unmount()
  const noVision = await mount(React.createElement(ExtractTextDialog, {
    target: { blockId: 'i', kind: 'image', data: 'data:image/png;base64,AAAA' }, editable: true, onInsert: () => {}, onClose: () => {}, deps: { canOcr: () => false },
  }))
  await waitFor(() => /only available in the Mac app/.test(text()), 'erro')
  assert.equal(buttons('Insert below')[0].disabled, true)
  await noVision.unmount()
})
