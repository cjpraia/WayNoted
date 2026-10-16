// Popover simples ancorado a um elemento, renderizado em portal com posição fixa.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
  width?: number
  offset?: number
}

export function Popover({ anchor, onClose, children, align = 'start', className = '', width, offset = 6 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const el = ref.current!
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = r.bottom + offset
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - offset - h)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, align, offset, width, className])

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchor?.contains(t)) return // o próprio botão alterna o popover
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={`pg-popover ${className}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  )
}
