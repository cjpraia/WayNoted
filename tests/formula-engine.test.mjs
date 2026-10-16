import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFormula, evaluateFormulaValue, formulaDiagnostic, formulaSyntaxError, formulaText, tokenizeFormula, formatDateTokens } from '../src/components/database/formula.ts'
import { FORMULA_FUNCTIONS, formulaFunctionDoc } from '../src/components/database/formulaCatalog.ts'
import { resolveValue, derivedErrorFor, previewFormula, matchesRelatedRules } from '../src/components/database/derived.ts'
import { aggregate, normalizeForAggregation, formatAggregate } from '../src/components/database/aggregations.ts'
import { calculateColumn, calculateColumnValue, calculationsFor, CALCULATIONS } from '../src/components/database/calculations.ts'

const NOW = new Date(2026, 9, 7, 14, 30)
const self = { kind: 'page', id: 'p1', title: 'Atual', get: () => undefined }
const run = (source, values = {}) => formulaText(evaluateFormulaValue(source, (name) => values[name] ?? null, { now: NOW, self }))

test('cada função do catálogo é implementada e o exemplo dá o resultado documentado', () => {
  assert.ok(FORMULA_FUNCTIONS.length >= 100, `catálogo com ${FORMULA_FUNCTIONS.length} funções`)
  const names = new Set()
  for (const doc of FORMULA_FUNCTIONS) {
    assert.ok(!names.has(doc.name.toLowerCase()), `duplicada: ${doc.name}`)
    names.add(doc.name.toLowerCase())
    assert.ok(doc.pt && doc.en && doc.signature, `documentação de ${doc.name}`)
    let value
    try { value = run(doc.example, { 'Preço': 10 }) } catch (error) { assert.fail(`${doc.name}: ${error.message}`) }
    if (doc.result !== undefined) assert.equal(value, doc.result, `${doc.name}: ${doc.example}`)
  }
  assert.equal(formulaFunctionDoc('DATEADD').name, 'dateAdd')
})

test('operadores, precedência, ternário, comentários e operadores unicode', () => {
  assert.equal(run('2 + 3 * 4 ^ 2'), '50')
  assert.equal(run('-2 ^ 2'), '-4')
  assert.equal(run('2 ^ 3 ^ 2'), '512')
  assert.equal(run('10 − 4 × 2 ÷ 4'), '8')
  assert.equal(run('1 ≤ 2 and 3 ≥ 3 and 1 ≠ 2'), 'true')
  assert.equal(run('5 > 3 ? "maior" : "menor"'), 'maior')
  assert.equal(run('false ? 1 : true ? 2 : 3'), '2')
  assert.equal(run('1 + /* comentário */ 2 // fim'), '3')
  assert.equal(run('not false && !(1 > 2) || false'), 'true')
  assert.equal(run('7 % 0'), '')
  assert.equal(run('"a" + 1'), 'a1')
  assert.equal(run('[1, 2] + [3]'), '1, 2, 3')
  assert.equal(run('"10" > 9'), 'true')
  assert.equal(run('"b" > "a"'), 'true')
  assert.equal(run('[10, 20, 30][1]'), '20')
  assert.equal(run('"abc".upper().length()'), '3')
})

test('propriedades por prop(), nomes diretos e erros com posição', () => {
  const resolve = (name) => ({ 'Preço': 12.5, Quantidade: 3, Nome: 'Livro' })[name]
  const value = (source) => formulaText(evaluateFormulaValue(source, undefined, { resolve, now: NOW }))
  assert.equal(value('prop("Preço") * Quantidade'), '37.5')
  assert.equal(value('Nome + "!"'), 'Livro!')
  assert.throws(() => value('prop("Inexistente")'), /Propriedade não encontrada/)
  const diagnostic = formulaDiagnostic('1 + desconhecida(2)', () => null)
  assert.match(diagnostic.error, /Função desconhecida: desconhecida/)
  assert.equal(diagnostic.at, 4)
  assert.equal(diagnostic.end, 16)
  const syntax = formulaSyntaxError('(1 + 2')
  assert.match(syntax.message, /Esperado “\)”/)
  assert.equal(syntax.at, 6)
  assert.match(formulaSyntaxError('"aberta').message, /String incompleta em 1/)
  assert.match(formulaSyntaxError('1 +', 'en-US').message, /Incomplete expression/)
  assert.equal(formulaSyntaxError('if(true, 1, 2)'), null)
  assert.deepEqual(tokenizeFormula('a.b(1)').map((token) => token.text), ['a', '.', 'b', '(', '1', ')'])
})

test('sem limite artificial de profundidade ou tamanho', () => {
  const deep = `${'('.repeat(300)}1${')'.repeat(300)}`
  assert.equal(run(deep), '1')
  const chain = Array.from({ length: 400 }, (_, index) => index).join(' + ')
  assert.equal(run(chain), String(399 * 400 / 2))
  const many = Array.from({ length: 5000 }, (_, index) => String(index))
  assert.equal(run('length(filter(prop("x"), current >= 0))', { x: many }), '5000')
})

test('texto: regex, divisão, preenchimento e conversões', () => {
  assert.equal(run('replaceAll("2026-10-07", "-", "/")'), '2026/10/07')
  assert.match(formulaDiagnostic('test("a", "(")', () => null).error, /Expressão regular inválida/)
  assert.equal(run('split("a; b", "; ").at(1)'), 'b')
  assert.equal(run('toNumber("1.234,5")'), '1234.5')
  assert.equal(run('toNumber("abc")'), '')
  assert.equal(run('format(true)'), 'true')
  assert.equal(run('join("-", "a", "b")'), 'a-b')
})

test('listas: map/filter/sort com chave, unique, índices e current/index', () => {
  assert.equal(run('[3, 1, 2].sort(current * -1)'), '3, 2, 1')
  assert.equal(run('map(["a", "b"], index + ":" + current)'), '0:a, 1:b')
  assert.equal(run('unique([1, "1", 2])'), '1, 2')
  assert.equal(run('let(xs, [1, 2, 3], sum(xs) / length(xs))'), '2')
  assert.equal(run('count(["a", "b", "a"], "a")'), '2')
  assert.equal(run('ifs(false, 1, false, 2)'), '')
  assert.throws(() => run('let(current, 1, 2)'), /Nome de variável inválido/)
})

test('datas: unidades, intervalos, formatação e hora', () => {
  assert.equal(run('dateAdd(now(), 90, "minutes")'), '2026-10-07 16:00')
  assert.equal(run('dateAdd("2024-02-29", 1, "years")'), '2025-02-28')
  assert.equal(run('dateAdd("2026-10-07", 2, "semanas")'), '2026-10-21')
  assert.equal(run('dateBetween("2026-01-31", "2026-02-28", "months")'), '1')
  assert.equal(run('dateBetween("2026-01-31", "2026-02-27", "months")'), '0')
  assert.equal(run('dateBetween("2026-01-01", "2027-06-01", "years")'), '1')
  assert.equal(run('dateBetween(now(), dateAdd(now(), 3, "hours"), "hours")'), '3')
  assert.equal(run('formatDate(now(), "dddd, D [de] MMMM [às] HH:mm")'), 'quarta-feira, 7 de outubro às 14:30')
  assert.equal(formatDateTokens(NOW, 'MMM D, YYYY h:mm A', 'en-US'), 'Oct 7, 2026 2:30 PM')
  assert.equal(run('formatDate(today())'), '7 de outubro de 2026')
  assert.equal(run('week(parseDate("2026-12-31"))'), '53')
  assert.equal(run('today() > parseDate("2026-01-01")'), 'true')
  assert.equal(run('dateEnd(prop("d"))', { d: { start: '2026-10-01', end: '2026-10-03' } }), '2026-10-03')
  assert.deepEqual(evaluateFormula('dateRange("2026-10-01", "2026-10-03")', () => null), { start: '2026-10-01', end: '2026-10-03' })
  assert.deepEqual(evaluateFormula('now()', () => null, { now: NOW }), { start: '2026-10-07', startTime: '14:30' })
  assert.match(formulaDiagnostic('parseDate("31/02/2026")', () => null).error, /Data inválida/)
  assert.match(formulaDiagnostic('dateAdd("2026-10-07", 1, "luas")', () => null).error, /Unidade de data desconhecida/)
})

test('style() gera texto rico com cores e negrito; concatenação preserva estilos', () => {
  const value = evaluateFormula('style("Atrasado", "b", "red") + " desde " + style("ontem", "i", "blue_background")', () => null)
  assert.equal(value.type, 'richText')
  assert.deepEqual(value.runs, [{ text: 'Atrasado', bold: true, color: 'red' }, { text: ' desde ' }, { text: 'ontem', italic: true, background: 'blue' }])
  assert.deepEqual(evaluateFormula('style("x", "#ff8800")', () => null).runs, [{ text: 'x', color: '#ff8800' }])
  assert.match(formulaDiagnostic('style("x", "neon")', () => null).error, /Estilo desconhecido/)
  assert.deepEqual(evaluateFormula('link("Site", "javascript:alert(1)")', () => null).runs, [{ text: 'Site' }])
  assert.equal(evaluateFormula('unstyle(style("x", "b"))', () => null), 'x')
})

// ---------- Bancos: relações, rollups, ciclos ----------

const view = { id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
const prop = (id, type, extra = {}) => ({ id, name: extra.name ?? id, type, ...extra })
const row = (id, parentId, title, props = {}, extra = {}) => ({ id, parentId, title, props, createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 2), trashed: false, order: 0, ...extra })

function workspace() {
  const status = prop('status', 'select', { name: 'Status', options: [{ id: 'o1', name: 'Aberta', color: 'red' }, { id: 'o2', name: 'Feita', color: 'green' }] })
  const tags = prop('tags', 'multiSelect', { name: 'Tags', options: [{ id: 't1', name: 'urgente', color: 'red' }, { id: 't2', name: 'casa', color: 'blue' }] })
  const price = prop('price', 'number', { name: 'Preço' })
  const due = prop('due', 'date', { name: 'Prazo' })
  const done = prop('done', 'checkbox', { name: 'Feito' })
  const double = prop('double', 'formula', { name: 'Dobro', formula: 'Preço * 2' })
  const relation = prop('rel', 'relation', { name: 'Tarefas', relationDatabaseId: 'tasks' })
  const projects = { id: 'projects', parentId: null, title: 'Projetos', database: { properties: [prop('ptitle', 'title', { name: 'Nome' }), relation], views: [view], activeViewId: 'v' } }
  const tasks = { id: 'tasks', parentId: null, title: 'Tarefas', database: { properties: [prop('title', 'title', { name: 'Nome' }), status, tags, price, due, done, double], views: [view], activeViewId: 'v' } }
  const pages = {
    projects, tasks,
    a: row('a', 'tasks', 'A', { status: 'o1', tags: ['t1', 't2'], price: 10, due: { start: '2026-10-01' }, done: true }),
    b: row('b', 'tasks', 'B', { status: 'o2', tags: ['t2'], price: 30, due: { start: '2026-10-09', end: '2026-10-12' } }),
    c: row('c', 'tasks', 'C', { status: 'o1', price: null }),
    gone: row('gone', 'tasks', 'Lixo', { price: 1000 }, { trashed: true }),
    p: row('p', 'projects', 'Projeto', { rel: ['a', 'b', 'c', 'gone'] }),
  }
  const addToProjects = (property) => { projects.database.properties.push(property); return property }
  return { pages, projects, relation, addToProjects }
}

test('fórmula lê propriedades de páginas relacionadas: prop("Rel").map(current.prop("X"))', () => {
  const { pages, addToProjects } = workspace()
  const f = (formula) => resolveValue(pages.p, addToProjects(prop(`f${Math.random()}`, 'formula', { name: 'F', formula })), pages)
  assert.deepEqual(f('prop("Tarefas").map(current.prop("Preço"))'), ['10', '30', ''])
  assert.equal(f('sum(prop("Tarefas").map(current.prop("Preço")))'), 40)
  assert.equal(f('Tarefas.filter(current.Status == "Aberta").length()'), 2)
  assert.deepEqual(f('Tarefas.map(current.Tags).flat().unique()'), ['urgente', 'casa'])
  assert.equal(f('Tarefas.first().Dobro'), 20)
  assert.equal(f('Tarefas.find(current.Feito).Nome'), 'A')
  assert.deepEqual(f('Tarefas.sort(current.Prazo).map(title(current))'), ['A', 'B', 'C'])
  assert.equal(f('id()'), 'p')
  assert.equal(f('Tarefas.first().Inexistente'), null)
  assert.match(derivedErrorFor('p', [...pages.projects.database.properties].at(-1).id, 'pt-BR'), /Propriedade “Inexistente” não existe/)
})

test('ciclos entre fórmulas e rollups têm mensagem clara com o caminho', () => {
  const { pages } = workspace()
  const a = prop('ca', 'formula', { name: 'A', formula: 'B + 1' })
  const b = prop('cb', 'formula', { name: 'B', formula: 'A + 1' })
  pages.tasks.database.properties.push(a, b)
  assert.equal(resolveValue(pages.a, a, pages), null)
  assert.equal(derivedErrorFor('a', 'ca', 'pt-BR'), 'Referência circular: A → B → A')
  assert.equal(derivedErrorFor('a', 'ca', 'en-US'), 'Circular reference: A → B → A')
  const preview = previewFormula(pages.a, a, 'Preço + 1', pages, 'pt-BR')
  assert.equal(preview.value, 11)
  assert.equal(preview.error, null)
  assert.match(previewFormula(pages.a, a, 'B', pages, 'pt-BR').error, /Referência circular/)
})

test('rollups: todas as agregações, filtro próprio, rollup de fórmula e de rollup', () => {
  const { pages, addToProjects } = workspace()
  const roll = (targetPropertyId, aggregation, extra = {}) => resolveValue(pages.p, addToProjects(prop(`r${Math.random()}`, 'rollup', { name: 'R', rollup: { relationPropertyId: 'rel', targetPropertyId, aggregation, ...extra } })), pages)
  assert.equal(roll('price', 'count'), 3)
  assert.equal(roll('price', 'countValues'), 2)
  assert.equal(roll('tags', 'countValues'), 3)
  assert.equal(roll('tags', 'countUnique'), 2)
  assert.equal(roll('price', 'empty'), 1)
  assert.equal(roll('price', 'notEmpty'), 2)
  assert.equal(roll('price', 'percentEmpty'), 1 / 3)
  assert.equal(roll('price', 'percentNotEmpty'), 2 / 3)
  assert.equal(roll('done', 'checked'), 1)
  assert.equal(roll('done', 'unchecked'), 2)
  assert.equal(roll('done', 'percentChecked'), 1 / 3)
  assert.equal(roll('price', 'sum'), 40)
  assert.equal(roll('price', 'average'), 20)
  assert.equal(roll('price', 'median'), 20)
  assert.equal(roll('price', 'min'), 10)
  assert.equal(roll('price', 'max'), 30)
  assert.equal(roll('price', 'range'), 20)
  assert.deepEqual(roll('due', 'earliest'), { start: '2026-10-01' })
  assert.deepEqual(roll('due', 'latest'), { start: '2026-10-09' })
  assert.equal(roll('due', 'dateRange'), 11)
  assert.deepEqual(roll('status', 'showOriginal'), ['Aberta', 'Feita', 'Aberta'])
  assert.deepEqual(roll('status', 'unique'), ['Aberta', 'Feita'])
  assert.deepEqual(roll('tags', 'showOriginal'), ['urgente', 'casa', 'casa'])
  // Rollup de fórmula
  assert.equal(roll('double', 'sum'), 80)
  // Filtro próprio
  assert.equal(roll('price', 'sum', { filter: [{ id: '1', propertyId: 'status', op: 'is', value: 'o1' }] }), 10)
  assert.equal(roll('price', 'count', { filter: [{ id: '1', propertyId: 'price', op: 'gt', value: 5 }, { id: '2', propertyId: 'done', op: 'checked' }], filterOperator: 'or' }), 2)
  assert.equal(roll('price', 'count', { filter: [{ id: '1', propertyId: 'tags', op: 'contains', value: 't1' }] }), 1)
  assert.equal(roll('price', 'count', { filter: [{ id: '1', propertyId: 'due', op: 'after', value: '2026-10-05' }] }), 1)
  assert.equal(roll('price', 'count', { filter: [{ id: '1', propertyId: 'title', op: 'contains', value: 'b' }] }), 1)
  // Rollup de rollup: projeto ← portfólio
  const inner = addToProjects(prop('rsum', 'rollup', { name: 'Total', rollup: { relationPropertyId: 'rel', targetPropertyId: 'price', aggregation: 'sum' } }))
  const portfolio = { id: 'port', parentId: null, title: 'Portfólio', database: { properties: [prop('pt', 'title'), prop('prel', 'relation', { relationDatabaseId: 'projects' }), prop('pr', 'rollup', { rollup: { relationPropertyId: 'prel', targetPropertyId: inner.id, aggregation: 'sum' } })], views: [view], activeViewId: 'v' } }
  pages.port = portfolio
  pages.p2 = row('p2', 'projects', 'Projeto 2', { rel: ['b'] })
  pages.x = row('x', 'port', 'X', { prel: ['p', 'p2'] })
  assert.equal(resolveValue(pages.x, portfolio.database.properties[2], pages), 70)
})

test('rollup não trunca listas grandes e ordena como texto', () => {
  const { pages, addToProjects } = workspace()
  const ids = []
  for (let index = 0; index < 1500; index++) { const id = `n${index}`; pages[id] = row(id, 'tasks', `T${index}`, { price: index }); ids.push(id) }
  pages.p.props.rel = ids
  const values = resolveValue(pages.p, addToProjects(prop('all', 'rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'price', aggregation: 'showOriginal' } })), pages)
  assert.equal(values.length, 1500)
})

test('agregações e cálculos de coluna estilo planilha', () => {
  const { pages } = workspace()
  const rows = [pages.a, pages.b, pages.c]
  const props = pages.tasks.database.properties
  const byId = (id) => props.find((property) => property.id === id)
  assert.equal(calculateColumn(rows, byId('price'), pages, 'median'), '20')
  assert.equal(calculateColumn(rows, byId('price'), pages, 'percentEmpty'), '33,3%')
  assert.equal(calculateColumn(rows, byId('price'), pages, 'range', 'en-US'), '20')
  assert.equal(calculateColumn(rows, byId('done'), pages, 'percentChecked', 'en-US'), '33.3%')
  assert.equal(calculateColumn(rows, byId('status'), pages, 'countUnique'), '2')
  assert.equal(calculateColumn(rows, byId('due'), pages, 'dateRange'), '11 dias')
  assert.equal(calculateColumn(rows, byId('due'), pages, 'earliest'), '1 de outubro de 2026')
  assert.deepEqual(calculateColumnValue(rows, byId('tags'), pages, 'countValues'), 3)
  assert.equal(calculateColumn([], byId('price'), pages, 'sum'), '—')
  assert.ok(calculationsFor(byId('done')).includes('percentChecked'))
  assert.ok(!calculationsFor(byId('status')).includes('sum'))
  assert.ok(calculationsFor(byId('double')).includes('sum'))
  assert.equal(CALCULATIONS.length, 21)
  assert.deepEqual(normalizeForAggregation(Date.UTC(2026, 0, 1, 12), prop('c', 'createdTime'), pages).start, '2026-01-01')
  assert.equal(aggregate([[1, 2], 3, null], 'sum'), 6)
  assert.equal(aggregate(['5', 'x'], 'sum'), 5)
  assert.equal(formatAggregate(0.5, 'percentNotEmpty', 'pt-BR'), '50%')
})

test('regras de páginas relacionadas aceitam E/OU e ignoram propriedades removidas', () => {
  const { pages } = workspace()
  assert.equal(matchesRelatedRules(pages.a, [{ id: '1', propertyId: 'removida', op: 'is', value: 'x' }], 'and', pages), true)
  assert.equal(matchesRelatedRules(pages.c, [{ id: '1', propertyId: 'price', op: 'isEmpty' }], 'and', pages), true)
  assert.equal(matchesRelatedRules(pages.b, [{ id: '1', propertyId: 'status', op: 'isNot', value: 'o2' }, { id: '2', propertyId: 'price', op: 'lte', value: 30 }], 'or', pages), true)
  assert.equal(matchesRelatedRules(pages.b, [{ id: '1', propertyId: 'status', op: 'isNot', value: 'o2' }, { id: '2', propertyId: 'price', op: 'lte', value: 30 }], 'and', pages), false)
})
