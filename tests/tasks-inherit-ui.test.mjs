// Linha de tarefa (jsdom): indicador "Nota de 8 de out" para data herdada. Nunca comparar nós do DOM em asserts.
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const opened = []
globalThis.__tk = {
  t: (pt, _en, vars) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')),
  opened,
}
const href = path => JSON.stringify(new URL(path, import.meta.url).href)
let source = await readFile(new URL('../src/tasks/TasksView.tsx', import.meta.url), 'utf8')
source = source
  .replace(/import \{ useStore \} from '\.\.\/store'/, 'const useStore = () => ({ pages: {} })')
  .replace(/import \{ t, useI18n \} from '\.\.\/i18n'/, "const { t } = globalThis.__tk; const useI18n = () => ({ locale: 'pt-BR' })")
  .replace(/import \{[^}]*\} from '\.\/taskIndex'/, 'const currentBuckets = () => ({}), startTaskIndex = () => {}, taskIndexStatus = () => ({ pending: 0 }), useTaskIndexVersion = () => 0')
  .replace(/import \{ groupTasks, type TaskBuckets, type TaskItem \} from '\.\/taskCore'/, `import { groupTasks } from ${href('../src/tasks/taskCore.ts')}`)
  .replace(/import \{[^}]*\} from '\.\/taskActions'/, 'const completeTask = async () => "checked", openTaskSource = item => globalThis.__tk.opened.push(item.pageId + "#" + item.blockId)')
  .replace(/import \{ addDays, formatLongDate, formatShortDate, formatWeekday, type DailyLocale \} from '\.\.\/daily\/dailyCore'/, `import { addDays, formatLongDate, formatShortDate, formatWeekday } from ${href('../src/daily/dailyCore.ts')}`)
  .replace(/import \{ useToday \} from '[^']*'/, "const useToday = () => '2026-10-08'")
  .replace(/import \{ openToday \} from '[^']*'/, 'const openToday = async () => {}')
  .replace(/import '\.\/tasks\.css'/, '')
  .replace(/import \{[^}]*\} from '\.\.\/components\/ui\/toastQueue'/, 'const showToast = () => 0, showUndoToast = () => 0')
  .replace(/import \{ shortcutHint \} from '[^']*'/, 'const shortcutHint = () => ""')
  .replace(/import \{ Illustration \} from '[^']*'/, 'const Illustration = () => null')
  .replace(/import \{ openVoiceTasks \} from '[^']*'/, 'const openVoiceTasks = () => {}')
  .replace(/import \{ TaskScheduleButton \} from '[^']*'/, 'const TaskScheduleButton = () => null')
  .replace(/import \{ taskDragProps \} from '[^']*'/, 'const taskDragProps = () => ({})')
  .replace(/import \{ TaskReminderButton \} from '[^']*'/, 'const TaskReminderButton = () => null')
const compiled = await transformWithOxc(shimUi(source), 'TasksView.tsx', { jsx: { runtime: 'automatic' } })
const code = compiled.code.replace(/from ["'](react(?:\/jsx-runtime)?|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { TaskLine } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('data herdada mostra "Nota de 8 de out" com tooltip; data explícita mostra o rótulo normal', async () => {
  const root = createRoot(document.getElementById('app'))
  const base = { kind: 'checklist', pageId: 'n1', blockId: 'b1', sourceId: 'n1', sourceTitle: '8 de outubro de 2026' }
  const items = [
    { ...base, key: 'c:n1:b1', title: 'Herdada', due: '2026-10-08', inherited: true },
    { ...base, key: 'c:n1:b2', title: 'Explícita', due: '2026-10-08', sourceTitle: 'Casa' },
    { ...base, key: 'c:n1:b3', title: 'Atrasada herdada', due: '2026-10-07', inherited: true },
  ]
  await act(async () => root.render(React.createElement('div', null, items.map(item => React.createElement(TaskLine, { key: item.key, item, today: '2026-10-08', locale: 'pt-BR', showDue: true, onDone() {}, pending: false })))))
  const rows = [...document.querySelectorAll('.tk-item')]
  assert.equal(rows.length, 3)
  const chip = rows[0].querySelector('.tk-inherit')
  assert.ok(chip !== null, 'chip presente')
  assert.equal(chip.textContent.trim(), 'Nota de 8 de out.')
  assert.equal(chip.getAttribute('title'), 'Data herdada da nota diária')
  assert.ok(rows[1].querySelector('.tk-inherit') === null, 'data explícita sem chip')
  assert.equal(rows[1].querySelector('.tk-due').textContent.trim(), 'Hoje')
  assert.ok(rows[2].querySelector('.tk-inherit.is-overdue') !== null, 'atrasada em destaque')
  await act(async () => { rows[0].querySelector('.tk-main').click() })
  assert.deepEqual(opened, ['n1#b1'])
  await act(async () => root.unmount())
})
