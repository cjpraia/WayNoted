// Modelos prontos de consulta e o formato das props do bloco "query".
import type { FilterOp } from '../types'
import { defaultQuery, serializeQueryJson, type Query, type QueryRule, type QueryValue } from './model.ts'
import { serializeQuery, type SerializeContext } from './text.ts'

export type QueryTemplateId = 'open-tasks' | 'edited-this-week' | 'backlinks' | 'overdue-rows' | 'tasks-of-day' | 'blank'
export const QUERY_TEMPLATES: { id: QueryTemplateId; pt: string; en: string; aliases: string[] }[] = [
  { id: 'open-tasks', pt: 'Tarefas em aberto', en: 'Open tasks', aliases: ['tarefas_em_aberto', 'open_tasks', 'tarefas', 'tasks'] },
  { id: 'edited-this-week', pt: 'Editadas esta semana', en: 'Edited this week', aliases: ['editadas_esta_semana', 'edited_this_week', 'recentes', 'recent'] },
  { id: 'backlinks', pt: 'Backlinks desta página', en: 'Backlinks to this page', aliases: ['backlinks', 'mencoes', 'mentions'] },
  { id: 'overdue-rows', pt: 'Linhas atrasadas', en: 'Overdue rows', aliases: ['linhas_atrasadas', 'atrasadas', 'overdue', 'overdue_rows'] },
  { id: 'tasks-of-day', pt: 'Tarefas do dia', en: 'Tasks for the day', aliases: ['tarefas_do_dia', 'tasks_today', 'tarefas_de_hoje', 'today'] },
]

const rule = (field: string, op: FilterOp, value: QueryValue): QueryRule => ({ kind: 'rule', id: field.replace('@', '') + op, field, op, value })

/** Consulta de um modelo. `date` (AAAA-MM-DD) fixa o dia das "Tarefas do dia" (nota diária). */
export function queryTemplate(id: QueryTemplateId | string, options: { date?: string } = {}): Query {
  switch (id) {
    case 'open-tasks': return defaultQuery({ display: 'list', source: { kind: 'tasks' }, sorts: [{ field: '@due', direction: 'asc' }] })
    case 'edited-this-week': return defaultQuery({ display: 'table', source: { kind: 'pages' }, filter: { kind: 'group', id: 'root', operator: 'and', children: [rule('@updated', 'is', '@thisWeek')] }, sorts: [{ field: '@updated', direction: 'desc' }], limit: 50, columns: ['@title', '@parent', '@updated'] })
    case 'backlinks': return defaultQuery({ display: 'list', source: { kind: 'backlinks' }, sorts: [{ field: '@title', direction: 'asc' }] })
    case 'overdue-rows': return defaultQuery({ display: 'table', source: { kind: 'tasks' }, filter: { kind: 'group', id: 'root', operator: 'and', children: [rule('@due', 'lt', '@today')] }, sorts: [{ field: '@due', direction: 'asc' }], columns: ['@title', '@due', '@source'] })
    case 'tasks-of-day': return defaultQuery({ display: 'list', source: { kind: 'tasks', includeDone: true }, filter: { kind: 'group', id: 'root', operator: 'and', children: [rule('@due', 'is', options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : '@today')] }, sorts: [{ field: '@done', direction: 'asc' }, { field: '@due', direction: 'asc' }], columns: ['@title', '@source', '@done'] })
    case 'blank': return defaultQuery({ display: 'table', source: { kind: 'pages' }, sorts: [{ field: '@updated', direction: 'desc' }], limit: 20, columns: ['@title', '@type', '@parent', '@updated'] })
    default: return defaultQuery()
  }
}

export function templateByName(name: string): QueryTemplateId | null {
  const key = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_')
  return QUERY_TEMPLATES.find((template) => template.id === name || template.aliases.includes(key))?.id ?? null
}

/** Props do bloco: a consulta (fonte da verdade) + o texto (busca, exportação e leitura humana). */
export function queryBlockProps(query: Query, ctx: SerializeContext = {}): { query: string; text: string } {
  return { query: serializeQueryJson(query), text: serializeQuery(query, ctx) }
}
