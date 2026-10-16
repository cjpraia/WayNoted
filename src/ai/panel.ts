// Estado do painel "Perguntar às suas notas" (⌘J), sem tocar na store compartilhada.
import { useSyncExternalStore } from 'react'

interface PanelState { open: boolean; selection: string; selectionPageId: string | null; nonce: number }
let state: PanelState = { open: false, selection: '', selectionPageId: null, nonce: 0 }
const listeners = new Set<() => void>()
const set = (patch: Partial<PanelState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }

/** Captura a seleção do editor no momento em que o painel abre (escopo "esta seleção"). */
function captureSelection(): { text: string; pageId: string | null } {
  try {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement
    const pageId = anchor?.closest<HTMLElement>('[data-page-id]')?.dataset.pageId ?? null
    return { text: text.slice(0, 20000), pageId: text ? pageId : null }
  } catch { return { text: '', pageId: null } }
}
export function openAskPanel() { const { text, pageId } = captureSelection(); set({ open: true, selection: text, selectionPageId: pageId, nonce: state.nonce + 1 }) }
export function closeAskPanel() { set({ open: false }) }
export function toggleAskPanel() { if (state.open) closeAskPanel(); else openAskPanel() }
export function useAskPanel(): PanelState { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state, () => state) }
