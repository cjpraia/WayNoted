import type { DateValue, Page, Property, View } from '../../types'
import type { RollupAggregation } from '../../database-models'
import { resolveValue } from './derived.ts'
import { aggregate, AGGREGATION_LABELS, formatAggregate, normalizeForAggregation } from './aggregations.ts'
import { formatDateValueText, formatPropertyNumber } from './formatting.ts'

export type Calculation = NonNullable<View['tableCalculations']>[string]

/** Ordem do menu de cálculo (estilo planilha), com rótulos pt-BR; o inglês vem de CALC_LABELS_EN. */
export const CALCULATIONS: Calculation[] = ['none', 'count', 'countValues', 'countUnique', 'empty', 'notEmpty', 'percentEmpty', 'percentNotEmpty', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked', 'sum', 'average', 'median', 'min', 'max', 'range', 'earliest', 'latest', 'dateRange']

export const CALC_LABELS = Object.fromEntries(CALCULATIONS.map((kind) => [kind, kind === 'none' ? 'Nenhum' : kind === 'count' ? 'Contar linhas' : AGGREGATION_LABELS[kind as RollupAggregation][0]])) as Record<Calculation, string>
export const CALC_LABELS_EN = Object.fromEntries(CALCULATIONS.map((kind) => [kind, kind === 'none' ? 'None' : kind === 'count' ? 'Count rows' : AGGREGATION_LABELS[kind as RollupAggregation][1]])) as Record<Calculation, string>

/** Cálculos que fazem sentido para o tipo da coluna (todas as contagens servem para qualquer tipo). */
export function calculationsFor(property: Property): Calculation[] {
  const numeric = ['number', 'formula', 'rollup'].includes(property.type)
  const dated = ['date', 'createdTime', 'updatedTime', 'formula', 'rollup'].includes(property.type)
  const checkbox = property.type === 'checkbox' || property.type === 'formula'
  return CALCULATIONS.filter((kind) => {
    if (['sum', 'average', 'median', 'min', 'max', 'range'].includes(kind)) return numeric
    if (['earliest', 'latest', 'dateRange'].includes(kind)) return dated
    if (['checked', 'unchecked', 'percentChecked', 'percentUnchecked'].includes(kind)) return checkbox
    if (['countValues', 'countUnique', 'empty', 'notEmpty', 'percentEmpty', 'percentNotEmpty'].includes(kind)) return property.type !== 'checkbox'
    return true
  })
}

export function calculateColumnValue(rows: Page[], property: Property, pages: Record<string, Page>, calculation: Calculation) {
  if (calculation === 'none') return null
  if (calculation === 'count') return rows.length
  return aggregate(rows.map((row) => normalizeForAggregation(resolveValue(row, property, pages), property, pages)), calculation)
}

export function calculateColumn(rows: Page[], property: Property, pages: Record<string, Page>, calculation: Calculation, locale: string = 'pt-BR'): string {
  if (calculation === 'none') return ''
  const value = calculateColumnValue(rows, property, pages, calculation)
  const numberFormat = property.type === 'number' ? (n: number) => formatPropertyNumber(n, property, locale) : (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 })
  return formatAggregate(value, calculation, locale, numberFormat, (date: DateValue) => formatDateValueText(date, locale, { dateFormat: property.dateFormat, timeFormat: property.timeFormat }))
}
