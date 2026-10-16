// Diálogo de perguntas de modelo e botão "Inserir variável" (jsdom). Regra: nunca passar nós do DOM aos asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import { shimUi } from './fixtures/ui-shim.mjs'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__tpl = { locale: 'pt-BR', useI18n: () => ({ locale: globalThis.__tpl.locale, t: (pt, en, vars) => (globalThis.__tpl.locale === 'en-US' ? en : pt).replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')) }) }
const href = (path) => JSON.stringify(new URL(path, import.meta.url).href)

async function load(path, name) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  source = source.replace(/import \{ useI18n \} from '[^']*i18n'/, 'const { useI18n } = globalThis.__tpl')
    .replace(/import '[^']*\.css'\n/g, '')
    .replace("from '../../a11y/useModalFocus'", `from ${href('../src/a11y/useModalFocus.ts')}`)
    .replace("from '../../templates/promptBus'", `from ${href('../src/templates/promptBus.ts')}`)
    .replace("from '../../templates/variables'", `from ${href('../src/templates/variables.ts')}`)
  const compiled = await transformWithOxc(shimUi(source), name, { jsx: { runtime: 'automatic' } })
  const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, id) => `from ${JSON.stringify(import.meta.resolve(id))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { TemplatePromptHost } = await load('../src/components/modals/TemplatePromptDialog.tsx', 'TemplatePromptDialog.tsx')
const { VariablePicker, variablesFor } = await load('../src/components/modals/VariablePicker.tsx', 'VariablePicker.tsx')
const { askTemplateQuestions } = await import('../src/templates/promptBus.ts')

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const root = createRoot(document.getElementById('app'))
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
const buttonByText = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
const typeInto = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('perguntas: mostra o padrão, aceita resposta e devolve os valores', async () => {
  await act(async () => root.render(React.createElement(TemplatePromptHost)))
  assert.ok(document.querySelector('[role=dialog]') === null, 'fechado sem pergunta')
  let pending
  await act(async () => { pending = askTemplateQuestions([{ label: 'Cliente', default: 'Acme' }, { label: 'Valor', default: '' }], 'Proposta') })
  assert.equal(document.querySelector('[role=dialog] h3').textContent, 'Proposta')
  const inputs = [...document.querySelectorAll('.tpl-input')]
  assert.equal(inputs.length, 2)
  assert.equal(inputs[0].value, 'Acme', 'valor padrão preenchido')
  assert.ok(document.activeElement === inputs[0], 'foco na primeira pergunta')
  await typeInto(inputs[1], '1200')
  await click(buttonByText('Aplicar modelo'))
  assert.deepEqual(await pending, { Cliente: 'Acme', Valor: '1200' })
  assert.ok(document.querySelector('[role=dialog]') === null, 'fecha ao aplicar')
})

test('perguntas: Cancelar e Esc devolvem null e nada é aplicado', async () => {
  let pending
  await act(async () => { pending = askTemplateQuestions([{ label: 'Q', default: 'x' }]) })
  await click(buttonByText('Cancelar'))
  assert.equal(await pending, null)
  await act(async () => { pending = askTemplateQuestions([{ label: 'Q', default: 'x' }]) })
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.equal(await pending, null)
  assert.ok(document.querySelector('[role=dialog]') === null)
})

test('Inserir variável: lista descritiva com prévia, escopo de linha e idioma', async () => {
  const picked = []
  await act(async () => root.render(React.createElement(VariablePicker, { scope: 'page', onPick: (token) => picked.push(token) })))
  assert.ok(document.querySelector('.tpl-picker-panel') === null)
  await click(buttonByText('Inserir variável'))
  const names = [...document.querySelectorAll('.tpl-var')].map(el => el.getAttribute('data-variable'))
  assert.ok(names.includes('date') && names.includes('cursor') && names.includes('ask'))
  assert.ok(!names.includes('prop'), 'propriedade só em modelo de banco')
  assert.ok(!names.includes('agenda'), 'agenda só na nota diária')
  const date = document.querySelector('[data-variable=date]')
  assert.match(date.textContent, /\{\{data\}\}/)
  assert.match(date.textContent, /Resultado: \d{1,2} de \w+ de \d{4}/, 'prévia com a data de hoje')
  await click(date)
  assert.deepEqual(picked, ['{{data}}'])
  assert.ok(document.querySelector('.tpl-picker-panel') === null, 'fecha ao escolher')
  // modelo de banco e inglês
  globalThis.__tpl.locale = 'en-US'
  await act(async () => root.render(React.createElement(VariablePicker, { scope: 'row', onPick: (token) => picked.push(token) })))
  await click(buttonByText('Insert variable'))
  assert.ok(document.querySelector('[data-variable=prop]') !== null)
  await click(document.querySelector('[data-variable=prop]'))
  assert.equal(picked[1], '{{prop:Name}}')
  await act(async () => root.render(React.createElement(VariablePicker, { scope: 'row', onPick: () => {} })))
  await click(buttonByText('Insert variable'))
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(document.querySelector('.tpl-picker-panel') === null, 'Esc fecha')
  assert.equal(variablesFor('daily').some(i => i.id === 'agenda'), true)
  globalThis.__tpl.locale = 'pt-BR'
})
