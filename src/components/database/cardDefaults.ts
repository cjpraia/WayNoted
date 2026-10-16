import type { Property, ViewType } from '../../types'

/** Visões de cartões: sem limite, 9 a 15 propriedades por cartão escondem a informação principal (Miller). */
export const CARD_VIEW_TYPES: readonly ViewType[] = ['calendar', 'gallery', 'board']
export const CARD_DEFAULT_PROPS = 3

const PRIORITY: Partial<Record<Property['type'], number>> = { status: 0, select: 1, date: 2, person: 3, multiSelect: 4, number: 5, checkbox: 6 }

/**
 * Ids a esconder ao CRIAR uma visão de cartões: deixa no máximo 3 propriedades visíveis além do título.
 * A propriedade de agrupamento e a de data já aparecem pela posição do cartão, então ficam fora da conta.
 * O usuário mostra mais em "Propriedades visíveis". Não se aplica a visões existentes.
 */
export function defaultCardHidden(type: ViewType, properties: readonly Property[], positional: ReadonlyArray<string | undefined> = []): string[] {
  if (!CARD_VIEW_TYPES.includes(type)) return []
  const candidates = properties.filter((p) => p.type !== 'title' && !positional.includes(p.id))
  const ranked = candidates.map((p, index) => ({ p, index })).sort((a, b) => (PRIORITY[a.p.type] ?? 9) - (PRIORITY[b.p.type] ?? 9) || a.index - b.index)
  return ranked.slice(CARD_DEFAULT_PROPS).map(({ p }) => p.id)
}
