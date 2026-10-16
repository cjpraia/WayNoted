import type { DatabaseSchema, Page, Property, PropValue } from '../../types'

type Source = { id: string; name: string; schema: DatabaseSchema }
export interface MultiSourceResult { properties: Property[]; rows: Page[]; sourceNames: string[] }
const keyFor = (property: Property) => `${property.name.trim().toLocaleLowerCase()}\u0000${property.type}`
const unsupported = new Set(['formula', 'rollup', 'relation', 'button'])

export function canAddSource(databaseId: string, candidateId: string, pages: Record<string, Page>): boolean {
  if (!pages[candidateId]?.database || candidateId === databaseId) return false
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === databaseId) return false
    if (seen.has(id)) return true
    seen.add(id)
    const schema = pages[id]?.database
    if (!schema) return true
    return [schema.linkedSourceId, ...(schema.sourceDatabaseIds ?? [])].filter((value): value is string => !!value).every(visit)
  }
  return visit(candidateId)
}

/** Une esquemas locais por nome+tipo, sem alterar páginas salvas. Computados e relações heterogêneas ficam na fonte. */
export function projectMultiSource(sources: Source[], rows: Page[]): MultiSourceResult {
  const canonical = new Map<string, Property>()
  const bySource = new Map<string, Map<string, Property>>()
  const names = new Map<string, Set<string>>()
  for (const source of sources) {
    const mapped = new Map<string, Property>()
    bySource.set(source.id, mapped)
    for (const property of source.schema.properties) {
      if (unsupported.has(property.type)) continue
      const key = keyFor(property)
      const sameNameTypes = names.get(property.name.toLocaleLowerCase()) ?? new Set<string>()
      sameNameTypes.add(property.type)
      names.set(property.name.toLocaleLowerCase(), sameNameTypes)
      let target = canonical.get(key)
      if (!target) {
        target = { ...property, options: property.options ? property.options.map((option) => ({ ...option })) : undefined }
        canonical.set(key, target)
      } else if (property.options?.length) {
        const optionNames = new Set(target.options?.map((option) => option.name.toLocaleLowerCase()) ?? [])
        for (const option of property.options) if (!optionNames.has(option.name.toLocaleLowerCase())) {
          target.options = [...(target.options ?? []), { ...option }]
          optionNames.add(option.name.toLocaleLowerCase())
        }
      }
      mapped.set(key, property)
    }
  }
  const properties = [...canonical.entries()].map(([key, property]) => names.get(property.name.toLocaleLowerCase())!.size > 1 ? { ...property, name: `${property.name} (${key.split('\u0000')[1]})` } : property)
  const projected = rows.map((row) => {
    const source = sources.find((item) => item.id === row.parentId)
    if (!source) return row
    const mapping = bySource.get(source.id)!
    const props: Record<string, PropValue> = {}
    for (const [key, target] of canonical) {
      const local = mapping.get(key)
      if (!local || local.type === 'title') continue
      const raw = row.props?.[local.id]
      if (raw === undefined) continue
      if (['select', 'status', 'multiSelect'].includes(local.type)) {
        const optionId = (id: string) => {
          const name = local.options?.find((option) => option.id === id)?.name
          return target.options?.find((option) => option.name === name)?.id ?? id
        }
        props[target.id] = Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? raw.map(optionId) : typeof raw === 'string' ? optionId(raw) : raw
      } else props[target.id] = raw
    }
    return { ...row, props }
  })
  return { properties, rows: projected, sourceNames: sources.map((source) => source.name) }
}
