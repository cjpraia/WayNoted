// Lousa: estilo à mão, cena embutida em PNG/SVG, modelos, biblioteca, guias com medidas,
// redimensionar do centro, privacidade (texto pesquisável) e aresta no grafo.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCanvas, normalizeObject, canvasDocument, canvasText, LIGHT_PALETTE, type CanvasObject, type ShapeObject } from '../src/canvas/model.ts'
import { hatchPath, roughOutline, seeded, shapePaths, shapePolygon, dashFor } from '../src/canvas/sketch.ts'
import { embedInPng, embedInSvg, isPng, sceneFromPng, sceneFromSvg } from '../src/canvas/scene.ts'
import { CANVAS_TEMPLATES } from '../src/canvas/templates.ts'
import { libraryItem, normalizeLibrary } from '../src/canvas/library.ts'
import { connectorEnds, nearestDistances, resizeRect } from '../src/canvas/geometry.ts'
import { lookupOf, pasteObjects } from '../src/canvas/ops.ts'
import { canvasToSvg } from '../src/canvas/svg.ts'
import { extractSegments } from '../src/search/extract.ts'
import { extractGraph, buildGraph, defaultGraphFilter, EDGE_CANVAS } from '../src/graph/edges.ts'
import { validateMeta } from '../src/workspace.ts'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=='
const shape = (extra: Partial<ShapeObject> = {}): ShapeObject => ({ id: 'shape-1', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 100, text: 'Oi', color: 'blue', fill: 'tint', ...extra })

test('hand-drawn style is deterministic per object, varies by level and hatch stays inside the shape', () => {
  assert.equal(seeded('a')(), seeded('a')())
  assert.notEqual(seeded('a')(), seeded('b')())
  const a = roughOutline(shape(), 2), b = roughOutline(shape(), 2), c = roughOutline(shape(), 3)
  assert.equal(a, b, 'same object → same wobble (no flicker between frames/exports)')
  assert.notEqual(a, c)
  assert.match(shapePaths(shape()).outline, /^M/)
  assert.match(shapePaths(shape({ shape: 'ellipse', sketch: 1 })).outline, /C/)
  const hatch = hatchPath(shapePolygon(shape({ shape: 'diamond' })), 'cross', 10, 0, seeded('x'))
  const numbers = [...hatch.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => [Number(m[1]), Number(m[2])])
  assert.ok(numbers.length > 20)
  for (const [x, y] of numbers) assert.ok(Math.abs(x - 100) / 100 + Math.abs(y - 50) / 50 <= 1.02, `hatch point ${x},${y} inside diamond`)
  assert.deepEqual(dashFor('dashed', 2), [8, 6])
  assert.deepEqual(dashFor(undefined, 2), [])
  const svg = canvasToSvg([shape({ fill: 'hachure', sketch: 3, strokeStyle: 'dotted', opacity: 0.5, font: 'hand' })], { palette: LIGHT_PALETTE })
  assert.match(svg, /opacity="0.5"/)
  assert.match(svg, /Bradley Hand/)
  assert.match(svg, /stroke-dasharray/)
})

test('style fields normalize tolerantly (legacy dashed → strokeStyle, junk dropped)', () => {
  const o = normalizeObject({ id: 'k', type: 'connector', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, dashed: true, sketch: 9, opacity: 3, strokeWidth: 'x', font: 'comic' }) as Record<string, unknown>
  assert.equal(o.strokeStyle, 'dashed')
  assert.equal(o.sketch, undefined); assert.equal(o.opacity, undefined); assert.equal(o.strokeWidth, undefined); assert.equal(o.font, undefined)
  const s = normalizeObject({ ...shape(), fill: 'cross', radius: 0, opacity: 0.333, sketch: 2, font: 'mono' }) as ShapeObject
  assert.deepEqual([s.fill, s.radius, s.opacity, s.sketch, s.font], ['cross', 0, 0.33, 2, 'mono'])
})

test('exported PNG/SVG carry the scene and re-import as editable objects', () => {
  const objects: CanvasObject[] = [shape(), { id: 'n', type: 'note', x: 300, y: 0, w: 200, h: 200, text: 'Ideia çã ✓', color: 'pink' }]
  const bytes = Uint8Array.from(atob(PNG), c => c.charCodeAt(0))
  assert.ok(isPng(bytes))
  const png = embedInPng(bytes, objects)
  assert.ok(isPng(png) && png.length > bytes.length)
  assert.deepEqual(sceneFromPng(png), objects)
  assert.equal(sceneFromPng(bytes), null, 'plain PNG has no scene')
  const svg = embedInSvg(canvasToSvg(objects, { palette: LIGHT_PALETTE }), objects)
  assert.deepEqual(sceneFromSvg(svg), objects)
  assert.equal(sceneFromSvg('<svg></svg>'), null)
})

test('templates build valid boards whose connectors resolve after paste', () => {
  for (const template of CANVAS_TEMPLATES) for (const locale of ['pt-BR', 'en-US'] as const) {
    const objects = template.build(locale)
    const { data, repaired } = normalizeCanvas({ objects })
    assert.equal(repaired, 0, `${template.id} is valid`)
    const pasted = pasteObjects(data.objects, { x: 500, y: 500 })
    const lookup = lookupOf(pasted)
    for (const c of pasted) if (c.type === 'connector') {
      const ends = connectorEnds(c, lookup)
      assert.ok(!ends.deadA && !ends.deadB, `${template.id}: connector ends follow pasted copies`)
    }
    assert.ok(new Set(pasted.map(o => o.id)).size === pasted.length)
  }
})

test('library items persist in workspace settings, tolerate junk and cap size', () => {
  const item = libraryItem('Cartão', [shape({ locked: true })])
  assert.equal(item.objects[0].locked, undefined)
  const meta = validateMeta({ pages: {}, settings: { canvasLibrary: [item, { id: 'bad' }, 'x', { id: 'e', objects: [] }] } })
  assert.deepEqual(meta.settings.canvasLibrary?.map(i => i.id), [item.id])
  assert.deepEqual(normalizeLibrary('lixo'), [])
  assert.throws(() => libraryItem('grande', [{ id: 'img', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'data:image/png;base64,' + 'A'.repeat(600_000), name: 'x' }]), /TOO_LARGE/)
})

test('Figma-style measurements and resize from centre (⌥)', () => {
  const d = nearestDistances({ x: 100, y: 0, w: 50, h: 50 }, [{ x: 0, y: 10, w: 60, h: 20 }, { x: 300, y: 0, w: 10, h: 10 }, { x: 100, y: 120, w: 50, h: 10 }])
  assert.deepEqual(d.map(x => Math.round(x.value)).sort((a, b) => a - b), [40, 70, 150])
  assert.deepEqual(resizeRect({ x: 0, y: 0, w: 100, h: 100 }, 'e', 10, 0, false, 8, true), { x: -10, y: 0, w: 120, h: 100 })
})

test('privacy: board text never includes card page content; search segments point at objects', () => {
  const secret = '00000000-0000-4000-8000-000000000009'
  const doc = canvasDocument({ version: 1, objects: [{ id: 'card', type: 'page', x: 0, y: 0, w: 300, h: 200, pageId: secret }, { id: 'n1', type: 'note', x: 0, y: 300, w: 200, h: 200, text: 'texto do quadro', color: 'yellow' }, { id: 'img', type: 'image', x: 0, y: 0, w: 10, h: 10, src: `data:image/png;base64,${PNG}`, name: 'foto.png' }] }, 'blk')
  assert.equal(canvasText((doc[0] as { props: { objects: unknown[] } }).props), 'texto do quadro\nfoto.png')
  const { segments, attachments } = extractSegments(doc)
  assert.deepEqual(segments.map(s => [s.blockId, s.text]), [['n1', 'texto do quadro'], ['img', 'foto.png']])
  assert.deepEqual(attachments.map(a => [a.blockId, a.kind]), [['img', 'image']], 'board images go through local OCR like page images')
})

test('graph: a board containing a page yields an EDGE_CANVAS edge shown with links', () => {
  const page = (id: string, extra: Record<string, unknown> = {}) => ({ id, parentId: null, title: id, icon: null, trashed: false, ...extra })
  const pages = { B: page('B', { canvas: { version: 1 }, outboundPageIds: ['P'] }), P: page('P') } as never
  const g = extractGraph(pages)
  assert.equal(g.edges[0].kinds, EDGE_CANVAS)
  assert.equal(buildGraph(g, defaultGraphFilter).links.length, 1)
  assert.equal(buildGraph(g, { ...defaultGraphFilter, showLinks: false }).links.length, 0)
})
