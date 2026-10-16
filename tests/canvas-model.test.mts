import COMPAT from '../shared/compatibility.ts'
// Lousa: modelo, normalização, envelope do documento, geometria, snap, conectores, culling e desfazer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasDocument, canvasSegments, canvasText, contrast, emptyCanvas, normalizeCanvas, normalizeCanvasPageInfo, readCanvasDocument, swatch, CANVAS_COLORS, type CanvasObject, type ConnectorObject } from '../src/canvas/model.ts'
import { alignOffsets, boxBounds, connectorEnds, connectorGeometry, distributeOffsets, handleAt, hitTest, objectBounds, resizeRect, rotationFor, sectionMembers, snapRect, transformObject } from '../src/canvas/geometry.ts'
import { SpatialIndex } from '../src/canvas/spatial.ts'
import { CanvasHistory } from '../src/canvas/history.ts'
import { createBox, deleteObjects, duplicateObjects, freezeConnectorEnds, groupObjects, lookupOf, parseClipboard, pasteObjects, reorder, serializeClipboard, simplifySamples, strokeFromSamples, strokesAt, withGroups } from '../src/canvas/ops.ts'
import { canvasToSvg } from '../src/canvas/svg.ts'
import { LIGHT_PALETTE, DARK_PALETTE } from '../src/canvas/model.ts'
import { documentLinks, validateMeta } from '../src/workspace.ts'
import { blocksToText } from '../src/components/page/util.ts'

const P1 = '00000000-0000-4000-8000-000000000001', P2 = '00000000-0000-4000-8000-000000000002'
const box = (id: string, x: number, y: number, w = 100, h = 80, extra: Record<string, unknown> = {}) => ({ id, type: 'note', x, y, w, h, text: id, color: 'yellow', ...extra }) as CanvasObject

test('normalizeCanvas repairs instead of refusing and preserves unknown future objects', () => {
  const { data, repaired } = normalizeCanvas({ objects: [
    box('a', 0, 0), box('a', 10, 10), { id: 'b', type: 'note', x: 'oops', y: NaN, w: -5, text: 3 }, null, { type: 'note' },
    { id: 'c', type: 'page' }, { id: 'f', type: 'hologram', depth: 3 }, { id: 'd', type: 'draw', x: 0, y: 0, w: 1, h: 1, points: [0, 0, 0.5, 4, 4, 0.5, 9] },
    { id: 'k', type: 'connector', from: { id: 'a', x: 0, y: 0 }, to: { id: 'a', x: 1, y: 1 }, route: 'zigzag', color: 'neon' },
  ], grid: false })
  const ids = data.objects.map(o => o.id)
  assert.equal(ids.length, 6)
  assert.equal(new Set(ids).size, 6, 'duplicate id reassigned')
  assert.ok(repaired >= 4)
  const b = data.objects.find(o => o.id === 'b') as { x: number; y: number; w: number; text: string }
  assert.equal(b.x, 0); assert.equal(b.y, 0); assert.equal(b.w, 8); assert.equal(b.text, '')
  assert.equal((data.objects.find(o => o.id === 'f') as unknown as { depth: number }).depth, 3, 'unknown type kept as-is')
  assert.deepEqual((data.objects.find(o => o.id === 'd') as { points: number[] }).points, [0, 0, 0.5, 4, 4, 0.5])
  const k = data.objects.find(o => o.id === 'k') as ConnectorObject
  assert.equal(k.route, 'curve'); assert.equal(k.color, 'default'); assert.equal(k.to.id, undefined, 'self-loop detached'); assert.equal(k.endArrow, true)
  assert.equal(data.grid, false); assert.equal(data.snap, true)
})

test('document envelope round-trips and never drops foreign blocks; legacy meta is tolerated', () => {
  const data = { ...emptyCanvas(), objects: [box('n1', 0, 0), { id: 'c1', type: 'page', x: 200, y: 0, w: 300, h: 200, pageId: P1 } as CanvasObject] }
  const legacy = { id: 'p', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'antigo', styles: {} }], children: [] }
  const doc = canvasDocument(data, 'blk', [legacy])
  const back = readCanvasDocument(JSON.parse(JSON.stringify(doc)))
  assert.equal(back.blockId, 'blk')
  assert.deepEqual(back.data.objects, data.objects)
  assert.equal(back.preserved.length, 1)
  assert.equal(readCanvasDocument(null).data.objects.length, 0)
  assert.equal(readCanvasDocument([legacy]).preserved.length, 1, 'page converted to canvas keeps old blocks')
  // Busca: texto das notas indexado via blocksToText; cartões viram links (backlinks/grafo).
  assert.match(blocksToText(doc), /n1/)
  assert.match(blocksToText(doc), /antigo/)
  assert.deepEqual(documentLinks(doc), [P1])
  assert.equal(canvasText(data), 'n1')
  assert.deepEqual(canvasSegments(data).map(s => s.id), ['n1'])
  // Meta antigo sem `canvas` e meta com marcador inválido passam pela validação sem recusa.
  const page = (extra: Record<string, unknown>) => ({ id: P1, parentId: null, title: 'Q', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra })
  assert.deepEqual(validateMeta({ pages: { [P1]: page({ canvas: { version: 1 } }) }, settings: {} }).pages[P1].canvas, { version: 1 })
  assert.equal(validateMeta({ pages: { [P1]: page({ canvas: 'lixo' }) }, settings: {} }).pages[P1].canvas, undefined)
  assert.equal(validateMeta({ pages: { [P1]: page({}) }, settings: {} }).pages[P1].canvas, undefined)
  assert.deepEqual(normalizeCanvasPageInfo(true), { version: 1 })
})

test('post-it and shape colours keep readable contrast in light and dark themes', () => {
  for (const dark of [false, true]) for (const color of CANVAS_COLORS) {
    const [bg, fg] = swatch(color, dark)
    assert.ok(contrast(bg, fg) >= 4.5, `${color} ${dark ? 'dark' : 'light'}: ${contrast(bg, fg).toFixed(2)}`)
  }
})

test('hit-test respects z order, rotation, shape outlines and cards above the canvas', () => {
  const objects: CanvasObject[] = [
    box('under', 0, 0, 200, 200),
    { id: 'ell', type: 'shape', shape: 'ellipse', x: 300, y: 0, w: 200, h: 100, text: '', color: 'blue', fill: 'tint' },
    box('over', 50, 50, 50, 50),
    { id: 'rot', type: 'shape', shape: 'rect', x: 600, y: 0, w: 200, h: 20, rotation: 90, text: '', color: 'blue', fill: 'tint' },
    { id: 'card', type: 'page', x: 900, y: 0, w: 100, h: 100, pageId: P1 },
    box('aboveCard', 900, 0, 100, 100),
  ]
  const lookup = lookupOf(objects)
  assert.equal(hitTest(objects, { x: 60, y: 60 }, 0, lookup)?.id, 'over')
  assert.equal(hitTest(objects, { x: 10, y: 10 }, 0, lookup)?.id, 'under')
  assert.equal(hitTest(objects, { x: 305, y: 5 }, 0, lookup), null, 'ellipse corner is empty')
  assert.equal(hitTest(objects, { x: 400, y: 50 }, 0, lookup)?.id, 'ell')
  assert.equal(hitTest(objects, { x: 700, y: 80 }, 0, lookup)?.id, 'rot', 'rotated 90° rectangle is vertical')
  assert.equal(hitTest(objects, { x: 790, y: 10 }, 0, lookup), null)
  assert.equal(hitTest(objects, { x: 950, y: 50 }, 0, lookup)?.id, 'card', 'DOM cards render above the canvas layer')
  const b = boxBounds(objects[3] as never)
  assert.ok(Math.abs(b.w - 20) < 1e-6 && Math.abs(b.h - 200) < 1e-6)
})

test('connectors anchor to facing sides, follow moved objects and fall back when the target is gone', () => {
  const a = box('a', 0, 0, 100, 100), b = box('b', 400, 0, 100, 100)
  const c: ConnectorObject = { id: 'c', type: 'connector', from: { id: 'a', x: 0, y: 0 }, to: { id: 'b', x: 0, y: 0 }, route: 'straight', color: 'default', endArrow: true }
  let objects: CanvasObject[] = [a, b, c]
  let ends = connectorEnds(c, lookupOf(objects))
  assert.deepEqual([ends.a, ends.b, ends.sideA, ends.sideB], [{ x: 100, y: 50 }, { x: 400, y: 50 }, 'right', 'left'])
  objects = [a, { ...b, x: 0, y: 400 } as CanvasObject, c]
  ends = connectorEnds(c, lookupOf(objects))
  assert.deepEqual([ends.sideA, ends.sideB, ends.b], ['bottom', 'top', { x: 50, y: 400 }])
  const frozen = freezeConnectorEnds(objects)
  const fc = frozen[2] as ConnectorObject
  assert.deepEqual([fc.to.x, fc.to.y], [50, 400])
  const orphan = connectorEnds(fc, lookupOf([a, fc]))
  assert.equal(orphan.deadB, true); assert.deepEqual(orphan.b, { x: 50, y: 400 })
  const ortho = connectorGeometry({ ...c, route: 'orthogonal' }, lookupOf([a, b]))
  assert.equal(ortho.kind, 'poly')
  if (ortho.kind === 'poly') for (let i = 1; i < ortho.points.length; i++) assert.ok(ortho.points[i].x === ortho.points[i - 1].x || ortho.points[i].y === ortho.points[i - 1].y, 'orthogonal segments only')
  assert.equal(connectorGeometry({ ...c, route: 'curve' }, lookupOf([a, b])).kind, 'bezier')
  // Deleting a card removes connectors anchored to it.
  assert.deepEqual(deleteObjects([a, b, c], new Set(['b'])).map(o => o.id), ['a'])
  // Connector hit-test along the line.
  assert.equal(hitTest([a, b, c], { x: 250, y: 52 }, 2, lookupOf([a, b, c]))?.id, 'c')
})

test('snap aligns edges/centres and returns guides; resize keeps ratio; rotation snaps to 15°', () => {
  const s = snapRect({ x: 103, y: 300, w: 50, h: 50 }, [{ x: 100, y: 0, w: 80, h: 80 }], 6)
  assert.equal(s.dx, -3); assert.equal(s.dy, 0); assert.equal(s.guides[0].axis, 'x')
  assert.deepEqual(snapRect({ x: 500, y: 500, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 10 }], 6), { dx: 0, dy: 0, guides: [] })
  assert.deepEqual(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'se', 100, 0, true), { x: 0, y: 0, w: 200, h: 100 })
  assert.deepEqual(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, 'nw', 200, 200), { x: 92, y: 42, w: 8, h: 8 })
  assert.equal(rotationFor({ x: 0, y: 0 }, { x: 10, y: 1 }, true), 90)
  assert.equal(handleAt({ x: 0, y: 0, w: 100, h: 100 }, { x: 101, y: 99 }, 1), 'se')
  assert.equal(handleAt({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: -24 }, 1, 0, true), 'rotate')
  const scaled = transformObject({ id: 'd', type: 'draw', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 0.5, 10, 10, 0.5], color: 'default', size: 2 }, { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 20, h: 40 }) as { points: number[] }
  assert.deepEqual(scaled.points, [0, 0, 0.5, 20, 40, 0.5])
})

test('align, distribute, sections, groups, z-order, duplicate and clipboard', () => {
  const items = [{ id: 'a', r: { x: 0, y: 0, w: 10, h: 10 } }, { id: 'b', r: { x: 50, y: 20, w: 10, h: 10 } }, { id: 'c', r: { x: 200, y: 5, w: 10, h: 10 } }]
  assert.deepEqual(alignOffsets(items, 'top').get('b'), { x: 0, y: -20 })
  assert.deepEqual(distributeOffsets(items, 'x').get('b'), { x: 50, y: 0 })
  const section = { id: 's', type: 'section', x: 0, y: 0, w: 500, h: 500, title: 'S', color: 'gray' } as CanvasObject
  const objects = [section, box('in', 10, 50), box('out', 600, 0)]
  assert.deepEqual(sectionMembers(section as never, objects, lookupOf(objects)), ['in'])
  const grouped = groupObjects(objects, new Set(['in', 'out']))
  assert.deepEqual([...withGroups(grouped, ['in'])].sort(), ['in', 'out'])
  assert.deepEqual(reorder(objects, new Set(['s']), 'front').map(o => o.id), ['in', 'out', 's'])
  assert.deepEqual(reorder(objects, new Set(['out']), 'backward').map(o => o.id), ['s', 'out', 'in'])
  const a = box('a', 0, 0), b = box('b', 300, 0)
  const conn: ConnectorObject = { id: 'k', type: 'connector', from: { id: 'a', x: 0, y: 0 }, to: { id: 'b', x: 0, y: 0 }, route: 'curve', color: 'default' }
  const dup = duplicateObjects([a, b, conn], new Set(['a', 'b']))
  assert.equal(dup.objects.length, 6, 'connector between duplicated objects is duplicated too')
  const copiedConn = dup.objects.find(o => o.type === 'connector' && o.id !== 'k') as ConnectorObject
  assert.ok(dup.added.includes(copiedConn.from.id!) && dup.added.includes(copiedConn.to.id!))
  const clip = serializeClipboard([a, b, conn], new Set(['a']))
  const parsed = parseClipboard(clip)!
  assert.equal(parsed.length, 1)
  const pasted = pasteObjects(parsed, { x: 1000, y: 1000 })
  assert.notEqual(pasted[0].id, 'a')
  assert.deepEqual([(pasted[0] as { x: number }).x, (pasted[0] as { y: number }).y], [950, 960])
  assert.equal(parseClipboard('texto comum'), null)
  assert.equal(parseClipboard(COMPAT.record074), null)
  const note = createBox('note', { x: 0, y: 0 })
  assert.equal(note.type, 'note')
})

test('freehand strokes: simplification, bounds, eraser', () => {
  const samples: number[] = []
  for (let i = 0; i <= 100; i++) samples.push(100 + i, 50 + (i % 2 ? 0.1 : 0), 0.5)
  const simple = simplifySamples(samples)
  assert.ok(simple.length / 3 <= 3, `straight line simplified to ${simple.length / 3} points`)
  const stroke = strokeFromSamples(simple, 'blue', 4)!
  assert.equal(stroke.x, 100); assert.equal(stroke.w, 100)
  assert.deepEqual(strokesAt([stroke], { x: 150, y: 51 }, 4), [stroke.id])
  assert.deepEqual(strokesAt([stroke], { x: 150, y: 90 }, 4), [])
})

test('spatial index culls to the viewport and agrees with a linear scan', () => {
  const objects: CanvasObject[] = []
  for (let i = 0; i < 500; i++) objects.push(box(`o${i}`, (i % 25) * 300, Math.floor(i / 25) * 300, 200, 150))
  objects.push(box('huge', -5000, -5000, 20000, 20000))
  const lookup = lookupOf(objects)
  const index = new SpatialIndex().build(objects, lookup)
  const view = { x: 1000, y: 1000, w: 900, h: 600 }
  const fromIndex = [...index.query(view)].sort()
  const linear = objects.filter(o => { const r = objectBounds(o, lookup); return r.x <= view.x + view.w && view.x <= r.x + r.w && r.y <= view.y + view.h && view.y <= r.y + r.h }).map(o => o.id).sort()
  assert.deepEqual(fromIndex, linear)
  assert.ok(fromIndex.includes('huge'))
  assert.ok(fromIndex.length < 30)
  assert.deepEqual(index.visible(view).slice(0, 1), [fromIndex.find(id => id !== 'huge') && index.visible(view)[0]])
})

test('undo/redo restores snapshots, coalesces typing and caps history', () => {
  const h = new CanvasHistory()
  const s0: CanvasObject[] = [], s1 = [box('a', 0, 0)], s2 = [box('a', 5, 0)], s3 = [box('a', 9, 0)]
  h.record(s0, undefined, 0)
  h.record(s1, 'text:a', 100)
  h.record(s2, 'text:a', 200)
  assert.equal(h.undo(s3), s1)
  assert.equal(h.undo(s1), s0)
  assert.equal(h.undo(s0), null)
  assert.equal(h.redo(s0), s1)
  assert.equal(h.redo(s1), s3)
  for (let i = 0; i < 300; i++) h.record([], undefined, i)
  let steps = 0
  while (h.undo([])) steps++
  assert.equal(steps, 200)
})

test('SVG export escapes text, draws dead connectors and respects the theme', () => {
  const objects: CanvasObject[] = [
    box('n', 0, 0, 200, 100, { text: '<script>alert(1)</script> & "x"' }),
    { id: 'card', type: 'page', x: 300, y: 0, w: 200, h: 150, pageId: P2 },
    { id: 'k', type: 'connector', from: { id: 'n', x: 0, y: 0 }, to: { id: 'card', x: 0, y: 0 }, route: 'straight', color: 'default', endArrow: true, label: 'liga' },
  ]
  const svg = canvasToSvg(objects, { palette: DARK_PALETTE, card: () => ({ title: 'Lixo', icon: '', excerpt: '', state: 'trash' }) })
  assert.ok(!svg.includes('<script>'))
  assert.match(svg, /&lt;script&gt;/)
  assert.match(svg, /página na lixeira/)
  assert.match(svg, /stroke-dasharray/)
  assert.match(svg, new RegExp(DARK_PALETTE.bg))
  assert.ok(canvasToSvg([], { palette: LIGHT_PALETTE }).startsWith('<svg'))
})
