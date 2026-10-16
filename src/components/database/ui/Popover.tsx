// Popover/menus dos bancos de dados: portal no <body>, posicionado sem sair da janela,
// fecha com Esc (só o do topo da pilha) e com clique fora. Acompanha o elemento âncora ao rolar.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import './ui.css'

export type DbAnchor = Element | DOMRect | { x: number; y: number }
export type DbPlacement = 'bottom-start' | 'bottom-end' | 'right-start' | 'cover'

// Pilha de popovers abertos (ordem de abertura). Um submenu fica depois do popover pai.
const stack: { id: symbol; el: () => HTMLElement | null }[] = []
const MARGIN = 8

function rectOf(a: DbAnchor): DOMRect | { x: number; y: number } {
  return a instanceof Element ? a.getBoundingClientRect() : a
}
function isRect(a: DOMRect | { x: number; y: number }): a is DOMRect {
  return 'width' in a
}

/** Verdadeiro se há algum popover de banco aberto (útil para atalhos globais). */
export function popoverOpen() {
  return stack.length > 0
}

export function DbPopover(props: {
  anchor: DbAnchor
  placement?: DbPlacement
  onClose: () => void
  /** Elemento cujo clique não conta como "clique fora". */
  ignore?: Element | null
  className?: string
  style?: CSSProperties
  /** Largura mínima = largura da âncora (útil para editores sobre células). */
  matchWidth?: boolean
  offset?: number
  label?: string
  /** Esc chama isto em vez de `onClose` (ex.: painel em pilha volta um nível). */
  onEscape?: () => void
  children: ReactNode
}) {
  const { anchor, placement = 'bottom-start', onClose, ignore, offset = 4, matchWidth } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number; maxHeight?: number } | null>(null)
  // Lado escolhido na primeira medição (abaixo/acima da âncora): mantido enquanto o popover
  // cresce (ex.: "Incluir hora"), para não pular de lado.
  const sideRef = useRef<'below' | 'above' | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const escapeRef = useRef(props.onEscape)
  escapeRef.current = props.onEscape
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  const place = () => {
    const el = ref.current
    if (!el) return
    const a = rectOf(anchor)
    const w = el.offsetWidth
    // Altura natural (sem o limite de max-height aplicado abaixo).
    const h = el.scrollHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    let minWidth: number | undefined
    let maxHeight: number | undefined
    if (!isRect(a)) {
      left = a.x
      top = a.y
      if (left + w > vw - MARGIN) left = a.x - w
      if (top + h > vh - MARGIN) top = a.y - h
    } else if (placement === 'cover') {
      left = a.left
      top = a.top
      minWidth = a.width
      if (top + h > vh - MARGIN) top = Math.max(MARGIN, a.bottom - h)
    } else if (placement === 'right-start') {
      // Submenu: alinha pelas bordas do popover pai (se houver), nunca por cima dele.
      const parent = anchor instanceof Element ? anchor.closest('.dbv-popover')?.getBoundingClientRect() : undefined
      const right = parent ? parent.right : a.right
      const leftEdge = parent ? parent.left : a.left
      const gap = parent ? 2 : offset
      left = right + gap
      top = a.top - (parent ? 6 : 0)
      if (left + w > vw - MARGIN && leftEdge - gap - w >= MARGIN) left = leftEdge - gap - w
      else if (left + w > vw - MARGIN) left = Math.max(MARGIN, vw - MARGIN - w)
    } else {
      // Logo abaixo da âncora, alinhado à esquerda (ou à direita em bottom-end); acima só se não couber.
      left = placement === 'bottom-end' ? a.right - w : a.left
      if (matchWidth) minWidth = a.width
      const below = vh - MARGIN - (a.bottom + offset)
      const above = a.top - offset - MARGIN
      if (!sideRef.current) sideRef.current = h <= below || below >= above ? 'below' : 'above'
      const side = sideRef.current
      const room = side === 'below' ? below : above
      if (h > room) maxHeight = Math.max(120, room)
      const height = Math.min(h, maxHeight ?? h)
      top = side === 'below' ? a.bottom + offset : a.top - offset - height
    }
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN))
    top = Math.max(MARGIN, Math.min(top, vh - Math.min(h, maxHeight ?? h) - MARGIN))
    setPos((p) => (p && p.left === left && p.top === top && p.minWidth === minWidth && p.maxHeight === maxHeight ? p : { left, top, minWidth, maxHeight }))
  }

  useLayoutEffect(place)
  const placeRef = useRef(place)
  placeRef.current = place

  useEffect(() => {
    const id = Symbol('db-popover')
    stack.push({ id, el: () => ref.current })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1]?.id === id) {
        e.preventDefault()
        e.stopPropagation()
        ;(escapeRef.current ?? closeRef.current)()
      }
    }
    // Clique fora fecha este popover e todos os submenus dele; clicar dentro de um submenu
    // (aberto depois) não fecha o pai.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (ignore && ignore.contains(t)) return
      const at = stack.findIndex((entry) => entry.id === id)
      if (stack.slice(at + 1).some((entry) => entry.el()?.contains(t))) return
      closeRef.current()
    }
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return
      if (anchorRef.current instanceof Element) placeRef.current()
    }
    const onResize = () => placeRef.current()
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      stack.splice(stack.findIndex((entry) => entry.id === id), 1)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [ignore])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={props.label}
      className={`dbv-popover ${props.className ?? ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        ...props.style,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        minWidth: pos?.minWidth ?? props.style?.minWidth,
        maxHeight: pos?.maxHeight ?? props.style?.maxHeight,
        opacity: pos ? 1 : 0,
        pointerEvents: pos ? undefined : 'none',
      }}
    >
      {props.children}
    </div>,
    document.body,
  )
}

/** Navegação por setas entre `.dbv-menu-item` dentro de um contêiner. */
export function menuKeyNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.dbv-menu-item:not(:disabled)'))
  if (!items.length) return
  e.preventDefault()
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1
  items[next].focus()
}

export function Menu({ children, width, className }: { children: ReactNode; width?: number; className?: string }) {
  return (
    <div role="menu" className={`dbv-menu ${className ?? ''}`} style={{ width }} onKeyDown={menuKeyNav}>
      {children}
    </div>
  )
}

export function MenuItem(props: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  active?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      className={`dbv-menu-item${props.danger ? ' dbv-menu-item--danger' : ''}${props.active ? ' dbv-menu-item--active' : ''}`}
      onClick={props.onClick}
    >
      {props.icon && <span className="dbv-menu-icon">{props.icon}</span>}
      <span className="dbv-menu-label">{props.label}</span>
      {props.hint && <span className="dbv-menu-hint">{props.hint}</span>}
      {props.checked && <Check size={16} className="dbv-menu-check" />}
    </button>
  )
}

export function MenuSep() {
  return <div className="dbv-menu-sep" role="separator" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="dbv-menu-section">{children}</div>
}

/** Botão que abre uma lista de escolhas num popover. */
export function Dropdown<T extends string>(props: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  className?: string
  disabled?: boolean
}) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const current = props.options.find((o) => o.value === props.value)
  return (
    <>
      <button
        type="button"
        ref={setEl}
        disabled={props.disabled}
        className={`dbv-dropdown ${props.className ?? ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current?.icon && <span className="dbv-dropdown-icon">{current.icon}</span>}
        <span className="dbv-dropdown-label">{current?.label ?? '—'}</span>
        <ChevronDown size={12} className="dbv-dropdown-caret" />
      </button>
      {open && el && (
        <DbPopover anchor={el} ignore={el} onClose={() => setOpen(false)}>
          <Menu>
            {props.options.map((o) => (
              <MenuItem
                key={o.value}
                icon={o.icon}
                label={o.label}
                checked={o.value === props.value}
                onClick={() => {
                  props.onChange(o.value)
                  setOpen(false)
                }}
              />
            ))}
          </Menu>
        </DbPopover>
      )}
    </>
  )
}
