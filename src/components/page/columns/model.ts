// Colunas do editor — modelo puro (sem DOM, sem ProseMirror).
//
// CÓDIGO PRÓPRIO do aplicativo (licença do projeto). Foi escrito de forma independente, a partir do
// comportamento especificado em docs/USAGE.md e da API pública (MPL-2.0) do @blocknote/core; não
// copia nem deriva de nenhum código GPL. Ver docs/LICENSING.md.
//
// Formato de dados (compatível com todas as páginas já gravadas):
//   { type: 'columnList', props: {}, children: [ { type: 'column', props: { width: 1 }, children: [blocos…] }, … ] }
// `width` é um peso relativo (flex-grow): 1 + 1 + 1 = três colunas iguais; 2 + 1 = a primeira ocupa o dobro.

export const COLUMN_LIST = 'columnList'
export const COLUMN = 'column'
export const MIN_COLUMNS = 2
export const MAX_COLUMNS = 5
/** Cada coluna ocupa, no mínimo, esta fração do total. */
export const MIN_FRACTION = 0.1
/** Passo do teclado (← / →) na alça de redimensionar: 5% do total. */
export const KEY_STEP = 0.05
/** Casas decimais gravadas em `width`. */
const PRECISION = 1000

export interface TreeBlock { id: string; type: string; props?: Record<string, unknown>; children: TreeBlock[]; [key: string]: unknown }
export type ColumnEdge = 'left' | 'right'

/** `width` legado ou corrompido (texto, 0, negativo, NaN) vira 1. */
export function columnWeight(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1
}

const round = (value: number) => Math.round(value * PRECISION) / PRECISION

/** Frações (somam 1) a partir dos pesos gravados. */
export function toFractions(weights: readonly unknown[]): number[] {
  const safe = weights.map(columnWeight)
  const total = safe.reduce((sum, value) => sum + value, 0)
  return safe.map((value) => value / total)
}

/** Pesos normalizados para somar `weights.length` (média 1): 3 colunas iguais = 1, 1, 1. */
export function normalizeWidths(weights: readonly unknown[]): number[] {
  if (!weights.length) return []
  return toFractions(weights).map((fraction) => round(fraction * weights.length))
}

/** Move a divisória entre `index` e `index + 1` para `fraction` (parte do par que fica na esquerda), respeitando o mínimo. */
export function setPairSplit(weights: readonly unknown[], index: number, leftShare: number): number[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= weights.length - 1) return null
  const safe = weights.map(columnWeight)
  const total = safe.reduce((sum, value) => sum + value, 0)
  const pair = safe[index] + safe[index + 1]
  const min = Math.min(MIN_FRACTION * total, pair / 2)
  const left = Math.min(pair - min, Math.max(min, pair * leftShare))
  const next = [...safe]
  next[index] = round(left)
  next[index + 1] = round(pair - next[index])
  return changed(safe, next) ? next : null
}

/** Move a divisória por `delta` (fração do total da lista, positivo = para a direita). */
export function resizeBoundary(weights: readonly unknown[], index: number, delta: number): number[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= weights.length - 1) return null
  const safe = weights.map(columnWeight)
  const total = safe.reduce((sum, value) => sum + value, 0)
  const pair = safe[index] + safe[index + 1]
  return setPairSplit(safe, index, (safe[index] + delta * total) / pair)
}

/** Home/End: a coluna à esquerda da divisória fica no mínimo (`start`) ou no máximo (`end`). */
export function snapBoundary(weights: readonly unknown[], index: number, where: 'start' | 'end'): number[] | null {
  return setPairSplit(weights, index, where === 'start' ? 0 : 1)
}

/** Porcentagem (inteira) ocupada pela coluna `index`, para aria-valuenow. */
export function percentOf(weights: readonly unknown[], index: number): number {
  return Math.round((toFractions(weights)[index] ?? 0) * 100)
}

function changed(before: readonly number[], after: readonly number[]): boolean {
  return after.some((value, index) => Math.abs(value - before[index]) > 1 / PRECISION / 2)
}

/** Peso de uma coluna nova: a média das existentes, para não distorcer o equilíbrio. */
export function newColumnWeight(weights: readonly unknown[]): number {
  if (!weights.length) return 1
  return round(weights.map(columnWeight).reduce((sum, value) => sum + value, 0) / weights.length)
}

/** Largura 1 em todas as colunas. */
export function equalWidths(count: number): number[] { return Array.from({ length: count }, () => 1) }

type PartialColumnBlock = { type: 'column'; props: { width: number }; children: unknown[] }
type PartialColumnList = { type: 'columnList'; children: PartialColumnBlock[] }

export function assertColumnCount(count: number): void {
  if (!Number.isInteger(count) || count < MIN_COLUMNS || count > MAX_COLUMNS) throw new Error(`Column count must be ${MIN_COLUMNS}–${MAX_COLUMNS}`)
}

/** Bloco `columnList` com `count` colunas, cada uma com um parágrafo vazio (ou os blocos dados). */
export function buildColumnList(count: number, contents?: readonly (readonly unknown[])[], widths?: readonly number[]): PartialColumnList {
  assertColumnCount(count)
  return {
    type: COLUMN_LIST,
    children: Array.from({ length: count }, (_, index): PartialColumnBlock => ({
      type: COLUMN,
      props: { width: widths?.[index] ?? 1 },
      children: contents?.[index]?.length ? [...contents[index]] : [{ type: 'paragraph' }],
    })),
  }
}

function find(blocks: readonly TreeBlock[], id: string, parents: TreeBlock[] = []): { block: TreeBlock; parents: TreeBlock[] } | null {
  for (const block of blocks) {
    if (block.id === id) return { block, parents }
    const found = find(block.children ?? [], id, [...parents, block])
    if (found) return found
  }
  return null
}

const containsColumns = (block: TreeBlock): boolean => block.type === COLUMN_LIST || (block.children ?? []).some(containsColumns)

export type ColumnDropPlan =
  | { kind: 'new-list'; targetId: string; edge: ColumnEdge }
  | { kind: 'new-column'; columnId: string; edge: ColumnEdge }

/**
 * Decide o que um arraste para a borda esquerda/direita de `targetId` faz:
 * - bloco solto → cria uma lista de colunas com o alvo e os blocos arrastados;
 * - bloco filho direto de uma coluna → acrescenta uma coluna nova ao lado dessa coluna.
 * Recusa: soltar em si mesmo ou dentro do que se arrasta, colunas dentro de colunas, mais de MAX_COLUMNS.
 */
export function planColumnDrop(document: readonly TreeBlock[], sourceIds: readonly string[], targetId: string, edge: ColumnEdge): ColumnDropPlan | null {
  if (!sourceIds.length) return null
  const target = find(document, targetId)
  if (!target) return null
  const sources = sourceIds.map((id) => find(document, id))
  if (sources.some((source) => !source)) return null
  if (sourceIds.includes(targetId) || target.parents.some((parent) => sourceIds.includes(parent.id))) return null
  // Uma coluna nunca é arrastada sozinha; listas de colunas não entram em colunas.
  const moving = sources.map((source) => source!.block)
  if (moving.some((block) => block.type === COLUMN)) return null
  const parent = target.parents.at(-1)
  const insideColumn = target.parents.some((ancestor) => ancestor.type === COLUMN)
  if (target.block.type === COLUMN || target.block.type === COLUMN_LIST) return null
  if (insideColumn) {
    if (parent?.type !== COLUMN) return null
    if (moving.some(containsColumns)) return null
    const list = target.parents.at(-2)
    // Os blocos arrastados que já estão nesta lista de colunas não contam como coluna nova se esvaziarem a sua.
    const remaining = (list?.children ?? []).filter((column) => !(column.children.length && column.children.every((child) => sourceIds.includes(child.id)))).length
    if (remaining >= MAX_COLUMNS) return null
    return { kind: 'new-column', columnId: parent.id, edge }
  }
  return { kind: 'new-list', targetId, edge }
}

/** Blocos soltos no lugar da lista de colunas (Desfazer colunas): todos os blocos de cada coluna, na ordem. */
export function dissolveColumns<T extends { type: string; children?: T[] }>(list: T): T[] {
  return (list.children ?? []).flatMap((column) => column.type === COLUMN ? (column.children ?? []) : [column])
}

/** Quantidade de colunas e pesos de uma lista, tolerando listas legadas. */
export function listWeights(list: { children?: { props?: Record<string, unknown> }[] }): number[] {
  return (list.children ?? []).map((column) => columnWeight(column.props?.width))
}

/** Acha a lista de colunas que contém o bloco (ou o próprio bloco, se for uma lista). */
export function enclosingColumnList(document: readonly TreeBlock[], blockId: string): TreeBlock | null {
  const hit = find(document, blockId)
  if (!hit) return null
  if (hit.block.type === COLUMN_LIST) return hit.block
  return [...hit.parents].reverse().find((parent) => parent.type === COLUMN_LIST) ?? null
}
