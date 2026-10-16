// Orçamento de latência (Doherty): operações puras mensuráveis, com 1 mil e 10 mil páginas sintéticas.
// Limites GENEROSOS (máquinas lentas/CI): servem para pegar regressões grosseiras. Veja docs/DEVELOPMENT.md
// ("Orçamento de latência"). Os números reais são impressos na saída de cada teste.
import test from 'node:test'
import assert from 'node:assert/strict'

Object.assign(globalThis, { window: { addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })

const { SearchEngine } = await import('../src/search/engine.ts')
const { applyView } = await import('../src/components/database/lib.ts')
const { collectTasks, bucketTasks } = await import('../src/tasks/taskCore.ts')
const { extractGraph, buildGraph, defaultGraphFilter } = await import('../src/graph/edges.ts')
const { ForceLayout } = await import('../src/graph/layout.ts')
const { pageIndex, liveChildren } = await import('../src/perf/pageIndex.ts')

type AnyPage = Record<string, any>
const WORDS = ['alfa', 'bravo', 'charlie', 'delta', 'eco', 'foxtrot', 'golf', 'hotel', 'índigo', 'julieta', 'orçamento', 'reunião', 'projeto', 'revisão']
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
/** Orçamentos (ms) por operação: `resposta` ≤ 400 ms de percepção; folga de ~4× para máquinas lentas. */
const BUDGET = { search: 400, searchIndex: 4000, applyView: 600, tasks: 800, graphBuild: 1500, layoutTick: 60, index: 400 } as const
const table: string[] = []
const report = (name: string, size: number, ms: number, budget: number) => { table.push(`${name} @${size}: ${ms.toFixed(1)} ms (limite ${budget})`); console.log(`  [latência] ${name} @${size}: ${ms.toFixed(1)} ms (limite ${budget})`) }
const timed = <T,>(fn: () => T): [T, number] => { const t = performance.now(); const out = fn(); return [out, performance.now() - t] }

function workspace(count: number) {
  const random = rng(11)
  const pages: Record<string, AnyPage> = {}
  const pick = () => WORDS[Math.floor(random() * WORDS.length)]
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    ids.push(id)
    const links = i > 0 && random() < 0.7 ? [ids[Math.floor(random() * i)], ids[Math.floor(random() * i)]] : []
    pages[id] = { id, parentId: i > 20 && random() < 0.6 ? ids[Math.floor(random() * 20)] : null, title: `${pick()} ${pick()} ${i}`, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null,
      createdAt: 1, updatedAt: 1 + i, order: i, fullWidth: false, smallText: false, font: 'default', locked: false,
      text: Array.from({ length: 40 }, pick).join(' '), outboundPageIds: links, props: {} }
  }
  return { pages, ids }
}

for (const size of [1000, 10000]) {
  test(`busca: indexar e consultar ${size} páginas`, () => {
    const { pages } = workspace(size)
    const engine = new SearchEngine()
    const [, indexMs] = timed(() => engine.sync(pages as any))
    report('busca/indexar', size, indexMs, BUDGET.searchIndex)
    assert.ok(indexMs < BUDGET.searchIndex * (size / 1000 > 1 ? 3 : 1))
    for (const query of ['orcamento', 'reuniao projeto', '"alfa bravo"', 'revizao']) {
      const [hits, ms] = timed(() => engine.search(query, { now: 2 } as any))
      report(`busca/consulta "${query}"`, size, ms, BUDGET.search)
      assert.ok(Array.isArray(hits))
      assert.ok(ms < BUDGET.search, `${query}: ${ms.toFixed(0)} ms`)
    }
  })

  test(`banco: applyView (filtro + ordenação) com ${size} linhas`, () => {
    const random = rng(5)
    const schema = { properties: [{ id: 'title', name: 'Nome', type: 'title' }, { id: 'status', name: 'Status', type: 'status', options: [{ id: 's1', name: 'A', color: 'gray' }, { id: 's2', name: 'B', color: 'blue' }] }, { id: 'num', name: 'N', type: 'number' }], views: [], activeViewId: 'v' } as any
    const rows = Array.from({ length: size }, (_, i) => ({ id: `r${i}`, parentId: 'db', title: `linha ${Math.floor(random() * 1e5)}`, order: i, trashed: false, props: { status: i % 2 ? 's1' : 's2', num: Math.round(random() * 1000) } }))
    const view = { id: `lat-${size}`, name: 'T', type: 'table', filters: [{ id: 'f', propertyId: 'status', op: 'isNot', value: 's2' }], sorts: [{ propertyId: 'num', direction: 'asc' }], hidden: [], widths: {} } as any
    const [out, ms] = timed(() => applyView(rows as any, schema, view))
    report('banco/applyView', size, ms, BUDGET.applyView)
    assert.equal(out.length, size / 2)
    assert.ok(ms < BUDGET.applyView, `${ms.toFixed(0)} ms`)
  })

  test(`tarefas: coletar e agrupar ${size} páginas`, () => {
    const { pages, ids } = workspace(size)
    const checklists = new Map<string, any[]>()
    ids.forEach((id, i) => { if (i % 3 === 0) checklists.set(id, [{ blockId: `b${i}`, text: `tarefa ${i}`, checked: false, date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00.000Z` }]) })
    const [items, ms] = timed(() => collectTasks({ pages: pages as any, checklists: checklists as any }))
    const [buckets, ms2] = timed(() => bucketTasks(items, '2026-10-08'))
    report('tarefas/coletar+agrupar', size, ms + ms2, BUDGET.tasks)
    assert.ok(items.length > 0 && buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.undated.length === items.length)
    assert.ok(ms + ms2 < BUDGET.tasks, `${(ms + ms2).toFixed(0)} ms`)
  })

  test(`grafo: extrair/construir ${size} nós e um passo do layout`, () => {
    const { pages } = workspace(size)
    const [built, ms] = timed(() => buildGraph(extractGraph(pages as any), defaultGraphFilter))
    report('grafo/extrair+construir', size, ms, BUDGET.graphBuild)
    assert.ok(built.nodes.length > 0 && ms < BUDGET.graphBuild * (size > 1000 ? 3 : 1), `${ms.toFixed(0)} ms`)
    const index = new Map(built.nodes.map((node: any, i: number) => [node.id, i]))
    const links: number[] = []
    for (const link of built.links as any[]) { const a = index.get(typeof link.source === 'string' ? link.source : built.nodes[link.source]?.id), b = index.get(typeof link.target === 'string' ? link.target : built.nodes[link.target]?.id); if (a !== undefined && b !== undefined) links.push(a, b) }
    const layout = new ForceLayout(built.nodes.length, links)
    layout.tick()
    const [, tickMs] = timed(() => { for (let i = 0; i < 3; i++) layout.tick() })
    report('grafo/layout (média por passo)', size, tickMs / 3, BUDGET.layoutTick)
    assert.ok(tickMs / 3 < BUDGET.layoutTick * (size > 1000 ? 3 : 1), `${(tickMs / 3).toFixed(1)} ms/passo`)
  })

  test(`índice por pai: montar e consultar filhos com ${size} páginas`, () => {
    const { pages, ids } = workspace(size)
    const [, ms] = timed(() => pageIndex(pages as any))
    const [kids, ms2] = timed(() => { let total = 0; for (const id of ids.slice(0, 20)) total += liveChildren(pages as any, id).length; return total })
    report('índice/montar+consultar', size, ms + ms2, BUDGET.index)
    assert.ok(kids >= 0 && ms + ms2 < BUDGET.index, `${(ms + ms2).toFixed(0)} ms`)
  })
}

test('resumo do orçamento (impresso para o relatório)', () => { console.log(table.join('\n')); assert.ok(table.length > 0) })
