import test from 'node:test'
import assert from 'node:assert/strict'
import {
  occurrenceStarts, nextOccurrenceAfter, advanceDateValue, describeRecurrence, recurrenceRule, wallTimeToEpoch,
  reminderInstant, reconcileDateReminders, doneProperty, isDoneValue,
} from '../electron/recurrence.mjs'
import { collectDueReminders } from '../electron/reminders.mjs'
import { applyPreset, presetOf, patchRecurrence, recurringCompletions, completionSummary, localISODate } from '../src/recurrence.ts'
import { dateOccurrences } from '../src/components/database/recurrence.ts'

const starts = (value: any, from: string, to: string, limit?: number) => occurrenceStarts(value, from, to, limit).map((o: any) => o.start)

test('dados antigos: repeat sem recurrence mantém intervalo 1 sem fim', () => {
  assert.deepEqual(recurrenceRule({ start: '2026-10-07', repeat: 'weekly' }), { freq: 'weekly', interval: 1, weekdays: [3], monthly: undefined, until: undefined, count: undefined, anchor: '2026-10-07' })
  assert.equal(recurrenceRule({ start: '2026-10-07' }), null)
  assert.equal(recurrenceRule({ start: '2026-10-07', repeat: 'none' }), null)
  assert.equal(recurrenceRule({ start: '2026-02-30', repeat: 'daily' }), null)
  assert.equal(recurrenceRule({ start: '2026-10-07', repeat: 'hourly' } as any), null)
})

test('diária, a cada N dias e dias úteis', () => {
  assert.deepEqual(starts({ start: '2026-10-07', repeat: 'daily' }, '2026-10-07', '2026-10-10'), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
  assert.deepEqual(starts({ start: '2026-10-07', repeat: 'daily', recurrence: { interval: 3 } }, '2026-10-08', '2026-10-20'), ['2026-10-10', '2026-10-13', '2026-10-16', '2026-10-19'])
  // Dias úteis começando numa sexta: pula sábado/domingo.
  assert.deepEqual(starts({ start: '2026-10-09', repeat: 'weekly', recurrence: { weekdays: [1, 2, 3, 4, 5] } }, '2026-10-01', '2026-10-14'), ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'])
})

test('semanal em dias escolhidos e a cada 2 semanas', () => {
  const monWed = { start: '2026-10-07', repeat: 'weekly' as const, recurrence: { weekdays: [1, 3] } }
  assert.deepEqual(starts(monWed, '2026-10-01', '2026-10-21'), ['2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19', '2026-10-21'])
  const biweekly = { start: '2026-10-05', repeat: 'weekly' as const, recurrence: { interval: 2, weekdays: [1, 5] } }
  assert.deepEqual(starts(biweekly, '2026-10-01', '2026-11-03'), ['2026-10-05', '2026-10-09', '2026-10-19', '2026-10-23', '2026-11-02'])
  // Janela distante usa salto direto e ordinais corretos.
  const far = occurrenceStarts(monWed, '2030-01-01', '2030-01-08')
  assert.deepEqual(far.map((o: any) => o.start), ['2030-01-02', '2030-01-07'])
  const all = occurrenceStarts(monWed, '2026-10-07', '2030-01-02', 1000)
  assert.equal(all.at(-1)!.start, '2030-01-02'); assert.equal(all.at(-1)!.ordinal, all.length - 1)
})

test('mensal por dia com fim de mês, por "2ª terça" e "última sexta"', () => {
  assert.deepEqual(starts({ start: '2026-01-31', repeat: 'monthly' }, '2026-01-01', '2026-05-31'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  assert.deepEqual(starts({ start: '2024-01-31', repeat: 'monthly' }, '2024-02-01', '2024-02-29'), ['2024-02-29'])
  // 13/10/2026 é a 2ª terça.
  assert.deepEqual(starts({ start: '2026-10-13', repeat: 'monthly', recurrence: { monthly: 'weekday' } }, '2026-10-01', '2027-01-31'), ['2026-10-13', '2026-11-10', '2026-12-08', '2027-01-12'])
  // 30/10/2026 é a última (5ª) sexta → vira "última".
  assert.deepEqual(starts({ start: '2026-10-30', repeat: 'monthly', recurrence: { monthly: 'weekday' } }, '2026-10-01', '2027-01-31'), ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29'])
  assert.deepEqual(starts({ start: '2026-10-23', repeat: 'monthly', recurrence: { monthly: 'lastWeekday' } }, '2026-10-01', '2026-12-31'), ['2026-10-30', '2026-11-27', '2026-12-25'])
  assert.deepEqual(starts({ start: '2026-01-15', repeat: 'monthly', recurrence: { interval: 3 } }, '2026-01-01', '2026-12-31'), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
})

test('anual com 29/02 e a cada N anos', () => {
  assert.deepEqual(starts({ start: '2024-02-29', repeat: 'yearly' }, '2024-01-01', '2028-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  assert.deepEqual(starts({ start: '2026-10-07', repeat: 'yearly', recurrence: { interval: 2 } }, '2026-01-01', '2031-12-31'), ['2026-10-07', '2028-10-07', '2030-10-07'])
})

test('fim por data (inclusiva) e por contagem', () => {
  assert.deepEqual(starts({ start: '2026-10-07', repeat: 'daily', recurrence: { until: '2026-10-09' } }, '2026-10-01', '2026-12-31'), ['2026-10-07', '2026-10-08', '2026-10-09'])
  assert.deepEqual(starts({ start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 3], count: 3 } }, '2026-10-01', '2026-12-31'), ['2026-10-07', '2026-10-12', '2026-10-14'])
  // A contagem é preservada após avançar (âncora gravada na regra).
  let value: any = { start: '2026-10-07', repeat: 'daily', recurrence: { count: 3 } }
  value = advanceDateValue(value, '2026-10-07'); assert.equal(value.start, '2026-10-08'); assert.equal(value.recurrence.anchor, '2026-10-07')
  value = advanceDateValue(value, '2026-10-08'); assert.equal(value.start, '2026-10-09')
  assert.equal(advanceDateValue(value, '2026-10-09'), null)
  assert.equal(nextOccurrenceAfter({ start: '2026-10-07', repeat: 'daily', recurrence: { until: '2026-10-07' } }, '2026-10-07'), null)
})

test('avançar: próxima ocorrência não passada, preserva duração, hora e fim de mês', () => {
  const v: any = { start: '2026-01-31', end: '2026-02-01', startTime: '09:30', timeZone: 'America/Sao_Paulo', repeat: 'monthly', reminder: 15 }
  const a = advanceDateValue(v, '2026-01-31')!
  assert.deepEqual([a.start, a.end, a.startTime, a.timeZone, a.reminder], ['2026-02-28', '2026-03-01', '09:30', 'America/Sao_Paulo', 15])
  assert.equal(advanceDateValue(a, '2026-02-28')!.start, '2026-03-31')
  // Atrasada há uma semana (diária): pula para hoje em vez de cobrar cada dia perdido.
  assert.equal(advanceDateValue({ start: '2026-09-30', repeat: 'daily' }, '2026-10-07')!.start, '2026-10-07')
  // Concluída antes do prazo: vai para a ocorrência seguinte à atual.
  assert.equal(advanceDateValue({ start: '2026-10-12', repeat: 'weekly' }, '2026-10-07')!.start, '2026-10-19')
  assert.equal(advanceDateValue({ start: '2024-02-29', repeat: 'yearly' }, '2024-02-29')!.start, '2025-02-28')
  assert.equal(advanceDateValue(advanceDateValue({ start: '2024-02-29', repeat: 'yearly' }, '2024-02-29')!, '2025-02-28')!.start, '2026-02-28')
  assert.equal(advanceDateValue({ start: '2026-10-07' }, '2026-10-07'), null)
})

test('resumos legíveis em pt-BR e en-US', () => {
  assert.equal(describeRecurrence({ start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 3], until: '2026-12-31' } }, 'pt-BR'), 'Toda segunda e quarta, até 31/12')
  assert.equal(describeRecurrence({ start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 3], until: '2027-12-31' } }, 'en-US'), 'Every Monday and Wednesday, until 12/31/2027')
  assert.equal(describeRecurrence({ start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 2, 3, 4, 5] } }, 'pt-BR'), 'Todo dia útil')
  assert.equal(describeRecurrence({ start: '2026-10-10', repeat: 'weekly' }, 'pt-BR'), 'Todo sábado')
  assert.equal(describeRecurrence({ start: '2026-10-07', repeat: 'daily', recurrence: { interval: 2, count: 5 } }, 'pt-BR'), 'A cada 2 dias, 5 vezes')
  assert.equal(describeRecurrence({ start: '2026-10-13', repeat: 'monthly', recurrence: { monthly: 'weekday' } }, 'pt-BR'), 'Todo mês na 2ª terça')
  assert.equal(describeRecurrence({ start: '2026-10-13', repeat: 'monthly', recurrence: { monthly: 'weekday' } }, 'en-US'), 'Every month on the 2nd Tuesday')
  assert.equal(describeRecurrence({ start: '2026-10-31', repeat: 'monthly', recurrence: { monthly: 'lastWeekday' } }, 'pt-BR'), 'Todo mês no último sábado')
  assert.equal(describeRecurrence({ start: '2026-10-15', repeat: 'monthly' }, 'en-US'), 'Every month on day 15')
  assert.equal(describeRecurrence({ start: '2026-10-08', repeat: 'yearly' }, 'pt-BR'), 'Todo ano em 8 de outubro')
  assert.equal(describeRecurrence({ start: '2026-10-08' }, 'pt-BR'), '')
})

test('presets e regra personalizada', () => {
  const base: any = { start: '2026-10-13', startTime: '08:00', reminder: 5 }
  assert.equal(presetOf(base), 'none')
  for (const preset of ['daily', 'weekdays', 'weekly', 'monthly', 'monthlyWeekday', 'yearly'] as const) assert.equal(presetOf(applyPreset(base, preset)), preset)
  const custom = patchRecurrence(applyPreset(base, 'weekly'), { weekdays: [1, 4], until: '2026-12-31' })
  assert.equal(presetOf(custom), 'custom'); assert.equal(custom.startTime, '08:00'); assert.equal(custom.reminder, 5)
  assert.deepEqual(patchRecurrence(custom, { weekdays: [], until: undefined, interval: 1 }).recurrence, undefined)
  assert.equal(applyPreset(custom, 'none').repeat, 'none'); assert.equal(applyPreset(custom, 'none').recurrence, undefined)
})

test('fuso: hora civil, salto e recuo do horário de verão', () => {
  // São Paulo sem DST desde 2019: 09:00 = 12:00Z.
  assert.equal(wallTimeToEpoch('2026-10-07', '09:00', 'America/Sao_Paulo'), Date.UTC(2026, 9, 7, 12))
  // Nova York: 08/03/2026 02:30 não existe → 03:30 EDT (07:30Z).
  assert.equal(wallTimeToEpoch('2026-03-08', '02:30', 'America/New_York'), Date.UTC(2026, 2, 8, 7, 30))
  // 01/11/2026 01:30 acontece duas vezes → a primeira (EDT, 05:30Z).
  assert.equal(wallTimeToEpoch('2026-11-01', '01:30', 'America/New_York'), Date.UTC(2026, 10, 1, 5, 30))
  // Ocorrência diária às 09:00 mantém a hora de parede atravessando o DST.
  const v: any = { start: '2026-03-07', startTime: '09:00', timeZone: 'America/New_York', repeat: 'daily' }
  assert.equal(reminderInstant(v, '2026-03-07', 0, 'UTC'), Date.UTC(2026, 2, 7, 14))
  assert.equal(reminderInstant(v, '2026-03-09', 0, 'UTC'), Date.UTC(2026, 2, 9, 13))
  // "1 dia antes" é civil: mesma hora de parede no dia anterior, mesmo com troca de offset.
  assert.equal(reminderInstant(v, '2026-03-09', 1440, 'UTC'), Date.UTC(2026, 2, 8, 13))
  assert.equal(reminderInstant(v, '2026-03-09', 15, 'UTC'), Date.UTC(2026, 2, 9, 12, 45))
  // Sem hora: 09:00 no fuso de referência.
  assert.equal(reminderInstant({ start: '2026-10-07' }, '2026-10-07', 60, 'Europe/London'), Date.UTC(2026, 9, 7, 7))
  assert.equal(wallTimeToEpoch('2026-10-07', '25:00', 'UTC'), null)
  assert.equal(wallTimeToEpoch('2026-10-07', '09:00', 'Mars/Base'), null)
})

test('Ásia/Calcutá e Austrália: offsets fracionários e DST do hemisfério sul', () => {
  assert.equal(wallTimeToEpoch('2026-10-07', '09:00', 'Asia/Kolkata'), Date.UTC(2026, 9, 7, 3, 30))
  // Sydney avança em 04/10/2026 02:00 → 03:00.
  assert.equal(wallTimeToEpoch('2026-10-04', '02:15', 'Australia/Sydney'), Date.UTC(2026, 9, 3, 16, 15))
})

const statusProp = { id: 'status', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'doing', name: 'Fazendo', color: 'blue', group: 'progress' }, { id: 'done', name: 'Concluído', color: 'green', group: 'complete' }] }
const schemaWith = (dateExtra = {}, extraProps: any[] = []) => ({ properties: [{ id: 'title', name: 'Nome', type: 'title' }, statusProp, { id: 'check', name: 'Feito', type: 'checkbox' }, { id: 'due', name: 'Prazo', type: 'date', ...dateExtra }, ...extraProps], views: [], activeViewId: 'v' }) as any

test('propriedade de conclusão: status por padrão, checkbox designado ou desligado', () => {
  const schema = schemaWith()
  assert.equal(doneProperty(schema, schema.properties[3])!.id, 'status')
  assert.equal(doneProperty(schemaWith({ recurrenceDoneProperty: 'check' }), schemaWith({ recurrenceDoneProperty: 'check' }).properties[3])!.id, 'check')
  assert.equal(doneProperty(schemaWith({ recurrenceDoneProperty: 'none' }), schemaWith({ recurrenceDoneProperty: 'none' }).properties[3]), null)
  assert.equal(isDoneValue(statusProp as any, 'done'), true); assert.equal(isDoneValue(statusProp as any, 'doing'), false)
  assert.equal(isDoneValue({ id: 'c', name: 'c', type: 'checkbox' } as any, true), true)
})

test('concluir: avança (padrão) ou cria cópia, com histórico e reinício do status', () => {
  const now = new Date(2026, 9, 7, 15).getTime()
  const row: any = { id: 'r', parentId: 'db', title: 'Regar plantas', props: { status: 'doing', due: { start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 3] }, reminder: 30 } } }
  const [plan] = recurringCompletions(schemaWith(), row, 'status', 'doing', 'done', now)
  assert.equal(plan.mode, 'advance'); assert.equal(plan.nextDate!.start, '2026-10-12'); assert.equal(plan.nextDate!.reminder, 30)
  assert.equal(plan.resetValue, 'todo'); assert.equal(plan.nextDate!.completedCount, 1); assert.deepEqual(plan.nextDate!.completions, [now])
  assert.equal(completionSummary(plan.nextDate!, 'en-US').startsWith('Completed 1×'), true)
  // Sem transição (já estava concluída) ou outra propriedade: nada a fazer.
  assert.deepEqual(recurringCompletions(schemaWith(), row, 'status', 'done', 'done', now), [])
  assert.deepEqual(recurringCompletions(schemaWith(), row, 'check', false, true, now), [])
  const [copy] = recurringCompletions(schemaWith({ recurrenceOnComplete: 'copy' }), row, 'status', 'todo', 'done', now)
  assert.equal(copy.mode, 'copy'); assert.equal(copy.currentDate.repeat, 'none'); assert.equal(copy.nextDate!.repeat, 'weekly')
  const [checkbox] = recurringCompletions(schemaWith({ recurrenceDoneProperty: 'check' }), row, 'check', false, true, now)
  assert.equal(checkbox.resetValue, false)
  // Série terminada: continua concluída e só registra o histórico.
  const ended: any = { ...row, props: { ...row.props, due: { start: '2026-10-07', repeat: 'daily', recurrence: { until: '2026-10-07' } } } }
  const [last] = recurringCompletions(schemaWith(), ended, 'status', 'todo', 'done', now)
  assert.equal(last.nextDate, null); assert.equal(last.currentDate.completedCount, 1)
  assert.equal(localISODate(now), '2026-10-07')
})

test('calendário: ocorrência atual sólida, futuras projetadas, a partir da data atual', () => {
  const value: any = { start: '2026-02-28', repeat: 'monthly', recurrence: { anchor: '2026-01-31' } }
  const list = dateOccurrences('r', value, '2026-01-01', '2026-05-31')
  assert.deepEqual(list.map((o) => [o.start, !!o.projected]), [['2026-02-28', false], ['2026-03-31', true], ['2026-04-30', true], ['2026-05-31', true]])
  const weekly = dateOccurrences('w', { start: '2026-10-07', repeat: 'weekly', recurrence: { weekdays: [1, 3], until: '2026-10-19' } } as any, '2026-10-01', '2026-10-31')
  assert.deepEqual(weekly.map((o) => o.start), ['2026-10-07', '2026-10-12', '2026-10-14', '2026-10-19'])
})

const pagesFor = (due: any, extra: any = {}) => ({
  db: { id: 'db', parentId: null, trashed: false, database: schemaWith() },
  r: { id: 'r', parentId: 'db', trashed: false, title: 'Pagar conta', props: { status: 'todo', due }, ...extra },
}) as any

test('lembretes acompanham a recorrência e reaparecem para a próxima ocorrência', () => {
  const zone = 'America/Sao_Paulo'
  const due = { start: '2026-10-07', startTime: '10:00', repeat: 'daily', reminder: 15 }
  const before = Date.UTC(2026, 9, 7, 12) // 09:00 local
  let { notifications, changed } = reconcileDateReminders({}, pagesFor(due), before, { timeZone: zone, locale: 'pt-BR' })
  assert.equal(changed, true)
  const first = Object.values(notifications)[0] as any
  assert.equal(first.id, 'date-reminder:r:due:2026-10-07'); assert.equal(first.dueAt, Date.UTC(2026, 9, 7, 12, 45))
  assert.match(first.body, /Vence .* 10:00 · ↻ Todo dia/)
  // Idempotente.
  assert.equal(reconcileDateReminders(notifications, pagesFor(due), before, { timeZone: zone }).changed, false)
  // Dispara; a próxima ocorrência é agendada (amanhã 09:45 local), o disparo fica no histórico.
  const fireAt = Date.UTC(2026, 9, 7, 12, 46)
  const fired = collectDueReminders(notifications, pagesFor(due), fireAt, () => 'unused')
  assert.equal(fired.due.length, 1)
  ;({ notifications } = reconcileDateReminders(fired.notifications, pagesFor(due), fireAt, { timeZone: zone }))
  assert.equal((notifications['date-reminder:r:due:2026-10-08'] as any).dueAt, Date.UTC(2026, 9, 8, 12, 45))
  assert.equal(notifications['date-reminder:r:due:2026-10-07'].firedAt, fireAt)
  // Ao concluir/avançar a linha, o pendente antigo some e o novo segue a nova data.
  const moved = { ...due, start: '2026-10-09' }
  ;({ notifications } = reconcileDateReminders(notifications, pagesFor(moved), fireAt, { timeZone: zone }))
  assert.equal(notifications['date-reminder:r:due:2026-10-08'], undefined)
  assert.ok(notifications['date-reminder:r:due:2026-10-09'])
  // Linha concluída (status no grupo Concluído) ou na lixeira: sem lembrete pendente.
  assert.deepEqual(Object.keys(reconcileDateReminders(notifications, pagesFor(moved, { props: { status: 'done', due: moved } }), fireAt, { timeZone: zone }).notifications).filter((id) => !notifications[id]?.firedAt), [])
  assert.equal(Object.values(reconcileDateReminders(notifications, pagesFor(moved, { trashed: true }), fireAt, { timeZone: zone }).notifications).filter((n: any) => n.firedAt == null).length, 0)
})

test('lembrete excluído ou adiado na Caixa de entrada não volta a disparar', () => {
  const zone = 'UTC'
  const due = { start: '2026-10-07', startTime: '10:00', reminder: 0 }
  const now = Date.UTC(2026, 9, 7, 11)
  let { notifications } = reconcileDateReminders({}, pagesFor(due), now, { timeZone: zone })
  const id = 'date-reminder:r:due:2026-10-07'
  // Excluído: marcador (dismissedAt + firedAt) impede recriação.
  notifications = { [id]: { ...notifications[id], firedAt: now, readAt: now, dismissedAt: now } } as any
  assert.equal(reconcileDateReminders(notifications, pagesFor(due), now, { timeZone: zone }).changed, false)
  // Quando a data muda, o marcador obsoleto é limpo.
  const after = reconcileDateReminders(notifications, pagesFor({ ...due, start: '2026-10-10' }), now, { timeZone: zone }).notifications
  assert.equal(after[id], undefined)
  // Adiado: mantém o novo horário.
  const snoozed = { [id]: { ...notifications[id], firedAt: null, readAt: null, dismissedAt: undefined, dueAt: now + 600000, source: { kind: 'date', rowId: 'r', propertyId: 'due', occurrence: '2026-10-07', snoozed: true } } } as any
  assert.equal(reconcileDateReminders(snoozed, pagesFor(due), now, { timeZone: zone }).notifications[id].dueAt, now + 600000)
})

test('menção de data em to-do avança mantendo a hora local', async () => {
  const { advanceMentionDate } = await import('../src/recurrence.ts')
  const at = new Date(2026, 9, 9, 8, 30) // sexta
  const next = new Date(advanceMentionDate(at.toISOString(), 'weekdays', at.getTime())!)
  assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()], [2026, 9, 12, 8, 30])
  assert.equal(new Date(advanceMentionDate(at.toISOString(), 'monthly', at.getTime())!).getDate(), 9)
  assert.equal(advanceMentionDate(at.toISOString(), 'hourly'), null)
  assert.equal(advanceMentionDate('nope', 'daily'), null)
})
