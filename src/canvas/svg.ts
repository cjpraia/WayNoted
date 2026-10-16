// Exportação SVG pura do quadro (também usada no HTML exportado e na prévia do bloco /Quadro).
import { fontOf, inkColor, isBox, swatch, type BoxObject, type CanvasObject, type CanvasPalette, type ConnectorObject, type StyleProps } from './model.ts'
import { dashFor, roughPolyline, shapePaths, sketchBoxPath } from './sketch.ts'
import { center, connectorGeometry, drawPoints, geometryPolyline, midpointOf, objectBounds, unionRects, type Point, type Rect } from './geometry.ts'
import { lookupOf } from './ops.ts'
import { connectorDead, DEAD_LABEL, pressureScale, wrapText, type CardInfo, NOTE_FONT, SHAPE_FONT, SECTION_FONT, CARD_TITLE_FONT } from './render.ts'

export interface SvgOptions {
  palette: CanvasPalette
  card?: (pageId: string) => CardInfo
  /** Area to export; default = union of all objects + padding. */
  bounds?: Rect
  padding?: number
  /** Include image bytes (data URLs) — off for compact previews. */
  images?: boolean
  /** Link target for cards (HTML export). */
  cardHref?: (pageId: string) => string | null
  /** Fixed output width (preview); default = world units. */
  width?: number
  background?: boolean
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => Math.round(v * 100) / 100
const measure = (size: number) => (s: string) => s.length * size * 0.56

function text(content: string, r: Rect, size: number, color: string, font: string, align: 'left' | 'center' | 'right' = 'left', middle = false, weight = 400): string {
  if (!content) return ''
  const lines = wrapText(measure(size), content, Math.max(10, r.w), `svg${size}`)
  const lh = size * 1.35
  const shown = lines.slice(0, Math.max(1, Math.floor(r.h / lh)))
  if (shown.length < lines.length) shown[shown.length - 1] = shown[shown.length - 1].replace(/.?$/, '…')
  const top = middle ? r.y + (r.h - shown.length * lh) / 2 : r.y
  const x = align === 'center' ? r.x + r.w / 2 : align === 'right' ? r.x + r.w : r.x
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
  return `<text x="${n(x)}" y="${n(top)}" font-family="${esc(font)}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${shown.map((line, i) => `<tspan x="${n(x)}" dy="${i === 0 ? n(size * 1.05) : n(lh)}">${esc(line) || ' '}</tspan>`).join('')}</text>`
}

function boxSvg(o: BoxObject, opts: SvgOptions): string {
  const p = opts.palette, dark = p.dark, font = o.font ? fontOf(o) : p.font
  const transform = o.rotation ? ` transform="rotate(${n(o.rotation)} ${n(o.x + o.w / 2)} ${n(o.y + o.h / 2)})"` : ''
  let body = ''
  switch (o.type) {
    case 'section': {
      const [bg, , stroke] = swatch(o.color, dark)
      body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="12" fill="${bg}" fill-opacity="0.55"${o.sketch ? ' stroke="none"/>' + `<path d="${sketchBoxPath(o, o.sketch)}" fill="none" stroke="${stroke}" stroke-opacity="0.7" stroke-width="${n(o.strokeWidth ?? 2)}" stroke-linecap="round" stroke-linejoin="round"/>` : ` stroke="${stroke}" stroke-opacity="0.7" stroke-width="1.5"/>`}` + text(o.title, { x: o.x + 16, y: o.y + 12, w: o.w - 32, h: SECTION_FONT * 1.4 }, SECTION_FONT, dark ? p.text : swatch(o.color, false)[1], font, 'left', false, 600)
      break
    }
    case 'note': {
      const [bg, fg] = swatch(o.color, dark)
      body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="4" fill="${bg}"/>` + (o.sketch ? `<path d="${sketchBoxPath(o, o.sketch)}" fill="none" stroke="${swatch(o.color, dark)[2]}" stroke-width="${n(o.strokeWidth ?? 1.8)}" stroke-linecap="round" stroke-linejoin="round"/>` : '') + text(o.text, { x: o.x + 14, y: o.y + 12, w: o.w - 28, h: o.h - 24 }, NOTE_FONT, fg, font)
      break
    }
    case 'text': body = text(o.text, o, o.fontSize, o.color === 'default' ? p.text : inkColor(o.color, dark), font, o.align ?? 'left'); break
    case 'shape': {
      const [bg, fg, stroke] = swatch(o.color, dark)
      const width = o.strokeWidth ?? 2
      const paths = shapePaths(o)
      const fill = o.fill === 'solid' ? stroke : o.fill === 'tint' ? bg : 'none'
      const dash = dashFor(o.strokeStyle, width)
      body = (o.sketch && fill !== 'none' ? `<path d="${shapePaths({ ...o, sketch: undefined }).outline}" fill="${fill}" stroke="none"/>` : '')
        + (paths.hatch ? `<path d="${paths.hatch}" fill="none" stroke="${stroke}" stroke-width="${n(Math.max(1, width * 0.6))}" stroke-linecap="round"/>` : '')
        + `<path d="${paths.outline}" fill="${o.sketch ? 'none' : fill}" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : ''}/>`
      const inset = o.shape === 'rect' ? 12 : o.w * 0.18
      body += text(o.text, { x: o.x + inset, y: o.y + 8, w: o.w - inset * 2, h: o.h - 16 }, SHAPE_FONT, o.fill === 'solid' ? '#ffffff' : o.fill === 'tint' ? fg : p.text, font, 'center', true, 500)
      break
    }
    case 'draw': {
      const pts = drawPoints(o), color = inkColor(o.color, dark)
      const pressure = o.points.filter((_, i) => i % 3 === 2)
      const avg = pressure.reduce((a, b) => a + b, 0) / Math.max(1, pressure.length)
      body = pts.length === 1 ? `<circle cx="${n(pts[0].x)}" cy="${n(pts[0].y)}" r="${n(o.size / 2)}" fill="${color}"/>`
        : `<polyline points="${pts.map(q => `${n(q.x)},${n(q.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${n(o.size * pressureScale(avg))}" stroke-linecap="round" stroke-linejoin="round"/>`
      break
    }
    case 'image':
      body = opts.images !== false && (/^data:image\//.test(o.src) || (!!o.src && !/^[a-z][a-z0-9+.-]*:/i.test(o.src))) ? `<image x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" href="${esc(o.src)}" preserveAspectRatio="none"/>`
        : `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="6" fill="${p.selection}"/>` + text(o.name || 'imagem', { x: o.x + 12, y: o.y + 12, w: o.w - 24, h: o.h - 24 }, 13, p.muted, font, 'center', true)
      break
    case 'file':
      body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="8" fill="${p.card}" stroke="${p.border}"/>` + text(`📎 ${o.name}`, { x: o.x + 14, y: o.y + 12, w: o.w - 28, h: 22 }, 14, p.text, font, 'left', false, 500)
      break
    case 'page': case 'database': {
      const info = opts.card?.(o.pageId) ?? { title: '', icon: '', excerpt: '', state: 'missing' as const }
      const title = info.state === 'locked' ? `🔒 ${info.title}` : info.state === 'trash' ? `🗑 ${info.title}` : `${info.icon ? info.icon + ' ' : ''}${info.title}`
      body = `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="10" fill="${p.card}" stroke="${p.border}"/>`
        + text(title, { x: o.x + 16, y: o.y + 14, w: o.w - 32, h: CARD_TITLE_FONT * 1.4 }, CARD_TITLE_FONT, info.state === 'ok' ? p.text : p.muted, font, 'left', false, 600)
        + `<rect x="${n(o.x + 1)}" y="${n(o.y + 42)}" width="${n(o.w - 2)}" height="1" fill="${p.border}"/>`
        + (info.state === 'ok' ? text(info.excerpt, { x: o.x + 16, y: o.y + 54, w: o.w - 32, h: o.h - 66 }, 13, p.muted, font) : '')
      break
    }
  }
  const href = (o.type === 'page' || o.type === 'database') ? opts.cardHref?.(o.pageId) : null
  if (href && body) body = `<a href="${esc(href)}">${body}</a>`
  return body ? `<g data-id="${esc(o.id)}"${transform}${opacity(o)}>${body}</g>` : ''
}

const opacity = (o: StyleProps) => o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''

function arrow(tip: Point, from: Point, color: string) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), s = 12
  return `<polygon points="${n(tip.x)},${n(tip.y)} ${n(tip.x - s * Math.cos(a - 0.45))},${n(tip.y - s * Math.sin(a - 0.45))} ${n(tip.x - s * Math.cos(a + 0.45))},${n(tip.y - s * Math.sin(a + 0.45))}" fill="${color}"/>`
}

function connectorSvg(o: ConnectorObject, opts: SvgOptions, lookup: ReturnType<typeof lookupOf>): string {
  const p = opts.palette
  const g = connectorGeometry(o, lookup)
  const dead = connectorDead(o, lookup, opts.card)
  const color = dead ? p.muted : inkColor(o.color, p.dark)
  const d = g.kind === 'bezier' ? `M${n(g.points[0].x)} ${n(g.points[0].y)} C${g.points.slice(1).map(q => `${n(q.x)} ${n(q.y)}`).join(' ')}` : `M${g.points.map(q => `${n(q.x)} ${n(q.y)}`).join(' L')}`
  const line = geometryPolyline(g)
  const width = o.strokeWidth ?? 2
  const dash = dead ? [7, 6] : dashFor(o.strokeStyle, width)
  let out = `<path d="${o.sketch ? roughPolyline(line, o.sketch, o.id) : d}" fill="none" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.map(n).join(' ')}"` : ''}/>`
  if (o.endArrow) out += arrow(line.at(-1)!, line.at(-2) ?? line[0], color)
  if (o.startArrow) out += arrow(line[0], line[1] ?? line[0], color)
  const label = dead ? (o.label ? `${o.label} · ` : '') + DEAD_LABEL.value : o.label
  if (label) {
    const m = midpointOf(line), w = Math.min(260, label.length * 7.3 + 14)
    out += `<rect x="${n(m.x - w / 2)}" y="${n(m.y - 11)}" width="${n(w)}" height="22" rx="11" fill="${p.bg}" stroke="${p.border}"/>` + text(label, { x: m.x - w / 2 + 7, y: m.y - 9, w: w - 14, h: 18 }, 13, dead ? p.muted : p.text, p.font, 'center', false, 500)
  }
  return `<g data-id="${esc(o.id)}"${opacity(o)}>${out}</g>`
}

/** Standalone SVG document for `objects` (z order preserved; connectors drawn in place). */
export function canvasToSvg(all: readonly CanvasObject[], opts: SvgOptions): string {
  const objects = all.filter(o => !o.hidden)
  const lookup = lookupOf(all)
  const pad = opts.padding ?? 32
  const area = opts.bounds ?? unionRects(objects.map(o => objectBounds(o, lookup))) ?? { x: 0, y: 0, w: 400, h: 300 }
  const box = { x: area.x - pad, y: area.y - pad, w: Math.max(1, area.w + pad * 2), h: Math.max(1, area.h + pad * 2) }
  const width = opts.width ?? Math.round(box.w), height = Math.round(width * box.h / box.w)
  const parts = objects.map(o => isBox(o) ? boxSvg(o, opts) : o.type === 'connector' ? connectorSvg(o, opts, lookup) : '')
  const bg = opts.background === false ? '' : `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="${opts.palette.bg}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" role="img">${bg}${parts.join('')}</svg>`
}

export { center }
