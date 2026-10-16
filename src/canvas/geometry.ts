// Geometria pura do quadro: limites, rotação, âncoras/rotas de conectores, hit-test, alças, snap e alinhamento.
import { isBox, isConnector, MIN_SIZE, rotatable, type BoxObject, type CanvasObject, type ConnectorEnd, type ConnectorObject, type Side } from './model.ts'

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Lookup = (id: string) => CanvasObject | undefined
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
export const containsRect = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
export const containsPoint = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
export function normRect(a: Point, b: Point): Rect { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) } }
export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 })

export function rotatePoint(p: Point, c: Point, degrees: number): Point {
  if (!degrees) return p
  const a = degrees * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** Axis-aligned bounds of a box, including its rotation. */
export function boxBounds(b: BoxObject): Rect {
  const rotation = b.rotation ?? 0
  if (!rotation) return { x: b.x, y: b.y, w: b.w, h: b.h }
  const c = center(b)
  const corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map(p => rotatePoint(p, c, rotation))
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// ---------- conectores ----------

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const NORMAL: Record<string, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }

function sidePoint(b: BoxObject, s: Side): Point {
  const c = center(b)
  const local = s === 'top' ? { x: c.x, y: b.y } : s === 'bottom' ? { x: c.x, y: b.y + b.h } : s === 'left' ? { x: b.x, y: c.y } : { x: b.x + b.w, y: c.y }
  return rotatePoint(local, c, b.rotation ?? 0)
}

/** Side of `b` facing `toward` (in the box's local frame). */
export function facingSide(b: BoxObject, toward: Point): Exclude<Side, 'auto'> {
  const c = center(b)
  const local = rotatePoint(toward, c, -(b.rotation ?? 0))
  const dx = (local.x - c.x) / Math.max(1, b.w / 2), dy = (local.y - c.y) / Math.max(1, b.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

function endTarget(end: ConnectorEnd, lookup: Lookup): BoxObject | undefined {
  if (!end.id) return undefined
  const target = lookup(end.id)
  return target && isBox(target) ? target : undefined
}

export interface ConnectorEnds { a: Point; b: Point; sideA: Exclude<Side, 'auto'> | null; sideB: Exclude<Side, 'auto'> | null; deadA: boolean; deadB: boolean }

/** Resolves both ends; anchored ends follow their objects (missing objects fall back to the stored point). */
export function connectorEnds(c: ConnectorObject, lookup: Lookup): ConnectorEnds {
  const ta = endTarget(c.from, lookup), tb = endTarget(c.to, lookup)
  const rough = (target: BoxObject | undefined, end: ConnectorEnd) => target ? center(target) : { x: end.x, y: end.y }
  const ra = rough(ta, c.from), rb = rough(tb, c.to)
  const resolve = (target: BoxObject | undefined, end: ConnectorEnd, other: Point) => {
    if (!target) return { p: { x: end.x, y: end.y }, side: null }
    const s = end.side && end.side !== 'auto' ? end.side : facingSide(target, other)
    return { p: sidePoint(target, s), side: s as Exclude<Side, 'auto'> }
  }
  const A = resolve(ta, c.from, rb), B = resolve(tb, c.to, ra)
  return { a: A.p, b: B.p, sideA: A.side, sideB: B.side, deadA: !!c.from.id && !ta, deadB: !!c.to.id && !tb }
}

export type ConnectorGeometry = { kind: 'poly'; points: Point[] } | { kind: 'bezier'; points: [Point, Point, Point, Point] }

export function connectorGeometry(c: ConnectorObject, lookup: Lookup): ConnectorGeometry & { ends: ConnectorEnds } {
  const ends = connectorEnds(c, lookup)
  const { a, b, sideA, sideB } = ends
  if (c.route === 'straight') return { kind: 'poly', points: [a, b], ends }
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  if (c.route === 'curve') {
    const d = Math.max(30, Math.min(240, dist / 2.5))
    const dir = (side: Side | null, from: Point, to: Point): Point => {
      if (side) return NORMAL[side]
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1
      return { x: (to.x - from.x) / len, y: (to.y - from.y) / len }
    }
    const na = dir(sideA, a, b), nb = dir(sideB, b, a)
    return { kind: 'bezier', points: [a, { x: a.x + na.x * d, y: a.y + na.y * d }, { x: b.x + nb.x * d, y: b.y + nb.y * d }, b], ends }
  }
  // Ortogonal: saídas perpendiculares de 20 e cotovelos no meio.
  const stub = 20
  const out = (p: Point, side: Side | null, other: Point): Point => side ? { x: p.x + NORMAL[side].x * stub, y: p.y + NORMAL[side].y * stub } : p
  const a1 = out(a, sideA, b), b1 = out(b, sideB, a)
  const horizontal = (s: Side | null, from: Point, to: Point) => s ? s === 'left' || s === 'right' : Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  const ha = horizontal(sideA, a, b), hb = horizontal(sideB, b, a)
  let mid: Point[]
  if (ha && hb) { const mx = (a1.x + b1.x) / 2; mid = [{ x: mx, y: a1.y }, { x: mx, y: b1.y }] }
  else if (!ha && !hb) { const my = (a1.y + b1.y) / 2; mid = [{ x: a1.x, y: my }, { x: b1.x, y: my }] }
  else if (ha) mid = [{ x: b1.x, y: a1.y }]
  else mid = [{ x: a1.x, y: b1.y }]
  const points = dedupe([a, a1, ...mid, b1, b])
  return { kind: 'poly', points, ends }
}

function dedupe(points: Point[]): Point[] { return points.filter((p, i) => i === 0 || Math.abs(p.x - points[i - 1].x) > 0.01 || Math.abs(p.y - points[i - 1].y) > 0.01) }

export function bezierPoint(p: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t
  return { x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x, y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y }
}

/** Polyline approximation (bezier sampled in 24 steps). */
export function geometryPolyline(g: ConnectorGeometry): Point[] {
  if (g.kind === 'poly') return g.points
  return Array.from({ length: 25 }, (_, i) => bezierPoint(g.points, i / 24))
}

/** Point at half the path length (label position). */
export function midpointOf(points: Point[]): Point {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (walked + seg >= total / 2 && seg > 0) { const t = (total / 2 - walked) / seg; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t } }
    walked += seg
  }
  return points[0] ?? { x: 0, y: 0 }
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
export function distToPolyline(p: Point, points: Point[]): number {
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distToSegment(p, points[i - 1], points[i]))
  return points.length === 1 ? Math.hypot(p.x - points[0].x, p.y - points[0].y) : best
}

/** Bounds of any object (connectors: path + label margin). */
export function objectBounds(o: CanvasObject, lookup: Lookup): Rect {
  if (isBox(o)) return boxBounds(o)
  const points = geometryPolyline(connectorGeometry(o, lookup))
  const r = unionRects(points.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 })))!
  return inflate(r, o.label ? 24 : 8)
}

// ---------- hit-test ----------

export function drawPoints(o: Extract<BoxObject, { type: 'draw' }>): Point[] {
  const out: Point[] = []
  for (let i = 0; i + 1 < o.points.length; i += 3) out.push({ x: o.x + o.points[i], y: o.y + o.points[i + 1] })
  return out
}

/** Whether world point `p` hits object `o` (tolerance in world units). */
export function hitObject(o: CanvasObject, p: Point, tol: number, lookup: Lookup): boolean {
  if (o.hidden) return false
  if (isConnector(o)) {
    const g = connectorGeometry(o, lookup)
    const line = geometryPolyline(g)
    if (distToPolyline(p, line) <= tol + 4) return true
    if (o.label) { const m = midpointOf(line); return Math.abs(p.x - m.x) < Math.max(30, o.label.length * 4) && Math.abs(p.y - m.y) < 14 }
    return false
  }
  const c = center(o)
  const local = rotatePoint(p, c, -(o.rotation ?? 0))
  if (!containsPoint(inflate(o, tol), local)) return false
  if (o.type === 'draw') return distToPolyline(p, drawPoints(o)) <= o.size / 2 + tol
  if (o.type === 'section') {
    // Seção: só a moldura e a faixa do título pegam o clique (o interior fica para os filhos e para o laço).
    const inner = inflate(o, -Math.max(tol, 10))
    return !containsPoint(inner, local) || local.y <= o.y + 36
  }
  if (o.type === 'shape' && o.shape !== 'rect' && (o as { fill: string }).fill !== 'none') {
    const nx = (local.x - c.x) / (o.w / 2 + tol), ny = (local.y - c.y) / (o.h / 2 + tol)
    return o.shape === 'ellipse' ? nx * nx + ny * ny <= 1 : Math.abs(nx) + Math.abs(ny) <= 1
  }
  if (o.type === 'shape' && o.fill === 'none') {
    // Forma vazada: o contorno e o texto central.
    const inner = inflate(o, -Math.max(tol, 8))
    return !containsPoint(inner, local) || (!!o.text && Math.abs(local.y - c.y) < 16 && Math.abs(local.x - c.x) < o.w / 3)
  }
  return true
}

/** Topmost hit (objects in z order, last on top). `ids` limits the search (viewport culling). */
export function hitTest(objects: readonly CanvasObject[], p: Point, tol: number, lookup: Lookup, candidates?: Set<string>): CanvasObject | null {
  // Cards and other DOM-backed boxes are above the canvas layer: test them first, then the rest top-down.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if (candidates && !candidates.has(o.id)) continue
      const card = o.type === 'page' || o.type === 'database'
      if ((pass === 0) !== card) continue
      if (hitObject(o, p, tol, lookup)) return o
    }
  }
  return null
}

// ---------- alças e redimensionamento ----------

export function handlePoints(r: Rect): Record<Exclude<Handle, 'rotate'>, Point> {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, x1 = r.x + r.w, y1 = r.y + r.h
  return { nw: { x: r.x, y: r.y }, n: { x: cx, y: r.y }, ne: { x: x1, y: r.y }, e: { x: x1, y: cy }, se: { x: x1, y: y1 }, s: { x: cx, y: y1 }, sw: { x: r.x, y: y1 }, w: { x: r.x, y: cy } }
}
/** Screen distance (px) between the top edge and the rotation handle. */
export const ROTATE_OFFSET = 24
export const HANDLE_RADIUS = 7

/** Handle under `p` for the selection rectangle; `k` is the zoom (handles have a fixed screen size). */
export function handleAt(r: Rect, p: Point, k: number, rotation = 0, canRotate = false): Handle | null {
  const tol = HANDLE_RADIUS / k
  const c = center(r)
  const local = rotatePoint(p, c, -rotation)
  if (canRotate && Math.hypot(local.x - c.x, local.y - (r.y - ROTATE_OFFSET / k)) <= tol * 1.4) return 'rotate'
  const points = handlePoints(r)
  const small = r.w * k < 40 || r.h * k < 40
  for (const key of (small ? ['se', 'nw', 'ne', 'sw'] : ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']) as Exclude<Handle, 'rotate'>[]) {
    const h = points[key]
    if (Math.abs(local.x - h.x) <= tol && Math.abs(local.y - h.y) <= tol) return key
  }
  return null
}

/** New rectangle after dragging `handle` by (dx, dy). Shift keeps the aspect ratio. */
export function resizeRect(r: Rect, handle: Exclude<Handle, 'rotate'>, dx: number, dy: number, keepRatio = false, min = MIN_SIZE, fromCenter = false): Rect {
  if (fromCenter) {
    // ⌥: redimensiona a partir do centro (o lado oposto anda junto).
    const grown = resizeRect(r, handle, dx * 2, dy * 2, keepRatio, min, false)
    const c = center(r)
    return { x: c.x - grown.w / 2, y: c.y - grown.h / 2, w: grown.w, h: grown.h }
  }
  let { x, y, w, h } = r
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.startsWith('n'), south = handle.startsWith('s')
  if (east) w = Math.max(min, r.w + dx)
  if (west) { w = Math.max(min, r.w - dx); x = r.x + r.w - w }
  if (south) h = Math.max(min, r.h + dy)
  if (north) { h = Math.max(min, r.h - dy); y = r.y + r.h - h }
  if (keepRatio && r.w > 0 && r.h > 0) {
    const ratio = r.w / r.h
    if ((east || west) && (north || south)) { if (w / h > ratio) h = w / ratio; else w = h * ratio }
    else if (east || west) h = w / ratio
    else w = h * ratio
    if (west) x = r.x + r.w - w
    if (north) y = r.y + r.h - h
    if (!(north || south)) y = r.y + (r.h - h) / 2
    if (!(east || west)) x = r.x + (r.w - w) / 2
  }
  return { x, y, w, h }
}

/** Maps object `o` from rectangle `from` (selection bounds before) to `to`. */
export function transformObject(o: CanvasObject, from: Rect, to: Rect): CanvasObject {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1
  const mapX = (x: number) => to.x + (x - from.x) * sx, mapY = (y: number) => to.y + (y - from.y) * sy
  if (isConnector(o)) {
    const end = (e: ConnectorEnd) => ({ ...e, x: mapX(e.x), y: mapY(e.y) })
    return { ...o, from: end(o.from), to: end(o.to) }
  }
  const next = { ...o, x: mapX(o.x), y: mapY(o.y), w: Math.max(o.type === 'draw' ? 1 : MIN_SIZE, o.w * sx), h: Math.max(o.type === 'draw' ? 1 : MIN_SIZE, o.h * sy) } as BoxObject
  if (next.type === 'draw' && o.type === 'draw') next.points = o.points.map((v, i) => i % 3 === 0 ? v * sx : i % 3 === 1 ? v * sy : v)
  if (next.type === 'text' && o.type === 'text' && Math.abs(sx - sy) < 1e-6 && sx !== 1) next.fontSize = Math.max(6, Math.min(400, o.fontSize * sx))
  return next
}

export function translateObject(o: CanvasObject, dx: number, dy: number): CanvasObject {
  if (isConnector(o)) return { ...o, from: { ...o.from, x: o.from.x + dx, y: o.from.y + dy }, to: { ...o.to, x: o.to.x + dx, y: o.to.y + dy } }
  return { ...o, x: o.x + dx, y: o.y + dy }
}

/** Rotation in degrees for dragging the rotate handle around `c` (shift snaps to 15°). */
export function rotationFor(c: Point, p: Point, snap = false): number {
  let deg = Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI + 90
  if (snap) deg = Math.round(deg / 15) * 15
  deg = ((deg % 360) + 360) % 360
  return deg > 180 ? deg - 360 : deg
}
export { rotatable }

// ---------- snap e guias ----------

export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

/** Snaps `moving` to edges/centres of `others` within `threshold`; returns the correction and guides. */
export function snapRect(moving: Rect, others: readonly Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w], ys = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]
  let bestX: { d: number; at: number } | null = null, bestY: { d: number; at: number } | null = null
  for (const r of others) {
    const ox = [r.x, r.x + r.w / 2, r.x + r.w], oy = [r.y, r.y + r.h / 2, r.y + r.h]
    for (const a of xs) for (const b of ox) { const d = b - a; if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b } }
    for (const a of ys) for (const b of oy) { const d = b - a; if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b } }
  }
  const dx = bestX?.d ?? 0, dy = bestY?.d ?? 0
  const snapped = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h }
  const guides: Guide[] = []
  const near = (v: number, w: number) => Math.abs(v - w) < 0.5
  if (bestX) {
    const at = bestX.at
    const hits = others.filter(r => [r.x, r.x + r.w / 2, r.x + r.w].some(v => near(v, at)))
    const ys2 = [snapped.y, snapped.y + snapped.h, ...hits.flatMap(r => [r.y, r.y + r.h])]
    guides.push({ axis: 'x', at, from: Math.min(...ys2), to: Math.max(...ys2) })
  }
  if (bestY) {
    const at = bestY.at
    const hits = others.filter(r => [r.y, r.y + r.h / 2, r.y + r.h].some(v => near(v, at)))
    const xs2 = [snapped.x, snapped.x + snapped.w, ...hits.flatMap(r => [r.x, r.x + r.w])]
    guides.push({ axis: 'y', at, from: Math.min(...xs2), to: Math.max(...xs2) })
  }
  return { dx, dy, guides }
}

export interface Distance { from: Point; to: Point; value: number }

/** Gaps (Figma-style red measurements) from `moving` to the nearest neighbour on each side that overlaps on the other axis. */
export function nearestDistances(moving: Rect, others: readonly Rect[], max = 600): Distance[] {
  const best: Record<'l' | 'r' | 't' | 'b', Distance | null> = { l: null, r: null, t: null, b: null }
  const cy = (a: Rect, b: Rect) => (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2
  const cx = (a: Rect, b: Rect) => (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2
  for (const o of others) {
    const overlapY = o.y < moving.y + moving.h && moving.y < o.y + o.h, overlapX = o.x < moving.x + moving.w && moving.x < o.x + o.w
    if (overlapY) {
      const left = moving.x - (o.x + o.w), right = o.x - (moving.x + moving.w)
      if (left >= 0 && left <= max && (!best.l || left < best.l.value)) { const y = cy(moving, o); best.l = { from: { x: o.x + o.w, y }, to: { x: moving.x, y }, value: left } }
      if (right >= 0 && right <= max && (!best.r || right < best.r.value)) { const y = cy(moving, o); best.r = { from: { x: moving.x + moving.w, y }, to: { x: o.x, y }, value: right } }
    }
    if (overlapX) {
      const top = moving.y - (o.y + o.h), bottom = o.y - (moving.y + moving.h)
      if (top >= 0 && top <= max && (!best.t || top < best.t.value)) { const x = cx(moving, o); best.t = { from: { x, y: o.y + o.h }, to: { x, y: moving.y }, value: top } }
      if (bottom >= 0 && bottom <= max && (!best.b || bottom < best.b.value)) { const x = cx(moving, o); best.b = { from: { x, y: moving.y + moving.h }, to: { x, y: o.y }, value: bottom } }
    }
  }
  return Object.values(best).filter((d): d is Distance => !!d && d.value > 0.5)
}

export const snapToGrid = (v: number, size: number) => Math.round(v / size) * size

// ---------- alinhar e distribuir ----------

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Offsets (dx, dy) per id that align the given rectangles. */
export function alignOffsets(items: { id: string; r: Rect }[], mode: Align): Map<string, Point> {
  const out = new Map<string, Point>()
  const all = unionRects(items.map(i => i.r))
  if (!all || items.length < 2) return out
  for (const { id, r } of items) {
    const dx = mode === 'left' ? all.x - r.x : mode === 'right' ? all.x + all.w - (r.x + r.w) : mode === 'hcenter' ? all.x + all.w / 2 - (r.x + r.w / 2) : 0
    const dy = mode === 'top' ? all.y - r.y : mode === 'bottom' ? all.y + all.h - (r.y + r.h) : mode === 'vcenter' ? all.y + all.h / 2 - (r.y + r.h / 2) : 0
    out.set(id, { x: dx, y: dy })
  }
  return out
}

/** Equal gaps between rectangles along an axis (first and last stay put). */
export function distributeOffsets(items: { id: string; r: Rect }[], axis: 'x' | 'y'): Map<string, Point> {
  const out = new Map<string, Point>()
  if (items.length < 3) return out
  const key = axis === 'x' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h'
  const sorted = [...items].sort((a, b) => a.r[key] - b.r[key])
  const start = sorted[0].r[key], end = Math.max(...sorted.map(i => i.r[key] + i.r[size]))
  const total = sorted.reduce((sum, i) => sum + i.r[size], 0)
  const gap = (end - start - total) / (sorted.length - 1)
  let cursor = start
  for (const item of sorted) {
    const delta = cursor - item.r[key]
    out.set(item.id, axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta })
    cursor += item.r[size] + gap
  }
  return out
}

/** Objects fully inside a section move with it. */
export function sectionMembers(section: BoxObject, objects: readonly CanvasObject[], lookup: Lookup): string[] {
  const area = boxBounds(section)
  return objects.filter(o => o.id !== section.id && containsRect(area, objectBounds(o, lookup)) && !(o.type === 'section' && o.w * o.h >= section.w * section.h)).map(o => o.id)
}

export { SIDES }

// ---------- laço (seleção à mão livre) ----------

/** Ponto dentro do polígono (regra par-ímpar). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Os dois polígonos/polilinhas se tocam: alguma aresta cruza ou um contém pontos do outro. */
function touches(lasso: readonly Point[], shape: readonly Point[], closed: boolean): boolean {
  if (shape.some(p => pointInPolygon(p, lasso))) return true
  const edges = closed ? shape.length : shape.length - 1
  for (let i = 0; i < edges; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length]
    for (let j = 0; j < lasso.length; j++) if (segmentsIntersect(a, b, lasso[j], lasso[(j + 1) % lasso.length])) return true
  }
  // Laço inteiramente dentro da caixa (desenhado dentro de um retângulo grande).
  return closed && pointInPolygon(lasso[0], shape)
}

/** Contorno em coordenadas do mundo de um objeto de caixa (com rotação). */
export function boxCorners(o: BoxObject): Point[] {
  const c = center(o), r = o.rotation ?? 0
  return [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }].map(p => rotatePoint(p, c, r))
}

/**
 * Ids selecionados pelo laço: o que o polígono atravessa ou contém. Seções só entram se estiverem inteiras dentro
 * (como no retângulo de seleção), para não pegar a moldura inteira ao riscar dentro dela. Ocultos ficam de fora.
 */
export function lassoSelect(objects: readonly CanvasObject[], polygon: readonly Point[], lookup: Lookup, candidates?: Set<string>): string[] {
  if (polygon.length < 3) return []
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y)
  const box: Rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  const out: string[] = []
  for (const o of objects) {
    if (o.hidden || (candidates && !candidates.has(o.id))) continue
    if (!rectsIntersect(objectBounds(o, lookup), box)) continue
    if (isConnector(o)) { if (touches(polygon, geometryPolyline(connectorGeometry(o, lookup)), false)) out.push(o.id); continue }
    if (o.type === 'draw') { if (touches(polygon, drawPoints(o), false)) out.push(o.id); continue }
    const corners = boxCorners(o)
    if (o.type === 'section') { if (corners.every(p => pointInPolygon(p, polygon))) out.push(o.id); continue }
    if (touches(polygon, corners, true)) out.push(o.id)
  }
  return out
}
