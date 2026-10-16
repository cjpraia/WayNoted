// Navegação por teclado entre cartões/linhas (quadro, galeria, lista): setas movem o foco, Enter abre a
// página, Espaço seleciona, F2 renomeia. O modelo de movimento é puro (testável); o hook só cuida do foco.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react'

export type CardKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
export const CARD_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

/** Grade (galeria) ou lista (`perRow` = 1): devolve o novo índice (limitado às pontas). */
export function moveInGrid(count: number, perRow: number, index: number, key: CardKey): number {
  if (count <= 0) return -1
  const cols = Math.max(1, perRow)
  const cur = Math.min(Math.max(index, 0), count - 1)
  switch (key) {
    case 'ArrowLeft': return cols > 1 ? Math.max(0, cur - 1) : cur
    case 'ArrowRight': return cols > 1 ? Math.min(count - 1, cur + 1) : cur
    case 'ArrowUp': return cur - cols >= 0 ? cur - cols : cur
    case 'ArrowDown': return cur + cols <= count - 1 ? cur + cols : cur
    case 'Home': return 0
    case 'End': return count - 1
  }
}

/** Quadro: colunas de cartões. Esquerda/direita vão à coluna não vazia vizinha, mantendo o índice (limitado). */
export function moveInColumns(sizes: readonly number[], pos: { col: number; index: number }, key: CardKey): { col: number; index: number } {
  const size = sizes[pos.col] ?? 0
  const keep = { col: pos.col, index: Math.min(pos.index, Math.max(0, size - 1)) }
  switch (key) {
    case 'ArrowUp': return { col: pos.col, index: Math.max(0, keep.index - 1) }
    case 'ArrowDown': return { col: pos.col, index: Math.min(size - 1, keep.index + 1) }
    case 'Home': return { col: pos.col, index: 0 }
    case 'End': return { col: pos.col, index: Math.max(0, size - 1) }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const step = key === 'ArrowLeft' ? -1 : 1
      for (let c = pos.col + step; c >= 0 && c < sizes.length; c += step) {
        if (sizes[c] > 0) return { col: c, index: Math.min(keep.index, sizes[c] - 1) }
      }
      return keep
    }
  }
}

export interface CardNavOptions {
  /** Raiz da visualização (onde os cartões `[data-row-id]` são procurados). */
  root: () => HTMLElement | null
  /** Id do cartão vizinho na direção da tecla (ou null). */
  neighbor: (id: string, key: CardKey) => string | null
  /** Primeiro cartão (recebe o Tab quando nenhum foi focado antes). */
  firstId: string | undefined
  onOpen: (id: string) => void
  /** F2: renomear o título no próprio cartão. */
  onRename?: (id: string) => void
  /** Espaço: marcar/desmarcar o cartão. */
  onToggle?: (id: string) => void
}

/**
 * Foco por cartão (roving tabindex). `revealId` é o cartão para o qual o foco está indo: as visualizações
 * passam-no a `useRevealKey` para que um cartão virtualizado fora da tela seja renderizado antes de focar.
 */
export function useCardNav(options: CardNavOptions) {
  const [focusId, setFocusId] = useState<string | null>(null)
  const [revealId, setRevealId] = useState<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const frame = useRef(0)
  useEffect(() => () => clearTimeout(frame.current), [])

  const focusCard = useCallback((id: string) => {
    setFocusId(id)
    setRevealId(id)
    clearTimeout(frame.current)
    let tries = 0
    const attempt = () => {
      const el = optionsRef.current.root()?.querySelector<HTMLElement>(`[data-row-id="${id.replace(/["\\]/g, '\\$&')}"]`)
      if (el) {
        el.focus({ preventScroll: true })
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        setRevealId(null)
      } else if (tries++ < 30) frame.current = setTimeout(attempt, 16) as unknown as number
      else setRevealId(null)
    }
    attempt()
  }, [])

  const cardProps = (id: string) => ({
    tabIndex: (focusId ?? options.firstId) === id ? 0 : -1,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => { if (e.target === e.currentTarget) setFocusId(id) },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      // Só com o foco no próprio cartão: campos, editores e menus dentro dele não são capturados.
      if (e.target !== e.currentTarget || e.defaultPrevented || e.altKey) return
      const o = optionsRef.current
      if (CARD_KEYS.includes(e.key) && !e.metaKey && !e.ctrlKey) {
        const next = o.neighbor(id, e.key as CardKey)
        e.preventDefault()
        if (next && next !== id) focusCard(next)
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); o.onOpen(id) }
      else if (e.key === ' ' && o.onToggle) { e.preventDefault(); o.onToggle(id) }
      else if (e.key === 'F2' && o.onRename) { e.preventDefault(); o.onRename(id) }
    },
  })

  return { cardProps, focusId, revealId, focusCard }
}
