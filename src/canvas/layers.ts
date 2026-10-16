// Lista de camadas do quadro (puro, sem DOM): árvore por seção e ordem Z, reordenação e rótulos.
// Pertencimento a seção é espacial (igual ao arrastar a seção): um objeto está "dentro" da menor seção que o contém por inteiro.
import { objectText, type CanvasObject } from './model.ts'
import { containsRect, objectBounds, type Lookup } from './geometry.ts'
import { lookupOf } from './ops.ts'

export interface LayerNode { id: string; depth: number; parent: string | null; children: LayerNode[] }
export interface LayerRow { id: string; depth: number; parent: string | null; hasChildren: boolean }

const area = (o: CanvasObject, lookup: Lookup) => { const r = objectBounds(o, lookup); return r.w * r.h }

/** Árvore: seções no topo com os objetos que contêm; dentro de cada nível, o que está mais à frente (Z maior) vem primeiro. */
export function buildLayerTree(objects: readonly CanvasObject[]): LayerNode[] {
  const lookup = lookupOf(objects)
  const bounds = new Map(objects.map(o => [o.id, objectBounds(o, lookup)] as const))
  const sections = objects.filter(o => o.type === 'section')
  const parentOf = new Map<string, string | null>()
  for (const o of objects) {
    let best: CanvasObject | null = null, bestArea = Infinity
    for (const s of sections) {
      if (s.id === o.id) continue
      const sb = bounds.get(s.id)!, a = sb.w * sb.h
      if (a >= bestArea) continue
      if (o.type === 'section' && a <= area(o, lookup)) continue
      if (containsRect(sb, bounds.get(o.id)!)) { best = s; bestArea = a }
    }
    parentOf.set(o.id, best?.id ?? null)
  }
  const nodes = new Map<string, LayerNode>()
  for (const o of objects) nodes.set(o.id, { id: o.id, depth: 0, parent: parentOf.get(o.id) ?? null, children: [] })
  const roots: LayerNode[] = []
  for (let i = objects.length - 1; i >= 0; i--) {
    const node = nodes.get(objects[i].id)!
    const parent = node.parent ? nodes.get(node.parent) : null
    if (parent) { node.depth = 0; parent.children.push(node) } else roots.push(node)
  }
  const setDepth = (list: LayerNode[], depth: number) => { for (const n of list) { n.depth = depth; setDepth(n.children, depth + 1) } }
  setDepth(roots, 0)
  return roots
}

/** Linhas visíveis da lista (seções recolhidas escondem os filhos). */
export function flattenLayers(tree: readonly LayerNode[], collapsed: ReadonlySet<string> = new Set()): LayerRow[] {
  const rows: LayerRow[] = []
  const walk = (list: readonly LayerNode[]) => {
    for (const n of list) {
      rows.push({ id: n.id, depth: n.depth, parent: n.parent, hasChildren: n.children.length > 0 })
      if (n.children.length && !collapsed.has(n.id)) walk(n.children)
    }
  }
  walk(tree)
  return rows
}

/**
 * Move `id` para antes ("acima" na lista = mais à frente no Z) ou depois ("abaixo") de `targetId`.
 * Devolve a mesma lista se nada mudar. Objetos do mesmo grupo não acompanham (a lista é por objeto).
 */
export function moveLayer(objects: readonly CanvasObject[], id: string, targetId: string, position: 'above' | 'below'): CanvasObject[] {
  if (id === targetId) return objects as CanvasObject[]
  const moving = objects.find(o => o.id === id)
  if (!moving || moving.locked || !objects.some(o => o.id === targetId)) return objects as CanvasObject[]
  const rest = objects.filter(o => o.id !== id)
  const at = rest.findIndex(o => o.id === targetId)
  const next = [...rest.slice(0, position === 'above' ? at + 1 : at), moving, ...rest.slice(position === 'above' ? at + 1 : at)]
  return next.every((o, i) => o === objects[i]) ? objects as CanvasObject[] : next
}

/** Nome mostrado: o nome dado à camada; senão o texto do objeto; senão o tipo. `typeName` e `cardTitle` vêm da interface (i18n e páginas). */
export function layerLabel(o: CanvasObject, typeName: (type: string) => string, cardTitle?: (pageId: string) => string): string {
  if (o.layerName) return o.layerName
  if (o.type === 'page' || o.type === 'database') return cardTitle?.(o.pageId) || typeName(o.type)
  const text = objectText(o).trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, 60) : typeName(o.type)
}

/** Ids de todos os descendentes de um nó (para ocultar/travar uma seção com o conteúdo). */
export function descendantIds(tree: readonly LayerNode[], id: string): string[] {
  const out: string[] = []
  const collect = (n: LayerNode) => { for (const c of n.children) { out.push(c.id); collect(c) } }
  const find = (list: readonly LayerNode[]): LayerNode | null => { for (const n of list) { if (n.id === id) return n; const f = find(n.children); if (f) return f } return null }
  const node = find(tree)
  if (node) collect(node)
  return out
}

export const isLayerLocked = (o: CanvasObject) => !!o.locked
export const isLayerHidden = (o: CanvasObject) => !!o.hidden
