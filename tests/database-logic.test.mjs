import COMPAT from '../shared/compatibility.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFormula, formulaDiagnostic, resolveValue } from '../src/components/database/derived.ts'
import { CSV_ROW_ID, csvCompanionHeader, parseCsv, parseCsvCompanion, resolveImportedRelationIds, stringifyCsv, exportCsv, fromCsvCell } from '../src/components/database/csv.ts'
import { calculateColumn } from '../src/components/database/calculations.ts'
import { canAssignSubitemParent, planRelationMirror, templateDefaults, nextSequence, unresolvedDependencies, matchingAutomations, dueAutomations, validActions } from '../src/components/database/engines.ts'
import { appendFilterRule, filterTreeFromIds, matchesFilterTree, moveFilterRule, nestFilterRule, removeFilterRule, setGroupOperator, ungroupFilterGroup } from '../src/components/database/filterTree.ts'
import { formatPropertyNumber, progressValue, statusGroups, formatDateTime } from '../src/components/database/formatting.ts'
import { markRichRange, replaceRichRange, richTextPlain, safeRichHref } from '../src/components/database/richText.ts'
import { groupsFor } from '../src/components/database/grouping.ts'
import { evaluateColorRule, matchingRowColor } from '../src/components/database/colorRules.ts'
import { canAddSource, projectMultiSource } from '../src/components/database/multiSource.ts'
import { dateOccurrences } from '../src/components/database/recurrence.ts'
import { decodeLocalButtonActions } from '../src/components/database/localButtonActions.ts'
import { zonedDateTimeToEpoch, epochToZonedDateTime, convertDateValueZone, occurrenceForViewer, validDateValueWallTimes } from '../src/components/database/timeZones.ts'

const prop = (id, type, extra = {}) => ({ id, name: id, type, ...extra })
const view = { id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
const row = (id, parentId, title, props = {}) => ({ id, parentId, title, props, createdAt: 1000, updatedAt: 2000, trashed: false, order: 0 })

test('texto rico preserva marcas nas edições e rejeita links executáveis', () => {
  const initial = { type: 'richText', runs: [{ text: 'Olá mundo' }] }
  const bold = markRichRange(initial, 4, 9, { bold: true })
  assert.deepEqual(bold.runs, [{ text: 'Olá ' }, { text: 'mundo', bold: true }])
  const edited = replaceRichRange(bold, 5, 7, 'eu')
  assert.equal(richTextPlain(edited), 'Olá meudo')
  assert.equal(edited.runs[1].bold, true)
  assert.equal(safeRichHref('javascript:alert(1)'), undefined)
  assert.equal(safeRichHref('https://example.com/a'), 'https://example.com/a')
})

test('agrupamento oculta por ID sem perder as linhas da fonte', () => {
  const status = prop('status', 'status', { options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
  const rows = [row('1', 'db', 'Um', { status: 'a' }), row('2', 'db', 'Dois', { status: 'b' }), row('3', 'db', 'Três')]
  const groups = groupsFor(rows, status, { ...view, hiddenGroups: ['status:b'] }, 'Sem status')
  assert.deepEqual(groups.map((group) => [group.key, group.rows.length]), [['status:__none__', 1], ['status:a', 1]])
  assert.equal(rows.length, 3)
})

test('cores condicionais aceitam apenas paleta e valores correspondentes', () => {
  const rule = { id: 'r', propertyId: 'score', operator: 'gt', value: 10, color: 'blue' }
  assert.equal(evaluateColorRule(11, rule), true)
  assert.equal(evaluateColorRule(9, rule), false)
  const schema = { properties: [prop('score', 'number')] }
  const entry = row('1', 'db', 'Item', { score: 11 })
  assert.equal(matchingRowColor(entry, schema, { ...view, colorRules: [rule] }, (target, id) => target.props[id]), 'blue')
  assert.equal(matchingRowColor(entry, schema, { ...view, colorRules: [{ ...rule, color: 'url(javascript:evil)' }] }, (target, id) => target.props[id]), undefined)
})

test('fontes locais mapeiam opções por nome/tipo sem mutar linhas originais nem criar ciclos', () => {
  const first = { id: 's1', name: 'Um', schema: { properties: [prop('title1', 'title', { name: 'Título' }), prop('status1', 'status', { name: 'Status', options: [{ id: 'a', name: 'Feito' }] })] } }
  const second = { id: 's2', name: 'Dois', schema: { properties: [prop('title2', 'title', { name: 'Título' }), prop('status2', 'status', { name: 'Status', options: [{ id: 'b', name: 'Feito' }] })] } }
  const raw = [row('r1', 's1', 'A', { status1: 'a' }), row('r2', 's2', 'B', { status2: 'b' })]
  const result = projectMultiSource([first, second], raw)
  assert.equal(result.properties.length, 2)
  assert.deepEqual(result.rows.map((item) => item.props.status1), ['a', 'a'])
  assert.equal(raw[1].props.status2, 'b')
  assert.equal(canAddSource('s1', 's2', { s1: { database: first.schema }, s2: { database: { ...second.schema, sourceDatabaseIds: ['s1'] } } }), false)
})

test('fórmula interpreta somente gramática fechada, precedência e referências', () => {
  assert.equal(evaluateFormula('2 + 3 * 4', () => null), 14)
  assert.equal(evaluateFormula('round(prop("Preço") * 1.15, 2)', (name) => name === 'Preço' ? 12.5 : null), 14.37)
  assert.equal(evaluateFormula('concat("A", "-", prop("Código"))', () => '42'), 'A-42')
  assert.equal(evaluateFormula('1 / 0', () => null), null)
  assert.throws(() => evaluateFormula('constructor("x")', () => null), /Função desconhecida/)
  // Sem acesso a globais: nomes soltos só resolvem propriedades; com o esquema conhecido viram erro.
  assert.equal(evaluateFormula('globalThis.process', () => null), null)
  assert.throws(() => evaluateFormula('globalThis.process', () => null, { resolve: () => undefined }), /Nome desconhecido: globalThis/)
  assert.throws(() => evaluateFormula('a = 1', () => null), /Use “==”/)
})

test('planeja espelho bidirecional, template e dependências sem mutar o estado', () => {
  const originRelation = prop('links', 'relation', { relationDatabaseId: 'target', relationMirrorPropertyId: 'reverse' })
  const reverseRelation = prop('reverse', 'relation', { relationDatabaseId: 'origin', relationMirrorPropertyId: 'links' })
  const status = prop('status', 'status', { options: [{ id: 'done', name: 'Concluído', group: 'complete' }] })
  const pages = {
    origin: { database: { properties: [originRelation], views: [view] } },
    target: { database: { properties: [reverseRelation, status], views: [view] } },
    source: row('source', 'origin', 'Origem', { links: ['a'] }),
    a: row('a', 'target', 'A', { reverse: ['source'], status: 'done' }),
    b: row('b', 'target', 'B', { reverse: [] }),
  }
  assert.deepEqual(planRelationMirror(pages, 'source', 'links', ['b']), [
    { rowId: 'a', propertyId: 'reverse', value: [] },
    { rowId: 'b', propertyId: 'reverse', value: ['source'] },
  ])
  assert.deepEqual(pages.a.props.reverse, ['source'])
  const schema = { properties: [prop('name', 'title'), prop('text', 'text'), prop('calc', 'formula')], templates: [{ id: 't', name: 'Padrão', title: 'Nova tarefa', props: { text: 'Olá', calc: 42 } }], defaultTemplateId: 't' }
  assert.deepEqual(templateDefaults(schema), { title: 'Nova tarefa', props: { text: 'Olá' }, icon: undefined })
  assert.equal(nextSequence([{ ...pages.a, sequence: 3 }, { ...pages.b, sequence: 7 }]), 8)
  pages.source.dependencyIds = ['a', 'b']
  assert.deepEqual(unresolvedDependencies(pages.source, pages).map((page) => page.id), ['b'])
  const automations = [{ id: 'x', enabled: true, trigger: { kind: 'propertyChange', propertyId: 'status' }, actions: [] }, { id: 'y', enabled: true, trigger: { kind: 'scheduled', every: 'daily', nextRunAt: 10 }, actions: [] }]
  assert.deepEqual(matchingAutomations({ automations }, 'status').map((item) => item.id), ['x'])
  assert.deepEqual(dueAutomations({ automations }, 10).map((item) => item.id), ['y'])
  pages.child = { ...row('child', 'origin', 'Filho'), subitemParentId: 'source' }
  assert.equal(canAssignSubitemParent('source', 'child', pages), false)
  assert.equal(canAssignSubitemParent('source', 'a', pages), false)
  assert.equal(canAssignSubitemParent('a', 'b', pages), true)
  const rich = { type: 'richText', runs: [{ text: 'inicial', bold: true }] }
  assert.deepEqual(templateDefaults({ properties: [prop('body', 'text')], templates: [{ id: 'rich', name: 'Rich', title: '', props: { body: rich } }] }, 'rich').props.body, rich)
  assert.deepEqual(validActions({ properties: [prop('amount', 'number'), prop('date', 'date')] }, [{ kind: 'setProperty', propertyId: 'amount', value: 'abc' }, { kind: 'setProperty', propertyId: 'amount', value: 3 }, { kind: 'setProperty', propertyId: 'date', value: '2026-10-06' }]).map((action) => action.propertyId), ['amount'])
})

test('grupos de filtro AND/OR preservam comportamento legado e grupos aninhados', () => {
  const tree = { kind: 'group', operator: 'or', children: [
    { kind: 'rule', filterId: 'a' },
    { kind: 'group', operator: 'and', children: [{ kind: 'rule', filterId: 'b' }, { kind: 'rule', filterId: 'c' }] },
  ] }
  assert.equal(matchesFilterTree(undefined, ['a', 'b'], (id) => id === 'a'), false)
  assert.equal(matchesFilterTree(tree, [], (id) => id === 'b' || id === 'c'), true)
  assert.equal(matchesFilterTree(tree, [], (id) => id === 'b'), false)
  // Regressão: excluir todas as regras de um grupo OR não pode esvaziar a tabela.
  const emptyOr = { kind: 'group', id: 'root', operator: 'or', children: [] }
  assert.equal(matchesFilterTree(emptyOr, [], () => false), true)
  assert.equal(matchesFilterTree(removeFilterRule(removeFilterRule({ ...emptyOr, children: [{ kind: 'rule', filterId: 'x' }, { kind: 'rule', filterId: 'y' }] }, 'x'), 'y'), [], () => false), true)
  const appended = appendFilterRule(tree, [], 'd')
  assert.equal(matchesFilterTree(appended, [], (id) => id === 'd'), true)
  assert.equal(matchesFilterTree(removeFilterRule(appended, 'd'), [], (id) => id === 'd'), false)
  const root = filterTreeFromIds(['a', 'b'])
  const nested = nestFilterRule(root, 'b', 'nested')
  const moved = moveFilterRule(nested, 'a', 'nested')
  assert.equal(matchesFilterTree(setGroupOperator(moved, 'nested', 'or'), [], (id) => id === 'a'), true)
  assert.deepEqual(ungroupFilterGroup(moved, 'nested').children.map((node) => node.filterId), ['b', 'a'])
})

test('formata moeda, porcentagem, progresso, grupos de status e data/hora', () => {
  assert.equal(formatPropertyNumber(12.5, prop('Preço', 'number', { numberFormat: 'currency', currency: 'BRL' })), 'R$ 12,50')
  assert.equal(formatPropertyNumber(0.25, prop('Percentual', 'number', { numberFormat: 'percent' })), '25%')
  assert.equal(progressValue(120), 100)
  assert.deepEqual(statusGroups([{ id: '1', group: 'todo' }, { id: '2', group: 'complete' }]).map((group) => group.options.length), [1, 0, 1])
  assert.match(formatDateTime({ start: '2026-10-06', startTime: '14:30', timeZone: 'America/Sao_Paulo' }), /14:30.*America\/Sao_Paulo/)
})

test('fórmula compara, usa lógica curta e funções locais de texto, lista e data', () => {
  assert.equal(evaluateFormula('prop("Preço") > 10 and not empty(prop("Nome"))', (name) => name === 'Preço' ? 12 : 'Livro'), true)
  assert.equal(evaluateFormula('false and unknown()', () => null), false)
  assert.equal(evaluateFormula('if(true, "sim", unknown())', () => null), 'sim')
  assert.equal(evaluateFormula('upper(trim("  olá  "))', () => null), 'OLÁ')
  assert.deepEqual(evaluateFormula('map(list("a", "b"), "upper")', () => null), ['A', 'B'])
  assert.deepEqual(evaluateFormula('filter(list("a", "b", "a"), "a")', () => null), ['a', 'a'])
  assert.deepEqual(evaluateFormula('dateAdd("2026-10-06", 7, "days")', () => null), { start: '2026-10-13' })
  assert.equal(evaluateFormula('dateBetween("2026-10-06", "2026-10-13", "days")', () => null), 7)
  assert.match(formulaDiagnostic('unknown()', () => null).error, /Função desconhecida/)
  assert.deepEqual(evaluateFormula('map(list("1", "2", "3"), current * 2)', () => null), ['2', '4', '6'])
  assert.deepEqual(evaluateFormula('filter(list("1", "2", "3"), current > 1)', () => null), ['2', '3'])
  assert.deepEqual(evaluateFormula('filter(list("2", "10"), current > 2)', () => null), ['10'])
  assert.equal(evaluateFormula('find(list("1", "2", "3"), current > 1)', () => null), '2')
  assert.equal(evaluateFormula('findIndex(list("a", "b"), current == "b")', () => null), 1)
  assert.equal(evaluateFormula('some(list("a", "b"), index == 1)', () => null), true)
  assert.equal(evaluateFormula('every(list("a", "b"), length(current) == 1)', () => null), true)
  assert.equal(evaluateFormula('let(x, 5, x * 2)', () => null), 10)
  assert.equal(evaluateFormula('lets(x, 2, y, x + 3, x * y)', () => null), 10)
  assert.throws(() => evaluateFormula('current', () => null), /fora do escopo/)
  assert.match(formulaDiagnostic('unknown()', () => null, 'en-US').error, /Unknown function/)
  assert.match(formulaDiagnostic('let(x, 1)', () => null, 'en-US').error, /Invalid let arguments/)
})

test('fórmula limita trabalho total de callbacks aninhados e traduz diagnóstico', () => {
  const values = Array.from({ length: 1000 }, (_, index) => String(index))
  const expression = 'map(prop("many"), length(map(prop("many"), current)))'
  assert.match(formulaDiagnostic(expression, () => values).error, /1\.000\.000 passos/)
  assert.match(formulaDiagnostic(expression, () => values, 'en-US').error, /1,000,000-step limit/)
  // Sem truncamento nem limite artificial de tamanho de lista.
  assert.equal(evaluateFormula('length(map(prop("many"), current))', () => [...values, 'extra']), 1001)
})

test('fórmula cíclica encerra e rollup ignora páginas excluídas ou fora do banco', () => {
  const price = prop('Preço', 'number')
  const amount = prop('Total', 'formula', { formula: 'prop("Preço") * 2' })
  const cycle = prop('Ciclo', 'formula', { formula: 'prop("Ciclo") + 1' })
  const relation = prop('Itens', 'relation', { relationDatabaseId: 'items' })
  const rollup = prop('Soma', 'rollup', { rollup: { relationPropertyId: 'Itens', targetPropertyId: 'Preço', aggregation: 'sum' } })
  const pages = {
    items: { database: { properties: [price, amount, cycle], views: [view], activeViewId: 'v' } },
    orders: { database: { properties: [relation, rollup], views: [view], activeViewId: 'v' } },
    a: row('a', 'items', 'Produto A', { Preço: 10 }),
    b: { ...row('b', 'items', 'Produto B', { Preço: 5 }), trashed: true },
    other: row('other', 'orders', 'Outro', { Preço: 99 }),
    order: row('order', 'orders', 'Pedido', { Itens: ['a', 'b', 'other', 'missing'] }),
  }
  assert.equal(resolveValue(pages.a, amount, pages), 20)
  assert.equal(resolveValue(pages.a, cycle, pages), null)
  assert.deepEqual(resolveValue(pages.order, relation, pages), ['a'])
  assert.equal(resolveValue(pages.order, rollup, pages), 10)
  pages.items.trashed = true
  assert.deepEqual(resolveValue(pages.order, relation, pages), [])
  assert.equal(resolveValue(pages.order, rollup, pages), null)
  pages.items.trashed = false
  assert.equal(resolveValue(pages.a, prop('Criado', 'createdTime'), pages), 1000)
  assert.equal(calculateColumn([pages.a, pages.b], price, pages, 'average'), '7,5')
  assert.equal(calculateColumn([pages.a, pages.b], price, pages, 'countValues'), '2')
})

test('CSV preserva aspas, linhas, pt-BR e neutraliza fórmulas em planilhas', () => {
  const table = [['Nome', 'Descrição'], ['A', 'linha 1\nlinha 2, "texto"'], ['B', '=1+1']]
  const csv = stringifyCsv(table)
  assert.deepEqual(parseCsv(csv), [['Nome', 'Descrição'], ['A', 'linha 1\nlinha 2, "texto"'], ['B', "'=1+1"]])
  assert.deepEqual(parseCsv('Nome;Valor\r\nTeste;12,5\r\n'), [['Nome', 'Valor'], ['Teste', '12,5']])
  assert.deepEqual(parseCsv('"Nome, detalhe";Status\r\n"linha\ncom quebra";Ativo\r\n'), [['Nome, detalhe', 'Status'], ['linha\ncom quebra', 'Ativo']])
  assert.equal(fromCsvCell("'=1+1", prop('texto', 'text')), '=1+1')
  assert.equal(fromCsvCell('12,5', prop('n', 'number')), 12.5)
  assert.equal(fromCsvCell('2026-99-99', prop('data', 'date')), null)
  assert.deepEqual(fromCsvCell('2026-10-06 → 2026-10-08', prop('data', 'date')), { start: '2026-10-06', end: '2026-10-08' })
  const schema = { properties: [prop('Nome', 'title'), prop('Preço', 'number')], views: [view], activeViewId: 'v' }
  const product = row('a', 'db', '=Produto', { Preço: 12.5 })
  assert.deepEqual(parseCsv(exportCsv(schema, [product], { a: product, db: { database: schema } }))[1], ["'=Produto", '12.5', 'a'])
  const attachment = { id: 'f', name: 'nota.txt', mimeType: 'text/plain', data: 'data:text/plain;base64,T2s=', size: 2 }
  const rich = { type: 'richText', runs: [{ text: 'Olá', bold: true }, { text: ' link', href: 'https://example.com/' }] }
  const fullSchema = { properties: [prop('name', 'title', { name: 'Nome' }), prop('body', 'text', { name: 'Corpo' }), prop('files', 'files', { name: 'Arquivos' }), prop('rel', 'relation', { name: 'Ligação', relationDatabaseId: 'targetDb' }), prop('date', 'date', { name: 'Data' })], views: [view], activeViewId: 'v' }
  const target = row('target', 'targetDb', 'Relacionado')
  const original = row('old', 'db', 'Origem', { body: rich, files: [attachment], rel: ['target'], date: { start: '2026-10-06', startTime: '13:30', timeZone: 'UTC' } })
  const parsed = parseCsv(exportCsv(fullSchema, [original], { old: original, target, db: { database: fullSchema }, targetDb: { database: { properties: [] } } }))
  const index = (header) => parsed[0].indexOf(header)
  assert.equal(parsed[1][index(CSV_ROW_ID)], 'old')
  assert.deepEqual(parseCsvCompanion('files', parsed[1][index(csvCompanionHeader('files', 'files'))]), [attachment])
  assert.deepEqual(parseCsvCompanion('rich', parsed[1][index(csvCompanionHeader('rich', 'body'))]).runs.map((run) => run.text), ['Olá', ' link'])
  assert.deepEqual(parseCsvCompanion('date', parsed[1][index(csvCompanionHeader('date', 'date'))]).startTime, '13:30')
  assert.deepEqual(parseCsvCompanion('relation', parsed[1][index(csvCompanionHeader('relation', 'rel'))]), ['target'])
  assert.deepEqual(resolveImportedRelationIds(['old', 'target', 'missing'], new Map([['old', 'new']]), { new: row('new', 'targetDb', 'Novo'), target }, 'targetDb'), ['new', 'target'])
  assert.equal(parseCsvCompanion('files', '[{"data":"https://evil.example/file","name":"bad"}]'), null)
  assert.equal(parseCsvCompanion('date', '{"start":"2026-10-06","end":"2026-99-99"}'), null)
  assert.equal(parseCsvCompanion('date', '{"start":"2026-10-06","startTime":"25:30"}'), null)
  assert.equal(parseCsvCompanion('date', '{"start":"2026-10-06","timeZone":42}'), null)
  assert.deepEqual(parseCsvCompanion('date', '{"start":"2026-10-06","startTime":"13:30","timeZone":"UTC","repeat":"daily","extra":"discard"}'), { start: '2026-10-06', startTime: '13:30', timeZone: 'UTC', repeat: 'daily' })
  const largeFile = { ...attachment, size: 6_000_000 }
  assert.deepEqual(parseCsvCompanion('files', JSON.stringify([largeFile])), [largeFile])
  const reservedSchema = { properties: [prop('name', 'title', { name: COMPAT.record031 }), prop('body', 'text', { name: csvCompanionHeader('rich', 'body') })], views: [view], activeViewId: 'v' }
  const reservedRow = row('row-id', 'db', 'Visible title', { body: rich })
  const reserved = parseCsv(exportCsv(reservedSchema, [reservedRow], { 'row-id': reservedRow, db: { database: reservedSchema } }))
  assert.equal(reserved[0].filter((header) => header === CSV_ROW_ID).length, 2)
  assert.deepEqual(reserved[1].slice(0, 3), ['Visible title', 'Olá link', 'row-id'])
  assert.deepEqual(parseCsvCompanion('rich', reserved[1].at(-1)).runs.map((run) => run.text), ['Olá', ' link'])
})

test('recorrência virtual diária, semanal e mensal mantém identidade e não cria páginas', () => {
  const daily = dateOccurrences('a', { start: '2026-01-01', repeat: 'daily' }, '2026-10-06', '2026-10-08')
  assert.deepEqual(daily.map((occurrence) => [occurrence.id, occurrence.start]), [['a@2026-10-06', '2026-10-06'], ['a@2026-10-07', '2026-10-07'], ['a@2026-10-08', '2026-10-08']])
  assert.deepEqual(dateOccurrences('b', { start: '2026-10-05', end: '2026-10-06', repeat: 'weekly' }, '2026-10-11', '2026-10-20').map((occurrence) => [occurrence.start, occurrence.end]), [['2026-10-12', '2026-10-13'], ['2026-10-19', '2026-10-20']])
  assert.deepEqual(dateOccurrences('c', { start: '2026-01-31', repeat: 'monthly' }, '2026-02-01', '2026-04-30').map((occurrence) => occurrence.start), ['2026-02-28', '2026-03-31', '2026-04-30'])
  assert.deepEqual(dateOccurrences('d', { start: '2024-02-29', repeat: 'yearly' }, '2025-01-01', '2028-12-31').map((occurrence) => occurrence.start), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  assert.equal(dateOccurrences('e', { start: '2026-01-01', repeat: 'daily' }, '2026-01-01', '2028-01-01', 20).length, 20)
  assert.deepEqual(dateOccurrences('f', { start: '2026-10-06' }, '2026-10-07', '2026-10-08'), [])
  assert.deepEqual(dateOccurrences('bad', { start: '2026-02-30', repeat: 'daily' }, '2026-03-01', '2026-03-05'), [])
})

test('CSV percorre esquema de 500 propriedades sem truncar colunas ou valores', () => {
  const properties = [prop('title', 'title'), ...Array.from({ length: 499 }, (_, index) => prop(`p${index}`, 'text'))]
  const schema = { properties, views: [view], activeViewId: 'v' }
  const rows = Array.from({ length: 20 }, (_, index) => row(`r${index}`, 'db', `Linha ${index}`, Object.fromEntries(properties.slice(1).map((property) => [property.id, `${property.id}:${index}`]))))
  const parsed = parseCsv(exportCsv(schema, rows, Object.fromEntries(rows.map((item) => [item.id, item]))))
  assert.equal(parsed.length, 21)
  assert.equal(parsed[0].length, 1000)
  assert.equal(parsed[20][499], 'p498:19')
  assert.equal(parsed[20][500], 'r19')
})

test('botão de página aceita apenas sequência local limitada e valores primitivos', () => {
  assert.deepEqual(decodeLocalButtonActions(JSON.stringify([{ kind: 'openPage', targetPageId: 'p' }, { kind: 'setProperty', rowId: 'r', propertyId: 'name', value: 'feito' }])), [{ kind: 'openPage', targetPageId: 'p' }, { kind: 'setProperty', rowId: 'r', propertyId: 'name', value: 'feito' }])
  assert.throws(() => decodeLocalButtonActions('{'), /inválida/)
  assert.throws(() => decodeLocalButtonActions(JSON.stringify([{ kind: 'webhook', url: 'https://example.com' }])), /inválida/)
  assert.throws(() => decodeLocalButtonActions(JSON.stringify(Array.from({ length: 17 }, () => ({ kind: 'openPage', targetPageId: 'p' })))), /16/)
  assert.throws(() => decodeLocalButtonActions(JSON.stringify([{ kind: 'setProperty', rowId: 'r', propertyId: 'p', value: { script: 'evil' } }])), /inválida/)
})

test('fuso IANA conserva instantes e rejeita hora inexistente na transição DST', () => {
  const origin = { start: '2026-10-06', startTime: '23:30', end: '2026-10-07', endTime: '00:30', timeZone: 'UTC' }
  const tokyo = convertDateValueZone(origin, 'UTC', 'Asia/Tokyo')
  assert.deepEqual(tokyo, { ...origin, start: '2026-10-07', startTime: '08:30', end: '2026-10-07', endTime: '09:30', timeZone: 'Asia/Tokyo' })
  assert.deepEqual(convertDateValueZone(tokyo, 'Asia/Tokyo', 'UTC'), origin)
  assert.deepEqual(occurrenceForViewer({ id: 'r@2026-10-06', index: 0, start: '2026-10-06', end: '2026-10-07', recurring: false }, origin, 'Asia/Tokyo'), { id: 'r@2026-10-06', index: 0, start: '2026-10-07', end: '2026-10-07', startTime: '08:30', endTime: '09:30', recurring: false })
  assert.equal(zonedDateTimeToEpoch('2026-03-08', '02:30', 'America/New_York'), null)
  assert.deepEqual(epochToZonedDateTime(Date.parse('2026-10-06T17:30:00Z'), 'America/Sao_Paulo'), { date: '2026-10-06', time: '14:30' })
  assert.equal(convertDateValueZone(origin, 'UTC', 'Mars/Olympus'), null)
  assert.equal(validDateValueWallTimes({ start: '2026-03-08', startTime: '02:30', timeZone: 'America/New_York' }, 'UTC'), false)
  assert.equal(validDateValueWallTimes({ start: '2026-03-08', startTime: '03:30', timeZone: 'America/New_York' }, 'UTC'), true)
})
