// Fila única de avisos (toast). Não bloqueante, com "Desfazer" opcional, ≤ 4 s por padrão (Flow/Doherty).
// Puro (sem DOM): o componente <ToastHost> só desenha e agenda o fim de cada aviso.
import { useSyncExternalStore } from 'react'

export const TOAST_MS = 4000
export const TOAST_VISIBLE = 3

export interface ToastItem {
  id: number
  message: string
  /** Rótulo da ação (ex.: "Desfazer"); sem `onAction` não há botão. */
  actionLabel?: string
  onAction?: () => void
  /** Segunda ação opcional (ex.: "Não usar"). */
  secondaryLabel?: string
  onSecondary?: () => void
  tone: 'info' | 'error'
  duration: number
}
export interface ToastInput { message: string; actionLabel?: string; onAction?: () => void; secondaryLabel?: string; onSecondary?: () => void; tone?: ToastItem['tone']; duration?: number }

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(fn => fn())

/** Mostra um aviso. Mensagens idênticas e consecutivas substituem a anterior em vez de empilhar. */
export function showToast(input: ToastInput): number {
  const id = ++seq
  const item: ToastItem = { id, message: input.message, actionLabel: input.actionLabel, onAction: input.onAction, secondaryLabel: input.secondaryLabel, onSecondary: input.onSecondary, tone: input.tone ?? 'info', duration: Math.min(input.duration ?? TOAST_MS, 10000) }
  const last = items[items.length - 1]
  items = last && last.message === item.message && !last.onAction && !item.onAction ? [...items.slice(0, -1), item] : [...items, item]
  emit()
  return id
}

/** Atalho: ação já feita + "Desfazer". */
export function showUndoToast(message: string, undo: () => void, label = 'Desfazer'): number {
  return showToast({ message, actionLabel: label, onAction: undo })
}

export function dismissToast(id: number) {
  if (!items.some(item => item.id === id)) return
  items = items.filter(item => item.id !== id)
  emit()
}

export function clearToasts() { items = []; emit() }
/** Avisos em exibição (os demais esperam na fila). */
export function visibleToasts(): ToastItem[] { return items.slice(0, TOAST_VISIBLE) }
export function toastCount(): number { return items.length }

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const snapshot = () => items
export function useToasts(): ToastItem[] { return useSyncExternalStore(subscribe, snapshot, snapshot).slice(0, TOAST_VISIBLE) }
