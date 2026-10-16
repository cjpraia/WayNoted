// Posição do cursor pedida por {{cursor}}: guardada por página até o editor abrir (ou aplicada logo, se já aberto).
import { blockAtPath, type TemplateCursor } from './variables.ts'

const pending = new Map<string, { cursor: TemplateCursor; at: number }>()
const TTL_MS = 30_000
export function setPendingCursor(pageId: string, cursor: TemplateCursor | null) { if (cursor) pending.set(pageId, { cursor, at: Date.now() }); else pending.delete(pageId) }
export function takePendingCursor(pageId: string): TemplateCursor | null {
  const item = pending.get(pageId)
  if (!item || Date.now() - item.at > TTL_MS) { pending.delete(pageId); return null }
  return item.cursor
}
export function clearPendingCursor(pageId: string) { pending.delete(pageId) }
/** Ao abrir o editor: coloca o cursor pedido por {{cursor}} (se o modelo já está no documento). */
export function applyPendingCursor(pageId: string, editor: CursorEditor): boolean {
  const cursor = takePendingCursor(pageId)
  if (!cursor || !placeCursor(editor, cursor)) return false
  clearPendingCursor(pageId)
  return true
}

export interface CursorEditor {
  document: { id: string; children?: unknown[] }[]
  setTextCursorPosition: (block: string, placement?: 'start' | 'end') => void
  focus: () => void
}
/** Coloca o cursor. `offset` = índice do primeiro bloco inserido em `editor.document` (o modelo inserido é contíguo). */
export function placeCursor(editor: CursorEditor, cursor: TemplateCursor | null, offset = 0, count?: number): boolean {
  if (!cursor) return false
  try {
    const inserted = editor.document.slice(offset, count === undefined ? undefined : offset + count) as { id: string; children?: never[] }[]
    const block = blockAtPath(inserted, cursor.path)
    if (!block) return false
    editor.setTextCursorPosition(block.id, cursor.atEnd ? 'end' : 'start')
    editor.focus()
    return true
  } catch { return false }
}

export const hasPendingCursor = (pageId: string) => pending.has(pageId)
