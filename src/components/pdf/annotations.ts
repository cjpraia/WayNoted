// Modelo das anotações de PDF (docs/USAGE.md). Puro, sem DOM nem React: coordenadas normalizadas,
// serialização tolerante, histórico (⌘Z), busca/filtro e Markdown. O PDF original nunca é alterado:
// as anotações vivem na propriedade `annotations` do bloco `pdfPreview` (JSON), com o hash SHA-256 do arquivo.

export const ANN_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const
export type AnnColor = (typeof ANN_COLORS)[number]
export const ANN_KINDS = ['highlight', 'underline', 'strike', 'note', 'pen', 'text'] as const
export type AnnKind = (typeof ANN_KINDS)[number]
export type Rotation = 0 | 90 | 180 | 270

/** Cores no tema claro (iguais a --icon-tint-*), usadas ao gravar no PDF exportado. */
export const ANN_HEX: Record<AnnColor, string> = { yellow: '#c29343', green: '#448361', blue: '#337ea9', pink: '#c14c8a', orange: '#d9730d' }
/** Cores de destaque (marca-texto) no PDF: mais vivas que os tons de ícone, para o texto continuar legível. */
export const ANN_MARKER_HEX: Record<AnnColor, string> = { yellow: '#f5d547', green: '#7bd389', blue: '#7cc4f2', pink: '#f59ac3', orange: '#f7a95a' }
export const PEN_SIZES = { thin: 0.002, medium: 0.004, thick: 0.009 } as const
export type PenSize = keyof typeof PEN_SIZES
export const TEXT_SIZE = 0.018

export interface Rect { x: number; y: number; w: number; h: number }
export interface Annotation {
  id: string
  kind: AnnKind
  /** Página, a partir de 1. */
  page: number
  color: AnnColor
  /** highlight/underline/strike: retângulos por linha, frações da página (0..1). */
  rects?: Rect[]
  /** note: ponta do pino. text: canto superior esquerdo e tamanho da caixa. */
  x?: number; y?: number; w?: number; h?: number
  /** pen: pontos [x, y] em frações da página. */
  points?: [number, number][]
  /** pen: espessura (fração da largura da página). text: tamanho da fonte (idem). */
  size?: number
  /** Comentário (note, destaques) ou conteúdo (text). */
  text?: string
  /** Trecho selecionado do PDF (highlight/underline/strike). */
  quote?: string
  created: number
  updated: number
}
export interface AnnotationDoc { v: 1; hash: string; annotations: Annotation[] }

export const MAX_ANNOTATIONS = 5000
const MAX_TEXT = 5000
const MAX_POINTS = 4000
const MAX_RECTS = 200

export const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const round = (value: number) => Math.round(value * 1e5) / 1e5
const isColor = (value: unknown): value is AnnColor => (ANN_COLORS as readonly unknown[]).includes(value)
const isKind = (value: unknown): value is AnnKind => (ANN_KINDS as readonly unknown[]).includes(value)
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function newId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14)
  return `an${random}`
}

/* ---------- Geometria ---------- */

/** Retângulo do navegador (px) dentro da caixa da página (px) → frações 0..1 (no sistema de coordenadas da tela). */
export function normalizeRect(rect: { left: number; top: number; width: number; height: number }, page: { left: number; top: number; width: number; height: number }): Rect {
  if (!(page.width > 0) || !(page.height > 0)) return { x: 0, y: 0, w: 0, h: 0 }
  const x = clamp01((rect.left - page.left) / page.width)
  const y = clamp01((rect.top - page.top) / page.height)
  const right = clamp01((rect.left + rect.width - page.left) / page.width)
  const bottom = clamp01((rect.top + rect.height - page.top) / page.height)
  return { x: round(x), y: round(y), w: round(Math.max(0, right - x)), h: round(Math.max(0, bottom - y)) }
}

/** Ponto na página sem rotação de visualização → ponto na página girada `rotation` graus no sentido horário. */
export function rotatePoint(x: number, y: number, rotation: Rotation): [number, number] {
  if (rotation === 90) return [1 - y, x]
  if (rotation === 180) return [1 - x, 1 - y]
  if (rotation === 270) return [y, 1 - x]
  return [x, y]
}
export function unrotatePoint(x: number, y: number, rotation: Rotation): [number, number] {
  if (rotation === 90) return [y, 1 - x]
  if (rotation === 180) return [1 - x, 1 - y]
  if (rotation === 270) return [1 - y, x]
  return [x, y]
}
function mapRect(rect: Rect, fn: (x: number, y: number) => [number, number]): Rect {
  const a = fn(rect.x, rect.y), b = fn(rect.x + rect.w, rect.y + rect.h)
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1])
  return { x: round(x), y: round(y), w: round(Math.abs(a[0] - b[0])), h: round(Math.abs(a[1] - b[1])) }
}
export const rectToView = (rect: Rect, rotation: Rotation) => mapRect(rect, (x, y) => rotatePoint(x, y, rotation))
export const rectFromView = (rect: Rect, rotation: Rotation) => mapRect(rect, (x, y) => unrotatePoint(x, y, rotation))

/** Funde retângulos da mesma linha (a seleção do pdf.js devolve um por trecho) e descarta os minúsculos. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects.filter((r) => r.w > 0.002 && r.h > 0.002).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Rect[] = []
  for (const rect of sorted) {
    const last = lines[lines.length - 1]
    const sameLine = last && Math.min(last.y + last.h, rect.y + rect.h) - Math.max(last.y, rect.y) > Math.min(last.h, rect.h) * 0.5
    if (last && sameLine && rect.x <= last.x + last.w + 0.012) {
      const top = Math.min(last.y, rect.y), bottom = Math.max(last.y + last.h, rect.y + rect.h), right = Math.max(last.x + last.w, rect.x + rect.w)
      last.y = round(top); last.h = round(bottom - top); last.w = round(right - last.x)
    } else lines.push({ ...rect })
  }
  return lines.slice(0, MAX_RECTS)
}

/** Reduz uma pista de caneta descartando pontos mais próximos que `min` (fração da página). */
export function simplifyPoints(points: [number, number][], min = 0.0025): [number, number][] {
  const out: [number, number][] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= min) out.push([round(clamp01(point[0])), round(clamp01(point[1]))])
  }
  const end = points[points.length - 1]
  if (end && out.length > 1 && (out[out.length - 1][0] !== end[0] || out[out.length - 1][1] !== end[1])) out[out.length - 1] = [round(clamp01(end[0])), round(clamp01(end[1]))]
  return out.slice(0, MAX_POINTS)
}

export function bounds(a: Annotation): Rect {
  if (a.rects?.length) {
    const x = Math.min(...a.rects.map((r) => r.x)), y = Math.min(...a.rects.map((r) => r.y))
    return { x, y, w: Math.max(...a.rects.map((r) => r.x + r.w)) - x, h: Math.max(...a.rects.map((r) => r.y + r.h)) - y }
  }
  if (a.points?.length) {
    const xs = a.points.map((p) => p[0]), ys = a.points.map((p) => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  if (a.kind === 'note') return { x: (a.x ?? 0) - 0.012, y: (a.y ?? 0) - 0.03, w: 0.024, h: 0.03 }
  return { x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 0, h: a.h ?? 0 }
}

/** Desloca uma anotação (setas, arrasto), mantendo-a dentro da página. Destaques seguem o texto e não se movem. */
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike') return a
  const box = bounds(a)
  const mx = Math.min(Math.max(dx, -box.x), 1 - box.x - box.w), my = Math.min(Math.max(dy, -box.y), 1 - box.y - box.h)
  const next: Annotation = { ...a }
  if (a.points) next.points = a.points.map(([x, y]) => [round(x + mx), round(y + my)])
  else if (a.kind === 'note') { next.x = round((a.x ?? 0) + mx); next.y = round((a.y ?? 0) + my) }
  else { next.x = round((a.x ?? 0) + mx); next.y = round((a.y ?? 0) + my) }
  return next
}

/** Coordenada na tela (página girada, origem no canto superior esquerdo, 0..1) → espaço do PDF. `pageRotate` é o /Rotate da página. */
export function displayToPdf(nx: number, ny: number, pageRotate: number, box: { x: number; y: number; width: number; height: number }): [number, number] {
  const rotate = ((Math.round(pageRotate / 90) * 90) % 360 + 360) % 360
  if (rotate === 90) return [box.x + ny * box.width, box.y + nx * box.height]
  if (rotate === 180) return [box.x + (1 - nx) * box.width, box.y + ny * box.height]
  if (rotate === 270) return [box.x + (1 - ny) * box.width, box.y + (1 - nx) * box.height]
  return [box.x + nx * box.width, box.y + (1 - ny) * box.height]
}

/* ---------- Serialização ---------- */

const text = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : undefined)

function parseRect(value: unknown): Rect | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const x = num(r.x), y = num(r.y), w = num(r.w), h = num(r.h)
  if (x === null || y === null || w === null || h === null) return null
  const cx = clamp01(x), cy = clamp01(y)
  return { x: cx, y: cy, w: Math.min(Math.max(0, w), 1 - cx), h: Math.min(Math.max(0, h), 1 - cy) }
}

/** Valida uma anotação vinda do disco; descarta o que não faz sentido em vez de recusar o documento inteiro. */
export function parseAnnotation(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isKind(r.kind)) return null
  const page = num(r.page)
  if (page === null || page < 1 || page > 100000) return null
  const now = Date.now()
  const base: Annotation = {
    id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : newId(),
    kind: r.kind, page: Math.floor(page), color: isColor(r.color) ? r.color : 'yellow',
    created: num(r.created) ?? now, updated: num(r.updated) ?? num(r.created) ?? now,
  }
  const comment = text(r.text), quote = text(r.quote)
  if (comment) base.text = comment
  if (quote) base.quote = quote
  if (r.kind === 'highlight' || r.kind === 'underline' || r.kind === 'strike') {
    const rects = (Array.isArray(r.rects) ? r.rects : []).map(parseRect).filter((x): x is Rect => !!x).slice(0, MAX_RECTS)
    if (!rects.length) return null
    return { ...base, rects }
  }
  if (r.kind === 'pen') {
    const points = (Array.isArray(r.points) ? r.points : []).map((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null ? [clamp01(p[0] as number), clamp01(p[1] as number)] as [number, number] : null).filter((p): p is [number, number] => !!p).slice(0, MAX_POINTS)
    if (points.length < 2) return null
    return { ...base, points, size: Math.min(0.05, Math.max(0.0005, num(r.size) ?? PEN_SIZES.medium)) }
  }
  const x = num(r.x), y = num(r.y)
  if (x === null || y === null) return null
  if (r.kind === 'note') return { ...base, x: clamp01(x), y: clamp01(y) }
  const w = Math.min(Math.max(num(r.w) ?? 0.25, 0.04), 1), h = Math.min(Math.max(num(r.h) ?? 0.06, 0.02), 1)
  return { ...base, x: Math.min(clamp01(x), 1 - w), y: Math.min(clamp01(y), 1 - h), w, h, size: Math.min(0.08, Math.max(0.006, num(r.size) ?? TEXT_SIZE)) }
}

/** Aceita a string JSON gravada no bloco (ou um objeto) e nunca lança: dado inválido vira documento vazio. */
export function parseAnnotations(raw: unknown): AnnotationDoc {
  let value: unknown = raw
  if (typeof raw === 'string') { try { value = raw.trim() ? JSON.parse(raw) : null } catch { value = null } }
  const empty: AnnotationDoc = { v: 1, hash: '', annotations: [] }
  if (!value || typeof value !== 'object') return empty
  const source = value as Record<string, unknown>
  const list = Array.isArray(source.annotations) ? source.annotations : Array.isArray(value) ? (value as unknown[]) : []
  const seen = new Set<string>()
  const annotations: Annotation[] = []
  for (const item of list.slice(0, MAX_ANNOTATIONS)) {
    const parsed = parseAnnotation(item)
    if (!parsed) continue
    if (seen.has(parsed.id)) parsed.id = newId()
    seen.add(parsed.id)
    annotations.push(parsed)
  }
  return { v: 1, hash: typeof source.hash === 'string' && /^[0-9a-f]{64}$/.test(source.hash) ? source.hash : '', annotations }
}

/** String para a propriedade do bloco; vazia quando não há nada a guardar (não pesa nos arquivos). */
export function serializeAnnotations(doc: AnnotationDoc): string {
  if (!doc.annotations.length) return ''
  return JSON.stringify({ v: 1, hash: doc.hash, annotations: doc.annotations })
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------- Histórico (⌘Z / ⇧⌘Z) ---------- */

export interface History { past: Annotation[][]; present: Annotation[]; future: Annotation[][]; key?: string; at: number }
export const HISTORY_LIMIT = 100
export const COALESCE_MS = 1000
export const createHistory = (present: Annotation[] = []): History => ({ past: [], present, future: [], at: 0 })
/** Registra um novo estado. Com `key`, edições seguidas da mesma coisa (digitar um comentário) viram um único passo de desfazer. */
export function pushHistory(h: History, next: Annotation[], key?: string, now = Date.now()): History {
  if (next === h.present) return h
  if (key && h.key === key && now - h.at < COALESCE_MS && h.past.length) return { ...h, present: next, future: [], at: now }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], key, at: now }
}
export const canUndo = (h: History) => h.past.length > 0
export const canRedo = (h: History) => h.future.length > 0
export function undoHistory(h: History): History {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 }
}
export function redoHistory(h: History): History {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 }
}

/* ---------- Lista, busca e Markdown ---------- */

export interface AnnFilter { color?: AnnColor | null; query?: string }
export function filterAnnotations(list: Annotation[], filter: AnnFilter): Annotation[] {
  const query = (filter.query ?? '').trim().toLocaleLowerCase()
  return list.filter((a) => (!filter.color || a.color === filter.color) && (!query || `${a.quote ?? ''}\n${a.text ?? ''}`.toLocaleLowerCase().includes(query)))
}
export function sortAnnotations(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => a.page - b.page || bounds(a).y - bounds(b).y || bounds(a).x - bounds(b).x || a.created - b.created)
}
export function groupByPage(list: Annotation[]): { page: number; items: Annotation[] }[] {
  const pages = new Map<number, Annotation[]>()
  for (const a of sortAnnotations(list)) pages.set(a.page, [...(pages.get(a.page) ?? []), a])
  return [...pages].map(([page, items]) => ({ page, items }))
}
/** Destaques com texto (marca-texto, sublinhado, tachado) e notas com comentário: o que entra em exportações de texto. */
export const textualAnnotations = (list: Annotation[]) => sortAnnotations(list).filter((a) => (a.kind === 'note' || a.kind === 'text') ? !!a.text?.trim() : (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike'))
export const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()

export type Translate = (pt: string, en: string, vars?: Record<string, string | number>) => string

export function highlightsToMarkdown(list: Annotation[], name: string, t: Translate): string {
  const items = textualAnnotations(list)
  if (!items.length) return ''
  const lines = [`## ${name}`]
  for (const group of groupByPage(items)) {
    lines.push('', `### ${t('Página', 'Page')} ${group.page}`)
    for (const a of group.items) {
      const comment = a.text?.trim()
      if (a.kind === 'note' || a.kind === 'text') lines.push('', `- ${a.kind === 'note' ? t('Nota', 'Note') : t('Texto', 'Text')}: ${oneLine(comment ?? '')}`)
      else {
        lines.push('', `> ${oneLine(a.quote ?? '')}`)
        if (comment) lines.push('>', `> ${t('Comentário', 'Comment')}: ${oneLine(comment)}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

export function annotationLabel(a: Annotation, t: Translate): string {
  const kinds: Record<AnnKind, string> = {
    highlight: t('Destaque', 'Highlight'), underline: t('Sublinhado', 'Underline'), strike: t('Tachado', 'Strikethrough'),
    note: t('Nota', 'Note'), pen: t('Desenho', 'Drawing'), text: t('Caixa de texto', 'Text box'),
  }
  return kinds[a.kind]
}
export function colorLabel(color: AnnColor, t: Translate): string {
  return ({ yellow: t('Amarelo', 'Yellow'), green: t('Verde', 'Green'), blue: t('Azul', 'Blue'), pink: t('Rosa', 'Pink'), orange: t('Laranja', 'Orange') })[color]
}
