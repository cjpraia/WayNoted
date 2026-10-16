// Estado de interface dos tipos de objeto (diálogos, avisos): fora da store para não ser gravado.
import { useSyncExternalStore } from 'react'
import { showToast } from '../components/ui/toastQueue.ts'
import { actions, getState } from '../store.ts'
import type { ObjectTypesPrefs } from '../types'
import type { ExtraField } from './adjust.ts'

export type ManagerTab = 'fields' | 'template'
export interface TypesUiState {
  /** Painel "Editar tipo" (com `typeId`) ou gerenciador com a lista de tipos (sem `typeId`). */
  manager: { typeId?: string; tab?: ManagerTab; nonce?: number } | null
  /** Escolha de tipo para aplicar a páginas. */
  picker: { pageIds: string[]; anchor?: { x: number; y: number } | null } | null
  /** Galeria "Explorar tipos" (com `pageIds`, "Usar" também aplica nessas páginas). */
  gallery: { pageIds?: string[] } | null
  /** Confirmação leve na primeira vez que um tipo é aplicado. */
  confirmApply: { pageId: string; typeId: string } | null
  /** "Incorporar campos da página ao tipo?" — a página tem campos que o tipo não tem. */
  incorporate: { pageIds: string[]; typeId: string; includeChildren: boolean; fields: ExtraField[]; options: { confirmed?: boolean; template?: boolean } } | null
  /** Guia "Página, Banco ou Tipo?". */
  guide: boolean
  /** "Revisar tipos": campos das páginas que os tipos ainda não têm (docs/USAGE.md, "Campos retroativos"). */
  review: boolean
}

let state: TypesUiState = { manager: null, picker: null, gallery: null, confirmApply: null, incorporate: null, guide: false, review: false }
const listeners = new Set<() => void>()
let seq = 0

export function typesUi(): TypesUiState { return state }
export function patchTypesUi(patch: Partial<TypesUiState>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()) }
export function subscribeTypesUi(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useTypesUi(): TypesUiState { return useSyncExternalStore(subscribeTypesUi, typesUi, typesUi) }

/** Com `typeId`: painel simplificado "Editar tipo". Sem: gerenciador (lista de tipos). */
export function openTypesManager(typeId?: string, tab?: ManagerTab) { patchTypesUi({ manager: { typeId, tab, nonce: ++seq } }) }
export function openTypePicker(pageIds: string[], anchor?: { x: number; y: number } | null) { patchTypesUi({ picker: { pageIds, anchor } }) }
export function openTypesGallery(pageIds?: string[]) { patchTypesUi({ gallery: { pageIds }, picker: null }) }
export function openTypesGuide() { patchTypesUi({ guide: true }) }
export function openTypesReview() { patchTypesUi({ review: true }) }
/** Abre a coleção do tipo como tela própria (rota `objectType`). */
export function openTypeCollection(typeId: string, newTab = false) {
  patchTypesUi({ manager: null, gallery: null, picker: null })
  if (newTab) actions.openInNewTab({ type: 'objectType', id: typeId })
  else actions.navigate({ type: 'objectType', id: typeId })
}
/** Aviso informativo na fila única de toasts (o "Desfazer" é ligado em actions.ts). */
export function showTypesToast(message: string, onUndo?: () => void) { showToast({ message, actionLabel: onUndo ? (getState().settings.locale === 'en-US' ? 'Undo' : 'Desfazer') : undefined, onAction: onUndo, duration: onUndo ? 6000 : undefined }) }

export function typesPrefs(): ObjectTypesPrefs { return getState().settings.objectTypesPrefs ?? {} }
export function setTypesPrefs(patch: Partial<ObjectTypesPrefs>) { actions.updateSettings({ objectTypesPrefs: { ...typesPrefs(), ...patch } }) }
