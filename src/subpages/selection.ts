// Seleção múltipla de páginas na barra lateral (⌘-clique alterna, ⇧-clique seleciona o intervalo entre irmãos,
// Esc limpa). Estado fora do React (useSyncExternalStore) para valer também na árvore virtualizada.
import { useSyncExternalStore } from 'react'
import { getState, selectors } from '../store.ts'

export interface SelectionState { ids: readonly string[]; anchor: string | null }
const EMPTY: SelectionState = { ids: [], anchor: null }
let state: SelectionState = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const set = (next: SelectionState) => { state = next; emit() }

export type SelectionOutcome = 'ok' | 'level'

const parentOf = (id: string) => getState().pages[id]?.parentId ?? null

/** Alterna `id`. Recusa ('level') páginas de outro nível: a seleção só mistura irmãos. */
export function toggleSelected(id: string): SelectionOutcome {
  if (state.ids.includes(id)) { const ids = state.ids.filter((x) => x !== id); set(ids.length ? { ids, anchor: id } : EMPTY); return 'ok' }
  if (state.ids.length && parentOf(state.ids[0]) !== parentOf(id)) return 'level'
  set({ ids: [...state.ids, id], anchor: id })
  return 'ok'
}

/** Seleciona do âncora até `id` entre irmãos (na ordem da árvore). Sem âncora, seleciona só `id`. */
export function selectRange(id: string, fallbackAnchor: string | null = null): SelectionOutcome {
  const anchor = state.anchor ?? state.ids[state.ids.length - 1] ?? (fallbackAnchor && getState().pages[fallbackAnchor] ? fallbackAnchor : null)
  if (!anchor) { set({ ids: [id], anchor: id }); return 'ok' }
  if (parentOf(anchor) !== parentOf(id)) { if (!state.ids.length) { set({ ids: [id], anchor: id }); return 'ok' } return 'level' }
  const siblings = selectors.childrenShared(parentOf(id)).map((p) => p.id)
  const a = siblings.indexOf(anchor), b = siblings.indexOf(id)
  if (a < 0 || b < 0) { set({ ids: [id], anchor: id }); return 'ok' }
  set({ ids: siblings.slice(Math.min(a, b), Math.max(a, b) + 1), anchor })
  return 'ok'
}

export function clearSelection() { if (state.ids.length) set(EMPTY) }
export function selectedIds(): readonly string[] { return state.ids }
export function isSelected(id: string) { return state.ids.includes(id) }
/** Remove da seleção páginas que saíram da árvore (excluídas, movidas para outro nível). */
export function pruneSelection() {
  const pages = getState().pages
  const live = state.ids.filter((id) => pages[id] && selectors.isLive(id))
  const parent = live.length ? parentOf(live[0]) : null
  const same = live.filter((id) => parentOf(id) === parent)
  if (same.length !== state.ids.length) set(same.length ? { ids: same, anchor: same.includes(state.anchor ?? '') ? state.anchor : same[0] } : EMPTY)
}
export function useSelection(): SelectionState { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => state, () => state) }
