import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExportPackage } from '../src/export/package.ts'
import { packageToBackup } from '../src/export/importPackage.ts'
import { markdownToBlocks } from '../src/export/parseMarkdown.ts'
import { blocksToMarkdown } from '../src/export/markdown.ts'
import { validateBackup, validateMeta, cloneDocument, remapReferences } from '../src/workspace.ts'
import { applyDailyTemplate } from '../src/daily/dailyCore.ts'
import { blockOwnText } from '../src/search/extract.ts'
import { blocksToText } from '../src/components/page/util.ts'
import { queryBlockProps, queryTemplate, templateByName } from '../src/query/templates.ts'
import { queryToLinkedView } from '../src/query/convert.ts'
import { buildVirtualDb, defaultColumns } from '../src/query/virtualDb.ts'
import { runQuery } from '../src/query/engine.ts'
import { queryExport } from '../src/query/exportResult.ts'
import { withoutLockedPages } from '../src/security/pageLock.ts'
import { defaultQuery, parseQueryJson, type Query } from '../src/query/model.ts'
import { ID, NOW, fixturePages, checklists } from './fixtures/query-fixture.mjs'

// lib.ts (applyView) lê a store: ambiente mínimo de navegador, sem DOM.
const native = { async loadMeta() { return null }, async saveMeta() {}, async loadDoc() { return null }, async saveDoc() {}, async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {}, async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {} }
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k), length: 0, key: () => null } })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { applyView } = await import('../src/components/database/lib.ts')

const projectsQuery: Query = defaultQuery({ display: 'table', source: { kind: 'database', databaseIds: [ID.projects] }, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'r1', field: 'Status', op: 'is', value: 'Em andamento' }] }, sorts: [{ field: 'Prazo', direction: 'asc' }], columns: ['@title', 'Status', 'Horas'] })
const names = { locale: 'pt-BR' as const, databaseName: (id: string) => fixturePages()[id]?.title }
const queryBlock = (id: string, query: Query) => ({ id, type: 'query', props: queryBlockProps(query, names), children: [] })
const labels = { title: 'Consulta', locale: 'pt-BR', fieldName: (field: string) => field }

test('exportação Markdown: comentário np:query + resultado atual; reimportação sem perda', () => {
  const pages = fixturePages()
  const block = queryBlock('qb1', projectsQuery)
  const ctx = { href: (h: string) => h, media: (u: string) => u, json: <T,>(v: T) => v, pageLink: (pid: string) => ({ label: pages[pid]?.title ?? '', destination: `${pid}.md` }), synced: () => undefined, keepIds: new Set<string>(), queryResult: (props: Record<string, unknown>) => queryExport(props, pages, { thisPageId: ID.home, now: NOW.getTime() }) }
  const markdown = blocksToMarkdown([block], ctx)
  assert.match(markdown, /<!-- np:block \{"type":"query"/)
  assert.match(markdown, /<!-- np:query "tabela de \\"Projetos\\" onde Status = \\"Em andamento\\" ordenar Prazo colunas título, Status, Horas" -->/)
  assert.match(markdown, /\| Nome \| Status \| Horas \|/)
  assert.match(markdown, /\| \[App móvel\]\(10000000-0000-4000-8000-000000000002\.md\) \| Em andamento \| 40 \|/)
  assert.ok(markdown.indexOf('App móvel') < markdown.indexOf('Site novo'))
  const back = markdownToBlocks(markdown, { href: (h) => h, media: (u) => u, json: (v) => v })
  assert.equal(back.length, 1)
  assert.equal(back[0].type, 'query')
  assert.deepEqual(parseQueryJson(back[0].props?.query), parseQueryJson(block.props.query))
  assert.equal(back[0].props?.text, block.props.text)
  // Comentário escrito à mão vira bloco com o texto (interpretado ao abrir).
  const manual = markdownToBlocks('Antes\n\n<!-- np:query "lista de tarefas" -->\n- [Ligar](x.md)\n\nDepois', { href: (h) => h, media: (u) => u, json: (v) => v })
  assert.deepEqual(manual.map((item) => item.type), ['paragraph', 'query', 'paragraph'])
  assert.equal(manual[1].props?.text, 'lista de tarefas')
})

test('pacote completo (Markdown e HTML): resultado sem páginas protegidas e reimportação', async () => {
  // Como em src/export/run.ts: páginas protegidas e trancadas saem do retrato antes de exportar.
  const pages = withoutLockedPages(fixturePages())
  const backlinks = defaultQuery({ display: 'list', source: { kind: 'backlinks' } })
  const tasks = queryTemplate('open-tasks')
  const source = { pages, documents: Object.fromEntries(Object.keys(pages).map((pid) => [pid, pid === ID.home ? [queryBlock('qa', projectsQuery), queryBlock('qb', backlinks), queryBlock('qc', tasks)] : pid === ID.notes ? [{ id: 'c1', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'Ligar para cliente', styles: {} }], children: [] }] : []])), workspaceName: 'Teste', locale: 'pt-BR' as const }
  // Páginas protegidas já saem do retrato exportável (run.ts usa withoutLockedPages); aqui o motor também as ignora.
  const { files } = await buildExportPackage(source as never, { format: 'markdown', scope: 'workspace', includeFiles: false })
  const home = Object.entries(files).find(([path]) => path.startsWith('Início'))![1] as string
  assert.match(home, /<!-- np:query "lista de backlinks" -->/)
  assert.match(home, /- \[Notas\]\(/)
  assert.match(home, /- \[Ideias\]\(/)
  assert.ok(!home.includes('Diário secreto') && !home.includes('Filho secreto') && !home.includes('Lixo'))
  assert.match(home, /Ligar para cliente/)
  const backup = packageToBackup(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? new TextEncoder().encode(value) : value])))
  const imported = backup.documents[ID.home] as { type: string; props: Record<string, unknown> }[]
  assert.deepEqual(imported.map((block) => block.type), ['query', 'query', 'query'])
  assert.deepEqual(parseQueryJson(imported[0].props.query), parseQueryJson(queryBlock('qa', projectsQuery).props.query))
  validateBackup(backup)
  const html = await buildExportPackage(source as never, { format: 'html', scope: 'workspace', includeFiles: false })
  const homeHtml = Object.entries(html.files).find(([path]) => path.startsWith('Início'))![1] as string
  assert.match(homeHtml, /<!-- np:query /)
  assert.match(homeHtml, /<table><thead><tr><th>Nome<\/th><th>Status<\/th><th>Horas<\/th><\/tr><\/thead>/)
  assert.ok(!homeHtml.includes('Diário secreto'))
})

test('busca indexa o texto da consulta, não os resultados', () => {
  const block = queryBlock('q', projectsQuery)
  assert.equal(blockOwnText(block), block.props.text)
  assert.equal(blocksToText([block]), block.props.text)
  assert.ok(!blocksToText([block]).includes('Site novo'))
})

test('nota diária: {{consulta:tarefas_do_dia}} vira bloco de consulta fixo no dia da nota', () => {
  const ctx = { date: '2026-10-08', locale: 'pt-BR' as const, yesterdayHref: '', tomorrowHref: '', tasks: [] }
  let n = 0
  const blocks = applyDailyTemplate([{ type: 'paragraph', content: [{ type: 'text', text: '{{consulta:tarefas_do_dia}}', styles: {} }] }, { type: 'paragraph', content: [{ type: 'text', text: '{{query:overdue}}', styles: {} }] }, { type: 'paragraph', content: [{ type: 'text', text: '{{consulta:inexistente}}', styles: {} }] }], ctx, () => `id${n++}`)
  assert.deepEqual(blocks.map((block) => block.type), ['query', 'query', 'paragraph'])
  const query = parseQueryJson(blocks[0].props!.query)!
  assert.equal(query.source.kind, 'tasks')
  assert.deepEqual(query.filter.children.map((rule) => rule.kind === 'rule' && rule.value), ['2026-10-08'])
  assert.equal(templateByName('Tarefas do dia'), 'tasks-of-day')
  const result = runQuery(query, { pages: fixturePages(), locale: 'pt-BR', now: NOW, checklists: checklists() })
  assert.deepEqual(result.rows.map((row) => row.title), ['Ligar para cliente'])
})

test('"Abrir como banco": "contém" em seleção mantém o texto (não o id) e dá o mesmo resultado', () => {
  const pages = fixturePages()
  const query: Query = { ...projectsQuery, groupBy: undefined, limit: undefined, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'a', field: 'Status', op: 'contains', value: 'Concluído' }] } }
  const converted = queryToLinkedView(query, pages, { viewName: 'C', newId: (() => { let n = 0; return () => `g${n++}` })() })
  assert.equal(converted.ok, true)
  if (!converted.ok) return
  const view = converted.schema.views[0]
  assert.equal(view.filters[0].value, 'Concluído')
  const rows = Object.values(pages).filter((page) => page.parentId === ID.projects)
  const fromView = applyView(rows, { ...converted.schema, properties: pages[ID.projects].database!.properties }, view).map((row) => row.title).sort()
  const fromQuery = runQuery(query, { pages, now: Date.now() }).rows.map((row) => row.title).sort()
  assert.ok(fromQuery.length > 0, 'a consulta deve ter resultados')
  assert.deepEqual(fromView, fromQuery)
})

test('duplicar página/importar remapeia ids dentro do JSON da consulta; dado inválido é preservado', () => {
  const NEW = 'aaaaaaaa-0000-4000-8000-000000000002'
  const block = queryBlock('q', projectsQuery)
  const cloned = cloneDocument([block], { [ID.projects]: NEW }) as typeof block[]
  assert.notEqual(cloned[0].id, 'q')
  assert.deepEqual(parseQueryJson(cloned[0].props.query)!.source.databaseIds, [NEW])
  const broken = { ...block, props: { ...block.props, query: '{oops' } }
  assert.equal((remapReferences([broken], { [ID.projects]: NEW }) as typeof block[])[0].props.query, '{oops')
})

test('"Abrir como banco": visualização vinculada com filtros, árvore E/OU, ordenação, colunas', () => {
  const pages = fixturePages()
  const query: Query = { ...projectsQuery, groupBy: 'Status', limit: 5, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'a', field: 'Horas', op: 'gt', value: 1 }, { kind: 'group', id: 'g', operator: 'or', children: [{ kind: 'rule', id: 'b', field: 'Status', op: 'is', value: 'Concluído' }, { kind: 'rule', id: 'c', field: 'Prazo', op: 'gte', value: '@today' }] }] } }
  let n = 0
  const converted = queryToLinkedView(query, pages, { thisPageId: ID.home, viewName: 'Consulta', newId: () => `f${n++}` })
  assert.equal(converted.ok, true)
  if (!converted.ok) return
  const view = converted.schema.views[0]
  assert.equal(converted.schema.linkedSourceId, ID.projects)
  assert.deepEqual(view.filters.map((filter) => [filter.propertyId, filter.op, filter.value]), [['ph', 'gt', 1], ['ps', 'is', 's3'], ['pd', 'gte', '@today']])
  assert.equal(view.filterTree?.kind, 'group')
  assert.deepEqual(view.sorts, [{ propertyId: 'pd', direction: 'asc' }])
  assert.equal(view.groupBy, 'ps')
  assert.deepEqual(view.hidden.sort(), ['pd', 'pe', 'pt'])
  assert.deepEqual(converted.dropped, ['limit'])
  // O esquema vinculado passa na validação do espaço e o filtro do banco dá o mesmo resultado da consulta.
  const linkedId = 'bbbbbbbb-0000-4000-8000-000000000001'
  const meta = validateMeta({ pages: { ...pages, [linkedId]: { ...pages[ID.home], id: linkedId, parentId: ID.home, title: '', database: converted.schema } }, settings: {} })
  assert.ok(meta.pages[linkedId].database?.linkedSourceId)
  const rows = Object.values(pages).filter((page) => page.parentId === ID.projects).sort((a, b) => a.order - b.order)
  const fromView = applyView(rows, { ...converted.schema, properties: pages[ID.projects].database!.properties }, view).map((row) => row.title)
  const fromQuery = runQuery({ ...query, limit: undefined, groupBy: undefined }, { pages, now: Date.now() }).rows.map((row) => row.title)
  assert.deepEqual(fromView, fromQuery)
  assert.deepEqual(queryToLinkedView(defaultQuery({ source: { kind: 'pages' } }), pages, { viewName: 'x' }), { ok: false, reason: 'source' })
  assert.deepEqual(queryToLinkedView({ ...projectsQuery, filter: { kind: 'group', id: 'root', operator: 'and', children: [{ kind: 'rule', id: 'z', field: 'Nada', op: 'is', value: 1 }] } }, pages, { viewName: 'x' }), { ok: false, reason: 'field', detail: 'Nada' })
})

test('banco virtual: banco único editável com linhas reais; vários bancos somente leitura e projetados', () => {
  const pages = fixturePages()
  const single = runQuery(projectsQuery, { pages, now: NOW })
  const vdb = buildVirtualDb(projectsQuery, single, pages, 'b1', labels, true)
  assert.equal(vdb.editable, true)
  assert.equal(vdb.databaseId, ID.projects)
  assert.ok(vdb.rows.every((row, index) => row === single.rows[index]), 'linhas reais (edição passa pela store)')
  assert.deepEqual(vdb.visibleProps.map((prop) => prop.id), ['pn', 'ps', 'ph'])
  assert.equal(vdb.db.locked, true)
  assert.equal(vdb.db.id, ID.projects)
  const lockedPages = { ...pages, [ID.projects]: { ...pages[ID.projects], locked: true } }
  assert.equal(buildVirtualDb(projectsQuery, runQuery(projectsQuery, { pages: lockedPages, now: NOW }), lockedPages, 'b1', labels, true).editable, false)
  const multiQuery = defaultQuery({ source: { kind: 'databases', databaseIds: [ID.projects, ID.tasks] }, columns: ['@title', 'Status', '@database', '@words'] })
  const multi = runQuery(multiQuery, { pages, now: NOW })
  const mvdb = buildVirtualDb(multiQuery, multi, pages, 'b2', labels, true)
  assert.equal(mvdb.editable, false)
  const status = mvdb.schema.properties.find((prop) => prop.name === 'Status')!
  assert.deepEqual(status.options!.map((option) => option.name), ['Em andamento', 'Pausado', 'Concluído', 'A fazer'])
  const wireframes = mvdb.rows.find((row) => row.title === 'Wireframes')!
  assert.equal(status.options!.find((option) => option.id === wireframes.props![status.id])?.name, 'Em andamento')
  assert.equal(wireframes.props![mvdb.schema.properties.find((prop) => prop.name === '@database')!.id], 'Tarefas')
  assert.ok(mvdb.rows.every((row) => row.locked))
  assert.equal(buildVirtualDb(multiQuery, multi, pages, 'b2', labels, true).rows[0], mvdb.rows[0], 'projeção estável por identidade')
  assert.deepEqual(defaultColumns(defaultQuery({ source: { kind: 'tasks' } }), pages, null), ['@title', '@due', '@source'])
})
