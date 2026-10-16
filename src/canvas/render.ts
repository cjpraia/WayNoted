// Renderizador Canvas 2D do quadro (cena e sobreposição de seleção). Usado na tela e na exportação PNG.
// Recebe só os objetos visíveis (culling feito pelo índice espacial) e aplica nível de detalhe por zoom.
import { fontOf, inkColor, isBox, swatch, type BoxObject, type CanvasObject, type CanvasPalette, type ConnectorObject } from './model.ts'
import { dashFor, roughPolyline, shapePaths, sketchBoxPath } from './sketch.ts'
import { center, connectorGeometry, drawPoints, geometryPolyline, handlePoints, midpointOf, ROTATE_OFFSET, type Distance, type Guide, type Lookup, type Point, type Rect } from './geometry.ts'

export interface View { k: number; tx: number; ty: number; w: number; h: number }
export type CardState = 'ok' | 'trash' | 'missing' | 'locked'
export interface CardInfo { title: string; icon: string; excerpt: string; state: CardState; database?: boolean; canvas?: boolean }

export interface RenderOptions {
  palette: CanvasPalette
  lookup: Lookup
  grid?: boolean
  /** Ids drawn elsewhere (DOM cards, text being edited). */
  skip?: Set<string>
  /** Ids whose text is being edited in a DOM overlay (box is drawn, text is not). */
  hideText?: Set<string>
  card?: (pageId: string) => CardInfo
  image?: (src: string) => CanvasImageSource | null
  /** Clears and paints the background (screen); export may pass false for transparency. */
  background?: boolean
}

type Ctx = CanvasRenderingContext2D

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.k + v.tx, y: p.y * v.k + v.ty })
export const toWorld = (v: View, p: Point): Point => ({ x: (p.x - v.tx) / v.k, y: (p.y - v.ty) / v.k })
export const viewRect = (v: View, margin = 0): Rect => ({ x: (-v.tx - margin) / v.k, y: (-v.ty - margin) / v.k, w: (v.w + margin * 2) / v.k, h: (v.h + margin * 2) / v.k })

// ---------- texto ----------

const wrapCache = new Map<string, string[]>()
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number, fontKey: string): string[] {
  const key = fontKey + '|' + Math.round(maxWidth) + '|' + text
  const cached = wrapCache.get(key)
  if (cached) return cached
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/)
    let line = ''
    for (const word of words) {
      const candidate = line + word
      if (line && measure(candidate.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd())
        line = word.trimStart()
        // Palavra maior que a largura: quebra por caracteres.
        while (line && measure(line) > maxWidth && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--
          lines.push(line.slice(0, cut)); line = line.slice(cut)
        }
      } else line = candidate
    }
    lines.push(line.trimEnd())
  }
  if (wrapCache.size > 4000) wrapCache.clear()
  wrapCache.set(key, lines)
  return lines
}

export const NOTE_FONT = 16, SHAPE_FONT = 16, SECTION_FONT = 15, CARD_TITLE_FONT = 15

function textBlock(ctx: Ctx, v: View, text: string, r: Rect, size: number, color: string, palette: CanvasPalette, align: 'left' | 'center' | 'right' = 'left', vAlign: 'top' | 'middle' = 'top', weight = 400, family = palette.font) {
  if (!text) return
  const font = `${weight} ${size}px ${family}`
  ctx.font = font
  const lines = wrapText(s => ctx.measureText(s).width, text, Math.max(10, r.w), font)
  const lineHeight = size * 1.35
  const maxLines = Math.max(1, Math.floor(r.h / lineHeight))
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines && shown.length) shown[shown.length - 1] = shown[shown.length - 1].replace(/.?$/, '…')
  const blockH = shown.length * lineHeight
  let y = vAlign === 'middle' ? r.y + (r.h - blockH) / 2 : r.y
  // Nível de detalhe: texto menor que 4 px na tela vira barras cinzas (barato e legível como "tem texto").
  if (size * v.k < 4) {
    ctx.fillStyle = color; ctx.globalAlpha *= 0.25
    for (const line of shown) { const w = Math.min(r.w, line.length * size * 0.5); const x = align === 'center' ? r.x + (r.w - w) / 2 : align === 'right' ? r.x + r.w - w : r.x; ctx.fillRect(x, y + lineHeight * 0.3, w, size * 0.5); y += lineHeight }
    ctx.globalAlpha /= 0.25
    return
  }
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  const x = align === 'center' ? r.x + r.w / 2 : align === 'right' ? r.x + r.w : r.x
  for (const line of shown) { ctx.fillText(line, x, y + (lineHeight - size) / 2); y += lineHeight }
  ctx.textAlign = 'left'
}

function roundRect(ctx: Ctx, r: Rect, radius: number) {
  const rr = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.beginPath()
  ctx.moveTo(r.x + rr, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr)
  ctx.closePath()
}

function shapePath(ctx: Ctx, o: Extract<BoxObject, { type: 'shape' }>) {
  if (o.shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2); return }
  if (o.shape === 'diamond') { ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y); ctx.lineTo(o.x + o.w, o.y + o.h / 2); ctx.lineTo(o.x + o.w / 2, o.y + o.h); ctx.lineTo(o.x, o.y + o.h / 2); ctx.closePath(); return }
  roundRect(ctx, o, o.radius ?? 8)
}

function formatSize(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB` }

// ---------- objetos ----------

function drawBox(ctx: Ctx, v: View, o: BoxObject, opts: RenderOptions) {
  const p = opts.palette, dark = p.dark
  const hide = opts.hideText?.has(o.id)
  const family = o.font ? fontOf(o) : p.font
  if (o.opacity !== undefined) ctx.globalAlpha = o.opacity
  if (o.rotation) { const c = center(o); ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(o.rotation * Math.PI / 180); ctx.translate(-c.x, -c.y) }
  switch (o.type) {
    case 'section': {
      const [bg, , stroke] = swatch(o.color, dark)
      roundRect(ctx, o, 12)
      ctx.fillStyle = bg; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1
      ctx.strokeStyle = stroke; ctx.lineWidth = (o.sketch ? (o.strokeWidth ?? 2) : 1.5) / Math.max(v.k, 0.4); ctx.globalAlpha = 0.7
      if (o.sketch && typeof Path2D === 'function') { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(new Path2D(sketchBoxPath(o, o.sketch))) } else ctx.stroke()
      ctx.globalAlpha = 1
      if (!hide) textBlock(ctx, v, o.title || '', { x: o.x + 16, y: o.y + 12, w: o.w - 32, h: SECTION_FONT * 1.4 }, SECTION_FONT, dark ? p.text : swatch(o.color, false)[1], p, 'left', 'top', 600)
      break
    }
    case 'note': {
      const [bg, fg] = swatch(o.color, dark)
      if (v.k > 0.3) { ctx.save(); ctx.shadowColor = dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,15,15,0.12)'; ctx.shadowBlur = 8 * v.k; ctx.shadowOffsetY = 2 * v.k }
      roundRect(ctx, o, 4); ctx.fillStyle = bg; ctx.fill()
      if (v.k > 0.3) ctx.restore()
      if (o.sketch && typeof Path2D === 'function') { ctx.strokeStyle = swatch(o.color, dark)[2]; ctx.lineWidth = o.strokeWidth ?? 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(new Path2D(sketchBoxPath(o, o.sketch))) }
      if (!hide) textBlock(ctx, v, o.text, { x: o.x + 14, y: o.y + 12, w: o.w - 28, h: o.h - 24 }, NOTE_FONT, fg, p, 'left', 'top', 400, family)
      break
    }
    case 'text':
      if (!hide) textBlock(ctx, v, o.text, o, o.fontSize, o.color === 'default' ? p.text : inkColor(o.color, dark), p, o.align ?? 'left', 'top', 400, family)
      break
    case 'shape': {
      const [bg, fg, stroke] = swatch(o.color, dark)
      const width = o.strokeWidth ?? 2
      const paths = typeof Path2D === 'function' ? shapePaths(o) : null
      const crisp = () => { shapePath(ctx, o) }
      if (o.fill === 'tint' || o.fill === 'solid') { ctx.fillStyle = o.fill === 'solid' ? stroke : bg; if (paths && !o.sketch) ctx.fill(new Path2D(paths.outline)); else { crisp(); ctx.fill() } }
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      if (paths?.hatch) { ctx.save(); ctx.lineWidth = Math.max(1, width * 0.6); ctx.stroke(new Path2D(paths.hatch)); ctx.restore() }
      ctx.setLineDash(dashFor(o.strokeStyle, width))
      if (paths) ctx.stroke(new Path2D(paths.outline)); else { crisp(); ctx.stroke() }
      ctx.setLineDash([])
      const inset = o.shape === 'rect' ? 12 : o.w * 0.18
      if (!hide) textBlock(ctx, v, o.text, { x: o.x + inset, y: o.y + 8, w: o.w - inset * 2, h: o.h - 16 }, SHAPE_FONT, o.fill === 'solid' ? '#ffffff' : (o.fill === 'none' || o.fill === 'hachure' || o.fill === 'cross' ? p.text : fg), p, 'center', 'middle', 500, family)
      break
    }
    case 'draw': ctx.setLineDash(dashFor(o.strokeStyle, o.size)); drawStroke(ctx, o, inkColor(o.color, dark)); ctx.setLineDash([]); break
    case 'image': {
      const img = opts.image?.(o.src)
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h)
      else { roundRect(ctx, o, 6); ctx.fillStyle = p.selection; ctx.fill(); textBlock(ctx, v, o.name || '🖼', inflateRect(o, -12), 13, p.muted, p, 'center', 'middle') }
      break
    }
    case 'file': {
      roundRect(ctx, o, 8); ctx.fillStyle = p.card; ctx.fill(); ctx.strokeStyle = p.border; ctx.lineWidth = 1; ctx.stroke()
      textBlock(ctx, v, `📎 ${o.name}`, { x: o.x + 14, y: o.y + 12, w: o.w - 28, h: 22 }, 14, p.text, p, 'left', 'top', 500)
      textBlock(ctx, v, formatSize(o.size), { x: o.x + 14, y: o.y + 36, w: o.w - 28, h: 18 }, 12, p.muted, p)
      break
    }
    case 'page': case 'database': drawCardPlaceholder(ctx, v, o, opts); break
  }
  if (o.rotation) ctx.restore()
  if (o.opacity !== undefined) ctx.globalAlpha = 1
}

const inflateRect = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 })

function drawCardPlaceholder(ctx: Ctx, v: View, o: Extract<BoxObject, { type: 'page' | 'database' }>, opts: RenderOptions) {
  const p = opts.palette
  const info = opts.card?.(o.pageId) ?? { title: '', icon: '', excerpt: '', state: 'missing' as const }
  roundRect(ctx, o, 10)
  ctx.fillStyle = p.card; ctx.fill()
  ctx.strokeStyle = p.border; ctx.lineWidth = Math.max(1, 1 / v.k); ctx.stroke()
  const title = info.state === 'locked' ? `🔒 ${info.title}` : info.state === 'trash' ? `🗑 ${info.title}` : `${info.icon ? info.icon + ' ' : ''}${info.title}`
  textBlock(ctx, v, title, { x: o.x + 16, y: o.y + 14, w: o.w - 32, h: CARD_TITLE_FONT * 1.4 }, CARD_TITLE_FONT, info.state === 'ok' ? p.text : p.muted, p, 'left', 'top', 600)
  ctx.fillStyle = p.border; ctx.fillRect(o.x + 1, o.y + 42, o.w - 2, 1)
  if (info.excerpt && info.state === 'ok') textBlock(ctx, v, info.excerpt, { x: o.x + 16, y: o.y + 54, w: o.w - 32, h: o.h - 66 }, 13, p.muted, p)
}

function drawStroke(ctx: Ctx, o: Extract<BoxObject, { type: 'draw' }>, color: string) {
  const points = drawPoints(o)
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (points.length === 1) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, o.size / 2, 0, Math.PI * 2); ctx.fill(); return }
  const pressures: number[] = []
  for (let i = 2; i < o.points.length; i += 3) pressures.push(o.points[i])
  const uniform = pressures.every(v => Math.abs(v - pressures[0]) < 0.02)
  if (uniform) {
    ctx.lineWidth = o.size * pressureScale(pressures[0])
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length - 1; i++) { const m = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }; ctx.quadraticCurveTo(points[i].x, points[i].y, m.x, m.y) }
    ctx.lineTo(points.at(-1)!.x, points.at(-1)!.y); ctx.stroke()
    return
  }
  for (let i = 1; i < points.length; i++) {
    ctx.lineWidth = o.size * pressureScale((pressures[i - 1] + pressures[i]) / 2)
    ctx.beginPath(); ctx.moveTo(points[i - 1].x, points[i - 1].y); ctx.lineTo(points[i].x, points[i].y); ctx.stroke()
  }
}
/** Pressure 0–1 → width factor (mouse reports 0.5 → 1×). */
export const pressureScale = (p: number) => 0.35 + Math.max(0, Math.min(1, p)) * 1.3

function arrowHead(ctx: Ctx, tip: Point, from: Point, size: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - size * Math.cos(a - 0.45), tip.y - size * Math.sin(a - 0.45))
  ctx.lineTo(tip.x - size * Math.cos(a + 0.45), tip.y - size * Math.sin(a + 0.45))
  ctx.closePath(); ctx.fill()
}

/** Whether a connector touches a card whose page is gone (trash/deleted) or a missing object. */
export function connectorDead(o: ConnectorObject, lookup: Lookup, card?: (pageId: string) => CardInfo): boolean {
  for (const end of [o.from, o.to]) {
    if (!end.id) continue
    const target = lookup(end.id)
    if (!target) return true
    if ((target.type === 'page' || target.type === 'database') && card) { const s = card(target.pageId).state; if (s === 'trash' || s === 'missing') return true }
  }
  return false
}

function drawConnector(ctx: Ctx, v: View, o: ConnectorObject, opts: RenderOptions) {
  const p = opts.palette
  const g = connectorGeometry(o, opts.lookup)
  const dead = connectorDead(o, opts.lookup, opts.card)
  const color = dead ? p.muted : inkColor(o.color, p.dark)
  const width = o.strokeWidth ?? 2
  if (o.opacity !== undefined) ctx.globalAlpha = o.opacity
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.setLineDash(dead ? [7, 6] : dashFor(o.strokeStyle, width))
  if (o.sketch && typeof Path2D === 'function') ctx.stroke(new Path2D(roughPolyline(geometryPolyline(g), o.sketch, o.id)))
  else {
    ctx.beginPath()
    ctx.moveTo(g.points[0].x, g.points[0].y)
    if (g.kind === 'bezier') ctx.bezierCurveTo(g.points[1].x, g.points[1].y, g.points[2].x, g.points[2].y, g.points[3].x, g.points[3].y)
    else for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i].x, g.points[i].y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  const line = geometryPolyline(g)
  if (o.endArrow) arrowHead(ctx, line.at(-1)!, line.at(-2) ?? line[0], 10 + width)
  if (o.startArrow) arrowHead(ctx, line[0], line[1] ?? line[0], 10 + width)
  const label = opts.hideText?.has(o.id) ? '' : dead ? (o.label ? `${o.label} · ` : '') + DEAD_LABEL.value : o.label
  if (label) {
    const m = midpointOf(line)
    ctx.font = `500 13px ${p.font}`
    const w = Math.min(260, ctx.measureText(label).width + 14)
    roundRect(ctx, { x: m.x - w / 2, y: m.y - 11, w, h: 22 }, 11)
    ctx.fillStyle = p.bg; ctx.fill(); ctx.strokeStyle = p.border; ctx.lineWidth = 1; ctx.stroke()
    textBlock(ctx, v, label, { x: m.x - w / 2 + 7, y: m.y - 9, w: w - 14, h: 18 }, 13, dead ? p.muted : p.text, p, 'center', 'top', 500, o.font ? fontOf(o) : p.font)
  }
  ctx.globalAlpha = 1
}
/** Localised by the UI ("página na lixeira"). */
export const DEAD_LABEL = { value: 'página na lixeira' }

export function drawGrid(ctx: Ctx, v: View, palette: CanvasPalette, size: number) {
  let step = size
  while (step * v.k < 12) step *= 4
  const r = viewRect(v)
  ctx.fillStyle = palette.grid
  const dot = Math.max(1, 1.4 / v.k)
  const x0 = Math.floor(r.x / step) * step, y0 = Math.floor(r.y / step) * step
  ctx.beginPath()
  for (let x = x0; x <= r.x + r.w; x += step) for (let y = y0; y <= r.y + r.h; y += step) ctx.rect(x - dot / 2, y - dot / 2, dot, dot)
  ctx.fill()
}

/** Paints the visible objects (already culled, in z order). `dpr` scales the backing store. */
export function drawScene(ctx: Ctx, v: View, objects: readonly CanvasObject[], opts: RenderOptions, dpr = 1, gridSize = 24) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (opts.background !== false) { ctx.fillStyle = opts.palette.bg; ctx.fillRect(0, 0, v.w, v.h) } else ctx.clearRect(0, 0, v.w, v.h)
  ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.tx, dpr * v.ty)
  if (opts.grid) drawGrid(ctx, v, opts.palette, gridSize)
  for (const o of objects) {
    if (opts.skip?.has(o.id) || o.hidden) continue
    if (isBox(o)) drawBox(ctx, v, o, opts)
    else if (o.type === 'connector') drawConnector(ctx, v, o, opts)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// ---------- sobreposição (seleção, alças, guias) ----------

export interface Overlay {
  selected: CanvasObject[]
  bounds: Rect | null
  rotation: number
  canRotate: boolean
  showHandles: boolean
  marquee?: Rect | null
  /** Laço de seleção à mão livre (pontos do mundo). */
  lasso?: Point[] | null
  guides?: Guide[]
  hover?: CanvasObject | null
  pendingLine?: [Point, Point] | null
  stroke?: { samples: number[]; color: string; size: number } | null
  eraser?: { at: Point; radius: number } | null
  highlight?: Set<string>
  /** Figma-style gap measurements while dragging. */
  distances?: Distance[]
  /** Live size badge under the selection. */
  sizeBadge?: boolean
  /** Miro-style quick-add handles (world points) around a selected note/shape. */
  quickAdd?: Point[]
}

export function drawOverlay(ctx: Ctx, v: View, overlay: Overlay, opts: RenderOptions, dpr = 1) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, v.w, v.h)
  const accent = opts.palette.accent
  const S = (p: Point) => toScreen(v, p)
  const outline = (o: CanvasObject, color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width
    if (o.type === 'connector') {
      const line = geometryPolyline(connectorGeometry(o, opts.lookup)).map(S)
      ctx.beginPath(); ctx.moveTo(line[0].x, line[0].y); for (const p of line.slice(1)) ctx.lineTo(p.x, p.y); ctx.globalAlpha = 0.35; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1
      return
    }
    const c = center(o)
    const corners = [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }].map(p => S(rotate(p, c, o.rotation ?? 0)))
    ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y); for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke()
  }
  if (overlay.hover && !overlay.selected.some(o => o.id === overlay.hover!.id)) outline(overlay.hover, accent, 1)
  for (const id of overlay.highlight ?? []) { const o = opts.lookup(id); if (o) { ctx.setLineDash([4, 3]); outline(o, accent, 2); ctx.setLineDash([]) } }
  for (const o of overlay.selected) outline(o, accent, 1.5)
  if (overlay.selected.length === 1 && overlay.selected[0].type === 'connector') {
    const g = connectorGeometry(overlay.selected[0], opts.lookup)
    for (const p of [g.ends.a, g.ends.b].map(S)) handle(ctx, p, accent, true)
  } else if (overlay.bounds && overlay.showHandles) {
    const b = overlay.bounds, c = center(b), rot = overlay.rotation
    if (overlay.selected.length > 1) { const tl = S(b), br = S({ x: b.x + b.w, y: b.y + b.h }); ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y) }
    const hp = handlePoints(b)
    for (const key of Object.keys(hp) as (keyof typeof hp)[]) {
      const sp = S(rotate(hp[key], c, rot))
      if ((b.w * v.k < 40 || b.h * v.k < 40) && key.length === 1) continue
      handle(ctx, sp, accent, false)
    }
    if (overlay.canRotate) {
      const top = S(rotate({ x: c.x, y: b.y }, c, rot))
      const knob = S(rotate({ x: c.x, y: b.y - ROTATE_OFFSET / v.k }, c, rot))
      ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(knob.x, knob.y); ctx.stroke()
      handle(ctx, knob, accent, true)
    }
  }
  if (overlay.marquee) {
    const tl = S(overlay.marquee), br = S({ x: overlay.marquee.x + overlay.marquee.w, y: overlay.marquee.y + overlay.marquee.h })
    ctx.fillStyle = opts.palette.selection; ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, br.x - tl.x, br.y - tl.y)
  }
  if (overlay.lasso && overlay.lasso.length > 1) {
    const pts = overlay.lasso.map(S)
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y); ctx.closePath()
    ctx.fillStyle = opts.palette.selection; ctx.fill()
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([])
  }
  ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1
  for (const g of overlay.guides ?? []) {
    const a = S(g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at }), b = S(g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at })
    ctx.beginPath(); ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5); ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5); ctx.stroke()
  }
  const pill = (p: Point, label: string, bg: string) => {
    ctx.font = `600 11px ${opts.palette.font}`
    const w = ctx.measureText(label).width + 10
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.roundRect?.(p.x - w / 2, p.y - 9, w, 18, 4); if (!ctx.roundRect) ctx.rect(p.x - w / 2, p.y - 9, w, 18); ctx.fill()
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p.x, p.y + 0.5); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }
  for (const d of overlay.distances ?? []) {
    const a = S(d.from), b = S(d.to)
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    pill({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, String(Math.round(d.value)), '#e5484d')
  }
  if (overlay.sizeBadge && overlay.bounds && overlay.selected.length) {
    const b = overlay.bounds, bottom = S({ x: b.x + b.w / 2, y: b.y + b.h })
    pill({ x: bottom.x, y: bottom.y + (overlay.quickAdd?.length ? 50 : 18) }, `${Math.round(b.w)} × ${Math.round(b.h)}`, accent)
  }
  for (const q of overlay.quickAdd ?? []) {
    const p = S(q)
    ctx.fillStyle = opts.palette.bg; ctx.strokeStyle = accent; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke()
  }
  if (overlay.pendingLine) {
    const [a, b] = overlay.pendingLine.map(S)
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([])
  }
  if (overlay.stroke && overlay.stroke.samples.length >= 3) {
    const s = overlay.stroke.samples
    ctx.strokeStyle = overlay.stroke.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (let i = 3; i < s.length; i += 3) {
      const a = S({ x: s[i - 3], y: s[i - 2] }), b = S({ x: s[i], y: s[i + 1] })
      ctx.lineWidth = overlay.stroke.size * pressureScale((s[i - 1] + s[i + 2]) / 2) * v.k
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    }
  }
  if (overlay.eraser) {
    const c = S(overlay.eraser.at)
    ctx.strokeStyle = opts.palette.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, overlay.eraser.radius * v.k, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

const rotate = (p: Point, c: Point, deg: number): Point => {
  if (!deg) return p
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a)
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }
}

function handle(ctx: Ctx, p: Point, accent: string, round: boolean) {
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = accent; ctx.lineWidth = 1.5
  ctx.beginPath()
  if (round) ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
  else ctx.rect(Math.round(p.x) - 4.5, Math.round(p.y) - 4.5, 9, 9)
  ctx.fill(); ctx.stroke()
}
