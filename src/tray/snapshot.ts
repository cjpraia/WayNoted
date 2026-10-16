// Retrato das tarefas de hoje para o menu da barra de menus (C3a). Puro: sem store, sem React.
// Sai do computador? Não: vai por IPC ao processo principal do mesmo app. Mesmo assim, o menu fica visível na tela inteira,
// então tarefas de páginas protegidas por senha (a própria ou ancestral, mesmo desbloqueada) e da lixeira nunca entram.
import { protectedAncestor } from '../security/pageLock.ts'
import type { Page } from '../types.ts'
import type { TaskBuckets, TaskItem } from '../tasks/taskCore.ts'

export const TRAY_TASK_LIMIT = 10
export interface TraySnapshot { items: { id: string; title: string; overdue: boolean }[]; total: number; overdue: number }

const visible = (item: TaskItem, pages: Record<string, Page>) => {
  const page = pages[item.pageId]
  return !!page && !page.trashed && !protectedAncestor(pages, item.pageId)
}

export function buildTraySnapshot(buckets: Pick<TaskBuckets, 'overdue' | 'today'>, pages: Record<string, Page>, limit = TRAY_TASK_LIMIT): TraySnapshot {
  const overdue = buckets.overdue.filter(item => visible(item, pages))
  const today = buckets.today.filter(item => visible(item, pages))
  const items = [...overdue, ...today].slice(0, limit).map(item => ({ id: item.key, title: item.title, overdue: item.due !== null && overdue.includes(item) }))
  return { items, total: overdue.length + today.length, overdue: overdue.length }
}
