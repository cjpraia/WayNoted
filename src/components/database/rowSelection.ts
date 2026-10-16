// Seleção de linhas como no Export Bundle: por id (sobrevive a ordenação, agrupamento e virtualização),
// clique alterna, Shift estende do último clicado, "selecionar tudo" usa a lista filtrada inteira
// (inclusive linhas além do "Carregar mais" e fora da tela) sem renderizá-las.
import { useMemo, useRef, useState } from 'react'

export interface RowSelection {
  ids: ReadonlySet<string>
  size: number
  has: (id: string) => boolean
  /** `range` (Shift) estende do último clicado; senão alterna só esta linha. */
  toggle: (id: string, range?: boolean) => void
  /** Marca todas se alguma faltar; senão limpa (checkbox do cabeçalho). */
  toggleAll: () => void
  selectAll: () => void
  /** Teclado (Shift+setas): substitui a seleção pelo intervalo `from`…`to` na ordem exibida. */
  selectRange: (from: string, to: string) => void
  clear: () => void
  /** 'none' | 'some' (indeterminado) | 'all' em relação à lista atual. */
  state: 'none' | 'some' | 'all'
}

/** Alterna `id`, ou (com `anchor`) adiciona o intervalo entre `anchor` e `id` na ordem exibida. */
export function toggleSelection(selected: ReadonlySet<string>, order: readonly string[], id: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(selected)
  if (range && anchor && anchor !== id) {
    const from = order.indexOf(anchor), to = order.indexOf(id)
    if (from >= 0 && to >= 0) {
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(order[i])
      return next
    }
  }
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Mantém só ids ainda presentes na lista (linhas excluídas ou filtradas saem da seleção). */
export function pruneSelection(selected: ReadonlySet<string>, order: readonly string[]): ReadonlySet<string> {
  if (!selected.size) return selected
  const present = new Set(order)
  let changed = false
  const next = new Set<string>()
  for (const id of selected) { if (present.has(id)) next.add(id); else changed = true }
  return changed ? next : selected
}

export function selectionState(selected: ReadonlySet<string>, order: readonly string[]): 'none' | 'some' | 'all' {
  if (!selected.size || !order.length) return 'none'
  let count = 0
  for (const id of order) if (selected.has(id)) count++
  return count === 0 ? 'none' : count === order.length ? 'all' : 'some'
}

/** Estado React da seleção sobre `order` (ids na ordem exibida). */
export function useRowSelection(order: readonly string[]): RowSelection {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order
  const ids = pruneSelection(raw, order)
  const state = selectionState(ids, order)
  return useMemo<RowSelection>(() => ({
    ids,
    size: ids.size,
    has: (id) => ids.has(id),
    toggle: (id, range = false) => {
      // O atualizador roda depois (na renderização): captura a âncora antes de trocá-la.
      const from = anchor.current
      setRaw((cur) => toggleSelection(pruneSelection(cur, orderRef.current), orderRef.current, id, from, range))
      anchor.current = id
    },
    toggleAll: () => { setRaw((cur) => selectionState(pruneSelection(cur, orderRef.current), orderRef.current) === 'all' ? new Set() : new Set(orderRef.current)); anchor.current = null },
    selectAll: () => { setRaw(new Set(orderRef.current)); anchor.current = null },
    selectRange: (from, to) => {
      const order = orderRef.current, a = order.indexOf(from), b = order.indexOf(to)
      if (a < 0 || b < 0) return
      setRaw(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)))
      anchor.current = from
    },
    clear: () => { setRaw(new Set()); anchor.current = null },
    state,
  }), [ids, state])
}
