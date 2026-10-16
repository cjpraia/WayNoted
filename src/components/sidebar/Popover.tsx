import { t, getLocale } from '../../i18n'
// Popover genérico da barra lateral: portal no <body>, posicionado sem sair da janela,
// fecha com Esc (só o do topo da pilha) e com clique fora.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type Anchor = DOMRect | { x: number; y: number }
export type Placement = 'bottom-start' | 'right-start' | 'right-end' | 'point'

const stack: symbol[] = []
const MARGIN = 8

function isRect(a: Anchor): a is DOMRect {
  return 'width' in a
}

export function Popover(props: {
  anchor: Anchor
  placement?: Placement
  onClose: () => void
  /** Elemento cujo clique não conta como "clique fora" (o próprio gatilho). */
  ignore?: Element | null
  className?: string
  style?: CSSProperties
  offset?: number
  label?: string
  children: ReactNode
}) {
  const { anchor, placement = 'bottom-start', onClose, ignore, offset = 4 } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (!isRect(anchor)) {
      left = anchor.x
      top = anchor.y
      if (left + w > vw - MARGIN) left = anchor.x - w
      if (top + h > vh - MARGIN) top = anchor.y - h
    } else if (placement === 'bottom-start') {
      left = anchor.left
      top = anchor.bottom + offset
      if (top + h > vh - MARGIN) top = anchor.top - offset - h
    } else if (placement === 'right-end') {
      left = anchor.right + offset
      top = anchor.bottom - h
      if (left + w > vw - MARGIN) left = anchor.left - offset - w
    } else {
      left = anchor.right + offset
      top = anchor.top
      if (left + w > vw - MARGIN) left = anchor.left - offset - w
    }
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN))
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))
    setPos({ left, top })
  }, [anchor, placement, offset])

  useEffect(() => {
    const id = Symbol('popover')
    stack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (stack[stack.length - 1] !== id) return
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (ignore && ignore.contains(t)) return
      closeRef.current()
    }
    const onResize = () => closeRef.current()
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      stack.splice(stack.indexOf(id), 1)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [ignore])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={props.label}
      className={`sb-popover ${props.className ?? ''}`}
      style={{ ...props.style, left: pos?.left ?? -9999, top: pos?.top ?? -9999, opacity: pos ? undefined : 0 }}
    >
      {props.children}
    </div>,
    document.body,
  )
}

/** Navegação por setas entre `.sb-menu-item` dentro de um menu. */
export function menuKeyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.sb-menu-item:not(:disabled)'))
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1
  items[next].focus()
}

export function MenuItem(props: {
  icon?: ReactNode
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" role="menuitem" disabled={props.disabled} className={`sb-menu-item${props.danger ? ' sb-menu-item--danger' : ''}`} onClick={props.onClick}>
      {props.icon && <span className="sb-menu-icon">{props.icon}</span>}
      <span className="sb-menu-label">{props.label}</span>
      {props.hint && <span className="sb-menu-hint">{props.hint}</span>}
    </button>
  )
}
