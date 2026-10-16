// Lista de tipos vigente para módulos que não importam a store (índice de busca, grafo).
// A store chama `setRegisteredTypes` quando `settings.objectTypes` muda. Sem dependências.
import type { ObjectType } from './model.ts'

const EMPTY: readonly ObjectType[] = Object.freeze([])
let current: readonly ObjectType[] = EMPTY
let version = 0

export function setRegisteredTypes(types: readonly ObjectType[] | undefined): void {
  const next = types ?? EMPTY
  if (next === current) return
  current = next
  version++
}
export function registeredTypes(): readonly ObjectType[] { return current }
/** Muda sempre que a lista muda (assinatura barata para caches). */
export function registeredTypesVersion(): number { return version }
