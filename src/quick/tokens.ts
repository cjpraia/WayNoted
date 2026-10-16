// Nota rápida: "@amanhã às 9h" vira a data da nota e "#tag" vira etiqueta (sem dependências).
// Os marcadores reconhecidos saem do texto; os demais ficam como foram digitados.
import { describeNaturalDate, findMarkedDate, toDateValue, type NaturalDateOptions } from '../nlp/dates.ts'
import type { DateValue } from '../types.ts'

export interface QuickTokens {
  title: string
  body: string
  tags: string[]
  date: DateValue | null
  /** "8 de outubro de 2026 09:00 · Todo mês no dia 5" */
  dateLabel: string
}

const TAG = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_\-/]{0,49})(?=$|[\s),.;:!?])/gu
// Junta espaços duplos deixados pelos marcadores, sem mexer no recuo das listas.
const tidy = (text: string) => text.replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/[ \t]+$/gm, '')

/** Etiquetas "#tag" (fora de blocos de código). */
export function findTags(text: string): string[] {
  const tags: string[] = []
  for (const [index, segment] of text.split('```').entries()) {
    if (index % 2) continue
    for (const match of segment.matchAll(TAG)) if (!/^\d+$/.test(match[2]) && !tags.some(tag => tag.toLowerCase() === match[2].toLowerCase())) tags.push(match[2])
  }
  return tags
}

function stripTags(text: string): string {
  return text.split('```').map((segment, index) => index % 2 ? segment : segment.replace(TAG, (_m, before: string, tag: string) => /^\d+$/.test(tag) ? _m : before)).join('```')
}

export function extractQuickTokens(title: string, body: string, options: NaturalDateOptions & { dates?: boolean; tags?: boolean } = {}): QuickTokens {
  let nextTitle = title, nextBody = body, date: DateValue | null = null, dateLabel = ''
  if (options.dates !== false) {
    for (const which of ['title', 'body'] as const) {
      const source = which === 'title' ? nextTitle : nextBody
      const found = findMarkedDate(source, options)
      if (!found) continue
      date = toDateValue(found)
      dateLabel = describeNaturalDate(found, options.locale ?? 'pt-BR')
      const stripped = tidy(source.slice(0, found.index) + source.slice(found.index + found.length))
      if (which === 'title') nextTitle = stripped.trim(); else nextBody = stripped
      break
    }
  }
  const tags = options.tags === false ? [] : findTags(`${nextTitle}\n${nextBody}`)
  if (tags.length) { nextTitle = tidy(stripTags(nextTitle)).trim(); nextBody = tidy(stripTags(nextBody)) }
  return { title: nextTitle, body: nextBody, tags, date, dateLabel }
}
