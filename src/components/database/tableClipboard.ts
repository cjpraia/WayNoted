// Copiar/colar de células da tabela: texto da célula (mesmo formato do CSV exportado) e conversão do texto
// colado para o valor da propriedade. Tipos sem conversão segura (relação, arquivos, lugar, calculados) são ignorados.
import type { Page, Property, PropValue } from '../../types'
import { csvCellText, fromCsvCell } from './csv.ts'
import { isComputedProperty } from './derived.ts'

export function cellText(value: PropValue, prop: Property, pages: Record<string, Page>): string {
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
  const value = fromCsvCell(text.trim(), prop)
  // Sem correspondência (opção inexistente, data em outro formato, número inválido): não apaga a célula.
  if (value === null || Array.isArray(value) && value.length === 0 && prop.type === 'multiSelect') return undefined
  return value
}
