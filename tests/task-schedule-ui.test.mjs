// "Agendar no Calendário" (jsdom): diálogo, permissão do macOS, vínculo existente e confirmação de mudanças da tarefa.
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
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'HTMLInputElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react')
const { createRoot } = await import('react-dom/client')

const scheduled = [], unscheduled = [], applied = [], toasts = []
let access = { status: { authorization: 'fullAccess' }, calendars: [{ id: 'c1', title: 'Trabalho', allowsModify: true }], defaultCalendarId: 'c1' }
let settings = { taskLinks: {} }
let plan = []
globalThis.__sc = {
  useStore: () => ({ ready: true, pages: {}, settings: { calendarIntegration: settings } }),
  useI18n: () => ({ locale: 'pt-BR', t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')) }),
  useModalFocus: () => {},
  showToast: toast => toasts.push(toast.message), showUndoToast: message => toasts.push(message),
  hasNativeCalendar: () => true, openCalendarSettings: () => toasts.push('abrir-configuracoes'),
  useCalendarAccess: () => access, useCalendarSettings: () => settings,
  permissionLabel: authorization => authorization,
  currentTasks: () => [{ key: 'c:p:b', title: 'Enviar proposta' }], startTaskIndex() {}, taskIndexStatus: () => ({ pending: 0 }), useTaskIndexVersion: () => 0,
  applySyncAction: async (action, confirmed) => { applied.push([action.kind, action.key, confirmed]) },
  canScheduleTasks: () => true, currentSyncPlan: () => plan, taskDuration: () => 30,
  scheduleTask: async (item, slot, options) => { scheduled.push([item.key, slot, options.calendarId]); return { id: 'e1' } },
  taskLink: () => undefined,
  unscheduleTask: async (key, del) => { unscheduled.push([key, del]) },
}
const href = path => JSON.stringify(new URL(path, import.meta.url).href)
let source = await readFile(new URL('../src/tasks/ScheduleTask.tsx', import.meta.url), 'utf8')
source = source
  .replace(/import \{ useStore \} from '\.\.\/store'/, 'const { useStore } = globalThis.__sc')
  .replace(/import \{ useI18n \} from '\.\.\/i18n'/, 'const { useI18n } = globalThis.__sc')
  .replace(/import \{ useModalFocus \} from '[^']*'/, 'const { useModalFocus } = globalThis.__sc')
  .replace(/import \{ showToast, showUndoToast \} from '[^']*'/, 'const { showToast, showUndoToast } = globalThis.__sc')
  .replace(/import \{ hasNativeCalendar, openCalendarSettings, useCalendarAccess, useCalendarSettings \} from '[^']*'/, 'const { hasNativeCalendar, openCalendarSettings, useCalendarAccess, useCalendarSettings } = globalThis.__sc')
  .replace(/import \{ calendarErrorMessage \} from '[^']*'/, `import { calendarErrorMessage } from ${href('../src/components/calendar/eventMapping.ts')}`)
  .replace(/import \{ permissionLabel \} from '[^']*'/, 'const { permissionLabel } = globalThis.__sc')
  .replace(/import \{ localDay \} from '[^']*'/, `import { localDay } from ${href('../src/daily/dailyCore.ts')}`)
  .replace(/import \{ currentTasks, startTaskIndex, taskIndexStatus, useTaskIndexVersion \} from '\.\/taskIndex'/, 'const { currentTasks, startTaskIndex, taskIndexStatus, useTaskIndexVersion } = globalThis.__sc')
  .replace(/import type \{ TaskItem \} from '\.\/taskCore'/, '')
  .replace(/import \{ DURATION_OPTIONS, localSlotOf, suggestedSlot, type Slot, type TaskSyncAction \} from '\.\/taskCalendarCore'/, `import { DURATION_OPTIONS, localSlotOf, suggestedSlot } from ${href('../src/tasks/taskCalendarCore.ts')}`)
  .replace(/import \{ applySyncAction[^}]*\} from '\.\/taskCalendarActions'/, 'const { applySyncAction, canScheduleTasks, currentSyncPlan, scheduleTask, taskDuration, taskLink, unscheduleTask } = globalThis.__sc')
  .replace(/import '\.\/taskCalendar\.css'/, '')
  
const compiled = await transformWithOxc(shimUi(source), 'ScheduleTask.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { ScheduleTaskHost, TaskEventSyncHost, TaskScheduleButton, openScheduleTask } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

const task = { key: 'c:p:b', kind: 'checklist', pageId: 'p', blockId: 'b', title: 'Enviar proposta', due: '2026-10-12', time: '14:00', sourceId: 'p', sourceTitle: 'Projeto' }
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const click = async label => { const el = button(label); assert.ok(el !== undefined, label); await act(async () => { el.click(); await new Promise(r => setTimeout(r, 5)) }) }

test('diálogo agenda com dia/hora sugeridos pela tarefa, duração e calendário escolhidos; erro de permissão aparece em texto', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ScheduleTaskHost)))
  await act(async () => { openScheduleTask({ ...task, due: '2999-12-31' }) })
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-label'), 'Agendar no Calendário')
  assert.equal(document.querySelector('.tc-task').textContent, 'Enviar proposta')
  const inputs = [...document.querySelectorAll('.tc-input')]
  assert.equal(inputs[0].value, '2999-12-31')
  assert.equal(inputs[1].value, '14:00')
  await click('Agendar')
  assert.deepEqual(scheduled[0], ['c:p:b', { day: '2999-12-31', time: '14:00', minutes: 30 }, undefined])
  assert.deepEqual(toasts.at(-1), 'Evento criado no Calendário.')
  assert.ok(document.querySelector('[role="dialog"]') === null, 'fecha ao agendar')
  // Sem permissão: avisa e não deixa agendar.
  access = { ...access, status: { authorization: 'denied' } }
  await act(async () => { openScheduleTask(task, { day: '2026-10-12', time: '10:00', minutes: 60 }) })
  assert.match(document.querySelector('.tc-warning').textContent, /denied/)
  assert.equal(button('Agendar').disabled, true)
  await click('Abrir Configurações')
  assert.equal(toasts.at(-1), 'abrir-configuracoes')
  await act(async () => root.unmount())
  access = { status: { authorization: 'fullAccess' }, calendars: [], defaultCalendarId: '' }
})

test('sem hora não dá para agendar; Esc fecha o diálogo', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(ScheduleTaskHost)))
  await act(async () => { openScheduleTask(task) })
  const time = document.querySelectorAll('.tc-input')[1]
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(time, '')
  await act(async () => { time.dispatchEvent(new Event('input', { bubbles: true })) })
  assert.equal(button('Agendar').disabled, true, 'sem hora não agenda')
  await act(async () => { document.querySelector('[role="dialog"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  assert.ok(document.querySelector('[role="dialog"]') === null)
  await act(async () => root.unmount())
})

test('botão da linha: só aparece com calendário nativo e tarefa aberta; indica tarefa já agendada', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TaskScheduleButton, { item: task })))
  assert.match(document.querySelector('.tk-sched').getAttribute('aria-label'), /Agendar no Calendário…: Enviar proposta/)
  settings = { taskLinks: { 'c:p:b': { taskKey: 'c:p:b', start: '2026-10-12T17:00:00.000Z', end: '2026-10-12T17:30:00.000Z' } } }
  await act(async () => root.render(React.createElement(TaskScheduleButton, { item: task })))
  assert.equal(document.querySelector('.tk-sched').className.includes('is-on'), true)
  await act(async () => root.render(React.createElement(TaskScheduleButton, { item: { ...task, done: true } })))
  assert.ok(document.querySelector('.tk-sched') === null, 'concluída: sem botão')
  await act(async () => root.unmount())
})

test('aviso de sincronização: concluída pergunta; "Remover evento" confirma, "Manter" recusa, Esc adia', async () => {
  settings = { taskLinks: { 'c:p:b': { taskKey: 'c:p:b', title: 'Enviar proposta', start: '2026-10-12T17:00:00.000Z', end: '2026-10-12T17:30:00.000Z' } } }
  plan = [{ kind: 'done', key: 'c:p:b' }]
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TaskEventSyncHost)))
  await act(async () => { await new Promise(r => setTimeout(r, 1700)) })
  assert.match(document.querySelector('[role="alertdialog"]').textContent, /“Enviar proposta” foi concluída\. Remover o evento do Calendário\?/)
  assert.deepEqual(applied, [], 'nada acontece antes da resposta')
  await click('Remover evento')
  assert.deepEqual(applied.at(-1), ['done', 'c:p:b', true])
  assert.ok(document.querySelector('[role="alertdialog"]') === null)
  plan = [{ kind: 'moved', key: 'c:p:b', due: '2026-10-14', time: null }]
  settings = { taskLinks: { 'c:p:b': { ...settings.taskLinks['c:p:b'], error: undefined } } }
  await act(async () => root.render(React.createElement(TaskEventSyncHost)))
  await act(async () => { await new Promise(r => setTimeout(r, 1700)) })
  assert.match(document.querySelector('[role="alertdialog"]').textContent, /mudou para 2026-10-14\. Mover o evento junto\?/)
  await click('Manter onde está')
  assert.deepEqual(applied.at(-1), ['moved', 'c:p:b', false])
  await act(async () => root.unmount())
})
