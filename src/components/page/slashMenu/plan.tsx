import { ChevronRight } from 'lucide-react'
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import type { SlashCommand } from './catalog'
import { planSlashMenu, type SlashPlanEntry } from './ranking'
import { recentIds, recordUse, usageScores } from '../../../usage/usage'

/** Grupos expandidos ("Mais blocos", "Ver mais"). Zera sempre que o menu abre do zero. */
const expanded = new Set<string>()
let reopening = false

export function slashPlan(catalog: readonly SlashCommand[], query: string, locale: 'pt-BR' | 'en-US'): SlashPlanEntry[] {
  if (!query.trim()) { if (!reopening) expanded.clear(); reopening = false }
  return planSlashMenu(catalog, { query, locale, usage: { recent: recentIds('slash', 5), scores: usageScores('slash') }, expanded })
}
export const recordSlashUse = (id: string) => recordUse('slash', id)

/** Linha "Mais blocos ›" / "Ver mais ›": expande o grupo e reabre o menu no mesmo ponto. */
export function moreSlashItem(entry: Extract<SlashPlanEntry, { kind: 'more' }>, reopen?: () => void): DefaultReactSuggestionItem {
  return {
    title: entry.label,
    group: entry.group,
    icon: <ChevronRight size={18} strokeWidth={1.6} />,
    aliases: [],
    onItemClick: () => {
      expanded.add(entry.key)
      if (entry.key !== 'all') expanded.add('all')
      reopening = true
      // Clicar fecha o menu e apaga o "/"; reabre já expandido.
      queueMicrotask(() => reopen?.())
    },
  }
}

/**
 * Grupo do item-sentinela "Nenhum resultado". O BlockNote fecha o menu quando a lista fica vazia por
 * mais de 3 letras seguidas e deixa o "/xyzq" como texto, sem aviso. Com um item sempre presente o menu
 * continua aberto (como no Export Bundle): Esc fecha e Backspace edita a busca.
 */
export const EMPTY_SLASH_GROUP = '__empty__'
export function emptySlashItem(query: string, locale: 'pt-BR' | 'en-US'): DefaultReactSuggestionItem {
  return {
    title: locale === 'en-US' ? `No results for “${query.trim()}”` : `Nenhum resultado para “${query.trim()}”`,
    group: EMPTY_SLASH_GROUP,
    aliases: [],
    onItemClick: () => {},
  }
}
