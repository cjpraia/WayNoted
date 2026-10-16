import COMPAT from '../../shared/compatibility.ts'
// Estado do modo foco (fora da store: é preferência de visualização desta janela).
import { useSyncExternalStore } from 'react'

export interface FocusState { active: boolean; highlight: boolean; typewriter: boolean }
const KEY = COMPAT.record049

function readOptions(): Pick<FocusState, 'highlight' | 'typewriter'> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { highlight: value.highlight === true, typewriter: value.typewriter === true }
  } catch { return { highlight: false, typewriter: false } }
}

let state: FocusState = { active: false, ...readOptions() }
const listeners = new Set<() => void>()
let lastKey = 0
function set(patch: Partial<FocusState>) {
  state = { ...state, ...patch }
  if ('highlight' in patch || 'typewriter' in patch) {
    try { localStorage.setItem(KEY, JSON.stringify({ highlight: state.highlight, typewriter: state.typewriter })) } catch { /* sem armazenamento: só nesta sessão */ }
  }
  listeners.forEach(listener => listener())
}

export const focusMode = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  toggle(force?: boolean) { set({ active: force ?? !state.active }) },
  /** ⌘⇧F recebido pela página. */
  fromKey() { lastKey = Date.now(); set({ active: !state.active }) },
  /** Item "Modo foco" do menu Visualizar; ignora o eco do mesmo atalho já tratado pela página. */
  fromCommand() { if (Date.now() - lastKey > 400) set({ active: !state.active }) },
  setHighlight(value: boolean) { set({ highlight: value }) },
  setTypewriter(value: boolean) { set({ typewriter: value }) },
}

export function useFocusMode(): FocusState { return useSyncExternalStore(focusMode.subscribe, focusMode.get, focusMode.get) }

/** Palavras de um texto (letras/números unidos; pontuação solta não conta). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
}
