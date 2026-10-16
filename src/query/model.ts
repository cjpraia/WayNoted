// Modelo das consultas vivas ("Dataview"): o que listar (fonte), filtros E/OU aninhados, ordenação,
// agrupamento, limite, colunas e forma de exibição. Puro e serializável (vai nas props do bloco).
// `normalizeQuery` nunca lança: dados antigos/incompletos viram o padrão mais próximo.
import type { FilterOp } from '../types'

export type QueryDisplay = 'table' | 'list' | 'gallery' | 'board' | 'count'
export type QuerySourceKind = 'pages' | 'database' | 'databases' | 'children' | 'tag' | 'modified' | 'relatedToThis' | 'backlinks' | 'tasks' | 'type'

export interface QuerySource {
  kind: QuerySourceKind
  /** database/databases (e opcionalmente relatedToThis para restringir o banco). */
  databaseIds?: string[]
  /** children/backlinks: página alvo; ausente ou '@thisPage' = a página que contém o bloco. */
  pageId?: string
  /** children: incluir todos os descendentes. */
  deep?: boolean
  /** tag: nome da etiqueta (#tag no texto ou opção de seleção com esse nome). */
  tag?: string
  /** modified: últimos N dias. */
  days?: number
  /** tasks: incluir concluídas. */
  includeDone?: boolean
  /** type: páginas com algum destes tipos de objeto (inclui subtipos). */
  typeIds?: string[]
}

/** Campo: '@chave' para campos de página, senão o nome (ou id) de uma propriedade de qualquer banco. */
export type QueryField = string
/** `string[]` só em regras de tipo ("é qualquer um de"). */
export type QueryValue = string | number | boolean | string[] | null

export interface QueryRule { kind: 'rule'; id: string; field: QueryField; op: FilterOp; value: QueryValue }
/** `negate`: "não (…)" — o grupo casa quando o conteúdo NÃO casa. */
export interface QueryGroup { kind: 'group'; id: string; operator: 'and' | 'or'; children: QueryNode[]; negate?: boolean }
export type QueryNode = QueryRule | QueryGroup
export interface QuerySort { field: QueryField; direction: 'asc' | 'desc' }

export interface Query {
  version: 1
  display: QueryDisplay
  source: QuerySource
  filter: QueryGroup
  sorts: QuerySort[]
  groupBy?: QueryField
  limit?: number
  /** Colunas exibidas (tabela/lista/galeria); ausente = automático. */
  columns?: QueryField[]
}

export const PAGE_FIELDS = ['@title', '@created', '@updated', '@parent', '@icon', '@cover', '@words', '@favorite', '@content', '@database', '@type'] as const
export const TASK_FIELDS = ['@due', '@done', '@source'] as const
export type PageField = typeof PAGE_FIELDS[number] | typeof TASK_FIELDS[number]
export const QUERY_DISPLAYS: QueryDisplay[] = ['table', 'list', 'gallery', 'board', 'count']
export const SOURCE_KINDS: QuerySourceKind[] = ['pages', 'database', 'databases', 'children', 'tag', 'modified', 'relatedToThis', 'backlinks', 'tasks', 'type']
export const QUERY_OPS: FilterOp[] = ['is', 'isNot', 'contains', 'notContains', 'gt', 'lt', 'gte', 'lte', 'before', 'after', 'isEmpty', 'isNotEmpty']
/** Teto de segurança: limites, profundidade e quantidade de regras. */
export const MAX_LIMIT = 10_000
export const MAX_DEPTH = 8
export const MAX_RULES = 64

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
let seq = 0
export function newNodeId(): string {
  seq = (seq + 1) % 1_000_000
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : `n${Date.now().toString(36)}${seq}`
}

export function emptyGroup(operator: 'and' | 'or' = 'and', id = 'root'): QueryGroup { return { kind: 'group', id, operator, children: [] } }

export function defaultQuery(patch: Partial<Query> = {}): Query {
  return { version: 1, display: 'table', source: { kind: 'pages' }, filter: emptyGroup(), sorts: [], ...patch }
}

function normalizeSource(raw: unknown): QuerySource {
  if (!object(raw) || !SOURCE_KINDS.includes(raw.kind as QuerySourceKind)) return { kind: 'pages' }
  const kind = raw.kind as QuerySourceKind
  const out: QuerySource = { kind }
  if (Array.isArray(raw.databaseIds)) {
    const ids = [...new Set(raw.databaseIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 32)
    if (ids.length) out.databaseIds = ids
  }
  if (typeof raw.pageId === 'string' && raw.pageId) out.pageId = raw.pageId
  if (raw.deep === true) out.deep = true
  if (typeof raw.tag === 'string') out.tag = raw.tag.replace(/^#/, '').slice(0, 120)
  if (typeof raw.days === 'number' && Number.isFinite(raw.days)) out.days = Math.max(1, Math.min(3650, Math.round(raw.days)))
  if (raw.includeDone === true) out.includeDone = true
  if (Array.isArray(raw.typeIds)) {
    const ids = [...new Set(raw.typeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 32)
    if (ids.length) out.typeIds = ids
  }
  if (kind === 'database' && out.databaseIds && out.databaseIds.length > 1) out.databaseIds = out.databaseIds.slice(0, 1)
  if (kind === 'databases' && out.databaseIds?.length === 1) out.kind = 'database'
  if (kind === 'modified' && out.days === undefined) out.days = 7
  return out
}

function normalizeValue(value: unknown): QueryValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value ?? null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    const list = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0).map((item) => item.slice(0, 200)))].slice(0, 32)
    return list.length > 1 ? list : list[0] ?? null
  }
  return null
}

function normalizeNode(raw: unknown, depth: number, budget: { rules: number }): QueryNode | null {
  if (!object(raw) || depth > MAX_DEPTH) return null
  if (raw.kind === 'rule') {
    if (budget.rules >= MAX_RULES || typeof raw.field !== 'string' || !raw.field) return null
    budget.rules++
    const op = QUERY_OPS.includes(raw.op as FilterOp) ? raw.op as FilterOp : 'is'
    return { kind: 'rule', id: typeof raw.id === 'string' && raw.id ? raw.id : newNodeId(), field: raw.field.slice(0, 200), op, value: normalizeValue(raw.value) }
  }
  if (raw.kind === 'group') {
    const children = Array.isArray(raw.children) ? raw.children.map((child) => normalizeNode(child, depth + 1, budget)).filter((child): child is QueryNode => !!child) : []
    const group: QueryGroup = { kind: 'group', id: typeof raw.id === 'string' && raw.id ? raw.id : newNodeId(), operator: raw.operator === 'or' ? 'or' : 'and', children }
    if (raw.negate === true && depth > 0) group.negate = true
    return group
  }
  return null
}

/** Converte qualquer valor salvo numa consulta válida (nunca lança). */
export function normalizeQuery(raw: unknown): Query {
  if (!object(raw)) return defaultQuery()
  const root = normalizeNode(raw.filter, 0, { rules: 0 })
  const filter: QueryGroup = root?.kind === 'group' ? { ...root, id: 'root' } : root ? { kind: 'group', id: 'root', operator: 'and', children: [root] } : emptyGroup()
  const sorts = Array.isArray(raw.sorts) ? raw.sorts.filter((sort): sort is Record<string, unknown> => object(sort) && typeof sort.field === 'string' && !!sort.field).slice(0, 8).map((sort): QuerySort => ({ field: String(sort.field), direction: sort.direction === 'desc' ? 'desc' : 'asc' })) : []
  const query: Query = {
    version: 1,
    display: QUERY_DISPLAYS.includes(raw.display as QueryDisplay) ? raw.display as QueryDisplay : 'table',
    source: normalizeSource(raw.source),
    filter,
    sorts,
  }
  if (typeof raw.groupBy === 'string' && raw.groupBy) query.groupBy = raw.groupBy
  if (typeof raw.limit === 'number' && Number.isFinite(raw.limit) && raw.limit > 0) query.limit = Math.min(MAX_LIMIT, Math.floor(raw.limit))
  if (Array.isArray(raw.columns)) {
    const columns = [...new Set(raw.columns.filter((field): field is string => typeof field === 'string' && !!field))].slice(0, 40)
    if (columns.length) query.columns = columns
  }
  return query
}

/** Lê o JSON guardado no bloco; texto inválido devolve null (o bloco mostra o erro e preserva o dado). */
export function parseQueryJson(json: unknown): Query | null {
  if (typeof json !== 'string' || !json.trim()) return null
  try { return normalizeQuery(JSON.parse(json)) } catch { return null }
}

export function serializeQueryJson(query: Query): string { return JSON.stringify(normalizeQuery(query)) }

export function isPageField(field: string): field is PageField { return field.startsWith('@') }

/** Todas as regras (em profundidade, com teto). */
export function queryRules(node: QueryNode, out: QueryRule[] = [], depth = 0): QueryRule[] {
  if (depth > MAX_DEPTH) return out
  if (node.kind === 'rule') out.push(node)
  else for (const child of node.children) queryRules(child, out, depth + 1)
  return out
}

/** Campos usados pela consulta (para assinatura de dependências e validação). */
export function queryFields(query: Query): string[] {
  return [...new Set([...queryRules(query.filter).map((rule) => rule.field), ...query.sorts.map((sort) => sort.field), ...(query.groupBy ? [query.groupBy] : []), ...(query.columns ?? [])])]
}

/** Remove ids de nós (comparação estrutural, ex.: round-trip texto ↔ modelo). */
export function stripIds(query: Query): unknown {
  const strip = (node: QueryNode): unknown => node.kind === 'rule' ? { kind: 'rule', field: node.field, op: node.op, value: node.value } : { kind: 'group', operator: node.operator, children: node.children.map(strip), ...(node.negate ? { negate: true } : {}) }
  return { ...normalizeQuery(query), filter: strip(query.filter) }
}

// ---------- edição imutável (construtor visual) ----------

export function updateNode(root: QueryGroup, id: string, fn: (node: QueryNode) => QueryNode | null): QueryGroup {
  const visit = (node: QueryNode, depth: number): QueryNode | null => {
    if (node.id === id) return fn(node)
    if (node.kind === 'rule' || depth > MAX_DEPTH) return node
    return { ...node, children: node.children.map((child) => visit(child, depth + 1)).filter((child): child is QueryNode => !!child) }
  }
  const next = visit(root, 0)
  return next && next.kind === 'group' ? next : emptyGroup()
}

export function addRule(root: QueryGroup, groupId: string, rule: QueryRule): QueryGroup {
  if (queryRules(root).length >= MAX_RULES) return root
  return updateNode(root, groupId, (node) => node.kind === 'group' ? { ...node, children: [...node.children, rule] } : node)
}

export function addGroup(root: QueryGroup, groupId: string, operator: 'and' | 'or' = 'or'): QueryGroup {
  return updateNode(root, groupId, (node) => node.kind === 'group' ? { ...node, children: [...node.children, { kind: 'group', id: newNodeId(), operator, children: [] }] } : node)
}

export function removeNode(root: QueryGroup, id: string): QueryGroup { return id === 'root' ? emptyGroup(root.operator) : updateNode(root, id, () => null) }
