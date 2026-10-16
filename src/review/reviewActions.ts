// Revisão espaçada (A6) — ligação com o store: marcar cartões, montar a fila, ler o conteúdo e gravar as notas.
// O estado fica em `settings.review`; nada aqui escreve na página nem no histórico dela.
import { useSyncExternalStore } from 'react'
import { actions, getState, loadDocForIndex, selectors, subscribe } from '../store.ts'
import { protectedAncestor } from '../security/pageLock.ts'
import { translate } from '../localization.ts'
import type { Grade } from './fsrs.ts'
import { addCards, applyRating, buildQueue, cardKey, extractToggleCards, removeCards, splitKey, undoRating, type CardKey, type Queue, type ReviewSettings, type ToggleCard, type UndoEntry } from './reviewCore.ts'

const message = (pt: string, en: string) => translate(getState().settings.locale, pt, en)
export const reviewSettings = (): ReviewSettings => getState().settings.review ?? {}
const write = (next: ReviewSettings) => actions.updateSettings({ review: next })

/** A página pode ser revisada: viva, fora da lixeira e sem senha (o conteúdo de páginas protegidas nunca aparece aqui). */
export function reviewablePage(pageId: string): boolean {
  const { pages } = getState()
  return !!pages[pageId] && selectors.isLive(pageId) && !protectedAncestor(pages, pageId)
}

// ---------- Cartões de bloco de alternância (cache por página) ----------

const toggleCache = new Map<string, { key: string; cards: ToggleCard[] }>()
const pageKey = (pageId: string) => { const page = getState().pages[pageId]; return `${page?.updatedAt ?? 0}:${(page?.text ?? '').length}` }

export async function toggleCardsOf(pageId: string): Promise<ToggleCard[]> {
  const cached = toggleCache.get(pageId)
  if (cached && cached.key === pageKey(pageId)) return cached.cards
  if (!reviewablePage(pageId)) return []
  const blocks = await loadDocForIndex(pageId).catch(() => null)
  const cards = blocks ? extractToggleCards(blocks) : []
  toggleCache.set(pageId, { key: pageKey(pageId), cards })
  return cards
}

/** Cria cartões novos para os blocos de alternância ainda não registrados e remove os de blocos que sumiram. */
export async function syncToggleCards(now = Date.now()): Promise<void> {
  const pageIds = Object.keys(reviewSettings().toggles ?? {})
  for (const pageId of pageIds) {
    const found = await toggleCardsOf(pageId)
    if (!reviewablePage(pageId)) continue
    const live = new Set(found.map(card => cardKey(pageId, card.blockId)))
    let next = addCards(reviewSettings(), [...live], now)
    next = removeCards(next, key => { const part = splitKey(key); return part.pageId === pageId && !!part.blockId && !live.has(key) })
    if (JSON.stringify(next.cards) !== JSON.stringify(reviewSettings().cards)) write(next)
  }
}

// ---------- Marcar ----------

export const isPageCard = (pageId: string) => !!reviewSettings().cards?.[pageId]
export const hasToggleCards = (pageId: string) => !!reviewSettings().toggles?.[pageId]

export function setPageCard(pageId: string, on: boolean, now = Date.now()) {
  if (on && !reviewablePage(pageId)) throw new Error(message('Esta página não pode virar cartão (protegida ou na lixeira).', 'This page cannot become a card (protected or in the trash).'))
  const current = reviewSettings()
  write(on ? addCards(current, [pageId], now) : removeCards(current, key => key === pageId))
}

export async function setToggleCards(pageId: string, on: boolean, now = Date.now()) {
  const current = reviewSettings()
  if (!on) {
    const toggles = { ...current.toggles }
    delete toggles[pageId]
    write({ ...removeCards(current, key => { const part = splitKey(key); return part.pageId === pageId && !!part.blockId }), toggles })
    return
  }
  if (!reviewablePage(pageId)) throw new Error(message('Esta página não pode virar cartões (protegida ou na lixeira).', 'This page cannot become cards (protected or in the trash).'))
  write({ ...current, toggles: { ...current.toggles, [pageId]: true } })
  await syncToggleCards(now)
}

// ---------- Fila ----------

export function currentQueue(now = Date.now()): Queue {
  const settings = reviewSettings()
  return buildQueue({ settings, now, pageOk: reviewablePage, blockOk: (pageId, blockId) => { const cached = toggleCache.get(pageId); return !cached || cached.cards.some(card => card.blockId === blockId) } })
}

let revision = 0
const listeners = new Set<() => void>()
export const bumpReview = () => { revision++; for (const listener of listeners) listener() }

/** Reavalia a fila quando o estado de revisão ou as páginas mudam, e na virada do dia (via `now`). */
export function useReviewVersion(): ReviewSettings | undefined {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => revision)
  return useSyncExternalStore(subscribe, () => getState().settings.review)
}

// ---------- Conteúdo do cartão ----------

export interface CardContent { key: CardKey; pageId: string; blockId?: string; title: string; icon: string | null; front: string; back: string; kind: 'page' | 'toggle' }

const trim = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

export async function cardContent(key: CardKey): Promise<CardContent | null> {
  const { pageId, blockId } = splitKey(key)
  const page = getState().pages[pageId]
  if (!page || !reviewablePage(pageId)) return null
  const untitled = message('Sem título', 'Untitled')
  if (blockId) {
    const found = (await toggleCardsOf(pageId)).find(card => card.blockId === blockId)
    return found ? { key, pageId, blockId, title: page.title || untitled, icon: page.icon, front: found.front, back: found.back, kind: 'toggle' } : null
  }
  const body = (page.bodyText ?? page.text ?? '').trim()
  return { key, pageId, title: page.title || untitled, icon: page.icon, front: page.title || trim(body, 200) || untitled, back: trim(body, 3000), kind: 'page' }
}

// ---------- Notas ----------

/** Grava a nota. Devolve o que é preciso para desfazer, ou null se o cartão sumiu. */
export function rateCard(key: CardKey, grade: Grade, now = Date.now()): UndoEntry | null {
  const result = applyRating(reviewSettings(), key, grade, now)
  if (!result) return null
  write(result.settings)
  return result.undo
}

export function undoRate(entry: UndoEntry) { write(undoRating(reviewSettings(), entry)) }

export function updateReviewPrefs(patch: Pick<ReviewSettings, 'newPerDay' | 'retention' | 'maxInterval'>) { write({ ...reviewSettings(), ...patch }) }

export function openCardSource(key: CardKey) {
  const { pageId, blockId } = splitKey(key)
  actions.openPage(pageId, blockId ? { blockId } : {})
}
