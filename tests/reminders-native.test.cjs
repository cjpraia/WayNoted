const PRODUCT = require('../shared/product.json')
// Lembretes do macOS (C3b), lado do processo principal: validação das entradas e comandos enviados ao helper (simulado).
const test = require('node:test')
const assert = require('node:assert/strict')
const { createRemindersService, registerRemindersIpc, reminderFields, validDay } = require('../electron/apple-reminders.cjs')

function service() {
  const calls = []
  const run = async (args, input, options) => {
    calls.push({ args, input, options })
    if (args[1] === 'status' || args[1] === 'request') return { authorization: 'fullAccess' }
    if (args[1] === 'ensure-list') return { list: { id: 'L', title: input.title, source: 'iCloud', allowsModify: true }, created: true }
    if (args[1] === 'list') return { reminders: [{ id: 'r1' }] }
    if (args[1] === 'delete') return { deleted: true }
    return { reminder: { id: 'r1', ...input } }
  }
  return { calls, svc: createRemindersService({ run, available: () => ({ available: true }) }) }
}

test('status e pedido de permissão: o pedido tem tempo longo e só acontece quando chamado', async () => {
  const { calls, svc } = service()
  assert.deepEqual(await svc.status(), { available: true, authorization: 'fullAccess' })
  assert.equal(calls.length, 1)
  await svc.requestAccess()
  assert.deepEqual(calls[1].args, ['reminders', 'request'])
  assert.equal(calls[1].options.timeout, 5 * 60_000)
  const missing = createRemindersService({ available: () => ({ available: false, reason: 'NATIVE_HELPER_MISSING' }) })
  assert.deepEqual(await missing.status(), { available: false, reason: 'NATIVE_HELPER_MISSING', authorization: 'unavailable' })
})

test('lista, criar, atualizar, concluir e apagar enviam ao helper só campos validados', async () => {
  const { calls, svc } = service()
  assert.equal((await svc.ensureList({ title: `  ${PRODUCT.name} `, id: 'abc' })).created, true)
  assert.deepEqual(calls.at(-1).input, { title: `${PRODUCT.name}`, id: 'abc' })
  assert.deepEqual(await svc.list({ listId: 'L' }), { reminders: [{ id: 'r1' }] })
  await svc.upsert({ listId: 'L', title: 'Pagar conta', notes: 'n', url: "workspace://page/x#block=b", due: { date: '2026-10-10', time: '09:30' }, completed: false, injected: 'x' })
  assert.deepEqual(calls.at(-1).input, { title: 'Pagar conta', notes: 'n', url: "workspace://page/x#block=b", completed: false, due: { date: '2026-10-10', time: '09:30' }, listId: 'L' })
  await svc.upsert({ id: 'r1', due: null, completed: true })
  assert.deepEqual(calls.at(-1).input, { due: null, completed: true, id: 'r1' })
  await svc.complete({ id: 'r1' })
  assert.deepEqual(calls.at(-1).input, { id: 'r1', completed: true })
  await svc.complete({ id: 'r1', completed: false })
  assert.equal(calls.at(-1).input.completed, false)
  assert.deepEqual(await svc.remove({ id: 'r1' }), { deleted: true })
})

test('entradas inválidas são recusadas antes de chegar ao helper', async () => {
  const { calls, svc } = service()
  const rejects = async (promise, field) => assert.rejects(promise, new RegExp(`INVALID_INPUT: Invalid ${field}`))
  await rejects(svc.ensureList({ title: '  ' }), 'title')
  await rejects(svc.list({}), 'listId')
  await rejects(svc.upsert({ title: 'sem lista' }), 'listId')
  await rejects(svc.upsert({ listId: 'L' }), 'title')
  await rejects(svc.upsert({ listId: 'L', title: 'x', url: 'https://evil.example' }), 'url')
  await rejects(svc.upsert({ listId: 'L', title: 'x', due: { date: '2026-02-31' } }), 'due')
  await rejects(svc.upsert({ listId: 'L', title: 'x', due: { date: '2026-10-10', time: '25:00' } }), 'due')
  await rejects(svc.upsert({ listId: 'L', title: 'x'.repeat(501) }), 'title')
  await rejects(svc.upsert({ listId: 'L', title: 'x', completed: 'sim' }), 'completed')
  await rejects(svc.complete(null), 'id')
  await rejects(svc.remove({ id: '' }), 'id')
  assert.equal(calls.length, 0)
  assert.equal(validDay('2026-10-10'), true)
  assert.equal(validDay('2026-13-01'), false)
  assert.deepEqual(reminderFields({ notes: 'a' }), { notes: 'a' })
})

test('registerRemindersIpc registra os sete canais no trustedHandler', () => {
  const names = []
  registerRemindersIpc((name, handler) => { names.push(name); assert.equal(typeof handler, 'function') }, service().svc)
  assert.deepEqual(names.sort(), ['np:remindersComplete', 'np:remindersDelete', 'np:remindersEnsureList', 'np:remindersList', 'np:remindersRequestAccess', 'np:remindersStatus', 'np:remindersUpsert'])
})
