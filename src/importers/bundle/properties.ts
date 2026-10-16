import COMPAT from '../../../shared/compatibility.ts'
// Inferência de propriedades de bancos do Export Bundle a partir de CSV, Markdown das linhas e HTML.
import type { DateValue, OptionColor, Property, PropType, PropValue, SelectOption } from '../../types.ts'
import type { FileValue } from '../../database-models.ts'
import type { AssetRef, WarningCode } from './blocks.ts'
import { idFromHref, newId } from './util.ts'

/** Tipo declarado pelo HTML do Export Bundle (classe `property-row-*` ou ícone do cabeçalho). */
export type BundleHint = 'title' | 'text' | 'number' | 'select' | 'multi_select' | 'status' | 'date' | 'person' | 'file' | 'checkbox' | 'url' | 'email'
  | 'phone' | 'formula' | 'relation' | 'rollup' | 'created_time' | 'created_by' | 'last_edited_time' | 'last_edited_by' | 'unique_id' | 'button' | 'place'

export interface CellLink { text: string; href: string }
export interface CellSample {
  raw: string
  /** Arquivo de onde veio o valor (para resolver links relativos). */
  fromFile: string
  hint?: BundleHint
  chips?: { name: string; color?: string }[]
  checked?: boolean
  links?: CellLink[]
}

export interface ColumnEnv {
  /** Página importada apontada pelo link (e o banco ao qual pertence, se for linha). */
  resolveLink(fromFile: string, href: string): { pageId: string; databaseId: string | null } | null
  /** Linhas importadas com esse título (todas as bases). */
  rowsByTitle(title: string): { pageId: string; databaseId: string }[]
  resolveAsset(fromFile: string, href: string): AssetRef | null
  warn(code: WarningCode, detail?: string): void
}

export interface PageFields { createdAt?: number; updatedAt?: number; createdBy?: string; updatedBy?: string }
export interface ColumnPlan {
  property: Property
  convert(sample: CellSample): { value?: PropValue; page?: PageFields }
}

const COLORS: OptionColor[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']
const VALID_COLORS = new Set<string>(['default', ...COLORS])

export function normalizeHint(raw: string | undefined | null): BundleHint | undefined {
  if (!raw) return undefined
  const value = raw.toLowerCase().replace(/^property-row-|^types?/, '').replace(/[\s-]/g, '_')
  const table: [RegExp, BundleHint][] = [
    [/^title$/, 'title'], [/multi/, 'multi_select'], [/^status/, 'status'], [/select/, 'select'], [/^(text|rich_text)$/, 'text'], [/^number/, 'number'],
    [/created_?(time|at)$/, 'created_time'], [/(last_)?edited_?(time|at)$|updated_?(time|at)$/, 'last_edited_time'], [/created_?by$/, 'created_by'], [/edited_?by$|updated_?by$/, 'last_edited_by'],
    [/^date/, 'date'], [/^(person|people)/, 'person'], [/^files?/, 'file'], [/^checkbox/, 'checkbox'], [/^url$/, 'url'], [/^email/, 'email'],
    [/^phone/, 'phone'], [/^formula/, 'formula'], [/^relation/, 'relation'], [/^rollup/, 'rollup'], [/^(auto_increment_id|unique_id|id)$/, 'unique_id'], [/^button/, 'button'], [/^(place|location)/, 'place'],
  ]
  for (const [pattern, hint] of table) if (pattern.test(value)) return hint
  return undefined
}

// ---------------------------------------------------------------- datas

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  fev: 2, abr: 4, mai: 5, ago: 8, set: 9, out: 10, dez: 12,
}
const pad = (value: number) => String(value).padStart(2, '0')
const isoDate = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 0 ? `${year}-${pad(month)}-${pad(day)}` : null

function parseTime(raw: string): string | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(raw.trim())
  if (!match || (!match[2] && !match[3])) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null
}

/** Uma data (com hora opcional) em formatos que o Export Bundle exporta. */
export function parseSingleDate(raw: string, dayFirst = false): { date: string; time?: string } | null {
  let value = raw.trim().replace(/^@/, '').replace(/\s*\((?:GMT|UTC)?[^)]*\)\s*$/i, '').replace(/\s+(?:GMT|UTC)[+-]?\d{0,2}(?::?\d{2})?$/i, '').trim()
  if (!value) return null
  let time: string | undefined
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(.+))?$/.exec(value)
  if (iso) {
    const date = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (!date) return null
    if (iso[4]) { const parsed = parseTime(iso[4].replace(/(\.\d+)?(z|[+-]\d{2}:?\d{2})$/i, '')); if (!parsed) return null; time = parsed }
    return { date, time }
  }
  const timeMatch = /\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)$/i.exec(value)
  if (timeMatch) { const parsed = parseTime(timeMatch[1]); if (parsed) { time = parsed; value = value.slice(0, timeMatch.index).replace(/[,\s]+(at|às|as)?$/i, '').trim() } }
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value)
  if (numeric) {
    const a = Number(numeric[1]), b = Number(numeric[2]), year = Number(numeric[3])
    const date = a > 12 || (dayFirst && b <= 12) ? isoDate(year, b, a) : isoDate(year, a, b)
    return date ? { date, time } : null
  }
  const english = /^([a-zç]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(value)
  if (english && MONTHS[english[1].toLowerCase()]) { const date = isoDate(Number(english[3]), MONTHS[english[1].toLowerCase()], Number(english[2])); return date ? { date, time } : null }
  const european = /^(\d{1,2})(?:º)?\s+(?:de\s+)?([a-zç]+)\.?,?\s+(?:de\s+)?(\d{4})$/i.exec(value)
  if (european && MONTHS[european[2].toLowerCase()]) { const date = isoDate(Number(european[3]), MONTHS[european[2].toLowerCase()], Number(european[1])); return date ? { date, time } : null }
  return null
}

export function parseBundleDate(raw: string, dayFirst = false): DateValue | null {
  const parts = raw.split(/\s*(?:→|->|–|—)\s*/)
  if (parts.length > 2) return null
  const start = parseSingleDate(parts[0], dayFirst)
  if (!start) return null
  const value: DateValue = { start: start.date }
  if (start.time) value.startTime = start.time
  if (parts[1]) {
    // "October 7, 2026 3:00 PM → 5:00 PM" (mesma data).
    const onlyTime = parseTime(parts[1])
    const end = onlyTime ? { date: start.date, time: onlyTime } : parseSingleDate(parts[1], dayFirst)
    if (!end) return null
    value.end = end.date
    if (end.time) value.endTime = end.time
  }
  return value
}

// ---------------------------------------------------------------- números

export function parseNumber(raw: string): { value: number; format?: Property['numberFormat']; currency?: string } | null {
  let value = raw.trim().replace(/ /g, ' ')
  if (!value || value.length > 40) return null
  let currency: string | undefined
  const symbols: [RegExp, string][] = [[/^R\$\s?/, 'BRL'], [/^US\$\s?|^\$\s?/, 'USD'], [/^€\s?|\s?€$/, 'EUR'], [/^£\s?/, 'GBP'], [/^¥\s?/, 'JPY']]
  for (const [pattern, code] of symbols) if (pattern.test(value)) { currency = code; value = value.replace(pattern, ''); break }
  let percent = false
  if (value.endsWith('%')) { percent = true; value = value.slice(0, -1).trim() }
  const negative = /^\(.*\)$/.test(value)
  if (negative) value = value.slice(1, -1)
  let normalized: string
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value) || /^-?\d+,\d+$/.test(value)) normalized = value.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value) || /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(value)) normalized = value.replace(/,/g, '')
  else return null
  let number = Number(normalized)
  if (!Number.isFinite(number)) return null
  if (negative) number = -number
  if (percent) return { value: number / 100, format: 'percent' }
  if (currency) return { value: number, format: 'currency', currency }
  return { value: number }
}

// ---------------------------------------------------------------- listas

/** Separa valores de multisseleção/pessoas exportados como "A, B, C" (respeitando aspas). */
export function splitList(raw: string): string[] {
  return raw.split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(part => part.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
}

/** "Título (caminho%20id.md), Outro (https://www.bundle.so/…)" → itens com alvo. */
export function parseRelationText(raw: string): CellLink[] {
  const out: CellLink[] = []
  const pattern = new RegExp(COMPAT.record078, "gi")
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = pattern.exec(raw))) {
    if (match.index !== consumed && raw.slice(consumed, match.index).trim()) return []
    out.push({ text: match[1].trim(), href: match[2].trim() })
    consumed = pattern.lastIndex
    if (match[0] === '') pattern.lastIndex++
  }
  return raw.slice(consumed).trim() ? [] : out
}

// ---------------------------------------------------------------- inferência

const YES = new Set(['yes', 'no', 'sim', 'não', 'nao', 'true', 'false', '✓', '✔', '☑', '☐'])
const TRUE = new Set(['yes', 'sim', 'true', '✓', '✔', '☑'])
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const URL = /^(https?:\/\/|www\.)\S+$/i
const PHONE = /^\+?[\d\s().-]{7,20}$/

const STATUS_GROUP = (name: string): SelectOption['group'] => /(done|complete|conclu|finaliz|feito|closed|fechad|archiv|arquiv)/i.test(name) ? 'complete' : /(progress|andamento|doing|fazendo|review|revis|started|iniciad)/i.test(name) && !/not\s+started|não\s+iniciad|nao\s+iniciad/i.test(name) ? 'progress' : 'todo'

interface Resolved { pageId: string; databaseId: string | null }

function resolveLinks(sample: CellSample, env: ColumnEnv): { links: Resolved[]; unresolved: number; total: number } {
  const items = sample.links?.length ? sample.links : parseRelationText(sample.raw)
  const links: Resolved[] = []
  let unresolved = 0
  for (const item of items) {
    const target = env.resolveLink(sample.fromFile, item.href)
    if (target) links.push(target)
    else unresolved++
  }
  return { links, unresolved, total: items.length }
}

export function planColumn(name: string, samples: CellSample[], env: ColumnEnv, options: { dayFirst?: boolean } = {}): ColumnPlan {
  const filled = samples.filter(sample => sample.raw.trim() !== '' || sample.chips?.length || sample.checked !== undefined || sample.links?.length)
  const values = filled.map(sample => sample.raw.trim()).filter(Boolean)
  const hint = mostCommon(samples.map(sample => sample.hint).filter((value): value is BundleHint => !!value))
  const lower = name.trim().toLowerCase()
  const base = (type: PropType, extra: Partial<Property> = {}): Property => ({ id: newId(), name, type, ...extra })
  const textPlan = (type: PropType = 'text'): ColumnPlan => ({ property: base(type), convert: sample => ({ value: sample.raw.trim() || null }) })

  // Computados → texto estático (com aviso).
  if (hint === 'formula' || hint === 'rollup') {
    if (filled.length) env.warn(hint === 'formula' ? 'formula-static' : 'rollup-static', name)
    const numeric = values.length > 0 && values.every(value => parseNumber(value))
    if (numeric) return { property: base('number'), convert: sample => ({ value: parseNumber(sample.raw)?.value ?? null }) }
    return textPlan()
  }
  if (hint === 'person') { if (filled.length) env.warn('person-text', name); return textPlan() }
  if (hint === 'unique_id' || hint === 'button' || hint === 'place') return textPlan()

  const pageField = (field: keyof PageFields, type: PropType): ColumnPlan => ({
    property: base(type),
    convert: sample => {
      if (field === 'createdBy' || field === 'updatedBy') return sample.raw.trim() ? { page: { [field]: sample.raw.trim() } } : {}
      const date = parseBundleDate(sample.raw, options.dayFirst)
      if (!date) return {}
      const stamp = new Date(`${date.start}T${date.startTime ?? '00:00'}:00`).getTime()
      return Number.isFinite(stamp) ? { page: { [field]: stamp } } : {}
    },
  })
  const allDates = values.length > 0 && values.every(value => parseBundleDate(value, options.dayFirst))
  if (hint === 'created_time' || (!hint && allDates && /^(created( time)?|criad[oa]( em)?|data de criação|created at)$/.test(lower))) return pageField('createdAt', 'createdTime')
  if (hint === 'last_edited_time' || (!hint && allDates && /^(last edited( time)?|updated( at)?|última edição|editad[oa] em|atualizad[oa] em)$/.test(lower))) return pageField('updatedAt', 'updatedTime')
  if (hint === 'created_by' || (!hint && /^(created by|criad[oa] por)$/.test(lower))) return pageField('createdBy', 'createdBy')
  if (hint === 'last_edited_by' || (!hint && /^(last edited by|editad[oa] por|atualizad[oa] por)$/.test(lower))) return pageField('updatedBy', 'updatedBy')

  // Relações: links para páginas importadas que são linhas de um banco.
  if (hint === 'relation' || (!hint && filled.length)) {
    const resolved = filled.map(sample => resolveLinks(sample, env))
    const targets = resolved.flatMap(entry => entry.links)
    const anyLinks = resolved.some(entry => entry.total > 0)
    const linksEverywhere = resolved.every(entry => entry.total > 0)
    let databaseId = mostCommon(targets.map(target => target.databaseId).filter((value): value is string => !!value))
    // Exportações recentes trazem só os títulos: casa por título em um único banco.
    let byTitle = false
    if (!databaseId && (hint === 'relation' || !anyLinks) && values.length) {
      const tokenLists = filled.map(sample => splitList(sample.raw))
      const candidates = tokenLists.flat().map(token => new Set(env.rowsByTitle(token).map(row => row.databaseId)))
      if (candidates.length && candidates.every(set => set.size > 0)) {
        const common = [...candidates[0]].filter(id => candidates.every(set => set.has(id)))
        if (common.length === 1 && (hint === 'relation' || !values.every(value => parseNumber(value) || parseBundleDate(value, options.dayFirst)))) { databaseId = common[0]; byTitle = true }
      }
    }
    if (databaseId && (hint === 'relation' || byTitle || linksEverywhere)) {
      const target = databaseId
      return {
        property: base('relation', { relationDatabaseId: target }),
        convert: sample => {
          if (byTitle && !sample.links?.length && !parseRelationText(sample.raw).length) {
            const ids = splitList(sample.raw).map(token => env.rowsByTitle(token).find(row => row.databaseId === target)?.pageId).filter((id): id is string => !!id)
            return { value: ids.length ? [...new Set(ids)] : [] }
          }
          const entry = resolveLinks(sample, env)
          if (entry.unresolved) env.warn('relation-unresolved', `${name}: ${sample.raw.slice(0, 80)}`)
          const ids = entry.links.filter(link => link.databaseId === target).map(link => link.pageId)
          return { value: [...new Set(ids)] }
        },
      }
    }
    if (hint === 'relation') { if (filled.length) env.warn('relation-unresolved', name); return { property: base('text'), convert: sample => ({ value: relationText(sample) || null }) } }
  }

  // Arquivos: valores que apontam para arquivos presentes na exportação.
  const fileTokens = (sample: CellSample): string[] => {
    if (sample.links?.length) return sample.links.map(link => link.href)
    const items = parseRelationText(sample.raw)
    return items.length ? items.map(item => item.href) : splitList(sample.raw)
  }
  if (hint === 'file' || (!hint && filled.length && filled.every(sample => { const tokens = fileTokens(sample); return tokens.length > 0 && tokens.every(token => !/^https?:/i.test(token) && env.resolveAsset(sample.fromFile, token)) }))) {
    return {
      property: base('files'),
      convert: sample => {
        const files: FileValue[] = []
        for (const token of fileTokens(sample)) {
          const asset = env.resolveAsset(sample.fromFile, token)
          if (asset) files.push({ id: newId(), name: asset.name, mimeType: asset.mime, data: asset.url, size: asset.size })
          else if (token) env.warn('missing-asset', token)
        }
        return { value: files }
      },
    }
  }

  if (hint === 'checkbox' || (!hint && values.length > 0 && values.every(value => YES.has(value.toLowerCase())) && values.some(value => /^(yes|no|sim|não|nao)$/i.test(value)))) {
    return { property: base('checkbox'), convert: sample => ({ value: sample.checked ?? TRUE.has(sample.raw.trim().toLowerCase()) }) }
  }

  if (hint === 'number' || (!hint && values.length && values.every(value => parseNumber(value)))) {
    const parsed = values.map(value => parseNumber(value)).filter(Boolean)
    const format = mostCommon(parsed.map(entry => entry!.format).filter((value): value is NonNullable<Property['numberFormat']> => !!value))
    const currency = mostCommon(parsed.map(entry => entry!.currency).filter((value): value is string => !!value))
    if (hint === 'number' || parsed.length === values.length) {
      return { property: base('number', { ...(format ? { numberFormat: format } : {}), ...(currency ? { currency } : {}) }), convert: sample => ({ value: parseNumber(sample.raw)?.value ?? null }) }
    }
  }

  if (hint === 'date' || (!hint && allDates)) {
    return { property: base('date'), convert: sample => ({ value: parseBundleDate(sample.raw, options.dayFirst) }) }
  }
  if (hint === 'url' || (!hint && values.length && values.every(value => URL.test(value)))) return textPlan('url')
  if (hint === 'email' || (!hint && values.length && values.every(value => EMAIL.test(value)))) return textPlan('email')
  if (hint === 'phone' || (!hint && values.length && values.every(value => PHONE.test(value) && (value.match(/\d/g) ?? []).length >= 7 && /[\s()+-]/.test(value)))) return textPlan('phone')

  // Seleção / multisseleção / status.
  const chipColors = new Map<string, string>()
  for (const sample of filled) for (const chip of sample.chips ?? []) if (chip.color && !chipColors.has(chip.name)) chipColors.set(chip.name, chip.color)
  const tokensOf = (sample: CellSample): string[] => sample.chips?.length ? sample.chips.map(chip => chip.name) : splitList(sample.raw)
  const selectLike = (multi: boolean): boolean => {
    if (!values.length) return false
    if (values.some(value => value.includes('\n') || value.length > (multi ? 200 : 60))) return false
    const tokens = multi ? filled.flatMap(tokensOf) : values
    if (tokens.some(token => token.length > 40 || /[.!?]\s/.test(token))) return false
    const distinct = new Set(tokens).size
    if (multi && !filled.some(sample => tokensOf(sample).length > 1)) return false
    if (tokens.some(token => token.split(/\s+/).length > 4)) return false
    // Poucas linhas: só vira seleção se algum valor se repete ou o nome da coluna sugere categoria.
    if (/^(status|estado|situação|situacao|etapa|stage|priority|prioridade|tipo|type|category|categoria|tags?|etiquetas?|labels?|kind|g[eê]nero|genre)$/i.test(name.trim())) return true
    if (distinct === tokens.length) return false
    return distinct <= Math.max(2, Math.ceil(tokens.length * 0.6))
  }
  const isStatusName = /^(status|estado|situação|situacao|etapa|stage)$/i.test(name.trim())
  let selectType: 'select' | 'multiSelect' | 'status' | null = null
  if (hint === 'multi_select') selectType = 'multiSelect'
  else if (hint === 'status') selectType = 'status'
  else if (hint === 'select') selectType = isStatusName ? 'status' : 'select'
  else if (!hint) {
    const tagName = /^(tags?|etiquetas?|categorias|labels?)$/i.test(name.trim())
    if (selectLike(true) || (tagName && values.length > 0 && filled.every(sample => tokensOf(sample).every(token => token.length <= 40)))) selectType = 'multiSelect'
    else if (selectLike(false)) selectType = isStatusName ? 'status' : 'select'
  }
  if (selectType) {
    const optionsByName = new Map<string, SelectOption>()
    const order = filled.flatMap(sample => selectType === 'multiSelect' ? tokensOf(sample) : sample.chips?.length ? sample.chips.map(chip => chip.name) : [sample.raw.trim()]).filter(Boolean)
    for (const token of order) if (!optionsByName.has(token)) {
      const color = chipColors.get(token)
      const option: SelectOption = { id: newId(), name: token, color: (color && VALID_COLORS.has(color) ? color : COLORS[optionsByName.size % COLORS.length]) as OptionColor }
      if (selectType === 'status') option.group = STATUS_GROUP(token)
      optionsByName.set(token, option)
    }
    const type = selectType
    return {
      property: base(type, { options: [...optionsByName.values()] }),
      convert: sample => {
        if (type === 'multiSelect') return { value: [...new Set(tokensOf(sample))].map(token => optionsByName.get(token)?.id).filter((id): id is string => !!id) }
        const name = sample.chips?.[0]?.name ?? sample.raw.trim()
        return { value: optionsByName.get(name)?.id ?? null }
      },
    }
  }
  return textPlan()
}

function relationText(sample: CellSample): string {
  const items = sample.links?.length ? sample.links : parseRelationText(sample.raw)
  return items.length ? items.map(item => item.text).join(', ') : sample.raw.trim()
}

function mostCommon<T>(items: T[]): T | undefined {
  const counts = new Map<T, number>()
  let best: T | undefined, bestCount = 0
  for (const item of items) { const count = (counts.get(item) ?? 0) + 1; counts.set(item, count); if (count > bestCount) { best = item; bestCount = count } }
  return best
}

/** Detecta, por coluna, se as datas numéricas estão em dia/mês/ano. */
export function detectDayFirst(values: string[], locale: string): boolean {
  for (const value of values) {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/.exec(value.trim())
    if (!match) continue
    if (Number(match[1]) > 12) return true
    if (Number(match[2]) > 12) return false
  }
  return locale === 'pt-BR'
}

export { idFromHref }
