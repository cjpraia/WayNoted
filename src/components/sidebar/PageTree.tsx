import COMPAT from '../../../shared/compatibility.ts'
import { t, getLocale } from '../../i18n'
// Árvore de páginas da barra lateral: linhas, expandir/recolher e arrastar e soltar.
import { createContext, useContext, useRef, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronRight, Ellipsis, Lock, Plus } from 'lucide-react'
import { isLockedPage, lockedAncestor, protectedTitle } from '../../security/pageLock'
import '../../security/security.css'
import { actions, getState, selectors } from '../../store'
import type { Page } from '../../types'
import { PageIcon as LocalPageIcon } from '../page/PageIcon'
import { BlockIcon } from '../ui/BlockIcon'
import { CanvasIcon } from '../canvas/icons'
import type { Anchor } from './Popover'
import { VIRTUAL_THRESHOLD, useVirtualRows } from '../database/virtual/useVirtualRows'
import { clearSelection, selectRange, selectedIds, toggleSelected, useSelection, type SelectionOutcome } from '../../subpages/selection'
import { movePagesTo } from '../../subpages/actions'
import { announceMove } from '../../subpages/bulk'
import { showToast } from '../ui/toastQueue'

export type DropPos = 'before' | 'after' | 'inside'
export type DropTarget = { id: string; pos: DropPos } | { id: null; pos: 'root' }

export interface TreeCtx {
  dragId: string | null
  drop: DropTarget | null
  setDrag: (id: string | null) => void
  setDrop: (t: DropTarget | null) => void
  /** id da página cujo menu está aberto (mantém a linha destacada). */
  menuFor: string | null
  openMenu: (page: Page, anchor: Anchor, rowEl: HTMLElement, trigger: Element | null) => void
  /** Menu de contexto da seleção múltipla (⌘/⇧-clique). */
  openSelectionMenu?: (anchor: Anchor) => void
}

export const TreeContext = createContext<TreeCtx | null>(null)
const DND_TYPE = COMPAT.record027
const INDENT = 10

function useTree() {
  const ctx = useContext(TreeContext)
  if (!ctx) throw new Error('TreeContext ausente')
  return ctx
}

/** true se soltar `dragId` em relação a `targetId` criaria um ciclo ou é inócuo. */
export function invalidTarget(dragId: string, targetId: string) {
  if (dragId === targetId) return true
  return selectors.ancestors(targetId).some((a) => a.id === dragId)
}

/** Páginas arrastadas: a seleção inteira quando o item arrastado faz parte dela, senão só ele. */
export function dragSet(dragId: string): string[] {
  const selected = selectedIds()
  return selected.length > 1 && selected.includes(dragId) ? [...selected] : [dragId]
}

export function applyDrop(dragId: string, t: DropTarget) {
  const ids = dragSet(dragId).filter((id) => t.id === null || !invalidTarget(id, t.id))
  if (!ids.length) return
  const move = (parentId: string | null, index?: number) => announceMove(movePagesTo(ids, parentId, index))
  if (t.pos === 'root') return move(null)
  const target = selectors.page(t.id)
  if (!target) return
  if (t.pos === 'inside') return move(target.id)
  // "Depois" de uma página expandida com filhos = primeiro filho dela (como a linha indica).
  if (t.pos === 'after' && afterMeansFirstChild(target.id, dragId)) return move(target.id, 0)
  const siblings = selectors.children(target.parentId).filter((p) => !ids.includes(p.id))
  const i = siblings.findIndex((p) => p.id === target.id)
  move(target.parentId, t.pos === 'before' ? i : i + 1)
}

const activeRouteId = () => { const route = getState().route; return route.type === 'page' ? route.id : null }

/** Aviso para seleção entre níveis diferentes. */
export function warnLevel(outcome: SelectionOutcome) {
  if (outcome === 'level') showToast({ message: t('Selecione páginas do mesmo nível.', 'Select pages on the same level.'), tone: 'error', duration: 3000 })
}

function afterMeansFirstChild(id: string, dragId: string | null) {
  return !!getState().settings.expanded[id] && selectors.children(id).some((c) => c.id !== dragId)
}

export function PageIcon({ page, size = 18 }: { page: Page; size?: number }) {
  if (page.icon) return <LocalPageIcon value={page.icon} className="sb-emoji" style={{ width: size, height: size }} />
  if (page.canvas) return <CanvasIcon name="canvas" size={size} />
  return <BlockIcon name={page.database ? 'database-full-page' : 'page'} size={size} />
}

type FlatItem = { key: string; page: Page; depth: number; empty: boolean }

/** Linhas visíveis da árvore (expandidas), em ordem; para em `limit` itens. */
export function flattenTree(parentId: string | null, depth: number, expanded: Record<string, boolean>, limit = Infinity): FlatItem[] {
  const out: FlatItem[] = []
  const visit = (pid: string | null, d: number, seen: Set<string>) => {
    for (const page of selectors.childrenShared(pid)) {
      if (out.length >= limit) return
      out.push({ key: page.id, page, depth: d, empty: false })
      if (!expanded[page.id] || seen.has(page.id)) continue
      const children = selectors.childrenShared(page.id)
      if (!children.length) out.push({ key: `${page.id}:empty`, page, depth: d + 1, empty: true })
      else { seen.add(page.id); visit(page.id, d + 1, seen); seen.delete(page.id) }
    }
  }
  visit(parentId, depth, new Set())
  return out
}

export function PageTree(props: { parentId: string | null; depth: number; draggable: boolean }) {
  // Árvores grandes (milhares de páginas visíveis) viram uma lista plana virtualizada.
  const expanded = getState().settings.expanded
  const large = flattenTree(props.parentId, props.depth, expanded, VIRTUAL_THRESHOLD + 1).length > VIRTUAL_THRESHOLD
  return large ? <VirtualPageTree {...props} /> : <SmallPageTree {...props} />
}

function VirtualPageTree(props: { parentId: string | null; depth: number; draggable: boolean }) {
  const { settings, route } = getState()
  const items = flattenTree(props.parentId, props.depth, settings.expanded)
  const virtual = useVirtualRows({ items, keyOf: flatKey, estimate: 30, enabled: true })
  return (
    <div role="group" ref={virtual.containerRef}>
      {virtual.padTop > 0 && <div style={{ height: virtual.padTop }} aria-hidden="true" />}
      {items.slice(virtual.start, virtual.end).map((item) => (
        <div key={item.key} data-vkey={item.key} ref={virtual.measure}>
          {item.empty ? (
            <div className="sb-empty-child" style={{ paddingLeft: 8 + item.depth * INDENT + 6 }}>{t("Nenhuma página dentro", "No pages inside")}</div>
          ) : (
            <PageRow page={item.page} depth={item.depth} draggable={props.draggable} expanded={!!settings.expanded[item.page.id]} active={route.type === 'page' && route.id === item.page.id} />
          )}
        </div>
      ))}
      {virtual.padBottom > 0 && <div style={{ height: virtual.padBottom }} aria-hidden="true" />}
    </div>
  )
}

const flatKey = (item: FlatItem) => item.key

function SmallPageTree(props: { parentId: string | null; depth: number; draggable: boolean }) {
  const pages = selectors.childrenShared(props.parentId)
  return (
    <>
      {pages.map((p) => (
        <PageNode key={p.id} page={p} depth={props.depth} draggable={props.draggable} />
      ))}
    </>
  )
}

export function PageNode({ page, depth, draggable }: { page: Page; depth: number; draggable: boolean }) {
  const { settings, route } = getState()
  const expanded = !!settings.expanded[page.id]
  const children = expanded ? selectors.children(page.id) : []
  return (
    <div role="group">
      <PageRow page={page} depth={depth} draggable={draggable} expanded={expanded} active={route.type === 'page' && route.id === page.id} />
      {expanded &&
        (children.length ? (
          <PageTree parentId={page.id} depth={depth + 1} draggable={draggable} />
        ) : (
          <div className="sb-empty-child" style={{ paddingLeft: 8 + (depth + 1) * INDENT + 6 }}>
            {t("Nenhuma página dentro", "No pages inside")}
          </div>
        ))}
    </div>
  )
}

function PageRow(props: { page: Page; depth: number; draggable: boolean; expanded: boolean; active: boolean }) {
  const { page, depth, draggable, expanded, active } = props
  const tree = useTree()
  const rowRef = useRef<HTMLDivElement>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const title = protectedTitle(page, t("Página protegida", "Protected page")) ?? (page.title.trim() || (page.database ? t("Sem título", "Untitled") : t("Nova página", "New page")))

  const canDrag = draggable
  const dropHere = canDrag && tree.drop && tree.drop.id === page.id ? tree.drop.pos : null
  const { ids: selection } = useSelection()
  const selected = selection.includes(page.id)
  const isDatabase = !!page.database && !page.database.linkedSourceId
  const dragged = tree.dragId ? selectors.page(tree.dragId) : undefined
  // Soltar sobre um banco adiciona uma linha (mapeando propriedades): indicador próprio, diferente de "mover para dentro".
  const dropAsRow = dropHere === 'inside' && isDatabase && !!dragged && !dragged.database && dragged.parentId !== page.id

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DND_TYPE, page.id)
    e.dataTransfer.setData('text/plain', page.id)
    tree.setDrag(page.id)
  }
  const clearTimer = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current)
    expandTimer.current = null
  }
  const onDragOver = (e: DragEvent) => {
    if (!tree.dragId) return
    e.stopPropagation()
    if (invalidTarget(tree.dragId, page.id)) {
      e.dataTransfer.dropEffect = 'none'
      clearTimer()
      if (tree.drop) tree.setDrop(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const pos: DropPos = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'
    if (pos === 'inside' && !expanded && !expandTimer.current) {
      expandTimer.current = setTimeout(() => {
        expandTimer.current = null
        actions.toggleExpanded(page.id, true)
      }, 700)
    } else if (pos !== 'inside') clearTimer()
    if (!tree.drop || tree.drop.id !== page.id || tree.drop.pos !== pos) tree.setDrop({ id: page.id, pos })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    clearTimer()
    if (tree.dragId && tree.drop) applyDrop(tree.dragId, tree.drop)
    tree.setDrag(null)
    tree.setDrop(null)
  }

  const openMenuAt = (anchor: Anchor, trigger: Element | null) => {
    if (rowRef.current) tree.openMenu(page, anchor, rowRef.current, trigger)
  }
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    if (selected && selection.length > 1 && tree.openSelectionMenu) return tree.openSelectionMenu({ x: e.clientX, y: e.clientY })
    if (selection.length) clearSelection()
    openMenuAt({ x: e.clientX, y: e.clientY }, null)
  }
  const onRowClick = (e: ReactMouseEvent) => {
    if (e.shiftKey) { warnLevel(selectRange(page.id, active ? page.id : activeRouteId())); return }
    if (e.metaKey || e.ctrlKey) { warnLevel(toggleSelected(page.id)); return }
    if (selection.length) clearSelection()
    actions.openPage(page.id)
  }

  const cls = [
    'sb-row',
    'sb-page-row',
    active && 'sb-row--active',
    tree.menuFor === page.id && 'sb-row--menu',
    tree.dragId === page.id && 'sb-row--dragging',
    selected && 'sb-row--selected',
    dropHere === 'inside' && !dropAsRow && 'sb-row--drop-inside',
    dropAsRow && 'sb-row--drop-row',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={rowRef}
      className={cls}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expanded}
      aria-selected={active || selected}
      aria-label={title}
      data-page-id={page.id}
      tabIndex={0}
      style={{ paddingLeft: 8 + depth * INDENT }}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDragLeave={canDrag ? clearTimer : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={() => {
        clearTimer()
        tree.setDrag(null)
        tree.setDrop(null)
      }}
      onClick={onRowClick}
      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); actions.openInNewTab({ type: 'page', id: page.id }) } }}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === ' ') { e.preventDefault(); warnLevel(toggleSelected(page.id)) }
        else if (e.key === 'Escape' && selection.length) { e.preventDefault(); clearSelection() }
        else if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault()
          const rows = Array.from(document.querySelectorAll<HTMLElement>('.sb .sb-page-row'))
          const next = rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]
          if (!next) return
          if (!selection.length) toggleSelected(page.id)
          next.focus()
          if (next.dataset.pageId) warnLevel(selectRange(next.dataset.pageId))
        }
        else if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) actions.openInNewTab({ type: 'page', id: page.id }); else actions.openPage(page.id) }
        else if (e.key === 'ArrowRight' && !expanded) actions.toggleExpanded(page.id, true)
        else if (e.key === 'ArrowLeft' && expanded) actions.toggleExpanded(page.id, false)
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const rows = Array.from(document.querySelectorAll<HTMLElement>('.sb .sb-page-row'))
          const i = rows.indexOf(e.currentTarget)
          rows[e.key === 'ArrowDown' ? i + 1 : i - 1]?.focus()
        }
      }}
    >
      {dropAsRow && <span className="sb-drop-hint" aria-hidden>{t("Adicionar como linha de {name}", "Add as a row of {name}", { name: page.title.trim() || t("Sem título", "Untitled") })}</span>}
      {dropHere === 'before' && <div className="sb-drop-line sb-drop-line--before" style={{ left: 8 + depth * INDENT }} />}
      {dropHere === 'after' && (
        <div
          className="sb-drop-line sb-drop-line--after"
          style={{ left: 8 + (afterMeansFirstChild(page.id, tree.dragId) ? depth + 1 : depth) * INDENT }}
        />
      )}
      <button
        type="button"
        className="sb-row-icon sb-toggle"
        aria-label={expanded ? t("Recolher", "Collapse") : t("Expandir", "Expand")}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          actions.toggleExpanded(page.id)
        }}
      >
        <span className="sb-toggle-page">
          <PageIcon page={page} />
        </span>
        <span className="sb-toggle-chevron">
          <ChevronRight size={16} strokeWidth={1.8} className={expanded ? 'sb-chevron--open' : undefined} />
        </span>
      </button>
      <span className="sb-row-title">{title}{isLockedPage(page) && <span className="sec-lock-icon" aria-label={t("Protegida por senha", "Password protected")}><Lock size={12} strokeWidth={1.8} /></span>}</span>
      <span className="sb-row-actions">
        <button
          type="button"
          className="sb-mini-btn"
          aria-label={t("Excluir, duplicar e mais…", "Delete, duplicate, and more…")}
          data-tip={t("Excluir, duplicar e mais…", "Delete, duplicate, and more…")}
          onClick={(e) => {
            e.stopPropagation()
            openMenuAt(e.currentTarget.getBoundingClientRect(), e.currentTarget)
          }}
        >
          <Ellipsis size={16} strokeWidth={1.8} />
        </button>
        {!lockedAncestor(getState().pages, page.id) && <button
          type="button"
          className="sb-mini-btn"
          aria-label={t("Adicionar uma página dentro", "Add a subpage")}
          disabled={page.locked && !page.database}
          data-tip={t("Adicionar uma página dentro", "Add a subpage")}
          onClick={(e) => {
            e.stopPropagation()
            actions.openPage(actions.createPage(page.id))
          }}
        >
          <Plus size={16} strokeWidth={1.7} />
        </button>}
      </span>
    </div>
  )
}

export { DND_TYPE, INDENT }
