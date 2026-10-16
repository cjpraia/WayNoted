// Descoberta retroativa de campos (docs/USAGE.md, "Campos retroativos"): para cada tipo, a união dos campos
// das páginas que têm o tipo e que o tipo ainda não tem. Lógica pura, sem React nem store, uma passada pelas páginas.
import type { Page, Property } from '../types'
import { effectiveProperties, fold, FIELD_TYPES, isEmptyValue, typeDataHidden, UNSUPPORTED_FIELD_TYPES, type TypeList } from './model.ts'

export interface HarvestField {
  property: Property
  /** `database`: propriedade do banco da linha. `loose`: valor solto (a página saiu do banco ou o campo saiu do tipo) cuja definição existe em algum banco. */
  source: 'database' | 'loose'
  /** Páginas do tipo que usam o campo. */
  pageIds: string[]
  /** Quantas delas têm valor (campos automáticos como "Criado em" contam sempre). */
  filled: number
  /** Outro campo com o mesmo nome e tipo já aparece antes (id diferente): vem desmarcado. */
  duplicateOf?: string
}

export interface TypeHarvest {
  typeId: string
  /** Páginas vivas com o tipo diretamente. */
  pageCount: number
  fields: HarvestField[]
}

const COMPUTED = new Set(['createdTime', 'updatedTime', 'createdBy', 'updatedBy'])
const harvestable = (property: Property) => !UNSUPPORTED_FIELD_TYPES.has(property.type) && FIELD_TYPES.includes(property.type)
const nameKey = (property: Property) => `${fold(property.name)}|${property.type}`

interface Candidate { property: Property; source: 'database' | 'loose'; filled: boolean }

/** Campos faltando de todos os tipos que têm páginas. Tipos sem páginas ou sem faltas ficam com `fields: []`. */
export function harvestTypes(pages: Record<string, Page>, types: TypeList): Map<string, TypeHarvest> {
  const out = new Map<string, TypeHarvest>()
  const have = new Map<string, { ids: Set<string>; names: Set<string> }>()
  for (const type of types) {
    const props = effectiveProperties(types, type.id)
    have.set(type.id, { ids: new Set(props.map((prop) => prop.id)), names: new Set(props.map(nameKey)) })
    out.set(type.id, { typeId: type.id, pageCount: 0, fields: [] })
  }
  if (!have.size) return out
  const acc = new Map<string, Map<string, HarvestField>>()
  let defs: Map<string, Property> | null = null
  const definitions = () => {
    if (defs) return defs
    defs = new Map()
    for (const id in pages) { const schema = pages[id].database; if (schema) for (const property of schema.properties) if (!defs.has(property.id)) defs.set(property.id, property) }
    return defs
  }
  for (const id in pages) {
    const page = pages[id]
    if (!page.types?.length || page.trashed || typeDataHidden(page)) continue
    const mine = page.types.filter((typeId) => have.has(typeId))
    if (!mine.length) continue
    // Candidatos desta página (independem do tipo).
    const candidates: Candidate[] = []
    const own = new Set<string>()
    const schema = page.parentId ? pages[page.parentId]?.database : undefined
    if (schema) for (const property of schema.properties) {
      own.add(property.id)
      if (!harvestable(property)) continue
      candidates.push({ property, source: 'database', filled: COMPUTED.has(property.type) || !isEmptyValue(page.props?.[property.id]) })
    }
    const loose = (record: Record<string, unknown> | undefined) => {
      if (!record) return
      for (const key in record) {
        if (own.has(key) || isEmptyValue(record[key])) continue
        own.add(key)
        const property = definitions().get(key)
        if (property && harvestable(property)) candidates.push({ property, source: 'loose', filled: true })
      }
    }
    loose(page.props); loose(page.typeProps)
    for (const typeId of new Set(mine)) {
      out.get(typeId)!.pageCount++
      const owned = have.get(typeId)!
      let fields = acc.get(typeId)
      for (const candidate of candidates) {
        const { property } = candidate
        if (owned.ids.has(property.id) || owned.names.has(nameKey(property))) continue
        if (!fields) acc.set(typeId, (fields = new Map()))
        let entry = fields.get(property.id)
        if (!entry) fields.set(property.id, (entry = { property, source: candidate.source, pageIds: [], filled: 0 }))
        entry.pageIds.push(id)
        if (candidate.filled) entry.filled++
      }
    }
  }
  for (const [typeId, fields] of acc) {
    const list = [...fields.values()].sort((a, b) => b.pageIds.length - a.pageIds.length) // estável: empate = ordem do esquema do banco
    const seen = new Map<string, string>()
    for (const field of list) { const key = nameKey(field.property); const first = seen.get(key); if (first) field.duplicateOf = first; else seen.set(key, field.property.id) }
    out.get(typeId)!.fields = list
  }
  return out
}

/** Atalho para um tipo só. */
export function harvestType(pages: Record<string, Page>, types: TypeList, typeId: string): TypeHarvest {
  return harvestTypes(pages, types).get(typeId) ?? { typeId, pageCount: 0, fields: [] }
}

/** Campos ainda não dispensados (`dismissed`: ids que o usuário escolheu não incorporar). */
export function pendingFields(harvest: TypeHarvest | undefined, dismissed: readonly string[] | undefined): HarvestField[] {
  if (!harvest?.fields.length) return []
  if (!dismissed?.length) return harvest.fields
  const skip = new Set(dismissed)
  return harvest.fields.filter((field) => !skip.has(field.property.id))
}

export interface ReviewEntry { typeId: string; pageCount: number; fields: HarvestField[]; dismissedCount: number }
/** Tipos com campos pendentes (selo e "Revisar tipos"). Com `includeDismissed`, os dispensados também entram (para reabrir). */
export function reviewList(harvests: Map<string, TypeHarvest>, dismissed: Record<string, string[]> | undefined, includeDismissed = false): ReviewEntry[] {
  const out: ReviewEntry[] = []
  for (const harvest of harvests.values()) {
    if (!harvest.fields.length) continue
    const pending = pendingFields(harvest, dismissed?.[harvest.typeId])
    const fields = includeDismissed ? harvest.fields : pending
    if (fields.length) out.push({ typeId: harvest.typeId, pageCount: harvest.pageCount, fields, dismissedCount: harvest.fields.length - pending.length })
  }
  return out
}
