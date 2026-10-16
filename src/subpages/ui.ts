// Estado dos diálogos de conversão (aberto por menus, barra lateral e seção "Subpáginas"). Montado em <SubpagesHost/>.
import { useSyncExternalStore } from 'react'

export type SubpagesDialog =
  | { kind: 'subpages'; pageId: string }
  | { kind: 'page'; pageId: string }
  | { kind: 'selection'; ids: string[] }
  | { kind: 'move'; ids: string[] }
  | { kind: 'database-to-pages'; dbId: string }

let current: SubpagesDialog | null = null
const listeners = new Set<() => void>()
export function openSubpagesDialog(dialog: SubpagesDialog) { current = dialog; listeners.forEach((fn) => fn()) }
export function closeSubpagesDialog() { current = null; listeners.forEach((fn) => fn()) }
export function useSubpagesDialog(): SubpagesDialog | null { return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, () => current, () => current) }
