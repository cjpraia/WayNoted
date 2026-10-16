import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractGraph, buildGraph, buildLocalGraph, defaultGraphFilter, livePageIds, EDGE_LINK, EDGE_BLOCK, EDGE_PARENT, EDGE_RELATION } from '../src/graph/edges.ts'
import { findUnlinkedMentions, linkFirstMention, wholeWordRanges, searchableTitle } from '../src/graph/unlinked.ts'
import { ForceLayout } from '../src/graph/layout.ts'
import { parseGraphSettings, matchesGroup } from '../src/graph/settings.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2), C = id(3), DB = id(4), R1 = id(5), R2 = id(6), ORPHAN = id(7), TRASHED = id(8), UNDER_TRASH = id(9), CHILD = id(10)

function page(pid: string, patch: Record<string, unknown> = {}) {
  return { id: pid, parentId: null, title: pid, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 0, updatedAt: 0, order: 0,
    fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...patch } as any
}

function fixture() {
  return {
    [A]: page(A, { title: 'Alfa', outboundPageIds: [B, CHILD, TRASHED] }),
    [B]: page(B, { title: 'Beta', outboundPageIds: [] }),
    [C]: page(C, { title: 'Gama', parentId: A }),
    [CHILD]: page(CHILD, { title: 'Filha embutida', parentId: A }),
    [DB]: page(DB, { title: 'Projetos', database: { properties: [{ id: 'title', name: 'Nome', type: 'title' }, { id: 'rel', name: 'Relacionado', type: 'relation', relationDatabaseId: DB }], views: [], activeViewId: '' } }),
    [R1]: page(R1, { title: 'Projeto 1', parentId: DB, props: { rel: [R2] } }),
    [R2]: page(R2, { title: 'Projeto 2', parentId: DB, props: { rel: [] } }),
    [ORPHAN]: page(ORPHAN, { title: 'Sozinha' }),
    [TRASHED]: page(TRASHED, { title: 'Lixo', trashed: true }),
    [UNDER_TRASH]: page(UNDER_TRASH, { title: 'Sob lixo', parentId: TRASHED }),
  }
}

const edgeKinds = (graph: ReturnType<typeof extractGraph>, a: string, b: string) => graph.edges.find(e => (e.source === a && e.target === b) || (e.source === b && e.target === a))?.kinds ?? 0

test('livePageIds exclui páginas na lixeira e descendentes', () => {
  const live = livePageIds(fixture())
  assert.equal(live.has(TRASHED), false)
  assert.equal(live.has(UNDER_TRASH), false)
  assert.equal(live.has(C), true)
  assert.equal(live.size, 8)
})

test('extrai todos os tipos de aresta com tipos combinados por par', () => {
  const g = extractGraph(fixture())
  assert.equal(edgeKinds(g, A, B), EDGE_LINK)
  assert.equal(edgeKinds(g, A, CHILD), EDGE_BLOCK | EDGE_PARENT)
  assert.equal(edgeKinds(g, A, C), EDGE_PARENT)
  assert.equal(edgeKinds(g, DB, R1), EDGE_PARENT)
  assert.equal(edgeKinds(g, R1, R2), EDGE_RELATION)
  assert.equal(edgeKinds(g, A, TRASHED), 0)
  assert.equal(g.nodes.get(DB)?.kind, 'database')
  assert.equal(g.nodes.get(R1)?.kind, 'row')
  assert.equal(g.nodes.get(C)?.kind, 'page')
  assert.equal(g.nodes.get(C)?.rootId, A)
})

test('buildGraph aplica filtros de tipo, conexões, órfãs e texto', () => {
  const g = extractGraph(fixture())
  const all = buildGraph(g, { ...defaultGraphFilter, showRows: true })
  assert.equal(all.nodes.length, 8)
  assert.equal(all.nodes.find(n => n.id === ORPHAN)?.orphan, true)
  const noRows = buildGraph(g, defaultGraphFilter)
  assert.equal(noRows.nodes.some(n => n.id === R1), false)
  const noHierarchy = buildGraph(g, { ...defaultGraphFilter, showHierarchy: false, showOrphans: false })
  assert.deepEqual(noHierarchy.nodes.map(n => n.title).sort(), ['Alfa', 'Beta', 'Filha embutida'])
  const linkKinds = noHierarchy.links.map(l => l.kinds).sort()
  assert.deepEqual(linkKinds, [EDGE_LINK, EDGE_BLOCK])
  const search = buildGraph(g, { ...defaultGraphFilter, search: 'ALFA' })
  assert.deepEqual(search.nodes.map(n => n.title), ['Alfa'])
  const relationsOnly = buildGraph(g, { ...defaultGraphFilter, showRows: true, showLinks: false, showHierarchy: false, showOrphans: false })
  assert.deepEqual(relationsOnly.nodes.map(n => n.title).sort(), ['Projeto 1', 'Projeto 2'])
  for (const link of all.links) assert.ok(link.source < all.nodes.length && link.target < all.nodes.length)
})

test('backlinks aparecem no grafo local (arestas recebidas) e profundidade é respeitada', () => {
  const g = extractGraph(fixture())
  const filter = { showLinks: true, showHierarchy: false, showRelations: true, showRows: true }
  const local1 = buildLocalGraph(g, B, 1, filter)
  assert.deepEqual(local1.nodes.map(n => n.title).sort(), ['Alfa', 'Beta'])
  const local2 = buildLocalGraph(g, B, 2, filter)
  assert.deepEqual(local2.nodes.map(n => n.title).sort(), ['Alfa', 'Beta', 'Filha embutida'])
  const lonely = buildLocalGraph(g, ORPHAN, 3, filter)
  assert.equal(lonely.nodes.length, 1)
  assert.equal(buildLocalGraph(g, TRASHED, 1, filter).nodes.length, 0)
})

test('menções não vinculadas: sem acento/caixa, palavra inteira, ignora quem já linka', () => {
  const pages = {
    [A]: page(A, { title: 'Ação Rápida' }),
    [B]: page(B, { title: 'Notas', bodyText: 'Hoje revisei a acao rapida do time.\nOutra linha.' }),
    [C]: page(C, { title: 'Outra', bodyText: 'Isso não é reação rápida nem açãorápida.' }),
    [ORPHAN]: page(ORPHAN, { title: 'Já linka', bodyText: 'Ação rápida', outboundPageIds: [A] }),
    [TRASHED]: page(TRASHED, { title: 'Lixo', trashed: true, bodyText: 'ação rápida' }),
    [R1]: page(R1, { title: 'Duas', bodyText: 'AÇÃO RÁPIDA e de novo ação rápida.' }),
  }
  const found = findUnlinkedMentions(pages, A)
  assert.deepEqual(found.map(m => m.title), ['Duas', 'Notas'])
  assert.equal(found[0].count, 2)
  const notas = found.find(m => m.title === 'Notas')!
  assert.equal(notas.match, 'acao rapida')
  assert.match(notas.before, /revisei a $/)
  assert.deepEqual(wholeWordRanges('Ação, ação! xação', 'acao'), [[0, 4], [6, 10]])
  assert.equal(searchableTitle('ab'), false)
  assert.equal(searchableTitle('   '), false)
  assert.deepEqual(findUnlinkedMentions({ [A]: page(A, { title: '' }), [B]: page(B, { bodyText: 'qualquer' }) }, A), [])
})

test('linkFirstMention converte só a primeira ocorrência em texto simples e preserva estilos', () => {
  const blocks = [
    { id: 'b1', type: 'paragraph', content: [{ type: 'link', href: 'https://x.test', content: [{ type: 'text', text: 'Beta', styles: {} }] }] },
    { id: 'b2', type: 'paragraph', content: [{ type: 'text', text: 'ver o Beta e Beta', styles: { bold: true } }], children: [] },
  ]
  const { blocks: out, linked } = linkFirstMention(blocks, 'beta', B)
  assert.equal(linked, true)
  assert.deepEqual((out[1] as any).content, [
    { type: 'text', text: 'ver o ', styles: { bold: true } },
    { type: 'link', href: `workspace://page/${B}`, content: [{ type: 'text', text: 'Beta', styles: { bold: true } }] },
    { type: 'text', text: ' e Beta', styles: { bold: true } },
  ])
  assert.equal((blocks[1] as any).content.length, 1, 'entrada não é mutada')
  const nested = linkFirstMention([{ id: 'p', type: 'paragraph', content: 'nada', children: [{ id: 'c', type: 'paragraph', content: 'sobre Beta.' }] }], 'Beta', B)
  assert.equal(nested.linked, true)
  assert.equal(((nested.blocks[0] as any).children[0].content[1]).href, `workspace://page/${B}`)
  const table = linkFirstMention([{ id: 't', type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'Beta', styles: {} }]] }] } }], 'Beta', B)
  assert.equal(table.linked, true)
  assert.equal(linkFirstMention([{ id: 'x', type: 'paragraph', content: 'Betamax' }], 'Beta', B).linked, false)
})

test('configurações do grafo: validação e grupos de cor', () => {
  const parsed = parseGraphSettings({ forces: { repel: 999 }, display: { groups: [{ id: 'g', query: 'x', color: 'red' }, { id: 'h', query: 'y', color: '#112233' }] }, local: { depth: 9 } })
  assert.equal(parsed.forces.repel, 20)
  assert.equal(parsed.display.groups.length, 1)
  assert.equal(parsed.local.depth, 3)
  assert.equal(parseGraphSettings(null).filter.showPages, true)
  assert.equal(matchesGroup({ title: 'Projeto Ação', kind: 'page', orphan: false }, 'acao'), true)
  assert.equal(matchesGroup({ title: 'X', kind: 'database', orphan: false }, 'type:banco'), true)
  assert.equal(matchesGroup({ title: 'X', kind: 'row', orphan: true }, 'tipo:orfa'), true)
  assert.equal(matchesGroup({ title: 'X', kind: 'page', orphan: false }, 'type:linha'), false)
})

test('layout com 5.000 nós: passos rápidos, estáveis e limitados', () => {
  const n = 5000, links: number[] = []
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let i = 1; i < n; i++) links.push(i, Math.floor(rand() * i))
  for (let i = 0; i < 2500; i++) links.push(Math.floor(rand() * n), Math.floor(rand() * n))
  const layout = new ForceLayout(n, links)
  const MAX_TICKS = 300 // teto fixo
  let ticks = 0
  const started = performance.now()
  while (ticks < MAX_TICKS && layout.tick()) ticks++
  const perTick = (performance.now() - started) / Math.max(1, ticks)
  assert.ok(ticks > 100, `simulou ${ticks} passos`)
  for (let i = 0; i < n; i++) assert.ok(Number.isFinite(layout.x[i]) && Number.isFinite(layout.y[i]), 'posições finitas')
  // Orçamento generoso para máquinas lentas; num M-series fica ~7 ms (Worker a 60 fps).
  assert.ok(perTick < 40, `média ${perTick.toFixed(2)} ms por passo`)
  // Esfria: a energia cinética no fim é bem menor que no início.
  let energy = 0
  for (let i = 0; i < n; i++) energy += layout.vx[i] ** 2 + layout.vy[i] ** 2
  assert.ok(energy / n < 1, `energia média ${(energy / n).toFixed(3)}`)
  // Nós fixados permanecem onde foram soltos.
  layout.pin(0, 1234, -321); layout.reheat(0.3); layout.tick()
  assert.equal(Math.round(layout.x[0]), 1234)
  assert.equal(Math.round(layout.y[0]), -321)
})
