// "Banco virtual" de uma consulta: esquema + visualização + linhas no formato que as visualizações dos
// bancos (TableView, ListView, GalleryView, BoardView) já entendem. Puro (sem store/React).
// - Um único banco de origem e só colunas nativas → usa o esquema real e as linhas reais: a edição de
//   células passa pelas ações normais da store (setProp/updatePage) e respeita bloqueios.
// - Vários bancos, páginas soltas ou tarefas → esquema sintético somente leitura, colunas unificadas por
//   nome (opções fundidas por nome) e linhas projetadas (cópias estáveis por identidade da página).
import type { DatabaseSchema, Page, Property, PropValue, SelectOption, View, ViewType } from '../types'
import { valueText } from '../components/database/filterEngine.ts'
import { actualDatabaseId, fieldValue, pageFieldProperty, propertyByField, type QueryResult } from './engine.ts'
import { isPageField, type Query } from './model.ts'
import { registeredTypes } from '../objecttypes/registry.ts'
import type { TypeList } from '../objecttypes/model.ts'
import { PAGE_TYPE_FIELD, directTypes, pageTypeProperty, pageTypeValue, queryTypeIds, typeFieldOf, typeFields } from './typeField.ts'

export interface VirtualDb {
  db: Page
  schema: DatabaseSchema
  view: View
  rows: Page[]
  /** Linhas por grupo (mesma projeção). */
  groups: { key: string; label: string; rows: Page[]; typeId?: string }[] | null
  visibleProps: Property[]
  /** Banco real quando todas as linhas vêm dele (edição no lugar e "Abrir como banco"). */
  databaseId: string | null
  /** Pode editar células no lugar (sujeito ainda a bloqueios de linha/página). */
  editable: boolean
}

type Pages = Record<string, Page>
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
const NATIVE_PAGE_FIELDS = new Set(['@title', '@created', '@updated'])

const VIEW_FOR: Record<Query['display'], ViewType> = { table: 'table', list: 'list', gallery: 'gallery', board: 'board', count: 'table' }

/** Banco único de onde vêm as linhas (fonte "banco" ou todas as linhas com o mesmo pai-banco). */
export function singleDatabase(query: Query, result: QueryResult, pages: Pages): string | null {
  if (query.source.kind === 'tasks') return null
  if (query.source.kind === 'database' && query.source.databaseIds?.length === 1) {
    const actual = actualDatabaseId(pages, query.source.databaseIds[0])
    return pages[actual]?.database && !pages[actual].database!.sourceDatabaseIds?.length ? actual : null
  }
  if (result.databaseIds.length === 1 && result.rows.every((row) => row.parentId === result.databaseIds[0])) return result.databaseIds[0]
  return null
}

/** Colunas padrão quando a consulta não escolhe. Filtrar por tipo traz os campos do tipo; páginas com tipo trazem "Tipo". */
export function defaultColumns(query: Query, pages: Pages, databaseId: string | null, rows: readonly Page[] = [], types: TypeList = registeredTypes()): string[] {
  const selected = queryTypeIds(query, types)
  if (selected.length && !databaseId && query.source.kind !== 'tasks') {
    const names: string[] = []
    for (const id of selected) for (const property of typeFields(types, id)) if (!names.some((name) => fold(name) === fold(property.name))) names.push(property.name)
    return ['@title', ...(selected.length > 1 || query.source.kind !== 'type' ? ['@type'] : []), ...names.slice(0, 8)]
  }
  const typed = types.length > 0 && rows.slice(0, 2000).some((row) => directTypes(types, row).length > 0)
  if (databaseId) {
    const schema = pages[databaseId]?.database
    if (!schema) return ['@title']
    const active = schema.views.find((view) => view.id === schema.activeViewId) ?? schema.views[0]
    return schema.properties.filter((property) => property.type === 'title' || !active?.hidden.includes(property.id)).filter((property) => property.type !== 'button').slice(0, 12).map((property) => property.type === 'title' ? '@title' : property.name)
  }
  switch (query.source.kind) {
    case 'tasks': return ['@title', '@due', '@source', ...(query.source.includeDone ? ['@done'] : [])]
    case 'database': case 'databases': {
      const names: string[] = []
      for (const id of query.source.databaseIds ?? []) for (const property of pages[actualDatabaseId(pages, id)]?.database?.properties ?? []) {
        if (property.type === 'title' || property.type === 'button' || names.some((name) => fold(name) === fold(property.name))) continue
        names.push(property.name)
      }
      return ['@title', '@database', ...names.slice(0, 6)]
    }
    case 'relatedToThis': return ['@title', '@database', '@updated']
    default: return typed ? ['@title', '@type', '@parent', '@updated'] : ['@title', '@parent', '@updated']
  }
}

const projections = new WeakMap<Page, { key: string; types: TypeList; row: Page }>()

function inferType(values: PropValue[]): Property['type'] {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'checkbox'
    if (typeof value === 'object' && !Array.isArray(value) && 'start' in value) return 'date'
    return 'text'
  }
  return 'text'
}

export interface VirtualLabels { title: string; locale?: string; fieldName: (field: string) => string }

export function buildVirtualDb(query: Query, result: QueryResult, pages: Pages, blockId: string, labels: VirtualLabels, canEdit: boolean, types: TypeList = registeredTypes()): VirtualDb {
  const databaseId = singleDatabase(query, result, pages)
  const columns = query.columns?.length ? query.columns : defaultColumns(query, pages, databaseId, result.rows, types)
  const viewType = VIEW_FOR[query.display]
  const realDb = databaseId ? pages[databaseId] : undefined
  const realSchema = realDb?.database
  const nativeOnly = !!realSchema && columns.every((field) => isPageField(field) ? NATIVE_PAGE_FIELDS.has(field) : !!propertyByField(realSchema.properties, field))
    && (!query.groupBy || !isPageField(query.groupBy) || NATIVE_PAGE_FIELDS.has(query.groupBy))
  const viewBase = { id: `np-query:${blockId}`, name: labels.title, type: viewType, filters: [], hidden: [] as string[], widths: {} as Record<string, number>, showPageIcon: true, cardPreview: 'none' as const }

  if (realDb && realSchema && nativeOnly) {
    // Banco real: colunas = propriedades reais (campos nativos de página mapeiam para o título/criado/editado).
    const synthetic: Property[] = []
    const visible: Property[] = []
    for (const field of columns) {
      let property: Property | null | undefined = isPageField(field) ? field === '@title' ? realSchema.properties.find((p) => p.type === 'title') : realSchema.properties.find((p) => p.type === (field === '@created' ? 'createdTime' : 'updatedTime')) : propertyByField(realSchema.properties, field)
      if (!property && isPageField(field)) { property = { ...pageFieldProperty(field)!, name: labels.fieldName(field) }; synthetic.push(property) }
      if (property && !visible.includes(property)) visible.push(property)
    }
    const title = realSchema.properties.find((p) => p.type === 'title')
    if (title && !visible.includes(title)) visible.unshift(title)
    else if (title && visible[0] !== title) { visible.splice(visible.indexOf(title), 1); visible.unshift(title) }
    const properties = [...realSchema.properties, ...synthetic]
    const groupProp = query.groupBy ? propertyByField(realSchema.properties, query.groupBy) : null
    const sorts = query.sorts.flatMap((sort) => { const property = isPageField(sort.field) ? null : propertyByField(realSchema.properties, sort.field); return property ? [{ propertyId: property.id, direction: sort.direction }] : [] })
    const view: View = { ...viewBase, sorts: sorts.length ? sorts : query.sorts.length ? [{ propertyId: title?.id ?? '', direction: 'asc' }] : [], hidden: properties.filter((p) => !visible.includes(p)).map((p) => p.id), groupBy: groupProp && (groupProp.type === 'select' || groupProp.type === 'status') ? groupProp.id : undefined, dateProp: realSchema.properties.find((p) => p.type === 'date')?.id }
    const schema: DatabaseSchema = { ...realSchema, properties, views: [view], activeViewId: view.id }
    // O proxy bloqueado esconde menus de esquema (renomear coluna, larguras, cálculos) sem tocar no banco real.
    const db: Page = { ...realDb, locked: true }
    return { db, schema, view, rows: result.rows, groups: result.groups, visibleProps: visible, databaseId, editable: canEdit && !realDb.locked }
  }

  // Esquema sintético somente leitura.
  const properties: Property[] = [{ id: '@title', name: labels.fieldName('@title'), type: 'title' }]
  const columnInfo: { field: string; property: Property; options?: Map<string, SelectOption> }[] = []
  columns.forEach((field, index) => {
    if (field === '@title') return
    const id = `c${index}`
    if (isPageField(field)) {
      const base = pageFieldProperty(field)
      if (!base) return
      if (field === PAGE_TYPE_FIELD) {
        // Chips com ícone e cor; opções = tipos presentes no resultado (na ordem da lista de tipos).
        const used = new Set<string>()
        for (const row of result.rows) for (const typeId of row.types ?? []) used.add(typeId)
        const property = pageTypeProperty(types.filter((type) => used.has(type.id)), labels.fieldName(field), id)
        properties.push(property); columnInfo.push({ field, property })
        return
      }
      const property: Property = { ...base, id, name: labels.fieldName(field), ...(field === '@parent' ? { type: 'text' } : {}), ...(field === '@icon' ? { display: 'icon' as const } : {}) }
      properties.push(property); columnInfo.push({ field, property })
      return
    }
    // Primeira definição encontrada entre os bancos das linhas; opções fundidas por nome.
    let template: Property | null = null
    const options = new Map<string, SelectOption>()
    const seenDbs = new Set<string>()
    for (const row of result.rows) {
      const parentId = row.parentId
      if (!parentId || seenDbs.has(parentId)) continue
      seenDbs.add(parentId)
      const found = pages[parentId]?.database ? propertyByField(pages[parentId].database!.properties, field) : null
      if (!found) continue
      template ??= found
      for (const option of found.options ?? []) if (!options.has(fold(option.name))) options.set(fold(option.name), { ...option, id: `o:${fold(option.name)}` })
      if (seenDbs.size > 64) break
    }
    // Campos de tipos de objeto (páginas fora de bancos ou campo que o banco não tem).
    const seenTypes = new Set<string>()
    for (const row of result.rows) {
      if (!row.types?.length || seenTypes.size > 64) continue
      for (const typeId of row.types) {
        if (seenTypes.has(typeId)) continue
        seenTypes.add(typeId)
        const found = typeFieldOf(types, { types: [typeId] }, field)?.property
        if (!found) continue
        template ??= found
        for (const option of found.options ?? []) if (!options.has(fold(option.name))) options.set(fold(option.name), { ...option, id: `o:${fold(option.name)}` })
      }
    }
    const computed = !template || ['formula', 'rollup', 'button', 'uniqueId', 'createdBy', 'updatedBy', 'place', 'files', 'person'].includes(template.type)
    const type: Property['type'] = !template ? 'text' : computed ? inferType(result.rows.slice(0, 50).map((row) => fieldValue(row, field, pages, types).value)) : template.type === 'title' ? 'text' : template.type
    const property: Property = { id, name: template?.name ?? field, type, ...(options.size ? { options: [...options.values()] } : {}), ...(template?.numberFormat ? { numberFormat: template.numberFormat } : {}), ...(template?.dateFormat ? { dateFormat: template.dateFormat } : {}) } as Property
    properties.push(property)
    columnInfo.push({ field, property, options: options.size ? options : undefined })
  })
  const key = JSON.stringify(columnInfo.map((info) => [info.field, info.property.id, info.property.type]))
  const project = (row: Page): Page => {
    const cached = projections.get(row)
    if (cached && cached.key === key && cached.types === types) return cached.row
    const props: Record<string, PropValue> = {}
    for (const info of columnInfo) {
      if (info.field === PAGE_TYPE_FIELD) { props[info.property.id] = pageTypeValue(types, row); continue }
      if (info.field === '@icon') { props[info.property.id] = row.icon ?? null; continue }
      const { value, prop } = fieldValue(row, info.field, pages, types)
      let out: PropValue = value
      if (info.field === '@content' && typeof value === 'string') out = value.slice(0, 280)
      else if (info.field === '@parent') out = Array.isArray(value) && typeof value[0] === 'string' ? pages[value[0]]?.title ?? '' : ''
      else if (info.options && (prop.type === 'select' || prop.type === 'status' || prop.type === 'multiSelect')) {
        const map = (id: unknown) => { const name = prop.options?.find((option) => option.id === id)?.name; return name ? info.options!.get(fold(name))?.id ?? null : null }
        out = Array.isArray(value) ? (value as unknown[]).map(map).filter((id): id is string => !!id) : map(value)
      } else if (prop.type === 'title') out = row.title
      else if (prop.type === 'formula' || prop.type === 'rollup' || info.property.type === 'text' && value !== null && typeof value === 'object') out = info.property.type === 'text' ? valueText(value, prop, pages, labels.locale) : value
      else if (info.property.type === 'text' && typeof value !== 'string' && value !== null) out = valueText(value, prop, pages, labels.locale)
      props[info.property.id] = out
    }
    const copy: Page = { ...row, props, database: undefined, locked: true }
    projections.set(row, { key, types, row: copy })
    return copy
  }
  const rows = result.rows.map(project)
  const groups = result.groups?.map((group) => ({ ...group, rows: group.rows.map(project) })) ?? null
  const groupInfo = query.groupBy ? columnInfo.find((info) => info.field === query.groupBy) : undefined
  const view: View = { ...viewBase, sorts: [], groupBy: groupInfo && (groupInfo.property.type === 'select' || groupInfo.property.type === 'status') ? groupInfo.property.id : undefined }
  const schema: DatabaseSchema = { properties, views: [view], activeViewId: view.id }
  const db: Page = { id: `np-query:${blockId}`, parentId: null, title: labels.title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 0, updatedAt: 0, order: 0, fullWidth: false, smallText: false, font: 'default', locked: true, text: '', database: schema }
  return { db, schema, view, rows, groups, visibleProps: properties, databaseId, editable: false }
}

/** Resolve a propriedade real de um campo no banco (para "Abrir como banco"). */
export function realProperty(schema: DatabaseSchema, field: string): Property | null {
  if (field === '@title') return schema.properties.find((p) => p.type === 'title') ?? null
  if (field === '@created') return schema.properties.find((p) => p.type === 'createdTime') ?? null
  if (field === '@updated') return schema.properties.find((p) => p.type === 'updatedTime') ?? null
  return isPageField(field) ? null : propertyByField(schema.properties, field)
}

