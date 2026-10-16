// Herança de data da nota diária: tarefa sem data própria dentro de uma nota diária vale o dia da nota.
import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketTasks, collectTasks, extractChecklist, type CollectInput } from '../src/tasks/taskCore.ts'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return null }, async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
const { actions, getState } = await import('../src/store.ts')
const { rolloverTasks, rolloverCandidates, takeBlock } = await import('../src/daily/rollover.ts')
const daily = await import('../src/daily/dailyNotes.ts')
const { addDays, localDay } = await import('../src/daily/dailyCore.ts')

const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00`).toISOString()
const mention = (date: string, extra: Record<string, string> = {}) => ({ type: 'dateMention', props: { id: 'm-' + date, date, pageId: '', repeat: '', reminderId: '', ...extra } })
const check = (id: string, text: string, checked = false, extra: unknown[] = [], children: unknown[] = []) => ({ id, type: 'checkListItem', props: { checked }, content: [{ type: 'text', text, styles: {} }, ...extra], children })

const TODAY = '2026-10-08'
function workspace(extra: Record<string, any> = {}) {
  const pages: Record<string, any> = {
    notes: { id: 'notes', parentId: null, title: 'Notas diárias', database: { properties: [{ id: 'n', name: 'Nome', type: 'title' }, { id: 'nd', name: 'Data', type: 'date' }], views: [], activeViewId: '' } },
    today: { id: 'today', parentId: 'notes', title: '8 de outubro', props: { nd: { start: '2026-10-08' } } },
    past: { id: 'past', parentId: 'notes', title: '7 de outubro', props: { nd: { start: '2026-10-07' } } },
    future: { id: 'future', parentId: 'notes', title: '9 de outubro', props: { nd: { start: '2026-10-09' } } },
    sub: { id: 'sub', parentId: 'today', title: 'Subpágina' },
    ...extra,
  }
  const checklists = new Map<string, any[]>([
    ['today', extractChecklist([check('a', 'Um'), check('b', 'Dois'), { id: 't', type: 'toggleListItem', content: [{ type: 'text', text: 'Grupo' }], children: [check('c', 'Aninhada')] }, check('e', 'Vazio'.slice(0, 0)), check('d', 'Feita', true)])],
    ['past', extractChecklist([check('p', 'Ontem aberta')])],
    ['future', extractChecklist([check('f', 'Amanhã')])],
    ['sub', extractChecklist([check('s', 'Na subpágina')])],
  ])
  return { pages, checklists }
}
const run = (input: CollectInput) => collectTasks({ ...input, daily: { databaseId: 'notes', inherit: true, ...input.daily } })
const dueOf = (items: ReturnType<typeof collectTasks>, title: string) => items.find(item => item.title === title)

test('item sem data na nota de hoje herda hoje (inclusive aninhado); vazio e concluído ficam de fora', () => {
  const items = run(workspace())
  assert.deepEqual(['Um', 'Dois', 'Aninhada'].map(title => [dueOf(items, title)?.due, dueOf(items, title)?.inherited]), [[TODAY, true], [TODAY, true], [TODAY, true]])
  assert.ok(!dueOf(items, 'Feita'))
  assert.ok(items.every(item => item.title !== ''))
  const buckets = bucketTasks(items, TODAY)
  assert.deepEqual(buckets.today.map(item => item.title).sort(), ['Aninhada', 'Dois', 'Um'])
})

test('nota passada vai para Atrasadas, futura para Próximas; configuração oculta atrasadas herdadas', () => {
  const items = run(workspace())
  const buckets = bucketTasks(items, TODAY)
  assert.deepEqual(buckets.overdue.map(item => item.title), ['Ontem aberta'])
  assert.deepEqual(buckets.upcoming.map(item => item.title), ['Amanhã'])
  const hidden = bucketTasks(items, TODAY, undefined, { hideInheritedOverdue: true })
  assert.equal(hidden.overdue.length, 0)
  assert.equal(hidden.today.length, 3)
})

test('data própria e recorrência própria vencem a herança', () => {
  const { pages, checklists } = workspace()
  checklists.set('today', extractChecklist([
    check('x', 'Explícita', false, [mention(at('2026-10-20'))]),
    check('y', 'Recorrente', false, [mention(at('2026-10-09'), { repeat: 'weekly' })]),
    check('z', 'Herdada'),
  ]))
  const items = run({ pages, checklists })
  assert.deepEqual([dueOf(items, 'Explícita')?.due, dueOf(items, 'Explícita')?.inherited ?? false], ['2026-10-20', false])
  assert.equal(dueOf(items, 'Recorrente')?.due, '2026-10-09'); assert.ok(dueOf(items, 'Recorrente')?.repeat)
  assert.equal(dueOf(items, 'Herdada')?.due, TODAY)
})

test('subpágina da nota diária não herda; configuração desligada ou sem banco mantém "Sem data"', () => {
  const items = run(workspace())
  assert.equal(dueOf(items, 'Na subpágina')?.due, null)
  const off = collectTasks({ ...workspace(), daily: { databaseId: 'notes', inherit: false } })
  assert.equal(dueOf(off, 'Um')?.due, null)
  assert.equal(collectTasks(workspace()).filter(item => item.due === null).length, 6)
  assert.equal(dueOf(collectTasks({ ...workspace(), daily: { databaseId: 'inexistente' } }), 'Um')?.due, null)
})

test('mudar a Data da nota e mover o item entre notas muda a data efetiva; protegidas e lixeira ficam fora', () => {
  const input = workspace()
  input.pages.today = { ...input.pages.today, props: { nd: { start: '2026-10-15' } } }
  assert.equal(dueOf(run(input), 'Um')?.due, '2026-10-15')
  const moved = workspace()
  moved.checklists.set('future', [...moved.checklists.get('future')!, ...moved.checklists.get('today')!.filter(entry => entry.text === 'Um')])
  moved.checklists.set('today', moved.checklists.get('today')!.filter(entry => entry.text !== 'Um'))
  assert.equal(dueOf(run(moved), 'Um')?.due, '2026-10-09')
  const hidden = workspace({ locked: { id: 'locked', parentId: 'notes', title: 'Cofre', passwordLock: { rootId: 'locked', hideTitle: true }, props: { nd: { start: '2026-10-08' } } }, bin: { id: 'bin', parentId: 'notes', title: 'Lixo', trashed: true, props: { nd: { start: '2026-10-08' } } } })
  hidden.checklists.set('locked', extractChecklist([check('l', 'Secreta')])); hidden.checklists.set('bin', extractChecklist([check('k', 'Lixeira')]))
  const items = run(hidden)
  assert.ok(!dueOf(items, 'Secreta') && !dueOf(items, 'Lixeira'))
})

test('banco de notas diárias inválido (sem propriedade de data) não herda', () => {
  const input = workspace()
  input.pages.notes.database.properties = [{ id: 'n', name: 'Nome', type: 'title' }]
  assert.equal(dueOf(run(input), 'Um')?.due, null)
})

test('desempenho: 10 mil páginas com herança em menos de 100 ms', () => {
  const pages: Record<string, any> = { notes: { id: 'notes', parentId: null, title: 'Notas', database: { properties: [{ id: 'nd', name: 'Data', type: 'date' }], views: [], activeViewId: '' } } }
  const checklists = new Map<string, any[]>()
  for (let i = 0; i < 9_999; i++) {
    const inNotes = i % 2 === 0
    pages[`p${i}`] = { id: `p${i}`, parentId: inNotes ? 'notes' : null, title: `P${i}`, ...(inNotes ? { props: { nd: { start: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` } } } : {}) }
    checklists.set(`p${i}`, [0, 1, 2].map(k => ({ blockId: `b${k}`, text: `T${i}.${k}`, checked: false, date: '' })))
  }
  collectTasks({ pages, checklists, daily: { databaseId: 'notes' } })
  const started = performance.now()
  const items = collectTasks({ pages, checklists, daily: { databaseId: 'notes' } })
  const buckets = bucketTasks(items, TODAY)
  const elapsed = performance.now() - started
  assert.ok(items.length > 29_000)
  assert.ok(buckets.today.length + buckets.overdue.length + buckets.upcoming.length > 14_000)
  assert.ok(elapsed < 100 * (process.env.CI ? 5 : 1), `levou ${elapsed.toFixed(1)} ms`)
})

test('rolagem: candidatos são só itens herdados, abertos e de dias anteriores; takeBlock remove aninhado', () => {
  const items = run(workspace())
  assert.deepEqual(rolloverCandidates(items, TODAY).map(item => item.title), ['Ontem aberta'])
  const tree: any[] = [{ id: 'a', type: 'paragraph', children: [] }, { id: 't', type: 'toggleListItem', children: [check('c', 'x')] }]
  assert.equal(takeBlock(tree, 'c', false)?.id, 'c'); assert.equal(tree[1].children.length, 1)
  assert.equal(takeBlock(tree, 'c', true)?.id, 'c'); assert.equal(tree[1].children.length, 0)
  assert.equal(takeBlock(tree, 'nada', true), null)
})

test('rolagem de verdade: mover e copiar levam a tarefa para a nota de hoje com novo id', async () => {
  await actions.init()
  const now = localDay(), yesterday = addDays(now, -1)
  const oldId = await daily.ensureDailyNote(yesterday)
  const todayId = await daily.ensureDailyNote(now)
  documents.set(oldId, [check('o1', 'Pendente antiga'), check('o2', 'Já feita', true), check('o3', 'Datada', false, [mention(at(now))])])
  const tasks = () => {
    const s = getState()
    return collectTasks({ pages: s.pages, checklists: new Map([[oldId, extractChecklist(documents.get(oldId))], [todayId, extractChecklist(documents.get(todayId))]]), daily: { databaseId: s.settings.dailyFlow?.databaseId, inherit: true } })
  }
  const before = rolloverCandidates(tasks(), now)
  assert.deepEqual(before.map(item => item.title), ['Pendente antiga'])
  const copy = await rolloverTasks(before, 'copy')
  assert.equal(copy.done, 1)
  assert.equal((documents.get(oldId) as any[]).length, 3, 'cópia mantém o original')
  const inToday = (documents.get(todayId) as any[]).filter(block => block.type === 'checkListItem' && block.content?.[0]?.text === 'Pendente antiga')
  assert.equal(inToday.length, 1); assert.notEqual(inToday[0].id, 'o1')
  const move = await rolloverTasks(rolloverCandidates(tasks(), now), 'move')
  assert.equal(move.done, 1)
  assert.deepEqual((documents.get(oldId) as any[]).map(block => block.id), ['o2', 'o3'])
  assert.equal((documents.get(todayId) as any[]).filter(block => block.content?.[0]?.text === 'Pendente antiga').length, 2)
  assert.equal(rolloverCandidates(tasks(), now).length, 0)
})
