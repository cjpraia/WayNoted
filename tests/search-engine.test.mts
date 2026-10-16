import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { appendFileSync } from 'node:fs'
import { normalizeText, baseForms, withinOneEdit, tokenize } from '../src/search/normalize.ts'
import { SearchEngine, parseQuery, makeSnippet, TIER, TRASH_PENALTY, pageTextKey } from '../src/search/engine.ts'
import { extractSegments, propertyAttachments } from '../src/search/extract.ts'
import { locationLabel, contextPath } from '../src/search/present.ts'
import { searchWorkspace, searchPages, defaultSearchFilters } from '../src/components/modals/search.mts'
import { blocksToText } from '../src/components/page/util.ts'
import type { Page } from '../src/types.ts'

const DAY = 86400000, NOW = 1_800_000_000_000
const page = (id: string, patch: Partial<Page> = {}): Page => ({ id, parentId: null, title: id, text: '', favorite: false, trashed: false, createdAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY, icon: null, cover: null, coverPosition: 50, trashedAt: null, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, ...patch })
const t = (pt: string, _en: string, vars: Record<string, string | number> = {}) => pt.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
const ids = (pages: Record<string, Page>, query: string, filters = defaultSearchFilters, context = {}) => searchWorkspace(pages, query, filters, { now: NOW, ...context }).map(hit => hit.page.id)
const report = (line: string) => { console.log(line); if (process.env.SEARCH_BENCH_OUT) appendFileSync(process.env.SEARCH_BENCH_OUT, line + '\n') }
const pt = (text: string) => [{ type: 'text', text, styles: {} }]

// ---------- normalização ----------
test('normalizeText ignora acentos, caixa e ligaduras', () => {
  assert.equal(normalizeText('Ação CORAÇÃO Straße ﬁm'), 'acao coracao strasse fim')
  assert.deepEqual(tokenize('Olá, mundo! 2026-10'), ['ola', 'mundo', '2026', '10'])
})
test('baseForms cobre plural simples pt/en', () => {
  const meets = (a: string, b: string) => baseForms(a).some(form => baseForms(b).includes(form))
  for (const [plural, singular] of [['acoes', 'acao'], ['animais', 'animal'], ['papeis', 'papel'], ['flores', 'flor'], ['itens', 'item'], ['luzes', 'luz'], ['cities', 'city'], ['boxes', 'box'], ['fails', 'fail'], ['projetos', 'projeto'], ['azuis', 'azul']]) assert.ok(meets(plural, singular), `${plural}~${singular}`)
  assert.ok(!meets('class', 'clas'))
})
test('withinOneEdit aceita uma inserção, remoção, troca ou transposição', () => {
  for (const [a, b] of [['reuniao', 'reunao'], ['reuniao', 'reuniaao'], ['reuniao', 'reuxiao'], ['reuniao', 'ruenia o'.replace(' ', '')], ['contrato', 'cnotrato']]) assert.ok(withinOneEdit(a, b), `${a}/${b}`)
  assert.ok(!withinOneEdit('contrato', 'cnotarto'))
  assert.ok(!withinOneEdit('abc', 'abcde'))
})
test('parseQuery separa frases, exclusões e termos', () => {
  const parsed = parseQuery('"Plano de Ação" -rascunho -"versão antiga" café')
  assert.deepEqual(parsed.phrases, ['plano de acao'])
  assert.deepEqual(parsed.excludeTerms, ['rascunho'])
  assert.deepEqual(parsed.excludePhrases, ['versao antiga'])
  assert.deepEqual(parsed.terms, ['cafe'])
  assert.equal(parsed.flat, 'plano de acao cafe')
  assert.deepEqual(parseQuery('a b', 'exact').phrases, ['a b'])
})

// ---------- tolerância ----------
test('busca tolera acentos, prefixos, erros leves e plural', () => {
  const pages = { a: page('a', { title: 'Plano de Ação' }), b: page('b', { text: 'As reuniões semanais foram canceladas' }), c: page('c', { title: 'Contrato de locação' }), d: page('d', { text: 'Gato' }) }
  assert.deepEqual(ids(pages, 'acao'), ['a'])
  assert.deepEqual(ids(pages, 'AÇÃO'), ['a'])
  assert.deepEqual(ids(pages, 'reuniao'), ['b'], 'plural pt')
  assert.deepEqual(ids(pages, 'semana'), ['b'], 'prefixo')
  assert.deepEqual(ids(pages, 'contarto'), ['c'], 'transposição em termo ≥ 5')
  assert.deepEqual(ids(pages, 'contrat'), ['c'])
  assert.deepEqual(ids(pages, 'gata'), [], 'termos curtos não aceitam erro')
  assert.deepEqual(ids(pages, 'locaçoes'), ['c'], 'plural + acento')
})
test('frases entre aspas exigem a sequência e -termo exclui', () => {
  const pages = { a: page('a', { text: 'Plano de ação aprovado' }), b: page('b', { text: 'Ação do plano aprovado' }), c: page('c', { text: 'Plano de ação rascunho' }) }
  assert.deepEqual(ids(pages, '"plano de acao"').sort(), ['a', 'c'])
  assert.deepEqual(ids(pages, '"plano de acao" -rascunho'), ['a'])
  assert.deepEqual(ids(pages, 'plano -"de acao"'), ['b'])
  assert.deepEqual(ids(pages, 'aprovado rascunho', { ...defaultSearchFilters, match: 'any' }).sort(), ['a', 'b', 'c'])
  assert.deepEqual(ids(pages, 'aprovado rascunho'), [])
})
test('exclusão não usa tolerância (não remove páginas por semelhança)', () => {
  const pages = { a: page('a', { text: 'contrato final' }), b: page('b', { text: 'contrato contratos' }) }
  assert.deepEqual(ids(pages, 'contrato -final'), ['b'])
})

// ---------- ranking ----------
test('ranking: título exato > início > contém > propriedades > corpo', () => {
  const properties = [{ id: 'tag', name: 'Tag', type: 'text' as const }]
  const pages: Record<string, Page> = {
    body: page('body', { text: 'falamos sobre orçamento', updatedAt: NOW }),
    db: page('db', { title: 'Tarefas', database: { properties: [{ id: 'title', name: 'Nome', type: 'title' }, ...properties], views: [], activeViewId: '' } }),
    prop: page('prop', { parentId: 'db', title: 'Linha', props: { tag: 'orçamento' } }),
    contains: page('contains', { title: 'Revisão do orçamento' }),
    prefix: page('prefix', { title: 'Orçamento 2027' }),
    exact: page('exact', { title: 'Orçamento' }),
  }
  assert.deepEqual(ids(pages, 'orcamento'), ['exact', 'prefix', 'contains', 'prop', 'body'])
  const tiers = searchWorkspace(pages, 'orcamento', defaultSearchFilters, { now: NOW }).map(hit => hit.tier)
  assert.deepEqual(tiers, ['titleExact', 'titlePrefix', 'titleContains', 'properties', 'body'])
})
test('ranking: recência e visitas desempatam dentro da mesma faixa sem cruzar faixas', () => {
  const pages = { old: page('old', { title: 'Notas antigas', updatedAt: NOW - 400 * DAY }), fresh: page('fresh', { title: 'Notas novas', updatedAt: NOW - DAY }), visited: page('visited', { title: 'Notas visitadas', updatedAt: NOW - 400 * DAY }), body: page('body', { text: 'notas', updatedAt: NOW }) }
  assert.deepEqual(ids(pages, 'notas'), ['fresh', 'old', 'visited', 'body'])
  const ranked = ids(pages, 'notas', defaultSearchFilters, { recent: ['visited'], visits: { visited: 20 } })
  assert.equal(ranked[0], 'visited')
  assert.equal(ranked.at(-1), 'body', 'corpo recente continua abaixo de títulos')
  assert.ok(ranked.indexOf('fresh') < ranked.indexOf('old'))
})
test('ranking: casamento exato vence erro de digitação na mesma faixa', () => {
  const pages = { typo: page('typo', { title: 'Projeto contarto' }), exact: page('exact', { title: 'Projeto contrato' }) }
  const hits = searchWorkspace(pages, 'contrato', defaultSearchFilters, { now: NOW })
  assert.deepEqual(hits.map(hit => hit.page.id), ['exact', 'typo'])
  assert.ok(hits[0].score - hits[1].score >= 25)
})
test('lixeira: excluída por padrão, incluída com penalidade e sempre depois das vivas', () => {
  const pages = { gone: page('gone', { title: 'Orçamento', trashed: true }), child: page('child', { parentId: 'gone', title: 'Orçamento filho' }), live: page('live', { text: 'orçamento no corpo' }) }
  assert.deepEqual(ids(pages, 'orcamento'), ['live'])
  const hits = searchWorkspace(pages, 'orcamento', { ...defaultSearchFilters, includeTrash: true }, { now: NOW })
  assert.deepEqual(hits.map(hit => hit.page.id), ['live', 'gone', 'child'])
  assert.ok(hits[1].trashed && hits[1].score < TIER.body - TRASH_PENALTY + TIER.titleExact)
})
test('filtros existentes continuam valendo (escopo, tipo, conteúdo)', () => {
  const pages = { root: page('root', { title: 'Raiz' }), inside: page('inside', { parentId: 'root', text: 'cafe' }), outside: page('outside', { text: 'cafe', comments: [{ id: 'c1', body: 'cafe forte', author: 'Ana', createdAt: 1, updatedAt: 1, resolved: false }] }) }
  assert.deepEqual(ids(pages, 'cafe', { ...defaultSearchFilters, scope: 'root' }), ['inside'])
  assert.deepEqual(ids(pages, 'forte', { ...defaultSearchFilters, content: 'comments' }), ['outside'])
  assert.deepEqual(ids(pages, 'forte', { ...defaultSearchFilters, content: 'body' }), [])
  assert.deepEqual(searchPages(pages, 'cafe', defaultSearchFilters, NOW).length, 2)
})

// ---------- cobertura ----------
const richBlocks = [
  { id: 't1', type: 'toggleListItem', content: pt('Detalhes'), children: [{ id: 't1a', type: 'paragraph', content: pt('Senha do roteador fica escondida') }] },
  { id: 'h1', type: 'heading', props: { level: 2, isToggleable: true }, content: pt('Anexos'), children: [{ id: 'h1a', type: 'paragraph', content: pt('Texto sob título recolhível') }] },
  { id: 'cl', type: 'columnList', children: [{ id: 'col1', type: 'column', children: [{ id: 'c1p', type: 'paragraph', content: pt('Coluna esquerda girassol') }] }] },
  { id: 'co', type: 'callout', content: pt('Atenção ao prazo'), children: [{ id: 'cop', type: 'paragraph', content: pt('Dentro do destaque') }] },
  { id: 'tb', type: 'table', content: { type: 'tableContent', rows: [{ cells: [pt('Cliente'), pt('Valor')] }, { cells: [pt('Padaria Estrela'), pt('120')] }] } },
  { id: 'img', type: 'image', props: { url: 'data:image/png;base64,AAAA', name: 'fachada.png', caption: 'Foto da fachada nova' } },
  { id: 'pdf', type: 'pdfPreview', props: { data: 'data:application/pdf;base64,JVBERi0=', name: 'contrato.pdf' } },
  { id: 'att', type: 'localAttachment', props: { data: 'data:text/plain;base64,AA==', name: 'planilha-custos.xlsx' } },
  { id: 'sy', type: 'syncedBlock', props: { syncedId: 'S1' } },
]
const synced = { S1: { id: 'S1', sourcePageId: 'src', updatedAt: 1, blocks: [{ id: 'inner', type: 'paragraph', content: pt('Conteúdo sincronizado compartilhado') }] } }

test('extractSegments cobre blocos aninhados, tabelas, legendas, anexos e sincronizados', () => {
  const { segments, attachments } = extractSegments(richBlocks, synced, () => 'Origem')
  const find = (word: string) => segments.find(segment => normalizeText(segment.text).includes(word))
  assert.equal(find('roteador')?.blockId, 't1a')
  assert.equal(contextPath(find('roteador')?.path, t), 'Toggle › Detalhes')
  assert.equal(contextPath(find('recolhivel')?.path, t), 'Título recolhível › Anexos')
  assert.equal(contextPath(find('girassol')?.path, t), 'Coluna')
  assert.equal(contextPath(find('dentro do destaque')?.path, t), 'Destaque › Atenção ao prazo')
  assert.equal(find('padaria')?.blockId, 'tb')
  assert.equal(find('fachada nova')?.kind, 'caption')
  assert.equal(find('planilha')?.kind, 'file')
  const shared = find('sincronizado')!
  assert.equal(shared.blockId, 'sy', 'trecho sincronizado aponta para o bloco hospedeiro')
  assert.equal(contextPath(shared.path, t), 'Bloco sincronizado › Origem')
  assert.deepEqual(attachments.map(item => `${item.kind}:${item.name}:${item.blockId}`), ['image:fachada.png:img', 'pdf:contrato.pdf:pdf', 'file:planilha-custos.xlsx:att'])
})
test('sincronizados recursivos não entram em laço', () => {
  const loop = { L: { id: 'L', sourcePageId: 'x', updatedAt: 1, blocks: [{ id: 'l1', type: 'syncedBlock', props: { syncedId: 'L' } }, { id: 'l2', type: 'paragraph', content: 'eco' }] } }
  assert.equal(extractSegments([{ id: 'h', type: 'syncedBlock', props: { syncedId: 'L' } }], loop).segments.length, 1)
})
test('anexos de propriedades de arquivo entram no índice', () => {
  assert.deepEqual(propertyAttachments({ f: [{ id: '1', name: 'nota.pdf', mimeType: 'application/pdf', data: 'data:application/pdf;base64,AA', size: 2 }], n: 3 }).map(item => item.kind), ['pdf'])
})
test('page.text (renderer) e índice nativo incluem legendas e nomes de arquivos, iguais entre si', () => {
  const { indexBlocks } = createRequire(import.meta.url)('../electron/content-index.cjs')
  const text = blocksToText(richBlocks)
  assert.equal(indexBlocks(richBlocks).bodyText, text)
  for (const word of ['Foto da fachada nova', 'contrato.pdf', 'planilha-custos.xlsx', 'Padaria Estrela', 'roteador']) assert.ok(text.includes(word), word)
})
test('todas as propriedades tipadas são pesquisáveis', () => {
  const properties = [
    { id: 'title', name: 'Nome', type: 'title' as const },
    { id: 'st', name: 'Status', type: 'status' as const, options: [{ id: 'o1', name: 'Em andamento', color: 'blue' as const }] },
    { id: 'ms', name: 'Tags', type: 'multiSelect' as const, options: [{ id: 'x', name: 'Urgente', color: 'red' as const }] },
    { id: 'dt', name: 'Prazo', type: 'date' as const },
    { id: 'ck', name: 'Revisado', type: 'checkbox' as const },
    { id: 'em', name: 'Email', type: 'email' as const },
    { id: 'fl', name: 'Arquivos', type: 'files' as const },
    { id: 'pl', name: 'Local', type: 'place' as const },
    { id: 'ct', name: 'Criado', type: 'createdTime' as const },
  ]
  const pages = { db: page('db', { database: { properties, views: [], activeViewId: '' } }), r: page('r', { parentId: 'db', title: 'Linha', createdAt: Date.UTC(2026, 2, 4), props: { st: 'o1', ms: ['x'], dt: { start: '2026-11-20' }, ck: true, em: 'ana@exemplo.com', fl: [{ id: 'f', name: 'orcamento-final.pdf', mimeType: 'application/pdf', data: 'data:application/pdf;base64,AA', size: 1 }], pl: { name: 'Lisboa', lat: 1, lng: 2 } } }) }
  for (const query of ['andamento', 'urgente', '2026-11-20', 'revisado', 'ana@exemplo.com', 'orcamento final', 'lisboa', '2026-03-04']) assert.deepEqual(ids(pages, query, { ...defaultSearchFilters, content: 'properties' }), ['r'], query)
  assert.deepEqual(ids(pages, 'base64'), [], 'payload de arquivo não é indexado')
})

// ---------- trechos rico (blockId, PDF) ----------
test('trechos ricos dão blockId, local e destaque; PDF mostra página', () => {
  const engine = new SearchEngine()
  const p = page('p', { title: 'Documentos', text: blocksToText(richBlocks) })
  const pages = { p }
  engine.sync(pages)
  const { segments } = extractSegments(richBlocks, synced, () => 'Origem')
  engine.setRich('p', { key: pageTextKey(p), segments: [...segments, { text: 'Cláusula 7: multa rescisória de 20%', kind: 'pdf', file: 'contrato.pdf', pdfPage: 3, blockId: 'pdf' }] })
  const hit = engine.locate(engine.search('roteador', { now: NOW })[0], 'roteador')
  assert.equal(hit.segment?.blockId, 't1a')
  assert.equal(locationLabel(hit.segment, t), 'em Toggle › Detalhes')
  assert.equal(hit.snippet!.text.slice(...hit.snippet!.ranges[0]), 'roteador')
  const pdf = engine.locate(engine.search('rescisoria', { now: NOW })[0], 'rescisoria')
  assert.equal(locationLabel(pdf.segment, t), 'no PDF contrato.pdf, pág. 3')
  assert.equal(pdf.segment?.blockId, 'pdf')
  assert.equal(pdf.snippet!.text.slice(...pdf.snippet!.ranges[0]), 'rescisória')
  // Texto mudou: trechos ricos deixam de valer e o corpo cai para page.text (sem perder o resultado).
  const edited = { ...p, text: p.text + '\nnovo parágrafo' }
  engine.sync({ p: edited })
  assert.equal(engine.search('rescisoria', { now: NOW }).length, 0)
  assert.equal(engine.search('roteador', { now: NOW }).length, 1)
})
test('makeSnippet recorta em volta do termo e preserva acentos do original', () => {
  const text = 'x '.repeat(80) + 'A reunião de planejamento acontece amanhã ' + 'y '.repeat(80)
  const snippet = makeSnippet(text, new Set(['reuniao']))
  assert.ok(snippet.text.startsWith('…') && snippet.text.endsWith('…'))
  assert.equal(snippet.text.slice(...snippet.ranges[0]), 'reunião')
  assert.ok(snippet.text.length < 200)
})
test('índice incremental: só a página alterada é reindexada', () => {
  const engine = new SearchEngine()
  const pages: Record<string, Page> = { a: page('a', { text: 'alfa' }), b: page('b', { text: 'beta' }) }
  engine.sync(pages)
  const next = { ...pages, b: { ...pages.b, text: 'gama' } }
  engine.sync(next)
  assert.equal(engine.search('beta').length, 0)
  assert.equal(engine.search('gama').length, 1)
  assert.equal(engine.search('alfa').length, 1)
  const { b: _removed, ...rest } = next
  engine.sync(rest)
  assert.equal(engine.search('gama').length, 0)
  assert.equal(engine.vocabularySize, 2, 'restam só "a" e "alfa"')
})

// ---------- desempenho ----------
test('consulta < 50 ms com 10.000 páginas', () => {
  // Hosted CI shares CPU; retain local latency budgets and correctness checks.
  const timingScale = process.env.CI ? 5 : 1
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const syllables = ['ma', 'ri', 'to', 'ca', 'pe', 'lo', 'su', 'ne', 'vi', 'da', 'ção', 'res', 'tan', 'gor', 'bel']
  const vocab = Array.from({ length: 6000 }, () => Array.from({ length: 2 + Math.floor(rand() * 3) }, () => syllables[Math.floor(rand() * syllables.length)]).join(''))
  const words = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(rand() * vocab.length)]).join(' ')
  const pages: Record<string, Page> = {}
  for (let i = 0; i < 10000; i++) pages[`p${i}`] = page(`p${i}`, { title: words(3), text: words(120), updatedAt: NOW - Math.floor(rand() * 400) * DAY })
  const buildStart = performance.now()
  searchWorkspace(pages, 'warmup', defaultSearchFilters, { now: NOW })
  const build = performance.now() - buildStart
  const queries = [vocab[3], vocab[10].slice(0, 3), `${vocab[20]} ${vocab[21]}`, `"${vocab[5]} ${vocab[6]}"`, vocab[30] + 'x', `${vocab[40]} -${vocab[41]}`, 'mariton', 'cação']
  const times: number[] = []
  for (const query of queries) for (let round = 0; round < 3; round++) {
    const start = performance.now()
    const hits = searchWorkspace(pages, query, defaultSearchFilters, { now: NOW })
    hits.slice(0, 20)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const worst = times.at(-1)!, median = times[Math.floor(times.length / 2)]
  report(`busca 10k: build ${build.toFixed(0)} ms, mediana ${median.toFixed(1)} ms, pior ${worst.toFixed(1)} ms`)
  assert.ok(median < 50 * timingScale, `mediana ${median}`)
  assert.ok(worst < 100 * timingScale, `pior ${worst}`)
  // Edição incremental de uma página não reconstrói o índice.
  const edited = { ...pages, p5: { ...pages.p5, text: 'texto completamente novo zebrafish' } }
  const start = performance.now()
  const hits = searchWorkspace(edited, 'zebrafish', defaultSearchFilters, { now: NOW })
  const incremental = performance.now() - start
  report(`busca 10k: atualização incremental + consulta ${incremental.toFixed(1)} ms`)
  assert.deepEqual(hits.map(hit => hit.page.id), ['p5'])
  assert.ok(incremental < 100 * timingScale, `incremental ${incremental}`)
  const again = { ...edited, p6: { ...edited.p6, text: 'outra edição ornitorrinco' } }
  const second = performance.now()
  assert.deepEqual(searchWorkspace(again, 'ornitorrinco', defaultSearchFilters, { now: NOW }).map(hit => hit.page.id), ['p6'])
  const steady = performance.now() - second
  report(`busca 10k: segunda edição incremental + consulta ${steady.toFixed(1)} ms`)
  assert.ok(steady < 50 * timingScale, `incremental ${steady}`)
})

// ---------- gatilhos de reindexação (esquema/visualização e relações) ----------
function relationFixture(rows = 50) {
  const db = { properties: [{ id: 't', name: 'Nome', type: 'title' }, { id: 'x', name: 'Notas', type: 'text' }, { id: 'r', name: 'Projeto', type: 'relation', relationDatabaseId: 'pdb' }], views: [{ id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v' } as any
  const pages: Record<string, Page> = {
    db: page('db', { title: 'Tarefas', database: db }),
    pdb: page('pdb', { title: 'Projetos', database: { properties: [{ id: 't', name: 'Nome', type: 'title' }], views: [], activeViewId: '' } as any }),
    proj: page('proj', { parentId: 'pdb', title: 'Projeto Zeta' }),
    other: page('other', { parentId: 'pdb', title: 'Projeto Kappa' }),
  }
  for (let i = 0; i < rows; i++) pages[`r${i}`] = page(`r${i}`, { parentId: 'db', title: `tarefa ${i}`, props: { x: 'nota', r: i % 5 === 0 ? ['proj'] : ['other'] } } as any)
  return pages
}
function countingEngine(options = {}) {
  const engine = new SearchEngine(options) as any
  const original = engine.index.bind(engine)
  const counter = { n: 0 }
  engine.index = (p: Page, all: Record<string, Page>) => { counter.n++; return original(p, all) }
  return { engine: engine as SearchEngine, counter }
}

test('mudar a visualização (filtros, ordenação, larguras, loadLimit) não reindexa o conteúdo', () => {
  const pages = relationFixture()
  const { engine, counter } = countingEngine()
  engine.sync(pages)
  counter.n = 0
  const db = pages.db.database as any
  const viewChanged = { ...pages, db: { ...pages.db, database: { ...db, views: [{ ...db.views[0], filters: [{ propertyId: 'x', op: 'contains', value: 'a' }], sorts: [{ propertyId: 'x', direction: 'desc' }], hidden: ['x'], widths: { x: 320 }, loadLimit: 100 }] } } }
  engine.sync(viewChanged)
  assert.equal(counter.n, 1, 'só a página do banco (objeto novo), nenhuma linha')
  // Novo array de propriedades com o mesmo texto (ex.: cor de opção, formato numérico) também não.
  const cosmetic = { ...viewChanged, db: { ...viewChanged.db, database: { ...viewChanged.db.database!, properties: db.properties.map((p: any) => ({ ...p, numberFormat: 'percent' })) } } }
  counter.n = 0
  engine.sync(cosmetic)
  assert.equal(counter.n, 1)
  // Renomear uma propriedade muda o texto indexável: reindexa as linhas do banco.
  const renamed = { ...cosmetic, db: { ...cosmetic.db, database: { ...cosmetic.db.database!, properties: db.properties.map((p: any) => p.id === 'x' ? { ...p, name: 'Observações' } : p) } } }
  counter.n = 0
  engine.sync(renamed)
  assert.equal(counter.n, 51)
  assert.equal(engine.search('nota', { propertyName: 'Observações' }).length, 50)
})

test('renomear a página relacionada reindexa só as linhas que a citam (índice reverso)', () => {
  const pages = relationFixture()
  const { engine, counter } = countingEngine()
  engine.sync(pages)
  assert.equal(engine.search('zeta').length, 11)
  assert.equal(engine.referrersOf('proj').length, 10)
  counter.n = 0
  const renamed = { ...pages, proj: { ...pages.proj, title: 'Projeto Omega' } }
  engine.sync(renamed)
  assert.equal(counter.n, 11, 'a própria página + 10 linhas que a citam')
  assert.equal(engine.search('omega').length, 11)
  assert.equal(engine.search('zeta').length, 0)
  // Trocar a relação de uma linha atualiza o índice reverso.
  const moved = { ...renamed, r0: { ...renamed.r0, props: { ...renamed.r0.props, r: ['other'] } } }
  engine.sync(moved)
  assert.equal(engine.referrersOf('proj').length, 9)
  counter.n = 0
  engine.sync({ ...moved, proj: { ...moved.proj, title: 'Projeto Sigma' } })
  assert.equal(counter.n, 10)
  assert.equal(engine.search('sigma').length, 10)
  // Página relacionada removida: o texto some das linhas que a citavam.
  const { proj: _gone, ...without } = moved
  engine.sync(without)
  assert.equal(engine.search('omega').length, 0)
})

test('reindexação grande vai em fatias curtas e o índice fica completo no fim', async () => {
  const pages = relationFixture(3000)
  const engine = new SearchEngine({ sliceMs: 4, schedule: callback => setTimeout(callback, 0) })
  engine.sync(pages); engine.flush()
  assert.equal(engine.pendingCount, 0)
  const db = pages.db.database as any
  const renamed = { ...pages, db: { ...pages.db, database: { ...db, properties: db.properties.map((p: any) => p.id === 'x' ? { ...p, name: 'Observações' } : p) } }, proj: { ...pages.proj, title: 'Projeto Omega' } }
  const t0 = performance.now()
  engine.sync(renamed)
  const blocking = performance.now() - t0
  assert.ok(engine.pendingCount > 0, 'o excedente vai para a fila')
  const slices: number[] = []
  await engine.whenIdle(ms => slices.push(ms))
  assert.equal(engine.pendingCount, 0)
  assert.ok(slices.length > 1, `fatias=${slices.length}`)
  assert.ok(blocking < 50 && Math.max(...slices) < 50, `bloqueio=${blocking.toFixed(1)} maior fatia=${Math.max(...slices).toFixed(1)}`)
  assert.equal(engine.search('nota', { propertyName: 'Observações' }).length, 3000)
  assert.equal(engine.search('omega').length, 601)
})
