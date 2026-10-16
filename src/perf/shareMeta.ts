// Compartilhamento estrutural ao aplicar o meta devolvido pela gravação (ou vindo de outra janela).
// O meta chega clonado (IPC/JSON): sem isto, toda gravação trocaria a identidade das 50 mil páginas e
// invalidaria índices, caches de applyView e a memoização das linhas — re-render completo a cada 250 ms.
import { jsonEqual } from '../../electron/meta-merge.mjs'
import type { Page } from '../types'

/** Reaproveita os objetos de `prev` iguais (semântica JSON) aos de `next`. Devolve `prev` se nada mudou. */
export function sharePages(next: Record<string, Page>, prev: Record<string, Page>): Record<string, Page> {
  if (next === prev) return prev
  let changed = false, count = 0
  const out: Record<string, Page> = {}
  for (const id in next) {
    count++
    const before = prev[id], after = next[id]
    if (before === after || (before !== undefined && jsonEqual(before, after))) out[id] = before
    else { out[id] = after; changed = true }
  }
  if (!changed) {
    let prevCount = 0
    for (const _ in prev) prevCount++
    if (prevCount === count) return prev
  }
  return out
}

/** Mantém o valor anterior quando é igual ao novo (para objetos pequenos: settings, notificações…). */
export function shareValue<T>(next: T, prev: T): T {
  return next === prev || jsonEqual(next, prev) ? prev : next
}
