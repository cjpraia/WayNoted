// Reordenar campos arrastando (alça no hover, indicador de soltar) ou pelo teclado (⌥↑/⌥↓ na alça). Usado nos
// campos da página (linhas de banco e campos de tipo) e no editor de campos do tipo. docs/USAGE.md
import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { useI18n } from '../../i18n'
import { showToast } from '../ui/toastQueue'

type Drop = { id: string; after: boolean } | null

/** `onMove(id, targetId, after)` para o arrastar; `onStep(id, delta)` para o teclado. `canMove(id)` limita quem tem alça. */
export function useReorder(onMove: (id: string, targetId: string, after: boolean) => void, onStep: (id: string, delta: -1 | 1) => void, options: { enabled?: boolean; canMove?: (id: string) => boolean; canDrop?: (id: string, targetId: string) => boolean } = {}) {
  const { t } = useI18n()
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const enabled = options.enabled !== false
  const movable = (id: string) => enabled && (options.canMove?.(id) ?? true)
  const end = () => { setDragId(null); setDrop(null) }
  /** Props da linha inteira (alvo de soltar). */
  const row = (id: string) => ({
    'data-reorder': 'row',
    'data-dragging': dragId === id ? 'true' : undefined,
    'data-drop': drop?.id === id ? (drop.after ? 'after' : 'before') : undefined,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragId || dragId === id || (options.canDrop && !options.canDrop(dragId, id))) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const after = e.clientY > rect.top + rect.height / 2
      if (drop?.id !== id || drop.after !== after) setDrop({ id, after })
    },
    onDrop: (e: DragEvent<HTMLElement>) => { if (!dragId || !drop) return; e.preventDefault(); const move = { from: dragId, ...drop }; end(); onMove(move.from, move.id, move.after) },
  })
  /** A alça: botão arrastável e acessível por teclado. */
  const grip = (id: string, label: string) => {
    if (!movable(id)) return <span className="ot-grip ot-grip--off" aria-hidden />
    return <button type="button" className="ot-grip" draggable aria-label={t('Reordenar {name}: arraste, ou use ⌥↑ e ⌥↓', 'Reorder {name}: drag, or use ⌥↑ and ⌥↓', { name: label })} title={t('Arraste para reordenar · ⌥↑ ⌥↓', 'Drag to reorder · ⌥↑ ⌥↓')}
      onDragStart={(e) => {
        setDragId(id)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        const holder = e.currentTarget.closest<HTMLElement>('[data-reorder="row"]')
        if (holder) e.dataTransfer.setDragImage(holder, 12, 12)
      }}
      onDragEnd={end}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault(); e.stopPropagation()
        onStep(id, e.key === 'ArrowUp' ? -1 : 1)
        const button = e.currentTarget
        requestAnimationFrame(() => { if (button.isConnected) button.focus() })
      }}><GripVertical size={14} aria-hidden /></button>
  }
  return { row, grip, dragId }
}

// ⌘Z logo depois de reordenar campos de um banco (o desfazer de bancos só ouve ⌘Z dentro da tabela).
let armed: { undo: () => void; timer: ReturnType<typeof setTimeout> } | null = null
function onKey(e: globalThis.KeyboardEvent) {
  if (!armed || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.ProseMirror, .bn-editor'))) return
  // Captura: o desfazer dos tipos (outro ouvinte de ⌘Z) não pode levar o passo errado.
  e.preventDefault(); e.stopImmediatePropagation()
  const { undo } = armed
  disarm()
  undo()
}
function disarm() { if (armed) clearTimeout(armed.timer); armed = null; window.removeEventListener('keydown', onKey, true) }
/** Mostra "Ordem alterada — Desfazer" e arma ⌘Z por 20 s. */
export function announceReorder(message: string, undo: () => void, label: string) {
  disarm()
  armed = { undo, timer: setTimeout(disarm, 20_000) }
  window.addEventListener('keydown', onKey, true)
  showToast({ message, actionLabel: label, onAction: () => { disarm(); undo() } })
}
