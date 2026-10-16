// Tarefas por voz: criação com o store real (destinos de página e de banco; recusa de destinos bloqueados).
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } }, async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { checklistBlock, createVoiceTasks, destinationProblem, rowProps, taskDatabases } = await import('../src/voice/voiceTasksActions.ts')
const { extractChecklist } = await import('../src/tasks/taskCore.ts')

const task = (over: Partial<{ title: string; date: string | null; time: string | null; priority: 'high' | 'normal' | 'low'; include: boolean }> = {}) => ({ id: crypto.randomUUID(), title: 'Tarefa', date: null, time: null, priority: 'normal' as const, include: true, ...over })

test('bloco de checklist com menção de data, hora e prefixo de prioridade', () => {
  const ids = ['m1', 'b1']
  const block = checklistBlock(task({ title: 'Ligar para o João', date: '2026-10-10', time: '10:00', priority: 'high' }), 'pg', () => ids.shift()!)
  assert.equal(block.type, 'checkListItem')
  assert.equal(block.props.checked, false)
  assert.equal((block.content[0] as any).text, '!! Ligar para o João ')
  const mention = block.content[1] as any
  assert.equal(mention.type, 'dateMention')
  assert.equal(mention.props.time, '10:00')
  assert.equal(mention.props.pageId, 'pg')
  const entries = extractChecklist([block])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].time, '10:00')
  assert.equal(entries[0].text.startsWith('!! Ligar para o João'), true)
  const plain = checklistBlock(task({ title: 'Sem data', priority: 'low' }), 'pg')
  assert.equal(plain.content.length, 1)
  assert.equal((plain.content[0] as any).text, '↓ Sem data')
})

test('criar numa página acrescenta ao fim; só as marcadas; recusa página bloqueada, em lixeira ou banco', async () => {
  await actions.init()
  const page = actions.createPage(null, { title: 'Destino' })
  await actions.flushMeta()
  documents.set(page, [{ id: 'x', type: 'paragraph', content: [{ type: 'text', text: 'antes', styles: {} }], children: [] }])
  const result = await createVoiceTasks([task({ title: 'Uma', date: '2026-10-10' }), task({ title: 'Duas', include: false }), task({ title: 'Três', priority: 'high' })], { kind: 'page', pageId: page })
  assert.equal(result.created, 2)
  const saved = documents.get(page) as any[]
  assert.equal(saved.length, 3)
  assert.equal(saved[0].id, 'x')
  assert.equal(saved[2].content[0].text, '!! Três')
  await assert.rejects(createVoiceTasks([task({ include: false })], { kind: 'page', pageId: page }), /Marque ao menos uma/)
  actions.updatePage(page, { locked: true }, false)
  assert.match(destinationProblem(page) ?? '', /bloqueada/)
  await assert.rejects(createVoiceTasks([task()], { kind: 'page', pageId: page }), /bloqueada/)
  assert.equal((documents.get(page) as any[]).length, 3, 'nada gravado no destino bloqueado')
  const db = actions.createDatabase(null, 'board')
  assert.match(destinationProblem(db) ?? '', /página de texto/)
  assert.match(destinationProblem('inexistente') ?? '', /não está disponível/)
})

test('banco de tarefas: linha com título, data/hora e opção de prioridade pelo nome', async () => {
  const db = actions.createDatabase(null, 'board')
  actions.updateSchema(db, s => ({ ...s, properties: [...s.properties,
    { id: 'when', name: 'Data', type: 'date' },
    { id: 'prio', name: 'Prioridade', type: 'select', options: [{ id: 'o-alta', name: 'Alta', color: 'red' }, { id: 'o-media', name: 'Média', color: 'yellow' }, { id: 'o-baixa', name: 'Baixa', color: 'gray' }] },
  ] }))
  assert.ok(taskDatabases().some(page => page.id === db))
  const schema = getState().pages[db].database!
  assert.deepEqual(rowProps(schema, task({ date: '2026-10-10', time: '09:30', priority: 'high' })), { when: { start: '2026-10-10', startTime: '09:30' }, prio: 'o-alta' })
  assert.deepEqual(rowProps(schema, task({ priority: 'low' })), { prio: 'o-baixa' })
  assert.deepEqual(rowProps(schema, task({ priority: 'normal' })), { prio: 'o-media' })
  const before = Object.keys(getState().pages).length
  const result = await createVoiceTasks([task({ title: 'Pagar boleto', date: '2026-10-12', priority: 'high' })], { kind: 'database', databaseId: db })
  assert.equal(result.kind, 'database')
  assert.equal(Object.keys(getState().pages).length, before + 1)
  const row = Object.values(getState().pages).find(page => page.parentId === db && page.title === 'Pagar boleto')!
  assert.ok(row)
  assert.deepEqual(row.props!.when, { start: '2026-10-12' })
  assert.equal(row.props!.prio, 'o-alta')
  actions.updatePage(db, { locked: true }, false)
  await assert.rejects(createVoiceTasks([task()], { kind: 'database', databaseId: db }), /não está disponível/)
})
