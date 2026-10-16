// Tipos de objeto ("supertags"): modelo puro (sem React, sem store). docs/USAGE.md
// Qualquer página pode ganhar tipos; o tipo traz campos (o mesmo `Property` dos bancos), modelo,
// ícone/cor e uma coleção (projeção das páginas com o tipo). Nada aqui lança com dados antigos.
import type { DatabaseSchema, OptionColor, Page, Property, PropType, PropValue, View } from '../types'

export interface ObjectTypeTemplate {
  /** Snapshot de blocos BlockNote inserido em páginas vazias. */
  blocks?: unknown[]
  /** Valores padrão por id de campo (preenchem só campos vazios). */
  values?: Record<string, PropValue>
  /** Página-modelo lida ao vivo (tem prioridade sobre `blocks` quando existe). */
  sourcePageId?: string
}
export interface ObjectTypeCollection { views: View[]; activeViewId: string }
export interface ObjectType {
  id: string
  name: string
  icon: string | null
  color: OptionColor
  description: string
  properties: Property[]
  template: ObjectTypeTemplate
  titleTemplate?: string
  parentTypes?: string[]
  collection?: ObjectTypeCollection
  preset?: string
  /** Quando o usuário escolheu este tipo (galeria "Usar", "Novo tipo", aplicar). Tipo pronto sem isto e sem uso fica oculto. docs/USAGE.md */
  adoptedAt?: number
  /** Oculto só da seção "Tipos" da barra lateral (continua em ⌘K, seletor e Configurações). */
  sidebarHidden?: boolean
  createdAt: number
  updatedAt: number
}

export const TYPE_COLORS: OptionColor[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
/** Mesmas cores dos pontos das opções (db-tokens.css), para o grafo (canvas). */
export const TYPE_COLOR_HEX: Record<OptionColor, string> = {
  default: '#91918e', gray: '#91918e', brown: '#bb846c', orange: '#d7813a', yellow: '#cb9433',
  green: '#6c9b7d', blue: '#5b97bd', purple: '#a782c3', pink: '#cd749f', red: '#e16f64',
}
/** Tipos de campo que dependem de um banco e não existem em tipos de objeto. */
export const UNSUPPORTED_FIELD_TYPES: ReadonlySet<PropType> = new Set<PropType>(['title', 'formula', 'rollup', 'button', 'uniqueId'])
export const FIELD_TYPES: PropType[] = ['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person', 'files', 'place', 'relation', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy']
export const TYPE_SCHEMA_PREFIX = 'np-type:'
const MAX_DEPTH = 8

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const PROP_TYPES = new Set<string>(['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'createdTime', 'updatedTime', 'relation', 'person', 'files', 'createdBy', 'updatedBy', 'place'])
const VIEW_TYPES = new Set<string>(['table', 'board', 'gallery', 'list', 'calendar', 'timeline'])

export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()

/** Valor de propriedade aceitável (mesma regra de `workspace.ts`). */
export function validPropValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    || (object(value) && typeof value.start === 'string' && (value.end === undefined || typeof value.end === 'string'))
    || (object(value) && typeof value.label === 'string' && finite(value.lat) && finite(value.lng))
    || (object(value) && value.type === 'richText' && Array.isArray(value.runs) && value.runs.every((run) => object(run) && typeof run.text === 'string'))
    || (Array.isArray(value) && value.every((file) => object(file) && nonEmpty(file.id) && typeof file.name === 'string' && typeof file.data === 'string'))
}

function normalizeProperty(raw: unknown): Property | null {
  if (!object(raw) || !nonEmpty(raw.id) || typeof raw.name !== 'string' || !PROP_TYPES.has(String(raw.type))) return null
  const out = { ...raw } as unknown as Property
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options)) delete out.options
    else out.options = raw.options.filter((o) => object(o) && nonEmpty(o.id) && typeof o.name === 'string').map((o) => ({ ...(o as object), color: TYPE_COLORS.includes((o as { color: OptionColor }).color) ? (o as { color: OptionColor }).color : 'default' })) as Property['options']
  }
  if (out.relationDatabaseId !== undefined && typeof out.relationDatabaseId !== 'string') delete out.relationDatabaseId
  delete out.formula
  delete out.rollup
  delete out.buttonActions
  return out
}

function normalizeView(raw: unknown): View | null {
  if (!object(raw) || !nonEmpty(raw.id) || typeof raw.name !== 'string' || !VIEW_TYPES.has(String(raw.type))) return null
  return {
    ...(raw as object),
    filters: Array.isArray(raw.filters) ? raw.filters.filter((f) => object(f) && nonEmpty(f.id) && typeof f.propertyId === 'string' && typeof f.op === 'string') : [],
    sorts: Array.isArray(raw.sorts) ? raw.sorts.filter((s) => object(s) && typeof s.propertyId === 'string' && (s.direction === 'asc' || s.direction === 'desc')) : [],
    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((h): h is string => typeof h === 'string') : [],
    widths: object(raw.widths) ? Object.fromEntries(Object.entries(raw.widths).filter(([, w]) => finite(w) && w > 0)) : {},
  } as View
}

/** Normaliza a lista de tipos guardada em `settings.objectTypes`. Nunca lança. */
export function normalizeObjectTypes(raw: unknown): ObjectType[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ObjectType[] = []
  for (const item of raw) {
    if (!object(item) || !nonEmpty(item.id) || seen.has(item.id) || typeof item.name !== 'string') continue
    seen.add(item.id)
    const ids = new Set<string>()
    const properties = (Array.isArray(item.properties) ? item.properties : []).map(normalizeProperty).filter((p): p is Property => !!p && !ids.has(p.id) && !!ids.add(p.id))
    const template: ObjectTypeTemplate = {}
    if (object(item.template)) {
      if (Array.isArray(item.template.blocks)) template.blocks = item.template.blocks
      if (object(item.template.values)) template.values = Object.fromEntries(Object.entries(item.template.values).filter(([, v]) => validPropValue(v))) as Record<string, PropValue>
      if (nonEmpty(item.template.sourcePageId)) template.sourcePageId = item.template.sourcePageId
    }
    const type: ObjectType = {
      id: item.id, name: item.name, icon: typeof item.icon === 'string' && item.icon ? item.icon : null,
      color: TYPE_COLORS.includes(item.color as OptionColor) ? item.color as OptionColor : 'default',
      description: typeof item.description === 'string' ? item.description : '',
      properties, template,
      createdAt: finite(item.createdAt) ? item.createdAt : 0, updatedAt: finite(item.updatedAt) ? item.updatedAt : 0,
    }
    if (typeof item.titleTemplate === 'string' && item.titleTemplate) type.titleTemplate = item.titleTemplate
    if (Array.isArray(item.parentTypes)) { const parents = item.parentTypes.filter((p): p is string => nonEmpty(p) && p !== item.id); if (parents.length) type.parentTypes = [...new Set(parents)] }
    if (object(item.collection) && Array.isArray(item.collection.views)) {
      const views = item.collection.views.map(normalizeView).filter((v): v is View => !!v)
      if (views.length) type.collection = { views, activeViewId: views.some((v) => v.id === (item.collection as { activeViewId?: string }).activeViewId) ? String(item.collection.activeViewId) : views[0].id }
    }
    if (typeof item.preset === 'string') type.preset = item.preset
    if (finite(item.adoptedAt)) type.adoptedAt = item.adoptedAt
    if (item.sidebarHidden === true) type.sidebarHidden = true
    out.push(type)
  }
  // Pais inexistentes são descartados (não recusa dados antigos).
  for (const type of out) if (type.parentTypes) { type.parentTypes = type.parentTypes.filter((id) => seen.has(id)); if (!type.parentTypes.length) delete type.parentTypes }
  return out
}

/** `page.types` tolerante (array de strings sem duplicatas). */
export function normalizePageTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = [...new Set(raw.filter(nonEmpty))]
  return list.length ? list : undefined
}

// ---------- consulta ----------

export type TypeList = readonly ObjectType[]
const byIdCache = new WeakMap<TypeList, Map<string, ObjectType>>()
export function typeMap(types: TypeList): Map<string, ObjectType> {
  let map = byIdCache.get(types)
  if (!map) byIdCache.set(types, (map = new Map(types.map((type) => [type.id, type]))))
  return map
}
export function findType(types: TypeList, id: string | null | undefined): ObjectType | undefined { return id ? typeMap(types).get(id) : undefined }
export function findTypeByName(types: TypeList, name: string): ObjectType | undefined {
  const wanted = fold(name.replace(/^#/, ''))
  return wanted ? types.find((type) => fold(type.name) === wanted) : undefined
}

/** Ancestrais (pais, avós…) de um tipo, do mais próximo ao mais distante, sem ciclos. */
export function typeAncestors(types: TypeList, id: string): ObjectType[] {
  const out: ObjectType[] = []
  const seen = new Set([id])
  const walk = (typeId: string, depth: number) => {
    if (depth > MAX_DEPTH) return
    for (const parentId of findType(types, typeId)?.parentTypes ?? []) {
      if (seen.has(parentId)) continue
      seen.add(parentId)
      const parent = findType(types, parentId)
      if (!parent) continue
      out.push(parent)
      walk(parentId, depth + 1)
    }
  }
  walk(id, 0)
  return out
}

/** Pode `parentId` ser pai de `childId` sem criar ciclo? */
export function canInherit(types: TypeList, childId: string, parentId: string): boolean {
  return childId !== parentId && !typeAncestors(types, parentId).some((type) => type.id === childId)
}

/** Campos efetivos: os herdados primeiro (do ancestral mais distante), depois os próprios. */
export function effectiveProperties(types: TypeList, id: string): Property[] {
  const type = findType(types, id)
  if (!type) return []
  const chain = [...typeAncestors(types, id)].reverse()
  const out: Property[] = []
  const seen = new Set<string>()
  for (const source of [...chain, type]) for (const prop of source.properties) if (!seen.has(prop.id)) { seen.add(prop.id); out.push(prop) }
  return out
}

/** Tipos de uma página que ainda existem. */
export function pageTypes(types: TypeList, page: Pick<Page, 'types'> | undefined | null): ObjectType[] {
  return (page?.types ?? []).map((id) => findType(types, id)).filter((type): type is ObjectType => !!type)
}

/** A página tem o tipo (diretamente ou por um subtipo)? */
export function hasType(types: TypeList, page: Pick<Page, 'types'>, typeId: string): boolean {
  for (const id of page.types ?? []) if (id === typeId || typeAncestors(types, id).some((type) => type.id === typeId)) return true
  return false
}

/** Campos de todos os tipos da página (sem duplicar), com o tipo dono de cada um. */
export function pageTypeFields(types: TypeList, page: Pick<Page, 'types'> | undefined | null): { type: ObjectType; property: Property }[] {
  const out: { type: ObjectType; property: Property }[] = []
  const seen = new Set<string>()
  for (const type of pageTypes(types, page)) for (const property of effectiveProperties(types, type.id)) if (!seen.has(property.id)) { seen.add(property.id); out.push({ type, property }) }
  return out
}

/** Campo de tipo da página com este id (para encaminhar `setProp` a `typeProps`). */
export function typeFieldOwner(types: TypeList | undefined, page: Pick<Page, 'types'> | undefined, propId: string): Property | undefined {
  if (!types?.length || !page?.types?.length) return undefined
  return pageTypeFields(types, page).find((field) => field.property.id === propId)?.property
}

/** Valores guardados que não pertencem a nenhum campo atual (tipo removido ou campo excluído). */
export function orphanTypeValues(types: TypeList, page: Pick<Page, 'types' | 'typeProps'>): string[] {
  const live = new Set(pageTypeFields(types, page).map((field) => field.property.id))
  return Object.keys(page.typeProps ?? {}).filter((key) => !live.has(key) && !isEmptyValue(page.typeProps![key]))
}

export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * Campo incorporado (mesmo id no tipo e no banco): enquanto a linha está no banco, `props` manda; fora dele, `typeProps`.
 * Devolve o novo `typeProps` que espelha `props` nos campos de tipo da página (ou null se nada muda). `schema` = banco
 * onde a linha está (ou estava). Com `schema`, `props` vence mesmo que `typeProps` tenha valor (o banco é a fonte
 * enquanto a linha está nele); sem `schema`, só preenche o que `typeProps` ainda não tem (chave ausente).
 * Não apaga `props`: voltar ao banco continua mostrando o valor.
 */
export function mirrorIncorporatedValues(types: TypeList, page: Pick<Page, 'types' | 'props' | 'typeProps'>, schema?: DatabaseSchema): Record<string, PropValue> | null {
  if (!page.types?.length || !page.props) return null
  let next: Record<string, PropValue> | null = null
  for (const { property } of pageTypeFields(types, page)) {
    const id = property.id
    if (!(id in page.props) || isEmptyValue(page.props[id])) continue
    const inDb = !!schema?.properties.some((p) => p.id === id)
    const current: Record<string, PropValue> = next ?? page.typeProps ?? {}
    if (!inDb && id in current) continue
    if (JSON.stringify(current[id] ?? null) === JSON.stringify(page.props[id])) continue
    next = { ...current, [id]: page.props[id] }
  }
  return next
}

/** `typeProps` com o fallback de leitura: valor guardado em `props` (campo incorporado) enquanto o campo não tem chave própria. */
export function readTypeProps(types: TypeList, page: Pick<Page, 'types' | 'props' | 'typeProps'>): Record<string, PropValue> {
  const base = page.typeProps ?? {}
  if (!page.props || !page.types?.length) return base
  let out = base
  for (const { property } of pageTypeFields(types, page)) {
    const id = property.id
    if (id in base || !(id in page.props) || isEmptyValue(page.props[id])) continue
    if (out === base) out = { ...base }
    out[id] = page.props[id]
  }
  return out
}

// ---------- operações puras sobre páginas ----------

export interface TitleContext { now?: number; count?: number; locale?: 'pt-BR' | 'en-US' }
export function renderTitleTemplate(template: string, type: Pick<ObjectType, 'name'>, ctx: TitleContext = {}): string {
  const date = new Date(ctx.now ?? Date.now())
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return template.replace(/\{(data|date|tipo|type|n)\}/gi, (_m, token: string) => {
    const key = token.toLowerCase()
    if (key === 'data' || key === 'date') return iso
    if (key === 'tipo' || key === 'type') return type.name
    return String((ctx.count ?? 0) + 1)
  }).trim()
}

/** Patch para aplicar `typeId`: adiciona o tipo e preenche valores padrão só em campos vazios. */
export function applyTypePatch(types: TypeList, page: Page, typeId: string, ctx: TitleContext = {}): Partial<Page> | null {
  const type = findType(types, typeId)
  if (!type || page.types?.includes(typeId)) return null
  const nextTypes = [...(page.types ?? []), typeId]
  const typeProps: Record<string, PropValue> = { ...(page.typeProps ?? {}) }
  const chain = [...typeAncestors(types, typeId)].reverse().concat(type)
  for (const source of chain) for (const [propId, value] of Object.entries(source.template.values ?? {})) {
    if (!source.properties.some((p) => p.id === propId)) continue
    if (isEmptyValue(typeProps[propId]) && !isEmptyValue(value)) typeProps[propId] = structuredClone(value)
  }
  const patch: Partial<Page> = { types: nextTypes }
  if (Object.keys(typeProps).length) patch.typeProps = typeProps
  if (!page.title.trim() && type.titleTemplate) patch.title = renderTitleTemplate(type.titleTemplate, type, ctx)
  return patch
}

/** Patch para remover `typeId` (valores preservados em `typeProps`). */
export function removeTypePatch(page: Page, typeId: string): Partial<Page> | null {
  if (!page.types?.includes(typeId)) return null
  const rest = page.types.filter((id) => id !== typeId)
  return { types: rest.length ? rest : undefined }
}

/** Patch que apaga os valores órfãos (confirmação do usuário). */
export function purgeOrphansPatch(types: TypeList, page: Page): Partial<Page> | null {
  const orphans = orphanTypeValues(types, page)
  if (!orphans.length && !Object.keys(page.typeProps ?? {}).some((key) => isEmptyValue(page.typeProps![key]))) return null
  const live = new Set(pageTypeFields(types, page).map((field) => field.property.id))
  const typeProps = Object.fromEntries(Object.entries(page.typeProps ?? {}).filter(([key]) => live.has(key)))
  return { typeProps: Object.keys(typeProps).length ? typeProps : undefined }
}

// ---------- esquema virtual (coleção) ----------

export const typeSchemaId = (typeId: string) => TYPE_SCHEMA_PREFIX + typeId
export function typeIdFromSchemaId(id: string): string | null { return id.startsWith(TYPE_SCHEMA_PREFIX) ? id.slice(TYPE_SCHEMA_PREFIX.length) : null }
export const TITLE_FIELD_ID = 'np-type-title'

export function defaultCollection(type: ObjectType, names: { table: string } = { table: 'Tabela' }): ObjectTypeCollection {
  const id = `${type.id}:table`
  return { views: [{ id, name: names.table, type: 'table', filters: [], sorts: [], hidden: [], widths: {}, showPageIcon: true }], activeViewId: id }
}

/** Esquema de banco equivalente ao tipo (título + campos efetivos + visões da coleção). */
export function schemaFromType(types: TypeList, type: ObjectType, titleName = 'Nome'): DatabaseSchema {
  const collection = type.collection ?? defaultCollection(type)
  return { properties: [{ id: TITLE_FIELD_ID, name: titleName, type: 'title' }, ...effectiveProperties(types, type.id)], views: collection.views, activeViewId: collection.activeViewId }
}

/**
 * Aplica ao tipo uma transformação escrita para esquemas de banco (PropertyMenu, OptionsEditor,
 * visualizações). Campos herdados alterados voltam ao tipo que os define.
 */
export function applySchemaFn(types: TypeList, typeId: string, fn: (schema: DatabaseSchema) => DatabaseSchema, now = Date.now()): ObjectType[] | null {
  const type = findType(types, typeId)
  if (!type) return null
  const before = schemaFromType(types, type)
  const after = fn(before)
  if (!after || after === before) return null
  const fields = after.properties.filter((p) => p.type !== 'title' && !UNSUPPORTED_FIELD_TYPES.has(p.type))
  const inherited = new Map<string, string>()
  for (const ancestor of typeAncestors(types, typeId)) for (const prop of ancestor.properties) if (!inherited.has(prop.id)) inherited.set(prop.id, ancestor.id)
  const views = after.views.filter((v) => VIEW_TYPES.has(v.type))
  return types.map((candidate) => {
    if (candidate.id === typeId) {
      const own = fields.filter((p) => !inherited.has(p.id))
      return { ...candidate, properties: own, collection: views.length ? { views, activeViewId: views.some((v) => v.id === after.activeViewId) ? after.activeViewId : views[0].id } : candidate.collection, updatedAt: now }
    }
    const changed = candidate.properties.map((p) => (inherited.get(p.id) === candidate.id ? fields.find((f) => f.id === p.id) ?? p : p))
    return changed.some((p, i) => p !== candidate.properties[i]) ? { ...candidate, properties: changed, updatedAt: now } : candidate
  })
}

// ---------- índice por tipo (memoizado por objeto `pages`) ----------

const indexCache = new WeakMap<Record<string, Page>, { types: TypeList; byType: Map<string, string[]> }>()
/** Páginas vivas por tipo (inclui subtipos). Ignora lixeira (página ou ancestral). */
export function typeIndex(pages: Record<string, Page>, types: TypeList): Map<string, string[]> {
  const cached = indexCache.get(pages)
  if (cached && cached.types === types) return cached.byType
  const byType = new Map<string, string[]>()
  const live = new Map<string, boolean>()
  const isLive = (id: string): boolean => {
    const known = live.get(id)
    if (known !== undefined) return known
    const chain: string[] = []
    let current: Page | undefined = pages[id]
    let result = true
    let guard = 0
    while (current) {
      if (current.trashed || ++guard > 512) { result = false; break }
      const k = live.get(current.id)
      if (k !== undefined) { result = k; break }
      chain.push(current.id)
      if (!current.parentId) break
      current = pages[current.parentId]
      if (!current) { result = false; break }
    }
    for (const item of chain) live.set(item, result)
    return result
  }
  const ancestors = new Map<string, string[]>()
  for (const id in pages) {
    const page = pages[id]
    if (!page.types?.length || !isLive(id)) continue
    const all = new Set<string>()
    for (const typeId of page.types) {
      if (!findType(types, typeId)) continue
      all.add(typeId)
      let up = ancestors.get(typeId)
      if (!up) ancestors.set(typeId, (up = typeAncestors(types, typeId).map((t) => t.id)))
      for (const a of up) all.add(a)
    }
    for (const typeId of all) { let list = byType.get(typeId); if (!list) byType.set(typeId, (list = [])); list.push(id) }
  }
  indexCache.set(pages, { types, byType })
  return byType
}

/** Fonte de páginas de um tipo (gancho para uma futura fonte `type` das consultas vivas). */
export function pagesWithType(pages: Record<string, Page>, types: TypeList, typeId: string): Page[] {
  return (typeIndex(pages, types).get(typeId) ?? []).map((id) => pages[id]).filter(Boolean)
}

// ---------- #tag ----------

/** Tipos citados como `#Nome` no texto que a página ainda não tem. */
export function typeTagsIn(text: string, types: TypeList, page: Pick<Page, 'types'>): ObjectType[] {
  if (!text || !types.length || !text.includes('#')) return []
  const out: ObjectType[] = []
  const folded = fold(text)
  for (const type of types) {
    if (page.types?.includes(type.id) || !type.name.trim()) continue
    const name = fold(type.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ _-]?')
    if (new RegExp(`(^|[^\\p{L}\\p{N}#/&])#${name}(?![\\p{L}\\p{N}_-])`, 'u').test(folded)) out.push(type)
  }
  return out
}

// ---------- importação ----------

/** Junta tipos importados aos locais: mesmo id mantém o local e acrescenta campos ausentes. */
export function mergeImportedTypes(local: TypeList, imported: TypeList): ObjectType[] {
  if (!imported.length) return [...local]
  const out = [...local]
  for (const incoming of imported) {
    const index = out.findIndex((type) => type.id === incoming.id)
    if (index < 0) { out.push(incoming); continue }
    const current = out[index]
    const missing = incoming.properties.filter((p) => !current.properties.some((own) => own.id === p.id))
    if (missing.length) out[index] = { ...current, properties: [...current.properties, ...missing] }
  }
  return normalizeObjectTypes(out)
}

// ---------- privacidade ----------

/** Página protegida por senha e trancada: campos/valores não podem aparecer. */
export function typeDataHidden(page: Pick<Page, 'passwordLock'> | undefined | null): boolean {
  return !!page?.passwordLock && !page.passwordLock.unlocked
}
