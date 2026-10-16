// Valores de propriedades em forma legível (CSV, front-matter, tabelas). Inclui fórmulas e rollups calculados.
import type { DateValue, Page, Property, PropValue } from '../types'
import type { Locale } from '../localization'
import { resolveValue, isFileArray, isStringArray } from '../components/database/derived.ts'
import { isRichTextValue, richTextPlain } from '../components/database/richText.ts'
import { tr } from './model.ts'

export type Readable = string | number | boolean | string[] | null

function dateText(value: DateValue): string {
  const start = value.startTime ? `${value.start} ${value.startTime}` : value.start
  const end = value.end ? (value.endTime ? `${value.end} ${value.endTime}` : value.end) : value.endTime ? `${value.start} ${value.endTime}` : ''
  return end ? `${start} → ${end}` : start
}

function stamp(ms: number): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Valor legível: nomes de opções, títulos de relações, datas ISO, resultado de fórmulas/rollups. */
export function readableValue(row: Page, prop: Property, pages: Record<string, Page>): Readable {
  if (prop.type === 'button') return null
  let value: PropValue
  try { value = resolveValue(row, prop, pages) } catch { return null }
  if (value === null || value === undefined || value === '') return null
  if (prop.type === 'createdTime' || prop.type === 'updatedTime') return typeof value === 'number' ? stamp(value) : null
  if (isRichTextValue(value)) return richTextPlain(value)
  if (typeof value === 'object' && !Array.isArray(value)) {
    if ('start' in value) return dateText(value as DateValue)
    if ('label' in value) return String((value as { label: string }).label)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (!value.length) return null
    if (isFileArray(value)) return value.map((file) => file.name)
    if (isStringArray(value)) {
      if (prop.type === 'relation') return value.map((id) => pages[id]?.title || id)
      if (prop.type === 'multiSelect') return value.map((id) => prop.options?.find((option) => option.id === id)?.name ?? id)
      return value
    }
    return (value as unknown[]).map((item) => (typeof item === "object" && item && "start" in item ? dateText(item as DateValue) : String(item)))
  }
  if (prop.type === 'select' || prop.type === 'status') return prop.options?.find((option) => option.id === value)?.name ?? String(value)
  return value as string | number | boolean
}

export function readableText(value: Readable, locale: Locale): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? tr(locale, 'Sim', 'Yes') : tr(locale, 'Não', 'No')
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Converte o valor legível do front-matter de volta (para arquivos editados à mão, sem `props`). */
export function fromReadable(value: unknown, prop: Property, pagesByTitle: Map<string, string>): PropValue | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const list = Array.isArray(value) ? value.map(String) : String(value).split(/\s*,\s*/)
  switch (prop.type) {
    case 'text': case 'url': case 'email': case 'phone': case 'person': return String(value)
    case 'number': { const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.')); return Number.isFinite(n) ? n : undefined }
    case 'checkbox': return value === true || ['true', 'sim', 'yes', 'x', '1'].includes(String(value).toLowerCase())
    case 'select': case 'status': return prop.options?.find((option) => option.name === String(value))?.id
    case 'multiSelect': return list.map((name) => prop.options?.find((option) => option.name === name)?.id).filter((id): id is string => !!id)
    case 'relation': return list.map((title) => pagesByTitle.get(title)).filter((id): id is string => !!id)
    case 'date': {
      const match = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?(?: → (\d{4}-\d{2}-\d{2})?(?: ?(\d{2}:\d{2}))?)?$/.exec(String(value).trim())
      if (!match) return undefined
      return { start: match[1], ...(match[2] ? { startTime: match[2] } : {}), ...(match[3] && match[3] !== match[1] ? { end: match[3] } : {}), ...(match[4] ? { endTime: match[4] } : {}) }
    }
    default: return undefined
  }
}
