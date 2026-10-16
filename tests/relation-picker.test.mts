import test from 'node:test'
import assert from 'node:assert/strict'
import { backfillMirror, findMirrorCandidate, listDataSources, mirrorPropertyName, pagePath, planRelationPicker, relationTargetRows, toggleRelationValue } from '../src/components/database/relationPicker.ts'
import { planRelationMirror } from '../src/components/database/engines.ts'

const page = (id: string, extra: Record<string, unknown> = {}) => ({ id, parentId: null, title: id, icon: null, cover: null, order: 0, trashed: false, createdAt: 1, updatedAt: 1, ...extra }) as any
const schema = (properties: unknown[], extra: Record<string, unknown> = {}) => ({ properties, views: [], activeViewId: '', ...extra })

function fixture() {
  return {
    home: page('home', { title: 'Pessoal' }),
    folder: page('folder', { title: 'teste bundle', parentId: 'home' }),
    t1: page('t1', { title: 't1', parentId: 'folder', database: schema([{ id: 'name', name: 'Nome', type: 'title' }, { id: 'rel', name: 'T2', type: 'relation', relationDatabaseId: 't2' }]) }),
    t2: page('t2', { title: 'T2', parentId: 'folder', database: schema([{ id: 'name', name: 'Nome', type: 'title' }, { id: 'done', name: 'Feito', type: 'checkbox' }]) }),
    linked: page('linked', { title: 'Visão vinculada', parentId: 'home', database: schema([{ id: 'name', name: 'Nome', type: 'title' }], { linkedSourceId: 't2' }) }),
    a: page('a', { title: 'teste 1', parentId: 't1', order: 1, props: { rel: ['d'] } }),
    b: page('b', { title: 'teste 2', parentId: 't1', order: 2 }),
    c: page('c', { title: 'teste 3', parentId: 't2', order: 1, props: { done: true } }),
    d: page('d', { title: 'Teste 4 – ação', parentId: 't2', order: 2 }),
    gone: page('gone', { title: 'teste lixo', parentId: 't2', order: 3, trashed: true }),
  } as Record<string, any>
}

test('planRelationPicker separa selecionadas e “selecionar mais”, ignorando a lixeira', () => {
  const pages = fixture()
  const plan = planRelationPicker({ pages, rows: relationTargetRows(pages, 't2'), selectedIds: ['d'], query: '' })
  assert.deepEqual(plan.selected.map((p) => p.id), ['d'])
  assert.deepEqual(plan.more.map((p) => p.id), ['c'])
  assert.equal(plan.selectedCount, 1)
  assert.equal(plan.create, null)
})

test('a busca ignora acento e caixa e filtra as duas listas; texto novo oferece Criar', () => {
  const pages = fixture()
  const rows = relationTargetRows(pages, 't2')
  const plan = planRelationPicker({ pages, rows, selectedIds: ['d'], query: 'ACAO' })
  assert.deepEqual(plan.selected.map((p) => p.id), ['d'])
  assert.deepEqual(plan.more.map((p) => p.id), [])
  assert.equal(plan.create, 'ACAO')
  const none = planRelationPicker({ pages, rows, selectedIds: ['d'], query: '  zebra ' })
  assert.equal(none.selected.length + none.more.length, 0)
  assert.equal(none.create, 'zebra')
  const exact = planRelationPicker({ pages, rows, selectedIds: [], query: 'teste 3' })
  assert.equal(exact.create, null, 'título idêntico já existe: sem Criar')
  assert.deepEqual(exact.more.map((p) => p.id), ['c'])
})

test('filtro salvo esconde candidatas (mas nunca as selecionadas) e pode ser ignorado', () => {
  const pages = fixture()
  const rows = relationTargetRows(pages, 't2')
  const picker = { filters: [{ id: 'f', propertyId: 'done', op: 'checked' as const, value: null }] }
  const filtered = planRelationPicker({ pages, rows, selectedIds: [], query: '', picker })
  assert.deepEqual(filtered.more.map((p) => p.id), ['c'])
  assert.equal(filtered.hiddenByFilter, 1)
  const selected = planRelationPicker({ pages, rows, selectedIds: ['d'], query: '', picker })
  assert.deepEqual(selected.selected.map((p) => p.id), ['d'])
  const all = planRelationPicker({ pages, rows, selectedIds: [], query: '', picker, showAll: true })
  assert.deepEqual(all.more.map((p) => p.id), ['c', 'd'])
})

test('toggleRelationValue vincula/desvincula sem duplicar e mantém a ordem', () => {
  assert.deepEqual(toggleRelationValue(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggleRelationValue(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggleRelationValue([], 'a'), ['a'])
})

test('listDataSources lista bancos próprios com trilha, exclui visões vinculadas e filtra', () => {
  const pages = fixture()
  const all = listDataSources(pages)
  assert.deepEqual(all.map((s) => s.id), ['t1', 't2'])
  assert.equal(all[1].path, 'Pessoal / teste bundle')
  assert.equal(all[1].rows, 2)
  assert.equal(all[1].properties, 2)
  assert.deepEqual(listDataSources(pages, 't2').map((s) => s.id), ['t2'])
  assert.deepEqual(listDataSources(pages, 'pessoal').map((s) => s.id), ['t1', 't2'], 'a busca também casa com a trilha')
  assert.equal(pagePath(pages, 'home'), '')
})

test('relação bidirecional: espelho candidato, nome padrão e preenchimento que não apaga nada', () => {
  const pages = fixture()
  const property = pages.t1.database.properties[1]
  assert.equal(findMirrorCandidate(pages, 't1', property), undefined)
  assert.equal(mirrorPropertyName(pages, 't1', 't2', 'Sem título'), 't1')
  // Cria o espelho em T2 (o que a UI faz) e preenche a partir dos dados existentes.
  pages.t2 = { ...pages.t2, database: schema([...pages.t2.database.properties, { id: 'back', name: 't1', type: 'relation', relationDatabaseId: 't1', relationMirrorPropertyId: 'rel' }]) }
  pages.t1 = { ...pages.t1, database: schema(pages.t1.database.properties.map((p: any) => p.id === 'rel' ? { ...p, relationMirrorPropertyId: 'back' } : p)) }
  pages.c = { ...pages.c, props: { ...pages.c.props, back: ['b'] } }
  assert.equal(findMirrorCandidate(pages, 't1', pages.t1.database.properties[1])?.id, 'back')
  assert.equal(mirrorPropertyName(pages, 't1', 't2', 'Sem título'), 't1 2')
  assert.deepEqual(backfillMirror(pages, 't1', 'rel', 't2', 'back'), [{ rowId: 'd', value: ['a'] }])
  assert.deepEqual(backfillMirror(pages, 't2', 'back', 't1', 'rel'), [{ rowId: 'b', value: ['c'] }])
  // Depois de pareadas, a edição de um lado planeja o outro (comportamento existente preservado).
  pages.d = { ...pages.d, props: { back: ['a'] } }
  assert.deepEqual(planRelationMirror(pages, 'a', 'rel', ['d', 'c']), [{ rowId: 'c', propertyId: 'back', value: ['b', 'a'] }])
  assert.deepEqual(planRelationMirror(pages, 'a', 'rel', []), [{ rowId: 'd', propertyId: 'back', value: [] }])
})

test('banco com 5.000 páginas: planejamento do popover continua rápido', () => {
  const pages = fixture()
  for (let i = 0; i < 5000; i++) pages['p' + i] = page('p' + i, { parentId: 't2', title: 'Página ' + i, order: i })
  const rows = relationTargetRows(pages, 't2')
  assert.equal(rows.length, 5002)
  const started = performance.now()
  for (const query of ['', 'p', 'pá', 'pag', 'pagina 49', 'pagina 4999']) planRelationPicker({ pages, rows, selectedIds: ['p1', 'p2'], query })
  const elapsed = performance.now() - started
  assert.ok(elapsed < 1500, `6 buscas em ${Math.round(elapsed)} ms`)
  assert.deepEqual(planRelationPicker({ pages, rows, selectedIds: [], query: 'pagina 4999' }).more.map((p) => p.id), ['p4999'])
})
