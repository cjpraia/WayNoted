// Arrastar uma tarefa para o painel de calendário (E2). O estado fica no módulo porque o navegador não deixa ler
// `dataTransfer` durante o arrasto; no soltar, o tipo MIME próprio confirma que veio do aplicativo.
import { useSyncExternalStore, type DragEvent } from 'react'
import type { TaskItem } from './taskCore.ts'

export const TASK_MIME = "application/x-workspace-task"

let dragging: string | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const listener of listeners) listener() }

export function beginTaskDrag(event: DragEvent, item: Pick<TaskItem, 'key' | 'title'>) {
  dragging = item.key
  event.dataTransfer.effectAllowed = 'copyMove'
  event.dataTransfer.setData(TASK_MIME, item.key)
  event.dataTransfer.setData('text/plain', item.title)
  emit()
}
export function endTaskDrag() { if (dragging !== null) { dragging = null; emit() } }

/** Props para a linha arrastável. */
export const taskDragProps = (item: Pick<TaskItem, 'key' | 'title'>) => ({ draggable: true as const, onDragStart: (event: DragEvent) => beginTaskDrag(event, item), onDragEnd: endTaskDrag })

/** Chave da tarefa arrastada (null = outro tipo de arrasto). */
export function draggedTaskKey(event?: DragEvent): string | null {
  if (dragging) return dragging
  const key = event?.dataTransfer?.getData(TASK_MIME)
  return key || null
}
export const hasTaskDrag = (event: DragEvent) => dragging !== null || [...(event.dataTransfer?.types ?? [])].includes(TASK_MIME)

export function useTaskDrag(): string | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => dragging, () => null)
}
