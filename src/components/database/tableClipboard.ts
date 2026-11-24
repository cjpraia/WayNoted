// Copiar/colar de células da tabela: texto da célula (mesmo formato do CSV exportado) e conversão do texto
// colado para o valor da propriedade. Tipos sem conversão segura (relação, arquivos, lugar, calculados) são ignorados.
import type { Page, Property, PropValue } from '../../types'
import { lockedAncestor } from '../../security/pageLock.ts'
import { csvCellText, fromCsvCell } from './csv.ts'
import { isComputedProperty, isLivePage, isStringArray } from './derived.ts'

export function cellText(value: PropValue, prop: Property, pages: Record<string, Page>): string {
  if (prop.type === 'relation' && isStringArray(value)) value = value.filter(id => isLivePage(id, pages) && !lockedAncestor(pages, id))
  return prop.type === 'title' ? (typeof value === 'string' ? value : '') : csvCellText(value, prop, pages)
}

/** Valor “vazio” de cada tipo (Backspace/Delete e colar célula vazia). */
export function emptyValueFor(prop: Property): PropValue {
  switch (prop.type) {
    case 'title': return ''
    case 'checkbox': return false
    case 'multiSelect':
    case 'relation':
    case 'files': return []
    default: return null
  }
}

/** A célula aceita receber texto colado? */
export function pasteable(prop: Property): boolean {
  if (isComputedProperty(prop)) return false
  return !['relation', 'files', 'place', 'button', 'uniqueId'].includes(prop.type)
}

/** Converte o texto colado; `undefined` = valor inválido para o tipo (a célula é pulada). */
export function pasteValue(text: string, prop: Property): PropValue | undefined {
  if (!pasteable(prop)) return undefined
  if (prop.type === 'title') return text.replace(/\s*\n\s*/g, ' ').trim()
  if (text.trim() === '') return emptyValueFor(prop)
  if (prop.type === 'text') return text
  if (prop.type === 'checkbox' && !/^(true|false|1|0|sim|não|nao|yes|no|x)$/i.test(text.trim())) return undefined
  if (prop.type === 'date' && text.split('→').length > 2) return undefined
  if (prop.type === 'multiSelect') {
    const ids = text.split(',').map(label => {
      const matches = prop.options?.filter(option => option.name === label.trim())
      return matches?.length === 1 ? matches[0].id : undefined
    })
    return ids.every(id => id !== undefined) ? ids : undefined
  }
  if (prop.type === 'select' || prop.type === 'status') {
    const matches = prop.options?.filter(option => option.name === text.trim())
    return matches?.length === 1 ? matches[0].id : undefined
  }
  const value = fromCsvCell(text.trim(), prop)
  // Sem correspondência (opção inexistente, data em outro formato, número inválido): não apaga a célula.
  if (value === null) return undefined
  return value
}


interface ClipboardEntry { rowId: string; value: PropValue }
export interface TableClipboard {
  kind: 'cell' | 'column'
  property: Property
  entries: ClipboardEntry[]
}

export function typedPasteValue(value: PropValue, source: Property, target: Property, pages: Record<string, Page>): PropValue | undefined {
  if (source.type !== target.type || isComputedProperty(source) || isComputedProperty(target)) return undefined
  if (target.type === 'relation') {
    if (!target.relationDatabaseId || source.relationDatabaseId !== target.relationDatabaseId || !pages[target.relationDatabaseId]?.database) return undefined
    const ids = value === null ? [] : value
    return isStringArray(ids) && ids.every(id => pages[id]?.parentId === target.relationDatabaseId && isLivePage(id, pages) && !lockedAncestor(pages, id)) ? ids : undefined
  }
  if (value === null) return emptyValueFor(target)
  const mapOption = (id: string) => {
    if (target.options?.some(option => option.id === id)) return id
    const name = source.options?.find(option => option.id === id)?.name
    const matches = target.options?.filter(option => option.name === name)
    return matches?.length === 1 ? matches[0].id : undefined
  }
  if (target.type === 'select' || target.type === 'status') return typeof value === 'string' ? mapOption(value) : undefined
  if (target.type === 'multiSelect') {
    if (!isStringArray(value)) return undefined
    const ids = value.map(mapOption)
    return ids.every(id => id !== undefined) && new Set(ids).size === ids.length ? ids : undefined
  }
  return value
}

/** Match by row when copying within the same set; disjoint sets use their displayed order. */
export function orderColumn(entries: ClipboardEntry[], targetRowIds: string[]): ClipboardEntry[] | undefined {
  if (entries.length !== targetRowIds.length || !entries.length) return undefined
  const byId = new Map(entries.map(entry => [entry.rowId, entry]))
  const matched = targetRowIds.filter(id => byId.has(id))
  if (!matched.length) return entries
  if (matched.length !== entries.length) return undefined
  return targetRowIds.map(id => byId.get(id)!)
}

const tableMime = 'application/x-waynoted-table'
const marker = /<table\b[^>]*\bdata-waynoted-table=["']([a-f0-9-]{36})["']/
let lastCopy: { id: string; snapshot: TableClipboard } | undefined

export function writeTableClipboard(data: DataTransfer, snapshot: TableClipboard, pages: Record<string, Page>) {
  const values = snapshot.entries.map(({ value }) => cellText(value, snapshot.property, pages))
  const text = values.map(value => (snapshot.kind === 'column' && value === '') || /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value).join('\n')
  const id = crypto.randomUUID()
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  data.setData('text/plain', text)
  data.setData('text/html', '<table data-waynoted-table="' + id + '">' + values.map(value => '<tr><td>' + escape(value) + '</td></tr>').join('') + '</table>')
  try { data.setData(tableMime, id) } catch { /* HTML carries the same marker. */ }
  lastCopy = { id, snapshot: structuredClone(snapshot) }
}

/** null denotes a WayNoted copy whose typed snapshot is no longer available. */
export function readTableClipboard(data: DataTransfer): TableClipboard | undefined | null {
  const id = data.getData(tableMime) || marker.exec(data.getData('text/html'))?.[1]
  if (!id) return undefined
  return lastCopy?.id === id ? lastCopy.snapshot : null
}

export function copyTableFromMenu(snapshot: TableClipboard, pages: Record<string, Page>): boolean {
  let written = false
  const copy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.preventDefault()
    event.stopImmediatePropagation()
    writeTableClipboard(event.clipboardData, snapshot, pages)
    written = true
  }
  document.addEventListener('copy', copy, true)
  try { return document.execCommand('copy') && written }
  catch { return false }
  finally { document.removeEventListener('copy', copy, true) }
}
