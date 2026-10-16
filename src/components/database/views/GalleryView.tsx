// Visualização Galeria: cartões em grade com prévia (capa ou trecho do conteúdo).
import { useLayoutEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { getValue, type ViewProps } from '../lib'
import { matchingRowColor } from '../colorRules'
import { t } from '../../../i18n'
import { InlineTitleInput, PropValueView, RenameButton, RowIcon, RowTitle, coverCss, shownProps, useCardPropEditor, useRowCreation, useRowMenu } from './shared/rows'
import { moveInGrid, useCardNav } from './shared/cardNav'
import { getState } from '../../../store'
import { useRevealKey, useVirtualRows } from '../virtual/useVirtualRows'
import type { Page } from '../../../types'
import './GalleryView.css'

export function GalleryView({ db, schema, view, rows, visibleProps, readOnly, onOpenRow, creationDefaults, selection }: ViewProps) {
  const { openMenu, menuNode, menuRowId } = useRowMenu(readOnly, onOpenRow)
  const { editingId, create, stopEditing, rename } = useRowCreation(db, schema, view, creationDefaults)
  const { propHandlers, editorNode } = useCardPropEditor(db.id, readOnly, onOpenRow)
  // Virtualização por linha da grade: o número de colunas vem do próprio CSS (auto-fill).
  const [perRow, setPerRow] = useState(3)
  const virtual = useVirtualRows({ items: rows, keyOf: rowKey, estimate: view.cardPreview === 'none' ? 90 : 230, gap: GAP, perRow })
  const nav = useCardNav({
    root: () => virtual.containerRef.current,
    firstId: rows[0]?.id,
    // O número de colunas vem do CSS (auto-fill): lido na hora da tecla, com a grade já renderizada.
    neighbor: (id, key) => {
      const el = virtual.containerRef.current
      const cols = el ? Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length) : perRow
      return rows[moveInGrid(rows.length, cols, rows.findIndex((r) => r.id === id), key)]?.id ?? null
    },
    onOpen: onOpenRow,
    onRename: readOnly ? undefined : (id) => { if (!getState().pages[id]?.locked) rename(id) },
    onToggle: selection && !readOnly ? (id) => selection.toggle(id) : undefined,
  })
  useRevealKey(virtual, rows, rowKey, editingId ?? nav.revealId)
  useLayoutEffect(() => {
    const el = virtual.containerRef.current
    if (!el || !virtual.enabled) return
    const read = () => setPerRow(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [virtual.enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`gl${selection?.size ? ' vw-selecting' : ''}`} role="list" ref={virtual.containerRef}>
      {virtual.padTop > GAP && <div className="gl-virtual-pad" style={{ gridColumn: '1 / -1', height: virtual.padTop - GAP }} aria-hidden="true" />}
      {rows.slice(virtual.start, virtual.end).map((row) => {
        const editing = editingId === row.id
        const values = shownProps(row, visibleProps)
        const snippet = row.text.trim().slice(0, 400)
        return (
          <div
            key={row.id}
            className={`gl-card${matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!)) ? ` db-rule-${matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!))}` : ''}${menuRowId === row.id ? ' is-active' : ''}${selection?.has(row.id) ? ' is-selected' : ''}`}
            data-row-id={row.id}
            data-vkey={row.id}
            role="listitem"
            {...nav.cardProps(row.id)}
            ref={virtual.measure}
            onClick={() => !editing && onOpenRow(row.id)}
            onContextMenu={(e) => openMenu(e, row.id)}
          >
            {selection && !readOnly && <input type="checkbox" className="tb-select vw-select" aria-label={t('Selecionar linha', 'Select row')} checked={selection.has(row.id)} onChange={() => {}} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); selection.toggle(row.id, e.shiftKey) }} />}
            {view.cardPreview === 'property' ? (
              <div className="gl-preview gl-cover" style={previewImage(row, view.cardPreviewPropertyId) ? { backgroundImage: `url("${previewImage(row, view.cardPreviewPropertyId)!.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
            ) : view.cardPreview !== 'none' && (view.cardPreview === 'content' ? (
              <div className="gl-preview gl-snippet">{snippet && <div className="gl-snippet-text">{snippet}</div>}</div>
            ) : row.cover ? (
              <div className="gl-preview gl-cover" style={coverCss(row.cover, row.coverPosition)} />
            ) : (
              <div className="gl-preview gl-snippet">{snippet && <div className="gl-snippet-text">{snippet}</div>}</div>
            ))}
            <div className="gl-body">
              <div className="gl-title">
                {row.icon && <RowIcon page={row} size={16} />}
                {editing ? <InlineTitleInput page={row} onDone={stopEditing} /> : <><RowTitle page={row} /><RenameButton page={row} readOnly={readOnly} onRename={rename} /></>}
              </div>
              {values.map(({ prop, value }) => (
                <div key={prop.id} className="gl-prop" title={prop.name} {...propHandlers(row, prop)}>
                  <PropValueView prop={prop} value={value} rowId={row.id} />
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {virtual.padBottom > GAP && <div className="gl-virtual-pad" style={{ gridColumn: '1 / -1', height: virtual.padBottom - GAP }} aria-hidden="true" />}
      {!readOnly && (
        <button type="button" className="gl-card gl-new" onClick={() => create()}>
          <Plus size={16} />
          <span>{t('Nova página', 'New page')}</span>
        </button>
      )}
      {menuNode}
      {editorNode}
    </div>
  )
}

/** Primeira imagem de uma propriedade de arquivos (prévia "Propriedades da página"). */
function previewImage(row: Page, propId: string | undefined): string | undefined {
  const value = propId ? row.props?.[propId] : null
  if (!Array.isArray(value)) return undefined
  for (const file of value as unknown[]) {
    const f = file as { mimeType?: unknown; data?: unknown } | null
    if (f && typeof f.mimeType === 'string' && f.mimeType.startsWith('image/') && typeof f.data === 'string') return f.data
  }
  return undefined
}

/** Mesmo valor do `gap` de .gl em GalleryView.css. */
const GAP = 16
const rowKey = (row: Page) => row.id
