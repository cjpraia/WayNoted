// Motor único de agregações: usado pelos rollups (derived.ts) e pelos cálculos de coluna do rodapé.
// Sem dependências da store, para rodar nos testes em Node.
import type { DateValue, Page, Property, PropValue } from '../../types'
import type { RollupAggregation, TableCalculation } from '../../database-models'

export type AggItem = string | number | boolean | DateValue
/** Valor de uma linha já normalizado (opções → nomes, relações → títulos, horários → datas). */
export type AggCell = AggItem | AggItem[] | null

const pad = (value: number) => String(value).padStart(2, '0')
function dateFromMs(ms: number): DateValue {
  const date = new Date(ms)
  return { start: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, startTime: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}
export function isDateItem(value: unknown): value is DateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'start' in value && typeof (value as DateValue).start === 'string'
}

/** Normaliza um valor bruto (resolveValue) para agregação e exibição em lista. */
export function normalizeForAggregation(value: PropValue, property: Property, pages: Record<string, Page>): AggCell {
  if (value === null || value === undefined || value === '') return null
  switch (property.type) {
    case 'select': case 'status': return typeof value === 'string' ? property.options?.find((option) => option.id === value)?.name ?? null : null
    case 'multiSelect': return Array.isArray(value) ? value.map((id) => typeof id === 'string' ? property.options?.find((option) => option.id === id)?.name ?? '' : '').filter(Boolean) : null
    case 'relation': return Array.isArray(value) ? value.map((id) => typeof id === 'string' ? pages[id]?.title || '' : '').filter((title) => title !== '') : null
    case 'createdTime': case 'updatedTime': return typeof value === 'number' ? dateFromMs(value) : null
    default: break
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item.name)
  if ('type' in value && value.type === 'richText') return value.runs.map((run) => run.text).join('') || null
  if ('start' in value) return value
  if ('label' in value) return value.label
  return null
}

export function aggItemText(item: AggItem): string {
  if (isDateItem(item)) return `${item.start}${item.startTime ? ` ${item.startTime}` : ''}${item.end ? ` → ${item.end}${item.endTime ? ` ${item.endTime}` : ''}` : ''}`
  if (typeof item === 'boolean') return item ? 'true' : 'false'
  return String(item)
}
const isEmptyCell = (cell: AggCell) => cell === null || cell === '' || Array.isArray(cell) && cell.length === 0
const itemsOf = (cells: AggCell[]): AggItem[] => cells.flatMap((cell) => cell === null ? [] : Array.isArray(cell) ? cell : [cell]).filter((item) => item !== '')
function numberOf(item: AggItem): number | null {
  if (typeof item === 'number') return Number.isFinite(item) ? item : null
  if (typeof item === 'string' && /^\s*-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*$/i.test(item)) return Number(item)
  return null
}
function dateKey(item: AggItem): string | null {
  if (isDateItem(item)) return `${item.start}T${item.startTime ?? '00:00'}`
  if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item)) return item.length === 10 ? `${item}T00:00` : item.replace(' ', 'T')
  return null
}
function asDate(item: AggItem): DateValue {
  if (isDateItem(item)) return { start: item.start, ...(item.startTime ? { startTime: item.startTime } : {}) }
  const text = String(item)
  return text.length > 10 ? { start: text.slice(0, 10), startTime: text.slice(11, 16) } : { start: text }
}

export const PERCENT_AGGREGATIONS = new Set<RollupAggregation>(['percentEmpty', 'percentNotEmpty', 'percentChecked', 'percentUnchecked'])
export const NUMERIC_AGGREGATIONS = new Set<RollupAggregation>(['sum', 'average', 'median', 'min', 'max', 'range'])

/**
 * Agrega as células de várias linhas. `count` conta linhas; `countValues` conta valores (itens de
 * listas contam um a um); porcentagens vão de 0 a 1. Sem truncamento: listas voltam completas.
 */
export function aggregate(cells: AggCell[], kind: RollupAggregation): PropValue {
  const total = cells.length
  switch (kind) {
    case 'count': return total
    case 'countValues': return itemsOf(cells).length
    case 'countUnique': return new Set(itemsOf(cells).map(aggItemText)).size
    case 'empty': return cells.filter(isEmptyCell).length
    case 'notEmpty': return cells.filter((cell) => !isEmptyCell(cell)).length
    case 'percentEmpty': return total ? cells.filter(isEmptyCell).length / total : 0
    case 'percentNotEmpty': return total ? cells.filter((cell) => !isEmptyCell(cell)).length / total : 0
    case 'checked': return cells.filter((cell) => cell === true).length
    case 'unchecked': return cells.filter((cell) => cell !== true).length
    case 'percentChecked': return total ? cells.filter((cell) => cell === true).length / total : 0
    case 'percentUnchecked': return total ? cells.filter((cell) => cell !== true).length / total : 0
    case 'showOriginal': return itemsOf(cells).map(aggItemText)
    case 'unique': return [...new Set(itemsOf(cells).map(aggItemText))]
    case 'earliest': case 'latest': case 'dateRange': {
      const dated = itemsOf(cells).flatMap((item) => {
        const start = dateKey(item)
        if (!start) return []
        const end = isDateItem(item) && item.end ? `${item.end}T${item.endTime ?? '00:00'}` : start
        return [{ item, start, end }]
      })
      if (!dated.length) return null
      if (kind === 'earliest') return asDate(dated.reduce((best, entry) => entry.start < best.start ? entry : best).item)
      if (kind === 'latest') return asDate(dated.reduce((best, entry) => entry.start > best.start ? entry : best).item)
      const first = dated.reduce((best, entry) => entry.start < best ? entry.start : best, dated[0].start)
      const last = dated.reduce((best, entry) => entry.end > best ? entry.end : best, dated[0].end)
      const toDay = (key: string) => { const [y, m, d] = key.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
      return Math.round((toDay(last) - toDay(first)) / 86_400_000)
    }
    default: {
      const numbers = itemsOf(cells).map(numberOf).filter((value): value is number => value !== null)
      if (!numbers.length) return null
      if (kind === 'sum') return numbers.reduce((sum, value) => sum + value, 0)
      if (kind === 'average') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      if (kind === 'median') {
        const sorted = [...numbers].sort((a, b) => a - b)
        const middle = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
      }
      const min = numbers.reduce((best, value) => value < best ? value : best, numbers[0])
      const max = numbers.reduce((best, value) => value > best ? value : best, numbers[0])
      return kind === 'min' ? min : kind === 'max' ? max : max - min
    }
  }
}

export const AGGREGATION_LABELS: Record<RollupAggregation, [string, string]> = {
  count: ['Contar tudo', 'Count all'], countValues: ['Contar valores', 'Count values'], countUnique: ['Contar únicos', 'Count unique values'],
  empty: ['Contar vazios', 'Count empty'], notEmpty: ['Contar não vazios', 'Count not empty'],
  percentEmpty: ['% vazios', 'Percent empty'], percentNotEmpty: ['% não vazios', 'Percent not empty'],
  checked: ['Marcados', 'Checked'], unchecked: ['Desmarcados', 'Unchecked'], percentChecked: ['% marcados', 'Percent checked'], percentUnchecked: ['% desmarcados', 'Percent unchecked'],
  sum: ['Soma', 'Sum'], average: ['Média', 'Average'], median: ['Mediana', 'Median'], min: ['Mínimo', 'Min'], max: ['Máximo', 'Max'], range: ['Intervalo', 'Range'],
  earliest: ['Data mais antiga', 'Earliest date'], latest: ['Data mais recente', 'Latest date'], dateRange: ['Intervalo de datas (dias)', 'Date range (days)'],
  showOriginal: ['Mostrar original', 'Show original'], unique: ['Mostrar valores únicos', 'Show unique values'],
}

/** Grupos de agregações para menus (rollup e rodapé). */
export const AGGREGATION_GROUPS: { label: [string, string]; kinds: RollupAggregation[] }[] = [
  { label: ['Contagem', 'Count'], kinds: ['count', 'countValues', 'countUnique', 'empty', 'notEmpty'] },
  { label: ['Porcentagem', 'Percent'], kinds: ['percentEmpty', 'percentNotEmpty'] },
  { label: ['Caixa de seleção', 'Checkbox'], kinds: ['checked', 'unchecked', 'percentChecked', 'percentUnchecked'] },
  { label: ['Mais opções', 'More options'], kinds: ['sum', 'average', 'median', 'min', 'max', 'range'] },
  { label: ['Data', 'Date'], kinds: ['earliest', 'latest', 'dateRange'] },
  { label: ['Exibir', 'Show'], kinds: ['showOriginal', 'unique'] },
]

/** Formata o resultado de uma agregação para o rodapé/painéis. */
export function formatAggregate(value: PropValue, kind: RollupAggregation | TableCalculation, locale = 'pt-BR', formatNumber?: (value: number) => string, formatDate?: (value: DateValue) => string): string {
  if (value === null) return '—'
  if (typeof value === 'number') {
    if (PERCENT_AGGREGATIONS.has(kind as RollupAggregation)) return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
    if (NUMERIC_AGGREGATIONS.has(kind as RollupAggregation) && formatNumber) return formatNumber(value)
    if (kind === 'dateRange') return `${value.toLocaleString(locale)} ${locale === 'en-US' ? (value === 1 ? 'day' : 'days') : (value === 1 ? 'dia' : 'dias')}`
    return value.toLocaleString(locale, { maximumFractionDigits: 2 })
  }
  if (isDateItem(value)) return formatDate ? formatDate(value) : aggItemText(value)
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item.name).join(', ')
  return String(value)
}
