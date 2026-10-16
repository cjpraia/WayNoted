import { t, getLocale } from '../../i18n'
// Camada de tooltips: qualquer elemento com `data-tip` (e opcional `data-tip-kbd`)
// dentro da barra lateral (`.sb`) ou de seus popovers ganha uma dica escura após uma pequena espera.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Tip {
  text: string
  kbd: string | null
  rect: DOMRect
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = document
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: HTMLElement | null = null
    const hide = () => {
      if (timer) clearTimeout(timer)
      timer = null
      current = null
      setTip(null)
    }
    const onOver = (e: MouseEvent) => {
      const found = (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? null
      const target = found?.closest('.sb, .sb-popover') ? found : null
      if (target === current) return
      hide()
      if (!target) return
      current = target
      timer = setTimeout(() => {
        if (!current) return
        setTip({ text: current.dataset.tip!, kbd: current.dataset.tipKbd ?? null, rect: current.getBoundingClientRect() })
      }, 450)
    }
    el.addEventListener('mouseover', onOver)
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) hide()
    }
    el.addEventListener('mouseout', onOut)
    el.addEventListener('mousedown', hide, true)
    el.addEventListener('dragstart', hide)
    return () => {
      hide()
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseout', onOut)
      el.removeEventListener('mousedown', hide, true)
      el.removeEventListener('dragstart', hide)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null)
    const w = ref.current.offsetWidth
    const h = ref.current.offsetHeight
    let left = tip.rect.left + tip.rect.width / 2 - w / 2
    let top = tip.rect.bottom + 6
    if (top + h > window.innerHeight - 6) top = tip.rect.top - 6 - h
    left = Math.max(6, Math.min(left, window.innerWidth - w - 6))
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="sb-tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, opacity: pos ? undefined : 0 }}
    >
      <div>{tip.text}</div>
      {tip.kbd && <div className="sb-tooltip-kbd">{tip.kbd}</div>}
    </div>,
    document.body,
  )
}
