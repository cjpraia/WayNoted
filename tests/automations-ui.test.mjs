// Editor de automações (jsdom): gatilhos novos, condições, ações novas, "Testar" com prévia e registro.
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
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'HTMLSelectElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')

let schema = {
  properties: [
    { id: 'title', name: 'Nome', type: 'title' },
    { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] },
    { id: 'dt', name: 'Data', type: 'date' },
  ],
  automations: [{ id: 'a1', name: 'Regra', enabled: false, trigger: { kind: 'propertyChange', propertyId: 'st' }, actions: [{ kind: 'notify', message: 'Oi {titulo}' }], conditions: [{ propertyId: '@title', op: 'contains', value: 'contrato' }] }],
}
const logged = []
let render = () => {}
const pages = { db: { id: 'db', title: 'Projetos', database: schema }, r1: { id: 'r1', title: 'Contrato Acme', parentId: 'db', props: {} }, r2: { id: 'r2', title: 'Outra coisa', parentId: 'db', props: {} } }
globalThis.__am = {
  t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')),
  useStore: () => ({}),
  getState: () => ({ pages, settings: { locale: 'pt-BR', objectTypes: [{ id: 'ty', name: 'Urgente' }] } }),
  selectors: { rows: () => [pages.r1, pages.r2], isLive: () => true },
  actions: {
    updateSchema: (_id, fn) => { schema = fn(schema); render() },
    logAutomation: (_id, entry) => { logged.push(entry); schema = { ...schema, automationLog: [{ at: 1, ...entry }, ...(schema.automationLog ?? [])] }; render() },
  },
}
const href = path => JSON.stringify(new URL(path, import.meta.url).href)
let source = await readFile(new URL('../src/components/database/AutomationsEditor.tsx', import.meta.url), 'utf8')
source = source
  .replace(/import \{ actions, getState, selectors, useStore \} from '\.\.\/\.\.\/store'/, 'const { actions, getState, selectors, useStore } = globalThis.__am')
  .replace(/import \{ t \} from '\.\.\/\.\.\/i18n'/, 'const { t } = globalThis.__am')
  .replace(/import \{ Toggle \} from '[^']*'/, "const Toggle = ({ label, checked, onChange }) => React.createElement('label', null, label, React.createElement('input', { type: 'checkbox', role: 'switch', checked, onChange: event => onChange(event.target.checked) }))")
  .replace(/import \{ describeTrigger, previewAutomation, type AutomationPreview, type DescribeContext \} from '\.\/automations'/, `import { describeTrigger, previewAutomation } from ${href('../src/components/database/automations.ts')}`)
  .replace(/import '\.\/automations\.css'/, '')
  .replace(/^import \{ Plus, Trash2 \}/m, "import React from 'react'\nimport { Plus, Trash2 }")
const compiled = await transformWithOxc(shimUi(source), 'AutomationsEditor.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { AutomationsEditor } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const select = label => document.querySelector(`select[aria-label="${label}"]`)
const choose = async (el, value) => { Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(el, value); await act(async () => { el.dispatchEvent(new Event('change', { bubbles: true })) }) }

test('editor oferece os gatilhos e ações novas; Testar mostra a prévia da linha escolhida e grava no registro', async () => {
  const root = createRoot(document.getElementById('app'))
  render = () => { void act(async () => root.render(React.createElement(AutomationsEditor, { dbId: 'db', schema }))) }
  await act(async () => root.render(React.createElement(AutomationsEditor, { dbId: 'db', schema })))
  const triggers = [...document.querySelectorAll('select')][0]
  assert.deepEqual([...triggers.options].map(option => option.value), ['propertyChange', 'rowCreated', 'typeAdded', 'taskCompleted', 'dateArrived', 'scheduled'])
  const actionKinds = [...select('Tipo da ação').options].map(option => option.value)
  assert.deepEqual(actionKinds, ['setProperty', 'setTitle', 'createTask', 'addType', 'notify', 'createRow', 'duplicateRow', 'moveRow', 'archiveRow'])
  assert.equal(document.querySelector('.am-summary').textContent, 'Quando “Status” mudar')
  // Teste com a linha que atende à condição.
  await choose(select('Linha para testar'), 'r1')
  await act(async () => { button('Testar').click() })
  const preview = document.querySelector('[role="status"]')
  assert.match(preview.textContent, /Teste com “Contrato Acme” — nada foi alterado/)
  assert.match(preview.textContent, /✓ Título contém “contrato”/)
  assert.match(preview.textContent, /A regra rodaria e faria:/)
  assert.match(preview.textContent, /Notificar: “Oi Contrato Acme”/)
  assert.equal(logged.at(-1).status, 'test')
  assert.match(logged.at(-1).detail, /^Rodaria/)
  // Outra linha: a condição falha.
  await choose(select('Linha para testar'), 'r2')
  await act(async () => { button('Testar').click() })
  assert.match(document.querySelector('[role="status"]').textContent, /não rodaria para esta linha/)
  assert.match(document.querySelector('[role="status"]').textContent, /✗ Título contém “contrato”/)
  assert.match(logged.at(-1).detail, /Não rodaria/)
  assert.match(document.querySelector('.am-log summary').textContent, /Registro de execuções \(2\)/)
  await act(async () => root.unmount())
})

test('trocar o gatilho, adicionar condição e ação, e religar "data chegou" recomeça o controle', async () => {
  const root = createRoot(document.getElementById('app'))
  render = () => { void act(async () => root.render(React.createElement(AutomationsEditor, { dbId: 'db', schema }))) }
  await act(async () => root.render(React.createElement(AutomationsEditor, { dbId: 'db', schema })))
  await choose([...document.querySelectorAll('select')][0], 'dateArrived')
  assert.equal(schema.automations[0].trigger.kind, 'dateArrived')
  assert.equal(schema.automations[0].trigger.propertyId, 'dt')
  assert.ok(document.querySelector('input[aria-label="Dias antes (−) ou depois (+) da data"]') !== null)
  schema = { ...schema, automations: [{ ...schema.automations[0], fired: { r1: '2026-10-01' } }] }
  await act(async () => root.render(React.createElement(AutomationsEditor, { dbId: 'db', schema })))
  await act(async () => { document.querySelector('input[role="switch"]').click() })
  assert.equal(schema.automations[0].enabled, true)
  assert.equal(schema.automations[0].fired, undefined, 'religar começa uma nova linha de base')
  const conditions = schema.automations[0].conditions.length
  await act(async () => { button('Adicionar condição').click() })
  assert.equal(schema.automations[0].conditions.length, conditions + 1)
  const count = schema.automations[0].actions.length
  await act(async () => { button('Adicionar ação').click() })
  assert.equal(schema.automations[0].actions.length, count + 1)
  await act(async () => { button('Adicionar').click() })
  assert.equal(schema.automations.length, 2)
  await act(async () => root.unmount())
})
