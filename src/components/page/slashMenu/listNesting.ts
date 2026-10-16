// Arrastar e soltar blocos dentro de contêineres (toggle, título recolhível,
// listas, citação, callout) e entre blocos, com a mesma regra para a linha azul
// (drop cursor) e para o drop. Soltar na borda esquerda/direita cria colunas (src/components/page/columns).
import { createExtension, fragmentToBlocks, getNodeById, type DropCursorHooks } from '@blocknote/core'
import { applyColumnDrop, columnDropCursor } from '../columns/actions.ts'
import { planColumnDrop } from '../columns/model.ts'
import { Plugin } from 'prosemirror-state'
import type { Slice } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem'])
/** Blocos que, como no Export Bundle, aceitam receber filhos por arrastar. */
const CONTAINER_TYPES = new Set([...LIST_TYPES, 'callout', 'quote'])
export interface TreeBlock { id: string; type: string; props?: Record<string, unknown>; children: TreeBlock[]; [key: string]: unknown }

/** Distância (px) à direita do início do bloco a partir da qual soltar "entra" nele. */
export const DROP_INDENT = 40
/** Faixa (px) logo dentro da borda esquerda que cria colunas (borda direita: 10% da largura). */
export const COLUMN_EDGE = 16

export function acceptsChildren(block: Pick<TreeBlock, 'type' | 'props'>): boolean {
  return CONTAINER_TYPES.has(block.type) || (block.type === 'heading' && block.props?.isToggleable === true)
}

/** Moves existing blocks under a list item in one immutable document change. */
export function nestBlocksInList<T extends TreeBlock>(document: readonly T[], sourceIds: readonly string[], targetId: string): T[] | null {
  const target = findBlock(document, targetId)
  if (!target || !LIST_TYPES.has(target.block.type)) return null
  return moveBlocksInTree(document, sourceIds, { kind: 'child-last', targetId })
}

export type DropPlacement = { kind: 'before' | 'after' | 'child' | 'child-last'; targetId: string }

function findBlock<T extends TreeBlock>(blocks: readonly T[], id: string, parents: T[] = []): { block: T; parents: T[] } | null {
  for (const block of blocks) {
    if (block.id === id) return { block, parents }
    const found = findBlock(block.children as T[], id, [...parents, block])
    if (found) return found
  }
  return null
}

/** Valida um destino: nunca dentro do próprio bloco arrastado nem relativo a ele. */
export function validDropPlacement(document: readonly TreeBlock[], sourceIds: readonly string[], placement: DropPlacement): boolean {
  if (!sourceIds.length) return false
  const target = findBlock(document, placement.targetId)
  if (!target) return false
  if (sourceIds.some((id) => !findBlock(document, id))) return false
  if (sourceIds.includes(placement.targetId) || target.parents.some((parent) => sourceIds.includes(parent.id))) return false
  // Colunas só contêm blocos; listas de colunas não recebem filhos.
  if ((placement.kind === 'child' || placement.kind === 'child-last') && (target.block.type === 'column' || target.block.type === 'columnList')) return false
  // Colunas não se aninham em colunas (como no Export Bundle e no schema do multi-column).
  const sources = sourceIds.map((id) => findBlock(document, id)?.block)
  const containsColumns = (block: TreeBlock | undefined): boolean => !!block && (block.type === 'columnList' || block.children.some(containsColumns))
  const insideColumn = target.parents.some((parent) => parent.type === 'column') || target.block.type === 'column'
  if (insideColumn && sources.some(containsColumns)) return false
  return true
}

/** Versão pura do movimento (mesma semântica de applyDropPlacement), útil para validar e testar. */
export function moveBlocksInTree<T extends TreeBlock>(document: readonly T[], sourceIds: readonly string[], placement: DropPlacement): T[] | null {
  if (!validDropPlacement(document, sourceIds, placement)) return null
  const wanted = new Set(sourceIds)
  const moving: T[] = []
  const collect = (blocks: readonly T[]) => { for (const block of blocks) { if (wanted.has(block.id)) moving.push(block); else collect(block.children as T[]) } }
  collect(document)
  const strip = (blocks: readonly T[]): T[] => blocks.filter((block) => !wanted.has(block.id)).map((block) => ({ ...block, children: strip(block.children as T[]) }))
  const insert = (blocks: readonly T[]): T[] => blocks.flatMap((block) => {
    const next = { ...block, children: insert(block.children as T[]) } as T
    if (block.id !== placement.targetId) return [next]
    if (placement.kind === 'before') return [...moving, next]
    if (placement.kind === 'after') return [next, ...moving]
    return [{ ...next, children: placement.kind === 'child' ? [...moving, ...next.children] : [...next.children, ...moving] } as T]
  })
  return insert(strip(document))
}

/** Uma linha visível do editor sob o ponteiro (conteúdo de um bloco ou o placeholder do toggle vazio). */
export interface DropRow {
  id: string
  placeholder: boolean
  top: number; bottom: number; left: number; right: number
  /** Caixa usada pelo drop lateral de colunas (o bloco, ou a coluna que o contém). */
  blockLeft: number; blockRight: number
  childrenVisible: boolean
  open: boolean
}

/** Escolhe a linha mais específica sob o ponteiro (placeholder > linha que contém x > mais próxima). */
export function pickDropRow(rows: readonly DropRow[], x: number, y: number): DropRow | null {
  const containing = rows.filter((row) => y >= row.top && y <= row.bottom)
  const pool = containing.length ? containing : rows.filter((row) => Math.min(Math.abs(y - row.top), Math.abs(y - row.bottom)) <= 10)
  if (!pool.length) return null
  const distanceX = (row: DropRow) => x < row.left ? row.left - x : x > row.right ? x - row.right : 0
  return [...pool].sort((a, b) => Number(b.placeholder) - Number(a.placeholder) || distanceX(a) - distanceX(b) || (a.bottom - a.top) - (b.bottom - b.top))[0]
}

export type DropDecision =
  | { action: 'move'; placement: DropPlacement }
  | { action: 'columns'; edge: 'left' | 'right'; x: number; targetId: string }
  | { action: 'reject' }
  | { action: 'default' }

/**
 * Regra (tipo Export Bundle): metade superior = antes; metade inferior = depois, ou
 * dentro (primeiro filho) quando o bloco já mostra filhos, é um toggle aberto
 * ou o ponteiro está recuado para a direita num contêiner. O placeholder do
 * toggle vazio sempre recebe o bloco. A calha à esquerda (onde fica a alça)
 * reordena; só a faixa estreita na borda do bloco e a borda direita criam colunas.
 */
export function decideDrop(document: readonly TreeBlock[], sourceIds: readonly string[], row: DropRow | null, x: number, y: number, synthetic = false): DropDecision {
  if (!row || !sourceIds.length) return { action: 'default' }
  const target = findBlock(document, row.id)
  if (!target) return { action: 'default' }
  let placement: DropPlacement
  if (row.placeholder) placement = { kind: 'child', targetId: row.id }
  else {
    const edge = !synthetic && x >= row.blockLeft && x < row.blockLeft + COLUMN_EDGE ? 'left' : x >= row.blockRight - (row.blockRight - row.blockLeft) * 0.1 ? 'right' : null
    if (edge) return planColumnDrop(document, sourceIds, row.id, edge) ? { action: 'columns', edge, x: edge === 'left' ? row.blockLeft : x, targetId: row.id } : { action: 'reject' }
    const lower = y >= (row.top + row.bottom) / 2
    if (!lower) placement = { kind: 'before', targetId: row.id }
    else if (target.block.children.length && row.childrenVisible) placement = { kind: 'child', targetId: row.id }
    else if (acceptsChildren(target.block) && (row.open || x >= row.left + DROP_INDENT)) placement = { kind: 'child', targetId: row.id }
    else placement = { kind: 'after', targetId: row.id }
  }
  return validDropPlacement(document, sourceIds, placement) ? { action: 'move', placement } : { action: 'reject' }
}

/** Linhas do editor perto do ponteiro, lidas do DOM (ignora editores aninhados, ex.: bloco sincronizado). */
export function domDropRows(view: EditorView, x: number, y: number): DropRow[] {
  const root = view.dom as HTMLElement
  const doc = root.ownerDocument
  if (typeof doc.elementsFromPoint !== 'function') return []
  const box = root.getBoundingClientRect()
  const xs = [x, box.left + 60, box.left + box.width * 0.3, box.left + box.width * 0.55, box.left + box.width * 0.8].filter((value) => value >= box.left && value <= box.right)
  const found = new Map<Element, DropRow>()
  for (const probeY of [y, y - 8, y + 8]) {
    for (const probeX of xs) {
      for (const element of doc.elementsFromPoint(probeX, probeY)) {
        const rowElement = element.closest('.bn-toggle-add-block-button, .bn-block-content')
        if (!rowElement || found.has(rowElement) || rowElement.closest('.bn-editor') !== root) continue
        const row = rowFromElement(rowElement)
        if (row) found.set(rowElement, row)
      }
    }
    if ([...found.values()].some((row) => probeY === y && y >= row.top && y <= row.bottom)) break
  }
  return [...found.values()]
}

function rowFromElement(element: Element): DropRow | null {
  const block = element.closest<HTMLElement>('.bn-block[data-id]')
  const outer = block?.closest('.bn-block-outer')
  if (!block?.dataset.id || !outer) return null
  const placeholder = element.classList.contains('bn-toggle-add-block-button')
  // O conteúdo de um toggle inclui o placeholder; a linha "própria" é o cabeçalho.
  const header = placeholder ? element : element.querySelector(':scope .bn-toggle-wrapper') ?? element
  const rect = header.getBoundingClientRect()
  const column = outer.parentElement?.classList.contains('bn-block-column') ? outer.parentElement : null
  const frame = (column ?? outer).getBoundingClientRect()
  const group = block.querySelector(':scope > .bn-block-group')
  return {
    id: block.dataset.id, placeholder,
    top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
    blockLeft: frame.left, blockRight: frame.right,
    childrenVisible: !!group && group.getBoundingClientRect().height > 0,
    open: element.querySelector('.bn-toggle-wrapper')?.getAttribute('data-show-children') === 'true',
  }
}

type DropEditor = {
  document: TreeBlock[]
  getBlock(id: string): TreeBlock | undefined
  transact<T>(fn: () => T): T
  removeBlocks(ids: string[]): unknown
  insertBlocks(blocks: unknown[], reference: string, placement: 'before' | 'after'): unknown
  updateBlock(id: string, update: { children: unknown[] }): unknown
}

/** Move os blocos numa única transação (um passo de desfazer), mantendo IDs e props (ex.: pageId do banco). */
export function applyDropPlacement(editor: DropEditor, sourceIds: readonly string[], placement: DropPlacement): boolean {
  if (!validDropPlacement(editor.document, sourceIds, placement)) return false
  const blocks = sourceIds.map((id) => editor.getBlock(id)).filter((block): block is TreeBlock => !!block)
  if (blocks.length !== sourceIds.length) return false
  try {
    editor.transact(() => {
      editor.removeBlocks([...sourceIds])
      if (placement.kind === 'before' || placement.kind === 'after') { editor.insertBlocks(blocks, placement.targetId, placement.kind); return }
      const target = editor.getBlock(placement.targetId)!
      if (!target.children.length) editor.updateBlock(placement.targetId, { children: blocks })
      else if (placement.kind === 'child') editor.insertBlocks(blocks, target.children[0].id, 'before')
      else editor.insertBlocks(blocks, target.children[target.children.length - 1].id, 'after')
    })
  } catch {
    // O schema recusou o destino: nada foi aplicado (a transação só é enviada no fim).
    return true
  }
  return true
}

/** Posição ProseMirror da linha azul para um destino. */
export function dropCursorPos(view: EditorView, placement: DropPlacement): number | null {
  const info = getNodeById(placement.targetId, view.state.doc)
  if (!info) return null
  const { node, posBeforeNode } = info
  if (placement.kind === 'before') return posBeforeNode
  if (placement.kind === 'after') return posBeforeNode + node.nodeSize
  const content = node.firstChild
  if (!content) return null
  const group = node.childCount > 1 ? node.child(1) : null
  if (!group) return posBeforeNode + 1 + content.nodeSize
  return placement.kind === 'child' ? posBeforeNode + 1 + content.nodeSize + 1 : posBeforeNode + node.nodeSize - 2
}

export type Geometry = (view: EditorView, x: number, y: number) => DropRow[]
const draggedIdsCache = new WeakMap<Slice, string[]>()
function draggedIds(slice: Slice | null | undefined): string[] {
  if (!slice) return []
  const cached = draggedIdsCache.get(slice)
  if (cached) return cached
  let ids: string[] = []
  try { ids = fragmentToBlocks(slice.content).map((block) => block.id).filter(Boolean) } catch { ids = [] }
  draggedIdsCache.set(slice, ids)
  return ids
}

const geometries = new WeakMap<object, Geometry>()
const markChildCursor = (on: boolean) => {
  if (typeof document === 'undefined') return
  if (on) document.documentElement.setAttribute('data-pg-drop-child', '')
  else document.documentElement.removeAttribute('data-pg-drop-child')
}

function decideForEvent(editor: { document: TreeBlock[] }, view: EditorView, event: { clientX: number; clientY: number }, slice: Slice | null | undefined): DropDecision {
  const ids = draggedIds(slice)
  if (!ids.length || ids.some((id) => !getNodeById(id, view.state.doc))) return { action: 'default' }
  const synthetic = (event as { synthetic?: boolean }).synthetic === true
  const geometry = geometries.get(editor) ?? domDropRows
  const row = pickDropRow(geometry(view, event.clientX, event.clientY), event.clientX, event.clientY)
  return decideDrop(editor.document, ids, row, event.clientX, event.clientY, synthetic)
}

/** Linha azul: a mesma decisão do drop; as bordas mostram a linha vertical de colunas. */
export const blockDropCursor: { hooks: DropCursorHooks } = {
  hooks: {
    computeDropPosition: (context) => {
      const { view, event } = context
      const decision = decideForEvent(context.editor as never, view, event, view.dragging?.slice)
      markChildCursor(false)
      if (decision.action === 'reject') return null
      if (decision.action === 'move') {
        const pos = dropCursorPos(view, decision.placement)
        if (pos === null) return context.defaultPosition
        const target = getNodeById(decision.placement.targetId, view.state.doc)
        markChildCursor(decision.placement.kind === 'child' && (target?.node.childCount ?? 0) < 2)
        return { pos, orientation: 'block-horizontal' }
      }
      if (decision.action === 'columns') {
        return columnDropCursor(view, (context.editor as unknown as { document: TreeBlock[] }).document, draggedIds(view.dragging?.slice), decision.targetId, decision.edge)
      }
      return context.defaultPosition
    },
  },
}

export const BlockDropExtension = createExtension(({ editor, options }: { editor: object; options?: { geometry?: Geometry } }) => {
  if (options?.geometry) geometries.set(editor as object, options.geometry)
  return {
    key: 'blockDrop',
    prosemirrorPlugins: [new Plugin({
      view: () => {
        const clear = () => markChildCursor(false)
        document.addEventListener('dragend', clear, true)
        document.addEventListener('drop', clear, true)
        return { destroy() { document.removeEventListener('dragend', clear, true); document.removeEventListener('drop', clear, true); clear() } }
      },
      props: {
        handleDrop(view, event, slice, moved) {
          // A alça do BlockNote marca o arraste com o próprio formato; alguns
          // Chromium reportam esse drop com `moved=false`. Só tratamos blocos
          // que já existem neste editor (mover, nunca copiar de fora).
          const sideMenuDrag = Array.from(event.dataTransfer?.types ?? []).includes('blocknote/html')
          if (!moved && !sideMenuDrag) return false
          // Fora da área dos blocos o BlockNote reenvia um drop sintético (com
          // x ajustado); o original chega depois, já tratado.
          if (event.defaultPrevented && !(event as { synthetic?: boolean }).synthetic) return true
          const decision = decideForEvent(editor as never, view, event, slice)
          if (decision.action === 'reject') return true
          if (decision.action === 'columns') return applyColumnDrop(editor as never, draggedIds(slice), decision.targetId, decision.edge)
          if (decision.action !== 'move') return false
          return applyDropPlacement(editor as never, draggedIds(slice), decision.placement)
        },
      },
    })],
  } as const
})

/** Nome antigo mantido para compatibilidade. */
export const ListDropNestingExtension = BlockDropExtension
