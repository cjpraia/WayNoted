import { SLASH_CATEGORY_PT, type SlashCategory, type SlashCommand } from './catalog.ts'
import { serialOrder } from '../../../usage/usage.ts'

/** Lei de Hick/Miller: no máximo 7 itens visíveis por grupo antes de "Ver mais". */
export const SLASH_GROUP_LIMIT = 7
/** Na busca, a digitação já estreita: mostra só os 10 mais relevantes. */
export const SLASH_SEARCH_LIMIT = 10
export const SLASH_RECENT_COUNT = 5
export const SLASH_SUGGESTED_COUNT = 8
/** Sugeridos de partida (Pareto): o que quase todo mundo usa, na ordem de importância. */
export const DEFAULT_SUGGESTED = ['text', 'heading-1', 'bulleted-list', 'to-do-list', 'table', 'code', 'page', 'query', 'heading-2', 'quote', 'numbered-list', 'heading-3'] as const
/** Categorias que só aparecem depois de "Mais blocos", na ordem de uso típico. */
const CATEGORY_ORDER: SlashCategory[] = ['Basic blocks', 'Media', 'Database', 'Advanced blocks', 'Inline', 'Embeds', 'Turn into', 'Actions', 'Text color', 'Background color']
const COLLAPSED_ROOT = 'all'

export type SlashPlanEntry =
  | { kind: 'item'; command: SlashCommand; group: string }
  | { kind: 'more'; group: string; key: string; hidden: number; label: string }

export interface SlashUsage { recent: readonly string[]; scores: Readonly<Record<string, number>> }
export interface SlashPlanOptions { query: string; locale: 'pt-BR' | 'en-US'; usage?: SlashUsage; expanded?: ReadonlySet<string> }

export const normalizeSlash = (text: string, locale: 'pt-BR' | 'en-US' = 'pt-BR') => text.toLocaleLowerCase(locale).normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const categoryLabel = (category: SlashCategory, locale: 'pt-BR' | 'en-US') => locale === 'en-US' ? category : SLASH_CATEGORY_PT[category]

function distanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** Relevância da consulta para um comando: título > alias > trecho; 0 = não casa. */
export function relevance(command: SlashCommand, rawQuery: string, locale: 'pt-BR' | 'en-US'): number {
  const q = normalizeSlash(rawQuery, locale)
  if (!q) return 0
  const titles = [command.pt, command.en].map((text) => normalizeSlash(text, locale))
  const aliases = command.aliases.map((text) => normalizeSlash(text, locale))
  let best = 0
  for (const title of titles) {
    if (title === q) best = Math.max(best, 100)
    else if (title.startsWith(q)) best = Math.max(best, 90)
    else if (title.split(/[\s\-–—:/]+/).some((word) => word.startsWith(q))) best = Math.max(best, 75)
    else if (title.includes(q)) best = Math.max(best, 40)
  }
  for (const alias of aliases) {
    if (alias === q) best = Math.max(best, 85)
    else if (alias.startsWith(q)) best = Math.max(best, 60)
    else if (alias.includes(q)) best = Math.max(best, 30)
  }
  if (!best && q.length >= 4) {
    // Tolerância a erros de digitação: uma letra trocada, faltando ou sobrando em alguma palavra.
    const words = [...titles, ...aliases].flatMap((text) => text.split(/[\s\-–—:/]+/))
    if (words.some((word) => word.length >= 4 && distanceAtMost1(q, word))) best = 20
  }
  return best
}

/** Bônus de uso, limitado para que a relevância do texto continue mandando. */
const usageBonus = (score: number | undefined) => Math.min(20, (score ?? 0) * 4)

function dedupe(list: readonly SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>()
  return list.filter((command) => {
    const key = `${command.operation}|${command.en}|${command.pt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Plano do menu: sem texto, Recentes + Sugeridos + "Mais blocos"; com texto, busca ordenada. */
export function planSlashMenu(catalog: readonly SlashCommand[], options: SlashPlanOptions): SlashPlanEntry[] {
  const { locale } = options
  const usage = options.usage ?? { recent: [], scores: {} }
  const expanded = options.expanded ?? new Set<string>()
  const label = (pt: string, en: string) => locale === 'en-US' ? en : pt
  const query = options.query.trim()
  const byId = new Map<string, SlashCommand>()
  for (const command of catalog) if (!byId.has(command.id)) byId.set(command.id, command)

  if (query) {
    let matches = dedupe(catalog).map((command, index) => ({ command, index, score: relevance(command, query, locale) })).filter((entry) => entry.score > 0)
    const normalized = normalizeSlash(query, locale)
    matches = matches.map((entry) => ({ ...entry, score: entry.score + usageBonus(usage.scores[entry.command.id]) + (normalized.startsWith('data') ? (entry.command.id === 'database-inline' ? 30 : entry.command.id === 'database-full-page' ? 20 : 0) : 0) }))
    matches.sort((a, b) => b.score - a.score || a.index - b.index)
    const group = label('Resultados', 'Results')
    return matches.slice(0, SLASH_SEARCH_LIMIT).map((entry): SlashPlanEntry => ({ kind: 'item', command: entry.command, group }))
  }

  const plan: SlashPlanEntry[] = []
  const shown = new Set<string>()
  const recents = usage.recent.map((id) => byId.get(id)).filter((command): command is SlashCommand => !!command).slice(0, SLASH_RECENT_COUNT)
  const recentGroup = label('Recentes', 'Recent')
  for (const command of recents) { plan.push({ kind: 'item', command, group: recentGroup }); shown.add(command.id) }

  // Sugeridos: os mais usados primeiro; completa com o padrão. Posição serial: 1º no início, 2º no fim.
  const ranked: SlashCommand[] = []
  const pushRanked = (command: SlashCommand | undefined) => { if (command && !shown.has(command.id) && !ranked.includes(command) && ranked.length < SLASH_SUGGESTED_COUNT) ranked.push(command) }
  Object.entries(usage.scores).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).forEach(([id]) => pushRanked(byId.get(id)))
  DEFAULT_SUGGESTED.forEach((id) => pushRanked(byId.get(id)))
  const suggestedGroup = label('Sugeridos', 'Suggested')
  for (const command of serialOrder(ranked)) { plan.push({ kind: 'item', command, group: suggestedGroup }); shown.add(command.id) }

  const rest = dedupe(catalog).filter((command) => command.category !== 'Suggested' && !shown.has(command.id))
  if (!expanded.has(COLLAPSED_ROOT)) {
    const hidden = rest.length
    plan.push({ kind: 'more', group: plan.at(-1)?.group ?? suggestedGroup, key: COLLAPSED_ROOT, hidden, label: label('Mais blocos ›', 'More blocks ›') })
    return plan
  }
  for (const category of CATEGORY_ORDER) {
    const items = rest.filter((command) => command.category === category)
    if (!items.length) continue
    const group = categoryLabel(category, locale)
    const open = expanded.has(`cat:${category}`)
    for (const command of open ? items : items.slice(0, SLASH_GROUP_LIMIT)) plan.push({ kind: 'item', command, group })
    if (!open && items.length > SLASH_GROUP_LIMIT) plan.push({ kind: 'more', group, key: `cat:${category}`, hidden: items.length - SLASH_GROUP_LIMIT, label: label(`Ver mais ${items.length - SLASH_GROUP_LIMIT} ›`, `Show ${items.length - SLASH_GROUP_LIMIT} more ›`) })
  }
  return plan
}
