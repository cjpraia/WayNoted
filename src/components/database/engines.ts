import type { DatabaseSchema, Page, Property, PropValue } from '../../types'
import type { ButtonAction, DatabaseAutomation, DatabaseConfig, DatabasePropertyConfig, DatabaseRowConfig, DatabaseTemplate } from '../../database-models'
import { isLivePage } from './derived.ts'
import { isRichTextValue } from './richText.ts'

type Pages = Record<string, Page>
type EnhancedProperty = Property & DatabasePropertyConfig
type EnhancedSchema = DatabaseSchema & DatabaseConfig

export interface MirrorPatch { rowId: string; propertyId: string; value: string[] }

/** Calcula o lado inverso de uma relação local, sem modificar páginas. */
export function planRelationMirror(pages: Pages, rowId: string, propertyId: string, nextIds: string[]): MirrorPatch[] {
  const row = pages[rowId]
  const schema = row?.parentId ? pages[row.parentId]?.database : undefined
  const property = schema?.properties.find((p) => p.id === propertyId) as EnhancedProperty | undefined
  const targetDbId = property?.relationDatabaseId
  const reverseId = property?.relationMirrorPropertyId
  if (!row || !targetDbId || !reverseId || property?.type !== 'relation') return []
  const targetSchema = pages[targetDbId]?.database
  const reverse = targetSchema?.properties.find((p) => p.id === reverseId) as EnhancedProperty | undefined
  if (reverse?.type !== 'relation' || reverse.relationDatabaseId !== row.parentId) return []
  const old = Array.isArray(row.props?.[propertyId]) ? row.props[propertyId] as string[] : []
  const next = new Set(nextIds.filter((id) => pages[id]?.parentId === targetDbId && isLivePage(id, pages)))
  const patches: MirrorPatch[] = []
  for (const id of new Set([...old, ...next])) {
    const target = pages[id]
    if (!target || target.parentId !== targetDbId || !isLivePage(id, pages)) continue
    const current = Array.isArray(target.props?.[reverseId]) ? target.props[reverseId] as string[] : []
    const value = next.has(id) ? [...new Set([...current, rowId])] : current.filter((linked) => linked !== rowId)
    if (value.length !== current.length || value.some((linked, index) => linked !== current[index])) patches.push({ rowId: id, propertyId: reverseId, value })
  }
  return patches
}

function editable(property: Property): boolean {
  return !['title', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy', 'formula', 'rollup', 'uniqueId', 'button'].includes(property.type)
}

/** Seleciona valores de um template local que ainda pertencem ao esquema atual. */
export function templateDefaults(schema: EnhancedSchema, templateId?: string): { title: string; props: Record<string, PropValue>; icon?: string | null } {
  const template: DatabaseTemplate | undefined = schema.templates?.find((item) => item.id === (templateId ?? schema.defaultTemplateId))
  if (!template) return { title: '', props: {} }
  const props: Record<string, PropValue> = {}
  for (const property of schema.properties) {
    if (!editable(property)) continue
    const value = template.props[property.id]
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || isRichTextValue(value) || Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'object' && !!item && 'data' in item && 'name' in item) || typeof value === 'object' && !!value && ('start' in value && typeof value.start === 'string' || 'lat' in value && 'lng' in value)) props[property.id] = structuredClone(value) as PropValue
  }
  return { title: template.title, props, icon: template.icon }
}

export function nextSequence(rows: Page[]): number {
  return Math.max(0, ...rows.map((row) => (row as Page & DatabaseRowConfig).sequence ?? 0)) + 1
}

export function subitemsFor(parentId: string, rows: Page[]): Page[] {
  return rows.filter((row) => (row as Page & DatabaseRowConfig).subitemParentId === parentId && !row.trashed)
}

export function canAssignSubitemParent(rowId: string, candidateId: string, pages: Pages): boolean {
  const row = pages[rowId]
  let candidate: Page | undefined = pages[candidateId]
  if (!row || !candidate || !row.parentId || candidate.parentId !== row.parentId || !isLivePage(candidateId, pages)) return false
  const seen = new Set<string>()
  while (candidate) {
    if (candidate.id === rowId || seen.has(candidate.id)) return false
    seen.add(candidate.id)
    candidate = candidate.subitemParentId ? pages[candidate.subitemParentId] : undefined
  }
  return true
}

/** Dependências exigem uma opção de Status marcada como concluída no banco do item. */
export function unresolvedDependencies(row: Page, pages: Pages): Page[] {
  const ids = (row as Page & DatabaseRowConfig).dependencyIds ?? []
  return ids.map((id) => pages[id]).filter((dep): dep is Page => {
    if (!dep || !isLivePage(dep.id, pages)) return false
    const schema = dep.parentId ? pages[dep.parentId]?.database : undefined
    const statuses = schema?.properties.filter((property) => property.type === 'status') ?? []
    return !statuses.some((property) => {
      const id = dep.props?.[property.id]
      return property.options?.some((option) => option.id === id && (option as typeof option & { group?: string }).group === 'complete')
    })
  })
}

export function matchingAutomations(schema: EnhancedSchema, propertyId: string): DatabaseAutomation[] {
  return (schema.automations ?? []).filter((automation) => automation.enabled && automation.trigger.kind === 'propertyChange' && automation.trigger.propertyId === propertyId)
}

export function dueAutomations(schema: EnhancedSchema, now: number): DatabaseAutomation[] {
  return (schema.automations ?? []).filter((automation) => automation.enabled && automation.trigger.kind === 'scheduled' && automation.trigger.nextRunAt <= now)
}

export function validActions(schema: DatabaseSchema, actions: ButtonAction[]): ButtonAction[] {
  return actions.filter((action) => {
    if (action.kind !== 'setProperty') return true
    const property = schema.properties.find((candidate) => candidate.id === action.propertyId)
    if (!property || !editable(property)) return false
    if (action.value === null) return true
    if (property.type === 'number') return typeof action.value === 'number' && Number.isFinite(action.value)
    if (property.type === 'checkbox') return typeof action.value === 'boolean'
    if (property.type === 'select' || property.type === 'status') return typeof action.value === 'string' && !!property.options?.some((option) => option.id === action.value)
    return ['text', 'url', 'email', 'phone', 'person'].includes(property.type) && typeof action.value === 'string'
  })
}
