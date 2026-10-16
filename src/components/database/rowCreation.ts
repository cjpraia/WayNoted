import type { PropValue } from '../../types'

/** Context binds related/grouped views; explicit values retain their other relations. */
export function mergeRowCreationProps(filterDefaults: Record<string, PropValue>, values: Record<string, PropValue> = {}, context: Record<string, PropValue> = {}): Record<string, PropValue> {
  const merged = { ...filterDefaults, ...values }
  for (const [id, value] of Object.entries(context)) {
    const existing = merged[id]
    merged[id] = Array.isArray(value) && value.every(item => typeof item === 'string') && Array.isArray(existing) && existing.every(item => typeof item === 'string')
      ? [...new Set([...existing, ...value])] : structuredClone(value)
  }
  return merged
}
