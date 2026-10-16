// Automações de banco (A4): gatilhos novos, condições, ações novas, "Testar" (prévia), "data chegou", registro e proteção contra laços.
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendLog, automationsFor, conditionPasses, conditionsPass, dateArrivals, describeAction, describeTrigger, fillTemplate, previewAutomation, AUTOMATION_LOG_LIMIT } from '../src/components/database/automations.ts'
import type { DatabaseAutomation } from '../src/database-models.ts'
import type { DatabaseSchema, Page } from '../src/types.ts'

const schema = (over: Partial<DatabaseSchema> = {}): DatabaseSchema => ({
  properties: [
    { id: 'title', name: 'Nome', type: 'title' },
    { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] },
    { id: 'pr', name: 'Prioridade', type: 'select', options: [{ id: 'hi', name: 'Alta', color: 'red' }, { id: 'lo', name: 'Baixa', color: 'gray' }] },
    { id: 'tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'a', name: 'A', color: 'blue' }, { id: 'b', name: 'B', color: 'pink' }] },
    { id: 'dt', name: 'Data', type: 'date' },
    { id: 'ok', name: 'Revisado', type: 'checkbox' },
  ],
  views: [], activeViewId: '', ...over,
} as DatabaseSchema)
const row = (props: Record<string, unknown>, title = 'Linha', id = 'r1'): Page => ({ id, parentId: 'db', title, props } as unknown as Page)
const auto = (over: Partial<DatabaseAutomation> = {}): DatabaseAutomation => ({ id: 'a1', name: 'Regra', enabled: true, trigger: { kind: 'rowCreated' }, actions: [], ...over })
const ctx = { t: (pt: string, _en: string, vars?: Record<string, string | number>) => pt.replace(/\{(\w+)\}/g, (_m, key) => String(vars?.[key] ?? '')), typeName: (id: string) => (id === 'ty' ? 'Urgente' : undefined), pageTitle: (id: string) => (id === 'other' ? 'Arquivo' : undefined) }

test('gatilhos: só regras ligadas que respondem ao evento (propriedade, tipo específico ou qualquer)', () => {
  const s = schema({ automations: [
    auto({ id: 'p', trigger: { kind: 'propertyChange', propertyId: 'st' } }), auto({ id: 'q', trigger: { kind: 'propertyChange', propertyId: 'pr' } }),
    auto({ id: 'c', trigger: { kind: 'rowCreated' } }), auto({ id: 't1', trigger: { kind: 'typeAdded', typeId: 'ty' } }), auto({ id: 't2', trigger: { kind: 'typeAdded' } }),
    auto({ id: 'd', trigger: { kind: 'taskCompleted' } }), auto({ id: 'off', enabled: false, trigger: { kind: 'rowCreated' } }),
  ] })
  const ids = (event: Parameters<typeof automationsFor>[1]) => automationsFor(s, event).map(item => item.id)
  assert.deepEqual(ids({ kind: 'propertyChange', propertyId: 'st' }), ['p'])
  assert.deepEqual(ids({ kind: 'rowCreated' }), ['c'])
  assert.deepEqual(ids({ kind: 'typeAdded', typeId: 'ty' }), ['t1', 't2'])
  assert.deepEqual(ids({ kind: 'typeAdded', typeId: 'outro' }), ['t2'])
  assert.deepEqual(ids({ kind: 'taskCompleted' }), ['d'])
})

test('condições: igual, diferente, contém, vazio e preenchido em título, select, múltipla, checkbox e número', () => {
  const r = row({ st: 'todo', pr: 'hi', tags: ['a', 'b'], ok: true, n: 5, dt: { start: '2026-10-10' }, txt: 'Comprar PÃO integral' }, 'Revisar contrato URGENTE')
  const pass = (propertyId: string, op: any, value?: any) => conditionPasses({ propertyId, op, value }, r)
  assert.equal(pass('st', 'equals', 'todo'), true)
  assert.equal(pass('st', 'equals', 'done'), false)
  assert.equal(pass('st', 'notEquals', 'done'), true)
  assert.equal(pass('tags', 'contains', 'b'), true)
  assert.equal(pass('tags', 'contains', 'z'), false)
  assert.equal(pass('tags', 'equals', 'a'), false, 'duas tags: não é igual a uma só')
  assert.equal(pass('ok', 'equals', true), true)
  assert.equal(pass('n', 'equals', 5), true)
  assert.equal(pass('dt', 'equals', '2026-10-10'), true)
  assert.equal(pass('txt', 'contains', 'pão'), true, 'sem diferenciar maiúsculas')
  assert.equal(pass('@title', 'contains', 'urgente'), true)
  assert.equal(pass('@title', 'contains', ''), false, 'texto vazio nunca "contém"')
  assert.equal(pass('missing', 'empty'), true)
  assert.equal(pass('st', 'notEmpty'), true)
  assert.equal(pass('ok', 'empty'), false)
  const result = conditionsPass([{ propertyId: 'st', op: 'equals', value: 'todo' }, { propertyId: 'pr', op: 'equals', value: 'lo' }], r)
  assert.equal(result.pass, false)
  assert.deepEqual(result.failed.map(item => item.propertyId), ['pr'])
  assert.equal(conditionsPass(undefined, r).pass, true)
})

test('"data chegou": a primeira avaliação só marca o passado; depois dispara uma vez por data, com deslocamento', () => {
  const s = schema()
  const rows = [row({ dt: { start: '2026-10-01' } }, 'Passada', 'a'), row({ dt: { start: '2026-10-12' } }, 'Futura', 'b'), row({}, 'Sem data', 'c')]
  const rule = auto({ trigger: { kind: 'dateArrived', propertyId: 'dt' } })
  const first = dateArrivals(s, rows, rule, '2026-10-09')!
  assert.deepEqual([first.seeded, first.fire, first.fired], [true, [], { a: '2026-10-01' }])
  const seeded = { ...rule, fired: first.fired }
  assert.deepEqual(dateArrivals(s, rows, seeded, '2026-10-09')!.fire, [])
  const day = dateArrivals(s, rows, seeded, '2026-10-12')!
  assert.deepEqual([day.seeded, day.fire], [false, ['b']])
  assert.deepEqual(dateArrivals(s, rows, { ...seeded, fired: day.fired }, '2026-10-13')!.fire, [], 'não repete a mesma data')
  // Mudar a data da linha dispara de novo.
  const moved = [rows[0], row({ dt: { start: '2026-10-14' } }, 'Futura', 'b')]
  assert.deepEqual(dateArrivals(s, moved, { ...seeded, fired: day.fired }, '2026-10-14')!.fire, ['b'])
  // Dois dias antes (deslocamento negativo) e dois depois.
  const before = auto({ trigger: { kind: 'dateArrived', propertyId: 'dt', offsetDays: -2 }, fired: {} })
  assert.deepEqual(dateArrivals(s, rows, before, '2026-10-10')!.fire, ['a', 'b'])
  const after = auto({ trigger: { kind: 'dateArrived', propertyId: 'dt', offsetDays: 2 }, fired: {} })
  assert.deepEqual(dateArrivals(s, rows, after, '2026-10-13')!.fire, ['a'])
  // Linhas que sumiram saem do controle.
  assert.deepEqual(dateArrivals(s, [], { ...seeded, fired: { gone: '2026-10-01' } }, '2026-10-09')!.fired, {})
  assert.equal(dateArrivals(s, rows, auto(), '2026-10-09'), null)
  assert.equal(dateArrivals(s, rows, auto({ trigger: { kind: 'dateArrived', propertyId: 'nope' } }), '2026-10-09'), null)
})

test('prévia do "Testar": mostra condições, passos concretos e o que seria ignorado, sem escrever nada', () => {
  const s = schema()
  const rule = auto({
    trigger: { kind: 'typeAdded', typeId: 'ty' },
    conditions: [{ propertyId: 'pr', op: 'equals', value: 'hi' }, { propertyId: '@title', op: 'contains', value: 'contrato' }],
    actions: [{ kind: 'setProperty', propertyId: 'st', value: 'done' }, { kind: 'createTask', title: 'Revisar: {titulo}', inDays: 2 }, { kind: 'addType', typeId: 'ty' }, { kind: 'notify', message: 'Olha {titulo}' }, { kind: 'moveRow', databaseId: 'other' }, { kind: 'setProperty', propertyId: 'removida', value: 'x' }],
  })
  const ok = previewAutomation(s, rule, row({ pr: 'hi' }, 'Contrato Acme'), ctx)
  assert.equal(ok.wouldRun, true)
  assert.equal(ok.trigger, 'Quando a tag/tipo “Urgente” for adicionado')
  assert.deepEqual(ok.conditions.map(item => item.pass), [true, true])
  assert.deepEqual(ok.steps, [
    'Definir “Status” como “Feito”', 'Criar a tarefa “Revisar: Contrato Acme” para daqui a 2 dia(s) na linha', 'Adicionar a tag/tipo “Urgente”', 'Notificar: “Olha Contrato Acme”', 'Mover a linha para o banco “Arquivo”',
  ])
  assert.equal(ok.ignored, 1)
  const no = previewAutomation(s, rule, row({ pr: 'lo' }, 'Contrato Acme'), ctx)
  assert.deepEqual([no.wouldRun, no.conditions.map(item => item.pass)], [false, [false, true]])
  assert.equal(describeAction(s, { kind: 'archiveRow' }, row({}), ctx), 'Mover a linha para a lixeira')
  assert.equal(describeTrigger(s, { kind: 'dateArrived', propertyId: 'dt', offsetDays: -3 }, ctx), '3 dia(s) antes de a data de “Data”')
  assert.equal(describeTrigger(s, { kind: 'taskCompleted' }, ctx), 'Quando a tarefa for concluída')
  assert.equal(fillTemplate('{titulo} e {title}', { title: 'X' }), 'X e X')
})

test('registro guarda só as 50 execuções mais recentes, a mais nova primeiro', () => {
  let log: ReturnType<typeof appendLog> | undefined
  for (let i = 0; i < 60; i++) log = appendLog(log, { at: i, automationId: 'a', name: 'n', rowId: 'r', rowTitle: 't', status: 'done', detail: String(i) })
  assert.equal(log!.length, AUTOMATION_LOG_LIMIT)
  assert.equal(log![0].detail, '59')
})

// ---------- Execução com o store real ----------

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } }, async saveMeta() {}, async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) }, async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) }, async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {}, removeEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 5)) }

function makeDb(automations: DatabaseAutomation[]) {
  const db = actions.createDatabase(null, 'board')
  actions.updateSchema(db, current => ({ ...current, properties: [...current.properties,
    { id: 'when', name: 'Data', type: 'date' }, { id: 'prio', name: 'Prioridade', type: 'select', options: [{ id: 'hi', name: 'Alta', color: 'red' }, { id: 'lo', name: 'Baixa', color: 'gray' }] }, { id: 'rev', name: 'Revisado', type: 'checkbox' },
  ], automations }))
  const status = getState().pages[db].database!.properties.find(property => property.type === 'status')!
  return { db, status, done: status.options!.find(option => option.group === 'complete')!.id, todo: status.options!.find(option => option.group === 'todo')!.id }
}
const log = (db: string) => getState().pages[db].database!.automationLog ?? []

test('linha criada: roda só se as condições valem, registra a execução e respeita "desligada"', async () => {
  await actions.init()
  const probe = makeDb([])
  const rule = auto({ id: 'created', name: 'Alta vira revisada', trigger: { kind: 'rowCreated' }, conditions: [{ propertyId: 'prio', op: 'equals', value: 'hi' }], actions: [{ kind: 'setProperty', propertyId: 'rev', value: true }, { kind: 'setTitle', value: 'Revisar {titulo}' }] })
  const { db } = makeDb([rule])
  void probe
  const hi = actions.createRow(db, { prio: 'hi' }, { title: 'Contrato' })
  const lo = actions.createRow(db, { prio: 'lo' }, { title: 'Outro' })
  await settle()
  assert.equal(getState().pages[hi].props!.rev, true)
  assert.equal(getState().pages[hi].title, 'Revisar Contrato')
  assert.equal(getState().pages[lo].props!.rev, undefined)
  assert.equal(getState().pages[lo].title, 'Outro')
  assert.equal(log(db).length, 1)
  assert.deepEqual([log(db)[0].status, log(db)[0].name, log(db)[0].rowId], ['done', 'Alta vira revisada', hi])
  assert.match(log(db)[0].detail, /Definir “Revisado”/)
  // Desligar a regra: nada acontece.
  actions.updateSchema(db, current => ({ ...current, automations: current.automations!.map(item => ({ ...item, enabled: false })) }))
  const off = actions.createRow(db, { prio: 'hi' }, { title: 'Desligada' })
  await settle()
  assert.equal(getState().pages[off].props!.rev, undefined)
  assert.equal(log(db).length, 1)
})

test('tarefa concluída: cria tarefa na linha, notifica e define propriedade; página bloqueada não é alterada', async () => {
  const rule = auto({ id: 'completed', name: 'Ao concluir', trigger: { kind: 'taskCompleted' }, actions: [
    { kind: 'createTask', title: 'Comemorar {titulo}', inDays: 1 }, { kind: 'notify', message: 'Concluída: {titulo}' }, { kind: 'setProperty', propertyId: 'rev', value: true },
  ] })
  const { db, status, done } = makeDb([rule])
  const row = actions.createRow(db, { [status.id]: status.options![0].id }, { title: 'Projeto' })
  const locked = actions.createRow(db, { [status.id]: status.options![0].id }, { title: 'Travada' })
  await settle()
  actions.setProp(row, status.id, done)
  actions.updatePage(locked, { locked: true }, false)
  actions.setProp(locked, status.id, done)
  await settle()
  assert.equal(getState().pages[row].props!.rev, true)
  const blocks = documents.get(row) as any[]
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'checkListItem')
  assert.equal(blocks[0].content[0].text, 'Comemorar Projeto ')
  assert.equal(blocks[0].content[1].type, 'dateMention')
  assert.ok(Object.values(getState().notifications).some(item => item.pageId === row && item.body === 'Concluída: Projeto'))
  assert.equal(documents.get(locked), undefined, 'linha bloqueada: nada escrito')
  assert.equal(getState().pages[locked].props!.rev, undefined)
  assert.equal(log(db).filter(entry => entry.status === 'done').length, 1)
})

test('tag/tipo adicionado dispara e a ação "adicionar tag" aplica o tipo', async () => {
  const { createType, applyType } = await import('../src/objecttypes/actions.ts')
  const urgent = createType({ name: 'Urgente' })
  const review = createType({ name: 'Revisar' })
  const rule = auto({ id: 'type', name: 'Urgente pede revisão', trigger: { kind: 'typeAdded', typeId: urgent }, actions: [{ kind: 'addType', typeId: review }, { kind: 'setProperty', propertyId: 'rev', value: true }] })
  const { db } = makeDb([rule])
  const row = actions.createRow(db, {}, { title: 'Item' })
  await settle()
  applyType([row], review, { toast: false })
  await settle()
  assert.equal(getState().pages[row].props!.rev, undefined, 'outro tipo não dispara')
  applyType([row], urgent, { toast: false })
  await settle()
  assert.equal(getState().pages[row].props!.rev, true)
  assert.ok(getState().pages[row].types!.includes(review) && getState().pages[row].types!.includes(urgent))
  assert.equal(log(db)[0].status, 'done')
  // Já tem a tag da ação: não é erro, só segue.
  assert.equal(log(db).filter(entry => entry.status === 'error').length, 0)
})

test('"data chegou" no relógio: primeira passagem só marca o passado; depois dispara uma única vez', async () => {
  const rule = auto({ id: 'date', name: 'Vencimento', trigger: { kind: 'dateArrived', propertyId: 'when' }, actions: [{ kind: 'setProperty', propertyId: 'rev', value: true }] })
  const { db } = makeDb([rule])
  const past = actions.createRow(db, { when: { start: '2026-10-01' } }, { title: 'Passada' })
  const soon = actions.createRow(db, { when: { start: '2026-10-12' } }, { title: 'Em breve' })
  const now = new Date(2026, 9, 9, 10).getTime()
  await actions.tickScheduledTasks(now)
  await settle()
  assert.equal(getState().pages[past].props!.rev, undefined, 'passado antigo não dispara na criação da regra')
  assert.match(log(db).find(entry => entry.status === 'skipped')!.detail, /Primeira verificação: 1 linha/)
  await actions.tickScheduledTasks(now + 60_000)
  await settle()
  assert.equal(getState().pages[soon].props!.rev, undefined)
  await actions.tickScheduledTasks(new Date(2026, 9, 12, 8).getTime())
  await settle()
  assert.equal(getState().pages[soon].props!.rev, true)
  assert.equal(log(db).filter(entry => entry.status === 'done').length, 1)
  actions.setProp(soon, 'rev', false)
  await actions.tickScheduledTasks(new Date(2026, 9, 12, 9).getTime())
  await settle()
  assert.equal(getState().pages[soon].props!.rev, false, 'a mesma data não dispara de novo')
})

test('proteção contra laços: regra que cria linha a cada linha criada para em 3 níveis e registra', async () => {
  const rule = auto({ id: 'loop', name: 'Laço', trigger: { kind: 'rowCreated' }, actions: [{ kind: 'createRow' }] })
  const { db } = makeDb([rule])
  actions.createRow(db, {}, { title: 'Semente' })
  for (let i = 0; i < 12; i++) await settle()
  const rows = Object.values(getState().pages).filter(page => page.parentId === db && !page.trashed)
  assert.equal(rows.length, 4, 'semente + 3 criadas pela regra')
  assert.ok(log(db).some(entry => entry.status === 'skipped' && /encadeamento/.test(entry.detail)))
})

test('mover para outro banco é a última ação; banco de destino indisponível vira erro registrado', async () => {
  const target = makeDb([])
  const { db, status, done } = makeDb([auto({ id: 'move', name: 'Arquivar ao concluir', trigger: { kind: 'taskCompleted' }, actions: [{ kind: 'moveRow', databaseId: target.db }, { kind: 'setTitle', value: 'não deve rodar' }] })])
  const row = actions.createRow(db, { [status.id]: status.options![0].id }, { title: 'Mover' })
  await settle()
  actions.setProp(row, status.id, done)
  await settle()
  assert.equal(getState().pages[row].parentId, target.db)
  assert.equal(getState().pages[row].title, 'Mover')
  const broken = makeDb([auto({ id: 'bad', name: 'Quebrada', trigger: { kind: 'taskCompleted' }, actions: [{ kind: 'moveRow', databaseId: 'inexistente' }] })])
  const second = actions.createRow(broken.db, { [broken.status.id]: broken.todo }, { title: 'Fica' })
  await settle()
  actions.setProp(second, broken.status.id, broken.done)
  await settle()
  assert.equal(getState().pages[second].parentId, broken.db)
  assert.equal(log(broken.db)[0].status, 'error')
  assert.match(log(broken.db)[0].detail, /banco de destino/)
})
