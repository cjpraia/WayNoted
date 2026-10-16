import COMPAT from '../../shared/compatibility.ts'
// Operações puras sobre a lista de objetos: criar, duplicar, apagar, ordem Z, grupos, área de transferência.
import { DEFAULT_SIZE, isBox, isConnector, newObjectId, normalizeObject, type BoxObject, type CanvasColor, type CanvasObject, type ConnectorObject, type ShapeKind } from './model.ts'
import { connectorEnds, distToPolyline, drawPoints, objectBounds, translateObject, unionRects, type Lookup, type Point, type Rect } from './geometry.ts'

export const lookupOf = (objects: readonly CanvasObject[]): Lookup => {
  const map = new Map(objects.map(o => [o.id, o]))
  return id => map.get(id)
}

/** Expands a selection with group mates (clicking one member selects the group). */
export function withGroups(objects: readonly CanvasObject[], ids: Iterable<string>): Set<string> {
  const out = new Set(ids)
  const groups = new Set(objects.filter(o => out.has(o.id) && o.groupId).map(o => o.groupId!))
  if (groups.size) for (const o of objects) if (o.groupId && groups.has(o.groupId)) out.add(o.id)
  return out
}

export function selectionBounds(objects: readonly CanvasObject[], ids: Set<string>, lookup: Lookup): Rect | null {
  return unionRects(objects.filter(o => ids.has(o.id)).map(o => objectBounds(o, lookup)))
}

export interface NewObjectOptions { color?: CanvasColor; shape?: ShapeKind; text?: string; pageId?: string; w?: number; h?: number }

/** A new box centred on `at`. */
export function createBox(type: BoxObject['type'], at: Point, options: NewObjectOptions = {}): BoxObject {
  const [dw, dh] = DEFAULT_SIZE[type] ?? [200, 200]
  const w = options.w ?? dw, h = options.h ?? dh
  const base = { id: newObjectId(), x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h }
  switch (type) {
    case 'note': return { ...base, type, text: options.text ?? '', color: options.color ?? 'yellow' }
    case 'text': return { ...base, type, text: options.text ?? '', color: options.color ?? 'default', fontSize: 20 }
    case 'shape': return { ...base, type, shape: options.shape ?? 'rect', text: options.text ?? '', color: options.color ?? 'blue', fill: 'tint' }
    case 'section': return { ...base, type, title: options.text ?? '', color: options.color ?? 'gray' }
    case 'page': case 'database': return { ...base, type, pageId: options.pageId ?? '' }
    default: throw new Error(`createBox: ${type}`)
  }
}

export function createConnector(from: ConnectorObject['from'], to: ConnectorObject['to'], arrow = true, route: ConnectorObject['route'] = 'curve'): ConnectorObject {
  return { id: newObjectId(), type: 'connector', from, to, route, color: 'default', ...(arrow ? { endArrow: true } : {}) }
}

/** Stores the resolved end points of anchored connectors (fallback if the target disappears). */
export function freezeConnectorEnds(objects: readonly CanvasObject[]): CanvasObject[] {
  const lookup = lookupOf(objects)
  return objects.map(o => {
    if (!isConnector(o) || (!o.from.id && !o.to.id)) return o
    const ends = connectorEnds(o, lookup)
    const same = (e: ConnectorObject['from'], p: Point) => Math.abs(e.x - p.x) < 0.01 && Math.abs(e.y - p.y) < 0.01
    if ((!o.from.id || ends.deadA || same(o.from, ends.a)) && (!o.to.id || ends.deadB || same(o.to, ends.b))) return o
    return { ...o, from: o.from.id && !ends.deadA ? { ...o.from, x: ends.a.x, y: ends.a.y } : o.from, to: o.to.id && !ends.deadB ? { ...o.to, x: ends.b.x, y: ends.b.y } : o.to }
  })
}

/** Removes `ids` and connectors anchored to removed objects. Locked objects are kept. */
export function deleteObjects(objects: readonly CanvasObject[], ids: Set<string>): CanvasObject[] {
  const removed = new Set(objects.filter(o => ids.has(o.id) && !o.locked).map(o => o.id))
  return objects.filter(o => !removed.has(o.id) && !(isConnector(o) && ((o.from.id && removed.has(o.from.id)) || (o.to.id && removed.has(o.to.id)))))
}

/** Deep copies of `ids` with fresh ids (connectors and groups remapped inside the copy), offset by (dx, dy). */
export function cloneObjects(source: readonly CanvasObject[], dx: number, dy: number): { objects: CanvasObject[]; idMap: Map<string, string> } {
  const idMap = new Map(source.map(o => [o.id, newObjectId()]))
  const groupMap = new Map<string, string>()
  const objects = source.map(o => {
    const copy = translateObject(structuredClone(o), dx, dy)
    copy.id = idMap.get(o.id)!
    if (copy.groupId) copy.groupId = groupMap.get(copy.groupId) ?? groupMap.set(copy.groupId, newObjectId()).get(copy.groupId)!
    delete copy.locked
    if (isConnector(copy)) {
      // Pontas ligadas a objetos fora da cópia continuam ligadas ao original (como no Figma); dentro, à cópia.
      if (copy.from.id && idMap.has(copy.from.id)) copy.from.id = idMap.get(copy.from.id)
      if (copy.to.id && idMap.has(copy.to.id)) copy.to.id = idMap.get(copy.to.id)
    }
    return copy
  })
  return { objects, idMap }
}

/** Selected objects plus connectors whose both ends are inside the selection. */
export function collectForCopy(objects: readonly CanvasObject[], ids: Set<string>): CanvasObject[] {
  return objects.filter(o => ids.has(o.id) || (isConnector(o) && !!o.from.id && !!o.to.id && ids.has(o.from.id) && ids.has(o.to.id)))
}

export function duplicateObjects(objects: readonly CanvasObject[], ids: Set<string>, offset = 24): { objects: CanvasObject[]; added: string[] } {
  const source = freezeConnectorEnds(collectForCopy(objects, ids))
  const { objects: copies } = cloneObjects(source, offset, offset)
  // Conectores da cópia que apontavam para fora da seleção ficam soltos na mesma posição relativa.
  const inside = new Set(copies.map(o => o.id))
  const fixed = copies.map(o => isConnector(o) ? { ...o, from: o.from.id && !inside.has(o.from.id) ? { x: o.from.x, y: o.from.y } : o.from, to: o.to.id && !inside.has(o.to.id) ? { x: o.to.x, y: o.to.y } : o.to } : o)
  return { objects: [...objects, ...fixed], added: fixed.map(o => o.id) }
}

// ---------- área de transferência ----------

export const CLIPBOARD_MARK = COMPAT.record025
export function serializeClipboard(objects: readonly CanvasObject[], ids: Set<string>): string {
  const picked = freezeConnectorEnds(collectForCopy(objects, ids))
  return JSON.stringify({ format: CLIPBOARD_MARK, version: 1, objects: picked })
}
export function parseClipboard(text: string): CanvasObject[] | null {
  if (!text || !text.includes(CLIPBOARD_MARK)) return null
  try {
    const value = JSON.parse(text)
    if (!value || value.format !== CLIPBOARD_MARK || !Array.isArray(value.objects)) return null
    return value.objects.map(normalizeObject).filter((o: CanvasObject | null): o is CanvasObject => !!o)
  } catch { return null }
}

/** Pasted objects centred at `at` with fresh ids; connectors to objects outside the paste become free. */
export function pasteObjects(clip: readonly CanvasObject[], at: Point): CanvasObject[] {
  const lookup = lookupOf(clip)
  const bounds = unionRects(clip.map(o => objectBounds(o, lookup)))
  if (!bounds) return []
  const { objects } = cloneObjects(clip, at.x - (bounds.x + bounds.w / 2), at.y - (bounds.y + bounds.h / 2))
  const inside = new Set(objects.map(o => o.id))
  return objects.map(o => isConnector(o) ? { ...o, from: o.from.id && !inside.has(o.from.id) ? { x: o.from.x, y: o.from.y } : o.from, to: o.to.id && !inside.has(o.to.id) ? { x: o.to.x, y: o.to.y } : o.to } : o)
}

// ---------- ordem Z e grupos ----------

export type Reorder = 'forward' | 'backward' | 'front' | 'back'
export function reorder(objects: readonly CanvasObject[], ids: Set<string>, mode: Reorder): CanvasObject[] {
  const picked = objects.filter(o => ids.has(o.id)), rest = objects.filter(o => !ids.has(o.id))
  if (!picked.length) return [...objects]
  if (mode === 'front') return [...rest, ...picked]
  if (mode === 'back') return [...picked, ...rest]
  const list = [...objects]
  if (mode === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]]
  } else {
    for (let i = 1; i < list.length; i++) if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]]
  }
  return list
}

export function groupObjects(objects: readonly CanvasObject[], ids: Set<string>): CanvasObject[] {
  if (ids.size < 2) return [...objects]
  const groupId = newObjectId()
  return objects.map(o => ids.has(o.id) ? { ...o, groupId } : o)
}
export function ungroupObjects(objects: readonly CanvasObject[], ids: Set<string>): CanvasObject[] {
  return objects.map(o => ids.has(o.id) && o.groupId ? (({ groupId: _g, ...rest }) => rest as CanvasObject)(o) : o)
}

export function patchObjects(objects: readonly CanvasObject[], ids: Set<string>, patch: (o: CanvasObject) => CanvasObject): CanvasObject[] {
  let changed = false
  const next = objects.map(o => { if (!ids.has(o.id)) return o; const n = patch(o); if (n !== o) changed = true; return n })
  return changed ? next : objects as CanvasObject[]
}

/** Draw strokes touched by the eraser circle. */
export function strokesAt(objects: readonly CanvasObject[], p: Point, radius: number, candidates?: Set<string>): string[] {
  const out: string[] = []
  for (const o of objects) {
    if (o.type !== 'draw' || o.locked || (candidates && !candidates.has(o.id))) continue
    const pts = drawPoints(o)
    if (distToPolyline(p, pts) <= radius + o.size / 2) out.push(o.id)
  }
  return out
}

/** Freehand stroke from absolute samples [x, y, pressure]; points are stored relative to the bounds origin. */
export function strokeFromSamples(samples: number[], color: CanvasColor, size: number): BoxObject | null {
  if (samples.length < 6) {
    if (samples.length < 3) return null
    samples = [...samples, samples[0] + 0.5, samples[1] + 0.5, samples[2]]
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < samples.length; i += 3) { x0 = Math.min(x0, samples[i]); y0 = Math.min(y0, samples[i + 1]); x1 = Math.max(x1, samples[i]); y1 = Math.max(y1, samples[i + 1]) }
  const points = samples.map((v, i) => i % 3 === 0 ? Math.round((v - x0) * 10) / 10 : i % 3 === 1 ? Math.round((v - y0) * 10) / 10 : Math.round(v * 100) / 100)
  return { id: newObjectId(), type: 'draw', x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), points, color, size }
}

/** Ramer–Douglas–Peucker simplification of [x,y,p] samples (keeps file size small for long strokes). */
export function simplifySamples(samples: number[], epsilon = 0.6): number[] {
  const n = samples.length / 3
  if (n <= 2) return samples
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1, dist = 0
    const ax = samples[a * 3], ay = samples[a * 3 + 1], bx = samples[b * 3], by = samples[b * 3 + 1]
    for (let i = a + 1; i < b; i++) {
      const px = samples[i * 3], py = samples[i * 3 + 1]
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d > dist) { dist = d; best = i }
    }
    if (best > 0 && dist > epsilon) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2])
  return out
}

export const boxesOf = (objects: readonly CanvasObject[]) => objects.filter(isBox)
