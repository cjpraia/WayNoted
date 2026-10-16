import type { Page, Property, PropValue } from '../../types'
import type { RelatedFilterRule } from '../../database-models'

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

function schemaOf(row: Page, pages: Pages) { return row.parentId ? pages[row.parentId]?.database : undefined }
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
  const ids = row.props?.[relation.id]
  const linked: string[] = isStringArray(ids ?? null) ? ids as string[] : []
  return linked.filter((id) => !!pages[id] && isLivePage(id, pages) && pages[id].parentId === relation.relationDatabaseId)
}

/** Referência a uma página para as fórmulas (`current.prop("X")`, `pagina.X`). */
function pageRef(page: Page, pages: Pages, stack: Frame[]): FormulaPage {
  return {
    kind: 'page', id: page.id, title: page.title,
    get: (name: string) => {
      const property = findProperty(schemaOf(page, pages)?.properties ?? [], name)
      return property ? formulaValueOf(page, property, pages, stack) : undefined
    },
  }
}

/** Valor tipado de uma propriedade para fórmulas: opções viram nomes, relações viram páginas, horários viram datas. */
function formulaValueOf(row: Page, property: Property, pages: Pages, stack: Frame[]): FormulaValue {
  switch (property.type) {
    case 'formula': return evaluateFormulaFor(row, property, property.formula ?? '', pages, enter(stack, row, property))
    case 'relation': return relatedIds(row, property, pages).map((id) => pageRef(pages[id], pages, stack))
    case 'select': case 'status': { const value = row.props?.[property.id]; return property.options?.find((option) => option.id === value)?.name ?? null }
    case 'multiSelect': { const value = row.props?.[property.id]; return isStringArray(value ?? null) ? (value as string[]).map((id) => property.options?.find((option) => option.id === id)?.name).filter((name): name is string => !!name) : [] }
    case 'createdTime': case 'updatedTime': return { kind: 'date', start: new Date(property.type === 'createdTime' ? row.createdAt : row.updatedAt), time: true }
    case 'date': { const value = row.props?.[property.id]; return isDateItem(value) ? dateValueToFormula(value) : null }
    default: return fromPropValue(resolveInner(row, property, pages, stack))
  }
}

function evaluateFormulaFor(row: Page, property: Property, source: string, pages: Pages, stack: Frame[], locale?: 'pt-BR' | 'en-US'): FormulaValue {
  const properties = schemaOf(row, pages)?.properties ?? []
  return evaluateFormulaValue(source, undefined, {
    resolve: (name) => {
      const referenced = findProperty(properties, name)
      return referenced ? formulaValueOf(row, referenced, pages, stack) : undefined
    },
    self: pageRef(row, pages, stack),
    ...(locale ? { locale } : {}),
  })
}

function relatedCell(page: Page, property: Property, pages: Pages, stack: Frame[]) {
  return normalizeForAggregation(resolveInner(page, property, pages, stack), property, pages)
}

function ruleMatches(page: Page, properties: Property[], rule: RelatedFilterRule, pages: Pages, stack: Frame[]): boolean {
  const property = properties.find((p) => p.id === rule.propertyId)
  if (!property) return true
  const raw = resolveInner(page, property, pages, stack)
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
export function matchesRelatedRules(page: Page, rules: RelatedFilterRule[] | undefined, operator: 'and' | 'or' | undefined, pages: Pages, stack: Frame[] = []): boolean {
  if (!rules?.length) return true
  const properties = schemaOf(page, pages)?.properties ?? []
  const check = (rule: RelatedFilterRule) => { try { return ruleMatches(page, properties, rule, pages, stack) } catch { return false } }
  return operator === 'or' ? rules.some(check) : rules.every(check)
}

function resolveInner(row: Page, property: Property, pages: Pages, stack: Frame[]): PropValue {
  if (property.type === 'title') return row.title
  if (property.type === 'createdTime' || property.type === 'updatedTime') return property.type === 'createdTime' ? row.createdAt : row.updatedAt
  if (property.type === 'createdBy' || property.type === 'updatedBy') return property.type === 'createdBy' ? row.createdBy ?? null : row.updatedBy ?? null
  if (property.type === 'uniqueId') return row.sequence ? `${property.uniqueIdPrefix ?? ''}${row.sequence}` : null
  if (property.type === 'button') return null
  if (property.type === 'relation') return relatedIds(row, property, pages)
  if (property.type !== 'formula' && property.type !== 'rollup') return row.props?.[property.id] ?? null
  const schema = schemaOf(row, pages)
  if (!schema) return null
  if (property.type === 'formula') return toPropValue(evaluateFormulaFor(row, property, property.formula ?? '', pages, enter(stack, row, property)))
  const inner = enter(stack, row, property)
  const config = property.rollup
  const relation = schema.properties.find((p) => p.id === config?.relationPropertyId && p.type === 'relation')
  if (!config || !relation) return null
  const target = relation.relationDatabaseId ? pages[relation.relationDatabaseId]?.database : undefined
  const targetProp = target?.properties.find((p) => p.id === config.targetPropertyId)
  if (!targetProp && config.aggregation !== 'count') return null
  const linked = relatedIds(row, relation, pages).map((id) => pages[id]).filter((page) => matchesRelatedRules(page, config.filter, config.filterOperator, pages, inner))
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
export function resolveValue(row: Page, property: Property, pages: Pages): PropValue {
  const derived = property.type === 'formula' || property.type === 'rollup'
  try {
    const value = resolveInner(row, property, pages, [])
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
    return { value: toPropValue(evaluateFormulaFor(row, property, source, pages, [{ key: `${row.id}:${property.id}`, name: property.name }], locale)), error: null }
  } catch (error) {
    const info = formulaErrorMessage(error, locale)
    return { value: null, error: info.message, at: info.at, end: info.end }
  }
}
