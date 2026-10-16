import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQueryText, serializeQuery, highlightQuery, querySuggestions, applyQuerySuggestion, tokenize } from '../src/query/text.ts'
import { defaultQuery, stripIds, type Query } from '../src/query/model.ts'
import { ID } from './fixtures/query-fixture.mjs'

const context = {
  databases: [{ id: ID.projects, title: 'Projetos' }, { id: ID.tasks, title: 'Tarefas' }, { id: ID.people, title: 'Pessoas' }],
  pages: [{ id: ID.home, title: 'Início' }, { id: ID.notes, title: 'Notas' }],
  properties: ['Status', 'Prazo', 'Horas', 'Tags', 'Data de entrega', 'Feito', 'Projeto'],
  options: { Status: ['Em andamento', 'Pausado', 'Concluído'] },
}
const ctxSerialize = (locale: 'pt-BR' | 'en-US') => ({ locale, databaseName: (id: string) => context.databases.find((db) => db.id === id)?.title, pageTitle: (id: string) => context.pages.find((p) => p.id === id)?.title })

test('exemplo da especificação em PT-BR', () => {
  const { query, error } = parseQueryText('tabela de "Projetos" onde Status = "Em andamento" e Prazo < hoje+7d ordenar Prazo limite 20', context)
  assert.equal(error, null)
  assert.equal(query!.display, 'table')
  assert.deepEqual(query!.source, { kind: 'database', databaseIds: [ID.projects] })
  assert.deepEqual(query!.filter.children.map((node) => node.kind === 'rule' && [node.field, node.op, node.value]), [['Status', 'is', 'Em andamento'], ['Prazo', 'lt', '@today+7d']])
  assert.deepEqual(query!.sorts, [{ field: 'Prazo', direction: 'asc' }])
  assert.equal(query!.limit, 20)
})

test('sintaxe em inglês, OU aninhado, campos de página e todas as fontes', () => {
  const en = parseQueryText('list from all pages where edited is last 7 days and (title contains "plan" or words > 100) sort edited desc, title group by database limit 5 columns title, edited', { ...context, locale: 'en-US' })
  assert.equal(en.error, null, en.error?.message)
  const q = en.query!
  assert.equal(q.display, 'list')
  assert.equal(q.source.kind, 'pages')
  assert.equal(q.filter.operator, 'and')
  assert.equal(q.filter.children[1].kind, 'group')
  assert.deepEqual(q.sorts, [{ field: '@updated', direction: 'desc' }, { field: '@title', direction: 'asc' }])
  assert.equal(q.groupBy, '@database')
  assert.deepEqual(q.columns, ['@title', '@updated'])
  const sources: [string, unknown][] = [
    ['lista de "Projetos", "Tarefas"', { kind: 'databases', databaseIds: [ID.projects, ID.tasks] }],
    ['lista de filhas de esta página', { kind: 'children', pageId: '@thisPage' }],
    ['lista de descendentes de "Notas"', { kind: 'children', pageId: ID.notes, deep: true }],
    ['lista de #ideia', { kind: 'tag', tag: 'ideia' }],
    ['lista de tag "minha etiqueta"', { kind: 'tag', tag: 'minha etiqueta' }],
    ['lista de modificadas nos últimos 3 dias', { kind: 'modified', days: 3 }],
    ['lista de relacionadas a esta página em "Tarefas"', { kind: 'relatedToThis', databaseIds: [ID.tasks] }],
    ['lista de backlinks', { kind: 'backlinks' }],
    ['lista de backlinks de "Notas"', { kind: 'backlinks', pageId: ID.notes }],
    ['lista de tarefas incluindo concluídas', { kind: 'tasks', includeDone: true }],
    ['contagem from tasks', { kind: 'tasks' }],
  ]
  for (const [text, source] of sources) { const parsed = parseQueryText(text, context); assert.equal(parsed.error, null, `${text}: ${parsed.error?.message}`); assert.deepEqual(parsed.query!.source, source, text) }
  const ops = parseQueryText('tabela de "Tarefas" onde Feito = não e Projeto contém esta página e Prazo antes de amanhã e Status não vazio e "Data de entrega" vazio e Horas != 3 e Prazo depois de 2026-10-01 e Status não contém "x" ou Prazo = próximo mês-1m', context)
  assert.equal(ops.error, null, ops.error?.message)
  const rules = ops.query!.filter.children.flatMap((node) => node.kind === 'group' ? node.children : [node]).map((node) => node.kind === 'rule' ? [node.field, node.op, node.value] : null)
  assert.deepEqual(rules, [['Feito', 'is', false], ['Projeto', 'contains', '@thisPage'], ['Prazo', 'before', '@tomorrow'], ['Status', 'isNotEmpty', null], ['Data de entrega', 'isEmpty', null], ['Horas', 'isNot', 3], ['Prazo', 'after', '2026-10-01'], ['Status', 'notContains', 'x'], ['Prazo', 'is', '@nextMonth-1m']])
})

test('round-trip modelo → texto → modelo nos dois idiomas', () => {
  const queries: Query[] = [
    defaultQuery(),
    defaultQuery({ display: 'board', source: { kind: 'databases', databaseIds: [ID.projects, ID.tasks] }, groupBy: 'Status', limit: 50, columns: ['@title', 'Data de entrega', 'Status'] }),
    defaultQuery({ display: 'count', source: { kind: 'children', pageId: ID.notes, deep: true }, sorts: [{ field: 'Horas', direction: 'desc' }, { field: '@created', direction: 'asc' }] }),
    defaultQuery({ display: 'gallery', source: { kind: 'tag', tag: 'minha etiqueta' }, filter: { kind: 'group', id: 'root', operator: 'or', children: [
      { kind: 'rule', id: 'a', field: 'Status', op: 'is', value: 'Em "andamento"' },
      { kind: 'group', id: 'g', operator: 'and', children: [{ kind: 'rule', id: 'b', field: '@updated', op: 'gte', value: '@past30d' }, { kind: 'rule', id: 'c', field: 'Feito', op: 'is', value: true }, { kind: 'rule', id: 'd', field: 'Horas', op: 'lte', value: 2.5 }] },
      { kind: 'rule', id: 'e', field: 'Prazo', op: 'isEmpty', value: null },
      { kind: 'rule', id: 'f', field: 'Projeto', op: 'contains', value: '@thisPage' },
      { kind: 'rule', id: 'h', field: 'Prazo', op: 'after', value: '@thisWeek+1w' },
      { kind: 'rule', id: 'i', field: 'Prazo', op: 'before', value: '2026-12-31' },
      { kind: 'rule', id: 'j', field: 'texto', op: 'contains', value: '5' },
    ] } }),
    defaultQuery({ display: 'list', source: { kind: 'tasks', includeDone: true }, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'a', field: '@due', op: 'is', value: '@today' }, { kind: 'rule', id: 'b', field: '@done', op: 'is', value: false }] } }),
    defaultQuery({ source: { kind: 'modified', days: 14 } }),
    defaultQuery({ source: { kind: 'relatedToThis', databaseIds: [ID.tasks] } }),
    defaultQuery({ source: { kind: 'backlinks', pageId: ID.notes } }),
    defaultQuery({ source: { kind: 'database', databaseIds: ['abcdef00-0000-4000-8000-000000000000'] } }),
  ]
  for (const locale of ['pt-BR', 'en-US'] as const) for (const query of queries) {
    const text = serializeQuery(query, ctxSerialize(locale))
    const parsed = parseQueryText(text, { ...context, locale })
    assert.equal(parsed.error, null, `${text} → ${parsed.error?.message}`)
    assert.deepEqual(stripIds(parsed.query!), stripIds(query), text)
    assert.equal(serializeQuery(parsed.query!, ctxSerialize(locale)), text)
  }
  assert.equal(serializeQuery(queries[1], ctxSerialize('pt-BR')), 'quadro de "Projetos", "Tarefas" agrupar por Status limite 50 colunas título, "Data de entrega", Status')
})

test('erros com posição e mensagens no idioma', () => {
  const cases: [string, number, RegExp][] = [
    ['tabela de "Inexistente"', 10, /não encontrado/],
    ['tabela de "Projetos" onde Status', 32, /operador/],
    ['tabela de "Projetos" onde Status = ', 35, /valor/],
    ['tabela de "Projetos onde', 10, /Aspas/],
    ['tabela de "Projetos" onde (Status = "x"', 39, /parêntese/],
    ['tabela de "Projetos" limite zero', 28, /número/],
    ['tabela de "Projetos" xyz', 21, /Esperava/],
    ['tabela de "Projetos" de "Tarefas"', 21, /repetida/],
    ['lista de modificadas nos últimos 3 semanas', 35, /dias/],
    ['tabela $', 7, /Caractere/],
  ]
  for (const [text, at, message] of cases) {
    const { error, query } = parseQueryText(text, context)
    assert.equal(query, null, text)
    assert.equal(error?.from, at, `${text}: ${JSON.stringify(error)}`)
    assert.match(error!.message, message, text)
    assert.ok(error!.to > error!.from)
  }
  assert.match(parseQueryText('table from "Nope"', { ...context, locale: 'en-US' }).error!.message, /not found/)
})

test('realce por papel e marca do erro; nomes desconhecidos em vermelho', () => {
  const text = 'tabela de "Projetos" onde Status = "Em andamento" e criada > hoje-3d e Desconhecida vazio'
  const segments = highlightQuery(text, context)
  const kindOf = (piece: string) => segments.find((segment) => segment.text === piece)?.kind
  assert.equal(segments.map((segment) => segment.text).join(''), text)
  assert.equal(kindOf('tabela'), 'keyword')
  assert.equal(kindOf('"Projetos"'), 'function')
  assert.equal(kindOf('Status'), 'property')
  assert.equal(kindOf('='), 'operator')
  assert.equal(kindOf('"Em andamento"'), 'string')
  assert.equal(kindOf('criada'), 'function')
  assert.equal(kindOf('hoje'), 'number')
  assert.equal(kindOf('-3d'), 'number')
  assert.equal(kindOf('Desconhecida'), 'unknown')
  const broken = highlightQuery('tabela de "Projetos" onde Status ~', context)
  assert.ok(broken.some((segment) => segment.error))
  assert.equal(tokenize('a “curly” b').tokens[1].value, 'curly')
})

test('autocompletar contextual: exibição, bancos, propriedades, operadores, opções e cláusulas', () => {
  const labels = (text: string, caret = text.length, locale: 'pt-BR' | 'en-US' = 'pt-BR') => querySuggestions(text, caret, { ...context, locale }, 40).suggestions.map((s) => s.label)
  assert.ok(labels('tab').includes('tabela'))
  assert.ok(labels('tabela de ').includes('Projetos'))
  assert.ok(labels('tabela de ').includes('todas as páginas'))
  assert.deepEqual(labels('tabela de "Pro'), ['Projetos'])
  assert.ok(labels('tabela de "Projetos" onde ').includes('Data de entrega'))
  assert.ok(labels('tabela de "Projetos" onde ').includes('criada'))
  assert.ok(labels('tabela de "Projetos" onde Status ').includes('contém'))
  assert.ok(labels('tabela de "Projetos" onde Status = ').includes('Em andamento'))
  assert.ok(labels('tabela de "Projetos" onde Prazo < ').includes('hoje+7d'))
  const after = labels('tabela de "Projetos" onde Status = "Pausado" ')
  assert.ok(after.includes('e') && after.includes('ou') && after.includes('ordenar por'))
  assert.ok(labels('table from "Projetos" ', undefined, 'en-US').includes('where'))
  const completion = querySuggestions('tabela de "Projetos" onde Data', 30, context)
  const pick = completion.suggestions.find((s) => s.label === 'Data de entrega')!
  assert.deepEqual(applyQuerySuggestion('tabela de "Projetos" onde Data', completion.from, completion.to, pick), { source: 'tabela de "Projetos" onde "Data de entrega" ', caret: 44 })
})
