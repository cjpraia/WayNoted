// Colunas do editor — operações sobre o editor (inserir, soltar bloco ao lado, desfazer, excluir).
//
// CÓDIGO PRÓPRIO do aplicativo (clean room; só API pública MPL-2.0 do @blocknote/core). Ver docs/LICENSING.md.
// Cada operação é uma única transação (um passo de ⌘Z).
import { getNodeById } from '@blocknote/core'
import type { EditorView } from 'prosemirror-view'
import { COLUMN, MAX_COLUMNS, assertColumnCount, buildColumnList, dissolveColumns, enclosingColumnList, listWeights, newColumnWeight, planColumnDrop, type ColumnEdge, type TreeBlock } from './model.ts'

export interface ColumnEditor {
  document: TreeBlock[]
  getBlock(id: string): TreeBlock | undefined
  getParentBlock(id: string): TreeBlock | undefined
  getTextCursorPosition(): { block: TreeBlock }
  setTextCursorPosition(id: string, placement?: 'start' | 'end'): void
  transact<T>(fn: () => T): T
  removeBlocks(ids: string[]): unknown
  insertBlocks(blocks: unknown[], reference: string, placement: 'before' | 'after'): unknown
  replaceBlocks(remove: string[], insert: unknown[]): unknown
}

const uuid = () => globalThis.crypto.randomUUID()
const isEmptyParagraph = (block: TreeBlock) => block.type === 'paragraph' && (!Array.isArray(block.content) || block.content.length === 0) && !block.children.length

function insideColumn(editor: ColumnEditor, id: string): boolean {
  for (let parent = editor.getParentBlock(id); parent; parent = editor.getParentBlock(parent.id)) if (parent.type === COLUMN) return true
  return false
}

export interface ColumnMessages { nested: string }
const DEFAULT_MESSAGES: ColumnMessages = { nested: 'Colunas não cabem dentro de colunas.' }

/** Slash menu: insere `count` colunas vazias (substitui o parágrafo vazio ou entra depois do bloco atual) e põe o cursor na primeira. */
export function insertColumns(editor: ColumnEditor, count: number, messages: ColumnMessages = DEFAULT_MESSAGES, at?: string): string {
  assertColumnCount(count)
  const current = at ? editor.getBlock(at) ?? editor.getTextCursorPosition().block : editor.getTextCursorPosition().block
  if (insideColumn(editor, current.id)) throw new Error(messages.nested)
  const ids = Array.from({ length: count }, uuid)
  const list = buildColumnList(count, ids.map((id) => [{ type: 'paragraph', id }]))
  editor.transact(() => {
    if (isEmptyParagraph(current)) editor.replaceBlocks([current.id], [list])
    else editor.insertBlocks([list], current.id, 'after')
  })
  try { editor.setTextCursorPosition(ids[0], 'start') } catch { /* sem DOM: a seleção fica onde estava */ }
  return ids[0]
}

/** Converte o bloco numa lista de colunas; o conteúdo vai para a primeira coluna (usado por "Transformar em"). */
export function assertCanConvertToColumns(editor: ColumnEditor, id: string, messages: ColumnMessages = DEFAULT_MESSAGES): void {
  if (insideColumn(editor, id)) throw new Error(messages.nested)
}

/**
 * Solta `sourceIds` na borda esquerda/direita de `targetId`:
 * - bloco solto → vira uma lista de colunas [alvo | arrastados] (ou [arrastados | alvo]);
 * - bloco dentro de uma coluna → nova coluna ao lado dela.
 * Os blocos de origem são removidos antes (colunas esvaziadas somem; uma coluna sozinha se desfaz).
 */
export function applyColumnDrop(editor: ColumnEditor, sourceIds: readonly string[], targetId: string, edge: ColumnEdge): boolean {
  if (!planColumnDrop(editor.document, sourceIds, targetId, edge)) return false
  const moving = sourceIds.map((id) => editor.getBlock(id))
  if (moving.some((block) => !block)) return false
  const blocks = moving.map((block) => structuredClone(block!)) as TreeBlock[]
  let ok = false
  editor.transact(() => {
    editor.removeBlocks([...sourceIds])
    // O estado mudou (colunas podem ter sumido): decide de novo sobre o documento já sem a origem.
    const plan = replan(editor, targetId, edge)
    if (!plan) return
    if (plan.kind === 'new-column') {
      const list = enclosingColumnList(editor.document, plan.columnId)
      const weight = list ? newColumnWeight(listWeights(list)) : 1
      const column = { type: COLUMN, props: { width: weight }, children: blocks }
      editor.insertBlocks([column], plan.columnId, edge === 'left' ? 'before' : 'after')
    } else {
      const target = editor.getBlock(plan.targetId)
      if (!target) return
      const own = structuredClone(target)
      const sides = edge === 'left' ? [blocks, [own]] : [[own], blocks]
      editor.replaceBlocks([plan.targetId], [buildColumnList(2, sides)])
    }
    ok = true
  })
  if (!ok) return true
  try { editor.setTextCursorPosition(blocks[0].id, 'start') } catch { /* sem DOM */ }
  return true
}

/** Plano sobre o documento já sem os blocos de origem (os ids de origem não existem mais). */
function replan(editor: ColumnEditor, targetId: string, edge: ColumnEdge) {
  const target = editor.getBlock(targetId)
  if (!target) return null
  const parent = editor.getParentBlock(targetId)
  if (parent?.type === COLUMN) {
    const list = enclosingColumnList(editor.document, parent.id)
    return list && list.children.length >= MAX_COLUMNS ? null : { kind: 'new-column' as const, columnId: parent.id, edge }
  }
  if (insideColumn(editor, targetId)) return null
  return { kind: 'new-list' as const, targetId, edge }
}

/** Posição (e lado) da linha vertical de soltar, ou null quando o drop seria recusado. */
export function columnDropCursor(view: EditorView, document: readonly TreeBlock[], sourceIds: readonly string[], targetId: string, edge: ColumnEdge) {
  const plan = planColumnDrop(document, sourceIds, targetId, edge)
  if (!plan) return null
  const info = getNodeById(plan.kind === 'new-column' ? plan.columnId : plan.targetId, view.state.doc)
  if (!info) return null
  return { pos: info.posBeforeNode, orientation: edge === 'left' ? 'block-vertical-left' as const : 'block-vertical-right' as const }
}

/** "Desfazer colunas": os blocos de todas as colunas viram blocos soltos, na ordem, no lugar da lista. */
export function undoColumns(editor: ColumnEditor, blockId: string): boolean {
  const list = enclosingColumnList(editor.document, blockId)
  if (!list) return false
  const loose = dissolveColumns(list).map((block) => structuredClone(block))
  editor.transact(() => { editor.replaceBlocks([list.id], loose.length ? loose : [{ type: 'paragraph' }]) })
  return true
}

/** "Excluir colunas": remove a lista inteira com todo o conteúdo. */
export function deleteColumns(editor: ColumnEditor, blockId: string): boolean {
  const list = enclosingColumnList(editor.document, blockId)
  if (!list) return false
  editor.transact(() => { editor.removeBlocks([list.id]) })
  return true
}
