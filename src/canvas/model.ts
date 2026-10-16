// Lousa (docs/USAGE.md): modelo de dados, normalização tolerante e envelope do documento.
// Puro (sem React, sem store, sem DOM) — roda no navegador, no Electron e nos testes.

export const CANVAS_VERSION = 1
export const CANVAS_BLOCK = 'canvas'
export const MAX_OBJECTS = 5000
export const GRID_SIZE = 24
export const MIN_SIZE = 8
export const MAX_COORD = 1_000_000
export const MAX_FILE_BYTES = 8 * 1024 * 1024

export type CanvasColor = 'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
export const CANVAS_COLORS: readonly CanvasColor[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
export const NOTE_COLORS: readonly CanvasColor[] = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'gray']
export type ShapeKind = 'rect' | 'ellipse' | 'diamond'
export type Side = 'auto' | 'top' | 'right' | 'bottom' | 'left'
export type Route = 'straight' | 'curve' | 'orthogonal'

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type FontKind = 'sans' | 'hand' | 'mono'
/** Optional style shared by boxes and connectors (absent = default: opaque, solid 2 px, crisp, sans). */
export interface StyleProps { opacity?: number; strokeStyle?: Exclude<StrokeStyle, 'solid'>; strokeWidth?: number; /** "Estilo à mão": 1 arquiteto · 2 artista · 3 cartunista. */ sketch?: 1 | 2 | 3; font?: Exclude<FontKind, 'sans'>
  /** Lista de camadas: nome próprio e visibilidade (oculto = não desenha, não seleciona, não exporta). */
  layerName?: string; hidden?: boolean }
export interface BoxBase extends StyleProps { id: string; x: number; y: number; w: number; h: number; rotation?: number; locked?: boolean; groupId?: string }
export interface PageCardObject extends BoxBase { type: 'page'; pageId: string }
export interface DatabaseCardObject extends BoxBase { type: 'database'; pageId: string }
export interface NoteObject extends BoxBase { type: 'note'; text: string; color: CanvasColor }
export interface TextObject extends BoxBase { type: 'text'; text: string; color: CanvasColor; fontSize: number; align?: 'left' | 'center' | 'right' }
export type FillKind = 'tint' | 'solid' | 'none' | 'hachure' | 'cross'
export interface ShapeObject extends BoxBase { type: 'shape'; shape: ShapeKind; text: string; color: CanvasColor; fill: FillKind; /** Corner radius (rectangles). */ radius?: number }
export interface DrawObject extends BoxBase { type: 'draw'; points: number[]; color: CanvasColor; size: number }
export interface ImageObject extends BoxBase { type: 'image'; src: string; name: string }
export interface FileObject extends BoxBase { type: 'file'; data: string; name: string; size: number; mime: string }
export interface SectionObject extends BoxBase { type: 'section'; title: string; color: CanvasColor }
export interface ConnectorEnd { id?: string; side?: Side; x: number; y: number }
export interface ConnectorObject extends StyleProps { id: string; type: 'connector'; from: ConnectorEnd; to: ConnectorEnd; route: Route; label?: string; color: CanvasColor; startArrow?: boolean; endArrow?: boolean; locked?: boolean; groupId?: string }

export type BoxObject = PageCardObject | DatabaseCardObject | NoteObject | TextObject | ShapeObject | DrawObject | ImageObject | FileObject | SectionObject
export type CanvasObject = BoxObject | ConnectorObject
export type CanvasObjectType = CanvasObject['type']
export const BOX_TYPES: readonly string[] = ['page', 'database', 'note', 'text', 'shape', 'draw', 'image', 'file', 'section']

export interface CanvasData { version: number; objects: CanvasObject[]; grid?: boolean; snap?: boolean }
/** Marcador gravado no meta da página (o conteúdo fica no documento). */
export interface CanvasPageInfo { version: number }

export const isBox = (object: CanvasObject): object is BoxObject => object.type !== 'connector'
export const isConnector = (object: CanvasObject): object is ConnectorObject => object.type === 'connector'
export const isCard = (object: CanvasObject): object is PageCardObject | DatabaseCardObject => object.type === 'page' || object.type === 'database'
export const rotatable = (object: CanvasObject) => object.type === 'shape' || object.type === 'note' || object.type === 'text' || object.type === 'image'
export const hasText = (object: CanvasObject) => object.type === 'note' || object.type === 'text' || object.type === 'shape' || object.type === 'section' || object.type === 'connector'

export function emptyCanvas(): CanvasData { return { version: CANVAS_VERSION, objects: [], grid: true, snap: true } }
export const newObjectId = () => globalThis.crypto.randomUUID()

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, fallback: number, min = -MAX_COORD, max = MAX_COORD) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
const str = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback
const color = (v: unknown, fallback: CanvasColor): CanvasColor => CANVAS_COLORS.includes(v as CanvasColor) ? v as CanvasColor : fallback
const side = (v: unknown): Side | undefined => ['auto', 'top', 'right', 'bottom', 'left'].includes(v as string) ? v as Side : undefined

/** Default sizes (world units) for newly created objects. */
export const DEFAULT_SIZE: Record<string, [number, number]> = {
  page: [340, 260], database: [600, 380], note: [200, 200], text: [240, 40], shape: [180, 120], image: [320, 240], file: [240, 64], section: [640, 420], draw: [1, 1],
}

function normalizeEnd(raw: unknown): ConnectorEnd {
  const end = isObj(raw) ? raw : {}
  const out: ConnectorEnd = { x: num(end.x, 0), y: num(end.y, 0) }
  if (typeof end.id === 'string' && end.id) out.id = end.id
  const s = side(end.side)
  if (s && s !== 'auto') out.side = s
  return out
}

function normalizeStyle(raw: Record<string, unknown>, out: Record<string, unknown>) {
  if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) && raw.opacity < 1) out.opacity = Math.max(0.1, Math.round(raw.opacity * 100) / 100)
  // `dashed: true` (formato inicial) vira strokeStyle.
  const stroke = raw.strokeStyle ?? (raw.dashed === true ? 'dashed' : undefined)
  if (stroke === 'dashed' || stroke === 'dotted') out.strokeStyle = stroke
  if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth) && raw.strokeWidth !== 2) out.strokeWidth = Math.max(0.5, Math.min(24, raw.strokeWidth))
  if (raw.sketch === 1 || raw.sketch === 2 || raw.sketch === 3) out.sketch = raw.sketch
  if (raw.font === 'hand' || raw.font === 'mono') out.font = raw.font
  if (typeof raw.layerName === 'string' && raw.layerName.trim()) out.layerName = raw.layerName.trim().slice(0, 120)
  if (raw.hidden === true) out.hidden = true
}

/** One object, or null if irreparable. Unknown types are kept untouched (forward compatibility). */
export function normalizeObject(raw: unknown): CanvasObject | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.type !== 'string') return null
  const base: Record<string, unknown> = { id: raw.id }
  if (raw.locked === true) base.locked = true
  if (typeof raw.groupId === 'string' && raw.groupId) base.groupId = raw.groupId
  if (raw.type === 'connector') {
    const out: ConnectorObject = { ...(base as { id: string }), type: 'connector', from: normalizeEnd(raw.from), to: normalizeEnd(raw.to),
      route: ['straight', 'curve', 'orthogonal'].includes(raw.route as string) ? raw.route as Route : 'curve', color: color(raw.color, 'default') }
    normalizeStyle(raw, out as unknown as Record<string, unknown>)
    if (typeof raw.label === 'string' && raw.label) out.label = raw.label
    if (raw.startArrow === true) out.startArrow = true
    if (raw.endArrow !== false) out.endArrow = true
    if (out.from.id && out.from.id === out.to.id) delete out.to.id
    return out
  }
  if (!BOX_TYPES.includes(raw.type)) return { ...(raw as object) } as unknown as CanvasObject
  const [dw, dh] = DEFAULT_SIZE[raw.type] ?? [200, 200]
  const box = { ...base, type: raw.type, x: num(raw.x, 0), y: num(raw.y, 0), w: num(raw.w, dw, raw.type === 'draw' ? 1 : MIN_SIZE, MAX_COORD), h: num(raw.h, dh, raw.type === 'draw' ? 1 : MIN_SIZE, MAX_COORD) } as Record<string, unknown>
  normalizeStyle(raw, box)
  const rotation = num(raw.rotation, 0, -360, 360)
  if (rotation && rotatable(box as unknown as CanvasObject)) box.rotation = rotation
  switch (raw.type) {
    case 'page': case 'database':
      if (typeof raw.pageId !== 'string' || !raw.pageId) return null
      box.pageId = raw.pageId; break
    case 'note': box.text = str(raw.text); box.color = color(raw.color, 'yellow'); break
    case 'text': box.text = str(raw.text); box.color = color(raw.color, 'default'); box.fontSize = num(raw.fontSize, 20, 6, 400)
      if (raw.align === 'center' || raw.align === 'right') box.align = raw.align; break
    case 'shape': box.shape = ['rect', 'ellipse', 'diamond'].includes(raw.shape as string) ? raw.shape : 'rect'; box.text = str(raw.text); box.color = color(raw.color, 'blue')
      box.fill = ['solid', 'none', 'hachure', 'cross'].includes(raw.fill as string) ? raw.fill : 'tint'
      if (typeof raw.radius === 'number' && Number.isFinite(raw.radius) && raw.radius !== 8) box.radius = Math.max(0, Math.min(200, raw.radius)); break
    case 'draw': {
      const points = Array.isArray(raw.points) ? raw.points.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
      if (points.length < 3) return null
      box.points = points.slice(0, points.length - points.length % 3); box.color = color(raw.color, 'default'); box.size = num(raw.size, 3, 0.5, 80); break
    }
    case 'image': if (typeof raw.src !== 'string' || !raw.src) return null
      box.src = raw.src; box.name = str(raw.name); break
    case 'file': box.data = str(raw.data); box.name = str(raw.name, 'arquivo'); box.size = num(raw.size, 0, 0, Number.MAX_SAFE_INTEGER); box.mime = str(raw.mime, 'application/octet-stream'); break
    case 'section': box.title = str(raw.title); box.color = color(raw.color, 'gray'); break
  }
  return box as unknown as CanvasObject
}

/** Tolerant: repairs what it can, reports how many objects were changed or dropped, never throws. */
export function normalizeCanvas(raw: unknown): { data: CanvasData; repaired: number } {
  const input = isObj(raw) ? raw : {}
  const list = Array.isArray(input.objects) ? input.objects : []
  const seen = new Set<string>()
  const objects: CanvasObject[] = []
  let repaired = 0
  for (const item of list) {
    const object = normalizeObject(item)
    if (!object) { repaired++; continue }
    if (seen.has(object.id)) { object.id = newObjectId(); repaired++ }
    seen.add(object.id)
    objects.push(object)
  }
  const data: CanvasData = { version: CANVAS_VERSION, objects }
  data.grid = input.grid !== false
  data.snap = input.snap !== false
  return { data, repaired }
}

// ---------- envelope do documento ----------

export interface CanvasDocument { data: CanvasData; blockId: string; preserved: unknown[]; repaired: number }

/** Reads `docs/<id>.json`. Blocks that are not the canvas envelope are preserved (never dropped). */
export function readCanvasDocument(blocks: unknown[] | null | undefined): CanvasDocument {
  const list = Array.isArray(blocks) ? blocks : []
  const index = list.findIndex(block => isObj(block) && block.type === CANVAS_BLOCK)
  const envelope = index >= 0 ? list[index] as Record<string, unknown> : null
  const { data, repaired } = normalizeCanvas(envelope?.props)
  return { data, blockId: envelope && typeof envelope.id === 'string' && envelope.id ? envelope.id : newObjectId(), preserved: list.filter((_, i) => i !== index), repaired }
}

export function canvasDocument(data: CanvasData, blockId: string, preserved: unknown[] = []): unknown[] {
  return [{ id: blockId, type: CANVAS_BLOCK, props: data, children: [] }, ...preserved]
}

export function isCanvasBlock(block: unknown): block is { id?: string; type: 'canvas'; props: CanvasData } {
  return isObj(block) && block.type === CANVAS_BLOCK
}

/** Normalized marker for `Page.canvas` (meta). Invalid values → undefined (dropped, never fatal). */
export function normalizeCanvasPageInfo(value: unknown): CanvasPageInfo | undefined {
  if (value === true) return { version: CANVAS_VERSION }
  if (!isObj(value)) return undefined
  return { version: num(value.version, CANVAS_VERSION, 1, 1000) }
}

// ---------- texto pesquisável ----------

/** Text of one object (the parts users typed on the board). Card pages' content is never copied here. */
export function objectText(object: CanvasObject): string {
  switch (object.type) {
    case 'note': case 'text': case 'shape': return object.text
    case 'section': return object.title
    case 'connector': return object.label ?? ''
    case 'image': return object.name
    case 'file': return object.name
    default: return ''
  }
}

export function canvasText(data: { objects?: unknown } | null | undefined): string {
  const objects = Array.isArray(data?.objects) ? data!.objects as CanvasObject[] : []
  return objects.map(o => isObj(o) ? objectText(o as CanvasObject) : '').filter(Boolean).join('\n')
}

/** Ids of pages referenced by cards (in board order, unique). */
export function cardPageIds(data: CanvasData): string[] {
  return [...new Set(data.objects.filter(isCard).map(card => card.pageId))]
}

// ---------- cores ----------

/** Font stacks: "hand" uses macOS handwriting faces already on the system (no network fonts). */
export const FONT_STACKS: Record<FontKind, string> = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  hand: '"Bradley Hand", "Noteworthy", "Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive',
  mono: 'ui-monospace, Menlo, "SF Mono", monospace',
}
export const fontOf = (o: { font?: FontKind }) => FONT_STACKS[o.font ?? 'sans']

export interface CanvasPalette { dark: boolean; bg: string; text: string; muted: string; border: string; accent: string; grid: string; selection: string; card: string; font: string }
// Mesmos valores dos tokens de src/styles/tokens.css (neutros quentes + destaque "Maré"); docs/DEVELOPMENT.md.
export const LIGHT_PALETTE: CanvasPalette = { dark: false, bg: '#fffdfa', text: '#26231f', muted: '#5f584f', border: '#e7e1d8', accent: '#0f766e', grid: 'rgba(70,56,40,0.16)', selection: 'rgba(15,118,110,0.10)', card: '#ffffff', font: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }
export const DARK_PALETTE: CanvasPalette = { dark: true, bg: '#1c1a17', text: '#f2eee8', muted: '#b5ada2', border: '#38332d', accent: '#4fc1b1', grid: 'rgba(255,240,220,0.14)', selection: 'rgba(79,193,177,0.18)', card: '#2a2723', font: LIGHT_PALETTE.font }

// Post-its/formas: fundo + texto com contraste ≥ 4.5:1 nos dois temas (tests/canvas-model.test.mts).
const NOTE_LIGHT: Record<CanvasColor, [string, string, string]> = {
  default: ['#ffffff', '#2c2c2b', '#d3d1cb'], gray: ['#f1f1ef', '#32302c', '#9b9a97'], brown: ['#f4eeee', '#442a1e', '#a27763'],
  orange: ['#fbecdd', '#49290e', '#d9730d'], yellow: ['#fdf3c6', '#402c1b', '#cb912f'], green: ['#e1f3e6', '#1c3829', '#448361'],
  blue: ['#e3eefb', '#183347', '#337ea9'], purple: ['#efe7f8', '#412454', '#9065b0'], pink: ['#fae6f0', '#4c2337', '#c14c8a'], red: ['#fde8e6', '#5d1715', '#d44c47'],
}
const NOTE_DARK: Record<CanvasColor, [string, string, string]> = {
  default: ['#2a2a2a', '#f0efed', '#5a5a58'], gray: ['#333331', '#f0efed', '#8c8b88'], brown: ['#3f2f27', '#f3e4dc', '#a27763'],
  orange: ['#4a3420', '#fbe6d2', '#d9730d'], yellow: ['#4b4020', '#fbf0c8', '#cb912f'], green: ['#243d30', '#dcf1e3', '#4f9a72'],
  blue: ['#1f3549', '#dcebfa', '#3d8fc4'], purple: ['#3b2a4c', '#eee2fa', '#a07cc4'], pink: ['#4a2537', '#fadbea', '#d0609c'], red: ['#4e2421', '#fde0dd', '#e0625d'],
}
/** [background, text, stroke] for a colour in the given theme. */
export function swatch(c: CanvasColor, dark: boolean): [string, string, string] { return (dark ? NOTE_DARK : NOTE_LIGHT)[c] ?? (dark ? NOTE_DARK : NOTE_LIGHT).default }
/** Stroke colour for lines/ink: `default` follows the text colour of the theme. */
export function inkColor(c: CanvasColor, dark: boolean): string { return c === 'default' ? (dark ? '#e8e7e4' : '#37352f') : swatch(c, dark)[2] }

/** Relative luminance contrast ratio (WCAG). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = hex.replace('#', '')
    const [r, g, b2] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2
  }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Search segments: one per object with text; `blockId` is the object id (search opens the board on it). */
export function canvasSegments(data: { objects?: unknown } | null | undefined): { id: string; text: string; type: string }[] {
  const objects = Array.isArray(data?.objects) ? data!.objects as CanvasObject[] : []
  const out: { id: string; text: string; type: string }[] = []
  for (const o of objects) {
    if (!isObj(o) || typeof o.id !== 'string') continue
    const text = objectText(o).trim()
    if (text) out.push({ id: o.id, text, type: o.type })
  }
  return out
}
