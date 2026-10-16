import { useEffect } from 'react'
import { getState, subscribe, useStore } from '../store'
import { getViewState, patchViewState, readSelection, routeStateKey } from './viewState'

/** Chave atual (aba + rota) lida direto da store. */
export function currentViewKey(): string {
  const s = getState()
  return routeStateKey(s.route, s.settings.activeTabId)
}

const scroller = () => document.querySelector<HTMLElement>('.app-content')

/**
 * Flow: guarda a rolagem de `.app-content` (e a seleção do editor) por aba+rota NO MOMENTO da troca
 * (o assinante da store roda antes do React redesenhar) e a restaura ao voltar. Não renderiza nada.
 */
export function ViewStateKeeper() {
  const { route, settings } = useStore()
  const key = routeStateKey(route, settings.activeTabId)

  useEffect(() => {
    let last = currentViewKey()
    const unsubscribe = subscribe(() => {
      const next = currentViewKey()
      if (next === last) return
      patchViewState(last, { scrollTop: scroller()?.scrollTop ?? 0, selection: readSelection() })
      last = next
    })
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    const el = scroller()
    const saved = getViewState(key)?.scrollTop ?? 0
    if (!el || !saved) return
    let frames = 0, raf = 0, user = false
    const mark = () => { user = true }
    // O conteúdo chega aos poucos (documento carregado de forma assíncrona): tenta por até ~60 quadros.
    const restore = () => {
      if (user) return
      el.scrollTop = saved
      if (Math.abs(el.scrollTop - saved) > 1 && frames++ < 60) raf = requestAnimationFrame(restore)
    }
    el.addEventListener('wheel', mark, { passive: true, once: true }); el.addEventListener('pointerdown', mark, { passive: true, once: true })
    raf = requestAnimationFrame(restore)
    return () => { cancelAnimationFrame(raf); el.removeEventListener('wheel', mark); el.removeEventListener('pointerdown', mark) }
  }, [key])
  return null
}
