// Desempenho/regressão dos dados de bancos grandes: índice por pai, applyView com cache e
// incremental, igualdade JSON sem serializar, gravação incremental do meta e virtualização (matemática).
// Limites generosos (máquinas lentas/CI); os números reais estão no relatório do harness (src/perf).
import test from 'node:test'
import assert from 'node:assert/strict'

Object.assign(globalThis, { window: { addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null } })

const { buildOffsets, findRange, scrollDeltaFor } = await import('../src/components/database/virtual/virtualMath.ts')
const { pageIndex, liveChildren, isLiveIndexed, descendantIds } = await import('../src/perf/pageIndex.ts')
const { jsonEqual, mergeMeta } = await import('../electron/meta-merge.mjs')
const { diffMeta, applyMetaPatch, validMetaPatch } = await import('../electron/meta-patch.mjs')
const { sharePages } = await import('../src/perf/shareMeta.ts')
const { applyView } = await import('../src/components/database/lib.ts')

type AnyPage = Record<string, any>
const page = (id: string, parentId: string | null, order: number, extra: AnyPage = {}): AnyPage => ({ id, parentId, title: id, order, trashed: false, props: {}, createdAt: 1, updatedAt: 1, ...extra })

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

test('virtualização: offsets, faixa visível e rolagem até um item', () => {
  const offsets = buildOffsets(1000, (i) => (i % 10 === 0 ? 60 : 30))
  assert.equal(offsets[1000], 100 * 60 + 900 * 30)
  const range = findRange(offsets, 0, 300)
  assert.equal(range.start, 0)
  assert.ok(range.end >= 9 && range.end <= 11, `end=${range.end}`)
  const middle = findRange(offsets, 10000, 10600)
  assert.ok(offsets[middle.start] <= 10000 && offsets[middle.start + 1] > 10000)
  assert.ok(offsets[middle.end - 1] < 10600 && offsets[middle.end] >= 10600)
  assert.deepEqual(findRange(buildOffsets(0, () => 30), 0, 100), { start: 0, end: 0 })
  assert.equal(scrollDeltaFor(offsets, 0, 0, 300), null)
  const delta = scrollDeltaFor(offsets, 500, 0, 300)!
  assert.ok(delta > 0 && offsets[500] - delta >= 0 && offsets[501] - delta <= 300)
})

test('índice por pai: patch incremental igual à reconstrução, e arrays de pais intocados mantêm identidade', () => {
  const pages: Record<string, AnyPage> = {}
  pages.db = page('db', null, 0, { database: {} })
  pages.other = page('other', null, 1)
  for (let i = 0; i < 2000; i++) pages[`r${i}`] = page(`r${i}`, 'db', i)
  for (let i = 0; i < 50; i++) pages[`o${i}`] = page(`o${i}`, 'other', i)
  const first = liveChildren(pages as any, 'db'), otherBefore = liveChildren(pages as any, 'other')
  assert.equal(first.length, 2000)
  const random = rng(3)
  let current = pages
  for (let step = 0; step < 200; step++) {
    const next = { ...current }, id = `r${Math.floor(random() * 2000)}`
    const roll = random()
    if (roll < 0.5) next[id] = { ...next[id], title: `t${step}` }
    else if (roll < 0.7) next[id] = { ...next[id], order: random() * 2000 }
    else if (roll < 0.85) next[id] = { ...next[id], trashed: !next[id].trashed }
    else next[`n${step}`] = page(`n${step}`, 'db', random() * 2000)
    current = next
    const fast = liveChildren(current as any, 'db').map((p) => p.id)
    const brute = Object.values(current).filter((p) => p.parentId === 'db' && !p.trashed).sort((a, b) => a.order - b.order).map((p) => p.id)
    assert.deepEqual([...fast].sort(), [...brute].sort())
    const orders = liveChildren(current as any, 'db').map((p) => p.order)
    assert.ok(orders.every((o, i) => i === 0 || orders[i - 1] <= o), 'ordenado por order')
  }
  assert.equal(liveChildren(current as any, 'other'), otherBefore, 'pai não alterado mantém o mesmo array')
  // Exclusão definitiva: reconstrói.
  const removed = { ...current }; delete removed.r0
  assert.ok(!liveChildren(removed as any, 'db').some((p) => p.id === 'r0'))
  assert.equal(pageIndex(removed as any).size, Object.keys(removed).length)
})

test('isLive e descendentes pelo índice', () => {
  const pages: Record<string, AnyPage> = { a: page('a', null, 0), b: page('b', 'a', 0), c: page('c', 'b', 0), d: page('d', 'a', 1, { trashed: true }), e: page('e', 'd', 0), orphan: page('orphan', 'missing', 0) }
  assert.equal(isLiveIndexed(pages as any, 'c'), true)
  assert.equal(isLiveIndexed(pages as any, 'e'), false)
  assert.equal(isLiveIndexed(pages as any, 'orphan'), false)
  assert.equal(isLiveIndexed(pages as any, 'nope'), false)
  assert.deepEqual(descendantIds(pages as any, 'a'), ['b', 'c', 'd', 'e'])
})

test('jsonEqual tem a semântica de JSON.stringify (sem serializar)', () => {
  const cases: [unknown, unknown][] = [
    [{ a: 1, b: undefined }, { a: 1 }], [[1, undefined], [1, null]], [{ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }], [{ a: 1 }, { a: 2 }],
    [NaN, null], [null, 0], ['1', 1], [[], {}], [{ a: { b: [1, 2, 3] } }, { a: { b: [1, 2] } }], [true, true], [{}, { x: undefined }],
  ]
  for (const [a, b] of cases) assert.equal(jsonEqual(a, b), JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b]))
  // Ordem de chaves diferente é igual (antes contava como mudança; agora evita conflitos falsos).
  assert.equal(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  const base = { pages: { x: { id: 'x', title: 'A' } }, settings: { theme: 'light' } }
  const merged = mergeMeta(base, base, { ...base, pages: { x: { id: 'x', title: 'B' } } })
  assert.equal((merged as any).pages.x.title, 'B')
})

test('gravação incremental do meta: diff/patch ida e volta; compartilhamento estrutural', () => {
  const prev = { pages: { a: page('a', null, 0), b: page('b', null, 1) }, settings: { theme: 'light' }, notifications: {}, syncedBlocks: {} }
  const next = { ...prev, pages: { ...prev.pages, a: { ...prev.pages.a, title: 'novo' }, c: page('c', null, 2) }, settings: { theme: 'dark' } }
  delete (next.pages as any).b
  const patch = diffMeta(prev, next)
  assert.equal(validMetaPatch(patch), true)
  assert.deepEqual(Object.keys(patch.pages).sort(), ['a', 'b', 'c'])
  assert.equal(patch.pages.b, null)
  assert.ok('settings' in patch && !('notifications' in patch))
  const rebuilt = applyMetaPatch(prev, patch)
  assert.equal(JSON.stringify(rebuilt), JSON.stringify(next))
  assert.equal(diffMeta(next, next).size, 0)
  assert.equal(validMetaPatch({ pages: { a: { id: 'b' } }, size: 1 }), false)
  // Clone (como chega do IPC): reaproveita os objetos iguais.
  const clone = structuredClone(next.pages)
  assert.equal(sharePages(clone as any, next.pages as any), next.pages)
  const changed = { ...clone, c: { ...clone.c, title: 'outro' } }
  const shared = sharePages(changed as any, next.pages as any)
  assert.equal(shared.a, next.pages.a)
  assert.notEqual(shared.c, next.pages.c)
})

// ---------- applyView com 50 mil linhas ----------
const schema = {
  properties: [
    { id: 'title', name: 'Nome', type: 'title' },
    { id: 'status', name: 'Status', type: 'status', options: [{ id: 's1', name: 'A', color: 'gray' }, { id: 's2', name: 'B', color: 'blue' }, { id: 's3', name: 'C', color: 'green' }] },
    { id: 'num', name: 'Número', type: 'number' },
    { id: 'text', name: 'Texto', type: 'text' },
  ],
  views: [], activeViewId: 'v',
} as any
function rows(count: number) {
  const random = rng(7), out: AnyPage[] = []
  for (let i = 0; i < count; i++) out.push(page(`row${i}`, 'db', i, { title: `linha ${Math.floor(random() * 100000)}`, props: { status: ['s1', 's2', 's3'][i % 3], num: Math.round(random() * 1000), text: random() < 0.3 ? '' : `t${i % 97}` } }))
  return out
}
const reference = (list: AnyPage[], filterStatus: string) => list.filter((r) => r.props.status !== filterStatus).map((r, index) => ({ r, index }))
  .sort((a, b) => (a.r.props.num - b.r.props.num) || (a.index - b.index)).map((x) => x.r.id)

test('applyView: 50 mil linhas com filtro + ordenação dentro de limites generosos, cache e edição incremental corretos', () => {
  const list = rows(50000)
  const view = { id: 'perf-view', name: 'T', type: 'table', filters: [{ id: 'f', propertyId: 'status', op: 'isNot', value: 's3' }], sorts: [{ propertyId: 'num', direction: 'asc' }], hidden: [], widths: {} } as any
  let t = performance.now()
  const out = applyView(list as any, schema, view)
  const cold = performance.now() - t
  assert.deepEqual(out.map((r: AnyPage) => r.id), reference(list, 's3'))
  assert.ok(cold < 4000, `applyView frio 50k: ${cold.toFixed(0)} ms`)
  // Mesma entrada (outro array, mesmos objetos) → mesmo resultado, sem recomputar.
  t = performance.now()
  assert.equal(applyView([...list] as any, schema, view), out)
  assert.ok(performance.now() - t < 200, 'cache por visualização')
  // Edita uma célula (nova identidade de uma linha): incremental e igual à referência.
  const edited = [...list]
  edited[123] = { ...edited[123], props: { ...edited[123].props, num: -1 } }
  edited[40000] = { ...edited[40000], props: { ...edited[40000].props, status: 's3' } }
  t = performance.now()
  const after = applyView(edited as any, schema, view)
  const incremental = performance.now() - t
  assert.deepEqual(after.map((r: AnyPage) => r.id), reference(edited, 's3'))
  assert.equal(after[0].id, 'row123')
  assert.ok(incremental < 1000, `edição incremental 50k: ${incremental.toFixed(0)} ms`)
  // Ordenação por texto (Intl.Collator) com vazios no fim.
  const byText = applyView(list.slice(0, 2000) as any, schema, { ...view, id: 'v2', filters: [], sorts: [{ propertyId: 'text', direction: 'asc' }] })
  const firstEmpty = byText.findIndex((r: AnyPage) => !r.props.text)
  assert.ok(firstEmpty > 0 && byText.slice(firstEmpty).every((r: AnyPage) => !r.props.text), 'vazios no fim')
})
