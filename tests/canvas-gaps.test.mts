// Lousa — lacunas fechadas: lista de camadas, laço, estilo à mão em notas/seções, camadas ocultas,
// gestos de pinça/caneta por eventos sintéticos, contraste do tema escuro e conector preso a forma.
import test from 'node:test'
import assert from 'node:assert/strict'
import { contrast, DARK_PALETTE, LIGHT_PALETTE, normalizeCanvas, normalizeObject, swatch, CANVAS_COLORS, type CanvasObject, type ConnectorObject } from '../src/canvas/model.ts'
import { buildLayerTree, descendantIds, flattenLayers, layerLabel, moveLayer } from '../src/canvas/layers.ts'
import { hitTest, lassoSelect, objectBounds, pointInPolygon, segmentsIntersect, connectorEnds, transformObject, translateObject } from '../src/canvas/geometry.ts'
import { SpatialIndex } from '../src/canvas/spatial.ts'
import { createConnector, lookupOf, patchObjects } from '../src/canvas/ops.ts'
import { canvasToSvg } from '../src/canvas/svg.ts'
import { drawScene } from '../src/canvas/render.ts'
import { sketchBoxPath } from '../src/canvas/sketch.ts'
import { samplePressure, wheelIntent } from '../src/canvas/gestures.ts'
import { embedInSvg, sceneFromSvg } from '../src/canvas/scene.ts'
import { createRequire } from 'node:module'

const note = (id: string, x: number, y: number, w = 100, h = 80, extra: Record<string, unknown> = {}) => ({ id, type: 'note', x, y, w, h, text: id, color: 'yellow', ...extra }) as CanvasObject
const section = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, type: 'section', x, y, w, h, title: id, color: 'gray', ...extra }) as CanvasObject
const rect = (id: string, x: number, y: number, w = 120, h = 80) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, text: '', color: 'blue', fill: 'tint' }) as CanvasObject
const ids = (rows: { id: string }[]) => rows.map(r => r.id)

// ---------- camadas ----------

test('layers: tree nests objects inside the smallest containing section, front-most first', () => {
  const objects = [
    section('S', 0, 0, 600, 400), section('S2', 20, 20, 300, 200),
    note('a', 40, 40), note('b', 400, 40), note('out', 900, 900), note('c', 50, 300),
  ]
  const tree = buildLayerTree(objects)
  assert.deepEqual(ids(tree), ['out', 'S'], 'top level: loose objects and outermost sections, front to back')
  const s = tree[1]
  assert.deepEqual(ids(s.children), ['c', 'b', 'S2'], 'children keep reverse Z order')
  assert.deepEqual(ids(s.children[2].children), ['a'], 'a is in the smaller section S2')
  assert.equal(s.children[2].children[0].depth, 2)
  const rows = flattenLayers(tree)
  assert.deepEqual(ids(rows), ['out', 'S', 'c', 'b', 'S2', 'a'])
  assert.deepEqual(ids(flattenLayers(tree, new Set(['S']))), ['out', 'S'], 'collapsed section hides its content')
  assert.deepEqual(descendantIds(tree, 'S').sort(), ['S2', 'a', 'b', 'c'])
  assert.equal(rows.find(r => r.id === 'S')?.hasChildren, true)
})

test('layers: reorder by drag keeps everything else in place and refuses locked or unknown targets', () => {
  const objects = [note('a', 0, 0), note('b', 0, 0), note('c', 0, 0), note('d', 0, 0)]
  const order = (list: CanvasObject[]) => list.map(o => o.id).join('')
  assert.equal(order(moveLayer(objects, 'a', 'd', 'above')), 'bcda', 'above the front-most = last in the array')
  assert.equal(order(moveLayer(objects, 'd', 'a', 'below')), 'dabc', 'below the back-most = first')
  assert.equal(order(moveLayer(objects, 'a', 'c', 'below')), 'bacd')
  assert.equal(order(moveLayer(objects, 'c', 'b', 'above')), 'abcd', 'no-op returns the same order')
  assert.ok(moveLayer(objects, 'a', 'a', 'above') === objects, 'same object')
  assert.ok(moveLayer(objects, 'a', 'zzz', 'above') === objects, 'unknown target')
  const locked = [note('a', 0, 0, 100, 80, { locked: true }), note('b', 0, 0)]
  assert.ok(moveLayer(locked, 'a', 'b', 'above') === locked, 'locked layers do not move')
})

test('layers: label = given name, else text, else card title, else type', () => {
  const type = (x: string) => `T:${x}`
  assert.equal(layerLabel(note('n', 0, 0, 10, 10, { text: '  Olá   mundo ' }), type), 'Olá mundo')
  assert.equal(layerLabel(note('n', 0, 0, 10, 10, { text: '', layerName: 'Meta' }), type), 'Meta')
  assert.equal(layerLabel(note('n', 0, 0, 10, 10, { text: '' }), type), 'T:note')
  assert.equal(layerLabel({ id: 'p', type: 'page', x: 0, y: 0, w: 10, h: 10, pageId: 'x' } as CanvasObject, type, id => id === 'x' ? 'Minha página' : ''), 'Minha página')
  assert.equal(layerLabel({ id: 'p', type: 'page', x: 0, y: 0, w: 10, h: 10, pageId: 'x' } as CanvasObject, type, () => ''), 'T:page')
})

test('layers: name and hidden persist through normalization; junk is dropped', () => {
  const { data } = normalizeCanvas({ objects: [{ ...note('a', 0, 0), layerName: '  Título  ', hidden: true }, { ...note('b', 0, 0), layerName: '   ', hidden: 'sim' }] })
  assert.equal(data.objects[0].layerName, 'Título')
  assert.equal(data.objects[0].hidden, true)
  assert.ok(!('layerName' in data.objects[1]) && !('hidden' in data.objects[1]))
  const conn = normalizeObject({ id: 'c', type: 'connector', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, hidden: true, layerName: 'Seta' }) as ConnectorObject
  assert.equal(conn.hidden, true); assert.equal(conn.layerName, 'Seta')
})

test('hidden layers: not indexed, not hit, not drawn, not exported; connectors to them also leave the export', () => {
  const a = note('a', 0, 0), b = note('b', 300, 0, 100, 80, { hidden: true })
  const conn = createConnector({ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 0 })
  const objects = [a, b, conn]
  const lookup = lookupOf(objects)
  const index = new SpatialIndex().build(objects, lookup)
  assert.ok(!index.visible({ x: -10, y: -10, w: 1000, h: 1000 }).includes('b'), 'hidden is out of the index')
  assert.ok(hitTest(objects, { x: 340, y: 40 }, 4, lookup) === null, 'hidden is not hit')
  const svg = canvasToSvg(objects, { palette: LIGHT_PALETTE })
  assert.ok(svg.includes('data-id="a"') && !svg.includes('data-id="b"'))
  // drawScene não pinta ocultos nem se o chamador os entregar.
  const painted: string[] = []
  const ctx = new Proxy({}, { get: (_t, key) => key === 'measureText' ? () => ({ width: 5 }) : key === 'fillText' ? (text: string) => { painted.push(text) } : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D
  drawScene(ctx, { k: 1, tx: 0, ty: 0, w: 800, h: 600 }, [a, b], { palette: LIGHT_PALETTE, lookup })
  assert.deepEqual(painted, ['a'], 'only the visible note is painted')
})

test('layers: patchObjects toggles hidden/locked on a section together with its content', () => {
  const objects = [section('S', 0, 0, 400, 300), note('a', 20, 40), note('out', 900, 900)]
  const tree = buildLayerTree(objects)
  const set = new Set(['S', ...descendantIds(tree, 'S')])
  const hidden = patchObjects(objects, set, o => ({ ...o, hidden: true }) as CanvasObject)
  assert.deepEqual(hidden.filter(o => o.hidden).map(o => o.id), ['S', 'a'])
})

// ---------- laço ----------

test('lasso: polygon geometry primitives', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true)
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false)
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), true)
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 7 }), false)
})

test('lasso: selects what it crosses or contains, whole sections only, never hidden, rotated boxes and strokes', () => {
  const objects: CanvasObject[] = [
    note('inside', 100, 100, 40, 40),
    note('crossed', 180, 100, 100, 80), // a borda direita do laço atravessa
    note('far', 600, 600),
    note('hid', 120, 120, 40, 40, { hidden: true }),
    section('bigSection', 0, 0, 1000, 1000),
    section('smallSection', 90, 90, 60, 60),
    { id: 'line', type: 'connector', from: { x: 0, y: 130 }, to: { x: 400, y: 130 }, route: 'straight', color: 'default', endArrow: true } as CanvasObject,
    { id: 'ink', type: 'draw', x: 205, y: 300, w: 10, h: 40, points: [0, 0, 0.5, 5, 40, 0.5], color: 'default', size: 3 } as CanvasObject,
    { ...note('turned', 400, 100, 100, 20, { rotation: 90 }) },
  ]
  const lookup = lookupOf(objects)
  // Laço à mão livre: contorno irregular de (80,80) a (230,160) cobrindo "inside", parte de "crossed" e a linha.
  const lasso = [{ x: 80, y: 80 }, { x: 150, y: 70 }, { x: 230, y: 90 }, { x: 240, y: 150 }, { x: 160, y: 170 }, { x: 85, y: 150 }]
  const hit = lassoSelect(objects, lasso, lookup).sort()
  assert.deepEqual(hit, ['crossed', 'inside', 'line', 'smallSection'].sort(), 'big section is not taken by scribbling inside it; hidden stays out')
  assert.deepEqual(lassoSelect(objects, lasso.slice(0, 2), lookup), [], 'two points are not a lasso')
  // Laço desenhado inteiro DENTRO de uma nota grande também a seleciona.
  const tiny = [{ x: 600 + 20, y: 600 + 20 }, { x: 600 + 40, y: 600 + 20 }, { x: 600 + 30, y: 600 + 40 }]
  assert.deepEqual(lassoSelect(objects, tiny, lookup), ['far'])
  // A tinta é atravessada pela borda do laço.
  assert.deepEqual(lassoSelect(objects, [{ x: 190, y: 310 }, { x: 230, y: 310 }, { x: 230, y: 320 }, { x: 190, y: 320 }], lookup), ['ink'])
  // Caixa girada 90°: 100×20 em (400,100) vira 20×100 em torno do centro (450,110): ocupa x 440–460, y 60–160.
  assert.deepEqual(lassoSelect(objects, [{ x: 445, y: 62 }, { x: 455, y: 62 }, { x: 455, y: 70 }, { x: 445, y: 70 }], lookup), ['turned'])
  assert.deepEqual(lassoSelect(objects, [{ x: 405, y: 100 }, { x: 415, y: 100 }, { x: 415, y: 110 }, { x: 405, y: 110 }], lookup), [], 'the rotated box no longer covers its old corner')
  // candidatos restringem a busca (culling pelo índice)
  assert.deepEqual(lassoSelect(objects, lasso, lookup, new Set(['inside'])), ['inside'])
})

// ---------- estilo à mão em notas e seções ----------

test('hand-drawn style applies to notes and sections: stable path, SVG carries it, crisp ones stay rects', () => {
  const n = note('n1', 10, 20, 200, 120, { sketch: 2 }), s = section('s1', 0, 0, 400, 300, { sketch: 3 })
  assert.equal(sketchBoxPath(n, 2), sketchBoxPath(n, 2), 'deterministic (no flicker between frames/exports)')
  assert.notEqual(sketchBoxPath(n, 2), sketchBoxPath(n, 3))
  assert.match(sketchBoxPath(n, 2), /^M/)
  const svg = canvasToSvg([n, s, note('plain', 500, 0), section('plainS', 600, 0, 100, 100)], { palette: LIGHT_PALETTE })
  const group = (id: string) => new RegExp(`<g data-id="${id}"[^>]*>(.*?)</g>`).exec(svg)![1]
  assert.match(group('n1'), /<path d="M[^"]+" fill="none" stroke="#/, 'note outline is a rough path')
  assert.match(group('s1'), /<path d="M[^"]+" fill="none" stroke="#/)
  assert.ok(!group('plain').includes('<path'), 'crisp note has no extra outline path')
  assert.ok(!group('plainS').includes('<path'))
  // sketch/layers sobrevivem à cena embutida (reimportar o SVG).
  const back = sceneFromSvg(embedInSvg(svg, [{ ...n, layerName: 'X' } as CanvasObject, s]))!
  assert.equal((back[0] as { sketch?: number }).sketch, 2); assert.equal(back[0].layerName, 'X')
})

// ---------- gestos: pinça do trackpad e caneta ----------

test('pinch (ctrl+wheel), ⌘+wheel, two-finger pan and shift-wheel are interpreted from wheel events', () => {
  const e = (p: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaX: number; deltaY: number; deltaMode: number }>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, deltaX: 0, deltaY: 0, deltaMode: 0, ...p })
  const pinchOut = wheelIntent(e({ ctrlKey: true, deltaY: -5 }), 800), pinchIn = wheelIntent(e({ ctrlKey: true, deltaY: 5 }), 800)
  assert.equal(pinchOut.kind, 'zoom'); assert.ok(pinchOut.kind === 'zoom' && pinchOut.factor > 1, 'negative delta zooms in')
  assert.ok(pinchIn.kind === 'zoom' && pinchIn.factor < 1)
  assert.ok(pinchOut.kind === 'zoom' && Math.abs(pinchOut.factor - Math.exp(0.05)) < 1e-9, 'trackpad sensitivity 0.01')
  const cmd = wheelIntent(e({ metaKey: true, deltaY: -50 }), 800)
  assert.ok(cmd.kind === 'zoom' && Math.abs(cmd.factor - Math.exp(0.1)) < 1e-9, '⌘+wheel sensitivity 0.002')
  assert.deepEqual(wheelIntent(e({ deltaX: 12, deltaY: -7 }), 800), { kind: 'pan', dx: -12, dy: 7 })
  assert.deepEqual(wheelIntent(e({ shiftKey: true, deltaY: 30 }), 800), { kind: 'pan', dx: -30, dy: 0 }, 'shift turns vertical wheel into horizontal pan')
  assert.deepEqual(wheelIntent(e({ deltaY: 3, deltaMode: 1 }), 800), { kind: 'pan', dx: -0, dy: -48 }, 'line mode')
  assert.deepEqual(wheelIntent(e({ deltaY: 1, deltaMode: 2 }), 800), { kind: 'pan', dx: -0, dy: -800 }, 'page mode')
})

test('pen pressure: only pointerType "pen" reports pressure; mouse and touch draw a uniform stroke', () => {
  assert.equal(samplePressure({ pointerType: 'pen', pressure: 0.8 }), 0.8)
  assert.equal(samplePressure({ pointerType: 'pen', pressure: 0 }), 0.5)
  assert.equal(samplePressure({ pointerType: 'pen', pressure: 4 }), 1)
  assert.equal(samplePressure({ pointerType: 'mouse', pressure: 0.9 }), 0.5)
  assert.equal(samplePressure({ pointerType: 'touch', pressure: 1 }), 0.5)
})

// ---------- modo escuro ----------

test('dark mode: every board colour, overlay and chrome colour stays legible', () => {
  for (const [name, palette] of [['light', LIGHT_PALETTE], ['dark', DARK_PALETTE]] as const) {
    assert.ok(contrast(palette.text, palette.bg) >= 7, `${name}: text on background`)
    assert.ok(contrast(palette.text, palette.card) >= 7, `${name}: text on card`)
    assert.ok(contrast(palette.muted, palette.bg) >= 4.5, `${name}: muted text on background`)
    assert.ok(contrast(palette.muted, palette.card) >= 4.3, `${name}: muted text on card`)
    assert.ok(contrast(palette.accent, palette.bg) >= 3, `${name}: selection accent is visible`)
    assert.ok(contrast('#e5484d', palette.bg) >= 3, `${name}: guides/measures`)
    assert.ok(contrast(palette.border, palette.bg) >= 1.1, `${name}: borders do not vanish`)
    for (const color of CANVAS_COLORS) {
      const [bg, fg, stroke] = swatch(color, palette.dark)
      assert.ok(contrast(fg, bg) >= 4.5, `${name}/${color}: text on fill`)
      assert.ok(contrast(stroke, palette.bg) >= 1.8 || color === 'default', `${name}/${color}: stroke visible on the board (${contrast(stroke, palette.bg).toFixed(2)})`)
      assert.ok(contrast(bg, palette.bg) >= 1.05 || color === 'default' || color === 'gray', `${name}/${color}: fill distinguishable`)
    }
  }
  // texto de seção no tema escuro usa a cor de texto do tema (não a escura do claro)
  const svg = canvasToSvg([section('S', 0, 0, 300, 200)], { palette: DARK_PALETTE })
  assert.ok(svg.includes(`fill="${DARK_PALETTE.bg}"`), 'dark background')
})

// ---------- conector preso a forma ----------

test('connector anchored to a shape follows move, resize and rotation; freezing keeps the last point when the shape goes away', () => {
  const a = rect('A', 0, 0), b = rect('B', 400, 0)
  const conn = createConnector({ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 0 }, true, 'straight')
  let objects: CanvasObject[] = [a, b, conn]
  const ends = () => connectorEnds(conn, lookupOf(objects))
  assert.equal(Math.round(ends().a.x), 120, 'leaves from the right side of A')
  assert.equal(Math.round(ends().b.x), 400, 'arrives at the left side of B')
  // mover B para baixo: a âncora acompanha e passa a sair pelo lado voltado a B
  objects = objects.map(o => o.id === 'B' ? translateObject(o, 0, 500) : o)
  assert.ok(ends().b.y > 400, 'follows B down')
  // redimensionar B: a ponta fica na borda nova
  objects = objects.map(o => o.id === 'B' ? transformObject(o, { x: 400, y: 500, w: 120, h: 80 }, { x: 400, y: 500, w: 240, h: 160 }) : o)
  const resized = objects.find(o => o.id === 'B') as { w: number; h: number }
  assert.equal(resized.w, 240); assert.equal(resized.h, 160)
  const target = objectBounds(resized as CanvasObject, lookupOf(objects))
  const onEdge = (p: { x: number; y: number }) => Math.abs(p.x - target.x) < 1.5 || Math.abs(p.x - (target.x + target.w)) < 1.5 || Math.abs(p.y - target.y) < 1.5 || Math.abs(p.y - (target.y + target.h)) < 1.5
  assert.ok(onEdge(ends().b), 'end sits on the resized shape outline')
  // elipse: âncora no contorno real, não na caixa
  const ellipse = { ...rect('E', 400, 0, 200, 100), shape: 'ellipse' } as CanvasObject
  const c2 = createConnector({ id: 'A', x: 0, y: 0 }, { id: 'E', x: 0, y: 0 }, true, 'straight')
  const e2 = connectorEnds(c2, lookupOf([a, ellipse, c2]))
  const nx = (e2.b.x - 500) / 100, ny = (e2.b.y - 50) / 50
  assert.ok(Math.abs(nx * nx + ny * ny - 1) < 0.02, 'anchor lies on the ellipse outline')
})

// ---------- privacidade: índice de busca do app desktop ----------

test('desktop search index of a board holds only typed board text — never card pages, titles or protected content', () => {
  const { indexBlocks } = createRequire(import.meta.url)('../electron/content-index.cjs')
  const blocks = [{ id: 'cv', type: 'canvas', props: { version: 1, objects: [
    note('n', 0, 0, 100, 80, { text: 'texto do quadro' }),
    { id: 'card', type: 'page', x: 0, y: 0, w: 300, h: 200, pageId: '00000000-0000-4000-8000-0000000000aa' },
    { id: 'hid', type: 'note', x: 0, y: 0, w: 10, h: 10, text: 'oculta', color: 'gray', hidden: true, layerName: 'SEGREDO-NOME-CAMADA' },
  ] }, children: [] }]
  const indexed = JSON.stringify(indexBlocks(blocks))
  assert.ok(indexed.includes('texto do quadro'))
  assert.ok(!indexed.includes('0000000000aa'.toUpperCase()) )
  assert.ok(!indexed.includes('SEGREDO'), 'layer names are not indexed')
})
