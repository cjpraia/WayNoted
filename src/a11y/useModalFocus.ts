// Foco de diálogos modais: foco inicial, Tab preso dentro do contêiner e devolução do foco a quem abriu (Esc/fechar).
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'

export function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
}

/** Próximo elemento do ciclo de Tab dentro do contêiner, ou null se o navegador pode seguir normalmente. */
export function trapTarget(items: HTMLElement[], active: Element | null, shift: boolean): HTMLElement | null {
  if (!items.length) return null
  if (shift && (active === items[0] || !active || !items.includes(active as HTMLElement))) return items[items.length - 1]
  if (!shift && (active === items[items.length - 1] || !active || !items.includes(active as HTMLElement))) return items[0]
  return null
}

export function useModalFocus(ref: RefObject<HTMLElement | null>, options: { initial?: () => HTMLElement | null | undefined } = {}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    if (root && !root.contains(document.activeElement)) (options.initial?.() ?? focusableWithin(root)[0] ?? root).focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !root) return
      const target = trapTarget(focusableWithin(root), document.activeElement, event.shiftKey)
      if (target) { event.preventDefault(); target.focus() }
    }
    root?.addEventListener('keydown', onKey)
    return () => { root?.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
