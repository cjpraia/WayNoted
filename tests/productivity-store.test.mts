// Ganchos da store no registro de produtividade (sem varrer o espaço; só eventos).
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const deltas: any[] = []
const native = {
  async loadMeta() { return null },
  async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {},
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
  async productivityLoad() { return { v: 1, days: {} } },
  async productivityRecord(delta: unknown) { deltas.push(structuredClone(delta)); return { v: 1, days: {} } },
  async productivityBackfill() { return { v: 1, days: {}, backfilledAt: 1 } },
  async productivityClear() { return { v: 1, days: {} } },
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, api, getState } = await import('../src/store.ts')
const { dayKey } = await import('../electron/productivity-data.mjs')
const para = (text: string) => [{ id: 'b', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }]
const todayOf = () => deltas.flatMap(d => Object.entries(d.days)).filter(([key]) => key === dayKey(Date.now())).map(([, day]) => day as any)
const sum = (field: string) => todayOf().reduce((total, day) => total + (day[field] ?? 0), 0)
const pageEntries = () => new Set(todayOf().flatMap(day => Object.keys(day.pages ?? {})))

test('editor saves count words written; imports/templates (no base) do not; flushAll writes one batch', async () => {
  await actions.init()
  const id = actions.createPage(null, { title: 'Ensaio' })
  await api.saveDoc(id, para('uma duas três quatro'), { base: null })
  await api.saveDoc(id, para('uma duas'), { base: JSON.stringify(para('uma duas três quatro')) })
  await api.saveDoc(id, para('uma duas três quatro cinco seis'), { base: JSON.stringify(para('uma duas')) })
  const other = actions.createPage(null, { title: 'Importada' })
  await api.saveDoc(other, para('muitas palavras importadas de um arquivo qualquer'))
  assert.equal(deltas.length, 0, 'nothing written per keystroke/save')
  await actions.flushAll()
  assert.equal(deltas.length, 1)
  assert.equal(sum('words'), 6)
  assert.equal(sum('created'), 2, 'pages created here (the welcome page is not user work)')
  assert.ok(pageEntries().has(id))
})

test('protected pages count in totals without being stored by id; status completion counts a task', async () => {
  deltas.length = 0
  const now = Date.now()
  const secret = '99999999-9999-4999-8999-999999999999'
  actions.insertPages([{ id: secret, parentId: null, title: 'Diário', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 99, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', passwordLock: { rootId: secret, hideTitle: true, unlocked: true } }])
  await api.saveDoc(secret, para('segredo um dois'), { base: null })
  const db = actions.createDatabase(null, 'board')
  const status = getState().pages[db].database!.properties.find(p => p.type === 'status')!
  const row = actions.createRow(db, {}, { title: 'Tarefa' })
  actions.setProp(row, status.id, status.options!.find(o => o.group === 'complete')!.id)
  actions.setProp(row, status.id, status.options!.find(o => o.group === 'todo')!.id)
  await actions.flushAll()
  assert.equal(sum('words'), 3)
  assert.equal(pageEntries().has(secret), false)
  assert.equal(sum('tasks'), 1)
  assert.ok(pageEntries().has(row))
})

test('tracking off: nothing is recorded', async () => {
  deltas.length = 0
  actions.updateSettings({ productivity: { enabled: false } })
  const id = actions.createPage(null)
  await api.saveDoc(id, para('não conta'), { base: null })
  await actions.flushAll()
  assert.equal(deltas.length, 0)
  actions.updateSettings({ productivity: { enabled: true } })
})
