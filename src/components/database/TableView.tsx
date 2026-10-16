// Visualização em tabela: cabeçalhos com menu, redimensionar/reordenar colunas, edição de células,
// reordenação de linhas, menu de contexto e criação de linhas/propriedades.
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { ArrowUpRight, ChevronDown, Copy, GripVertical, Maximize2, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { actions, getState, selectors } from '../../store'
import type { Page, Property, PropValue } from '../../types'
import { defaultsForNewRow, getValue, isEmptyValue, type ViewProps } from './lib'
import { PropDisplay } from './PropDisplay'
import { PropTypeIcon } from './icons'
import { PropertyEditor, type EditorCloseReason } from './editors/PropertyEditor'
import { openUrl } from './editors/TextEditor'
import { NewPropertyMenu, PropertyMenu } from './PropertyMenu'
import { DbPopover, Menu, MenuItem, MenuSep } from './ui/Popover'
import { addProperty, moveProperty } from './schemaOps'
import { isComputedProperty } from './derived'
import { BulkBar } from './BulkBar'
import { useRowSelection } from './rowSelection'
import { TableFooterCalc } from './TableFooterCalc'
import { PageIcon } from '../page/PageIcon'
import { matchingRowColor } from './colorRules'
import { CellComments } from './CellComments'
import { getLocale, t } from '../../i18n'
import { useVirtualRows } from './virtual/useVirtualRows'
import { keyToAction, moveCell, parseTsv, planPaste, type NavDir, type Overflow } from './tableNav'
import { cellText, emptyValueFor, pasteValue } from './tableClipboard'
import './table.css'

const MIN_W = 80
const DEFAULT_W = 200
const TITLE_W = 280
const COL_MIME = "application/x-workspace-col"
const ROW_MIME = "application/x-workspace-row"

type Cell = { rowId: string; propId: string }

export function colWidth(widths: Record<string, number>, p: Property) {
  return Math.max(MIN_W, widths[p.id] ?? (p.type === 'title' ? TITLE_W : DEFAULT_W))
}

export function TableView(props: ViewProps) {
  const { db, schema, view, rows, visibleProps, readOnly, schemaLocked = false, onOpenRow, creationDefaults } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<Cell | null>(null)
  const [editEl, setEditEl] = useState<Element | null>(null)
  // Célula ativa (foco do teclado) e texto digitado que abriu a edição substituindo o conteúdo.
  const [active, setActive] = useState<Cell | null>(null)
  const [seed, setSeed] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')
  const gridId = useId()
  const gridRef = useRef<HTMLDivElement>(null)
  const pointerDown = useRef(false)
  const programmaticFocus = useRef(false)
  /** Foca a grade sem que o onFocus (Tab) ative a primeira célula por cima da que acabou de ser escolhida. */
  const focusGrid = () => { programmaticFocus.current = true; gridRef.current?.focus({ preventScroll: true }); programmaticFocus.current = false }
  const revealRef = useRef(false)
  const extendAnchor = useRef<string | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastInput = useRef<'key' | 'pointer'>('pointer')
  useEffect(() => {
    if (!editing) return
    const key = () => { lastInput.current = 'key' }, pointer = () => { lastInput.current = 'pointer' }
    document.addEventListener('keydown', key, true)
    document.addEventListener('mousedown', pointer, true)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', pointer, true) }
  }, [editing])
  const [propMenu, setPropMenu] = useState<{ propId: string; autoRename?: boolean } | null>(null)
  const [propMenuEl, setPropMenuEl] = useState<Element | null>(null)
  const [addColEl, setAddColEl] = useState<Element | null>(null)
  const [rowMenu, setRowMenu] = useState<{ rowId: string; at: { x: number; y: number } | Element } | null>(null)
  const [resize, setResize] = useState<{ propId: string; width: number } | null>(null)
  const [colDrop, setColDrop] = useState<{ propId: string; after: boolean } | null>(null)
  const [rowDrop, setRowDrop] = useState<{ rowId: string; after: boolean } | null>(null)
  // Seleção: a do DatabaseView (compartilhada entre grupos) ou uma local (tabela avulsa).
  const rowOrder = useMemo(() => rows.map((r) => r.id), [rows])
  const localSelection = useRowSelection(rowOrder)
  const selection = props.selection ?? localSelection
  const headCheck = useRef<HTMLInputElement>(null)
  useEffect(() => { if (headCheck.current) headCheck.current.indeterminate = selection.state === 'some' }, [selection.state])
  const dragCol = useRef<string | null>(null)
  const dragRow = useRef<string | null>(null)
  const sorted = view.sorts.length > 0
  const titleProp = schema.properties.find((p) => p.type === 'title')!
  const colorFor = (row: Page) => matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!))

  const widthOf = (p: Property) => (resize?.propId === p.id ? resize.width : colWidth(view.widths, p))
  const totalWidth = visibleProps.reduce((s, p) => s + widthOf(p), 0)
  const frozen = Math.min(view.frozenColumns ?? 0, visibleProps.length)
  // Numeração de linhas (Configurações › Layout): coluna fixa de 36 px antes da primeira propriedade.
  const numW = view.rowNumbers ? 36 : 0
  const stickyLeft = (index: number) => index < frozen ? numW + visibleProps.slice(0, index).reduce((sum, prop) => sum + widthOf(prop), 0) : undefined
  // Só as linhas visíveis (+ margem) vão para o DOM; alturas variáveis (quebra de texto) são medidas.
  const virtual = useVirtualRows({ items: rows, keyOf: rowKey, estimate: 34 })

  // Localiza no DOM a célula / cabeçalho em edição (depois de a linha nova aparecer, por exemplo).
  // Com virtualização a linha pode estar fora da faixa renderizada: rola até ela e tenta de novo.
  useLayoutEffect(() => {
    if (!editing) return setEditEl(null)
    const el = rootRef.current?.querySelector(`[data-cell="${editing.rowId}:${editing.propId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      setEditEl(el)
      return
    }
    const index = virtual.enabled ? rows.findIndex((r) => r.id === editing.rowId) : -1
    if (index >= 0 && (index < virtual.start || index >= virtual.end)) virtual.scrollToIndex(index)
    else setEditing(null)
  }, [editing, rows.length, virtual.start, virtual.end]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!propMenu) return setPropMenuEl(null)
    const el = rootRef.current?.querySelector(`[data-col="${propMenu.propId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      setPropMenuEl(el)
    } else setPropMenu(null)
  }, [propMenu, visibleProps.length])

  // ---------- Edição ----------

  const editingRow = editing ? rows.find((r) => r.id === editing.rowId) : undefined
  const editingProp = editing ? schema.properties.find((p) => p.id === editing.propId) : undefined

  const setValue = (row: Page, prop: Property, value: PropValue) => {
    if (prop.type === 'title') actions.updatePage(row.id, { title: typeof value === 'string' ? value : '' })
    else actions.setProp(row.id, prop.id, value)
  }

  const startEdit = (row: Page, prop: Property, seedText?: string) => {
    setActive({ rowId: row.id, propId: prop.id })
    if (readOnly || row.locked || isComputedProperty(prop)) return
    if (prop.type === 'checkbox') return setValue(row, prop, getValue(row, prop) !== true)
    setSeed(seedText)
    setEditing({ rowId: row.id, propId: prop.id })
  }

  const onEditorClose = (reason: EditorCloseReason) => {
    const cur = editing
    setEditing(null)
    setSeed(undefined)
    // Enter/Esc devolvem o foco à grade: a célula continua ativa para as setas. Os popovers fecham com
    // 'outside' tanto no clique fora quanto no Esc: só o fechamento por teclado devolve o foco.
    if (reason === 'enter' || reason === 'escape' || (reason === 'outside' && lastInput.current === 'key')) setTimeout(focusGrid, 0)
    if (!cur || (reason !== 'tab' && reason !== 'shiftTab')) return
    // Tab: próxima célula editável (pula caixas de seleção); muda de linha nas pontas.
    // Aritmética de índices em vez de montar linhas × colunas (50 mil linhas = 500 mil células).
    const editable = visibleProps.filter((p) => p.type !== 'checkbox' && !isComputedProperty(p))
    const r = rows.findIndex((row) => row.id === cur.rowId), c = editable.findIndex((p) => p.id === cur.propId)
    if (r < 0 || c < 0) return
    const i = r * editable.length + c + (reason === 'tab' ? 1 : -1)
    if (i < 0 || i >= rows.length * editable.length) return
    const next: Cell = { rowId: rows[Math.floor(i / editable.length)].id, propId: editable[i % editable.length].id }
    setTimeout(() => { setActive(next); setEditing(next) }, 0)
  }

  const newRow = () => {
    const id = actions.createRow(db.id, defaultsForNewRow(schema, view, {}, creationDefaults))
    setEditing({ rowId: id, propId: titleProp.id })
  }

  /** "+" da alça: insere uma linha logo abaixo (ordem manual); com ordenação ativa, cria no fim. */
  const insertBelow = (row: Page) => {
    const id = actions.createRow(db.id, defaultsForNewRow(schema, view, {}, creationDefaults))
    const parentId = getState().pages[id]?.parentId
    if (!sorted && parentId && parentId === row.parentId) {
      const siblings = selectors.rows(parentId).filter((p) => p.id !== id)
      const at = siblings.findIndex((p) => p.id === row.id)
      if (at >= 0) actions.movePage(id, parentId, at + 1)
    }
    setEditing({ rowId: id, propId: titleProp.id })
  }

  // ---------- Célula ativa e teclado ----------

  const activeRowIdx = active ? rows.findIndex((r) => r.id === active.rowId) : -1
  const activeColIdx = active ? visibleProps.findIndex((p) => p.id === active.propId) : -1
  const activeCell = activeRowIdx >= 0 && activeColIdx >= 0 ? active : null
  const activeDomId = activeCell && activeRowIdx >= virtual.start && activeRowIdx < virtual.end ? cellDomId(gridId, activeCell.rowId, activeCell.propId) : undefined
  const latest = useRef({ rows, visibleProps })
  latest.current = { rows, visibleProps }

  const say = (text: string) => {
    setNote(text)
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(''), 4000)
  }
  useEffect(() => () => clearTimeout(noteTimer.current), [])

  const goTo = (rowIndex: number, colIndex: number) => {
    const target = rows[rowIndex], prop = visibleProps[colIndex]
    if (!target || !prop) return
    revealRef.current = true
    setActive({ rowId: target.id, propId: prop.id })
  }

  // Revela a célula ativa só depois de uma navegação por teclado (rolar com o mouse não puxa de volta).
  useLayoutEffect(() => {
    if (!revealRef.current || !activeCell) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-cell="${activeCell.rowId}:${activeCell.propId}"]`)
    if (el && rootRef.current) { revealRef.current = false; revealCell(el, rootRef.current); return }
    if (virtual.enabled && activeRowIdx >= 0) virtual.scrollToIndex(activeRowIdx)
    else revealRef.current = false
  }, [activeCell?.rowId, activeCell?.propId, virtual.start, virtual.end]) // eslint-disable-line react-hooks/exhaustive-deps

  // Grupos: cada grupo é uma tabela; as setas atravessam as bordas pedindo à vizinha para assumir a célula ativa.
  const handle = useRef<GridHandle>(null!)
  if (!handle.current) handle.current = { el: () => gridRef.current, enter: () => false }
  handle.current.enter = (rowEdge, colEdge) => {
    const { rows: r, visibleProps: p } = latest.current
    if (!r.length || !p.length) return false
    const ri = rowEdge === 'first' ? 0 : r.length - 1
    const ci = colEdge === 'first' ? 0 : colEdge === 'last' ? p.length - 1 : Math.min(colEdge, p.length - 1)
    extendAnchor.current = null
    revealRef.current = true
    setActive({ rowId: r[ri].id, propId: p[ci].id })
    focusGrid()
    return true
  }
  useEffect(() => {
    const h = handle.current
    grids.add(h)
    return () => { grids.delete(h) }
  }, [])

  const crossTable = (o: Overflow): boolean => {
    const list = siblingGrids(handle.current)
    const me = list.indexOf(handle.current)
    if (list.length < 2 || me < 0) return false
    const order = o.absolute ? (o.to === 'prev' ? list : [...list].reverse()) : o.to === 'next' ? list.slice(me + 1) : list.slice(0, me).reverse()
    for (const g of order) {
      if (g === handle.current) { if (o.absolute) return false; continue }
      if (g.enter(o.row, o.col)) { setActive(null); return true }
    }
    return false
  }

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Só quando o foco está na própria grade: campos, editores e popovers (portais) ficam de fora.
    if (e.target !== e.currentTarget || e.defaultPrevented) return
    if (!activeCell) {
      if (rows.length && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'PageDown', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        goTo(e.key === 'ArrowUp' || e.key === 'End' || e.key === 'PageUp' ? rows.length - 1 : 0, 0)
      }
      return
    }
    const row = rows[activeRowIdx], prop = visibleProps[activeColIdx]
    const canEdit = !readOnly && !row.locked && !isComputedProperty(prop)
    const action = keyToAction({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing }, { type: prop.type, canEdit })
    if (!action) return
    switch (action.type) {
      case 'move': {
        const result = moveCell({ row: activeRowIdx, col: activeColIdx }, action.dir as NavDir, rows.length, visibleProps.length, Math.max(1, Math.floor((window.innerHeight || 800) / 34) - 2))
        if (!result) return
        if (result.overflow && !action.extend) {
          if (crossTable(result.overflow)) { e.preventDefault(); return }
          if (action.dir === 'next' || action.dir === 'prev') return // fim da grade: o Tab segue para o próximo controle
        }
        e.preventDefault()
        if (action.extend && selection) {
          const anchor = extendAnchor.current ?? row.id
          extendAnchor.current = anchor
          selection.selectRange(anchor, rows[result.pos.row].id)
        } else extendAnchor.current = null
        goTo(result.pos.row, result.pos.col)
        return
      }
      case 'edit': e.preventDefault(); startEdit(row, prop); return
      case 'seed': e.preventDefault(); startEdit(row, prop, action.text); return
      case 'toggle': e.preventDefault(); setValue(row, prop, getValue(row, prop) !== true); return
      case 'press': {
        e.preventDefault()
        rootRef.current?.querySelector<HTMLElement>(`[data-cell="${row.id}:${prop.id}"] button`)?.click()
        return
      }
      case 'open': e.preventDefault(); onOpenRow(row.id); return
      case 'clear': {
        e.preventDefault()
        const empty = emptyValueFor(prop)
        if (isEmptyValue(getValue(row, prop)) && prop.type !== 'checkbox') return
        actions.trackRowsUndo(t('Limpar célula', 'Clear cell'), [row.id], () => setValue(row, prop, empty))
        return
      }
      case 'escape': return
    }
  }

  const onGridCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !activeCell) return
    const text = cellText(getValue(rows[activeRowIdx], visibleProps[activeColIdx]), visibleProps[activeColIdx], getState().pages)
    // Valores com tabulação, quebra de linha ou aspas vão entre aspas (como no Excel), para colar de volta sem dividir.
    e.clipboardData.setData('text/plain', /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
    e.preventDefault()
  }

  const onGridPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !activeCell || readOnly) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const plan = planPaste(parseTsv(text), { row: activeRowIdx, col: activeColIdx }, rows.length, visibleProps.length)
    const changes: { row: Page; prop: Property; value: PropValue }[] = []
    let skipped = 0
    for (const cell of plan.cells) {
      const row = rows[cell.row], prop = visibleProps[cell.col]
      const value = row.locked ? undefined : pasteValue(cell.text, prop)
      if (value === undefined) { skipped++; continue }
      if (JSON.stringify(value) !== JSON.stringify(getValue(row, prop))) changes.push({ row, prop, value })
    }
    if (changes.length) {
      actions.trackRowsUndo(t('Colar nas células', 'Paste into cells'), [...new Set(changes.map((c) => c.row.id))], () => {
        for (const c of changes) setValue(c.row, c.prop, c.value)
      })
    }
    const parts = [t('{n} células coladas', '{n} cells pasted', { n: changes.length })]
    if (skipped) parts.push(t('{n} ignoradas', '{n} skipped', { n: skipped }))
    if (plan.truncated) parts.push(t('o excedente foi ignorado', 'the excess was ignored'))
    say(parts.join(' · '))
  }

  // ---------- Colunas: redimensionar ----------

  const startResize = (e: React.MouseEvent, p: Property) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidth(view.widths, p)
    let w = startW
    const move = (ev: MouseEvent) => {
      w = Math.max(MIN_W, Math.round(startW + ev.clientX - startX))
      setResize({ propId: p.id, width: w })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('tb-resizing')
      setResize(null)
      if (w !== startW) actions.updateView(db.id, view.id, { widths: { ...view.widths, [p.id]: w } })
    }
    document.body.classList.add('tb-resizing')
    setResize({ propId: p.id, width: startW })
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------- Colunas: arrastar ----------

  const colDragOver = (e: React.DragEvent<HTMLDivElement>, p: Property) => {
    if (!dragCol.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > r.left + r.width / 2
    if (colDrop?.propId !== p.id || colDrop.after !== after) setColDrop({ propId: p.id, after })
  }

  const colDropOn = (e: React.DragEvent) => {
    e.preventDefault()
    if (!schemaLocked && dragCol.current && colDrop) moveProperty(db.id, dragCol.current, colDrop.propId, colDrop.after)
    dragCol.current = null
    setColDrop(null)
  }

  // ---------- Linhas: arrastar ----------

  const rowDragOver = (e: React.DragEvent<HTMLDivElement>, row: Page) => {
    if (!dragRow.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    if (rowDrop?.rowId !== row.id || rowDrop.after !== after) setRowDrop({ rowId: row.id, after })
  }

  const rowDropOn = (e: React.DragEvent) => {
    e.preventDefault()
    const id = dragRow.current
    if (id && !getState().pages[id]?.locked && rowDrop && rowDrop.rowId !== id) {
      const sourceId = getState().pages[id]?.parentId
      if (sourceId && getState().pages[rowDrop.rowId]?.parentId === sourceId) {
        const siblings = selectors.rows(sourceId).filter((p) => p.id !== id)
        const at = siblings.findIndex((p) => p.id === rowDrop.rowId)
        if (at >= 0) actions.movePage(id, sourceId, at + (rowDrop.after ? 1 : 0))
      }
    }
    dragRow.current = null
    setRowDrop(null)
  }

  // Limpa indicadores se o arraste terminar fora.
  useEffect(() => {
    const end = () => {
      dragCol.current = null
      dragRow.current = null
      setColDrop(null)
      setRowDrop(null)
    }
    window.addEventListener('dragend', end)
    return () => window.removeEventListener('dragend', end)
  }, [])

  // Linhas memoizadas: editar uma célula re-renderiza só a linha alterada. Os callbacks ficam num ref
  // (sempre os mais recentes) e o layout das colunas vira uma chave textual comparável.
  const cellLayout = visibleProps.map((p, index) => ({ width: widthOf(p), stickyLeft: stickyLeft(index), wrapped: !!view.wrapAll || (view.wrappedColumns?.includes(p.id) ?? false) }))
  const layoutKey = `${getLocale()}|${cellLayout.map((c) => `${c.width}:${c.stickyLeft ?? ''}:${c.wrapped ? 1 : 0}`).join(',')}`
  // Relação/rollup/fórmula leem outras páginas: nesses casos a linha também re-renderiza quando elas mudam.
  const crossRowToken = visibleProps.some((p) => p.type === 'relation' || p.type === 'rollup' || p.type === 'formula') ? getState().pages : null
  const rowHandlers = useRef<RowHandlers>(null!) as MutableRefObject<RowHandlers>
  rowHandlers.current = {
    startEdit, insertBelow, onOpenRow, rowDragOver, rowDropOn,
    cellClick: (row, prop) => { startEdit(row, prop); focusGrid() },
    openMenu: (rowId, at) => setRowMenu({ rowId, at }),
    toggleSelect: (row, range) => selection.toggle(row.id, range),
    dragStart: (rowId) => { dragRow.current = rowId },
  }

  // Avulsa: a barra fica acima da tabela; dentro do DatabaseView ela é renderizada por ele.
  const selectedRows = !props.selection && selection.size ? rows.filter((r) => selection.has(r.id)) : []
  const selecting = selection.size > 0
  const menuRow = rowMenu ? rows.find((r) => r.id === rowMenu.rowId) : undefined
  const menuProp = propMenu ? schema.properties.find((p) => p.id === propMenu.propId) : undefined

  return (
    <div className={`tb${readOnly ? ' tb--readonly' : ''}${selecting ? ' tb--selecting' : ''}${numW ? ' tb--numbered' : ''}${editing ? ' tb--editing' : ''}`} ref={rootRef} onKeyDown={(e) => {
      const target = e.target as HTMLElement
      const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.classList.contains('tb-select')
      if (e.key === 'Escape' && selecting && !editing) { e.stopPropagation(); selection.clear() }
      // ⌘A na tabela (fora de um campo) seleciona todas as linhas da visualização filtrada.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && !editing && !typing && !readOnly) { e.preventDefault(); selection.selectAll() }
    }}>
      {selectedRows.length > 0 && <div className="tb-bulk-dock tb-bulk-dock--inline"><BulkBar dbId={db.id} title={db.title} schema={schema} rows={selectedRows} readOnly={readOnly || db.locked} onClear={selection.clear} /></div>}
      <div className="tb-scroll">
        <div
          className="tb-inner"
          ref={gridRef}
          role="grid"
          tabIndex={0}
          aria-label={db.title || t('Tabela', 'Table')}
          aria-rowcount={rows.length + 1}
          aria-colcount={visibleProps.length}
          aria-multiselectable={!readOnly || undefined}
          aria-activedescendant={activeDomId}
          style={{ minWidth: numW + totalWidth + (schemaLocked ? 0 : 40) + (db.locked ? 0 : 36) }}
          onKeyDown={onGridKeyDown}
          onCopy={onGridCopy}
          onPaste={onGridPaste}
          onMouseDown={() => { pointerDown.current = true; setTimeout(() => { pointerDown.current = false }, 400) }}
          onFocus={(e) => {
            // Foco pelo teclado (Tab) sem célula ativa: ativa a primeira; pelo mouse, a célula clicada assume.
            if (e.target === e.currentTarget && !activeCell && !pointerDown.current && !programmaticFocus.current && rows.length) goTo(0, 0)
          }}
        >
          {/* Cabeçalho */}
          <div className="tb-head" role="row" aria-rowindex={1}>
            {!readOnly && (
              <div className="tb-head-gutter" role="gridcell">
                <input
                  ref={headCheck}
                  type="checkbox"
                  className="tb-select"
                  aria-label={selection.state === 'all' ? t('Desmarcar todas as linhas', 'Deselect all rows') : t('Selecionar todas as linhas', 'Select all rows')}
                  checked={selection.state === 'all'}
                  onChange={() => {}}
                  onClick={() => selection.toggleAll()}
                />
              </div>
            )}
            {numW > 0 && <div className="tb-th tb-th-num" style={{ width: numW }} aria-hidden="true">#</div>}
            {visibleProps.map((p, index) => (
              <div
                key={p.id}
                data-col={p.id}
                role="columnheader"
                aria-sort={view.sorts[0]?.propertyId === p.id ? (view.sorts[0].direction === 'asc' ? 'ascending' : 'descending') : undefined}
                className={`tb-th${stickyLeft(index) !== undefined ? ' tb-frozen-head' : ''}${propMenu?.propId === p.id ? ' tb-th--open' : ''}${
                  colDrop?.propId === p.id ? (colDrop.after ? ' tb-drop-right' : ' tb-drop-left') : ''
                }`}
                style={{ width: widthOf(p), ...(stickyLeft(index) !== undefined ? { left: stickyLeft(index) } : {}) }}
                draggable={!schemaLocked}
                onDragStart={(e) => {
                  dragCol.current = p.id
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData(COL_MIME, p.id)
                }}
                onDragOver={(e) => colDragOver(e, p)}
                onDrop={colDropOn}
                onClick={() => { if (!db.locked) setPropMenu({ propId: p.id }) }}
              >
                <span className="tb-th-icon">
                  <PropTypeIcon type={p.type} />
                </span>
                <span className="tb-th-name">{p.name}</span>
                {!schemaLocked && (
                  <span
                    className={`tb-resizer${resize?.propId === p.id ? ' tb-resizer--active' : ''}`}
                    onMouseDown={(e) => startResize(e, p)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            ))}
            {!schemaLocked && (
              <button
                type="button"
                className="tb-th tb-th-add"
                aria-label={t('Adicionar propriedade', 'Add property')}
                onClick={(e) => setAddColEl(e.currentTarget)}
              >
                <Plus size={16} />
              </button>
            )}
            {!db.locked && props.onOpenSettings && (
              <button
                type="button"
                className="tb-th tb-th-add tb-th-more"
                aria-label={t('Visibilidade das propriedades', 'Property visibility')}
                title={t('Visibilidade das propriedades', 'Property visibility')}
                onClick={() => props.onOpenSettings?.('visibility')}
              >
                <MoreHorizontal size={16} />
              </button>
            )}
          </div>

          {/* Linhas */}
          <div className="tb-body" role="rowgroup" ref={virtual.containerRef}>
            {virtual.padTop > 0 && <div className="tb-virtual-pad" style={{ height: virtual.padTop }} aria-hidden="true" />}
            {rows.slice(virtual.start, virtual.end).map((row, i) => (
              <TableRow
                gridId={gridId}
                rowIndex={virtual.start + i + 2}
                activePropId={activeCell?.rowId === row.id ? activeCell.propId : null}
                rowNumber={numW ? virtual.start + i + 1 : 0}
                key={row.id}
                row={row}
                visibleProps={visibleProps}
                layoutKey={layoutKey}
                cellLayout={cellLayout}
                crossRowToken={crossRowToken}
                color={colorFor(row)}
                readOnly={readOnly}
                sorted={sorted}
                showPageIcon={view.showPageIcon !== false}
                editingPropId={editing?.rowId === row.id ? editing.propId : null}
                menuActive={rowMenu?.rowId === row.id}
                selected={selection.has(row.id)}
                drop={rowDrop?.rowId === row.id ? (rowDrop.after ? 'below' : 'above') : null}
                handlers={rowHandlers}
                measure={virtual.measure}
              />
            ))}
            {virtual.padBottom > 0 && <div className="tb-virtual-pad" style={{ height: virtual.padBottom }} aria-hidden="true" />}
          </div>

          {!readOnly && (
            <button type="button" className="tb-new" onClick={newRow}>
              <Plus size={16} />
              <span>{t('Nova página', 'New page')}</span>
            </button>
          )}
          <TableFooterCalc db={db} schema={schema} view={view} rows={rows} visibleProps={visibleProps} widthOf={widthOf} stickyLeft={stickyLeft} totalWidth={totalWidth} schemaLocked={schemaLocked} />
        </div>
      </div>

      <div className={`tb-note${note ? ' tb-note--on' : ''}`} role="status" aria-live="polite">{note}</div>

      {editing && editEl && editingRow && editingProp && (
        <PropertyEditor
          key={`${editing.rowId}:${editing.propId}`}
          seed={seed}
          dbId={db.id}
          property={editingProp}
          value={getValue(editingRow, editingProp)}
          anchor={editEl}
          onChange={(v) => setValue(editingRow, editingProp, v)}
          onClose={onEditorClose}
        />
      )}

      {propMenu && propMenuEl && menuProp && (
        <PropertyMenu
          key={menuProp.id}
          dbId={db.id}
          property={menuProp}
          view={view}
          anchor={propMenuEl}
          readOnly={schemaLocked}
          viewReadOnly={db.locked}
          properties={schema.properties}
          autoRename={propMenu.autoRename}
          onClose={() => setPropMenu(null)}
        />
      )}


      {addColEl && (
        <NewPropertyMenu
          anchor={addColEl}
          placement="bottom-end"
          onClose={() => setAddColEl(null)}
          onPick={(t) => {
            setAddColEl(null)
            const id = addProperty(db.id, t)
            setPropMenu({ propId: id, autoRename: true })
          }}
        />
      )}

      {rowMenu && menuRow && (
        <DbPopover anchor={rowMenu.at} onClose={() => setRowMenu(null)} label={t('Ações da linha', 'Row actions')}>
          <Menu>
            <MenuItem
              icon={<Maximize2 size={16} />}
              label={t('Abrir', 'Open')}
              onClick={() => {
                setRowMenu(null)
                onOpenRow(menuRow.id)
              }}
            />
            {!readOnly && (
              <>
                <MenuItem
                  icon={<Copy size={16} />}
                  label={t('Duplicar', 'Duplicate')}
                  onClick={() => {
                    setRowMenu(null)
                    void actions.duplicatePage(menuRow.id)
                  }}
                />
                <MenuSep />
                <MenuItem
                  icon={<Trash2 size={16} />}
                  label={t('Excluir', 'Delete')}
                  danger
                  onClick={() => {
                    setRowMenu(null)
                    actions.trashPage(menuRow.id)
                  }}
                />
              </>
            )}
          </Menu>
        </DbPopover>
      )}
    </div>
  )
}

const rowKey = (row: Page) => row.id

interface RowHandlers {
  startEdit: (row: Page, prop: Property) => void
  cellClick: (row: Page, prop: Property) => void
  insertBelow: (row: Page) => void
  onOpenRow: (rowId: string) => void
  rowDragOver: (e: React.DragEvent<HTMLDivElement>, row: Page) => void
  rowDropOn: (e: React.DragEvent) => void
  openMenu: (rowId: string, at: { x: number; y: number } | Element) => void
  toggleSelect: (row: Page, range: boolean) => void
  dragStart: (rowId: string) => void
}

interface TableRowProps {
  row: Page
  visibleProps: Property[]
  layoutKey: string
  cellLayout: { width: number; stickyLeft?: number; wrapped: boolean }[]
  crossRowToken: unknown
  color: string | undefined
  readOnly: boolean
  sorted: boolean
  showPageIcon: boolean
  editingPropId: string | null
  menuActive: boolean
  selected: boolean
  /** 1-based; 0 = sem numeração. */
  rowNumber: number
  gridId: string
  /** Posição ARIA (1 = cabeçalho). */
  rowIndex: number
  activePropId: string | null
  drop: 'above' | 'below' | null
  handlers: MutableRefObject<RowHandlers>
  measure: (el: HTMLElement | null) => void
}

function sameRowProps(a: TableRowProps, b: TableRowProps) {
  if (a.visibleProps !== b.visibleProps && (a.visibleProps.length !== b.visibleProps.length || a.visibleProps.some((p, i) => p !== b.visibleProps[i]))) return false
  return a.row === b.row && a.layoutKey === b.layoutKey && a.crossRowToken === b.crossRowToken && a.color === b.color && a.readOnly === b.readOnly && a.sorted === b.sorted &&
    a.showPageIcon === b.showPageIcon && a.editingPropId === b.editingPropId && a.menuActive === b.menuActive && a.selected === b.selected && a.rowNumber === b.rowNumber && a.rowIndex === b.rowIndex && a.activePropId === b.activePropId && a.gridId === b.gridId && a.drop === b.drop && a.measure === b.measure
}

const TableRow = memo(function TableRow(props: TableRowProps) {
  const { row, visibleProps, cellLayout, color, readOnly, sorted, handlers } = props
  return (
    <div
      role="row"
      aria-rowindex={props.rowIndex}
      aria-selected={props.selected || undefined}
      data-vkey={row.id}
      ref={props.measure}
      className={`tb-row${color ? ` db-rule-${color}` : ''}${props.menuActive ? ' tb-row--active' : ''}${props.selected ? ' tb-row--selected' : ''}${props.drop ? (props.drop === 'below' ? ' tb-drop-below' : ' tb-drop-above') : ''}`}
      onDragOver={(e) => handlers.current.rowDragOver(e, row)}
      onDrop={(e) => handlers.current.rowDropOn(e)}
      onContextMenu={(e) => {
        e.preventDefault()
        handlers.current.openMenu(row.id, { x: e.clientX, y: e.clientY })
      }}
    >
      {!readOnly && (
        <div className="tb-gutter" role="gridcell">
          <button
            type="button"
            className="tb-row-add"
            aria-label={sorted ? t('Nova página no fim', 'New page at the end') : t('Inserir abaixo', 'Insert below')}
            title={sorted ? t('Nova página (no fim: há uma ordenação ativa)', 'New page (at the end: a sort is active)') : t('Clique para inserir abaixo', 'Click to insert below')}
            onClick={() => handlers.current.insertBelow(row)}
          >
            <Plus size={16} />
          </button>
          <span
            className={`tb-handle${sorted ? ' tb-handle--locked' : ''}`}
            draggable={!sorted && !row.locked}
            title={sorted ? t('Remova a ordenação para reordenar manualmente', 'Remove sorting to reorder manually') : t('Arraste para mover · clique para abrir o menu', 'Drag to move · click for menu')}
            onDragStart={(e) => {
              handlers.current.dragStart(row.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(ROW_MIME, row.id)
              const rowEl = e.currentTarget.closest('.tb-row')
              if (rowEl) e.dataTransfer.setDragImage(rowEl, 20, 17)
            }}
            onClick={(e) => handlers.current.openMenu(row.id, e.currentTarget)}
          >
            <GripVertical size={14} />
          </span>
          <input
            type="checkbox"
            className="tb-select"
            aria-label={t('Selecionar linha', 'Select row')}
            checked={props.selected}
            onChange={() => {}}
            onClick={(e) => handlers.current.toggleSelect(row, e.shiftKey)}
          />
        </div>
      )}
      {props.rowNumber > 0 && <div className="tb-cell tb-rownum" style={{ width: 36 }}>{props.rowNumber}</div>}
      {visibleProps.map((p, index) => (
        <TableCell
          key={p.id}
          row={row}
          prop={p}
          width={cellLayout[index].width}
          stickyLeft={cellLayout[index].stickyLeft}
          wrapped={cellLayout[index].wrapped}
          showPageIcon={props.showPageIcon}
          readOnly={readOnly || row.locked}
          editing={props.editingPropId === p.id}
          active={props.activePropId === p.id}
          domId={cellDomId(props.gridId, row.id, p.id)}
          colIndex={index + 1}
          onEdit={() => handlers.current.cellClick(row, p)}
          onOpen={() => handlers.current.onOpenRow(row.id)}
        />
      ))}
    </div>
  )
}, sameRowProps)

function TableCell(props: {
  row: Page
  prop: Property
  width: number
  stickyLeft?: number
  wrapped: boolean
  showPageIcon: boolean
  readOnly: boolean
  editing: boolean
  active: boolean
  domId: string
  colIndex: number
  onEdit: () => void
  onOpen: () => void
}) {
  const { row, prop, readOnly } = props
  const value = getValue(row, prop)
  const isTitle = prop.type === 'title'
  const isUrl = prop.type === 'url' && typeof value === 'string' && value !== ''

  return (
    <div
      role="gridcell"
      id={props.domId}
      aria-colindex={props.colIndex}
      aria-selected={props.active || undefined}
      aria-readonly={readOnly || undefined}
      data-cell={`${row.id}:${prop.id}`}
      className={`tb-cell tb-cell--${prop.type}${props.wrapped ? ' tb-cell--wrapped' : ''}${props.stickyLeft !== undefined ? ' tb-frozen-cell' : ''}${props.editing ? ' tb-cell--editing' : ''}${props.active ? ' tb-cell--active' : ''}`}
      style={{ width: props.width, ...(props.stickyLeft !== undefined ? { left: props.stickyLeft } : {}) }}
      onClick={(e) => {
        if (isUrl && e.metaKey) return openUrl(value as string)
        props.onEdit()
      }}
    >
      {isTitle ? (
        <>
          <span className="tb-title">
            {props.showPageIcon && (row.icon ? <PageIcon value={row.icon} className="tb-title-icon" /> : <PageIcon value={null} fallback={row.database ? 'database' : 'page'} className="tb-title-icon" style={{ width: 16, height: 16 }} />)}
            <span className={`tb-title-text${row.title ? '' : ' tb-title-text--empty'}`}>{row.title || (readOnly ? t('Sem título', 'Untitled') : '')}</span>
          </span>
          <button
            type="button"
            className="tb-open"
            title={t('Abrir em prévia lateral', 'Open in side peek')}
            aria-label={t('Abrir página', 'Open page')}
            onClick={(e) => {
              e.stopPropagation()
              props.onOpen()
            }}
          >
            <Maximize2 size={12} />
            <span>{t('ABRIR', 'OPEN')}</span>
          </button>
        </>
      ) : (
        <>
          {!isEmptyValue(value) || prop.type === 'checkbox' || prop.type === 'button' || prop.type === 'formula' || prop.type === 'rollup' ? <PropDisplay property={prop} value={value} rowId={row.id} /> : null}
          {isUrl && (
            <button
              type="button"
              className="tb-url-open"
              title={t('Abrir link', 'Open link')}
              onClick={(e) => {
                e.stopPropagation()
                openUrl(value as string)
              }}
            >
              <ArrowUpRight size={14} />
            </button>
          )}
        </>
      )}
      <CellComments row={row} property={prop} onlyWhenPresent />
    </div>
  )
}

// ---------- Grade: ids, revelar célula e vizinhas (grupos) ----------

const cellDomId = (gridId: string, rowId: string, propId: string) => `${gridId}-c-${rowId}-${propId}`

/** Rola até a célula ficar visível, sem deixá-la atrás das colunas congeladas. */
function revealCell(el: HTMLElement, root: HTMLElement) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const scroller = root.querySelector<HTMLElement>('.tb-scroll')
  const frozen = el.parentElement?.querySelectorAll('.tb-frozen-cell')
  if (!scroller || !frozen?.length || el.classList.contains('tb-frozen-cell')) return
  let edge = -Infinity
  frozen.forEach((f) => { edge = Math.max(edge, f.getBoundingClientRect().right) })
  const left = el.getBoundingClientRect().left
  if (left < edge) scroller.scrollLeft -= edge - left
}

interface GridHandle {
  el: () => HTMLElement | null
  /** Assume a célula ativa (linha/coluna de entrada); false se esta tabela não tem linhas. */
  enter: (row: 'first' | 'last', col: number | 'first' | 'last') => boolean
}

const grids = new Set<GridHandle>()

/** Tabelas do mesmo banco (grupos/subgrupos) na ordem da página. */
function siblingGrids(self: GridHandle): GridHandle[] {
  const el = self.el()
  const scope = el?.closest('.dbv-body')
  if (!el || !scope) return [self]
  return [...grids]
    .filter((g) => { const other = g.el(); return !!other && scope.contains(other) })
    .sort((a, b) => (a.el()!.compareDocumentPosition(b.el()!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}
