// Lousa: desempenho com 2.000 objetos (índice, culling, hit-test, desenho, SVG, normalização).
// Os tetos são folgados (máquinas lentas/CI); os números medidos aparecem no relatório (t.diagnostic).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCanvas, type CanvasObject, LIGHT_PALETTE } from '../src/canvas/model.ts'
import { SpatialIndex } from '../src/canvas/spatial.ts'
import { hitTest } from '../src/canvas/geometry.ts'
import { lookupOf } from '../src/canvas/ops.ts'
import { drawScene, viewRect, type View } from '../src/canvas/render.ts'
import { canvasToSvg } from '../src/canvas/svg.ts'

function board(n: number): CanvasObject[] {
  const out: CanvasObject[] = []
  for (let i = 0; i < n; i++) {
    const x = (i % 50) * 260, y = Math.floor(i / 50) * 240, k = i % 10
    if (k < 5) out.push({ id: `n${i}`, type: 'note', x, y, w: 200, h: 180, text: `Nota ${i} com texto que quebra em várias linhas no post-it`, color: 'yellow' })
    else if (k < 8) out.push({ id: `s${i}`, type: 'shape', shape: (['rect', 'ellipse', 'diamond'] as const)[k - 5], x, y, w: 200, h: 140, text: `Forma ${i}`, color: 'blue', fill: i % 20 === 7 ? 'hachure' : 'tint', ...(i % 30 === 6 ? { sketch: 2 as const } : {}) })
    else if (k === 8) out.push({ id: `c${i}`, type: 'connector', from: { id: `n${i - 8}`, x: 0, y: 0 }, to: { id: `s${i - 3}`, x: 0, y: 0 }, route: 'curve', color: 'default', endArrow: true })
    else out.push({ id: `p${i}`, type: 'page', x, y, w: 220, h: 200, pageId: '00000000-0000-4000-8000-000000000001' })
  }
  return out
}

/** Minimal 2D context stub: counts calls; measureText approximates width. */
function stubContext() {
  let calls = 0
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 7 })
      if (prop in target) return target[prop as string]
      return () => { calls++ }
    },
    set(target, prop, value) { target[prop as string] = value; return true },
  }
  return { ctx: new Proxy({ globalAlpha: 1 } as Record<string, unknown>, handler) as unknown as CanvasRenderingContext2D, calls: () => calls }
}

const time = (fn: () => void, runs = 5) => { fn(); const t0 = performance.now(); for (let i = 0; i < runs; i++) fn(); return (performance.now() - t0) / runs }

test('2,000 objects: index, culling, hit-test, drawing and export stay within frame budgets', (t) => {
  const objects = board(2000)
  const lookup = lookupOf(objects)
  const index = new SpatialIndex()
  const build = time(() => index.build(objects, lookup))
  const fit: View = { k: 0.07, tx: 20, ty: 20, w: 1150, h: 786 }
  const close: View = { k: 1, tx: -3000, ty: -2000, w: 1150, h: 786 }
  const queryAll = time(() => index.visible(viewRect(fit, 80)), 20)
  const queryClose = time(() => index.visible(viewRect(close, 80)), 50)
  const visibleClose = index.visible(viewRect(close, 80)).map(id => lookup(id)!)
  const visibleAll = index.visible(viewRect(fit, 80)).map(id => lookup(id)!)
  const hits = time(() => { for (let i = 0; i < 100; i++) { const p = { x: 3000 + i * 5, y: 2000 + i * 3 }; hitTest(objects, p, 4, lookup, index.query({ x: p.x - 24, y: p.y - 24, w: 48, h: 48 })) } })
  const { ctx, calls } = stubContext()
  const drawClose = time(() => drawScene(ctx, close, visibleClose, { palette: LIGHT_PALETTE, lookup, grid: true }))
  const drawAll = time(() => drawScene(ctx, fit, visibleAll, { palette: LIGHT_PALETTE, lookup, grid: true }))
  const svg = time(() => canvasToSvg(objects, { palette: LIGHT_PALETTE }), 2)
  const normalize = time(() => normalizeCanvas({ objects }), 3)
  t.diagnostic(`build ${build.toFixed(2)} ms · cull(fit, ${visibleAll.length}) ${queryAll.toFixed(2)} ms · cull(100%, ${visibleClose.length}) ${queryClose.toFixed(3)} ms · 100 hit-tests ${hits.toFixed(2)} ms · draw 100% ${drawClose.toFixed(2)} ms · draw fit ${drawAll.toFixed(2)} ms (${calls()} ctx calls) · SVG ${svg.toFixed(1)} ms · normalize ${normalize.toFixed(1)} ms`)
  assert.equal(visibleAll.length, 2000)
  assert.ok(visibleClose.length < 80, `culling keeps the close-up small (${visibleClose.length})`)
  assert.ok(build < 60, `index build ${build.toFixed(1)} ms`)
  assert.ok(queryClose < 2, `viewport query ${queryClose.toFixed(2)} ms`)
  assert.ok(hits < 20, `100 hit-tests ${hits.toFixed(1)} ms`)
  assert.ok(drawClose < 8, `draw close-up ${drawClose.toFixed(1)} ms`)
  assert.ok(drawAll < 60, `draw all 2,000 ${drawAll.toFixed(1)} ms`)
  assert.ok(svg < 1500, `SVG export ${svg.toFixed(0)} ms`)
  assert.ok(normalize < 200, `normalize ${normalize.toFixed(0)} ms`)
})
