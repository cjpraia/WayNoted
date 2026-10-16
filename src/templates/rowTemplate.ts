// Modelos de linha de banco (botão "Novo ▾"): variáveis no título inicial, nos valores de texto e no corpo. Parte pura.
import type { DatabaseSchema, Page, PropValue } from '../types.ts'
import { collectQuestions, expandTemplate, expandTemplateText, nowContext, propKey, type TemplateCursor, type TemplateLocale, type TemplateQuestion } from './variables.ts'

/** Valores legíveis das propriedades de uma linha, por nome normalizado ({{prop:Nome}}). */
export function rowPropValues(row: Pick<Page, 'title' | 'props'>, schema: DatabaseSchema | undefined, pages: Record<string, Pick<Page, 'title'>> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  if (!schema) return out
  const readable = (value: unknown): string => {
    if (value == null) return ''
    if (Array.isArray(value)) return value.map(readable).filter(Boolean).join(', ')
    if (typeof value === 'object') { const o = value as { start?: unknown; name?: unknown; title?: unknown }; return typeof o.start === 'string' ? o.start : typeof o.name === 'string' ? o.name : typeof o.title === 'string' ? o.title : '' }
    if (typeof value === 'boolean') return value ? '✓' : ''
    return String(value)
  }
  const options = (propertyId: string, id: unknown): string | null => {
    const property = schema.properties.find(item => item.id === propertyId) as { options?: { id: string; name: string }[] } | undefined
    const found = property?.options?.find(option => option.id === id)
    return found ? found.name : null
  }
  for (const property of schema.properties) {
    if (property.type === 'title') { out[propKey(property.name)] = row.title ?? ''; continue }
    const value = row.props?.[property.id]
    if (Array.isArray(value)) out[propKey(property.name)] = value.map(item => typeof item === 'string' ? (options(property.id, item) ?? pages[item]?.title ?? item) : readable(item)).filter(Boolean).join(', ')
    else if (typeof value === 'string') out[propKey(property.name)] = options(property.id, value) ?? pages[value]?.title ?? value
    else out[propKey(property.name)] = readable(value)
  }
  return out
}

interface RowTemplateLike { title: string; bodyBlocks?: unknown[] }

export function rowTemplateQuestions(template: RowTemplateLike, props: Record<string, PropValue> = {}): TemplateQuestion[] {
  const texts = [template.title, ...Object.values(props).filter((value): value is string => typeof value === 'string')]
  return collectQuestions(template.bodyBlocks ?? [], texts)
}

export interface ExpandedRow { title: string; props: Record<string, PropValue>; blocks: unknown[] | undefined; cursor: TemplateCursor | null; unknown: string[] }

/** Expande título, valores de texto e corpo de um modelo de linha. Sem resposta, perguntas usam o padrão. */
export function expandRowTemplate(
  template: RowTemplateLike, props: Record<string, PropValue>,
  env: { schema: DatabaseSchema; pages: Record<string, Pick<Page, 'title'>>; locale: TemplateLocale; userName?: string; answers?: Record<string, string>; epoch?: number },
): ExpandedRow {
  const answers = env.answers ?? Object.fromEntries(rowTemplateQuestions(template, props).map(q => [q.label, q.default]))
  const unknown = new Set<string>()
  const base = nowContext(env.locale, { userName: env.userName || undefined, answers }, env.epoch)
  const titled = expandTemplateText(template.title ?? '', base)
  titled.unknown.forEach(item => unknown.add(item))
  const nextProps: Record<string, PropValue> = { ...props }
  const ctx = { ...base, title: titled.text, props: rowPropValues({ title: titled.text, props }, env.schema, env.pages) }
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== 'string' || !value.includes('{{')) continue
    const done = expandTemplateText(value, ctx)
    done.unknown.forEach(item => unknown.add(item))
    nextProps[key] = done.text
  }
  let blocks: unknown[] | undefined
  let cursor: TemplateCursor | null = null
  if (template.bodyBlocks?.length) {
    const result = expandTemplate(template.bodyBlocks, ctx, undefined, { keepIds: true, mergeText: true })
    result.unknown.forEach(item => unknown.add(item))
    blocks = result.blocks; cursor = result.cursor
  }
  return { title: titled.text, props: nextProps, blocks, cursor, unknown: [...unknown] }
}
