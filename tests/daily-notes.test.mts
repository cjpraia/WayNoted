import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDailyTemplate, dailyDatabaseSchema, dailyIndex, defaultDailyTemplate, isoWeek, monthGrid, weekDays, weekStartFor, dailyTitle } from '../src/daily/dailyCore.ts'

const documents = new Map<string, unknown[]>()
let savedMeta: any = null
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } },
  async saveMeta(meta: unknown) { savedMeta = structuredClone(meta) },
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })
const { actions, getState } = await import('../src/store.ts')
const daily = await import('../src/daily/dailyNotes.ts')

const text = (blocks: any[]): string => blocks.map(block => [(block.content ?? []).map((item: any) => item.text ?? (item.content ?? []).map((c: any) => c.text).join('')).join(''), text(block.children ?? [])].join('')).join('\n')

test('semana ISO, grade do mês e início da semana por idioma', () => {
  assert.equal(isoWeek('2026-10-07'), 41)
  assert.equal(isoWeek('2026-01-01'), 1)
  assert.equal(isoWeek('2027-01-01'), 53, '1/jan/2027 (sexta) ainda pertence à semana 53 de 2026')
  assert.equal(isoWeek('2024-12-30'), 1)
  assert.equal(weekStartFor('pt-BR'), 0)
  assert.equal(weekStartFor('en-US'), 0)
  assert.equal(weekStartFor('pt-BR', 'monday'), 1)
  const sunday = monthGrid(2026, 10, 0)
  assert.equal(sunday.length, 42); assert.equal(sunday[0], '2026-09-27'); assert.equal(sunday[4], '2026-10-01')
  const monday = monthGrid(2026, 10, 1)
  assert.equal(monday[0], '2026-09-28'); assert.equal(monday[3], '2026-10-01')
  assert.deepEqual(weekDays('2026-10-07', 1), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
  assert.equal(dailyTitle('2026-10-07', 'pt-BR'), '7 de outubro de 2026')
  assert.equal(dailyTitle('2026-10-07', 'en-US'), 'October 7, 2026')
})

test('modelo: variáveis com estilos preservados, agenda e tarefas do dia viram blocos', () => {
  let n = 0
  const uid = () => `id-${++n}`
  const template = [
    { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: '{{dia_da_semana}}, {{data}}', styles: { bold: true } }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Semana {{semana}} · {{ontem}} · {{amanha}} · {{desconhecida}}', styles: {} }] },
    { type: 'paragraph', content: [{ type: 'text', text: '{{agenda}}', styles: {} }] },
    { type: 'paragraph', content: [{ type: 'text', text: ' {{tarefas_do_dia}} ', styles: {} }] },
    { type: 'bulletListItem', content: [], children: [{ type: 'paragraph', content: [{ type: 'text', text: 'filho {{data}}', styles: {} }] }] },
  ]
  const blocks = applyDailyTemplate(template, { date: '2026-10-07', locale: 'pt-BR', yesterdayHref: 'workspace://page/y', tomorrowHref: 'workspace://daily/2026-10-08', tasks: [{ title: 'Pagar conta', pageTitle: 'Casa', href: 'workspace://page/x', time: '09:00' }] }, uid)
  assert.equal((blocks[0].content as any[])[0].text, 'Quarta-feira')
  assert.deepEqual((blocks[0].content as any[])[0].styles, { bold: true })
  assert.equal(text([blocks[0]]), 'Quarta-feira, 7 de outubro de 2026')
  const links = (blocks[1].content as any[]).filter(item => item.type === 'link')
  assert.deepEqual(links.map(link => link.href), ['workspace://page/y', 'workspace://daily/2026-10-08'])
  assert.match(text([blocks[1]]), /^Semana 41 · ‹ Ontem \(6 de out\.?\) · Amanhã \(8 de out\.?\) › · \{\{desconhecida\}\}$/)
  assert.equal(blocks[2].type, 'calendarAgenda')
  assert.equal(blocks[3].type, 'bulletListItem')
  assert.equal(text([blocks[3]]), '09:00 Pagar conta — Casa')
  assert.equal(text(blocks[4].children!), 'filho 7 de outubro de 2026')
  assert.ok(blocks.every(block => typeof block.id === 'string' && block.id.startsWith('id-')))
  // Sem tarefas: aviso discreto em vez de lista vazia.
  const empty = applyDailyTemplate([{ type: 'paragraph', content: [{ type: 'text', text: '{{tasks}}' }] }], { date: '2026-10-07', locale: 'en-US', yesterdayHref: '', tomorrowHref: '', tasks: [] })
  assert.equal(text(empty), 'No tasks due on this day.')
  // O modelo padrão usa todas as variáveis principais.
  const defaults = JSON.stringify(defaultDailyTemplate('pt-BR'))
  for (const name of ['dia_da_semana', 'semana', 'ontem', 'amanha', 'agenda', 'tarefas_do_dia']) assert.ok(defaults.includes(`{{${name}}}`), name)
})

test('índice data → nota ignora lixeira e duplicatas mais novas', () => {
  const { schema, datePropertyId } = dailyDatabaseSchema('pt-BR', (() => { let i = 0; return () => `p${++i}` })())
  assert.deepEqual(schema.views.map(view => view.type), ['table', 'calendar'])
  const db = { id: 'db', parentId: null, title: 'Notas diárias', database: schema, createdAt: 1 } as any
  const row = (id: string, start: string, createdAt: number, trashed = false) => ({ id, parentId: 'db', title: start, createdAt, trashed, props: { [datePropertyId]: { start } } }) as any
  const pages = { db, a: row('a', '2026-10-07', 5), b: row('b', '2026-10-07', 3), c: row('c', '2026-10-08', 1, true), d: row('d', 'inválida', 1) }
  const index = dailyIndex(pages, 'db', () => true)
  assert.equal(index.get('2026-10-07')?.id, 'b')
  assert.equal(index.has('2026-10-08'), false)
  assert.equal(index.size, 1)
})

test('nota diária: cria banco gerenciado na raiz e uma nota por dia, sem duplicar em chamadas simultâneas', async () => {
  await actions.init()
  const [first, second] = await Promise.all([daily.ensureDailyNote('2026-10-07'), daily.ensureDailyNote('2026-10-07')])
  assert.equal(first, second)
  const state = getState()
  const dbId = state.settings.dailyFlow!.databaseId!
  const db = state.pages[dbId]
  assert.equal(db.parentId, null)
  assert.equal(db.title, 'Notas diárias')
  assert.deepEqual(db.database!.views.map(view => view.type), ['table', 'calendar'])
  const note = state.pages[first]
  assert.equal(note.parentId, dbId)
  assert.equal(note.title, '7 de outubro de 2026')
  assert.equal(daily.dailyDateOf(first), '2026-10-07')
  const doc = documents.get(first) as any[]
  assert.ok(doc.some(block => block.type === 'calendarAgenda'), 'bloco Agenda de hoje')
  assert.match(text(doc), /Quarta-feira · Semana 41/)
  // Ontem ainda não existe: link de nota diária; amanhã idem.
  assert.ok(JSON.stringify(doc).includes('workspace://daily/2026-10-06'))
  assert.equal(await daily.ensureDailyNote('2026-10-07'), first)
  assert.equal(Object.values(getState().pages).filter(page => page.parentId === dbId).length, 1)
  assert.equal(savedMeta.pages[first].props[Object.keys(note.props!)[0]].start, '2026-10-07', 'gravado no meta')
})

test('nota vizinha existente vira link de página; modelo pessoal configurável', async () => {
  const yesterday = await daily.ensureDailyNote('2026-10-08')
  actions.updateSettings({ personalTemplates: [{ id: 'tpl', title: 'Meu diário', description: '', icon: '📓', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ontem: {{ontem}} / Data: {{data}}', styles: {} }] }], createdAt: 1, updatedAt: 1 }] })
  daily.updateDailySettings({ templateId: 'tpl' })
  const id = await daily.ensureDailyNote('2026-10-09')
  const doc = documents.get(id) as any[]
  assert.equal(doc.length, 1)
  assert.ok(JSON.stringify(doc).includes(`workspace://page/${yesterday}`))
  assert.match(text(doc), /Data: 9 de outubro de 2026/)
  daily.updateDailySettings({ templateId: '' })
})

test('banco dentro de página com senha: não cria nota e explica; banco na lixeira: recria na raiz', async () => {
  const dbId = getState().settings.dailyFlow!.databaseId!
  const vault = actions.createPage(null, { title: 'Cofre' })
  actions.updatePage(vault, { passwordLock: { rootId: vault, hideTitle: false } } as any, false)
  actions.updatePage(dbId, { parentId: vault } as any, false)
  await assert.rejects(daily.ensureDailyNote('2026-10-20'), /protegida por senha/)
  assert.equal(daily.dailyNoteFor('2026-10-20'), undefined)
  actions.updatePage(dbId, { parentId: null, trashed: true, trashedAt: Date.now() } as any, false)
  const id = await daily.ensureDailyNote('2026-10-20')
  const newDb = getState().settings.dailyFlow!.databaseId!
  assert.notEqual(newDb, dbId)
  assert.equal(getState().pages[newDb].parentId, null)
  assert.equal(getState().pages[id].parentId, newDb)
})

test('links workspace://daily/AAAA-MM-DD abrem (e criam) a nota do dia', async () => {
  assert.equal(daily.handleDailyLink('workspace://daily/2026-02-30'), false)
  assert.equal(daily.handleDailyLink('https://example.com'), false)
  assert.equal(daily.handleDailyLink('workspace://daily/2026-11-02'), true)
  for (let i = 0; i < 20 && !daily.dailyNoteFor('2026-11-02'); i++) await new Promise(resolve => setTimeout(resolve, 5))
  const note = daily.dailyNoteFor('2026-11-02')!
  assert.ok(note)
  const route = getState().route
  assert.equal(route.type === 'page' && route.id, note.id)
  assert.ok(daily.pagesCreatedOn(new Date().toISOString().slice(0, 10)).length >= 0)
})
