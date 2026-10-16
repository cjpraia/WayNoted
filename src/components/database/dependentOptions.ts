// Seleção dependente: as opções de uma propriedade são filtradas pelo valor de outra (a "mãe").
import type { DatabaseSchema, Page, Property, SelectOption } from '../../types'

export interface DependentOptions {
  options: SelectOption[]
  parent?: Property
  /** Ids escolhidos na propriedade-mãe (vazio = sem filtro). */
  parentIds: string[]
  /** Opções escolhidas que não combinam mais com a mãe. */
  mismatched: string[]
}

export function dependentOptions(property: Property, schema: DatabaseSchema | undefined, row: Page | undefined, selected: string[] = []): DependentOptions {
  const all = property.options ?? []
  const config = property.dependsOn
  const parent = config ? schema?.properties.find((p) => p.id === config.propertyId && ['select', 'status', 'multiSelect'].includes(p.type)) : undefined
  if (!config || !parent || !row) return { options: all, parentIds: [], mismatched: [], ...(parent ? { parent } : {}) }
  const raw = row.props?.[parent.id]
  const parentIds = (Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []).filter((id): id is string => typeof id === 'string' && !!parent.options?.some((option) => option.id === id))
  const allowed = (option: SelectOption) => {
    const links = config.links[option.id] ?? []
    return !links.length || links.some((id) => parentIds.includes(id))
  }
  if (!parentIds.length) return { options: all, parent, parentIds, mismatched: [] }
  return { options: all.filter(allowed), parent, parentIds, mismatched: selected.filter((id) => { const option = all.find((item) => item.id === id); return !!option && !allowed(option) }) }
}
