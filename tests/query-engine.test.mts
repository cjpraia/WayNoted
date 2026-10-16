import test from 'node:test'
import assert from 'node:assert/strict'
import { runQuery, runQuerySliced, createQueryCache, queryDependencies, sameDependencies, isQueryable } from '../src/query/engine.ts'
import { defaultQuery, normalizeQuery, addRule, addGroup, removeNode, type Query, type QueryNode } from '../src/query/model.ts'
import { resolveDateRange, dayInZone, matchValue } from '../src/components/database/filterEngine.ts'
import { ID, NOW, fixturePages, checklists, page } from './fixtures/query-fixture.mjs'

const env = (extra = {}) => ({ pages: fixturePages(), locale: 'pt-BR' as const, now: NOW, thisPageId: ID.home, checklists: checklists(), ...extra })
const rule = (field: string, op: string, value: unknown): QueryNode => ({ kind: 'rule', id: Math.random().toString(36).slice(2), field, op: op as never, value: value as never })
const where = (operator: 'and' | 'or', ...children: QueryNode[]) => ({ kind: 'group' as const, id: 'root', operator, children })
const titles = (q: Partial<Query>, e = env()) => runQuery(defaultQuery(q), e).rows.map((row) => row.title)

test('fonte banco: filtro por seleção (por nome), data e ordenação múltipla', () => {
  const q = { source: { kind: 'database' as const, databaseIds: [ID.projects] }, filter: where('and', rule('Status', 'is', 'Em andamento')), sorts: [{ field: 'Prazo', direction: 'asc' as const }] }
  assert.deepEqual(titles(q), ['App móvel', 'Site novo'])
  assert.deepEqual(titles({ ...q, sorts: [{ field: 'Horas', direction: 'desc' }] }), ['App móvel', 'Site novo'])
  // Ordem manual sem ordenação; vazios no fim com ordenação.
  assert.deepEqual(titles({ source: q.source }), ['Site novo', 'App móvel', 'Arquivo antigo', 'Pesquisa'])
  assert.deepEqual(titles({ source: q.source, sorts: [{ field: 'Prazo', direction: 'desc' }] }), ['Site novo', 'App móvel', 'Arquivo antigo', 'Pesquisa'])
})

test('todos os operadores sobre propriedades', () => {
  const src = { kind: 'database' as const, databaseIds: [ID.projects] }
  const cases: [QueryNode, string[]][] = [
    [rule('Status', 'isNot', 'Em andamento'), ['Arquivo antigo', 'Pesquisa']],
    [rule('Horas', 'gt', 10), ['Site novo', 'App móvel']],
    [rule('Horas', 'gte', 12), ['Site novo', 'App móvel']],
    [rule('Horas', 'lt', 12), ['Arquivo antigo']],
    [rule('Horas', 'lte', 12), ['Site novo', 'Arquivo antigo']],
    [rule('Horas', 'is', 3), ['Arquivo antigo']],
    [rule('Horas', 'isEmpty', null), ['Pesquisa']],
    [rule('Horas', 'isNotEmpty', null), ['Site novo', 'App móvel', 'Arquivo antigo']],
    [rule('Tags', 'contains', 'ideia'), ['App móvel', 'Pesquisa']],
    [rule('Tags', 'notContains', 'ideia'), ['Site novo', 'Arquivo antigo']],
    [rule('Nome', 'contains', 'app'), ['App móvel']],
    [rule('Nome', 'notContains', 'a'), ['Site novo']],
    [rule('Prazo', 'before', '2026-10-01'), ['Arquivo antigo']],
    [rule('Prazo', 'after', '2026-10-01'), ['Site novo']],
    [rule('Prazo', 'lte', '2026-10-01'), ['App móvel', 'Arquivo antigo']],
    [rule('Prazo', 'is', '2026-10-10'), ['Site novo']],
    [rule('Equipe', 'contains', ID.bia), ['App móvel']],
    [rule('Equipe', 'contains', 'Ana'), ['Site novo', 'App móvel']],
  ]
  for (const [node, expected] of cases) assert.deepEqual(titles({ source: src, filter: where('and', node) }), expected, JSON.stringify(node))
})

test('OU aninhado dentro de E e campos de página', () => {
  const q = { source: { kind: 'database' as const, databaseIds: [ID.projects] }, filter: where('and', rule('Horas', 'isNotEmpty', null), { kind: 'group', id: 'g', operator: 'or', children: [rule('Status', 'is', 'Concluído'), rule('Tags', 'contains', 'cliente')] } as QueryNode) }
  assert.deepEqual(titles(q), ['Site novo', 'Arquivo antigo'])
  const pages = { source: { kind: 'children' as const }, sorts: [{ field: '@words', direction: 'desc' as const }] }
  assert.deepEqual(titles(pages), ['Notas', 'Ideias'])
  assert.deepEqual(titles({ ...pages, filter: where('and', rule('@cover', 'is', true)) }), ['Notas'])
  assert.deepEqual(titles({ ...pages, filter: where('and', rule('@icon', 'isNotEmpty', null)) }), ['Ideias'])
  assert.deepEqual(titles({ ...pages, filter: where('and', rule('@words', 'is', 5)) }), ['Ideias'])
  assert.deepEqual(titles({ ...pages, filter: where('and', rule('@content', 'contains', 'ideia')) }), ['Notas'])
  assert.deepEqual(titles({ ...pages, filter: where('and', rule('@parent', 'is', '@thisPage')) }), ['Notas', 'Ideias'])
  assert.deepEqual(titles({ source: { kind: 'pages' }, filter: where('and', rule('@favorite', 'is', true)) }), ['Início'])
  assert.deepEqual(titles({ source: { kind: 'pages' }, filter: where('and', rule('@database', 'is', 'Pessoas')) , sorts: [{ field: '@title', direction: 'asc' }] }), ['Ana', 'Bia'])
})

test('datas relativas: hoje±N, semana, mês, últimos/próximos N dias', () => {
  const e = { now: NOW }
  assert.deepEqual(resolveDateRange('@today', e), { start: '2026-10-08', end: '2026-10-08' })
  assert.deepEqual(resolveDateRange('@today+7d', e), { start: '2026-10-15', end: '2026-10-15' })
  assert.deepEqual(resolveDateRange('@today-1m', e), { start: '2026-09-08', end: '2026-09-08' })
  assert.deepEqual(resolveDateRange('@thisWeek', e), { start: '2026-10-04', end: '2026-10-10' })
  assert.deepEqual(resolveDateRange('@thisWeek', { ...e, weekStart: 1 }), { start: '2026-10-05', end: '2026-10-11' })
  assert.deepEqual(resolveDateRange('@nextMonth', e), { start: '2026-11-01', end: '2026-11-30' })
  assert.deepEqual(resolveDateRange('@lastMonth', e), { start: '2026-09-01', end: '2026-09-30' })
  assert.deepEqual(resolveDateRange('@past7d', e), { start: '2026-10-01', end: '2026-10-08' })
  assert.deepEqual(resolveDateRange('@next7d', e), { start: '2026-10-08', end: '2026-10-15' })
  assert.deepEqual(resolveDateRange('@yesterday', e), { start: '2026-10-07', end: '2026-10-07' })
  assert.deepEqual(resolveDateRange('@thisYear', e), { start: '2026-01-01', end: '2026-12-31' })
  assert.equal(resolveDateRange('@bogus', e), null)
  const src = { kind: 'database' as const, databaseIds: [ID.tasks] }
  assert.deepEqual(titles({ source: src, filter: where('and', rule('Prazo', 'lt', '@today+7d'), rule('Feito', 'is', false)) }), ['Wireframes', 'Protótipo'])
  assert.deepEqual(titles({ source: src, filter: where('and', rule('Prazo', 'is', '@thisWeek')) }), ['Wireframes'])
  assert.deepEqual(titles({ source: src, filter: where('and', rule('Prazo', 'lt', '@today')) }), ['Wireframes'])
  assert.deepEqual(titles({ source: { kind: 'pages' }, filter: where('and', rule('@updated', 'is', '@past7d')), sorts: [{ field: '@title', direction: 'asc' }] }), ['Notas', 'Ideias', 'Pesquisa', 'Protótipo', 'Publicar', 'Site novo', 'Wireframes'].sort((a, b) => a.localeCompare(b, 'pt-BR')))
})

test('fuso: "hoje" e o dia de carimbos seguem o fuso pedido', () => {
  const instant = Date.UTC(2026, 9, 8, 1, 30) // 01:30 UTC
  assert.equal(dayInZone(instant, 'Asia/Tokyo'), '2026-10-08')
  assert.equal(dayInZone(instant, 'America/Sao_Paulo'), '2026-10-07')
  assert.deepEqual(resolveDateRange('@today', { now: instant, timeZone: 'America/Sao_Paulo' }), { start: '2026-10-07', end: '2026-10-07' })
  assert.deepEqual(resolveDateRange('@today', { now: instant, timeZone: 'Asia/Tokyo' }), { start: '2026-10-08', end: '2026-10-08' })
  const prop = { id: '@created', name: 'c', type: 'createdTime' as const }
  assert.equal(matchValue(instant, prop, { op: 'is', value: '@today' }, { pages: {}, now: instant, timeZone: 'America/Sao_Paulo' }), true)
  assert.equal(matchValue(instant, prop, { op: 'is', value: '2026-10-08' }, { pages: {}, timeZone: 'America/Sao_Paulo' }), false)
  assert.equal(matchValue(instant, prop, { op: 'is', value: '2026-10-08' }, { pages: {}, timeZone: 'Asia/Tokyo' }), true)
})

test('"esta página": linhas com relação para a página atual', () => {
  assert.deepEqual(titles({ source: { kind: 'relatedToThis' } }, env({ thisPageId: ID.p1 })).sort(), ['Publicar', 'Wireframes'])
  assert.deepEqual(titles({ source: { kind: 'database', databaseIds: [ID.tasks] }, filter: where('and', rule('Projeto', 'contains', '@thisPage')) }, env({ thisPageId: ID.p2 })), ['Protótipo'])
  assert.deepEqual(titles({ source: { kind: 'database', databaseIds: [ID.tasks] }, filter: where('and', rule('Projeto', 'notContains', '@thisPage')) }, env({ thisPageId: ID.p2 })), ['Wireframes', 'Publicar'])
  assert.deepEqual(titles({ source: { kind: 'relatedToThis', databaseIds: [ID.projects] } }, env({ thisPageId: ID.ana })).sort(), ['App móvel', 'Site novo'])
})

test('fontes: páginas, vários bancos, filhas (recursivo), tag, modificadas, backlinks e tarefas', () => {
  const all = titles({ source: { kind: 'pages' }, sorts: [{ field: '@title', direction: 'asc' }] })
  assert.ok(all.includes('Início') && all.includes('Site novo'))
  const multi = runQuery(defaultQuery({ source: { kind: 'databases', databaseIds: [ID.projects, ID.tasks] }, filter: where('and', rule('Status', 'is', 'Em andamento')) }), env())
  assert.deepEqual(multi.rows.map((row) => row.title), ['Site novo', 'App móvel', 'Wireframes'])
  assert.deepEqual(multi.databaseIds, [ID.projects, ID.tasks])
  assert.deepEqual(titles({ source: { kind: 'children', pageId: ID.projects } }), ['Site novo', 'App móvel', 'Arquivo antigo', 'Pesquisa'])
  assert.deepEqual(titles({ source: { kind: 'tag', tag: 'ideia' } }).sort(), ['App móvel', 'Notas', 'Pesquisa'])
  assert.deepEqual(titles({ source: { kind: 'tag', tag: 'projeto' } }), ['Notas'])
  assert.deepEqual(titles({ source: { kind: 'modified', days: 2 } }), ['Notas', 'Wireframes', 'Site novo', 'Protótipo'])
  assert.deepEqual(titles({ source: { kind: 'backlinks' } }), ['Notas', 'Ideias'])
  assert.deepEqual(titles({ source: { kind: 'backlinks', pageId: ID.p1 } }), ['Ideias'])
  const tasks = runQuery(defaultQuery({ source: { kind: 'tasks' } }), env())
  assert.ok(tasks.rows.some((row) => row.title === 'Ligar para cliente'))
  assert.ok(!tasks.rows.some((row) => row.title === 'Comprar café'))
  assert.ok(tasks.rows.some((row) => row.title === 'Wireframes'))
  assert.deepEqual(titles({ source: { kind: 'tasks' }, filter: where('and', rule('@due', 'is', '@today')) }), ['Ligar para cliente'])
  assert.ok(titles({ source: { kind: 'tasks', includeDone: true } }).includes('Comprar café'))
  assert.equal(tasks.tasks?.size, tasks.rows.length)
})

test('privacidade: lixeira e páginas protegidas (e filhas) nunca entram', () => {
  const sources: Query['source'][] = [{ kind: 'pages' }, { kind: 'tag', tag: 'ideia' }, { kind: 'modified', days: 30 }, { kind: 'backlinks' }, { kind: 'tasks' }, { kind: 'children', pageId: ID.secret }, { kind: 'children', pageId: ID.secret, deep: true }]
  for (const source of sources) {
    const out = titles({ source, filter: where('or', rule('@content', 'contains', 'segredo'), rule('@title', 'isNotEmpty', null)) })
    for (const forbidden of ['Diário secreto', 'Filho secreto', 'Lixo', 'Tarefa secreta']) assert.ok(!out.includes(forbidden), `${source.kind} vazou ${forbidden}`)
  }
  const e = env()
  assert.equal(isQueryable(e.pages, ID.secretChild), false)
  // Banco dentro de página protegida: nada é lido e o problema é relatado.
  const pages = fixturePages()
  pages[ID.projects] = { ...pages[ID.projects], parentId: ID.secret }
  const result = runQuery(defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] } }), { ...e, pages })
  assert.equal(result.rows.length, 0)
  assert.equal(result.issues[0]?.kind, 'lockedDatabase')
  // Mesmo desbloqueada na sessão, a página protegida fica de fora.
  pages[ID.secret] = { ...pages[ID.secret], passwordLock: { rootId: ID.secret, hideTitle: false, unlocked: true } }
  assert.equal(runQuery(defaultQuery({ source: { kind: 'pages' }, filter: where('and', rule('@title', 'is', 'Diário secreto')) }), { ...e, pages }).rows.length, 0)
})

test('agrupamento (1 nível), limite, contagem total e problemas', () => {
  const result = runQuery(defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, groupBy: 'Status', limit: 3 }), env())
  assert.equal(result.total, 4)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(result.groups?.map((group) => [group.label, group.rows.length]), [['Em andamento', 2], ['Concluído', 1]])
  const byMissing = runQuery(defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, groupBy: 'Horas' }), env())
  assert.equal(byMissing.groups?.at(-1)?.label, '')
  const missing = runQuery(defaultQuery({ source: { kind: 'database', databaseIds: ['ffffffff-0000-4000-8000-000000000000'] }, filter: where('and', rule('Inexistente', 'is', 'x')) }), env())
  assert.deepEqual(missing.issues.map((issue) => issue.kind), ['missingDatabase'])
  const unknown = runQuery(defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: where('and', rule('Inexistente', 'isEmpty', null)) }), env())
  assert.equal(unknown.rows.length, 4)
  assert.deepEqual(unknown.issues, [{ kind: 'unknownField', detail: 'Inexistente' }])
})

test('modelo: normalização nunca lança e preserva dados antigos utilizáveis', () => {
  assert.deepEqual(normalizeQuery(null), defaultQuery())
  assert.deepEqual(normalizeQuery({ display: 'weird', source: { kind: 'nope' }, filter: 'x', sorts: 'y', limit: -3 }), defaultQuery())
  const legacy = normalizeQuery({ source: { kind: 'databases', databaseIds: [ID.projects] }, filter: { kind: 'rule', field: 'Status', op: 'is', value: 'Pausado' }, limit: 99999 })
  assert.equal(legacy.source.kind, 'database')
  assert.equal(legacy.filter.children.length, 1)
  assert.equal(legacy.limit, 10000)
  let root = defaultQuery().filter
  root = addRule(root, 'root', { kind: 'rule', id: 'a', field: 'Status', op: 'is', value: 'x' })
  root = addGroup(root, 'root', 'or')
  const groupId = root.children[1].id
  root = addRule(root, groupId, { kind: 'rule', id: 'b', field: 'Horas', op: 'gt', value: 1 })
  assert.equal(root.children.length, 2)
  assert.equal(removeNode(root, 'b').children[1].kind, 'group')
  assert.equal(removeNode(root, groupId).children.length, 1)
})

test('cache e dependências: mesma entrada reaproveita; outra página editada não invalida banco', () => {
  const e = env()
  const q = defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: where('and', rule('Horas', 'gt', 5)) })
  const deps = queryDependencies(q, e)
  const unrelated = { ...e.pages, [ID.notes]: { ...e.pages[ID.notes], text: 'digitando…', updatedAt: Date.now() } }
  assert.equal(sameDependencies(deps, queryDependencies(q, { ...e, pages: unrelated })), true)
  const edited = { ...e.pages, [ID.p3]: { ...e.pages[ID.p3], props: { ...e.pages[ID.p3].props, ph: 50 } } }
  assert.equal(sameDependencies(deps, queryDependencies(q, { ...e, pages: edited })), false)
  const cache = createQueryCache()
  assert.deepEqual(runQuery(q, e, cache).rows.map((row) => row.title), ['Site novo', 'App móvel'])
  assert.deepEqual(runQuery(q, { ...e, pages: edited }, cache).rows.map((row) => row.title), ['Site novo', 'App móvel', 'Arquivo antigo'])
  // Relação na consulta → depende do objeto pages inteiro.
  const rel = defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: where('and', rule('Equipe', 'contains', 'Ana')) })
  assert.equal(sameDependencies(queryDependencies(rel, e), queryDependencies(rel, { ...e, pages: unrelated })), false)
})

test('desempenho: 50 mil linhas em 3 bancos recalculadas em < 300 ms (frio) e fatiado', async () => {
  const pages = fixturePages()
  const dbs = [ID.projects, ID.tasks, ID.people]
  for (let i = 0; i < 50_000; i++) {
    const id = `9${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`
    const parentId = dbs[i % 3]
    pages[id] = page(id, { parentId, title: `Linha ${i}`, order: i, updatedAt: NOW.getTime() - (i % 90) * 86_400_000, text: i % 7 ? 'texto comum' : 'texto #ideia', props: parentId === ID.projects ? { ps: ['s1', 's2', 's3'][i % 3], ph: i % 50, pd: { start: `2026-${String(1 + (i % 12)).padStart(2, '0')}-15` } } : parentId === ID.tasks ? { tf: i % 2 === 0, tv: { start: '2026-10-09' }, ts: 'x1' } : { ne: `p${i}@x.com` } })
  }
  const q = defaultQuery({ source: { kind: 'databases', databaseIds: dbs }, filter: where('or', { kind: 'group', id: 'a', operator: 'and', children: [rule('Status', 'is', 'Em andamento'), rule('Horas', 'gt', 10)] }, rule('Prazo', 'lt', '@today+7d')), sorts: [{ field: 'Prazo', direction: 'asc' }, { field: '@title', direction: 'desc' }], groupBy: 'Status', limit: 500 })
  const e = { pages, locale: 'pt-BR' as const, now: NOW }
  const cache = createQueryCache()
  let started = performance.now()
  const result = runQuery(q, e, cache)
  const cold = performance.now() - started
  assert.ok(result.total > 10_000, `total ${result.total}`)
  assert.ok(cold < (process.env.CI ? 1500 : 300), `frio levou ${cold.toFixed(0)} ms`)
  started = performance.now()
  runQuery(q, e, cache)
  const warm = performance.now() - started
  assert.ok(warm < cold, `quente ${warm.toFixed(0)} ms >= frio ${cold.toFixed(0)} ms`)
  started = performance.now()
  const all = runQuery(defaultQuery({ source: { kind: 'pages' }, filter: where('and', rule('@content', 'contains', 'ideia')), sorts: [{ field: '@updated', direction: 'desc' }] }), e)
  const allPages = performance.now() - started
  assert.ok(allPages < (process.env.CI ? 1500 : 300), `todas as páginas levou ${allPages.toFixed(0)} ms`)
  assert.ok(all.total > 7000)
  let pauses = 0
  const sliced = await runQuerySliced(q, e, createQueryCache(), async () => { pauses++; await new Promise((resolve) => setTimeout(resolve, 0)) }, undefined, 2)
  assert.equal(sliced?.total, result.total)
  assert.ok(pauses > 0)
  console.log(`[perf] 50k frio ${cold.toFixed(1)} ms · quente ${warm.toFixed(1)} ms · todas as páginas ${allPages.toFixed(1)} ms · pausas ${pauses}`)
})
