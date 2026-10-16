// Flow: ao trocar de aba/página e voltar, a rolagem e a seleção do editor voltam como estavam.
// Estado só em memória (por janela): chave = aba + rota. Puro; o DOM é tratado em ViewStateKeeper.
import type { Route } from '../types'

export interface ViewState { scrollTop: number; selection?: { from: number; to: number; focused: boolean } }
const MAX_ENTRIES = 200
const states = new Map<string, ViewState>()

export function routeStateKey(route: Route, tabId?: string | null): string {
  const id = (route as { id?: string }).id ?? ''
  return `${tabId ?? '-'}|${route.type}|${id}`
}
export function getViewState(key: string): ViewState | undefined { return states.get(key) }
export function patchViewState(key: string, patch: Partial<ViewState>) {
  const next = { scrollTop: 0, ...states.get(key), ...patch }
  states.delete(key); states.set(key, next)
  if (states.size > MAX_ENTRIES) states.delete(states.keys().next().value as string)
}
export function clearViewStates() { states.clear() }

/** O editor aberto registra como ler a seleção atual; é chamado ANTES da troca de rota (o DOM ainda é o antigo). */
type SelectionProvider = () => ViewState['selection'] | undefined
let selectionProvider: SelectionProvider | null = null
export function setSelectionProvider(provider: SelectionProvider | null) { selectionProvider = provider }
export function readSelection(): ViewState['selection'] | undefined { try { return selectionProvider?.() } catch { return undefined } }
