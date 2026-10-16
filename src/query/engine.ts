// Motor das consultas vivas: reúne candidatos da fonte, aplica filtros E/OU aninhados (reaproveitando
// o núcleo de filtro dos bancos — src/components/database/filterEngine.ts), ordena, agrupa e limita.
// Puro (sem store/React). Privacidade: lixeira e páginas protegidas por senha (e tudo abaixo delas)
// nunca entram como candidatas — títulos e conteúdo protegidos não chegam a ser lidos.
// Desempenho: cache por linha (WeakMap pela identidade imutável da página) e avaliação em fatias
// (gerador) para o modo assíncrono não travar a thread principal.
import { parseIconValue } from '../components/ui/icons/iconValue.ts'
import type { DateValue, Page, Property, PropValue } from '../types'
import { dayInZone, matchValue, resolveDateRange, sortKeyOf, todayFor, valueText, isRelativeDate, type FilterEnv, type SortKey } from '../components/database/filterEngine.ts'
import { resolveValue } from '../components/database/derived.ts'
import { liveChildren } from '../perf/pageIndex.ts'
import { collectTasks, type ChecklistEntry, type TaskItem } from '../tasks/taskCore.ts'
import { MAX_DEPTH, isPageField, queryFields, queryRules, type Query, type QueryNode, type QueryRule } from './model.ts'
import { registeredTypes } from '../objecttypes/registry.ts'
import { pagesWithType, type TypeList } from '../objecttypes/model.ts'
import { PAGE_TYPE_FIELD, directTypes, matchPageType, pageTypeValue, typeFieldOf, typeFields, typeProperty, typeSortKey } from './typeField.ts'

export interface QueryEnv extends FilterEnv {
  locale?: 'pt-BR' | 'en-US'
  /** Itens de checklist por página (fonte "tarefas"); páginas protegidas nunca devem constar. */
  checklists?: ReadonlyMap<string, readonly ChecklistEntry[]>
  /** Tarefas já reunidas (índice do app); quando presente substitui `checklists`. */
  tasks?: readonly TaskItem[]
  /** Tipos de objeto (padrão: a lista registrada pela store). */
  types?: TypeList
}

export interface QueryIssue { kind: 'missingDatabase' | 'lockedDatabase' | 'unknownField' | 'missingPage' | 'missingType'; detail: string }
/** `typeId`: grupo de um tipo de objeto (agrupar por Tipo). */
export interface QueryGroupResult { key: string; label: string; rows: Page[]; typeId?: string }
export interface QueryResult {
  rows: Page[]
  /** Total antes do limite. */
  total: number
  groups: QueryGroupResult[] | null
  /** Bancos (pais) das linhas do resultado, na ordem em que aparecem. */
  databaseIds: string[]
  issues: QueryIssue[]
  /** Linhas sintéticas da fonte "tarefas" → item original. */
  tasks?: Map<string, TaskItem>
  elapsedMs: number
}

type Pages = Record<string, Page>
const CROSS_ROW = new Set(['formula', 'rollup', 'relation'])
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()

// ---------- privacidade / visibilidade ----------

const visibility = new WeakMap<Pages, Map<string, boolean>>()
/** Página existe, nem ela nem ancestrais estão na lixeira ou protegidos por senha (memo por versão). */
export function isQueryable(pages: Pages, id: string | null | undefined): boolean {
  if (!id) return false
  let memo = visibility.get(pages)
  if (!memo) visibility.set(pages, (memo = new Map()))
  const known = memo.get(id)
  if (known !== undefined) return known
  const path: string[] = []
  let current: Page | undefined = pages[id], result = true, guard = 0
  while (current) {
    const cached = memo.get(current.id)
    if (cached !== undefined) { result = cached; break }
    path.push(current.id)
    if (current.trashed || current.passwordLock || ++guard > 512) { result = false; break }
    if (!current.parentId) break
    const parent: Page | undefined = pages[current.parentId]
    if (!parent) { result = false; break }
    current = parent
  }
  if (!pages[id]) result = false
  for (const key of path) memo.set(key, result)
  return result
}

// ---------- campos ----------

const PAGE_PROPS: Record<string, Property> = {
  '@title': { id: '@title', name: 'Title', type: 'title' },
  '@created': { id: '@created', name: 'Created', type: 'createdTime' },
  '@updated': { id: '@updated', name: 'Edited', type: 'updatedTime' },
  '@parent': { id: '@parent', name: 'Parent', type: 'relation' },
  '@icon': { id: '@icon', name: 'Icon', type: 'text' },
  '@cover': { id: '@cover', name: 'Cover', type: 'checkbox' },
  '@words': { id: '@words', name: 'Words', type: 'number' },
  '@favorite': { id: '@favorite', name: 'Favorite', type: 'checkbox' },
  '@content': { id: '@content', name: 'Content', type: 'text' },
  '@database': { id: '@database', name: 'Database', type: 'text' },
  '@type': { id: '@type', name: 'Type', type: 'multiSelect' },
  '@due': { id: '@due', name: 'Due', type: 'date' },
  '@done': { id: '@done', name: 'Done', type: 'checkbox' },
  '@source': { id: '@source', name: 'Source', type: 'text' },
}
export function pageFieldProperty(field: string): Property | undefined { return PAGE_PROPS[field] }
const MISSING: Property = { id: '@missing', name: '', type: 'text' }

const words = new WeakMap<Page, number>()
export function wordCount(page: Page): number {
  let n = words.get(page)
  if (n === undefined) { n = (page.text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0; words.set(page, n) }
  return n
}

const fieldCache = new WeakMap<object, Map<string, Property | null>>()
/** Propriedade com esse nome (sem acentos/caixa) ou id no esquema. */
export function propertyByField(properties: readonly Property[], field: string): Property | null {
  let map = fieldCache.get(properties)
  if (!map) fieldCache.set(properties, (map = new Map()))
  const hit = map.get(field)
  if (hit !== undefined) return hit
  const name = fold(field)
  const found = properties.find((property) => property.id === field) ?? properties.find((property) => fold(property.name) === name) ?? null
  map.set(field, found)
  return found
}

const taskOf = new WeakMap<Page, TaskItem>()

const typesOf = (env: { types?: TypeList }): TypeList => env.types ?? registeredTypes()

/**
 * Valor de um campo numa linha + a propriedade que define sua semântica de filtro/ordenação.
 * Nomes que não são propriedade do banco da linha caem nos campos dos tipos de objeto da página (`typeProps`).
 */
export function fieldValue(row: Page, field: string, pages: Pages, types: TypeList = registeredTypes()): { value: PropValue; prop: Property } {
  if (isPageField(field)) {
    const prop = PAGE_PROPS[field] ?? MISSING
    const task = taskOf.get(row)
    switch (field) {
      case '@title': return { value: row.title, prop }
      case '@created': return { value: row.createdAt, prop }
      case '@updated': return { value: row.updatedAt, prop }
      case '@parent': return { value: task ? [task.sourceId] : row.parentId ? [row.parentId] : [], prop }
      case '@icon': { const icon = parseIconValue(row.icon); return { value: icon?.kind === 'text' ? icon.text : icon?.kind === 'glyph' ? icon.name : icon ? '🖼' : '', prop } }
      case '@cover': return { value: !!row.cover, prop }
      case '@words': return { value: wordCount(row), prop }
      case '@favorite': return { value: !!row.favorite, prop }
      case '@content': return { value: row.text ?? '', prop }
      case '@type': return { value: task ? [] : pageTypeValue(types, row), prop: typeProperty(types) }
      case '@database': { const parent = row.parentId ? pages[row.parentId] : undefined; return { value: parent?.database ? parent.title : task?.databaseId ? pages[task.databaseId]?.title ?? '' : '', prop } }
      case '@due': return { value: task?.due ? { start: task.due, ...(task.time ? { startTime: task.time } : {}) } as DateValue : null, prop }
      case '@done': return { value: !!task?.done, prop }
      case '@source': return { value: task?.sourceTitle ?? '', prop }
      default: return { value: null, prop: MISSING }
    }
  }
  const parent = row.parentId ? pages[row.parentId] : undefined
  const properties = parent?.database?.properties
  const prop = properties ? propertyByField(properties, field) : null
  if (!prop) {
    const typed = row.types?.length ? typeFieldOf(types, row, field) : null
    if (!typed) return { value: null, prop: MISSING }
    const derived = typed.property.type === 'createdTime' || typed.property.type === 'updatedTime' || typed.property.type === 'createdBy' || typed.property.type === 'updatedBy'
    return { value: derived ? resolveValue(row, typed.property, pages) : typed.value, prop: typed.property }
  }
  return { value: resolveValue(row, prop, pages), prop }
}

// ---------- candidatos ----------

function databaseRows(pages: Pages, id: string, seen = new Set<string>()): Page[] {
  if (seen.has(id) || seen.size > 64) return []
  seen.add(id)
  const schema = pages[id]?.database
  if (!schema) return []
  if (schema.linkedSourceId) return databaseRows(pages, schema.linkedSourceId, seen)
  const own = liveChildren(pages, id)
  const extra = (schema.sourceDatabaseIds ?? []).flatMap((source) => databaseRows(pages, source, seen))
  return extra.length ? [...own, ...extra] : own
}

/** Banco real (segue visualizações vinculadas). */
export function actualDatabaseId(pages: Pages, id: string): string {
  let current = id, guard = 0
  while (pages[current]?.database?.linkedSourceId && guard++ < 32) current = pages[current]!.database!.linkedSourceId!
  return current
}

function hasTag(page: Page, tag: string, pages: Pages): boolean {
  const wanted = fold(tag)
  if (!wanted) return false
  const text = page.text ?? ''
  if (text.includes('#')) {
    const re = /#([\p{L}\p{N}_\-/]+)/gu
    let match: RegExpExecArray | null, guard = 0
    while ((match = re.exec(text)) && guard++ < 2000) if (fold(match[1]) === wanted) return true
  }
  const schema = page.parentId ? pages[page.parentId]?.database : undefined
  if (schema && page.props) for (const property of schema.properties) {
    if (property.type !== 'select' && property.type !== 'multiSelect' && property.type !== 'status') continue
    const raw = page.props[property.id]
    const ids = (Array.isArray(raw) ? raw : [raw]) as unknown[]
    if (property.options?.some((option) => ids.includes(option.id) && fold(option.name) === wanted)) return true
  }
  return false
}

interface Candidates { rows: Page[]; manualOrder: boolean; issues: QueryIssue[]; tasks?: Map<string, TaskItem> }

const taskRowCache = new WeakMap<TaskItem, Page>()
function taskRow(item: TaskItem, pages: Pages): Page {
  let row = taskRowCache.get(item)
  const owner = pages[item.pageId]
  if (!row) {
    row = { id: `task:${item.key}`, parentId: null, title: item.title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null,
      createdAt: owner?.createdAt ?? 0, updatedAt: owner?.updatedAt ?? 0, order: 0, fullWidth: false, smallText: false, font: 'default', locked: true, text: item.title }
    taskRowCache.set(item, row)
    taskOf.set(row, item)
  }
  return row
}

export function taskForRow(row: Page): TaskItem | undefined { return taskOf.get(row) }

function candidates(query: Query, env: QueryEnv): Candidates {
  const { pages } = env
  const source = query.source
  const issues: QueryIssue[] = []
  const thisPage = env.thisPageId
  const target = !source.pageId || source.pageId === '@thisPage' ? thisPage : source.pageId
  const visible = (page: Page) => isQueryable(pages, page.id)
  switch (source.kind) {
    case 'database':
    case 'databases': {
      const out: Page[] = []
      const seen = new Set<string>()
      for (const id of source.databaseIds ?? []) {
        const db = pages[id]
        if (!db?.database) { issues.push({ kind: 'missingDatabase', detail: id }); continue }
        if (!isQueryable(pages, id) || !isQueryable(pages, actualDatabaseId(pages, id))) { issues.push({ kind: db.trashed ? 'missingDatabase' : 'lockedDatabase', detail: id }); continue }
        for (const row of databaseRows(pages, id)) if (!seen.has(row.id) && visible(row)) { seen.add(row.id); out.push(row) }
      }
      return { rows: out, manualOrder: true, issues }
    }
    case 'children': {
      if (!target || !pages[target]) { issues.push({ kind: 'missingPage', detail: target ?? '' }); return { rows: [], manualOrder: true, issues } }
      if (!isQueryable(pages, target)) return { rows: [], manualOrder: true, issues }
      if (!source.deep) return { rows: liveChildren(pages, target).filter(visible), manualOrder: true, issues }
      const out: Page[] = [], stack = [target], seen = new Set([target])
      while (stack.length && out.length < 200_000) {
        const id = stack.pop()!
        const kids = liveChildren(pages, id)
        for (let i = kids.length - 1; i >= 0; i--) if (!seen.has(kids[i].id)) { seen.add(kids[i].id); if (visible(kids[i])) { stack.push(kids[i].id) } }
        if (id !== target) out.push(pages[id])
      }
      return { rows: out, manualOrder: true, issues }
    }
    case 'backlinks': {
      if (!target) return { rows: [], manualOrder: false, issues }
      const rows = Object.values(pages).filter((page) => page.id !== target && (page.outboundPageIds?.includes(target) || page.bodyOutboundPageIds?.includes(target)) && visible(page))
      return { rows, manualOrder: false, issues }
    }
    case 'relatedToThis': {
      if (!thisPage) return { rows: [], manualOrder: false, issues }
      const dbs = source.databaseIds?.length ? source.databaseIds.map((id) => actualDatabaseId(pages, id)) : Object.values(pages).filter((page) => page.database && !page.database.linkedSourceId).map((page) => page.id)
      const out: Page[] = []
      for (const id of dbs) {
        const schema = pages[id]?.database
        const relations = schema?.properties.filter((property) => property.type === 'relation') ?? []
        if (!relations.length || !isQueryable(pages, id)) continue
        for (const row of liveChildren(pages, id)) if (relations.some((property) => { const v = row.props?.[property.id]; return Array.isArray(v) && (v as string[]).includes(thisPage) }) && visible(row)) out.push(row)
      }
      return { rows: out, manualOrder: false, issues }
    }
    case 'tag': {
      const tag = source.tag ?? ''
      return { rows: tag ? Object.values(pages).filter((page) => !page.database && hasTag(page, tag, pages) && visible(page)) : [], manualOrder: false, issues }
    }
    case 'modified': {
      const now = env.now === undefined ? Date.now() : typeof env.now === 'number' ? env.now : env.now.getTime()
      const since = now - (source.days ?? 7) * 86_400_000
      return { rows: Object.values(pages).filter((page) => page.updatedAt >= since && visible(page)), manualOrder: false, issues }
    }
    case 'type': {
      const types = typesOf(env)
      const out: Page[] = []
      const seen = new Set<string>()
      for (const id of source.typeIds ?? []) {
        if (!types.some((type) => type.id === id)) { issues.push({ kind: 'missingType', detail: id }); continue }
        for (const page of pagesWithType(pages, types, id)) if (!seen.has(page.id) && visible(page)) { seen.add(page.id); out.push(page) }
      }
      return { rows: out, manualOrder: false, issues }
    }
    case 'tasks': {
      const items = env.tasks ?? collectTasks({ pages, checklists: env.checklists ?? new Map(), locale: env.locale, includeDone: !!source.includeDone })
      const tasks = new Map<string, TaskItem>()
      const rows: Page[] = []
      for (const item of items) {
        if (!isQueryable(pages, item.pageId)) continue
        const row = taskRow(item, pages)
        tasks.set(row.id, item)
        rows.push(row)
      }
      return { rows, manualOrder: false, issues, tasks }
    }
    default:
      return { rows: Object.values(pages).filter(visible), manualOrder: false, issues }
  }
}

// ---------- avaliação ----------

interface RowEntry { pass: boolean; keys: SortKey[]; schema: unknown }
export interface QueryCache {
  key?: string
  pages?: Pages
  crossRow?: boolean
  perRow: WeakMap<Page, RowEntry>
  /** Última assinatura de dependências e resultado correspondente. */
  deps?: unknown[]
  result?: QueryResult
  /** Consulta (JSON) do último resultado: só dados mudaram → pode adiar; consulta mudou → imediato. */
  queryKey?: string
}
export function createQueryCache(): QueryCache { return { perRow: new WeakMap() } }

const collators = new Map<string, Intl.Collator>()
const collatorFor = (locale: string) => { let c = collators.get(locale); if (!c) collators.set(locale, (c = new Intl.Collator(locale, { numeric: true }))); return c }

function evalNode(node: QueryNode, row: Page, env: QueryEnv, depth: number, cross: { value: boolean }): boolean {
  if (depth > MAX_DEPTH) return false
  if (node.kind === 'rule') {
    if (node.field === PAGE_TYPE_FIELD) return taskOf.has(row) ? node.op === 'isEmpty' || node.op === 'isNot' || node.op === 'notContains' : matchPageType(typesOf(env), row, node.op, node.value)
    const { value, prop } = fieldValue(row, node.field, env.pages, typesOf(env))
    if (CROSS_ROW.has(prop.type) || node.field === '@parent' || node.field === '@database') cross.value = true
    if (prop === MISSING) return node.op === 'isEmpty' || node.op === 'isNot' || node.op === 'notContains'
    // Lista de valores = "qualquer um de" (positivo) / "nenhum de" (negativo).
    if (Array.isArray(node.value)) {
      const negative = node.op === 'isNot' || node.op === 'notContains'
      const list = node.value
      if (!list.length) return true
      return negative ? list.every((item) => matchValue(value, prop, { op: node.op, value: item }, env)) : list.some((item) => matchValue(value, prop, { op: node.op, value: item }, env))
    }
    return matchValue(value, prop, { op: node.op, value: node.value }, env)
  }
  if (!node.children.length) return true
  const pass = node.operator === 'and' ? node.children.every((child) => evalNode(child, row, env, depth + 1, cross)) : node.children.some((child) => evalNode(child, row, env, depth + 1, cross))
  return node.negate ? !pass : pass
}

const stamps = new WeakMap<object, number>()
let stampSeq = 0
/** Número estável por identidade (assinaturas de cache). */
function stamp(value: object): number { let n = stamps.get(value); if (n === undefined) stamps.set(value, (n = ++stampSeq)); return n }

/** Assinatura dos parâmetros que mudam o resultado de cada linha (fora os dados). */
function evaluationKey(query: Query, env: QueryEnv): string {
  const relative = queryRules(query.filter).some((rule) => isRelativeDate(rule.value))
  return JSON.stringify([query.filter, query.sorts, env.locale ?? 'pt-BR', env.thisPageId ?? '', env.timeZone ?? '', env.weekStart ?? 0, relative ? todayFor(env) : '', stamp(typesOf(env))])
}

const CHUNK = 4096

/** Avaliação em gerador: rende a cada CHUNK linhas para o modo fatiado. */
export function* evaluateQuery(query: Query, env: QueryEnv, cache: QueryCache = createQueryCache()): Generator<void, QueryResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const pages = env.pages
  const locale = env.locale ?? 'pt-BR'
  const key = evaluationKey(query, env)
  if (cache.key !== key || (cache.crossRow && cache.pages !== pages)) { cache.perRow = new WeakMap(); cache.key = key; cache.crossRow = false }
  cache.pages = pages
  const found = candidates(query, env)
  const issues = [...found.issues]
  // Campos desconhecidos (nenhum esquema envolvido os conhece): avisa, mas segue avaliando (valor vazio).
  const schemas = new Set<readonly Property[]>()
  const sourceDbs = query.source.kind === 'database' || query.source.kind === 'databases' ? (query.source.databaseIds ?? []).map((id) => actualDatabaseId(pages, id)) : null
  if (sourceDbs) for (const id of sourceDbs) { const props = pages[id]?.database?.properties; if (props) schemas.add(props) }
  const rows = found.rows
  const sorts = query.sorts
  const types = typesOf(env)
  const typedSchemas = new Set<string>()
  const cross = { value: false }
  const passed: { row: Page; keys: SortKey[]; index: number }[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i && i % CHUNK === 0) yield
    const row = rows[i]
    const schema = row.parentId ? pages[row.parentId]?.database?.properties : undefined
    if (!sourceDbs && schema && schemas.size < 256) schemas.add(schema)
    if (row.types?.length && typedSchemas.size < 256) for (const typeId of row.types) if (!typedSchemas.has(typeId)) { typedSchemas.add(typeId); schemas.add(typeFields(types, typeId)) }
    let entry = cache.perRow.get(row)
    if (!entry || entry.schema !== schema) {
      const rowCross = { value: false }
      const pass = evalNode(query.filter, row, env, 0, rowCross)
      const keys = pass ? sorts.map((sort) => { if (sort.field === PAGE_TYPE_FIELD) return typeSortKey(types, row); const { value, prop } = fieldValue(row, sort.field, pages, types); if (CROSS_ROW.has(prop.type)) rowCross.value = true; return prop === MISSING ? null : sortKeyOf(value, prop, env) }) : []
      entry = { pass, keys, schema }
      if (rowCross.value) cross.value = true
      cache.perRow.set(row, entry)
    }
    if (entry.pass) passed.push({ row, keys: entry.keys, index: i })
  }
  if (cross.value) cache.crossRow = true
  for (const field of queryFields(query)) {
    if (isPageField(field)) continue
    if (schemas.size && ![...schemas].some((properties) => propertyByField(properties, field))) issues.push({ kind: 'unknownField', detail: field })
  }
  const collator = collatorFor(locale)
  if (sorts.length) {
    passed.sort((a, b) => {
      for (let k = 0; k < sorts.length; k++) {
        const ka = a.keys[k], kb = b.keys[k]
        if (ka === kb) continue
        if (ka === null) return 1
        if (kb === null) return -1
        const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb))
        if (cmp !== 0) return sorts[k].direction === 'asc' ? cmp : -cmp
      }
      return a.index - b.index
    })
  } else if (!found.manualOrder && query.source.kind !== 'tasks') {
    // Sem ordenação explícita: editadas mais recentemente primeiro (fontes que não têm ordem manual).
    passed.sort((a, b) => b.row.updatedAt - a.row.updatedAt || a.index - b.index)
  }
  const total = passed.length
  const limited = query.limit ? passed.slice(0, query.limit) : passed
  const out = limited.map((item) => item.row)
  const groups = query.groupBy ? query.groupBy === PAGE_TYPE_FIELD ? groupByType(out, types, collator) : groupRows(out, query.groupBy, env, collator) : null
  const databaseIds: string[] = []
  const seenDb = new Set<string>()
  for (const row of out) { const id = row.parentId; if (id && !seenDb.has(id) && pages[id]?.database) { seenDb.add(id); databaseIds.push(id) } }
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return { rows: out, total, groups, databaseIds, issues, ...(found.tasks ? { tasks: found.tasks } : {}), elapsedMs: ended - started }
}

function groupRows(rows: Page[], field: string, env: QueryEnv, collator: Intl.Collator): QueryGroupResult[] {
  const groups = new Map<string, QueryGroupResult & { order: number | string }>()
  const locale = env.locale ?? 'pt-BR'
  for (const row of rows) {
    const { value, prop } = fieldValue(row, field, env.pages, typesOf(env))
    let key: string, label: string, order: number | string
    if ((prop.type === 'select' || prop.type === 'status') && typeof value === 'string') {
      const index = prop.options?.findIndex((option) => option.id === value) ?? -1
      const option = index >= 0 ? prop.options![index] : undefined
      label = option?.name ?? ''
      key = label ? `o:${fold(label)}` : ''
      order = index >= 0 ? index : label
    } else if (prop.type === 'createdTime' || prop.type === 'updatedTime') {
      label = typeof value === 'number' ? dayInZone(value, env.timeZone) : ''
      key = label; order = label
    } else if (prop.type === 'date' && value && typeof value === 'object' && 'start' in value) {
      label = (value as DateValue).start; key = label; order = label
    } else {
      label = valueText(value, prop, env.pages, locale)
      key = fold(label); order = label
    }
    let group = groups.get(key)
    if (!group) groups.set(key, (group = { key: key || '__empty__', label, rows: [], order }))
    group.rows.push(row)
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.label !== !b.label) return a.label ? -1 : 1
    if (typeof a.order === 'number' && typeof b.order === 'number') return a.order - b.order
    return collator.compare(String(a.order), String(b.order))
  }).map(({ key, label, rows }) => ({ key, label, rows }))
}

/** Agrupar por Tipo: a página entra no grupo de cada tipo direto; sem tipo vai para o fim ("Sem tipo"). */
function groupByType(rows: Page[], types: TypeList, collator: Intl.Collator): QueryGroupResult[] {
  const groups = new Map<string, QueryGroupResult>()
  const empty: QueryGroupResult = { key: '__empty__', label: '', rows: [] }
  for (const row of rows) {
    const list = taskOf.has(row) ? [] : directTypes(types, row)
    if (!list.length) { empty.rows.push(row); continue }
    for (const type of list) {
      let group = groups.get(type.id)
      if (!group) groups.set(type.id, (group = { key: `t:${type.id}`, label: type.name, rows: [], typeId: type.id }))
      group.rows.push(row)
    }
  }
  const out = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || collator.compare(a.label, b.label))
  return empty.rows.length ? [...out, empty] : out
}

/** Executa de uma vez (testes, exportação, consultas pequenas). */
export function runQuery(query: Query, env: QueryEnv, cache?: QueryCache): QueryResult {
  const it = evaluateQuery(query, env, cache)
  for (let guard = 0; guard < 1_000_000; guard++) { const step = it.next(); if (step.done) return step.value }
  throw new Error('query evaluation did not finish')
}

/** Executa em fatias de ~`budgetMs`, cedendo a thread entre elas (`pause`). Cancelável. */
export async function runQuerySliced(query: Query, env: QueryEnv, cache: QueryCache, pause: () => Promise<void>, signal?: { cancelled: boolean }, budgetMs = 8): Promise<QueryResult | null> {
  const it = evaluateQuery(query, env, cache)
  let sliceStart = Date.now()
  for (let guard = 0; guard < 1_000_000; guard++) {
    const step = it.next()
    if (step.done) return step.value
    if (signal?.cancelled) return null
    if (Date.now() - sliceStart >= budgetMs) { await pause(); sliceStart = Date.now(); if (signal?.cancelled) return null }
  }
  return null
}

// ---------- dependências (atualização viva) ----------

/**
 * Tokens de identidade dos dados de que a consulta depende. Se todos forem idênticos (===) aos da
 * última execução, o resultado em cache vale. Bancos: objeto do banco + array de linhas vivas (o
 * índice só recria a lista do pai alterado) + ancestrais (bloqueio/lixeira). Fontes amplas ou campos
 * que leem outras páginas (relação, rollup, fórmula, pai) dependem do objeto `pages` inteiro.
 */
export function queryDependencies(query: Query, env: QueryEnv, extra: unknown[] = []): unknown[] {
  const { pages } = env
  const relative = queryRules(query.filter).some((rule) => isRelativeDate(rule.value)) || query.source.kind === 'modified'
  const tokens: unknown[] = [env.locale ?? 'pt-BR', env.thisPageId ?? '', env.timeZone ?? '', relative ? todayFor(env) : '', typesOf(env), ...extra]
  const kind = query.source.kind
  const scoped = kind === 'database' || kind === 'databases' || (kind === 'children' && !query.source.deep)
  if (!scoped) return [...tokens, pages, kind === 'tasks' ? env.tasks ?? env.checklists : null]
  const ids = kind === 'children' ? [!query.source.pageId || query.source.pageId === '@thisPage' ? env.thisPageId ?? '' : query.source.pageId] : query.source.databaseIds ?? []
  const fields = queryFields(query).filter((field) => !isPageField(field))
  for (const raw of ids) {
    const chain = new Set<string>()
    for (let id: string | null | undefined = raw; id && !chain.has(id) && chain.size < 64; id = pages[id]?.parentId) { chain.add(id); tokens.push(pages[id]) }
    const actual = actualDatabaseId(pages, raw)
    if (actual !== raw) for (let id: string | null | undefined = actual, guard = 0; id && guard < 64; id = pages[id]?.parentId, guard++) tokens.push(pages[id])
    tokens.push(liveChildren(pages, actual))
    for (const source of pages[actual]?.database?.sourceDatabaseIds ?? []) tokens.push(pages[source], liveChildren(pages, source))
    const properties = pages[actual]?.database?.properties ?? []
    if (fields.some((field) => { const prop = propertyByField(properties, field); return !!prop && CROSS_ROW.has(prop.type) })) return [...tokens, pages]
  }
  if (queryFields(query).some((field) => field === '@parent' || field === '@database')) tokens.push(pages)
  return tokens
}

export function sameDependencies(a: unknown[] | undefined, b: unknown[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Intervalo de dias de um valor relativo, para mostrar ao usuário ("de 1 a 7 de out."). */
export function describeRange(value: unknown, env: Pick<FilterEnv, 'now' | 'timeZone' | 'weekStart'>): { start: string; end: string } | null { return resolveDateRange(value, env) }

export type { QueryRule }
