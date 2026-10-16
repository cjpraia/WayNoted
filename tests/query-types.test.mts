// Consultas × tipos de objeto: filtro "Tipo" (é / não é / qualquer um de / tem algum / sem tipo), fonte "tipo",
// campos do tipo como filtro/coluna/ordenação, agrupar/ordenar por tipo, "não (…)", texto ↔ modelo,
// "Abrir como banco" e filtro rápido. Puro (sem DOM).
import test from 'node:test'
import assert from 'node:assert/strict'
import { runQuery } from '../src/query/engine.ts'
import { defaultQuery, normalizeQuery, stripIds, type Query, type QueryNode } from '../src/query/model.ts'
import { parseQueryText, serializeQuery, querySuggestions } from '../src/query/text.ts'
import { queryToLinkedView } from '../src/query/convert.ts'
import { buildVirtualDb, defaultColumns } from '../src/query/virtualDb.ts'
import { countTypes, facetBaseQuery, toggleTypeFacet, typeFacets } from '../src/query/facets.ts'
import { matchPageType, queryTypeIds, typeFieldOf } from '../src/query/typeField.ts'
import { normalizeObjectTypes } from '../src/objecttypes/model.ts'
import { ID, NOW, fixturePages, page } from './fixtures/query-fixture.mjs'

const T = { person: 'type-person', tags: 'type-tags', project: 'type-project', client: 'type-client' }
const types = normalizeObjectTypes([
  { id: T.person, name: 'Pessoa', icon: 'lucide:user', color: 'blue', properties: [{ id: 'f-email', name: 'E-mail', type: 'email' }, { id: 'f-age', name: 'Idade', type: 'number' }] },
  { id: T.tags, name: 'Tags', icon: 'lucide:tag', color: 'pink', properties: [] },
  { id: T.project, name: 'Projeto', icon: '🚀', color: 'green', properties: [{ id: 'f-phase', name: 'Fase', type: 'select', options: [{ id: 'o1', name: 'Ideia', color: 'gray' }, { id: 'o2', name: 'Execução', color: 'blue' }] }] },
  { id: T.client, name: 'Cliente', icon: null, color: 'orange', parentTypes: [T.project], properties: [] },
])
const P = { adelson: 'a0000000-0000-4000-8000-000000000001', macbook: 'a0000000-0000-4000-8000-000000000002', bruna: 'a0000000-0000-4000-8000-000000000003', acme: 'a0000000-0000-4000-8000-000000000004' }
function pages() {
  const base = fixturePages()
  base[P.adelson] = page(P.adelson, { title: 'Adelson', icon: 'lucide:user', types: [T.person], typeProps: { 'f-email': 'adelson@example.com', 'f-age': 41 }, updatedAt: NOW.getTime() - 1000 })
  base[P.bruna] = page(P.bruna, { title: 'Bruna', types: [T.person], typeProps: { 'f-age': 29 }, updatedAt: NOW.getTime() - 2000 })
  base[P.macbook] = page(P.macbook, { title: 'Macbook', icon: '💻', types: [T.tags], updatedAt: NOW.getTime() - 3000 })
  base[P.acme] = page(P.acme, { title: 'Acme', types: [T.client], typeProps: { 'f-phase': 'o2' }, updatedAt: NOW.getTime() - 4000 })
  // Linha de banco com tipo: o campo do tipo vale fora do esquema do banco.
  base[ID.p1] = { ...base[ID.p1], types: [T.project], typeProps: { 'f-phase': 'o1' } }
  return base
}
const env = (extra = {}) => ({ pages: pages(), locale: 'pt-BR' as const, now: NOW, thisPageId: ID.home, types, ...extra })
const rule = (field: string, op: string, value: unknown): QueryNode => ({ kind: 'rule', id: Math.random().toString(36).slice(2), field, op: op as never, value: value as never })
const where = (operator: 'and' | 'or', ...children: QueryNode[]) => ({ kind: 'group' as const, id: 'root', operator, children })
const titles = (q: Partial<Query>, e = env()) => runQuery(defaultQuery({ sorts: [{ field: '@title', direction: 'asc' }], ...q }), e).rows.map((row) => row.title)
const ctx = { locale: 'pt-BR' as const, types: types.map((type) => ({ id: type.id, name: type.name })), databases: [{ id: ID.projects, title: 'Projetos' }] }
const serialize = (q: Query, locale: 'pt-BR' | 'en-US' = 'pt-BR') => serializeQuery(q, { locale, typeName: (id) => types.find((type) => type.id === id)?.name, databaseName: (id) => id === ID.projects ? 'Projetos' : undefined })

test('filtro Tipo: é, não é, qualquer um de, tem algum tipo, sem tipo; subtipos e nomes', () => {
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'is', T.person)) }), ['Adelson', 'Bruna'])
  // Subtipo: Cliente herda de Projeto.
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'is', T.project)) }), ['Acme', 'Site novo'])
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'is', [T.person, T.tags])) }), ['Adelson', 'Bruna', 'Macbook'])
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'isNotEmpty', null)) }), ['Acme', 'Adelson', 'Bruna', 'Macbook', 'Site novo'])
  const untyped = titles({ filter: where('and', rule('@type', 'isEmpty', null)) })
  assert.ok(untyped.includes('Notas') && !untyped.includes('Adelson') && !untyped.includes('Diário secreto'), untyped.join(','))
  const notPerson = titles({ filter: where('and', rule('@type', 'isNot', T.person)) })
  assert.ok(notPerson.includes('Macbook') && notPerson.includes('Notas') && !notPerson.includes('Bruna'))
  // Nome (do modo texto, sem acento/caixa) também resolve; nome inexistente nunca casa.
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'is', 'pessoa')) }), ['Adelson', 'Bruna'])
  assert.deepEqual(titles({ filter: where('and', rule('@type', 'is', 'Inexistente')) }), [])
  // Sem valor: não restringe (como os filtros dos bancos).
  assert.equal(titles({ filter: where('and', rule('@type', 'is', null)) }).length, titles({}).length)
  assert.equal(matchPageType(types, { types: ['apagado'] }, 'isEmpty', null), true)
})

test('filtro Tipo funciona dentro de E/OU aninhado e com "não (…)"', () => {
  const q = { filter: where('or', rule('@type', 'is', T.tags), { kind: 'group' as const, id: 'g', operator: 'and' as const, children: [rule('@type', 'is', T.person), rule('Idade', 'gt', 30)] }) }
  assert.deepEqual(titles(q), ['Adelson', 'Macbook'])
  const negated = { filter: where('and', rule('@type', 'isNotEmpty', null), { kind: 'group' as const, id: 'n', operator: 'or' as const, negate: true, children: [rule('@type', 'is', T.person), rule('@type', 'is', T.project)] }) }
  assert.deepEqual(titles(negated), ['Macbook'])
  // normalize preserva "negate" em grupos internos e descarta na raiz.
  const normalized = normalizeQuery({ filter: { kind: 'group', negate: true, children: [{ kind: 'group', negate: true, children: [] }] } })
  assert.equal(normalized.filter.negate, undefined)
  assert.equal((normalized.filter.children[0] as { negate?: boolean }).negate, true)
})

test('fonte "tipo": páginas do tipo onde estiverem; tipo excluído vira aviso', () => {
  assert.deepEqual(titles({ source: { kind: 'type', typeIds: [T.person] } }), ['Adelson', 'Bruna'])
  assert.deepEqual(titles({ source: { kind: 'type', typeIds: [T.project, T.tags] } }), ['Acme', 'Macbook', 'Site novo'])
  const result = runQuery(defaultQuery({ source: { kind: 'type', typeIds: ['sumiu'] } }), env())
  assert.equal(result.rows.length, 0)
  assert.equal(result.issues[0]?.kind, 'missingType')
  assert.deepEqual(normalizeQuery({ source: { kind: 'type', typeIds: ['a', 'a', 3, ''] } }).source, { kind: 'type', typeIds: ['a'] })
})

test('campos do tipo: filtro, ordenação, coluna e valor (inclusive em linha de banco)', () => {
  assert.deepEqual(titles({ source: { kind: 'type', typeIds: [T.person] }, filter: where('and', rule('Idade', 'lt', 35)) }), ['Bruna'])
  assert.deepEqual(titles({ source: { kind: 'type', typeIds: [T.person] }, sorts: [{ field: 'Idade', direction: 'desc' }] }), ['Adelson', 'Bruna'])
  assert.deepEqual(titles({ source: { kind: 'type', typeIds: [T.project] }, filter: where('and', rule('Fase', 'is', 'Execução')) }), ['Acme'])
  assert.equal(typeFieldOf(types, pages()[ID.p1], 'fase')?.value, 'o1')
  const result = runQuery(defaultQuery({ source: { kind: 'type', typeIds: [T.person] } }), env())
  assert.equal(result.issues.length, 0)
  assert.deepEqual(defaultColumns(defaultQuery({ source: { kind: 'type', typeIds: [T.person] } }), pages(), null, result.rows, types), ['@title', 'E-mail', 'Idade'])
  assert.deepEqual(queryTypeIds(defaultQuery({ filter: where('and', rule('@type', 'is', [T.person, 'Tags'])) }), types), [T.person, T.tags])
  const vdb = buildVirtualDb(defaultQuery({ source: { kind: 'type', typeIds: [T.person] }, columns: ['@title', '@type', '@icon', 'E-mail', 'Idade'] }), result, pages(), 'b', { title: 'Q', fieldName: (f) => f }, false, types)
  const [, typeCol, iconCol, emailCol, ageCol] = vdb.visibleProps
  assert.equal(typeCol.type, 'multiSelect')
  assert.equal(typeCol.options?.[0]?.name, 'Pessoa')
  assert.equal(typeCol.options?.[0]?.icon, 'lucide:user')
  assert.equal(typeCol.options?.[0]?.color, 'blue')
  assert.equal(iconCol.display, 'icon')
  assert.equal(emailCol.type, 'email')
  assert.equal(ageCol.type, 'number')
  const adelson = vdb.rows.find((row) => row.title === 'Adelson')!
  assert.deepEqual(adelson.props?.[typeCol.id], [T.person])
  assert.equal(adelson.props?.[iconCol.id], 'lucide:user')
  assert.equal(adelson.props?.[emailCol.id], 'adelson@example.com')
  assert.equal(adelson.props?.[ageCol.id], 41)
})

test('agrupar e ordenar por tipo, com contagens e "Sem tipo" no fim', () => {
  const result = runQuery(defaultQuery({ filter: where('and', rule('@title', 'contains', 'a')), groupBy: '@type' }), env())
  const groups = result.groups!.map((group) => [group.label, group.rows.length, group.typeId ?? null])
  assert.deepEqual(groups.slice(0, 1), [['Pessoa', 2, T.person]])
  assert.equal(groups.at(-1)?.[0], '')
  assert.ok(groups.some(([label]) => label === 'Cliente'))
  const sorted = titles({ source: { kind: 'type', typeIds: [T.person, T.tags, T.project] }, sorts: [{ field: '@type', direction: 'asc' }, { field: '@title', direction: 'asc' }] })
  assert.deepEqual(sorted, ['Acme', 'Adelson', 'Bruna', 'Site novo', 'Macbook'])
})

test('modo texto: tipo, listas, fonte tipo e "não (…)" ida e volta nos dois idiomas', () => {
  const samples = [
    'tabela de todas as páginas onde tipo = "Pessoa" e Idade > 30',
    'tabela de todas as páginas onde tipo = ("Pessoa", "Tags") ordenar tipo agrupar por tipo colunas título, tipo, ícone',
    'lista de tipo "Pessoa", "Projeto" onde não (Idade < 30 ou tipo vazio)',
    'tabela de todas as páginas onde tipo != "Tags" e tipo não vazio',
  ]
  for (const text of samples) {
    const parsed = parseQueryText(text, ctx)
    assert.equal(parsed.error, null, `${text}: ${parsed.error?.message}`)
    for (const locale of ['pt-BR', 'en-US'] as const) {
      const again = parseQueryText(serialize(parsed.query!, locale), { ...ctx, locale })
      assert.equal(again.error, null, serialize(parsed.query!, locale))
      assert.deepEqual(stripIds(again.query!), stripIds(parsed.query!), serialize(parsed.query!, locale))
    }
  }
  const q = parseQueryText(samples[1], ctx).query!
  assert.deepEqual((q.filter.children[0] as { value: unknown }).value, [T.person, T.tags])
  assert.equal(parseQueryText('tabela de tipo "Nada"', ctx).error?.message, 'Tipo “Nada” não encontrado.')
  // Propriedade de banco chamada "Tipo" continua acessível entre aspas.
  assert.equal((parseQueryText('tabela onde "Tipo" = "X"', ctx).query!.filter.children[0] as { field: string }).field, 'Tipo')
  assert.ok(serialize(normalizeQuery({ filter: { kind: 'group', children: [{ kind: 'rule', field: 'Tipo', op: 'is', value: 'X' }] } })).includes('"Tipo" = "X"'))
  const suggestions = querySuggestions('tabela onde tipo = ', 19, ctx).suggestions.map((s) => s.label)
  assert.ok(suggestions.includes('Pessoa'), suggestions.join(','))
})

test('"Abrir como banco": Tipo vira filtro da visualização; "não (…)" vira De Morgan; listas viram OU', () => {
  let n = 0
  const newId = () => `id${++n}`
  const q = defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: where('and', rule('@type', 'is', ['Projeto', T.tags]), { kind: 'group', id: 'g', operator: 'or', negate: true, children: [rule('Horas', 'gt', 10), rule('Status', 'is', 'Pausado')] }) })
  const out = queryToLinkedView(q, pages(), { viewName: 'V', newId, types })
  assert.equal(out.ok, true)
  if (!out.ok) return
  const view = out.schema.views[0]
  const typeFilters = view.filters.filter((f) => f.propertyId === '@type')
  assert.deepEqual(typeFilters.map((f) => [f.op, f.value]), [['contains', T.project], ['contains', T.tags]])
  assert.deepEqual(view.filters.filter((f) => f.propertyId !== '@type').map((f) => [f.propertyId, f.op, f.value]), [['ph', 'lte', 10], ['ps', 'isNot', 's2']])
  const tree = view.filterTree!
  assert.equal(tree.kind === 'group' && tree.operator, 'and')
  const [typeGroup, negated] = tree.kind === 'group' ? tree.children : []
  assert.equal(typeGroup.kind === 'group' && typeGroup.operator, 'or')
  assert.equal(negated.kind === 'group' && negated.operator, 'and')
  const empty = queryToLinkedView(defaultQuery({ source: { kind: 'database', databaseIds: [ID.projects] }, filter: where('and', rule('@type', 'isEmpty', null)) }), pages(), { viewName: 'V', newId, types })
  assert.ok(empty.ok && empty.schema.views[0].filters[0].op === 'isEmpty' && empty.schema.views[0].filters[0].propertyId === '@type')
})

test('filtro rápido por tipo: contagens sem os próprios filtros de tipo; marcar/desmarcar', () => {
  const e = env()
  let q = defaultQuery({ filter: where('and', rule('@title', 'contains', 'a')) })
  const facets = typeFacets(q, runQuery(q, e), e, types, { key: 'k', allowRun: true })!
  assert.deepEqual(facets.facets.slice(0, 1), [{ typeId: T.person, count: 2 }])
  assert.equal(facets.facets.at(-1)?.typeId, null)
  q = toggleTypeFacet(q, T.person, types)
  assert.deepEqual(titles(q), ['Adelson', 'Bruna'])
  const again = typeFacets(q, runQuery(q, e), e, types, { key: 'k', allowRun: true })!
  assert.ok(again.active.has(T.person))
  assert.ok(again.facets.some((facet) => facet.typeId === T.tags), 'os outros tipos continuam com contagem')
  q = toggleTypeFacet(q, T.tags, types)
  assert.deepEqual(titles(q), ['Adelson', 'Bruna', 'Macbook'])
  q = toggleTypeFacet(q, null, types)
  assert.ok(titles(q).every((title) => !['Adelson', 'Macbook'].includes(title)))
  q = toggleTypeFacet(q, null, types)
  assert.equal(q.filter.children.length, 1)
  assert.equal(facetBaseQuery({ ...q, limit: 3 }).limit, undefined)
  assert.equal(typeFacets(q, runQuery(q, e), e, [], { key: 'k', allowRun: true }), null)
  assert.deepEqual(countTypes([pages()[P.macbook]], types), [{ typeId: T.tags, count: 1 }])
  // Raiz "OU": o filtro rápido entra num "E" por cima, sem mudar o significado do resto.
  const or = toggleTypeFacet(defaultQuery({ filter: where('or', rule('@title', 'contains', 'Ad'), rule('@title', 'contains', 'Mac')) }), T.person, types)
  assert.deepEqual(titles(or), ['Adelson'])
})
