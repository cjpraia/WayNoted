// Popover/menu em portal, ancorado a um elemento ou a um ponto (menu de contexto).
// Fecha com Esc e com clique fora. Usado pelas visualizações Quadro/Calendário/Lista/Galeria.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import './shared.css'

export type Anchor = HTMLElement | { x: number; y: number }

interface PopoverProps {
  anchor: Anchor
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
  className?: string
}

export function Popover({ anchor, onClose, children, align = 'start', width, className = '' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r =
        anchor instanceof HTMLElement
          ? anchor.getBoundingClientRect()
          : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
      const w = el.offsetWidth
      const h = el.offsetHeight
      const gap = anchor instanceof HTMLElement ? 4 : 2
      let left = align === 'end' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = r.bottom + gap
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - gap - h)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, align])

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchor instanceof HTMLElement && anchor.contains(t)) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      }
    }
    const onBlur = () => closeRef.current()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('contextmenu', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('contextmenu', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className={`vw-popover ${className}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, opacity: pos ? undefined : 0 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

interface MenuItemProps {
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  danger?: boolean
  checked?: boolean
  hint?: ReactNode
}

export function MenuItem({ icon, label, onClick, danger, checked, hint }: MenuItemProps) {
  return (
    <button type="button" className={`vw-menu-item${danger ? ' vw-menu-danger' : ''}`} onClick={onClick}>
      {icon && <span className="vw-menu-icon">{icon}</span>}
      <span className="vw-menu-label">{label}</span>
      {hint && <span className="vw-menu-hint">{hint}</span>}
      {checked && <Check size={14} className="vw-menu-check" />}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="vw-menu-sep" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="vw-menu-section">{children}</div>
}
