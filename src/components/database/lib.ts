// Lógica dos bancos de dados (sem React). Contrato compartilhado entre as visualizações.
import type { DatabaseSchema, DateValue, Filter, FilterOp, OptionColor, Page, Property, PropType, PropValue, SelectOption, View } from '../../types'
import { mergeRowCreationProps } from './rowCreation.ts'
import { getState } from '../../store.ts'
import { resolveValue } from './derived.ts'
import { matchesFilterTree } from './filterTree.ts'
import { formatDateValueText, formatDisplayDate } from './formatting.ts'
import { filtersDependOnToday, matchValue, sortKeyOf, todayFor, valueText, type FilterEnv } from './filterEngine.ts'
import { PAGE_TYPE_FIELD, matchPageType } from '../../query/typeField.ts'
import { registeredTypes, registeredTypesVersion } from '../../objecttypes/registry.ts'
import { groupTokens } from './grouping.ts'

/** Props que toda visualização (tabela, quadro, calendário, lista, galeria) recebe. */
export interface ViewProps {
  /** A página-banco de dados. */
  db: Page
  schema: DatabaseSchema
  view: View
  /** Linhas já filtradas e ordenadas por `applyView`. */
  rows: Page[]
  /** Propriedades visíveis nesta visualização, em ordem (inclui a `title`). */
  visibleProps: Property[]
  /** Restrições globais de dados (as linhas podem ter seu próprio `locked`). */
  readOnly: boolean
  /** Bloqueio do esquema e da configuração de visualização. */
  schemaLocked?: boolean
  /** Values required by the surrounding related/grouped view on every creation path. */
  creationDefaults?: Record<string, PropValue>
  /** Abre a linha como página (navega). */
  onOpenRow: (rowId: string) => void
  /** Seleção de linhas compartilhada entre grupos (tabela, lista, galeria). Ausente = sem seleção. */
  selection?: import('./rowSelection').RowSelection
  /** Abre o painel "Configurações da visualização" numa tela (ex.: ⋯ do cabeçalho da tabela). */
  onOpenSettings?: (screen: 'visibility' | 'main') => void
}

export const OPTION_COLORS: OptionColor[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

export const COLOR_LABELS: Record<OptionColor, string> = {
  default: 'Padrão',
  gray: 'Cinza',
  brown: 'Marrom',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Roxo',
  pink: 'Rosa',
  red: 'Vermelho',
}

export const PROP_TYPE_LABELS: Record<PropType, string> = {
  title: 'Título',
  text: 'Texto',
  number: 'Número',
  select: 'Seleção',
  multiSelect: 'Seleção múltipla',
  status: 'Status',
  date: 'Data',
  checkbox: 'Caixa de seleção',
  url: 'URL',
  email: 'E-mail',
  phone: 'Telefone',
  createdTime: 'Criado em',
  updatedTime: 'Editado em',
  formula: 'Fórmula',
  relation: 'Relação',
  rollup: 'Rollup',
  person: 'Pessoa',
  files: 'Arquivos e mídia',
  createdBy: 'Criado por',
  updatedBy: 'Editado por',
  button: 'Botão',
  uniqueId: 'ID',
  place: 'Lugar',
}

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  contains: 'contém',
  notContains: 'não contém',
  is: 'é',
  isNot: 'não é',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  before: 'é antes de',
  after: 'é depois de',
  isEmpty: 'está vazio',
  isNotEmpty: 'não está vazio',
}

/** Operadores de filtro válidos para cada tipo de propriedade. */
export function filterOpsFor(type: PropType): FilterOp[] {
  switch (type) {
    case 'number':
    case 'formula':
    case 'rollup':
      return ['is', 'isNot', 'gt', 'lt', 'gte', 'lte', 'isEmpty', 'isNotEmpty']
    case 'select':
    case 'status':
      return ['is', 'isNot', 'isEmpty', 'isNotEmpty']
    case 'multiSelect':
      return ['contains', 'notContains', 'isEmpty', 'isNotEmpty']
    case 'date':
    case 'createdTime':
    case 'updatedTime':
      return ['is', 'before', 'after', 'isEmpty', 'isNotEmpty']
    case 'checkbox':
      return ['is']
    default:
      return ['contains', 'notContains', 'is', 'isNot', 'isEmpty', 'isNotEmpty']
  }
}

export function hasOptions(type: PropType) {
  return type === 'select' || type === 'multiSelect' || type === 'status'
}

/** Valor de uma propriedade numa linha (o título vem de `page.title`). */
export function getValue(row: Page, prop: Property): PropValue {
  return resolveValue(row, prop, getState().pages)
}

export function isEmptyValue(value: PropValue): boolean {
  return value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

export function isDateValue(value: PropValue): value is DateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'start' in value
}

export function findOption(prop: Property, id: unknown): SelectOption | undefined {
  return prop.options?.find((o) => o.id === id)
}

export function randomColor(used: OptionColor[] = []): OptionColor {
  const pool = OPTION_COLORS.filter((c) => c !== 'default' && !used.includes(c))
  const from = pool.length ? pool : OPTION_COLORS.slice(1)
  return from[Math.floor(Math.random() * from.length)]
}

// ---------- Datas ('YYYY-MM-DD', sempre no fuso local) ----------

export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Data ISO no formato da propriedade (padrão como o Export Bundle: "8 de outubro de 2026"). */
export function formatDate(iso: string, prop?: Pick<Property, 'dateFormat'>): string {
  return formatDisplayDate(iso, getState().settings.locale ?? 'pt-BR', { dateFormat: prop?.dateFormat })
}

/** Valor de data com hora e término, no formato da propriedade. O fuso só aparece se não for o local. */
export function formatDateValue(value: DateValue, prop?: Pick<Property, 'dateFormat' | 'timeFormat'>): string {
  const text = formatDateValueText(value, getState().settings.locale ?? 'pt-BR', { dateFormat: prop?.dateFormat, timeFormat: prop?.timeFormat })
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return value.timeZone && value.timeZone !== localZone && (value.startTime || value.endTime) ? `${text} · ${value.timeZone}` : text
}

/** Texto puro de um valor, para busca/ordenação/exibição simples. */
export function valueToText(value: PropValue, prop: Property): string {
  return valueText(value, prop, getState().pages, getState().settings.locale ?? 'pt-BR')
}

// ---------- Filtro / ordenação / agrupamento ----------

/** Ambiente do filtro na store atual (datas relativas usam o dia de hoje no fuso do sistema). */
function filterEnv(): FilterEnv {
  const state = getState()
  return { pages: state.pages, locale: state.settings.locale ?? 'pt-BR' }
}

function matches(row: Page, prop: Property, filter: Filter, env: FilterEnv = filterEnv()): boolean {
  return matchValue(getValue(row, prop), prop, filter, env)
}

function sortKey(row: Page, prop: Property, env: FilterEnv = filterEnv()): string | number | null {
  return sortKeyOf(getValue(row, prop), prop, env)
}

// ---------- applyView com cache (bancos grandes) ----------
// 1) Resultado memoizado por visualização: mesma entrada (elemento a elemento), esquema, visão e idioma
//    devolvem o mesmo array (re-renders globais da store ficam baratos).
// 2) Por linha (WeakMap pela identidade da página, imutável na store): resultado do filtro e chaves de
//    ordenação. Editar uma célula recalcula só aquela linha; ordenar usa chaves pré-calculadas + Intl.Collator.
// Fórmulas/rollups/relações dependem de outras páginas: nesses casos o cache por linha é desligado.

type SortKey = string | number | null
interface RowEntry { pass: boolean; keys: SortKey[] }
const CROSS_ROW = new Set(['formula', 'rollup', 'relation'])
const rowCaches = new Map<string, WeakMap<Page, RowEntry>>()
interface Passed { row: Page; keys: SortKey[]; index: number }
interface CachedResult { schema: DatabaseSchema; view: View; locale: string; pages: unknown; input: Page[]; output: Page[]; signature?: string; passed?: Passed[] }
const resultCache = new Map<string, CachedResult>()
const collators = new Map<string, Intl.Collator>()
const collatorFor = (locale: string) => { let c = collators.get(locale); if (!c) collators.set(locale, (c = new Intl.Collator(locale))); return c }

function sameRows(a: Page[], b: Page[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Aplica filtros (E) e ordenações da visualização. Sem ordenação, mantém a ordem manual. Vazios vão para o fim. */
export function applyView(rows: Page[], schema: DatabaseSchema, view: View): Page[] {
  const state = getState(), locale = state.settings.locale ?? 'pt-BR'
  const byId = new Map(schema.properties.map((p) => [p.id, p]))
  const sorts = view.sorts.filter((s) => byId.has(s.propertyId))
  const used = [...view.filters.map((f) => byId.get(f.propertyId)), ...sorts.map((s) => byId.get(s.propertyId))].filter((p): p is Property => !!p)
  // Filtro "Tipo" (vindo de "Abrir como banco" numa consulta): depende da lista de tipos (subtipos).
  const typeFilter = view.filters.some((filter) => filter.propertyId === PAGE_TYPE_FIELD)
  const crossRow = used.some((p) => CROSS_ROW.has(p.type)) || typeFilter
  const cached = resultCache.get(view.id)
  if (cached && cached.schema === schema && cached.view === view && cached.locale === locale && cached.pages === (crossRow ? state.pages : null) && sameRows(cached.input, rows)) return cached.output
  const sameShape = !crossRow && cached && cached.schema === schema && cached.view === view && cached.locale === locale && cached.passed && cached.input.length === rows.length
  if (!view.filters.length && !sorts.length) {
    remember(view.id, { schema, view, locale, pages: crossRow ? state.pages : null, input: rows, output: rows })
    return rows
  }

  // Assinatura do que influencia filtro/chaves: definições das propriedades usadas, filtros, ordenações e idioma.
  const signature = JSON.stringify([locale, view.filters, view.filterTree ?? null, sorts, used, filtersDependOnToday(view.filters.map((filter) => filter.value)) ? todayFor() : null, typeFilter ? registeredTypesVersion() : 0])
  let perRow = crossRow ? undefined : rowCaches.get(signature)
  if (!crossRow && !perRow) {
    perRow = new WeakMap()
    rowCaches.set(signature, perRow)
    // Assinaturas antigas (filtros editados) não precisam ficar para sempre.
    if (rowCaches.size > 32) rowCaches.delete(rowCaches.keys().next().value!)
  }
  const filterIds = view.filters.map((filter) => filter.id)
  const env = filterEnv()
  const entryFor = (row: Page): RowEntry => {
    const hit = perRow?.get(row)
    if (hit) return hit
    const entry: RowEntry = {
      pass: matchesFilterTree(view.filterTree, filterIds, (id) => {
        const f = view.filters.find((filter) => filter.id === id)
        if (!f) return true
        if (f.propertyId === PAGE_TYPE_FIELD) return matchPageType(registeredTypes(), row, f.op, f.value)
        const prop = byId.get(f.propertyId)
        return prop ? matches(row, prop, f, env) : true
      }),
      keys: [],
    }
    if (entry.pass) entry.keys = sorts.map((s) => sortKey(row, byId.get(s.propertyId)!, env))
    perRow?.set(row, entry)
    return entry
  }

  const collator = collatorFor(locale)
  const compare = (a: Passed, b: Passed) => {
    for (let k = 0; k < sorts.length; k++) {
      const ka = a.keys[k], kb = b.keys[k]
      if (ka === kb) continue
      if (ka === null) return 1
      if (kb === null) return -1
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : collator.compare(String(ka), String(kb))
      if (cmp !== 0) return sorts[k].direction === 'asc' ? cmp : -cmp
    }
    return a.index - b.index
  }

  // Incremental: mesma visão e mesmas posições, poucas linhas trocadas (edição de célula) →
  // remove as antigas e reinsere as novas por busca binária, sem reordenar 50 mil linhas.
  let passed: Passed[] | null = null
  if (sameShape && cached!.signature === signature) {
    const changed: number[] = []
    for (let i = 0; i < rows.length && changed.length <= 64; i++) if (rows[i] !== cached!.input[i]) changed.push(i)
    if (changed.length <= 64) {
      const positions = new Set(changed)
      passed = cached!.passed!.filter((item) => !positions.has(item.index))
      for (const i of changed) {
        const entry = entryFor(rows[i])
        if (!entry.pass) continue
        const item = { row: rows[i], keys: entry.keys, index: i }
        let lo = 0, hi = passed.length
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (compare(passed[mid], item) <= 0) lo = mid + 1; else hi = mid }
        passed.splice(lo, 0, item)
      }
    }
  }
  if (!passed) {
    passed = []
    for (let i = 0; i < rows.length; i++) {
      const entry = entryFor(rows[i])
      if (entry.pass) passed.push({ row: rows[i], keys: entry.keys, index: i })
    }
    if (sorts.length) passed.sort(compare)
  }
  const out = passed.map((item) => item.row)
  remember(view.id, { schema, view, locale, pages: crossRow ? state.pages : null, input: rows, output: out, signature: crossRow ? undefined : signature, passed: crossRow ? undefined : passed })
  return out
}

function remember(viewId: string, value: CachedResult) {
  resultCache.delete(viewId)
  resultCache.set(viewId, value)
  if (resultCache.size > 64) resultCache.delete(resultCache.keys().next().value!)
}

export function visibleProperties(schema: DatabaseSchema, view: View): Property[] {
  return schema.properties.filter((p) => p.type === 'title' || !view.hidden.includes(p.id))
}

export interface Group {
  /** null = grupo "Sem <propriedade>". */
  option: SelectOption | null
  rows: Page[]
}

/**
 * Agrupa linhas pelos valores de uma propriedade (quadro). O grupo vazio vem primeiro.
 * Multisseleção, relação e pessoa colocam a linha em todos os seus grupos; relação/pessoa criam um
 * grupo por valor presente (ordem de aparição).
 */
export function groupRows(rows: Page[], prop: Property, pages?: Record<string, Page>): Group[] {
  const dynamic = prop.type === 'relation' || prop.type === 'person'
  const groups: Group[] = [{ option: null, rows: [] }, ...(dynamic ? [] : prop.options ?? []).map((option) => ({ option, rows: [] as Page[] }))]
  const byId = new Map(groups.map((g) => [g.option?.id ?? null, g]))
  const labels = new Map<string, string>()
  for (const row of rows) {
    const tokens = groupTokens(row, prop, pages, labels)
    if (!tokens.length) { groups[0].rows.push(row); continue }
    for (const token of tokens) {
      let group = byId.get(token)
      if (!group) {
        const name = prop.type === 'relation' ? pages?.[token]?.title || token : labels.get(token) ?? token
        group = { option: { id: token, name, color: 'default' }, rows: [] }
        groups.push(group); byId.set(token, group)
      }
      group.rows.push(row)
    }
  }
  return groups
}

/** Valores iniciais para uma linha nova de modo que ela passe nos filtros `is`/`contains` da visualização. */
export function defaultsFromFilters(schema: DatabaseSchema, view: View): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const f of view.filters) {
    const prop = schema.properties.find((p) => p.id === f.propertyId)
    if (!prop || ['title', 'formula', 'rollup', 'createdTime', 'updatedTime'].includes(prop.type) || f.value === null || f.value === '') continue
    if (f.op === 'is' && prop.type === 'date') out[prop.id] = { start: String(f.value) }
    else if (f.op === 'is') out[prop.id] = f.value
    else if (f.op === 'contains' && prop.type === 'multiSelect') out[prop.id] = [String(f.value)]
  }
  return out
}

export function defaultsForNewRow(schema: DatabaseSchema, view: View, values: Record<string, PropValue> = {}, context: Record<string, PropValue> = {}): Record<string, PropValue> {
  return mergeRowCreationProps(defaultsFromFilters(schema, view), values, context)
}
