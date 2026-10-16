import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketTasks, collectTasks, doneValueFor, extractChecklist, groupTasks, nextTasks, dueNowTasks, tasksOnDay, localDayOf } from '../src/tasks/taskCore.ts'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } }, async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
const storage = new Map<string, string>()
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k), length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { completeTask, setChecklistChecked } = await import('../src/tasks/taskActions.ts')

const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00`).toISOString()
const mention = (date: string, extra: Record<string, string> = {}) => ({ type: 'dateMention', props: { id: 'm-' + date, date, pageId: '', repeat: '', reminderId: '', ...extra } })
const check = (id: string, text: string, checked = false, extra: unknown[] = [], children: unknown[] = []) => ({ id, type: 'checkListItem', props: { checked }, content: [{ type: 'text', text, styles: {} }, ...extra], children })

test('extrai checklists aninhados com a primeira menção de data, hora e repetição', () => {
  const blocks = [
    { id: 'h', type: 'paragraph', content: [{ type: 'text', text: 'Intro' }], children: [] },
    check('a', 'Pagar conta ', false, [mention(at('2026-10-07', '09:00'), { time: '09:00', repeat: 'monthly' })]),
    { id: 't', type: 'toggleListItem', content: [{ type: 'text', text: 'Casa' }], children: [check('b', 'Lavar louça', true), check('c', 'Ligar', false, [{ type: 'link', href: 'x', content: [{ type: 'text', text: ' pro João' }] }])] },
  ]
  const items = extractChecklist(blocks)
  assert.deepEqual(items.map(item => [item.blockId, item.text, item.checked]), [['a', 'Pagar conta', false], ['b', 'Lavar louça', true], ['c', 'Ligar pro João', false]])
  assert.equal(items[0].time, '09:00'); assert.equal(items[0].repeat, 'monthly')
  assert.equal(localDayOf(items[0].date), '2026-10-07')
  assert.equal(items[2].context, 'Casa')
  assert.deepEqual(extractChecklist(null), [])
})

function workspace() {
  const status = { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] }
  const date = { id: 'dt', name: 'Prazo', type: 'date' }
  const pages: Record<string, any> = {
    db: { id: 'db', parentId: null, title: 'Projetos', database: { properties: [{ id: 'ti', name: 'Nome', type: 'title' }, status, date], views: [], activeViewId: '' } },
    r1: { id: 'r1', parentId: 'db', title: 'Relatório', props: { st: 'todo', dt: { start: '2026-10-06' } } },
    r2: { id: 'r2', parentId: 'db', title: 'Revisão', props: { st: 'done', dt: { start: '2026-10-07' } } },
    r3: { id: 'r3', parentId: 'db', title: 'Reunião', props: { st: 'todo', dt: { start: '2026-10-09', startTime: '14:00', repeat: 'weekly' } } },
    r4: { id: 'r4', parentId: 'db', title: 'Sem prazo', props: { st: 'todo' } },
    notes: { id: 'notes', parentId: null, title: 'Notas diárias', database: { properties: [{ id: 'n', name: 'Nome', type: 'title' }, { id: 'nd', name: 'Data', type: 'date' }], views: [], activeViewId: '' } },
    n1: { id: 'n1', parentId: 'notes', title: '7 out', props: { nd: { start: '2026-10-07' } } },
    p1: { id: 'p1', parentId: null, title: 'Casa' },
    p2: { id: 'p2', parentId: null, title: 'Lixo', trashed: true },
    p3: { id: 'p3', parentId: null, title: 'Cofre', passwordLock: { rootId: 'p3', hideTitle: true } },
    p4: { id: 'p4', parentId: 'p3', title: 'Dentro do cofre' },
  }
  const checklists = new Map<string, any[]>([
    ['p1', extractChecklist([check('a', 'Comprar pão', false, [mention(at('2026-10-07'))]), check('b', 'Feito', true), check('c', 'Sem data')])],
    ['p2', extractChecklist([check('x', 'Na lixeira')])],
    ['p3', extractChecklist([check('y', 'Secreta')])],
    ['p4', extractChecklist([check('z', 'Secreta 2')])],
  ])
  return { pages, checklists }
}

test('reúne checklists e linhas pendentes; ignora lixeira, senha, concluídas e bancos sem status', () => {
  const items = collectTasks({ ...workspace(), locale: 'pt-BR' })
  assert.deepEqual(items.map(item => item.key).sort(), ['c:p1:a', 'c:p1:c', 'r:r1:dt', 'r:r3:dt'])
  const r3 = items.find(item => item.key === 'r:r3:dt')!
  assert.equal(r3.time, '14:00'); assert.equal(r3.repeat, 'Toda sexta'); assert.equal(r3.sourceTitle, 'Projetos'); assert.equal(r3.databaseId, 'db')
  const all = collectTasks({ ...workspace(), includeDone: true })
  assert.ok(all.some(item => item.key === 'r:r2:dt' && item.done))
  assert.ok(all.some(item => item.key === 'c:p1:b' && item.done))
  assert.ok(!all.some(item => item.pageId === 'p3' || item.pageId === 'p4' || item.pageId === 'p2'))
})

test('Hoje / Próximas / Atrasadas / Sem data, agrupamento e próximas 5', () => {
  const items = collectTasks(workspace())
  const buckets = bucketTasks(items, '2026-10-07')
  assert.deepEqual(buckets.overdue.map(item => item.title), ['Relatório'])
  assert.deepEqual(buckets.today.map(item => item.title), ['Comprar pão'])
  assert.deepEqual(buckets.upcoming.map(item => item.title), ['Reunião'])
  assert.deepEqual(buckets.undated.map(item => item.title), ['Sem data'])
  assert.deepEqual(nextTasks(buckets, 2).map(item => item.title), ['Relatório', 'Comprar pão'])
  assert.deepEqual(dueNowTasks(buckets, 5).map(item => item.title), ['Relatório', 'Comprar pão'], 'Hoje não lista futuras')
  assert.equal(dueNowTasks({ ...buckets, overdue: [], today: [] }).length, 0, 'só futuras → estado vazio')
  assert.deepEqual(groupTasks(items, 'project').map(group => group.key), ['p1', 'db'])
  assert.deepEqual(tasksOnDay(items, '2026-10-09').map(item => item.title), ['Reunião'])
  const onlyRows = bucketTasks(items, '2026-10-07', item => item.kind === 'row')
  assert.equal(onlyRows.today.length + onlyRows.undated.length, 0)
  assert.equal(doneValueFor({ id: 'c', name: 'Ok', type: 'checkbox' }), true)
  assert.equal(doneValueFor(workspace().pages.db.database.properties[1]), 'done')
})

test('desempenho: 10 mil páginas recalculadas em menos de 100 ms', () => {
  const pages: Record<string, any> = {}
  const checklists = new Map<string, any[]>()
  const status = { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] }
  for (let d = 0; d < 10; d++) pages[`db${d}`] = { id: `db${d}`, parentId: null, title: `Banco ${d}`, database: { properties: [{ id: 't', name: 'Nome', type: 'title' }, status, { id: 'dt', name: 'Data', type: 'date' }], views: [], activeViewId: '' } }
  for (let i = 0; i < 5000; i++) pages[`r${i}`] = { id: `r${i}`, parentId: `db${i % 10}`, title: `Linha ${i}`, props: { st: i % 3 ? 'todo' : 'done', dt: { start: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` } } }
  for (let i = 0; i < 4990; i++) {
    pages[`p${i}`] = { id: `p${i}`, parentId: i % 5 ? `p${i - (i % 5)}` : null, title: `Página ${i}` }
    checklists.set(`p${i}`, [0, 1, 2].map(k => ({ blockId: `b${k}`, text: `Tarefa ${i}.${k}`, checked: k === 2, date: k === 0 ? at(`2026-10-${String(1 + (i % 28)).padStart(2, '0')}`) : '' })))
  }
  assert.equal(Object.keys(pages).length, 10_000)
  collectTasks({ pages, checklists }) // aquecimento
  const started = performance.now()
  const items = collectTasks({ pages, checklists })
  const buckets = bucketTasks(items, '2026-10-07')
  const elapsed = performance.now() - started
  assert.ok(items.length > 13_000, String(items.length))
  assert.equal(buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.undated.length, items.length)
  assert.ok(elapsed < 100, `levou ${elapsed.toFixed(1)} ms`)
})

test('concluir no lugar: checklist marca o bloco; menção recorrente avança; linha usa status e recorrência', async () => {
  await actions.init()
  const page = actions.createPage(null, { title: 'Casa' })
  await actions.flushMeta()
  documents.set(page, [check('a', 'Simples'), { id: 'col', type: 'toggleListItem', content: [], children: [check('b', 'Aluguel ', false, [mention(at('2026-10-05', '09:00'), { repeat: 'monthly', time: '09:00' })])] }])
  assert.equal(await setChecklistChecked(page, 'a', true), 'checked')
  assert.equal((documents.get(page) as any[])[0].props.checked, true)
  assert.equal(await setChecklistChecked(page, 'a', false), 'unchecked')
  assert.equal((documents.get(page) as any[])[0].props.checked, false)
  assert.equal(await setChecklistChecked(page, 'b', true, Date.parse('2026-10-07T12:00:00Z')), 'advanced')
  const nested = (documents.get(page) as any[])[1].children[0]
  assert.equal(nested.props.checked, false)
  assert.equal(localDayOf(nested.content[1].props.date), '2026-11-05')
  await assert.rejects(setChecklistChecked(page, 'nada', true), /não foi encontrada/)
  actions.updatePage(page, { locked: true }, false)
  await assert.rejects(setChecklistChecked(page, 'a', true), /bloqueada/)

  const db = actions.createDatabase(null, 'board')
  actions.updateSchema(db, s => ({ ...s, properties: [...s.properties, { id: 'date-prop', name: 'Data', type: 'date' }] }))
  const schema = getState().pages[db].database!
  const status = schema.properties.find(p => p.type === 'status')!, date = schema.properties.find(p => p.type === 'date')!
  const row = actions.createRow(db, { [status.id]: status.options![0].id, [date.id]: { start: '2026-10-07', repeat: 'weekly' } }, { title: 'Semanal' })
  const items = collectTasks({ pages: getState().pages, checklists: new Map() })
  const item = items.find(entry => entry.pageId === row)!
  assert.ok(item)
  await completeTask(item)
  for (let i = 0; i < 20 && (getState().pages[row].props![date.id] as any).start === '2026-10-07'; i++) await new Promise(resolve => setTimeout(resolve, 5))
  const next = getState().pages[row].props!
  assert.equal(next[status.id], status.options![0].id, 'volta para "a fazer"')
  assert.ok((next[date.id] as any).start > '2026-10-07', 'avançou para a próxima ocorrência')
  const plain = actions.createRow(db, { [status.id]: status.options![0].id, [date.id]: { start: '2026-10-07' } }, { title: 'Única' })
  await completeTask(collectTasks({ pages: getState().pages, checklists: new Map() }).find(entry => entry.pageId === plain)!)
  assert.equal(getState().pages[plain].props![status.id], status.options!.find(o => o.group === 'complete')!.id)
})
