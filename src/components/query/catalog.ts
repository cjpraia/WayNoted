// Campos e operadores oferecidos pelo construtor visual (puro; rótulos via `translate`).
import type { FilterOp, Page, PropType } from '../../types'
import { translate } from '../../localization.ts'
import { actualDatabaseId, pageFieldProperty } from '../../query/engine.ts'
import { PAGE_FIELDS, TASK_FIELDS, isPageField, type Query, type QueryDisplay, type QuerySourceKind, type QueryValue } from '../../query/model.ts'
import { registeredTypes } from '../../objecttypes/registry.ts'
import type { TypeList } from '../../objecttypes/model.ts'
import { PAGE_TYPE_FIELD, queryTypeIds, typeFields, typeRuleRefs } from '../../query/typeField.ts'

type Locale = 'pt-BR' | 'en-US'
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()

/** `typeId`: campo de um tipo de objeto (agrupado sob "Campos de <Tipo>"); `selected`: o tipo está na fonte/filtro. */
export interface FieldInfo { field: string; label: string; type: PropType; options: string[]; page: boolean; typeId?: string; selected?: boolean }

const PAGE_FIELD_LABELS: Record<string, [string, string]> = {
  '@title': ['Título', 'Title'], '@created': ['Criada em', 'Created'], '@updated': ['Editada em', 'Edited'], '@parent': ['Página pai', 'Parent page'],
  '@icon': ['Ícone', 'Icon'], '@cover': ['Tem capa', 'Has cover'], '@words': ['Palavras', 'Words'], '@favorite': ['Favorita', 'Favorite'],
  '@content': ['Conteúdo', 'Content'], '@database': ['Banco', 'Database'], '@type': ['Tipo', 'Type'], '@due': ['Vencimento', 'Due'], '@done': ['Concluída', 'Done'], '@source': ['Origem', 'Source'],
}
export function fieldLabel(field: string, locale: Locale): string {
  const pair = PAGE_FIELD_LABELS[field]
  return pair ? translate(locale, pair[0], pair[1]) : field
}

export const DISPLAY_LABELS: Record<QueryDisplay, [string, string]> = { table: ['Tabela', 'Table'], list: ['Lista', 'List'], gallery: ['Galeria', 'Gallery'], board: ['Quadro', 'Board'], count: ['Contagem', 'Count'] }
export const SOURCE_LABELS: Record<QuerySourceKind, [string, string]> = {
  pages: ['Todas as páginas', 'All pages'], database: ['Um banco de dados', 'A database'], databases: ['Vários bancos', 'Several databases'],
  children: ['Páginas filhas de…', 'Children of…'], tag: ['Páginas com tag', 'Pages with tag'], modified: ['Modificadas recentemente', 'Recently modified'],
  relatedToThis: ['Linhas relacionadas a esta página', 'Rows related to this page'], backlinks: ['Menções e backlinks', 'Mentions and backlinks'], tasks: ['Tarefas', 'Tasks'],
  type: ['Páginas de um tipo', 'Pages of a type'],
}

/**
 * Campos disponíveis: campos de página (Tipo logo depois de Título) + campos dos tipos escolhidos na fonte/filtro +
 * propriedades dos bancos da fonte (ou de todos os bancos) + campos dos demais tipos.
 */
export function fieldCatalog(query: Query, pages: Record<string, Page>, locale: Locale, types: TypeList = registeredTypes()): FieldInfo[] {
  const out: FieldInfo[] = []
  const pageFields = query.source.kind === 'tasks' ? ['@title', ...TASK_FIELDS, '@created', '@updated'] : ['@title', PAGE_TYPE_FIELD, ...PAGE_FIELDS.filter((field) => field !== '@title' && field !== PAGE_TYPE_FIELD)]
  for (const field of pageFields) out.push({ field, label: fieldLabel(field, locale), type: field === PAGE_TYPE_FIELD ? 'multiSelect' : pageFieldProperty(field)?.type ?? 'text', options: field === PAGE_TYPE_FIELD ? types.map((type) => type.name) : [], page: true })
  if (query.source.kind === 'tasks') return out
  const selected = new Set(queryTypeIds(query, types))
  const typeInfo = (typeId: string, chosen: boolean): FieldInfo[] => typeFields(types, typeId).filter((property) => property.type !== 'button').map((property) => ({ field: property.name, label: property.name, type: property.type, options: (property.options ?? []).map((option) => option.name), page: false, typeId, selected: chosen }))
  const seenNames = new Set<string>()
  for (const typeId of selected) for (const info of typeInfo(typeId, true)) if (!seenNames.has(fold(info.field))) { seenNames.add(fold(info.field)); out.push(info) }
  const dbIds = query.source.kind === 'database' || query.source.kind === 'databases' || (query.source.kind === 'relatedToThis' && query.source.databaseIds?.length)
    ? (query.source.databaseIds ?? []).map((id) => actualDatabaseId(pages, id))
    : Object.values(pages).filter((page) => page.database && !page.database.linkedSourceId && !page.trashed && !page.passwordLock).map((page) => page.id)
  const byName = new Map<string, FieldInfo>()
  for (const id of dbIds.slice(0, 400)) for (const property of pages[id]?.database?.properties ?? []) {
    if (property.type === 'title' || property.type === 'button') continue
    const key = fold(property.name)
    let info = byName.get(key)
    if (!info) byName.set(key, (info = { field: property.name, label: property.name, type: property.type, options: [], page: false }))
    for (const option of property.options ?? []) if (!info.options.some((name) => fold(name) === fold(option.name))) info.options.push(option.name)
    if (byName.size > 400) break
  }
  const dbFields = [...byName.values()].filter((info) => !seenNames.has(fold(info.field))).sort((a, b) => a.label.localeCompare(b.label, locale))
  for (const info of dbFields) seenNames.add(fold(info.field))
  const otherTypeFields: FieldInfo[] = []
  for (const type of types.slice(0, 200)) if (!selected.has(type.id)) for (const info of typeInfo(type.id, false)) if (!seenNames.has(fold(info.field))) { seenNames.add(fold(info.field)); otherTypeFields.push(info) }
  return [...out, ...dbFields, ...otherTypeFields]
}

/** Operadores do campo Tipo (é / não é / tem algum tipo / sem tipo). */
export const TYPE_OPS: FilterOp[] = ['is', 'isNot', 'isNotEmpty', 'isEmpty']
export function typeOpLabel(op: FilterOp, value: QueryValue, locale: Locale): string {
  const many = typeRuleRefs(value).length > 1
  switch (op) {
    case 'isNot': case 'notContains': return many ? translate(locale, 'não é nenhum de', 'is none of') : translate(locale, 'não é', 'is not')
    case 'isEmpty': return translate(locale, 'não tem tipo', 'has no type')
    case 'isNotEmpty': return translate(locale, 'tem algum tipo', 'has any type')
    default: return many ? translate(locale, 'é qualquer um de', 'is any of') : translate(locale, 'é', 'is')
  }
}

export function fieldInfo(catalog: FieldInfo[], field: string, locale: Locale): FieldInfo {
  return catalog.find((info) => info.field === field) ?? catalog.find((info) => !info.page && fold(info.field) === fold(field)) ?? { field, label: isPageField(field) ? fieldLabel(field, locale) : field, type: 'text', options: [], page: isPageField(field) }
}

export function opsFor(type: PropType): FilterOp[] {
  switch (type) {
    case 'number': case 'formula': case 'rollup': case 'uniqueId': return ['is', 'isNot', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'isNotEmpty']
    case 'select': case 'status': return ['is', 'isNot', 'isEmpty', 'isNotEmpty']
    case 'multiSelect': case 'relation': case 'person': case 'files': return ['contains', 'notContains', 'isEmpty', 'isNotEmpty']
    case 'date': case 'createdTime': case 'updatedTime': return ['is', 'isNot', 'lt', 'gt', 'lte', 'gte', 'isEmpty', 'isNotEmpty']
    case 'checkbox': return ['is']
    default: return ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty']
  }
}

const DATE_OPS: Partial<Record<FilterOp, [string, string]>> = { is: ['é', 'is'], isNot: ['não é', 'is not'], lt: ['antes de', 'before'], gt: ['depois de', 'after'], lte: ['até', 'on or before'], gte: ['a partir de', 'on or after'], before: ['antes de', 'before'], after: ['depois de', 'after'] }
const OPS: Record<FilterOp, [string, string]> = {
  is: ['é', 'is'], isNot: ['não é', 'is not'], contains: ['contém', 'contains'], notContains: ['não contém', 'does not contain'], gt: ['>', '>'], lt: ['<', '<'], gte: ['≥', '≥'], lte: ['≤', '≤'],
  before: ['antes de', 'before'], after: ['depois de', 'after'], isEmpty: ['está vazio', 'is empty'], isNotEmpty: ['não está vazio', 'is not empty'],
}
export function opLabel(op: FilterOp, type: PropType, locale: Locale): string {
  const pair = (type === 'date' || type === 'createdTime' || type === 'updatedTime' ? DATE_OPS[op] : undefined) ?? OPS[op]
  return translate(locale, pair[0], pair[1])
}

export const DATE_PRESETS: { value: string; pt: string; en: string }[] = [
  { value: '@today', pt: 'Hoje', en: 'Today' }, { value: '@yesterday', pt: 'Ontem', en: 'Yesterday' }, { value: '@tomorrow', pt: 'Amanhã', en: 'Tomorrow' },
  { value: '@thisWeek', pt: 'Esta semana', en: 'This week' }, { value: '@lastWeek', pt: 'Semana passada', en: 'Last week' }, { value: '@nextWeek', pt: 'Próxima semana', en: 'Next week' },
  { value: '@thisMonth', pt: 'Este mês', en: 'This month' }, { value: '@lastMonth', pt: 'Mês passado', en: 'Last month' }, { value: '@nextMonth', pt: 'Próximo mês', en: 'Next month' },
  { value: '@past7d', pt: 'Últimos 7 dias', en: 'Last 7 days' }, { value: '@past30d', pt: 'Últimos 30 dias', en: 'Last 30 days' }, { value: '@next7d', pt: 'Próximos 7 dias', en: 'Next 7 days' },
]
