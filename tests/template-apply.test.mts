// Aplicação de modelos com variáveis na store: linha de banco, tipo (corpo-modelo), perguntas, cursor e nota diária.
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
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, api, getState } = await import('../src/store.ts')
const ops = await import('../src/objecttypes/actions.ts')
const { takePendingCursor } = await import('../src/templates/cursor.ts')
const { subscribeTemplatePrompt } = await import('../src/templates/promptBus.ts')
const { prepareTemplate, askRowTemplate, rowTemplateHasQuestions } = await import('../src/templates/apply.ts')
const { clearToasts, visibleToasts } = await import('../src/components/ui/toastQueue.ts')
const { applyDailyTemplate, defaultDailyTemplate } = await import('../src/daily/dailyCore.ts')
await actions.init()

const para = (text: string) => ({ type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })
const bodyText = (id: string) => JSON.stringify(documents.get(id) ?? [])
const year = String(new Date().getFullYear())

test('linha de banco: título, texto e corpo expandidos; modelo guardado fica cru; desconhecida é avisada', async () => {
  const db = actions.createDatabase(null, 'table')
  const schema = getState().pages[db].database!
  const status = schema.properties.find(p => p.type !== 'title')
  const titleId = schema.properties.find(p => p.type === 'title')!.id
  actions.updateSchema(db, current => ({ ...current, templates: [{ id: 'tpl', name: 'Visita', title: 'Visita {{ano}}', props: {}, bodyBlocks: [para('Sobre {{prop:Nome}} {{titulo}} {{pergunta:Quem|Ana}} {{cursor}}'), para('{{nada}}')] }] }))
  assert.ok(status || true)
  assert.equal(rowTemplateHasQuestions(db, 'tpl'), true)
  clearToasts()
  const id = actions.createRow(db, {}, {}, 'tpl', { Quem: 'Bia' })
  assert.equal(getState().pages[id].title, `Visita ${year}`)
  await actions.flushAll()
  const text = bodyText(id)
  assert.ok(text.includes(`Sobre Visita ${year} Visita ${year} Bia `), text)
  assert.ok(text.includes('{{nada}}'), 'desconhecida fica literal')
  assert.match(visibleToasts()[0].message, /Variável desconhecida mantida como texto: \{\{nada\}\}/)
  assert.deepEqual(takePendingCursor(id), { path: [0], atEnd: true })
  assert.ok(JSON.stringify(getState().pages[db].database!.templates).includes('{{pergunta:Quem|Ana}}'), 'modelo cru')
  // sem respostas (criação automática): usa o padrão
  const auto = actions.createRow(db, {}, {}, 'tpl')
  await actions.flushAll()
  assert.ok(bodyText(auto).includes('Ana'))
  void titleId
})

test('askRowTemplate: sem perguntas devolve undefined; com diálogo devolve respostas ou null ao cancelar', async () => {
  const db = actions.createDatabase(null, 'table')
  actions.updateSchema(db, current => ({ ...current, templates: [{ id: 'a', name: 'A', title: '', props: {} }, { id: 'b', name: 'B', title: 'X {{pergunta:Nome}}', props: {} }] }))
  assert.equal(await askRowTemplate(db, 'a'), undefined)
  const off = subscribeTemplatePrompt(request => { assert.ok(request); request!.resolve(request!.questions[0].label === 'Nome' ? { Nome: 'Zé' } : null) })
  assert.deepEqual(await askRowTemplate(db, 'b'), { Nome: 'Zé' })
  off()
  const cancel = subscribeTemplatePrompt(request => request!.resolve(null))
  assert.equal(await askRowTemplate(db, 'b'), null)
  assert.equal(await prepareTemplate([para('{{pergunta:Q}}')]), null, 'cancelar cancela a aplicação')
  cancel()
})

test('tipo: corpo-modelo com variáveis; pergunta cancelada não aplica nada; ⌘Z (desfazer) remove o corpo inteiro', async () => {
  const typeId = ops.createType({ name: 'Visita', template: { blocks: [para('{{titulo}} — {{ano}} — {{pergunta:Quem|Ana}}'), para('{{cursor}}'), para('{{zzz}}')] } } as never)
  const page = actions.createPage(null, { title: 'Casa' })
  await native.saveDoc(page, [])
  const cancel = subscribeTemplatePrompt(request => request!.resolve(null))
  const none = await ops.applyTypeStep(page, typeId, { template: true })
  cancel()
  assert.equal(none.applied, false)
  assert.deepEqual(getState().pages[page].types ?? [], [])
  const off = subscribeTemplatePrompt(request => request!.resolve({ Quem: 'Bia' }))
  clearToasts()
  const done = await ops.applyTypeStep(page, typeId, { template: true })
  off()
  assert.equal(done.template, true)
  const text = bodyText(page)
  assert.ok(text.includes(`Casa — ${year} — Bia`), text)
  assert.ok(text.includes('{{zzz}}'))
  assert.ok(!text.includes('{{cursor}}'))
  assert.deepEqual(takePendingCursor(page), { path: [1], atEnd: true })
  ops.undoTypes()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(!bodyText(page).includes('Bia'), 'desfazer tira o corpo inserido')
  // criação automática (toast:false) não pergunta: usa o padrão
  const other = actions.createPage(null, { title: 'Rua' })
  await native.saveDoc(other, [])
  let asked = 0
  const spy = subscribeTemplatePrompt(request => { asked++; request!.resolve({}) })
  await ops.applyTypeStep(other, typeId, { template: true, toast: false })
  spy()
  assert.equal(asked, 0)
  assert.ok(bodyText(other).includes('Rua — ' + year + ' — Ana'))
})

test('nota diária: comportamento preservado (variáveis, modelo padrão) e variáveis novas funcionam', () => {
  const ctx = { date: '2026-10-07', locale: 'pt-BR' as const, yesterdayHref: 'y', tomorrowHref: 't', tasks: [] }
  const blocks = applyDailyTemplate(defaultDailyTemplate('pt-BR'), ctx)
  assert.equal(blocks[0].type, 'paragraph')
  assert.equal(blocks.some(b => b.type === 'calendarAgenda'), true)
  const flat = JSON.stringify(blocks)
  assert.ok(flat.includes('Quarta-feira') && flat.includes('Semana') && flat.includes('"href":"y"'))
  const extra = applyDailyTemplate([para('{{hora}} {{data+7d:AAAA-MM-DD}} {{foo}}')], { ...ctx, time: '08:30' })
  assert.equal(((extra[0].content as { text: string }[]).map(i => i.text)).join(''), '08:30 2026-10-14 {{foo}}')
})
void api
