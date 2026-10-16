// Desfazer/refazer de ações de banco de dados por transação: cada entrada guarda o antes/depois dos campos
// das páginas afetadas (linha, banco). O armazenamento é injetado pelo store; este módulo não conhece o estado.
export type PageSnap = Record<string, unknown> | null
export type UndoSnap = Record<string, PageSnap>
export interface UndoEntry {
  label: string; key: string; at: number; before: UndoSnap; after: UndoSnap
  /** Transação estrutural (conversões de páginas/bancos): também desfeita fora de telas de banco (⌘Z global). */
  structural?: boolean
  /** Efeitos fora dos campos das páginas (ex.: bloco do banco no corpo da página). */
  onUndo?: () => void
  onRedo?: () => void
}

const LIMIT = 50
const MERGE_MS = 1000

export function createUndoStack() {
  let undo: UndoEntry[] = []
  let redo: UndoEntry[] = []
  return {
    /** Registra uma transação; edições seguidas da mesma coisa (mesma chave) em < 1 s viram uma só. */
    push(entry: UndoEntry) {
      const last = undo[undo.length - 1]
      if (last && last.key === entry.key && entry.at - last.at < MERGE_MS) undo[undo.length - 1] = { ...last, at: entry.at, after: entry.after }
      else undo = [...undo, entry].slice(-LIMIT)
      redo = []
    },
    popUndo(): UndoEntry | undefined { const e = undo.pop(); if (e) redo.push(e); return e },
    popRedo(): UndoEntry | undefined { const e = redo.pop(); if (e) undo.push(e); return e },
    peekUndo: (): UndoEntry | undefined => undo[undo.length - 1],
    peekRedo: (): UndoEntry | undefined => redo[redo.length - 1],
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    clear() { undo = []; redo = [] },
  }
}

export function snapsDiffer(a: UndoSnap, b: UndoSnap): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const id of ids) {
    const x = a[id], y = b[id]
    if (x === y) continue
    if (!x || !y) return true
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) return true
  }
  return false
}
