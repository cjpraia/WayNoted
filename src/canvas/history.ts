// Desfazer/refazer do quadro: instantâneos do array de objetos com compartilhamento estrutural
// (objetos inalterados são as mesmas referências), então 200 passos com 2.000 objetos custam pouco.
import type { CanvasObject } from './model.ts'

export const HISTORY_LIMIT = 200
const COALESCE_MS = 1200

export class CanvasHistory {
  private past: { objects: readonly CanvasObject[]; key?: string; at: number }[] = []
  private future: (readonly CanvasObject[])[] = []

  /** Record `previous` before a change. Same `key` within 1.2 s (typing, nudging) merges into one step. */
  record(previous: readonly CanvasObject[], key?: string, now = Date.now()) {
    const last = this.past.at(-1)
    if (key && last?.key === key && now - last.at < COALESCE_MS) { last.at = now; this.future = []; return }
    this.past.push({ objects: previous, key, at: now })
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }

  undo(current: readonly CanvasObject[]): readonly CanvasObject[] | null {
    const step = this.past.pop()
    if (!step) return null
    this.future.push(current)
    return step.objects
  }

  redo(current: readonly CanvasObject[]): readonly CanvasObject[] | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push({ objects: current, at: 0 })
    return next
  }

  /** Breaks coalescing (e.g. after selection changes). */
  seal() { const last = this.past.at(-1); if (last) last.key = undefined }
  clear() { this.past = []; this.future = [] }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
}
