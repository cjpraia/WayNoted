// Filtro rápido por tipo (chips "Pessoa 12 · Projeto 5 · Sem tipo 400" acima do resultado). Puro.
// As contagens vêm da consulta SEM os filtros de tipo do nível de cima e sem limite, para que marcar um
// tipo não esconda os demais (como as facetas de busca). docs/QUERIES.md
import type { Page } from '../types'
import type { TypeList } from '../objecttypes/model.ts'
import { createQueryCache, runQuery, taskForRow, type QueryCache, type QueryEnv, type QueryResult } from './engine.ts'
import { newNodeId, type Query, type QueryNode, type QueryRule } from './model.ts'
import { PAGE_TYPE_FIELD, directTypes, resolveTypeRef, typeRuleRefs } from './typeField.ts'

export interface TypeFacet { typeId: string | null; count: number }
export interface TypeFacets { facets: TypeFacet[]; active: Set<string>; untypedActive: boolean }

/** Regras de tipo no nível de cima (só quando o nível de cima é "E"): são as que o filtro rápido controla. */
function topTypeRules(query: Query): QueryRule[] {
  if (query.filter.operator !== 'and') return []
  return query.filter.children.filter((node): node is QueryRule => node.kind === 'rule' && node.field === PAGE_TYPE_FIELD)
}

/** A consulta sem as regras de tipo do nível de cima e sem limite (base das contagens). */
export function facetBaseQuery(query: Query): Query {
  const rules = new Set<QueryNode>(topTypeRules(query))
  const next: Query = { ...query, filter: { ...query.filter, children: query.filter.children.filter((node) => !rules.has(node)) } }
  delete next.limit
  return next
}

export function countTypes(rows: readonly Page[], types: TypeList, max = 6): TypeFacet[] {
  const counts = new Map<string, number>()
  let untyped = 0
  for (const row of rows) {
    if (taskForRow(row)) continue
    const list = directTypes(types, row)
    if (!list.length) { untyped++; continue }
    for (const type of list) counts.set(type.id, (counts.get(type.id) ?? 0) + 1)
  }
  const out: TypeFacet[] = [...counts.entries()].map(([typeId, count]) => ({ typeId, count })).sort((a, b) => b.count - a.count).slice(0, max)
  return untyped && out.length ? [...out, { typeId: null, count: untyped }] : out
}

const caches = new Map<string, QueryCache>()
function facetCache(key: string): QueryCache {
  let cache = caches.get(key)
  if (!cache) { cache = createQueryCache(); caches.set(key, cache); if (caches.size > 100) caches.delete(caches.keys().next().value!) }
  return cache
}

/**
 * Facetas de tipo de uma consulta. `allowRun = false` (conjunto grande) só usa o resultado atual quando ele já é a
 * base (sem regra de tipo e sem limite); senão devolve null. Fontes de tarefas e bancos não têm facetas.
 */
export function typeFacets(query: Query, result: QueryResult, env: QueryEnv, types: TypeList, options: { key: string; allowRun: boolean }): TypeFacets | null {
  if (!types.length || query.source.kind === 'tasks' || query.source.kind === 'database' || query.source.kind === 'databases') return null
  const rules = topTypeRules(query)
  const active = new Set<string>()
  let untypedActive = false
  for (const rule of rules) {
    if (rule.op === 'isEmpty') untypedActive = true
    else if (rule.op === 'is' || rule.op === 'contains') for (const ref of typeRuleRefs(rule.value)) { const id = resolveTypeRef(types, ref); if (id) active.add(id) }
  }
  let rows: readonly Page[]
  if (!rules.length && !query.limit) rows = result.rows
  else if (!options.allowRun) return null
  else rows = runQuery(facetBaseQuery(query), { ...env, types }, facetCache(options.key)).rows
  const facets = countTypes(rows, types)
  return facets.some((facet) => facet.typeId) ? { facets, active, untypedActive } : null
}

/** Liga/desliga um tipo (ou "Sem tipo", `typeId = null`) no filtro rápido. */
export function toggleTypeFacet(query: Query, typeId: string | null, types: TypeList): Query {
  const rules = topTypeRules(query)
  const positive = rules.find((rule) => rule.op === 'is' || rule.op === 'contains')
  const empty = rules.find((rule) => rule.op === 'isEmpty')
  let children = query.filter.children
  const replace = (target: QueryNode, next: QueryNode | null) => { children = next ? children.map((node) => node === target ? next : node) : children.filter((node) => node !== target) }
  if (typeId === null) {
    if (empty) replace(empty, null)
    else { if (positive) replace(positive, null); children = [...children, { kind: 'rule', id: newNodeId(), field: PAGE_TYPE_FIELD, op: 'isEmpty', value: null }] }
  } else {
    if (empty) replace(empty, null)
    if (positive) {
      const ids = typeRuleRefs(positive.value).map((ref) => resolveTypeRef(types, ref) ?? ref)
      const next = ids.includes(typeId) ? ids.filter((id) => id !== typeId) : [...ids, typeId]
      replace(positive, next.length ? { ...positive, op: 'is', value: next.length > 1 ? next : next[0] } : null)
    } else children = [...children, { kind: 'rule', id: newNodeId(), field: PAGE_TYPE_FIELD, op: 'is', value: typeId }]
  }
  // O filtro rápido sempre fica num nível de cima "E".
  const filter = query.filter.operator === 'and' ? { ...query.filter, children } : { kind: 'group' as const, id: 'root', operator: 'and' as const, children: [{ ...query.filter, id: newNodeId() }, ...children.filter((node) => !query.filter.children.includes(node))] }
  return { ...query, filter }
}
