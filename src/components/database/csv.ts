import COMPAT from '../../../shared/compatibility.ts'
import type { DatabaseSchema, Page, Property, PropValue } from '../../types'
import { isFileArray, isStringArray, resolveValue } from './derived.ts'
import { isRichTextValue, richTextPlain } from './richText.ts'
import { safeRichHref } from './richText.ts'
import type { FileValue } from '../../database-models'
import { dateExtras } from '../../export/dateExtras.ts'

export const CSV_ROW_ID = COMPAT.record031
export type CsvCompanionKind = 'relation' | 'files' | 'date' | 'rich'
export function csvCompanionHeader(kind: CsvCompanionKind, propertyId: string) { return `__workspace_${kind}_${propertyId}` }
export function csvCompanionKind(header: string): { kind: CsvCompanionKind; propertyId: string } | null {
  const match = header.match(/^__workspace_(relation|files|date|rich)_(.+)$/)
  return match ? { kind: match[1] as CsvCompanionKind, propertyId: match[2] } : null
}

export function parseCsvCompanion(kind: CsvCompanionKind, cell: string): PropValue {
  if (!cell) return null
  let raw: unknown
  try { raw = JSON.parse(cell) } catch { return null }
  if (kind === 'relation') return Array.isArray(raw) && raw.length <= 5000 && raw.every((id) => typeof id === 'string' && id.length <= 200) ? raw : null
  if (kind === 'files') return Array.isArray(raw) && raw.length <= 100 && raw.every((file): file is FileValue => !!file && typeof file === 'object' && typeof file.id === 'string' && typeof file.name === 'string' && file.name.length <= 255 && typeof file.mimeType === 'string' && typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0 && file.size <= 50_000_000 && typeof file.data === 'string' && /^data:[^,]*;base64,[A-Za-z0-9+/]*={0,2}$/.test(file.data) && file.data.length <= 67_000_000) ? raw.map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, data: file.data })) : null
  if (kind === 'date') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('start' in raw) || typeof raw.start !== 'string') return null
    const start = fromCsvCell(raw.start, { id: '', name: '', type: 'date' })
    if (!start || typeof start !== 'object' || Array.isArray(start) || !('start' in start)) return null
    const date = raw as Record<string, unknown>
    const end = date.end
    if (end !== undefined && (typeof end !== 'string' || !fromCsvCell(`${raw.start} → ${end}`, { id: '', name: '', type: 'date' }))) return null
    const validTime = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    if (date.startTime !== undefined && !validTime(date.startTime)) return null
    if (date.endTime !== undefined && (!validTime(date.endTime) || !end)) return null
    if (date.timeZone !== undefined && (typeof date.timeZone !== 'string' || date.timeZone.length > 100 || !/^[A-Za-z0-9_+./-]+$/.test(date.timeZone))) return null
    if (date.repeat !== undefined && !['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(String(date.repeat))) return null
    return { start: raw.start, ...(end ? { end } : {}), ...(date.startTime ? { startTime: date.startTime } : {}), ...(date.endTime ? { endTime: date.endTime } : {}), ...(date.timeZone ? { timeZone: date.timeZone } : {}), ...(date.repeat ? { repeat: date.repeat } : {}), ...dateExtras(date) } as PropValue
  }
  if (kind === 'rich') {
    if (!isRichTextValue(raw) || raw.runs.length > 1000) return null
    return { type: 'richText', runs: raw.runs.filter((run) => run && typeof run.text === 'string' && run.text.length <= 100_000).map((run) => ({ text: run.text, bold: run.bold === true, italic: run.italic === true, underline: run.underline === true, strike: run.strike === true, code: run.code === true, ...(run.href && safeRichHref(run.href) ? { href: safeRichHref(run.href) } : {}) })) }
  }
  return null
}

export function resolveImportedRelationIds(ids: string[], importedIds: Map<string, string>, pages: Record<string, Page>, targetDatabaseId: string): string[] {
  return [...new Set(ids.map((id) => importedIds.get(id) ?? id).filter((id) => pages[id]?.parentId === targetDatabaseId && !pages[id]?.trashed))]
}

/** CSV RFC 4180 com suporte a aspas, quebras de linha e delimitador ; de planilhas pt-BR. */
export function parseCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, '')
  let commas = 0, semicolons = 0, inHeaderQuote = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"') {
      if (inHeaderQuote && source[i + 1] === '"') i++
      else inHeaderQuote = !inHeaderQuote
    } else if (!inHeaderQuote) {
      if (ch === '\n' || ch === '\r') break
      if (ch === ',') commas++
      if (ch === ';') semicolons++
    }
  }
  const delimiter = semicolons > commas ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (quoted) throw new Error('CSV contém aspas não fechadas')
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function escapeCsv(cell: string): string {
  const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function stringifyCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n'
}

/** Texto de uma célula como no CSV exportado (nomes de opções/relações, datas ISO). */
export function csvCellText(value: PropValue, prop: Property, pages: Record<string, Page>): string { return plain(value, prop, pages) }

function plain(value: PropValue, prop: Property, pages: Record<string, Page>): string {
  if (value === null) return ''
  if (isRichTextValue(value)) return richTextPlain(value)
  if (typeof value === 'object' && !Array.isArray(value)) return 'start' in value ? value.end ? `${value.start} → ${value.end}` : value.start : `${value.label} (${value.lat}, ${value.lng})`
  if (Array.isArray(value)) {
    if (isFileArray(value)) return value.map((file) => file.name).join(', ')
    if (prop.type === 'relation' && isStringArray(value)) return value.map((id) => pages[id]?.title ?? '').filter(Boolean).join(', ')
    if (prop.type === 'multiSelect' && isStringArray(value)) return value.map((id) => prop.options?.find((o) => o.id === id)?.name ?? '').filter(Boolean).join(', ')
    return isStringArray(value) ? value.join(', ') : ''
  }
  if (prop.type === 'select' || prop.type === 'status') return prop.options?.find((o) => o.id === value)?.name ?? ''
  if (prop.type === 'createdTime' || prop.type === 'updatedTime') return new Date(Number(value)).toISOString()
  return String(value)
}

export function exportCsv(schema: DatabaseSchema, rows: Page[], pages: Record<string, Page>): string {
  const companions = schema.properties.flatMap((property): { property: Property; kind: CsvCompanionKind }[] => property.type === 'relation' ? [{ property, kind: 'relation' }] : property.type === 'files' ? [{ property, kind: 'files' }] : property.type === 'date' ? [{ property, kind: 'date' }] : property.type === 'text' ? [{ property, kind: 'rich' }] : [])
  return stringifyCsv([
    [...schema.properties.map((p) => p.name), CSV_ROW_ID, ...companions.map(({ property, kind }) => csvCompanionHeader(kind, property.id))],
    ...rows.map((row) => [...schema.properties.map((prop) => plain(resolveValue(row, prop, pages), prop, pages)), row.id, ...companions.map(({ property, kind }) => {
      const value = resolveValue(row, property, pages)
      return value === null || kind === 'rich' && !isRichTextValue(value) ? '' : JSON.stringify(value)
    })]),
  ])
}

export function fromCsvCell(cell: string, prop: Property): PropValue {
  const value = /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell
  if (!value) return null
  switch (prop.type) {
    case 'number': { const n = Number(value.replace(',', '.')); return Number.isFinite(n) ? n : null }
    case 'checkbox': return ['true', '1', 'sim', 'yes', 'x'].includes(value.trim().toLowerCase())
    case 'date': {
      const [start, end] = value.split(/\s*→\s*/)
      const valid = (iso: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
        const [year, month, day] = iso.split('-').map(Number)
        const date = new Date(year, month - 1, day)
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      }
      return valid(start) && (!end || valid(end) && end >= start) ? { start, ...(end ? { end } : {}) } : null
    }
    case 'select':
    case 'status': return prop.options?.find((o) => o.name === value.trim())?.id ?? null
    case 'multiSelect': return value.split(',').map((v) => prop.options?.find((o) => o.name === v.trim())?.id).filter((id): id is string => !!id)
    case 'relation':
    case 'files':
    case 'place':
    case 'createdTime':
    case 'updatedTime':
    case 'formula':
    case 'rollup': return null
    default: return value
  }
}
