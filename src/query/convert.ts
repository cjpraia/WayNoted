// "Abrir como banco": converte uma consulta de banco único numa visualização de banco vinculado
// (linkedSourceId) com os mesmos filtros (inclusive E/OU aninhados, "não (…)", datas relativas e o campo
// Tipo), ordenação, agrupamento e colunas. Puro: devolve o esquema a gravar ou o motivo de não ser possível.
// "Não (…)" vira a forma equivalente sem negação (De Morgan: E↔OU e operadores invertidos), porque as
// visualizações dos bancos não têm grupo negado. Listas ("é qualquer um de") viram grupos OU/E.
import type { DatabaseSchema, Filter, FilterOp, Page, Property, View, ViewType } from '../types'
import type { FilterTree } from '../database-models'
import { actualDatabaseId } from './engine.ts'
import { realProperty } from './virtualDb.ts'
import { MAX_DEPTH, type Query, type QueryNode } from './model.ts'
import { registeredTypes } from '../objecttypes/registry.ts'
import type { TypeList } from '../objecttypes/model.ts'
import { PAGE_TYPE_FIELD, resolveTypeRef, typeRuleRefs } from './typeField.ts'

export type ConvertResult = { ok: true; sourceId: string; schema: DatabaseSchema; dropped: string[] } | { ok: false; reason: 'source' | 'field'; detail?: string }

const VIEW_FOR: Record<Query['display'], ViewType> = { table: 'table', list: 'list', gallery: 'gallery', board: 'board', count: 'table' }
/** Negação de cada operador (para empurrar o "não" de um grupo até as regras). */
const NEGATE: Record<FilterOp, FilterOp> = { is: 'isNot', isNot: 'is', contains: 'notContains', notContains: 'contains', isEmpty: 'isNotEmpty', isNotEmpty: 'isEmpty', gt: 'lte', lte: 'gt', lt: 'gte', gte: 'lt', before: 'gte', after: 'lte' }

export function queryToLinkedView(query: Query, pages: Record<string, Page>, options: { thisPageId?: string; viewName: string; newId?: () => string; types?: TypeList }): ConvertResult {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const types = options.types ?? registeredTypes()
  if (query.source.kind !== 'database' || query.source.databaseIds?.length !== 1) return { ok: false, reason: 'source' }
  const sourceId = actualDatabaseId(pages, query.source.databaseIds[0])
  const source = pages[sourceId]?.database
  if (!source || source.sourceDatabaseIds?.length) return { ok: false, reason: 'source' }
  const filters: Filter[] = []
  const dropped: string[] = []
  const rule = (propertyId: string, op: FilterOp, value: Filter['value']): FilterTree => {
    const filter: Filter = { id: newId(), propertyId, op, value }
    filters.push(filter)
    return { kind: 'rule', filterId: filter.id }
  }
  const optionValue = (property: Property, op: FilterOp, raw: unknown): Filter['value'] => {
    if (raw === '@thisPage') return options.thisPageId ?? null
    if (typeof raw === 'string' && property.options && !((op === 'contains' || op === 'notContains') && (property.type === 'select' || property.type === 'status'))) return property.options.find((option) => option.name.toLocaleLowerCase() === raw.toLocaleLowerCase())?.id ?? raw
    return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : null
  }
  const visit = (node: QueryNode, depth: number, negated: boolean): FilterTree | null => {
    if (depth > MAX_DEPTH) return null
    if (node.kind === 'rule') {
      const op = negated ? NEGATE[node.op] : node.op
      const isType = node.field === PAGE_TYPE_FIELD
      const property = isType ? null : realProperty(source, node.field)
      if (!isType && !property) throw Object.assign(new Error('field'), { field: node.field })
      const propertyId = isType ? PAGE_TYPE_FIELD : property!.id
      if (op === 'isEmpty' || op === 'isNotEmpty') return rule(propertyId, op, null)
      // Tipo: sempre por id e com "contém" (o filtro de multisseleção das visualizações).
      const values = isType ? typeRuleRefs(node.value).map((ref) => resolveTypeRef(types, ref) ?? ref) : Array.isArray(node.value) ? node.value : [node.value]
      const typeOp: FilterOp = op === 'isNot' || op === 'notContains' ? 'notContains' : 'contains'
      const leaves = values.map((value) => isType ? rule(propertyId, typeOp, value) : rule(propertyId, op, optionValue(property!, op, value)))
      if (leaves.length === 1) return leaves[0]
      if (!leaves.length) return isType ? rule(propertyId, typeOp, null) : rule(propertyId, op, null)
      const negative = op === 'isNot' || op === 'notContains'
      return { kind: 'group', id: newId(), operator: negative ? 'and' : 'or', children: leaves }
    }
    const flip = negated !== !!node.negate
    const operator = flip ? (node.operator === 'and' ? 'or' : 'and') : node.operator
    const children = node.children.map((child) => visit(child, depth + 1, flip)).filter((child): child is FilterTree => !!child)
    return { kind: 'group', id: depth === 0 ? 'root' : newId(), operator, children }
  }
  let tree: FilterTree | null
  try { tree = visit(query.filter, 0, false) } catch (cause) { return { ok: false, reason: 'field', detail: (cause as { field?: string }).field } }
  const sorts = query.sorts.flatMap((sort) => { const property = realProperty(source, sort.field); if (!property) { dropped.push(sort.field); return [] } return [{ propertyId: property.id, direction: sort.direction }] })
  const group = query.groupBy ? realProperty(source, query.groupBy) : null
  if (query.groupBy && !(group && (group.type === 'select' || group.type === 'status'))) dropped.push(query.groupBy)
  const shown = query.columns?.length ? query.columns.map((field) => realProperty(source, field)?.id).filter((id): id is string => !!id) : null
  if (query.limit) dropped.push('limit')
  const view: View = {
    id: newId(), name: options.viewName, type: VIEW_FOR[query.display], filters, sorts,
    hidden: shown ? source.properties.filter((property) => property.type !== 'title' && !shown.includes(property.id)).map((property) => property.id) : [],
    widths: {},
    ...(filters.length > 1 || (tree && tree.kind === 'group' && tree.operator === 'or') || hasNested(tree) ? { filterTree: tree ?? undefined } : {}),
    ...(group && (group.type === 'select' || group.type === 'status') ? { groupBy: group.id } : {}),
  }
  return { ok: true, sourceId, schema: { properties: source.properties, views: [view], activeViewId: view.id, linkedSourceId: sourceId }, dropped }
}

function hasNested(tree: FilterTree | null): boolean { return !!tree && tree.kind === 'group' && tree.children.some((child) => child.kind === 'group') }
