// "Estilo à mão" (inspirado no Excalidraw, implementação própria): traços tremidos determinísticos,
// hachura e hachura cruzada. Gera strings de caminho SVG ("d") usadas tanto no SVG quanto no canvas (Path2D).
import type { BoxObject, FillKind, ShapeObject, StrokeStyle } from './model.ts'
import type { Point } from './geometry.ts'

/** Deterministic PRNG (mulberry32) seeded from the object id: the same object always wobbles the same way. */
export function seeded(id: string): () => number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Roughness in world units for each level (arquiteto, artista, cartunista). */
export const ROUGHNESS: Record<number, number> = { 0: 0, 1: 0.9, 2: 2, 3: 3.6 }
export const SKETCH_LEVELS: { id: 1 | 2 | 3; pt: string; en: string }[] = [{ id: 1, pt: 'Arquiteto', en: 'Architect' }, { id: 2, pt: 'Artista', en: 'Artist' }, { id: 3, pt: 'Cartunista', en: 'Cartoonist' }]

const f = (v: number) => Math.round(v * 10) / 10

/** One rough segment: two slightly different passes (like a pen going over the line twice). */
export function roughLine(a: Point, b: Point, rough: number, rnd: () => number, passes = 2): string {
  if (!rough) return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const r = Math.min(rough, len / 8 + 0.5)
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len
  let d = ''
  for (let pass = 0; pass < passes; pass++) {
    const j = (s: number) => (rnd() - 0.5) * 2 * s
    const s0 = { x: a.x + j(r), y: a.y + j(r) }, e0 = { x: b.x + j(r), y: b.y + j(r) }
    const bow = j(rough * 1.2) + (pass ? 0.4 : -0.4) * rough
    const t = 0.4 + rnd() * 0.2
    const m = { x: a.x + (b.x - a.x) * t + nx * bow, y: a.y + (b.y - a.y) * t + ny * bow }
    d += `M${f(s0.x)} ${f(s0.y)}Q${f(m.x)} ${f(m.y)} ${f(e0.x)} ${f(e0.y)}`
  }
  return d
}

/** Rough closed curve through polygon points (ellipses): Catmull-Rom with radial jitter and a little overshoot. */
function roughLoop(points: Point[], rough: number, rnd: () => number, passes = 2): string {
  let d = ''
  for (let pass = 0; pass < passes; pass++) {
    const pts = points.map(p => ({ x: p.x + (rnd() - 0.5) * rough * 1.6, y: p.y + (rnd() - 0.5) * rough * 1.6 }))
    const n = pts.length, extra = 2
    const at = (i: number) => pts[((i % n) + n) % n]
    d += `M${f(at(0).x)} ${f(at(0).y)}`
    for (let i = 0; i < n + extra - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
      d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`
    }
  }
  return d
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n = 24, start = 0): Point[] {
  return Array.from({ length: n }, (_, i) => { const a = start + (i / n) * Math.PI * 2; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) } })
}

/** Outline polygon of a box shape (local, unrotated). */
export function shapePolygon(o: Pick<ShapeObject, 'shape' | 'x' | 'y' | 'w' | 'h'>): Point[] {
  if (o.shape === 'ellipse') return ellipsePoints(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 32)
  if (o.shape === 'diamond') return [{ x: o.x + o.w / 2, y: o.y }, { x: o.x + o.w, y: o.y + o.h / 2 }, { x: o.x + o.w / 2, y: o.y + o.h }, { x: o.x, y: o.y + o.h / 2 }]
  return [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }]
}

/** Crisp outline path (rect with radius, ellipse, diamond). */
export function crispOutline(o: Pick<ShapeObject, 'shape' | 'x' | 'y' | 'w' | 'h' | 'radius'>): string {
  if (o.shape === 'ellipse') { const rx = o.w / 2, ry = o.h / 2, cx = o.x + rx, cy = o.y + ry; return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z` }
  if (o.shape === 'diamond') return `M${shapePolygon(o).map(p => `${f(p.x)} ${f(p.y)}`).join('L')}Z`
  const r = Math.max(0, Math.min(o.radius ?? 8, o.w / 2, o.h / 2)), { x, y, w, h } = o
  if (!r) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
}

/** Rough outline path for a shape. */
export function roughOutline(o: Pick<ShapeObject, 'id' | 'shape' | 'x' | 'y' | 'w' | 'h'>, level: number): string {
  const rough = ROUGHNESS[level] ?? 0, rnd = seeded(o.id)
  if (o.shape === 'ellipse') return roughLoop(ellipsePoints(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 12, rnd() * Math.PI), rough, rnd)
  const pts = shapePolygon(o)
  return pts.map((p, i) => roughLine(p, pts[(i + 1) % pts.length], rough, rnd)).join('')
}

/** Hachure (−41°) or cross-hatch (−41° and +49°) lines clipped to the polygon. */
export function hatchPath(polygon: Point[], kind: Extract<FillKind, 'hachure' | 'cross'>, gap: number, rough: number, rnd: () => number): string {
  const angles = kind === 'cross' ? [-41, 49] : [-41]
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length, cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length
  let d = ''
  for (const deg of angles) {
    const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
    const rot = (p: Point, s = 1) => ({ x: cx + (p.x - cx) * cos + (p.y - cy) * sin * s, y: cy - (p.x - cx) * sin * s + (p.y - cy) * cos })
    const local = polygon.map(p => rot(p))
    const ys = local.map(p => p.y)
    const y0 = Math.min(...ys), y1 = Math.max(...ys)
    let count = 0
    for (let y = y0 + gap / 2; y < y1 && count < 400; y += gap, count++) {
      const xs: number[] = []
      for (let i = 0; i < local.length; i++) {
        const p = local[i], q = local[(i + 1) % local.length]
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + (y - p.y) / (q.y - p.y) * (q.x - p.x))
      }
      xs.sort((m, n) => m - n)
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const back = (p: Point) => { const dx = p.x - cx, dy = p.y - cy; return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos } }
        d += roughLine(back({ x: xs[i], y }), back({ x: xs[i + 1], y }), rough * 0.6, rnd, rough ? 1 : 1)
      }
    }
  }
  return d
}

/** Dash pattern for a stroke style (scaled by width). */
export function dashFor(style: StrokeStyle | undefined, width: number): number[] {
  if (style === 'dashed') return [width * 4, width * 3]
  if (style === 'dotted') return [0.1, width * 2.2]
  return []
}

/** Rough polyline (connectors/lines). */
export function roughPolyline(points: Point[], level: number, seed: string): string {
  const rough = ROUGHNESS[level] ?? 0, rnd = seeded(seed)
  let d = ''
  for (let i = 1; i < points.length; i++) d += roughLine(points[i - 1], points[i], rough, rnd)
  return d
}

// ---------- cache ----------

const rectCache = new Map<string, string>()
/** Contorno "à mão" de uma caixa retangular (notas adesivas e seções): mesmo gerador das formas, cacheado por geometria. */
export function sketchBoxPath(o: { id: string; x: number; y: number; w: number; h: number }, level: number): string {
  const key = `${o.id}|${f(o.x)}|${f(o.y)}|${f(o.w)}|${f(o.h)}|${level}`
  const hit = rectCache.get(key)
  if (hit) return hit
  const d = roughOutline({ id: o.id + 'b', shape: 'rect', x: o.x, y: o.y, w: o.w, h: o.h }, level)
  if (rectCache.size > 6000) rectCache.clear()
  rectCache.set(key, d)
  return d
}

const cache = new Map<string, { outline: string; hatch: string }>()
/** Outline + hatch paths for a shape, cached by geometry and style. */
export function shapePaths(o: ShapeObject): { outline: string; hatch: string } {
  const key = `${o.id}|${o.shape}|${f(o.x)}|${f(o.y)}|${f(o.w)}|${f(o.h)}|${o.sketch ?? 0}|${o.fill}|${o.radius ?? 8}|${o.strokeWidth ?? 2}`
  const hit = cache.get(key)
  if (hit) return hit
  const level = o.sketch ?? 0
  const outline = level ? roughOutline(o, level) : crispOutline(o)
  const hatch = o.fill === 'hachure' || o.fill === 'cross' ? hatchPath(shapePolygon(o), o.fill, Math.max(7, (o.strokeWidth ?? 2) * 4), ROUGHNESS[level] ?? 0, seeded(o.id + 'h')) : ''
  const value = { outline, hatch }
  if (cache.size > 6000) cache.clear()
  cache.set(key, value)
  return value
}

export type { BoxObject }
