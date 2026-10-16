// Planejamento puro (sem React, sem store) da conversão de páginas em linhas de banco de dados.
// docs/USAGE.md. Tudo aqui devolve dados novos: quem aplica é `src/subpages/actions.ts`.
import type { DatabaseSchema, Page, Property, PropType, PropValue } from '../types'
import { fold, hasType, isEmptyValue, pageTypeFields, effectiveProperties, type TypeList } from '../objecttypes/model.ts'

/** Parte mínima das subpáginas que precisa compartilhar um tipo de objeto para o banco herdar seus campos. */
export const COMMON_TYPE_SHARE = 0.7

export type ExcludeReason = 'protected' | 'locked' | 'database' | 'canvas' | 'missing'
export interface ExcludedPage { id: string; title: string; reason: ExcludeReason }

/** Por que uma página não pode virar linha de banco (null = pode). */
export function excludeReason(page: Page | undefined | null): ExcludeReason | null {
  if (!page || page.trashed) return 'missing'
  if (page.passwordLock) return 'protected'
  if (page.locked) return 'locked'
  if (page.database) return 'database'
  if (page.canvas) return 'canvas'
  return null
}

export function classify(pages: Record<string, Page>, ids: readonly string[]): { eligible: Page[]; excluded: ExcludedPage[] } {
  const eligible: Page[] = [], excluded: ExcludedPage[] = []
  for (const id of ids) {
    const page = pages[id], reason = excludeReason(page)
    if (reason) excluded.push({ id, title: page?.title ?? '', reason })
    else eligible.push(page)
  }
  return { eligible, excluded }
}

/** Tipo de objeto compartilhado por pelo menos 70 % das páginas (o mais frequente; empate: o primeiro na lista de tipos). */
export function commonType(rows: readonly Page[], types: TypeList): { typeId: string | null; count: number } {
  if (!rows.length || !types.length) return { typeId: null, count: 0 }
  let best: { typeId: string | null; count: number } = { typeId: null, count: 0 }
  for (const type of types) {
    const count = rows.reduce((n, page) => n + (hasType(types, page, type.id) ? 1 : 0), 0)
    if (count / rows.length >= COMMON_TYPE_SHARE && count > best.count) best = { typeId: type.id, count }
  }
  return best
}

const uid = () => globalThis.crypto.randomUUID()
/** Propriedades de banco calculadas ou ligadas a outro banco: não são copiadas de `props` de outras origens. */
const NOT_CARRIED = new Set<PropType>(['title', 'formula', 'rollup', 'relation', 'button', 'uniqueId', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy'])
const COMPUTED = new Set<PropType>(['title', 'formula', 'rollup', 'button', 'uniqueId', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy'])
const OPTIONS = new Set<PropType>(['select', 'multiSelect', 'status'])

export interface SchemaPlan {
  properties: Property[]
  typeId: string | null
  /** Quantas páginas têm o tipo comum. */
  typeCount: number
  /** Nomes das propriedades vindas de `props` de outros bancos (valores já preenchidos nas páginas). */
  carried: string[]
}

/** Esquema inicial: Nome + Tags; + campos do tipo comum (≥ 70 %); + campos de outras origens que existem em `props`. */
export function planSchema(rows: readonly Page[], types: TypeList, pages: Record<string, Page>, labels: { title: string; tags: string }): SchemaPlan {
  const properties: Property[] = [{ id: uid(), name: labels.title, type: 'title' }, { id: uid(), name: labels.tags, type: 'multiSelect', options: [] }]
  const { typeId, count } = commonType(rows, types)
  const used = new Set<string>()
  if (typeId) for (const prop of effectiveProperties(types, typeId)) { used.add(prop.id); properties.push(structuredClone(prop)) }
  // Campos de outras origens (ex.: linhas que saíram de um banco): só entram se houver valor em `props` e a definição ainda existir.
  const filled = new Set<string>()
  for (const page of rows) for (const [id, value] of Object.entries(page.props ?? {})) if (!isEmptyValue(value)) filled.add(id)
  const carried: string[] = []
  if (filled.size) {
    const definitions = new Map<string, Property>()
    for (const page of Object.values(pages)) if (page.database && !page.trashed) for (const prop of page.database.properties) if (filled.has(prop.id) && !definitions.has(prop.id)) definitions.set(prop.id, prop)
    for (const id of filled) {
      const prop = definitions.get(id)
      if (!prop || used.has(id) || NOT_CARRIED.has(prop.type)) continue
      used.add(id); properties.push(structuredClone(prop)); carried.push(prop.name)
    }
  }
  return { properties, typeId, typeCount: count, carried }
}

/** Nome do banco criado a partir de páginas com tipo comum ("Pessoa" → "Pessoas"). */
export function pluralName(name: string, locale: string): string {
  const n = name.trim()
  if (!n) return n
  if (!locale.startsWith('pt')) return /s$/i.test(n) ? n : /y$/i.test(n) ? n.slice(0, -1) + 'ies' : n + 's'
  if (/s$/i.test(n)) return n
  if (/ão$/i.test(n)) return n.slice(0, -2) + 'ões'
  if (/m$/i.test(n)) return n.slice(0, -1) + 'ns'
  if (/l$/i.test(n)) return n.slice(0, -1) + 'is'
  return n + 's'
}

function mapOptions(value: PropValue, from: Property | undefined, to: Property): PropValue {
  if (!OPTIONS.has(to.type)) return value
  const ids = Array.isArray(value) ? value as string[] : typeof value === 'string' ? [value] : []
  const mapped = ids.map((id) => {
    if (to.options?.some((o) => o.id === id) && (!from || from.options?.some((o) => o.id === id))) return id
    const name = from?.options?.find((o) => o.id === id)?.name
    return name ? to.options?.find((o) => fold(o.name) === fold(name))?.id : undefined
  }).filter((id): id is string => !!id)
  if (to.type === 'multiSelect') return mapped
  return mapped[0] ?? null
}

const compatible = (a: Property, b: Property) => a.type === b.type || (OPTIONS.has(a.type) && OPTIONS.has(b.type))

export interface RowMapping {
  props: Record<string, PropValue>
  typeProps: Record<string, PropValue> | undefined
  /** Quantos valores foram copiados para propriedades do banco. */
  mapped: number
}

/**
 * Valores de `page` para as propriedades `target` de um banco:
 * 1) `props[id]` com o mesmo id; 2) `typeProps[id]` do tipo da página (mesmo id); 3) mesmo nome e mesmo tipo de
 * propriedade, vindo de um campo do tipo ou da propriedade do banco de origem (`source`). Nunca sobrescreve valor
 * já preenchido. Os valores copiados de `typeProps` saem de lá (ficam em um só lugar; `rowOutOfDatabase` os devolve).
 */
export function mapRowIntoSchema(page: Page, target: readonly Property[], types: TypeList, source?: readonly Property[]): RowMapping {
  const props: Record<string, PropValue> = { ...(page.props ?? {}) }
  const typeProps: Record<string, PropValue> = { ...(page.typeProps ?? {}) }
  const fields = pageTypeFields(types, page).map((f) => f.property)
  let mapped = 0
  for (const prop of target) {
    if (COMPUTED.has(prop.type)) continue
    if (!isEmptyValue(props[prop.id]) || (props[prop.id] !== undefined && prop.type === 'checkbox')) continue
    const sameId = fields.find((f) => f.id === prop.id)
    if (sameId && !isEmptyValue(typeProps[prop.id])) { props[prop.id] = typeProps[prop.id]; delete typeProps[prop.id]; mapped++; continue }
    const byName = fields.find((f) => fold(f.name) === fold(prop.name) && compatible(f, prop) && !isEmptyValue(typeProps[f.id]))
    if (byName) { props[prop.id] = mapOptions(typeProps[byName.id], byName, prop); delete typeProps[byName.id]; mapped++; continue }
    const from = source?.find((s) => s.id !== prop.id && fold(s.name) === fold(prop.name) && compatible(s, prop) && !COMPUTED.has(s.type) && !isEmptyValue(page.props?.[s.id]))
    if (from) { props[prop.id] = mapOptions(page.props![from.id], from, prop); mapped++ }
  }
  return { props, typeProps: Object.keys(typeProps).length ? typeProps : undefined, mapped }
}

/** `Partial<Page>` que aplica um mapeamento (só os campos que mudam). */
export function mappingPatch(page: Page, map: RowMapping): Partial<Page> {
  const patch: Partial<Page> = {}
  if (JSON.stringify(map.props) !== JSON.stringify(page.props ?? {})) patch.props = map.props
  if (JSON.stringify(map.typeProps ?? null) !== JSON.stringify(page.typeProps ?? null)) patch.typeProps = map.typeProps
  return patch
}

export interface RowOut { patch: Partial<Page>; /** Valores que continuam guardados em `props`, sem aparecer na página. */ hidden: number; restored: number }

/**
 * Linha que volta a ser página comum: valores de propriedades que são campos do tipo da página voltam para
 * `typeProps` (visíveis no cabeçalho). Os demais continuam em `props`, guardados (nada se perde) e voltam
 * se a página entrar de novo num banco que tenha as mesmas propriedades.
 */
export function rowOutOfDatabase(page: Page, source: readonly Property[], types: TypeList): RowOut {
  const props: Record<string, PropValue> = { ...(page.props ?? {}) }
  const typeProps: Record<string, PropValue> = { ...(page.typeProps ?? {}) }
  const fields = pageTypeFields(types, page).map((f) => f.property)
  let restored = 0
  for (const field of fields) {
    if (!isEmptyValue(typeProps[field.id])) continue
    const direct = !isEmptyValue(props[field.id]) ? field.id : source.find((s) => s.id !== field.id && fold(s.name) === fold(field.name) && compatible(s, field) && !COMPUTED.has(s.type) && !isEmptyValue(props[s.id]))?.id
    if (!direct) continue
    typeProps[field.id] = direct === field.id ? props[direct] : mapOptions(props[direct], source.find((s) => s.id === direct), field)
    if (direct === field.id) delete props[direct]
    restored++
  }
  const hidden = Object.values(props).filter((v) => !isEmptyValue(v)).length
  const patch: Partial<Page> = {}
  if (restored) { patch.props = Object.keys(props).length ? props : undefined; patch.typeProps = Object.keys(typeProps).length ? typeProps : undefined }
  return { patch, hidden, restored }
}

/** Esquema pronto para `Page.database`: tabela com as propriedades planejadas. */
export function tableSchema(properties: Property[], view: DatabaseSchema['views'][number], extra: Partial<DatabaseSchema> = {}): DatabaseSchema {
  return { properties, views: [view], activeViewId: view.id, ...extra }
}


/** Subpáginas vivas, na ordem da árvore, que o corpo ainda não cita (bloco de página, link ou menção). Usado pela seção "Subpáginas". */
export function uncitedChildren(children: readonly { id: string }[], cited: ReadonlySet<string> | readonly string[] | undefined, hidden: ReadonlySet<string> = new Set()): string[] {
  const set = cited instanceof Set ? cited : new Set(cited ?? [])
  return children.filter((child) => !set.has(child.id) && !hidden.has(child.id)).map((child) => child.id)
}
