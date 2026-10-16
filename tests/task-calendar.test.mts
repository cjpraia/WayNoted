import PRODUCT from '../shared/product.json' with { type: 'json' }
// Arrastar tarefa para o calendário (E2): horário do evento, link de volta, ligação tarefa↔evento e plano com confirmação.
import test from 'node:test'
import assert from 'node:assert/strict'
import { eventInputFor, localSlotOf, movedSlot, planTaskEventSync, slotRange, suggestedSlot, taskUrl, validSlot } from '../src/tasks/taskCalendarCore.ts'
import type { TaskItem } from '../src/tasks/taskCore.ts'
import type { TaskEventLink } from '../src/types.ts'

const item = (over: Partial<TaskItem> = {}): TaskItem => ({ key: 'c:p1:b1', kind: 'checklist', pageId: 'p1', blockId: 'b1', title: 'Ligar para o João', due: '2026-10-10', sourceId: 'p1', sourceTitle: 'Casa', ...over })
const link = (over: Partial<TaskEventLink> = {}): TaskEventLink => ({ taskKey: 'c:p1:b1', eventId: 'ev1', itemId: 'it1', calendarId: 'cal', title: 'Ligar para o João', start: '2026-10-10T13:00:00.000Z', end: '2026-10-10T13:30:00.000Z', due: '2026-10-10', time: null, createdAt: 1, syncedAt: 1, ...over })

test('horário do evento respeita o fuso e termina após a duração', () => {
  assert.deepEqual(slotRange({ day: '2026-10-10', time: '10:00', minutes: 30 }, 'America/Sao_Paulo'), { start: '2026-10-10T13:00:00.000Z', end: '2026-10-10T13:30:00.000Z' })
  assert.deepEqual(slotRange({ day: '2026-10-10', time: '23:30', minutes: 60 }, 'UTC'), { start: '2026-10-10T23:30:00.000Z', end: '2026-10-11T00:30:00.000Z' })
  assert.equal(slotRange({ day: '2026-10-10', time: '25:00', minutes: 30 }, 'UTC'), null)
  assert.equal(slotRange({ day: '2026-13-10', time: '10:00', minutes: 30 }, 'UTC'), null)
  assert.equal(validSlot({ day: '2026-10-10', time: '10:00', minutes: 0 }), false)
  assert.equal(validSlot({ day: '2026-10-10', time: '10:00', minutes: 45 }), true)
  // Horário que não existe na virada do horário de verão (EUA, 2026-03-08 02:30).
  assert.equal(slotRange({ day: '2026-03-08', time: '02:30', minutes: 30 }, 'America/New_York'), null)
})

test('evento leva título, origem nas notas e link workspace:// de volta (com o bloco da checklist)', () => {
  const input = eventInputFor(item(), { day: '2026-10-10', time: '10:00', minutes: 30 }, 'America/Sao_Paulo', 'pt-BR')!
  assert.equal(input.title, 'Ligar para o João')
  assert.equal(input.url, 'workspace://page/p1#block=b1')
  assert.equal(input.notes, `Tarefa do ${PRODUCT.name} · Casa`)
  assert.equal(input.allDay, false)
  assert.equal(input.timeZone, 'America/Sao_Paulo')
  assert.equal(taskUrl(item({ kind: 'row', blockId: undefined, pageId: 'r1' })), 'workspace://page/r1')
  assert.equal(eventInputFor(item({ title: '  ' }), { day: '2026-10-10', time: '10:00', minutes: 30 }, 'UTC', 'en-US')!.title, 'Untitled task')
  assert.equal(eventInputFor(item(), { day: 'x', time: '10:00', minutes: 30 }, 'UTC', 'pt-BR'), null)
})

test('sugestão de horário e leitura do slot de um evento existente', () => {
  assert.deepEqual(suggestedSlot({ due: '2026-10-12', time: '14:00' }, '2026-10-09', 45), { day: '2026-10-12', time: '14:00', minutes: 45 })
  assert.deepEqual(suggestedSlot({ due: '2026-10-01', time: undefined }, '2026-10-09'), { day: '2026-10-09', time: '09:00', minutes: 30 }, 'prazo passado: hoje, 09:00')
  assert.deepEqual(suggestedSlot({ due: null, time: undefined }, '2026-10-09'), { day: '2026-10-09', time: '09:00', minutes: 30 })
  const range = slotRange({ day: '2026-10-10', time: '10:15', minutes: 90 }, Intl.DateTimeFormat().resolvedOptions().timeZone)!
  assert.deepEqual(localSlotOf(range), { day: '2026-10-10', time: '10:15', minutes: 90 })
  assert.deepEqual(movedSlot(range, '2026-10-12', null), { day: '2026-10-12', time: '10:15', minutes: 90 })
  assert.deepEqual(movedSlot(range, '2026-10-12', '08:00'), { day: '2026-10-12', time: '08:00', minutes: 90 })
})

test('plano: renomear sozinho; concluída/sumiu/prazo mudou só viram pergunta; "manter" não repergunta', () => {
  const ctx = { indexReady: true, isGone: (key: string) => key === 'c:gone:b' }
  const tasks = new Map<string, TaskItem>([
    ['c:p1:b1', item({ title: 'Ligar para o João Silva' })],
    ['c:p2:b2', item({ key: 'c:p2:b2', title: 'Pagar conta', done: true })],
    ['c:p3:b3', item({ key: 'c:p3:b3', title: 'Reunião', due: '2026-10-15', time: '16:00' })],
    ['c:p4:b4', item({ key: 'c:p4:b4', title: 'Igual' })],
    ['c:p5:b5', item({ key: 'c:p5:b5', title: 'Concluída mas mantida', done: true })],
  ])
  const links = {
    'c:p1:b1': link(),
    'c:p2:b2': link({ taskKey: 'c:p2:b2', title: 'Pagar conta' }),
    'c:p3:b3': link({ taskKey: 'c:p3:b3', title: 'Reunião', due: '2026-10-10', time: null }),
    'c:p4:b4': link({ taskKey: 'c:p4:b4', title: 'Igual' }),
    'c:p5:b5': link({ taskKey: 'c:p5:b5', title: 'Concluída mas mantida', keepEvent: true }),
    'c:gone:b': link({ taskKey: 'c:gone:b', title: 'Apagada' }),
    'c:missing:b': link({ taskKey: 'c:missing:b', title: 'Ainda lendo' }),
  }
  const plan = planTaskEventSync(links, tasks, ctx)
  assert.deepEqual(plan, [
    { kind: 'rename', key: 'c:p1:b1', title: 'Ligar para o João Silva' },
    { kind: 'done', key: 'c:p2:b2' },
    { kind: 'moved', key: 'c:p3:b3', due: '2026-10-15', time: '16:00' },
    { kind: 'gone', key: 'c:gone:b' },
  ])
  // Índice ainda lendo as páginas: "não achei" não prova nada.
  assert.deepEqual(planTaskEventSync(links, tasks, { indexReady: false, isGone: () => true }).filter(action => action.kind === 'gone'), [])
  assert.deepEqual(planTaskEventSync(undefined, tasks, ctx), [])
})

// ---------- Ligação com o store e o helper nativo (simulado) ----------

const documents = new Map<string, unknown[]>()
const calls: { name: string; input: any }[] = []
let eventSeq = 0
const events = new Map<string, any>()
const missing = new Set<string>()
const calendar = {
  calendarCreateEvent: async (input: any) => { calls.push({ name: 'create', input }); const id = `ev${++eventSeq}`; const event = { id, itemId: `it${eventSeq}`, calendarId: input.calendarId ?? 'cal-default', calendarTitle: 'Cal', color: '#000', location: '', readOnly: false, ...input }; events.set(id, event); return event },
  calendarUpdateEvent: async (input: any) => { calls.push({ name: 'update', input }); if (missing.has(input.id)) throw new Error('EVENT_NOT_FOUND: gone'); const event = { ...events.get(input.id), ...input }; events.set(input.id, event); return event },
  calendarDeleteEvent: async (input: any) => { calls.push({ name: 'delete', input }); events.delete(input.id); return { deleted: true } },
}
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } }, async saveMeta() {}, async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) }, async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) }, async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {}, ...calendar,
}
Object.assign(globalThis, { window: { api: native, addEventListener() {}, removeEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { applySyncAction, currentSyncPlan, scheduleTask, taskLink, unscheduleTask } = await import('../src/tasks/taskCalendarActions.ts')
const { __setChecklistForTest } = await import('../src/tasks/taskIndex.ts')
const { updateCalendarSettings } = await import('../src/components/calendar/calendarCore.ts')

test('agendar cria o evento com o link de volta e guarda o vínculo; reagendar atualiza o mesmo evento', async () => {
  await actions.init()
  const page = actions.createPage(null, { title: 'Casa' })
  const task = item({ pageId: page, key: `c:${page}:b1`, due: '2026-10-10', time: undefined })
  const slot = { day: '2026-10-10', time: '15:00', minutes: 45 }
  updateCalendarSettings({ defaultCalendarId: 'meu-cal' })
  const event = await scheduleTask(task, slot)
  assert.equal(calls[0].name, 'create')
  assert.equal(calls[0].input.calendarId, 'meu-cal')
  assert.equal(calls[0].input.url, `workspace://page/${page}#block=b1`)
  assert.equal(calls[0].input.title, 'Ligar para o João')
  const stored = taskLink(task.key)!
  assert.equal(stored.eventId, event.id)
  assert.equal(stored.due, '2026-10-10')
  assert.equal(stored.time, null)
  assert.equal(Date.parse(stored.end) - Date.parse(stored.start), 45 * 60_000)
  await scheduleTask(task, { ...slot, time: '16:00' })
  assert.equal(calls.at(-1)!.name, 'update', 'mesmo evento, não duplica')
  assert.equal(events.size, 1)
  // Evento apagado no Calendário: cria outro e religa.
  missing.add(event.id)
  const replaced = await scheduleTask(task, slot)
  assert.notEqual(replaced.id, event.id)
  assert.equal(taskLink(task.key)!.eventId, replaced.id)
  await unscheduleTask(task.key, true)
  assert.equal(taskLink(task.key), undefined)
  assert.equal(calls.at(-1)!.name, 'delete')
  assert.equal(events.has(replaced.id), false)
  await assert.rejects(scheduleTask(task, { day: 'x', time: 'y', minutes: 1 }), /inválido/)
})

test('plano real: concluir pergunta antes de remover; manter grava a escolha; remover apaga o evento', async () => {
  calls.length = 0
  const page = actions.createPage(null, { title: 'Projeto' })
  await actions.flushMeta()
  const entry = (text: string, checked = false) => ({ blockId: 'x1', text, checked, date: '2026-10-10T15:00:00.000Z', time: '' })
  __setChecklistForTest(page, [entry('Enviar proposta')])
  const key = `c:${page}:x1`
  const task = { key, kind: 'checklist' as const, pageId: page, blockId: 'x1', title: 'Enviar proposta', due: '2026-10-10', sourceId: page, sourceTitle: 'Projeto' }
  await scheduleTask(task, { day: '2026-10-10', time: '09:00', minutes: 30 })
  assert.deepEqual(currentSyncPlan().filter(action => action.key === key), [])
  // Renomear a tarefa: ação silenciosa que atualiza o evento.
  __setChecklistForTest(page, [entry('Enviar proposta revisada')])
  const rename = currentSyncPlan().find(action => action.key === key)!
  assert.equal(rename.kind, 'rename')
  await applySyncAction(rename, true)
  assert.equal(calls.at(-1)!.name, 'update')
  assert.equal(calls.at(-1)!.input.title, 'Enviar proposta revisada')
  assert.equal(taskLink(key)!.title, 'Enviar proposta revisada')
  // Concluir: só pergunta. "Manter" guarda a escolha e não repergunta.
  __setChecklistForTest(page, [entry('Enviar proposta revisada', true)])
  const done = currentSyncPlan().find(action => action.key === key)!
  assert.equal(done.kind, 'done')
  const before = calls.length
  await applySyncAction(done, false)
  assert.equal(calls.length, before, 'nada foi apagado')
  assert.equal(taskLink(key)!.keepEvent, true)
  assert.deepEqual(currentSyncPlan().filter(action => action.key === key), [])
  // Outro vínculo: confirmar remove o evento do Calendário.
  updateCalendarSettings(current => ({ ...current, taskLinks: { ...current.taskLinks, [key]: { ...current.taskLinks![key], keepEvent: false } } }))
  await applySyncAction({ kind: 'done', key }, true)
  assert.equal(calls.at(-1)!.name, 'delete')
  assert.equal(taskLink(key), undefined)
  assert.equal(getState().settings.calendarIntegration?.taskLinks?.[key], undefined)
})

test('prazo mudou: mover atualiza o evento mantendo a duração; manter só registra o novo prazo', async () => {
  calls.length = 0
  const page = actions.createPage(null, { title: 'Reuniões' })
  const entry = (date: string) => ({ blockId: 'm1', text: 'Reunião', checked: false, date })
  __setChecklistForTest(page, [entry('2026-10-10T15:00:00.000Z')])
  const key = `c:${page}:m1`
  const task = { key, kind: 'checklist' as const, pageId: page, blockId: 'm1', title: 'Reunião', due: '2026-10-10', sourceId: page, sourceTitle: 'Reuniões' }
  await scheduleTask(task, { day: '2026-10-10', time: '14:00', minutes: 60 })
  __setChecklistForTest(page, [entry('2026-10-14T15:00:00.000Z')])
  const moved = currentSyncPlan().find(action => action.key === key)!
  assert.equal(moved.kind, 'moved')
  await applySyncAction(moved, true)
  const update = calls.at(-1)!
  assert.equal(update.name, 'update')
  assert.equal(Date.parse(update.input.end) - Date.parse(update.input.start), 60 * 60_000)
  assert.equal(taskLink(key)!.due, '2026-10-14')
  assert.deepEqual(currentSyncPlan().filter(action => action.key === key), [])
  __setChecklistForTest(page, [entry('2026-10-20T15:00:00.000Z')])
  const again = currentSyncPlan().find(action => action.key === key)!
  const count = calls.length
  await applySyncAction(again, false)
  assert.equal(calls.length, count, 'manter não mexe no evento')
  assert.equal(taskLink(key)!.due, '2026-10-20')
  assert.deepEqual(currentSyncPlan().filter(action => action.key === key), [])
})
