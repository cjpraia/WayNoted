import type { Page, Property, PropValue } from '../../types'
import type { RelatedFilterRule } from '../../database-models'
import { lockedAncestor } from '../../security/pageLock.ts'
import { effectiveProperties, findType, hasType, pageTypeFields, TITLE_FIELD_ID, type TypeList } from '../../objecttypes/model.ts'
import { registeredTypes } from '../../objecttypes/registry.ts'

type Pages = Record<string, Page>
export function isStringArray(value: PropValue): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
export function isFileArray(value: PropValue): value is import('../../database-models').FileValue[] { return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'data' in item) }

export function isLivePage(id: string, pages: Pages): boolean {
  const seen = new Set<string>()
  let current: string | null = id
  while (current) {
    if (seen.has(current)) return false
    seen.add(current)
    const page: Page | undefined = pages[current]
    if (!page || page.trashed) return false
    current = page.parentId
  }
  return true
}

const COMPUTED = new Set(['createdTime', 'updatedTime', 'createdBy', 'updatedBy', 'uniqueId', 'button', 'formula', 'rollup'])
export function isComputedProperty(property: Property): boolean { return COMPUTED.has(property.type) }

import { dateValueToFormula, evaluateFormulaValue, formulaErrorMessage, FormulaError, fromPropValue, toPropValue, type FormulaPage, type FormulaValue } from './formula.ts'
import { aggItemText, aggregate, isDateItem, normalizeForAggregation } from './aggregations.ts'
export { evaluateFormula, formulaDiagnostic } from './formula.ts'

type Frame = { key: string; name: string }
type Resolution = { stack: Frame[]; types: TypeList }

function schemaOf(row: Page, pages: Pages) { return row.parentId ? pages[row.parentId]?.database : undefined }

function rowFields(row: Page, pages: Pages, types: TypeList): Property[] {
  const database = schemaOf(row, pages)?.properties ?? []
  if (!row.types?.length) return database
  const own = new Set(database.map(prop => prop.id))
  return [...database, ...pageTypeFields(types, row).map(({ property }) => property).filter(prop => !own.has(prop.id))]
}

/** A collection projects type values into props. An actual database column still owns an incorporated field. */
function storedValue(row: Page, property: Property, pages: Pages): PropValue {
  const canonical = pages[row.id]
  const fromType = row.typeProps && Object.hasOwn(row.typeProps, property.id)
  if ((fromType || (canonical && canonical !== row)) && schemaOf(row, pages)?.properties.some(prop => prop.id === property.id)) {
    return (canonical ?? row).props?.[property.id] ?? null
  }
  return fromType ? row.typeProps![property.id] : row.props?.[property.id] ?? null
}

export function rollupTargetProperties(relation: Property | undefined, pages: Pages, types: TypeList, titleName: string): Property[] {
  if (relation?.type !== 'relation') return []
  if (relation.relationTypeId) {
    const type = findType(types, relation.relationTypeId)
    if (!type) return []
    return [{ id: TITLE_FIELD_ID, name: titleName, type: 'title' }, ...effectiveProperties(types, type.id)]
  }
  const dbId = relation.relationDatabaseId
  if (!dbId || !isLivePage(dbId, pages) || lockedAncestor(pages, dbId)) return []
  return pages[dbId].database?.properties ?? []
}
function findProperty(properties: Property[], name: string): Property | undefined {
  return properties.find((p) => p.id === name) ?? properties.find((p) => p.name === name) ?? properties.find((p) => p.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))
}

function enter(stack: Frame[], row: Page, property: Property): Frame[] {
  const key = `${row.id}:${property.id}`
  const at = stack.findIndex((frame) => frame.key === key)
  if (at >= 0) {
    const path = [...stack.slice(at).map((frame) => frame.name), property.name].join(' → ')
    throw new FormulaError(`Referência circular: ${path}`, `Circular reference: ${path}`)
  }
  return [...stack, { key, name: property.name }]
}

function relatedIds(row: Page, relation: Property, pages: Pages): string[] {
  const ids = storedValue(row, relation, pages)
  const linked: string[] = isStringArray(ids ?? null) ? ids as string[] : []
  return linked.filter((id) => !!pages[id] && isLivePage(id, pages) &&
    (relation.relationTypeId ? !lockedAncestor(pages, id) : pages[id].parentId === relation.relationDatabaseId))
}

/** Referência a uma página para as fórmulas (`current.prop("X")`, `pagina.X`). */
function pageRef(page: Page, pages: Pages, context: Resolution): FormulaPage {
  return {
    kind: 'page', id: page.id, title: page.title,
    get: (name: string) => {
      const property = findProperty(schemaOf(page, pages)?.properties ?? [], name)
      return property ? formulaValueOf(page, property, pages, context) : undefined
    },
  }
}

/** Valor tipado de uma propriedade para fórmulas: opções viram nomes, relações viram páginas, horários viram datas. */
function formulaValueOf(row: Page, property: Property, pages: Pages, context: Resolution): FormulaValue {
  switch (property.type) {
    case 'formula': return evaluateFormulaFor(row, property, property.formula ?? '', pages, { ...context, stack: enter(context.stack, row, property) })
    case 'relation': return relatedIds(row, property, pages).map((id) => pageRef(pages[id], pages, context))
    case 'select': case 'status': { const value = storedValue(row, property, pages); return property.options?.find((option) => option.id === value)?.name ?? null }
    case 'multiSelect': { const value = storedValue(row, property, pages); return isStringArray(value ?? null) ? (value as string[]).map((id) => property.options?.find((option) => option.id === id)?.name).filter((name): name is string => !!name) : [] }
    case 'createdTime': case 'updatedTime': return { kind: 'date', start: new Date(property.type === 'createdTime' ? row.createdAt : row.updatedAt), time: true }
    case 'date': { const value = storedValue(row, property, pages); return isDateItem(value) ? dateValueToFormula(value) : null }
    default: return fromPropValue(resolveInner(row, property, pages, context))
  }
}

function evaluateFormulaFor(row: Page, property: Property, source: string, pages: Pages, context: Resolution, locale?: 'pt-BR' | 'en-US'): FormulaValue {
  const properties = schemaOf(row, pages)?.properties ?? []
  return evaluateFormulaValue(source, undefined, {
    resolve: (name) => {
      const referenced = findProperty(properties, name)
      return referenced ? formulaValueOf(row, referenced, pages, context) : undefined
    },
    self: pageRef(row, pages, context),
    ...(locale ? { locale } : {}),
  })
}

function relatedCell(page: Page, property: Property, pages: Pages, context: Resolution) {
  return normalizeForAggregation(resolveInner(page, property, pages, context), property, pages)
}

function ruleMatches(page: Page, properties: Property[], rule: RelatedFilterRule, pages: Pages, context: Resolution): boolean {
  const property = properties.find((p) => p.id === rule.propertyId)
  if (!property) return true
  const raw = resolveInner(page, property, pages, context)
  const cell = normalizeForAggregation(raw, property, pages)
  const empty = cell === null || cell === '' || Array.isArray(cell) && cell.length === 0
  if (rule.op === 'isEmpty') return empty
  if (rule.op === 'isNotEmpty') return !empty
  if (rule.op === 'checked') return raw === true
  if (rule.op === 'unchecked') return raw !== true
  const wanted = rule.value
  if (wanted === null || wanted === undefined || wanted === '') return true
  if (property.type === 'select' || property.type === 'status') return rule.op === 'isNot' ? raw !== wanted : raw === wanted
  if (property.type === 'multiSelect' || property.type === 'relation') {
    const has = isStringArray(raw) && raw.includes(String(wanted))
    return rule.op === 'isNot' || rule.op === 'notContains' ? !has : has
  }
  const items = cell === null ? [] : Array.isArray(cell) ? cell : [cell]
  if (['gt', 'lt', 'gte', 'lte'].includes(rule.op)) {
    const target = Number(wanted)
    return items.some((item) => {
      const value = typeof item === 'number' ? item : Number(item)
      if (!Number.isFinite(value)) return false
      return rule.op === 'gt' ? value > target : rule.op === 'lt' ? value < target : rule.op === 'gte' ? value >= target : value <= target
    })
  }
  if (rule.op === 'before' || rule.op === 'after') {
    const day = String(wanted)
    return items.some((item) => {
      const start = isDateItem(item) ? item.start : String(item).slice(0, 10)
      const end = isDateItem(item) ? item.end ?? item.start : start
      return /^\d{4}-\d{2}-\d{2}$/.test(start) && (rule.op === 'before' ? start < day : end > day)
    })
  }
  const query = String(wanted).toLocaleLowerCase('pt-BR')
  const texts = items.map((item) => aggItemText(item).toLocaleLowerCase('pt-BR'))
  if (typeof wanted === 'boolean') return rule.op === 'isNot' ? raw !== wanted : raw === wanted
  if (rule.op === 'contains') return texts.some((text) => text.includes(query))
  if (rule.op === 'notContains') return !texts.some((text) => text.includes(query))
  if (rule.op === 'isNot') return !texts.some((text) => text === query)
  return texts.some((text) => text === query)
}

/** Aplica regras salvas (filtro do rollup / da escolha de relação) a uma página de outro banco. */
export function matchesRelatedRules(page: Page, rules: RelatedFilterRule[] | undefined, operator: 'and' | 'or' | undefined, pages: Pages, context: Resolution = { stack: [], types: registeredTypes() }, properties?: Property[]): boolean {
  if (!rules?.length) return true
  const fields = properties ?? schemaOf(page, pages)?.properties ?? []
  const check = (rule: RelatedFilterRule) => { try { return ruleMatches(page, fields, rule, pages, context) } catch { return false } }
  return operator === 'or' ? rules.some(check) : rules.every(check)
}

function resolveInner(row: Page, property: Property, pages: Pages, context: Resolution): PropValue {
  if (property.type === 'title') return row.title
  if (property.type === 'createdTime' || property.type === 'updatedTime') return property.type === 'createdTime' ? row.createdAt : row.updatedAt
  if (property.type === 'createdBy' || property.type === 'updatedBy') return property.type === 'createdBy' ? row.createdBy ?? null : row.updatedBy ?? null
  if (property.type === 'uniqueId') return row.sequence ? `${property.uniqueIdPrefix ?? ''}${row.sequence}` : null
  if (property.type === 'button') return null
  if (property.type === 'relation') return relatedIds(row, property, pages)
  if (property.type !== 'formula' && property.type !== 'rollup') return storedValue(row, property, pages) ?? null
  if (property.type === 'formula') {
    if (!schemaOf(row, pages)) return null
    return toPropValue(evaluateFormulaFor(row, property, property.formula ?? '', pages, { ...context, stack: enter(context.stack, row, property) }))
  }
  const { types } = context
  const config = property.rollup
  if (!config || lockedAncestor(pages, row.id)) return null
  const relation = rowFields(row, pages, types).find(p => p.id === config.relationPropertyId && p.type === 'relation')
  if (!relation) return null
  const inner = { ...context, stack: enter(context.stack, row, property) }
  const targetFields = rollupTargetProperties(relation, pages, types, '')
  const targetProp = targetFields.find(prop => prop.id === config.targetPropertyId)
  if (!targetProp && config.aggregation !== 'count') return null
  if (relation.relationTypeId && !findType(types, relation.relationTypeId)) return null
  const linked = relatedIds(row, relation, pages).map(id => pages[id]).filter(page =>
    !lockedAncestor(pages, page.id) &&
    (!relation.relationTypeId || hasType(types, page, relation.relationTypeId)) &&
    matchesRelatedRules(page, config.filter, config.filterOperator, pages, inner, targetFields))
  if (config.aggregation === 'count' || !targetProp) return linked.length
  const cells = linked.map((page) => {
    try { return relatedCell(page, targetProp, pages, inner) } catch (error) {
      if (error instanceof FormulaError && /^Referência circular/.test(error.pt)) throw error
      return null
    }
  })
  return aggregate(cells, config.aggregation)
}

const lastErrors = new Map<string, FormulaError | Error>()

/** Resolve propriedades derivadas em memória, com detecção de ciclos entre fórmulas/rollups. */
export function resolveValue(row: Page, property: Property, pages: Pages, types: TypeList = registeredTypes()): PropValue {
  const derived = property.type === 'formula' || property.type === 'rollup'
  try {
    const value = resolveInner(row, property, pages, { types, stack: [] })
    if (derived) lastErrors.delete(`${row.id}:${property.id}`)
    return value
  } catch (error) {
    if (!derived) return null
    lastErrors.set(`${row.id}:${property.id}`, error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

/** Último erro ao calcular a fórmula/rollup desta linha (após resolveValue), já no idioma pedido. */
export function derivedErrorFor(rowId: string, propertyId: string, locale: 'pt-BR' | 'en-US'): string | null {
  const error = lastErrors.get(`${rowId}:${propertyId}`)
  if (!error) return null
  if (error instanceof RangeError) return locale === 'en-US' ? 'Formula is nested too deeply for the execution stack' : 'Fórmula aninhada demais para a pilha de execução'
  return formulaErrorMessage(error, locale).message
}

/** Pré-visualização do editor de fórmula: avalia um texto ainda não salvo numa linha real. */
export function previewFormula(row: Page | undefined, property: Property, source: string, pages: Pages, locale: 'pt-BR' | 'en-US' = 'pt-BR'): { value: PropValue; error: string | null; at?: number; end?: number } {
  try {
    if (!row) return { value: toPropValue(evaluateFormulaValue(source, () => null, { locale })), error: null }
    return { value: toPropValue(evaluateFormulaFor(row, property, source, pages, { types: registeredTypes(), stack: [{ key: `${row.id}:${property.id}`, name: property.name }] }, locale)), error: null }
  } catch (error) {
    const info = formulaErrorMessage(error, locale)
    return { value: null, error: info.message, at: info.at, end: info.end }
  }
}
