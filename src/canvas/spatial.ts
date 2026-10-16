// Índice espacial em grade uniforme (hash de células) para culling da viewport e hit-test em O(visíveis).
// Para 2.000–5.000 objetos com tamanhos parecidos a grade é tão rápida quanto uma quadtree e bem mais simples.
import type { CanvasObject } from './model.ts'
import { objectBounds, rectsIntersect, unionRects, type Lookup, type Rect } from './geometry.ts'

export class SpatialIndex {
  readonly cell: number
  private cells = new Map<string, string[]>()
  private large: string[] = []
  private boundsById = new Map<string, Rect>()
  private orderById = new Map<string, number>()

  constructor(cell = 512) { this.cell = cell }

  build(objects: readonly CanvasObject[], lookup: Lookup): this {
    this.cells.clear(); this.large = []; this.boundsById.clear(); this.orderById.clear()
    const c = this.cell
    objects.forEach((o, index) => {
      if (o.hidden) return // camada oculta: não desenha, não seleciona, não conta no enquadramento
      const r = objectBounds(o, lookup)
      if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) return
      this.boundsById.set(o.id, r); this.orderById.set(o.id, index)
      const x0 = Math.floor(r.x / c), x1 = Math.floor((r.x + r.w) / c), y0 = Math.floor(r.y / c), y1 = Math.floor((r.y + r.h) / c)
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) { this.large.push(o.id); return }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = x + ',' + y
        const list = this.cells.get(key)
        if (list) list.push(o.id); else this.cells.set(key, [o.id])
      }
    })
    return this
  }

  bounds(id: string): Rect | undefined { return this.boundsById.get(id) }
  order(id: string): number { return this.orderById.get(id) ?? -1 }
  get size() { return this.boundsById.size }

  /** Ids whose bounds intersect `rect`. */
  query(rect: Rect): Set<string> {
    const out = new Set<string>()
    const c = this.cell
    const x0 = Math.floor(rect.x / c), x1 = Math.floor((rect.x + rect.w) / c), y0 = Math.floor(rect.y / c), y1 = Math.floor((rect.y + rect.h) / c)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const [id, r] of this.boundsById) if (rectsIntersect(r, rect)) out.add(id)
      return out
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const list = this.cells.get(x + ',' + y)
      if (list) for (const id of list) if (!out.has(id) && rectsIntersect(this.boundsById.get(id)!, rect)) out.add(id)
    }
    for (const id of this.large) if (rectsIntersect(this.boundsById.get(id)!, rect)) out.add(id)
    return out
  }

  /** Visible ids sorted in z order. */
  visible(rect: Rect): string[] {
    return [...this.query(rect)].sort((a, b) => this.order(a) - this.order(b))
  }

  extent(): Rect | null { return unionRects([...this.boundsById.values()]) }
}
