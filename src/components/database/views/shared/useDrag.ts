// Arrastar e soltar por eventos de ponteiro (sem HTML5 DnD): fantasma que segue o cursor,
// alvo resolvido pela visualização a cada movimento, rolagem automática nas bordas e Esc para cancelar.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import './shared.css'

export interface DragState<T> {
  id: string
  target: T | null
}

interface Options<T> {
  disabled?: boolean
  /** Calcula o alvo de soltura sob o ponteiro (ou null se não houver). */
  resolve: (x: number, y: number, id: string) => T | null
  onDrop: (id: string, target: T) => void
  /** Contêineres que rolam automaticamente quando o ponteiro chega perto das bordas. */
  scrollers?: () => (HTMLElement | null | undefined)[]
  /** Chamado no início do arraste com a posição inicial do ponteiro. */
  onStart?: (id: string, x: number, y: number) => void
}

const THRESHOLD = 4
const EDGE = 48

export function usePointerDrag<T>(options: Options<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null)
  const opts = useRef(options)
  opts.current = options
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || opts.current.disabled || e.metaKey || e.ctrlKey) return
    if ((e.target as HTMLElement).closest('input, textarea, button, [data-no-drag]')) return
    const el = e.currentTarget
    const startX = e.clientX
    const startY = e.clientY
    let x = startX
    let y = startY
    let started = false
    let ghost: HTMLElement | null = null
    let rect: DOMRect | null = null
    let lastKey = ''
    let raf = 0

    const update = () => {
      const target = opts.current.resolve(x, y, id)
      const key = JSON.stringify(target)
      if (key !== lastKey) {
        lastKey = key
        setDrag({ id, target })
      }
    }

    const tick = () => {
      let scrolled = false
      for (const sc of opts.current.scrollers?.() ?? []) {
        if (!sc) continue
        // A rolagem do documento usa a janela como área visível (o retângulo do <html> é a página toda).
        const r = sc === document.scrollingElement ? { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth } : sc.getBoundingClientRect()
        if (y < r.top - 20 || y > r.bottom + 20 || x < r.left - 20 || x > r.right + 20) continue
        const speed = (d: number) => Math.ceil(((EDGE - d) / EDGE) * 18)
        if (sc.scrollWidth > sc.clientWidth) {
          if (x < r.left + EDGE && sc.scrollLeft > 0) (sc.scrollLeft -= speed(x - r.left)), (scrolled = true)
          else if (x > r.right - EDGE && sc.scrollLeft < sc.scrollWidth - sc.clientWidth) (sc.scrollLeft += speed(r.right - x)), (scrolled = true)
        }
        if (sc.scrollHeight > sc.clientHeight) {
          if (y < r.top + EDGE && sc.scrollTop > 0) (sc.scrollTop -= speed(y - r.top)), (scrolled = true)
          else if (y > r.bottom - EDGE && sc.scrollTop < sc.scrollHeight - sc.clientHeight) (sc.scrollTop += speed(r.bottom - y)), (scrolled = true)
        }
      }
      if (scrolled) update()
      raf = requestAnimationFrame(tick)
    }

    const start = () => {
      started = true
      rect = el.getBoundingClientRect()
      ghost = el.cloneNode(true) as HTMLElement
      ghost.classList.add('vw-drag-ghost')
      ghost.removeAttribute('data-row-id')
      Object.assign(ghost.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
      })
      document.body.appendChild(ghost)
      document.body.classList.add('vw-dragging')
      window.getSelection()?.removeAllRanges()
      opts.current.onStart?.(id, startX, startY)
      raf = requestAnimationFrame(tick)
    }

    const move = (ev: PointerEvent) => {
      x = ev.clientX
      y = ev.clientY
      if (!started) {
        if (Math.hypot(x - startX, y - startY) < THRESHOLD) return
        start()
      }
      if (ghost) ghost.style.transform = `translate(${x - startX}px, ${y - startY}px) rotate(1.5deg)`
      update()
    }

    const finish = (commit: boolean) => {
      cleanup()
      if (!started) return
      // Engole o clique que o navegador dispara logo após soltar.
      const swallow = (ce: MouseEvent) => {
        ce.stopPropagation()
        ce.preventDefault()
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      const target = commit ? opts.current.resolve(x, y, id) : null
      setDrag(null)
      if (target !== null) opts.current.onDrop(id, target)
    }

    const up = () => finish(true)
    // pointercancel (o sistema assumiu o gesto, a janela perdeu o ponteiro…) nunca solta num alvo.
    const cancel = () => finish(false)
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        finish(false)
      }
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      cancelAnimationFrame(raf)
      ghost?.remove()
      ghost = null
      document.body.classList.remove('vw-dragging')
      cleanupRef.current = null
    }

    cleanupRef.current?.()
    cleanupRef.current = () => {
      cleanup()
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }, [])

  return { drag, onPointerDown }
}
