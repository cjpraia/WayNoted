// Visualização Lista: uma linha por página, propriedades alinhadas à direita.
import { Fragment, useRef } from 'react'
import { Plus } from 'lucide-react'
import { actions, getState } from '../../../store'
import { getValue, type ViewProps } from '../lib'
import { matchingRowColor } from '../colorRules'
import { t } from '../../../i18n'
import { usePointerDrag } from './shared/useDrag'
import { moveInGrid, useCardNav } from './shared/cardNav'
import {
  InlineTitleInput,
  PropValueView,
  RowIcon,
  RowTitle,
  RenameButton,
  useCardPropEditor,
  indexFromY,
  insertionIndex,
  shownProps,
  useRowCreation,
  useRowMenu,
} from './shared/rows'
import { scrollParentOf, useRevealKey, useVirtualRows } from '../virtual/useVirtualRows'
import type { Page } from '../../../types'
import './ListView.css'

export function ListView({ db, schema, view, rows, visibleProps, readOnly, onOpenRow, creationDefaults, selection }: ViewProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const { openMenu, menuNode, menuRowId } = useRowMenu(readOnly, onOpenRow)
  const { editingId, create, stopEditing, rename } = useRowCreation(db, schema, view, creationDefaults)
  const { propHandlers, editorNode } = useCardPropEditor(db.id, readOnly, onOpenRow)
  const canReorder = !readOnly && view.sorts.length === 0
  // Virtualização: só as linhas visíveis vão para o DOM; `skipped` converte índices locais em globais.
  const virtual = useVirtualRows({ items: rows, keyOf: rowKey, estimate: 32 })
  const nav = useCardNav({
    root: () => listRef.current,
    firstId: rows[0]?.id,
    neighbor: (id, key) => rows[moveInGrid(rows.length, 1, rows.findIndex((r) => r.id === id), key)]?.id ?? null,
    onOpen: onOpenRow,
    onRename: readOnly ? undefined : (id) => { if (!getState().pages[id]?.locked) rename(id) },
    onToggle: selection && !readOnly ? (id) => selection.toggle(id) : undefined,
  })
  useRevealKey(virtual, rows, rowKey, editingId ?? nav.revealId)
  const skipped = useRef(0)

  const { drag, onPointerDown } = usePointerDrag<number>({
    disabled: !canReorder,
    // Rolagem automática perto das bordas: leva o arraste até linhas fora da janela virtual.
    scrollers: () => {
      const scroller = scrollParentOf(listRef.current)
      return [scroller instanceof HTMLElement ? scroller : (document.scrollingElement as HTMLElement | null)]
    },
    resolve: (x, y, id) => {
      const list = listRef.current
      if (!list) return null
      const r = list.getBoundingClientRect()
      if (x < r.left - 60 || x > r.right + 60 || y < r.top - 40 || y > r.bottom + 40) return null
      const items = [...list.querySelectorAll<HTMLElement>('[data-row-id]')].filter((el) => el.dataset.rowId !== id)
      return skipped.current + indexFromY(items, y)
    },
    onDrop: (id, index) => {
      if (getState().pages[id]?.locked) return
      const sourceId = getState().pages[id]?.parentId
      if (!sourceId) return
      const others = rows.filter((r) => r.id !== id)
      const before = others[index]?.id ?? null
      const after = before ? null : (others[others.length - 1]?.id ?? null)
      if ((before && getState().pages[before]?.parentId !== sourceId) || (after && getState().pages[after]?.parentId !== sourceId)) return
      const at = insertionIndex(sourceId, id, before, after)
      if (at !== undefined) actions.movePage(id, sourceId, at)
    },
  })

  let visibleIdx = 0
  for (let i = 0; i < virtual.start; i++) if (rows[i].id !== drag?.id) visibleIdx++
  skipped.current = visibleIdx
  const dropIndex = drag?.target ?? -1

  return (
    <div className={`ls${selection?.size ? ' vw-selecting' : ''}`}>
      <div className="ls-rows" role="list" ref={(el) => { listRef.current = el; virtual.containerRef.current = el }}>
        {virtual.padTop > 0 && <div style={{ height: virtual.padTop }} aria-hidden="true" />}
        {rows.slice(virtual.start, virtual.end).map((row) => {
          let line = false
          if (row.id !== drag?.id) {
            line = visibleIdx === dropIndex
            visibleIdx++
          }
          const editing = editingId === row.id
          const values = shownProps(row, visibleProps)
          return (
            <Fragment key={row.id}>
              {line && <div className="ls-drop-line" />}
              <div
                className={`ls-row${matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!)) ? ` db-rule-${matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!))}` : ''}${drag?.id === row.id ? ' is-dragging' : ''}${menuRowId === row.id ? ' is-active' : ''}${selection?.has(row.id) ? ' is-selected' : ''}`}
                data-row-id={row.id}
                data-vkey={row.id}
                role="listitem"
                {...nav.cardProps(row.id)}
                ref={virtual.measure}
                onPointerDown={(e) => { if (!row.locked) onPointerDown(e, row.id) }}
                onClick={() => !editing && onOpenRow(row.id)}
                onContextMenu={(e) => openMenu(e, row.id)}
              >
                {selection && !readOnly && <input type="checkbox" className="tb-select vw-select" aria-label={t('Selecionar linha', 'Select row')} checked={selection.has(row.id)} onChange={() => {}} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); selection.toggle(row.id, e.shiftKey) }} />}
                <div className="ls-main">
                  <RowIcon page={row} size={16} />
                  {editing ? <InlineTitleInput page={row} onDone={stopEditing} /> : <><RowTitle page={row} /><RenameButton page={row} readOnly={readOnly} onRename={rename} /></>}
                </div>
                {values.length > 0 && (
                  <div className="ls-props">
                    {values.map(({ prop, value }) => (
                      <span key={prop.id} className="ls-prop" title={prop.name} {...propHandlers(row, prop)}>
                        <PropValueView prop={prop} value={value} rowId={row.id} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
        {drag && virtual.end === rows.length && visibleIdx === dropIndex && <div className="ls-drop-line" />}
        {virtual.padBottom > 0 && <div style={{ height: virtual.padBottom }} aria-hidden="true" />}
      </div>
      {rows.length === 0 && readOnly && <div className="ls-empty">{t('Nenhuma página', 'No pages')}</div>}
      {!readOnly && (
        <button type="button" className="ls-new" onClick={() => create()}>
          <Plus size={16} />
          <span>{t('Nova página', 'New page')}</span>
        </button>
      )}
      {menuNode}
      {editorNode}
    </div>
  )
}

const rowKey = (row: Page) => row.id
