// Conversão segura do tipo de um campo de tipo de objeto. Mesmas regras de
// `schemaOps.convertProperty` (bancos), mas pura: devolve o novo campo e a função que converte cada
// valor, aplicada pelo chamador a todas as páginas com o tipo. Coberto por tests/object-types.test.mts.
import type { OptionColor, Property, PropType, PropValue, SelectOption } from '../types'
import { isFileArray, isStringArray } from '../components/database/derived.ts'
import { isRichTextValue, richTextPlain } from '../components/database/richText.ts'
import { formatDateValueText } from '../components/database/formatting.ts'
import { TYPE_COLORS } from './model.ts'
import { looseNumberValue } from '../input/liberal.ts'

const uid = () => globalThis.crypto.randomUUID()
const hasOptions = (type: PropType) => type === 'select' || type === 'multiSelect' || type === 'status'
const isDate = (v: unknown): v is { start: string } => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { start?: unknown }).start === 'string'

export function parseNumber(text: string): number | null { return looseNumberValue(text) }

export function asText(v: PropValue, prop: Property, locale: 'pt-BR' | 'en-US' = 'pt-BR'): string | null {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v === 'string') {
    if (prop.type === 'select' || prop.type === 'status') return prop.options?.find((o) => o.id === v)?.name ?? null
    return v
  }
  if (typeof v === 'number') return String(v).replace('.', ',')
  if (typeof v === 'boolean') return v ? 'Sim' : null
  if (isStringArray(v)) return v.map((id) => prop.options?.find((o) => o.id === id)?.name ?? (prop.type === 'multiSelect' ? undefined : id)).filter(Boolean).join(', ') || null
  if (isFileArray(v)) return v.map((file) => file.name).join(', ') || null
  if (isDate(v)) return formatDateValueText(v as never, locale, { dateFormat: prop.dateFormat, timeFormat: prop.timeFormat })
  if (isRichTextValue(v)) return richTextPlain(v)
  if (typeof v === 'object' && 'label' in (v as object)) return String((v as { label: string }).label)
  return null
}

function defaultStatusOptions(): SelectOption[] {
  return [
    { id: uid(), name: 'Não iniciado', color: 'gray', group: 'todo' },
    { id: uid(), name: 'Em andamento', color: 'blue', group: 'progress' },
    { id: uid(), name: 'Concluído', color: 'green', group: 'complete' },
  ]
}

export interface ConversionPlan { property: Property; convert: (value: PropValue) => PropValue | undefined }
const REMOVE_TYPES = new Set<PropType>(['createdTime', 'updatedTime', 'createdBy', 'updatedBy', 'relation'])

/**
 * Plano de conversão de `prop` para `type` dado o conjunto de valores atuais (para criar opções a
 * partir de textos distintos). `convert` devolve `undefined` quando o valor não muda.
 */
export function planConversion(prop: Property, type: PropType, values: readonly PropValue[]): ConversionPlan | null {
  if (prop.type === type || type === 'title' || prop.type === 'title') return null
  const from = prop.type
  const toOptions = hasOptions(type), fromOptions = hasOptions(from)
  const base: Property = { id: prop.id, name: prop.name, type }
  if (REMOVE_TYPES.has(type) || REMOVE_TYPES.has(from)) return { property: base, convert: () => null }
  if (toOptions && !fromOptions) {
    const options: SelectOption[] = []
    const byName = new Map<string, string>()
    let color = 0
    for (const value of values) {
      const text = asText(value, prop)
      if (!text) continue
      const parts = type === 'multiSelect' ? text.split(',').map((x) => x.trim()).filter(Boolean) : [text.trim()]
      for (const name of parts) {
        if (byName.has(name)) continue
        const option = { id: uid(), name, color: TYPE_COLORS[1 + (color++ % (TYPE_COLORS.length - 1))] as OptionColor }
        byName.set(name, option.id); options.push(option)
      }
    }
    return { property: { ...base, options }, convert: (v) => {
      const text = asText(v, prop)
      if (!text) return null
      if (type === 'multiSelect') return text.split(',').map((x) => byName.get(x.trim())).filter((x): x is string => !!x)
      return byName.get(text.trim()) ?? null
    } }
  }
  if (toOptions && fromOptions) {
    const options = type === 'status' && !prop.options?.length ? defaultStatusOptions() : [...(prop.options ?? [])]
    return { property: { ...base, options }, convert: (v) => {
      if (type === 'multiSelect') return typeof v === 'string' ? [v] : isStringArray(v) ? v : null
      return isStringArray(v) ? (v[0] ?? null) : typeof v === 'string' ? v : null
    } }
  }
  return { property: base, convert: (v) => {
    if (v === null || v === undefined) return undefined
    switch (type) {
      case 'text': case 'url': case 'email': case 'phone': case 'person':
        return asText(v, prop)
      case 'number':
        return typeof v === 'number' ? v : typeof v === 'string' && !fromOptions ? parseNumber(v) : null
      case 'checkbox':
        if (typeof v === 'boolean') return v
        if (typeof v === 'string') return ['sim', 'true', 'x', '1', 'yes'].includes(v.trim().toLowerCase()) ? true : null
        return null
      case 'date':
        if (isDate(v)) return v
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return { start: v.trim() }
        return null
      default:
        return null
    }
  } }
}

/**
 * Mudanças de tipo de campo entre duas versões da lista de tipos (ex.: "Tipo da propriedade" no
 * cabeçalho da coleção): converte os valores das páginas e completa as opções criadas a partir deles.
 */
export function planTypeSchemaChange(before: readonly import('./model.ts').ObjectType[], after: import('./model.ts').ObjectType[], pages: Record<string, import('../types').Page>): { types: import('./model.ts').ObjectType[]; patches: Record<string, Record<string, PropValue>> } {
  const old = new Map<string, Property>()
  for (const type of before) for (const prop of type.properties) old.set(prop.id, prop)
  const changes: { typeIndex: number; propIndex: number; plan: ConversionPlan }[] = []
  after.forEach((type, typeIndex) => type.properties.forEach((prop, propIndex) => {
    const previous = old.get(prop.id)
    if (!previous || previous.type === prop.type) return
    const values: PropValue[] = []
    for (const id in pages) { const value = pages[id].typeProps?.[prop.id]; if (value !== undefined) values.push(value) }
    const plan = planConversion(previous, prop.type, values)
    if (plan) changes.push({ typeIndex, propIndex, plan })
  }))
  if (!changes.length) return { types: after, patches: {} }
  const types = after.map((type) => ({ ...type, properties: [...type.properties] }))
  const patches: Record<string, Record<string, PropValue>> = {}
  for (const { typeIndex, propIndex, plan } of changes) {
    const current = types[typeIndex].properties[propIndex]
    types[typeIndex].properties[propIndex] = { ...current, ...(plan.property.options && !current.options?.length ? { options: plan.property.options } : {}) }
    for (const id in pages) {
      const typeProps = patches[id] ?? pages[id].typeProps
      if (!typeProps || !(current.id in typeProps)) continue
      const next = plan.convert(typeProps[current.id])
      if (next !== undefined) patches[id] = { ...typeProps, [current.id]: next }
    }
  }
  return { types, patches }
}
