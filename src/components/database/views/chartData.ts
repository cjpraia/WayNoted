// Cálculos puros dos gráficos ricos (tabela cruzada, acumulado, treemap e Sankey). Sem store,
// para serem testados em Node; ChartView injeta como ler os valores das linhas.
import type { OptionColor, Page } from '../../../types'

export interface Bucket { key: string; label: string; color?: OptionColor; custom?: string; empty?: boolean }
export type Bucketer = (row: Page) => Bucket[]
export type Measure = (rows: Page[]) => number

export interface CrossCell { rows: Page[]; value: number }
export interface CrossTab { primary: Bucket[]; secondary: Bucket[]; cells: Map<string, CrossCell>; totals: Map<string, CrossCell> }

export const cellKey = (primary: string, secondary: string) => `${primary}\u0000${secondary}`

/** Linhas cruzadas por duas propriedades; listas (multisseleção/relação) contam em cada item. */
export function crossTab(rows: Page[], primary: Bucketer, secondary: Bucketer, measure: Measure, order: (a: Bucket, b: Bucket) => number = () => 0): CrossTab {
  const primaries = new Map<string, Bucket>(), secondaries = new Map<string, Bucket>()
  const members = new Map<string, Page[]>(), totals = new Map<string, Page[]>()
  for (const row of rows) {
    const left = primary(row), right = secondary(row)
    for (const a of left) {
      primaries.set(a.key, primaries.get(a.key) ?? a)
      const list = totals.get(a.key) ?? []
      if (!list.includes(row)) list.push(row)
      totals.set(a.key, list)
      for (const b of right) {
        secondaries.set(b.key, secondaries.get(b.key) ?? b)
        const key = cellKey(a.key, b.key)
        const cell = members.get(key) ?? []
        cell.push(row)
        members.set(key, cell)
      }
    }
  }
  const sorter = (a: Bucket, b: Bucket) => Number(!!a.empty) - Number(!!b.empty) || order(a, b)
  const cells = new Map([...members].map(([key, list]) => [key, { rows: list, value: measure(list) }]))
  return { primary: [...primaries.values()].sort(sorter), secondary: [...secondaries.values()].sort(sorter), cells, totals: new Map([...totals].map(([key, list]) => [key, { rows: list, value: measure(list) }])) }
}

export function cumulative(values: number[]): number[] {
  let total = 0
  return values.map((value) => (total += value))
}

export interface Rect { key: string; x: number; y: number; w: number; h: number; value: number }

/** Treemap "squarified" (Bruls et al.): retângulos com proporção próxima de 1. Valores ≤ 0 são ignorados. */
export function squarify(items: { key: string; value: number }[], x: number, y: number, w: number, h: number): Rect[] {
  const data = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  if (!total || w <= 0 || h <= 0) return []
  const scale = (w * h) / total
  const out: Rect[] = []
  let rest = data.map((item) => ({ ...item, area: item.value * scale }))
  let box = { x, y, w, h }
  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((s, item) => s + item.area, 0)
    const max = Math.max(...row.map((item) => item.area)), min = Math.min(...row.map((item) => item.area))
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }
  while (rest.length) {
    const side = Math.min(box.w, box.h)
    const row = [rest[0]]
    let i = 1
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++ }
    rest = rest.slice(i)
    const sum = row.reduce((s, item) => s + item.area, 0)
    if (box.w >= box.h) {
      const width = rest.length ? sum / box.h : box.w
      let cy = box.y
      for (const item of row) { const height = item.area / width; out.push({ key: item.key, x: box.x, y: cy, w: width, h: height, value: item.value }); cy += height }
      box = { x: box.x + width, y: box.y, w: box.w - width, h: box.h }
    } else {
      const height = rest.length ? sum / box.w : box.h
      let cx = box.x
      for (const item of row) { const width = item.area / height; out.push({ key: item.key, x: cx, y: box.y, w: width, h: height, value: item.value }); cx += width }
      box = { x: box.x, y: box.y + height, w: box.w, h: box.h - height }
    }
  }
  return out
}

export interface SankeyNode { key: string; side: 'left' | 'right'; y: number; h: number; value: number }
export interface SankeyLink { source: string; target: string; value: number; sy: number; ty: number; h: number }

/** Sankey de duas colunas: nós empilhados com altura proporcional, faixas sem sobreposição. */
export function sankeyLayout(left: { key: string; value: number }[], right: { key: string; value: number }[], links: { source: string; target: string; value: number }[], height: number, gap = 10): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const valid = links.filter((link) => link.value > 0)
  const sum = (list: { value: number }[]) => list.reduce((s, item) => s + Math.max(0, item.value), 0)
  const total = Math.max(sum(valid), 1e-9)
  const usable = (count: number) => Math.max(10, height - gap * Math.max(0, count - 1))
  const scale = Math.min(usable(left.length) / total, usable(right.length) / total)
  const place = (list: { key: string }[], side: 'left' | 'right'): SankeyNode[] => {
    let y = 0
    return list.map((item) => {
      const value = sum(valid.filter((link) => (side === 'left' ? link.source : link.target) === item.key))
      const node = { key: item.key, side, y, h: value * scale, value }
      y += node.h + gap
      return node
    })
  }
  const nodes = [...place(left, 'left'), ...place(right, 'right')]
  const offsets = new Map(nodes.map((node) => [`${node.side}:${node.key}`, node.y]))
  const order = (key: string, side: 'left' | 'right') => (side === 'left' ? left : right).findIndex((item) => item.key === key)
  const sorted = [...valid].sort((a, b) => order(a.source, 'left') - order(b.source, 'left') || order(a.target, 'right') - order(b.target, 'right'))
  const out: SankeyLink[] = []
  for (const link of sorted) {
    const h = link.value * scale
    const sy = offsets.get(`left:${link.source}`) ?? 0
    out.push({ ...link, sy, ty: 0, h })
    offsets.set(`left:${link.source}`, sy + h)
  }
  // Destinos: ordena pela posição da origem para reduzir cruzamentos.
  for (const link of [...out].sort((a, b) => order(a.target, 'right') - order(b.target, 'right') || a.sy - b.sy)) {
    const ty = offsets.get(`right:${link.target}`) ?? 0
    link.ty = ty
    offsets.set(`right:${link.target}`, ty + link.h)
  }
  return { nodes, links: out }
}
