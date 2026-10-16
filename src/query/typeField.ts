// Campo "Tipo" (tipos de objeto) nas consultas e nas visualizações de banco convertidas.
// Puro: recebe a lista de tipos. Uma regra de tipo guarda ids (ou nomes, vindos do modo texto) e casa
// também subtipos (`hasType`). docs/QUERIES.md · docs/USAGE.md
import type { FilterOp, Page, Property, PropValue } from '../types'
import type { Query, QueryNode } from './model.ts'
import { effectiveProperties, findType, findTypeByName, fold, hasType, type ObjectType, type TypeList } from '../objecttypes/model.ts'

export const PAGE_TYPE_FIELD = '@type'

/** Tipos (que ainda existem) aplicados diretamente à página, na ordem da página. */
export function directTypes(types: TypeList, page: Pick<Page, 'types'>): ObjectType[] {
  if (!page.types?.length) return []
  const out: ObjectType[] = []
  for (const id of page.types) { const type = findType(types, id); if (type) out.push(type) }
  return out
}

/** Id de um tipo a partir do id ou do nome (sem acentos/caixa, com ou sem #). */
export function resolveTypeRef(types: TypeList, ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref) return null
  return findType(types, ref)?.id ?? findTypeByName(types, ref)?.id ?? null
}

/** Valores de uma regra de tipo (um ou vários). */
export function typeRuleRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && !!item)
  return typeof value === 'string' && value ? [value] : []
}

/**
 * A página atende à regra de tipo? `is`/`contains` = tem algum dos tipos (ou subtipo); `isNot`/`notContains` = não tem
 * nenhum; `isEmpty` = sem tipo; `isNotEmpty` = tem algum tipo. Sem valor, a regra não restringe (como os bancos).
 * Um nome que não corresponde a tipo nenhum nunca casa (e "não é" sempre casa).
 */
export function matchPageType(types: TypeList, page: Pick<Page, 'types'>, op: FilterOp, value: unknown): boolean {
  const has = directTypes(types, page).length > 0
  if (op === 'isEmpty') return !has
  if (op === 'isNotEmpty') return has
  const refs = typeRuleRefs(value)
  if (!refs.length) return true
  const ids = refs.map((ref) => resolveTypeRef(types, ref)).filter((id): id is string => !!id)
  const any = has && ids.some((id) => hasType(types, page, id))
  return op === 'isNot' || op === 'notContains' ? !any : any
}

/** Chave de ordenação: nomes dos tipos (vazio vai para o fim). */
export function typeSortKey(types: TypeList, page: Pick<Page, 'types'>): string | null {
  const names = directTypes(types, page).map((type) => fold(type.name)).sort()
  return names.length ? names.join(', ') : null
}

export function typeNames(types: TypeList, page: Pick<Page, 'types'>): string {
  return directTypes(types, page).map((type) => type.name).join(', ')
}

/** Propriedade sintética (multisseleção somente leitura) cujas opções são os tipos, com ícone e cor. */
export function pageTypeProperty(types: TypeList, name: string, id = PAGE_TYPE_FIELD): Property {
  return { id, name, type: 'multiSelect', options: types.map((type) => ({ id: type.id, name: type.name || '—', color: type.color, ...(type.icon ? { icon: type.icon } : {}) })) }
}

const propCache = new WeakMap<TypeList, Property>()
/** `pageTypeProperty` memoizada pela identidade da lista (motor: uma por avaliação, não por linha). */
export function typeProperty(types: TypeList): Property {
  let prop = propCache.get(types)
  if (!prop) propCache.set(types, (prop = pageTypeProperty(types, 'Type')))
  return prop
}

/** Valor do campo "Tipo" numa linha: ids dos tipos diretos que existem. */
export function pageTypeValue(types: TypeList, page: Pick<Page, 'types'>): PropValue {
  return directTypes(types, page).map((type) => type.id)
}

// ---------- campos dos tipos ----------

const fieldsCache = new WeakMap<TypeList, Map<string, Property[]>>()
/** Campos efetivos de um tipo (memo pela identidade da lista). */
export function typeFields(types: TypeList, typeId: string): Property[] {
  let map = fieldsCache.get(types)
  if (!map) fieldsCache.set(types, (map = new Map()))
  let list = map.get(typeId)
  if (!list) map.set(typeId, (list = effectiveProperties(types, typeId)))
  return list
}

/** Campo de tipo da página com esse nome (sem acentos/caixa) ou id, e o valor guardado. */
export function typeFieldOf(types: TypeList, page: Pick<Page, 'types' | 'typeProps' | 'props'>, field: string): { property: Property; value: PropValue } | null {
  if (!page.types?.length) return null
  const wanted = fold(field)
  for (const id of page.types) {
    if (!findType(types, id)) continue
    const property = typeFields(types, id).find((prop) => prop.id === field) ?? typeFields(types, id).find((prop) => fold(prop.name) === wanted)
    if (!property) continue
    const stored = page.typeProps && property.id in page.typeProps ? page.typeProps[property.id] : page.props?.[property.id]
    return { property, value: stored ?? null }
  }
  return null
}

/**
 * Tipos que a consulta seleciona: fonte "tipo" e regras "Tipo é …" (não negadas). Usado para oferecer os campos
 * desses tipos como colunas/filtros/ordenação e para as colunas automáticas.
 */
export function queryTypeIds(query: Query, types: TypeList): string[] {
  const out = new Set<string>()
  for (const id of query.source.kind === 'type' ? query.source.typeIds ?? [] : []) if (findType(types, id)) out.add(id)
  const visit = (node: QueryNode, negated: boolean, depth: number) => {
    if (depth > 8) return
    if (node.kind === 'group') { for (const child of node.children) visit(child, negated !== !!node.negate, depth + 1); return }
    if (node.field !== PAGE_TYPE_FIELD || negated || (node.op !== 'is' && node.op !== 'contains')) return
    for (const ref of typeRuleRefs(node.value)) { const id = resolveTypeRef(types, ref); if (id) out.add(id) }
  }
  visit(query.filter, false, 0)
  return [...out]
}
