// Diálogo "Tarefas por voz" (jsdom): gravar → prévia "Tarefas encontradas" editável → criar só o que está marcado.
// Nunca comparar nós do DOM em asserts (comparar strings/números/booleanos).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi } from './fixtures/ui-shim.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// React detecta o DOM ao carregar: importar só depois de definir os globais do jsdom.
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')
window.api = { dictationStart: async () => ({ sessionId: 1 }), openPrivacySettings: async () => {} }

const created = []
const toasts = []
let captureText = 'ligar para o João amanhã às 10 e depois comprar pão urgente'
let aiItems = null
const fakeCapture = onChange => {
  let phase = 'idle'
  const emit = (patch = {}) => onChange({ phase, level: 0.5, text: captureText, ...patch })
  return {
    snapshot: () => ({ phase, level: 0, text: captureText }),
    async start() { phase = 'listening'; emit() },
    async stop() { phase = 'idle'; emit(); return captureText },
    async cancel() {},
  }
}
globalThis.__vt = {
  useI18n: () => ({ locale: 'pt-BR', t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')) }),
  selectors: { isLive: () => true },
  useStore: () => ({ pages: { p1: { id: 'p1', title: 'Casa', updatedAt: 2 }, p2: { id: 'p2', title: 'Trabalho', updatedAt: 1 } } }),
  useModalFocus: () => {},
  Textarea: props => React.createElement('textarea', props),
  isDictating: () => false,
  showToast: toast => toasts.push(toast.message),
  createVoiceCapture: (_native, _lang, onChange) => fakeCapture(onChange),
  localAiReady: async () => aiItems !== null,
  splitWithLocalAi: async () => aiItems,
  createVoiceTasks: async (tasks, destination) => { created.push({ tasks: tasks.filter(task => task.include).map(task => [task.title, task.date, task.time, task.priority]), destination }); return { created: tasks.filter(task => task.include).length } },
  destinationProblem: () => null,
  taskDatabases: () => [{ id: 'db1', title: 'Projetos' }],
}
const href = path => JSON.stringify(new URL(path, import.meta.url).href)
let source = await readFile(new URL('../src/voice/VoiceTasksDialog.tsx', import.meta.url), 'utf8')
source = source
  .replace(/import \{ selectors, useStore \} from '\.\.\/store'/, 'const { selectors, useStore } = globalThis.__vt')
  .replace(/import \{ useI18n \} from '\.\.\/i18n'/, 'const { useI18n } = globalThis.__vt')
  .replace(/import \{ useModalFocus \} from '[^']*'/, 'const { useModalFocus } = globalThis.__vt')
  .replace(/import \{ Textarea \} from '[^']*'/, 'const { Textarea } = globalThis.__vt')
  .replace(/import \{ isDictating \} from '[^']*'/, 'const { isDictating } = globalThis.__vt')
  .replace(/import \{ showToast \} from '[^']*'/, 'const { showToast } = globalThis.__vt')
  .replace(/import \{ createVoiceCapture, type VoiceCapture, type VoiceSnapshot \} from '\.\/voiceCapture'/, 'const { createVoiceCapture } = globalThis.__vt')
  .replace(/import \{ extractVoiceTasks, itemsToVoiceTasks, type VoicePriority, type VoiceTask \} from '\.\/taskExtract'/, `import { extractVoiceTasks, itemsToVoiceTasks } from ${href('../src/voice/taskExtract.ts')}`)
  .replace(/import \{ localAiReady, splitWithLocalAi \} from '\.\/aiSplit'/, 'const { localAiReady, splitWithLocalAi } = globalThis.__vt')
  .replace(/import \{ createVoiceTasks, destinationProblem, taskDatabases, type VoiceDestination \} from '\.\/voiceTasksActions'/, 'const { createVoiceTasks, destinationProblem, taskDatabases } = globalThis.__vt')
  .replace(/import '\.\/voice\.css'/, '')
const compiled = await transformWithOxc(shimUi(source), 'VoiceTasksDialog.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { VoiceTasksDialog } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const click = async label => { const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label); assert.ok(el !== undefined, label); await act(async () => { el.click(); await new Promise(r => setTimeout(r, 5)) }) }
const setValue = async (el, value) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}

test('grava, mostra as tarefas encontradas, permite editar/desmarcar e cria só as marcadas no destino escolhido', async () => {
  const root = createRoot(document.getElementById('app'))
  let closed = 0
  await act(async () => root.render(React.createElement(VoiceTasksDialog, { onClose: () => { closed++ } })))
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), 'Tarefas por voz')
  assert.ok(document.querySelector('#vt-found') === null, 'nada de prévia antes de gravar')
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Encontrar tarefas').disabled, true, 'sem texto não há o que analisar')
  await click('Gravar')
  await click('Parar')
  assert.equal(document.querySelector('textarea').value, captureText)
  const titles = () => [...document.querySelectorAll('.vt-title')].map(el => el.value)
  assert.deepEqual(titles(), ['Ligar para o João', 'Comprar pão'])
  assert.equal(document.querySelectorAll('.vt-date')[0].value.length, 10, 'data preenchida')
  assert.equal(document.querySelectorAll('.vt-time')[0].value, '10:00')
  assert.equal(document.querySelectorAll('select')[1].value, 'high', 'prioridade alta detectada em “urgente”')
  // Edita o título da segunda, desmarca a primeira.
  await setValue(document.querySelectorAll('.vt-title')[1], 'Comprar pão integral')
  await act(async () => { document.querySelectorAll('.vt-task input[type="checkbox"]')[0].click() })
  const confirm = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Criar'))
  assert.equal(confirm.textContent, 'Criar 1 tarefas')
  const destination = [...document.querySelectorAll('select')].at(-1)
  assert.deepEqual([...destination.options].map(option => option.value), ['daily', 'db:db1', 'page:p1', 'page:p2'])
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElementProto(), 'value').set.call(destination, 'db:db1'); destination.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { confirm.click(); await new Promise(r => setTimeout(r, 5)) })
  assert.equal(created.length, 1)
  assert.deepEqual(created[0].tasks, [['Comprar pão integral', null, null, 'high']])
  assert.deepEqual(created[0].destination, { kind: 'database', databaseId: 'db1' })
  assert.deepEqual(toasts, ['1 tarefas criadas.'])
  assert.equal(closed, 1)
  await act(async () => root.unmount())
})

function HTMLSelectElementProto() { return dom.window.HTMLSelectElement.prototype }

test('sem texto não há prévia; texto digitado vira tarefas; IA local usada só quando marcada', async () => {
  aiItems = ['Enviar relatório amanhã', 'Marcar consulta']
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(VoiceTasksDialog, { onClose() {} })))
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  const find = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Encontrar tarefas')
  assert.equal(find.disabled, true)
  await setValue(document.querySelector('textarea'), 'revisar contrato. pagar aluguel')
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Encontrar tarefas').disabled, false)
  await click('Encontrar tarefas')
  assert.deepEqual([...document.querySelectorAll('.vt-title')].map(el => el.value), ['Revisar contrato', 'Pagar aluguel'], 'heurística por padrão')
  const ai = [...document.querySelectorAll('label.vt-ai input')][0]
  assert.ok(ai !== undefined, 'opção de IA local disponível')
  await act(async () => { ai.click() })
  await click('Reanalisar')
  assert.deepEqual([...document.querySelectorAll('.vt-title')].map(el => el.value), ['Enviar relatório', 'Marcar consulta'])
  await act(async () => root.unmount())
})
