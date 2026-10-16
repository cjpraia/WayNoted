import PRODUCT from '../shared/product.json' with { type: 'json' }
// Lembretes do macOS com ida e volta (C3b): planejador puro e ciclo completo contra um app Lembretes SIMULADO em memória.
// ⚠ O helper Swift e o EventKit reais só são exercitados no app empacotado (ver docs/LOCAL-INTEGRATIONS.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { LOG_LIMIT, mirroredKeys, newLink, parseSig, planRemindersSync, pushLog, sigOf, stateOfReminder, stateOfTask, type TaskState } from '../src/reminders/remindersCore.ts'
import type { AppleReminder, RemindersSyncSettings, SyncLogEntry } from '../src/types.ts'
import type { TaskItem } from '../src/tasks/taskCore.ts'

const task = (over: Partial<TaskItem> = {}): TaskItem => ({ key: 'c:p1:b1', kind: 'checklist', pageId: 'p1', blockId: 'b1', title: 'Pagar conta', due: '2026-10-10', sourceId: 'p1', sourceTitle: 'Casa', ...over })
const reminder = (over: Partial<AppleReminder> = {}): AppleReminder => ({ id: 'r1', listId: 'L', title: 'Pagar conta', completed: false, notes: '', url: '', modified: new Date(2026, 9, 9, 10).toISOString(), due: { date: '2026-10-10' }, ...over })
const base: TaskState = { title: 'Pagar conta', done: false, due: '2026-10-10', time: null }
const settings = (over: Partial<RemindersSyncSettings> = {}): RemindersSyncSettings => ({ enabled: true, listName: `${PRODUCT.name}`, chosen: { 'c:p1:b1': true }, links: { 'c:p1:b1': newLink('c:p1:b1', 'r1', base, 1, 1) }, ...over })
const plan = (over: { settings?: RemindersSyncSettings; tasks?: TaskItem[]; remote?: AppleReminder[]; localAt?: number; indexReady?: boolean; gone?: boolean } = {}) => planRemindersSync({
  settings: over.settings ?? settings(), tasks: new Map((over.tasks ?? [task()]).map(item => [item.key, item])), remote: new Map((over.remote ?? [reminder()]).map(item => [item.id, item])),
  localModified: () => over.localAt ?? 0, today: '2026-10-09', indexReady: over.indexReady ?? true, isGone: () => over.gone ?? false,
})

test('estado e assinatura: título aparado, prazo com hora, ida e volta da assinatura', () => {
  const state = stateOfTask({ title: '  Pagar conta ', due: '2026-10-10', time: '09:00', done: undefined })
  assert.deepEqual(state, { title: 'Pagar conta', done: false, due: '2026-10-10', time: '09:00' })
  assert.deepEqual(parseSig(sigOf(state)), state)
  assert.equal(parseSig('lixo'), null)
  assert.deepEqual(stateOfReminder(reminder({ completed: true, due: { date: '2026-10-11', time: '08:30' } })), { title: 'Pagar conta', done: true, due: '2026-10-11', time: '08:30' })
})

test('espelhar: escolhidas + (opcional) hoje e atrasadas abertas, sem as dispensadas', () => {
  const tasks = new Map([['a', task({ key: 'a', due: '2026-10-09' })], ['b', task({ key: 'b', due: '2026-10-01' })], ['c', task({ key: 'c', due: '2026-10-20' })], ['d', task({ key: 'd', due: '2026-10-09', done: true })], ['e', task({ key: 'e', due: '2026-10-09' })], ['f', task({ key: 'f', due: null })]])
  assert.deepEqual([...mirroredKeys({ enabled: true, listName: 'N', chosen: { c: true } }, tasks, '2026-10-09')], ['c'])
  assert.deepEqual([...mirroredKeys({ enabled: true, listName: 'N', chosen: { c: true }, autoToday: true, dismissed: { e: true } }, tasks, '2026-10-09')].sort(), ['a', 'b', 'c'])
})

test('plano: tarefa nova vira lembrete; concluída não é criada; sem mudanças não faz nada', () => {
  assert.deepEqual(plan({ settings: settings({ links: {} }), remote: [] }).map(op => [op.kind, op.key]), [['create', 'c:p1:b1']])
  assert.deepEqual(plan({ settings: settings({ links: {} }), remote: [], tasks: [task({ done: true })] }), [])
  assert.deepEqual(plan(), [])
})

test('plano: um lado mudou → a mudança vai para o outro (conclusão nos dois sentidos)', () => {
  const local = plan({ tasks: [task({ done: true })] })[0] as any
  assert.deepEqual([local.kind, local.pushFields, local.pullFields, local.final.done], ['sync', ['done'], [], true])
  const far = plan({ remote: [reminder({ completed: true })] })[0] as any
  assert.deepEqual([far.kind, far.pushFields, far.pullFields, far.final.done], ['sync', [], ['done'], true])
  const mixed = plan({ tasks: [task({ title: 'Pagar conta de luz' })], remote: [reminder({ due: { date: '2026-10-15' } })] })[0] as any
  assert.deepEqual([mixed.pushFields, mixed.pullFields, mixed.final.title, mixed.final.due], [['title'], ['due'], 'Pagar conta de luz', '2026-10-15'])
})

test('conflito: os dois mudaram o título → vence a alteração mais recente e o conflito é registrado', () => {
  const remoteAt = new Date(2026, 9, 9, 10).getTime()
  const newerLocal = plan({ tasks: [task({ title: 'Local' })], remote: [reminder({ title: 'Remoto' })], localAt: remoteAt + 1000 })[0] as any
  assert.deepEqual([newerLocal.pushFields, newerLocal.pullFields, newerLocal.final.title, newerLocal.conflicts[0].winner], [['title'], [], 'Local', 'local'])
  const newerRemote = plan({ tasks: [task({ title: 'Local' })], remote: [reminder({ title: 'Remoto' })], localAt: remoteAt - 1000 })[0] as any
  assert.deepEqual([newerRemote.pushFields, newerRemote.pullFields, newerRemote.final.title, newerRemote.conflicts[0].winner], [[], ['title'], 'Remoto', 'remote'])
  // Mudaram para o mesmo valor: sem conflito, só atualiza o vínculo.
  const converged = plan({ tasks: [task({ done: true })], remote: [reminder({ completed: true })] })[0] as any
  assert.deepEqual([converged.pushFields, converged.pullFields, converged.conflicts.length], [[], [], 0])
})

test('plano: lembrete apagado desvincula; tarefa sumida só com índice pronto; fora do espelho mantém o lembrete', () => {
  assert.deepEqual(plan({ remote: [] }).map(op => [op.kind, (op as any).reason]), [['unlink', 'remote-deleted']])
  assert.deepEqual(plan({ tasks: [], gone: true }).map(op => [op.kind, (op as any).reason]), [['unlink', 'task-gone']])
  assert.deepEqual(plan({ tasks: [], gone: true, indexReady: false }), [])
  assert.deepEqual(plan({ settings: settings({ chosen: {} }) }).map(op => [op.kind, (op as any).reason]), [['unlink', 'not-mirrored']])
})

test('registro guarda só os 50 mais recentes, o mais novo primeiro', () => {
  const entry = (n: number): SyncLogEntry => ({ at: n, key: 'k', title: 't', action: 'pushed', detail: String(n) })
  let log: SyncLogEntry[] | undefined
  for (let i = 0; i < 70; i++) log = pushLog(log, [entry(i)])
  assert.equal(log!.length, LOG_LIMIT)
  assert.equal(log![0].at, 69)
})

// ---------- Ciclo completo contra o app Lembretes simulado ----------

const documents = new Map<string, unknown[]>()
interface Fake { id: string; listId: string; title: string; completed: boolean; notes: string; url: string; modified: number; due?: { date: string; time?: string } }
const store = new Map<string, Fake>()
let clock = new Date(2026, 9, 9, 9).getTime()
let authorization = 'fullAccess'
let nextId = 0
const calls: string[] = []
const view = (item: Fake): AppleReminder => ({ ...item, modified: new Date(item.modified).toISOString() }) as AppleReminder
const fakeNative = {
  async loadMeta() { return null }, async saveMeta() {}, async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) }, async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) }, async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
  async remindersStatus() { return { available: true, authorization } },
  async remindersRequestAccess() { calls.push('request'); return { available: true, authorization } },
  async remindersEnsureList(input: { title: string }) { calls.push('ensure'); return { list: { id: 'LIST', title: input.title, source: 'iCloud', allowsModify: true }, created: false } },
  async remindersList() { return { reminders: [...store.values()].map(view) } },
  async remindersUpsert(input: any) {
    calls.push('upsert')
    const item: Fake = input.id ? store.get(input.id)! : { id: `R${++nextId}`, listId: input.listId, title: '', completed: false, notes: '', url: '', modified: 0 }
    if (input.title !== undefined) item.title = input.title
    if (input.notes !== undefined) item.notes = input.notes
    if (input.url !== undefined) item.url = input.url
    if (input.completed !== undefined) item.completed = input.completed
    if (input.due === null) delete item.due; else if (input.due) item.due = input.due
    item.modified = ++clock
    store.set(item.id, item)
    return view(item)
  },
  async remindersComplete(input: any) { const item = store.get(input.id)!; item.completed = input.completed !== false; item.modified = ++clock; return view(item) },
  async remindersDelete(input: any) { store.delete(input.id); return { deleted: true } },
}
Object.assign(globalThis, { window: { api: fakeNative, addEventListener() {}, removeEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { __setChecklistForTest } = await import('../src/tasks/taskIndex.ts')
const { extractChecklist } = await import('../src/tasks/taskCore.ts')
const sync = await import('../src/reminders/remindersSync.ts')

const dueAt = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString()
const block = (id: string, text: string, date: string | null, extra: Record<string, unknown> = {}, checked = false) => ({ id, type: 'checkListItem', props: { checked }, content: [{ type: 'text', text: text + (date ? ' ' : ''), styles: {} }, ...(date ? [{ type: 'dateMention', props: { id: `m-${id}`, date, startDate: '', pageId: '', repeat: '', reminderId: '', time: '', ...extra } }] : [])], children: [] })
const reindex = (page: string) => __setChecklistForTest(page, extractChecklist(documents.get(page)))
const doc = (page: string) => documents.get(page) as any[]
const settingsNow = () => getState().settings.remindersSync!
const run = (offset = 0) => sync.runRemindersSync(new Date(2026, 9, 9, 9, 30).getTime() + offset)
let page = ''

test('ligar pede a permissão uma única vez e só então cria a lista; sem permissão nada é sincronizado', async () => {
  await actions.init()
  page = actions.createPage(null, { title: 'Casa' })
  await actions.flushMeta()
  documents.set(page, [block('b1', 'Pagar conta', dueAt(10)), block('b2', 'Comprar pão', dueAt(9))])
  reindex(page)
  assert.deepEqual(calls, [], 'nenhuma chamada nativa antes de ligar')
  assert.equal(await run(), null, 'desligado: não sincroniza')
  authorization = 'denied'
  assert.deepEqual(await sync.enableReminders(), { authorization: 'denied' })
  assert.equal(settingsNow()?.enabled ?? false, false)
  assert.deepEqual(calls, ['request'], 'não criou lista sem permissão')
  authorization = 'fullAccess'
  assert.deepEqual(await sync.enableReminders(`${PRODUCT.name}`), { authorization: 'fullAccess' })
  assert.equal(settingsNow().enabled, true)
  assert.equal(settingsNow().listId, 'LIST')
})

test(`tarefa escolhida vira lembrete com prazo e link de volta; concluir no ${PRODUCT.name} conclui o Lembrete`, async () => {
  const key = `c:${page}:b1`
  sync.setTaskMirrored(key, true)
  const first = await run()
  assert.deepEqual(first, { ops: 1, errors: 0 })
  const created = [...store.values()][0]
  assert.equal(created.title, 'Pagar conta')
  assert.deepEqual(created.due, { date: '2026-10-10' })
  assert.equal(created.url, `workspace://page/${page}#block=b1`)
  assert.equal(created.listId, 'LIST')
  assert.equal(created.completed, false)
  assert.equal(settingsNow().links![key].reminderId, created.id)
  assert.equal(settingsNow().log![0].action, 'created')
  assert.deepEqual(await run(60_000), { ops: 0, errors: 0 }, 'segundo ciclo sem mudanças não faz nada')
  // Concluir no the application.
  documents.set(page, [block('b1', 'Pagar conta', dueAt(10), {}, true), doc(page)[1]])
  reindex(page)
  await run(120_000)
  assert.equal(created.completed, true)
  assert.ok(settingsNow().log!.some(entry => entry.action === 'pushed' && /conclusão|completion/.test(entry.detail)))
})

test(`concluir/reabrir no app Lembretes conclui/reabre a tarefa no ${PRODUCT.name}`, async () => {
  const key = `c:${page}:b1`
  const created = [...store.values()][0]
  created.completed = false; created.modified = ++clock
  await run(180_000)
  assert.equal(doc(page)[0].props.checked, false, `reaberta no ${PRODUCT.name}`)
  reindex(page)
  created.completed = true; created.modified = ++clock
  await run(240_000)
  assert.equal(doc(page)[0].props.checked, true, `concluída no ${PRODUCT.name}`)
  assert.ok(settingsNow().log!.some(entry => entry.key === key && entry.action === 'pulled'))
  reindex(page)
  assert.deepEqual(await run(300_000), { ops: 0, errors: 0 })
})

test('título e prazo editados no Lembretes voltam para a tarefa; formatação é preservada ou o motivo é registrado', async () => {
  documents.set(page, [block('b1', 'Pagar conta', dueAt(10)), doc(page)[1]])
  reindex(page)
  await run(310_000)
  const item = [...store.values()][0]
  item.completed = false
  item.title = 'Pagar conta de luz'; item.due = { date: '2026-10-12', time: '08:30' }; item.modified = ++clock
  await run(320_000)
  const content = doc(page)[0].content
  assert.equal(content[0].text, 'Pagar conta de luz ')
  assert.equal(content[1].type, 'dateMention')
  assert.equal(content[1].props.time, '08:30')
  assert.equal(new Date(content[1].props.date).getDate(), 12)
  reindex(page)
  assert.deepEqual(await run(330_000), { ops: 0, errors: 0 })
  // Item com negrito: o título do Lembrete não sobrescreve; o erro vai para o registro.
  documents.set(page, [{ ...block('b1', 'Pagar conta de luz', dueAt(12)), content: [{ type: 'text', text: 'Pagar ', styles: { bold: true } }, { type: 'text', text: 'conta de luz ', styles: {} }, doc(page)[0].content[1]] }, doc(page)[1]])
  reindex(page)
  item.title = 'Outro título'; item.modified = ++clock
  const before = JSON.stringify(doc(page))
  const result = await run(340_000)
  assert.equal(result!.errors, 1)
  assert.equal(JSON.stringify(doc(page)), before, 'documento intacto')
  assert.match(settingsNow().log![0].detail, /formatação|formatting/)
})

test('conflito de título: vence o mais recente, com registro; Lembrete apagado desvincula e não volta sozinho', async () => {
  documents.set(page, [block('b1', 'Pagar conta de luz', dueAt(12)), doc(page)[1]])
  reindex(page)
  await run(350_000)
  const item = [...store.values()][0]
  // Os dois mudam o título; o Lembrete foi alterado depois da página.
  documents.set(page, [block('b1', 'Pagar luz (local)', dueAt(12)), doc(page)[1]])
  reindex(page)
  actions.updatePage(page, { updatedAt: new Date(2026, 9, 9, 9, 0).getTime() }, false)
  item.title = 'Pagar luz (Lembretes)'; item.modified = new Date(2026, 9, 9, 23).getTime()
  await run(360_000)
  assert.equal(doc(page)[0].content[0].text, 'Pagar luz (Lembretes) ')
  const conflict = settingsNow().log!.find(entry => entry.action === 'conflict')!
  assert.ok(conflict)
  assert.match(conflict.detail, /Pagar luz \(local\)/)
  assert.match(conflict.detail, /Pagar luz \(Lembretes\)/)
  // Apagado no app Lembretes: desvincula, tira da escolha e não recria.
  const key = `c:${page}:b1`
  store.delete(item.id)
  reindex(page)
  await run(370_000)
  assert.equal(settingsNow().links![key], undefined)
  assert.equal(settingsNow().chosen![key], undefined)
  assert.equal(settingsNow().dismissed![key], true)
  const count = store.size
  await run(380_000)
  assert.equal(store.size, count, 'não recriou o lembrete apagado')
})

test('"hoje e atrasadas" espelha sozinho; tarefa recorrente concluída no Lembretes avança e o Lembrete reabre', async () => {
  const today = new Date(2026, 9, 9, 9, 30).getTime()
  documents.set(page, [block('b2', 'Comprar pão', dueAt(9), { repeat: 'daily' })])
  reindex(page)
  sync.updateRemindersSettings(current => ({ ...current, autoToday: true }))
  await sync.runRemindersSync(today)
  const item = [...store.values()].find(entry => entry.title === 'Comprar pão')!
  assert.ok(item, 'espelhada pela opção de hoje')
  item.completed = true; item.modified = ++clock
  await sync.runRemindersSync(today + 60_000)
  const mention = doc(page)[0].content[1].props
  assert.equal(doc(page)[0].props.checked, false, 'recorrente: avançou em vez de concluir')
  assert.ok(new Date(mention.date).getDate() > 9, 'próxima ocorrência')
  assert.equal(item.completed, false, 'o Lembrete reabriu')
  assert.ok(settingsNow().log!.some(entry => /recorrente|recurring/.test(entry.detail)))
  assert.equal(sync.lastRemindersRun()!.errors, 0)
})
