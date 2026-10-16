import type { ConditionalColorRule } from '../../database-models'
import type { DatabaseSchema, Page, PropValue, View } from '../../types'

export const RULE_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type RuleColor = typeof RULE_COLORS[number]

export function evaluateColorRule(value: PropValue, rule: ConditionalColorRule): boolean {
  const empty = value === null || value === '' || Array.isArray(value) && value.length === 0
  if (rule.operator === 'isEmpty') return empty
  if (empty || rule.value === undefined) return false
  if (rule.operator === 'gt' || rule.operator === 'lt') {
    const number = Number(value)
    const compared = Number(rule.value)
    return Number.isFinite(number) && Number.isFinite(compared) && (rule.operator === 'gt' ? number > compared : number < compared)
  }
  if (rule.operator === 'contains') return Array.isArray(value) ? value.some((item) => typeof item === 'string' ? item === String(rule.value) : item.name.toLocaleLowerCase().includes(String(rule.value).toLocaleLowerCase())) : String(value).toLocaleLowerCase().includes(String(rule.value).toLocaleLowerCase())
  return rule.operator === 'is' ? value === rule.value : value !== rule.value
}

export function matchingRowColor(row: Page, schema: DatabaseSchema, view: View, valueFor: (row: Page, propertyId: string) => PropValue): RuleColor | undefined {
  for (const rule of view.colorRules ?? []) {
    if (!schema.properties.some((property) => property.id === rule.propertyId)) continue
    if (!RULE_COLORS.includes(rule.color as RuleColor)) continue
    if (evaluateColorRule(valueFor(row, rule.propertyId), rule)) return rule.color as RuleColor
  }
  return undefined
}
