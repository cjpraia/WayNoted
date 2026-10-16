// Virtualização leve e própria (sem dependências): renderiza só os itens visíveis + margem.
// Funciona com listas embutidas em páginas (o contêiner que rola é o ancestral mais próximo com
// overflow-y), com várias listas na mesma rolagem (grupos/colunas do quadro) e com alturas variáveis
// medidas por ResizeObserver. Os itens fora da faixa viram espaçadores (padTop/padBottom), então o
// layout existente (flex/sticky/grid) continua igual.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { buildOffsets, findRange, scrollDeltaFor } from './virtualMath.ts'

/** Abaixo disso não virtualiza (comportamento e DOM idênticos aos de antes). */
export const VIRTUAL_THRESHOLD = 120

export interface VirtualOptions<T> {
  items: readonly T[]
  keyOf: (item: T) => string
  /** Altura estimada (px) de um item ainda não medido. */
  estimate: number
  /** Espaço entre itens (px) que não faz parte da altura medida (ex.: `gap` de flex). */
  gap?: number
  /** Margem renderizada acima/abaixo da área visível (px). */
  overscan?: number
  /** Força ligar/desligar; padrão: liga a partir de VIRTUAL_THRESHOLD itens. */
  enabled?: boolean
  /** Mesma lista sendo renderizada em grade: quantos itens por linha (galeria). */
  perRow?: number
}

export interface VirtualResult {
  /** Ref do elemento cujo topo coincide com o topo do primeiro item. */
  containerRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  /** Índices [start, end) dos itens a renderizar (em itens, não em linhas da grade). */
  start: number
  end: number
  padTop: number
  padBottom: number
  /** Ref callback para medir cada item renderizado (use com `data-vkey`). */
  measure: (el: HTMLElement | null) => void
  /** Rola o contêiner até o item ficar visível; devolve true se precisou rolar. */
  scrollToIndex: (index: number) => boolean
}

type Scroller = HTMLElement | Window

/**
 * Ancestral que rola na vertical. `overflow-x: auto` (ex.: o quadro) também faz o eixo Y computar
 * `auto` sem rolar de fato: só conta quem tem conteúdo maior que a caixa; senão, o primeiro candidato.
 */
export function scrollParentOf(el: HTMLElement | null): Scroller {
  let cur = el?.parentElement ?? null, first: HTMLElement | null = null
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
      if (cur.scrollHeight > cur.clientHeight + 1) return cur
      first ??= getComputedStyle(cur).overflowX === 'visible' || getComputedStyle(cur).overflowX === 'clip' ? cur : first
    }
    cur = cur.parentElement
  }
  return first ?? window
}

function viewport(scroller: Scroller) {
  const h = typeof window !== 'undefined' ? window.innerHeight || 800 : 800
  if (scroller === window) return { top: 0, bottom: h }
  const r = (scroller as HTMLElement).getBoundingClientRect()
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, h)
  // Sem layout (jsdom, elemento recém-montado): usa a janela inteira.
  return bottom - top > 0 ? { top, bottom } : { top: 0, bottom: h }
}

export function useVirtualRows<T>(options: VirtualOptions<T>): VirtualResult {
  const { items, keyOf, estimate, gap = 0, overscan = 800, perRow = 1 } = options
  const enabled = options.enabled ?? items.length > VIRTUAL_THRESHOLD
  const containerRef = useRef<HTMLDivElement | null>(null)
  const heights = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const rowCount = Math.ceil(items.length / Math.max(1, perRow))
  const initialRows = Math.min(rowCount, Math.ceil(((typeof window !== 'undefined' ? window.innerHeight : 800) + overscan) / Math.max(1, estimate + gap)))
  const [range, setRange] = useState({ start: 0, end: initialRows })

  // Alturas por linha (na grade, a maior altura dos itens da linha).
  const offsets = useMemo(() => {
    if (!enabled) return new Float64Array(1)
    const map = heights.current
    return buildOffsets(rowCount, (row) => {
      let h = 0
      for (let i = row * perRow, last = Math.min(items.length, i + perRow); i < last; i++) h = Math.max(h, map.get(keyOf(items[i])) ?? estimate)
      return h + gap
    })
    // `version` invalida quando chegam novas medições.
  }, [enabled, items, rowCount, perRow, estimate, gap, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets

  const compute = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const scroller = scrollParentOf(el)
    const view = viewport(scroller)
    const top = el.getBoundingClientRect().top
    const next = findRange(offsetsRef.current, view.top - top - overscan, view.bottom - top + overscan)
    setRange((cur) => (cur.start === next.start && cur.end === next.end ? cur : next))
  }, [overscan])

  // Recalcula depois de cada mudança de dados/medidas e acompanha rolagem e redimensionamento.
  useLayoutEffect(() => { if (enabled) compute() }, [enabled, offsets, compute])
  useLayoutEffect(() => {
    if (!enabled) return
    const scroller = scrollParentOf(containerRef.current)
    let frame = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; compute() }) }
    // Captura no documento: qualquer rolagem de ancestral (inclusive se o contêiner mudar) recalcula.
    document.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver !== 'undefined' && scroller !== window ? new ResizeObserver(schedule) : null
    ro?.observe(scroller as HTMLElement)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [enabled, compute])

  // Medição: um ResizeObserver compartilhado; alterações em lote viram um único re-render.
  const observer = useMemo(() => {
    if (typeof ResizeObserver === 'undefined') return null
    return new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const key = el.dataset.vkey
        if (!key || !el.isConnected) continue
        const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height)
        if (h > 0 && heights.current.get(key) !== h) { heights.current.set(key, h); changed = true }
      }
      if (changed) setVersion((v) => v + 1)
    })
  }, [])
  useLayoutEffect(() => () => observer?.disconnect(), [observer])

  const measure = useCallback((el: HTMLElement | null) => {
    if (!el || !observer || !enabled) return
    observer.observe(el)
    return () => observer.unobserve(el)
  }, [observer, enabled]) as (el: HTMLElement | null) => void

  const scrollToIndex = useCallback((index: number) => {
    const el = containerRef.current
    if (!el || !enabled || index < 0 || index >= items.length) return false
    const scroller = scrollParentOf(el)
    const view = viewport(scroller), top = el.getBoundingClientRect().top
    const delta = scrollDeltaFor(offsetsRef.current, Math.floor(index / Math.max(1, perRow)), view.top - top, view.bottom - top)
    if (delta === null) return false
    if (scroller === window) window.scrollBy(0, delta)
    else (scroller as HTMLElement).scrollTop += delta
    compute()
    return true
  }, [enabled, items.length, perRow, compute])

  if (!enabled) return { containerRef, enabled, start: 0, end: items.length, padTop: 0, padBottom: 0, measure, scrollToIndex }
  const startRow = Math.min(range.start, Math.max(0, rowCount - 1)), endRow = Math.min(Math.max(range.end, startRow + 1), rowCount)
  return {
    containerRef, enabled,
    start: startRow * perRow, end: Math.min(items.length, endRow * perRow),
    padTop: offsets[startRow] ?? 0, padBottom: Math.max(0, (offsets[rowCount] ?? 0) - (offsets[endRow] ?? 0)),
    measure, scrollToIndex,
  }
}

/** Garante que o item com `key` (ex.: linha recém-criada em edição) esteja renderizado e visível. */
export function useRevealKey<T>(virtual: VirtualResult, items: readonly T[], keyOf: (item: T) => string, key: string | null | undefined) {
  useLayoutEffect(() => {
    if (!key || !virtual.enabled) return
    const index = items.findIndex((item) => keyOf(item) === key)
    if (index >= 0 && (index < virtual.start || index >= virtual.end)) virtual.scrollToIndex(index)
  }, [key, items, virtual.enabled, virtual.start, virtual.end]) // eslint-disable-line react-hooks/exhaustive-deps
}
