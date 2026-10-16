// Visualização Quadro (kanban): colunas por opção de uma propriedade Seleção/Status.
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Ellipsis, Plus, SquareKanban, Trash2 } from 'lucide-react'
import { actions, getState, selectors } from '../../../store'
import type { DatabaseSchema, OptionColor, Page, Property, SelectOption, View } from '../../../types'
import { OPTION_COLORS, getValue, groupRows, randomColor, type ViewProps } from '../lib'
import { optionColorLabel } from '../labels'
import { matchingRowColor } from '../colorRules'
import { t } from '../../../i18n'
import { OptionChip } from '../PropDisplay'
import { MenuItem, MenuLabel, MenuSeparator, Popover } from './shared/Popover'
import { usePointerDrag } from './shared/useDrag'
import { moveInColumns, useCardNav } from './shared/cardNav'
import { groupValue, isGroupableType, moveGroupValue } from '../grouping'
import {
  InlineTitleInput,
  PropValueView,
  RowIcon,
  RowTitle,
  RenameButton,
  useCardPropEditor,
  coverCss,
  indexFromY,
  insertionIndex,
  shownProps,
  useRowCreation,
  useRowMenu,
} from './shared/rows'
import { useRevealKey, useVirtualRows } from '../virtual/useVirtualRows'
import './BoardView.css'

const NONE = '__none__'

/** Primeira imagem de uma propriedade de arquivos (prévia "Propriedades da página"). */
export function firstImage(row: Page, propId: string | undefined): string | undefined {
  const value = propId ? row.props?.[propId] : null
  if (!Array.isArray(value)) return undefined
  for (const file of value as unknown[]) {
    const f = file as { mimeType?: unknown; data?: unknown } | null
    if (f && typeof f.mimeType === 'string' && f.mimeType.startsWith('image/') && typeof f.data === 'string') return f.data
  }
  return undefined
}

function isGroupable(p: Property | undefined): p is Property {
  return !!p && isGroupableType(p.type)
}

export function resolveGroupProp(schema: DatabaseSchema, view: View): Property | undefined {
  const chosen = schema.properties.find((p) => p.id === view.groupBy)
  if (isGroupable(chosen)) return chosen
  return schema.properties.find((p) => p.type === 'status' || p.type === 'select')
}

function scrollParentY(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null
  while (cur) {
    const oy = getComputedStyle(cur).overflowY
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return null
}

interface Target {
  col: string
  index: number
}

export function BoardView({ db, schema, view, rows, visibleProps, readOnly, schemaLocked, onOpenRow, creationDefaults, selection }: ViewProps) {
  const groupProp = resolveGroupProp(schema, view)
  const boardRef = useRef<HTMLDivElement>(null)
  const { openMenu, menuNode, menuRowId } = useRowMenu(readOnly, onOpenRow)
  const { editingId, create, stopEditing, rename } = useRowCreation(db, schema, view, creationDefaults)
  const { propHandlers, editorNode } = useCardPropEditor(db.id, readOnly, onOpenRow)
  const [colMenu, setColMenu] = useState<{ optionId: string; anchor: HTMLElement } | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)
  const canReorder = !readOnly && view.sorts.length === 0
  // Coluna de onde o arraste começou: com valores múltiplos o cartão está em várias colunas.
  const dragFrom = useRef<string>(NONE)

  // A coluna "Sem {status}" só aparece quando tem cartões (como no Export Bundle) — ou durante um
  // arraste, como alvo para limpar o valor; some de novo ao soltar se continuar vazia.
  const allGroups = useMemo(() => {
    if (!groupProp) return []
    const visible = groupRows(rows, groupProp, getState().pages).filter((group) => !view.hiddenGroups?.includes(`${groupProp.id}:${group.option?.id ?? NONE}`))
    // Ordem dos grupos (Configurações › Agrupar); "Sem valor" fica no fim nas ordens alfabéticas.
    if (view.groupSort !== 'alphabetical' && view.groupSort !== 'reverse') return visible
    const named = visible.filter((group) => group.option).sort((a, b) => a.option!.name.localeCompare(b.option!.name))
    if (view.groupSort === 'reverse') named.reverse()
    return [...named, ...visible.filter((group) => !group.option)]
  }, [rows, groupProp, view.hiddenGroups, view.groupSort])
  
  const { drag, onPointerDown } = usePointerDrag<Target>({
    disabled: readOnly || !groupProp,
    scrollers: () => [boardRef.current, scrollParentY(boardRef.current)],
    resolve: (x, y, id) => {
      const board = boardRef.current
      if (!board) return null
      const br = board.getBoundingClientRect()
      if (y < br.top - 40 || y > br.bottom + 200) return null
      const cols = [...board.querySelectorAll<HTMLElement>('[data-bd-col]')]
      let best: HTMLElement | null = null
      let bestDist = Infinity
      for (const c of cols) {
        const r = c.getBoundingClientRect()
        const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
        if (d < bestDist) (bestDist = d), (best = c)
      }
      if (!best || bestDist > 40) return null
      const cards = [...best.querySelectorAll<HTMLElement>('[data-row-id]')].filter((c) => c.dataset.rowId !== id)
      // Colunas virtualizadas: `data-skip` = cartões (não arrastados) acima da faixa renderizada.
      const skip = Number(best.querySelector<HTMLElement>('.bd-col-cards')?.dataset.skip ?? 0)
      return { col: best.dataset.bdCol!, index: skip + indexFromY(cards, y) }
    },
    onDrop: (id, t) => {
      if (getState().pages[id]?.locked) return
      if (!groupProp) return
      const fromKey = dragFrom.current
      if (fromKey !== t.col) {
        const row = getState().pages[id]
        if (row) actions.setProp(id, groupProp.id, moveGroupValue(row, groupProp, fromKey === NONE ? null : fromKey, t.col === NONE ? null : t.col, getState().pages, groups.find((g) => (g.option?.id ?? NONE) === t.col)?.option?.name))
      }
      if (!canReorder) return
      const target = groups.find((g) => (g.option?.id ?? NONE) === t.col)
      const colRows = (target?.rows ?? []).filter((r) => r.id !== id)
      const before = colRows[t.index]?.id ?? null
      const after = before ? null : (colRows[colRows.length - 1]?.id ?? null)
      const sourceId = getState().pages[id]?.parentId
      if (!sourceId || (before && getState().pages[before]?.parentId !== sourceId) || (after && getState().pages[after]?.parentId !== sourceId)) return
      const index = insertionIndex(sourceId, id, before, after)
      if (index !== undefined) actions.movePage(id, sourceId, index)
    },
  })

  const dragging = drag !== null
  const groups = useMemo(() => {
    const shown = allGroups.filter((group) => (group.option && !view.hideEmptyGroups) || group.rows.length > 0 || dragging)
    // A coluna "Sem {status}" vazia que só aparece durante o arraste entra no fim: no começo ela
    // deslocaria todas as colunas para a direita sob o ponteiro logo ao iniciar o gesto.
    const none = shown.find((group) => !group.option)
    return none && !none.rows.length ? [...shown.filter((group) => group !== none), none] : shown
  }, [allGroups, dragging, view.hideEmptyGroups])

  const nav = useCardNav({
    root: () => boardRef.current,
    firstId: groups.find((g) => g.rows.length)?.rows[0]?.id,
    neighbor: (id, key) => {
      const col = groups.findIndex((g) => g.rows.some((r) => r.id === id))
      if (col < 0) return null
      const index = groups[col].rows.findIndex((r) => r.id === id)
      const next = moveInColumns(groups.map((g) => g.rows.length), { col, index }, key)
      return groups[next.col]?.rows[next.index]?.id ?? null
    },
    onOpen: onOpenRow,
    onRename: readOnly ? undefined : (id) => { if (!getState().pages[id]?.locked) rename(id) },
    onToggle: selection && !readOnly ? (id) => selection.toggle(id) : undefined,
  })

  if (!groupProp) {
    return (
      <div className="vw-empty">
        <SquareKanban size={28} strokeWidth={1.5} className="vw-empty-icon" />
        <div className="vw-empty-title">{t('Nada para agrupar', 'Nothing to group')}</div>
        <div className="vw-empty-text">
          {t('O quadro organiza as páginas em colunas. Adicione uma propriedade do tipo Seleção ou Status para agrupar as linhas.', 'The board organizes pages into columns. Add a Select or Status property to group rows.')}
        </div>
      </div>
    )
  }

  const prop = groupProp
  const options = prop.options ?? []
  const derivedGroups = prop.type === 'relation' || prop.type === 'person'

  const updateOptions = (fn: (opts: SelectOption[]) => SelectOption[]) => {
    if (schemaLocked) return
    actions.updateSchema(db.id, (s) => ({
      ...s,
      properties: s.properties.map((p) => (p.id === prop.id ? { ...p, options: fn(p.options ?? []) } : p)),
    }))
  }

  const deleteOption = (optionId: string) => {
    if (schemaLocked) return
    updateOptions((opts) => opts.filter((o) => o.id !== optionId))
    for (const row of selectors.rows(db.id)) {
      const value = row.props?.[prop.id]
      if (value === optionId) actions.setProp(row.id, prop.id, null)
      else if (Array.isArray(value) && (value as string[]).includes(optionId)) actions.setProp(row.id, prop.id, (value as string[]).filter((id) => id !== optionId))
    }
  }

  const addGroup = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const color = randomColor(options.map((o) => o.color))
    updateOptions((opts) => [...opts, { id: crypto.randomUUID(), name: trimmed, color }])
  }

  /** Nova linha no grupo; `top` insere antes do primeiro cartão da coluna. */
  const newRow = (option: SelectOption | null, top: boolean) => {
    const group = groups.find((g) => (g.option?.id ?? null) === (option?.id ?? null))
    let index: number | undefined
    if (top && canReorder && group?.rows[0]) index = insertionIndex(group.rows[0].parentId ?? db.id, '', group.rows[0].id, null)
    create({ [prop.id]: groupValue(prop, option?.id ?? null, option?.name) }, index)
  }

  const cardProps = visibleProps.filter((p) => p.id !== prop.id)
  const colMenuOption = colMenu ? options.find((o) => o.id === colMenu.optionId) : undefined

  return (
    <div className={`bd-board${dragging ? ' is-dragging' : ''}${selection?.size ? ' vw-selecting' : ''}`} ref={boardRef}>
      {groups.map((group) => {
        const key = group.option?.id ?? NONE
        const color: OptionColor = group.option?.color ?? 'default'
        const isTarget = drag?.target?.col === key
        const dropIndex = isTarget ? drag!.target!.index : -1
        const showLine = isTarget && canReorder
        return (
          <div key={key} className={`bd-col db-color-${color}${group.option ? '' : ' bd-col-none'}${isTarget ? ' bd-col-target' : ''}`} data-bd-col={key}>
            <div className="bd-col-header">
              <span className="bd-col-chip">
                <OptionChip name={group.option?.name ?? t('Sem {name}', 'No {name}', { name: prop.name })} color={color} custom={group.option?.customColor} dot={prop.type === 'status'} />
              </span>
              <span className="bd-col-count">{group.rows.length}</span>
              {!readOnly && (
                <span className="bd-col-actions">
                  {group.option && !schemaLocked && !derivedGroups && (
                    <button
                      type="button"
                      className="bd-icon-btn"
                      title={t('Opções do grupo', 'Group options')}
                      onClick={(e) => setColMenu({ optionId: group.option!.id, anchor: e.currentTarget })}
                    >
                      <Ellipsis size={16} />
                    </button>
                  )}
                  <button type="button" className="bd-icon-btn" title={t('Nova página', 'New page')} onClick={() => newRow(group.option, true)}>
                    <Plus size={16} />
                  </button>
                </span>
              )}
            </div>
            <BoardCards
              rows={group.rows}
              dragId={drag?.id ?? null}
              dropIndex={showLine ? dropIndex : -1}
              editingId={editingId ?? nav.revealId}
              estimate={view.cardPreview && view.cardPreview !== 'none' ? 160 : 64}
              renderCard={(row, measure) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  props={cardProps}
                  editing={editingId === row.id}
                  nav={nav.cardProps(row.id)}
                  rename={rename}
                  propHandlers={propHandlers}
                  selection={selection}
                  readOnly={readOnly}
                  dragging={drag?.id === row.id}
                  active={menuRowId === row.id}
                  preview={view.cardPreview ?? 'none'}
                  image={view.cardPreview === 'property' ? firstImage(row, view.cardPreviewPropertyId) : undefined}
                  color={matchingRowColor(row, schema, view, (target, id) => getValue(target, schema.properties.find((property) => property.id === id)!))}
                  measure={measure}
                  onStopEditing={stopEditing}
                  onPointerDown={(e) => { if (row.locked) return; dragFrom.current = (e.currentTarget.closest('[data-bd-col]') as HTMLElement | null)?.dataset.bdCol ?? NONE; onPointerDown(e, row.id) }}
                  onOpen={() => onOpenRow(row.id)}
                  onContextMenu={(e) => openMenu(e, row.id)}
                />
              )}
            />
            {!readOnly && (
              <button type="button" className="bd-new" onClick={() => newRow(group.option, false)}>
                <Plus size={16} />
                <span>{t('Nova página', 'New page')}</span>
              </button>
            )}
          </div>
        )
      })}

      {!schemaLocked && !derivedGroups && (
        <div className="bd-add-group">
          {addingGroup ? (
            <AddGroupInput
              onDone={(name) => {
                if (name !== null) addGroup(name)
                setAddingGroup(false)
              }}
            />
          ) : (
            <button type="button" className="bd-add-group-btn" onClick={() => setAddingGroup(true)}>
              <Plus size={16} />
              <span>{t('Novo grupo', 'New group')}</span>
            </button>
          )}
        </div>
      )}

      {colMenu && colMenuOption && (
        <ColumnMenu
          anchor={colMenu.anchor}
          option={colMenuOption}
          onClose={() => setColMenu(null)}
          onRename={(name) => updateOptions((opts) => opts.map((o) => (o.id === colMenuOption.id ? { ...o, name } : o)))}
          onColor={(c) => updateOptions((opts) => opts.map((o) => (o.id === colMenuOption.id ? { ...o, color: c } : o)))}
          onDelete={() => {
            setColMenu(null)
            deleteOption(colMenuOption.id)
          }}
        />
      )}
      {menuNode}
      {editorNode}
    </div>
  )
}

/** Cartões de uma coluna, virtualizados (só os visíveis + margem), com a linha de soltura do arraste. */
function BoardCards({ rows, dragId, dropIndex, editingId, estimate, renderCard }: {
  rows: Page[]
  dragId: string | null
  dropIndex: number
  editingId: string | null
  estimate: number
  renderCard: (row: Page, measure: (el: HTMLElement | null) => void) => ReactNode
}) {
  const virtual = useVirtualRows({ items: rows, keyOf: cardKey, estimate, gap: 8 })
  useRevealKey(virtual, rows, cardKey, editingId)
  let visibleIdx = 0
  for (let i = 0; i < virtual.start; i++) if (rows[i].id !== dragId) visibleIdx++
  const skip = visibleIdx
  const items: ReactNode[] = []
  // `gap` do flex já separa os itens: o espaçador desconta um gap.
  if (virtual.padTop > 8) items.push(<div key="pad-top" style={{ height: virtual.padTop - 8 }} aria-hidden="true" />)
  for (const row of rows.slice(virtual.start, virtual.end)) {
    if (row.id !== dragId) {
      if (visibleIdx === dropIndex) items.push(<div key="drop" className="bd-drop-line" />)
      visibleIdx++
    }
    items.push(renderCard(row, virtual.measure))
  }
  if (virtual.end === rows.length && visibleIdx === dropIndex) items.push(<div key="drop" className="bd-drop-line" />)
  if (virtual.padBottom > 8) items.push(<div key="pad-bottom" style={{ height: virtual.padBottom - 8 }} aria-hidden="true" />)
  return <div className="bd-col-cards" role="list" ref={virtual.containerRef} data-skip={skip}>{items}</div>
}

const cardKey = (row: Page) => row.id

interface CardProps {
  measure?: (el: HTMLElement | null) => void
  row: Page
  props: Property[]
  editing: boolean
  nav: Record<string, unknown>
  rename: (id: string) => void
  propHandlers: ReturnType<typeof useCardPropEditor>['propHandlers']
  selection?: ViewProps['selection']
  readOnly: boolean
  dragging: boolean
  active: boolean
  preview: NonNullable<View['cardPreview']>
  image?: string
  color?: string
  onStopEditing: () => void
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onOpen: () => void
  onContextMenu: (e: ReactMouseEvent) => void
}

function BoardCard({ row, props, editing, nav, rename, propHandlers, selection, readOnly, dragging, active, preview, image, color, measure, onStopEditing, onPointerDown, onOpen, onContextMenu }: CardProps) {
  const values = shownProps(row, props)
  return (
    <div
      className={`bd-card${color ? ` db-rule-${color}` : ''}${dragging ? ' is-dragging' : ''}${active ? ' is-active' : ''}${selection?.has(row.id) ? ' is-selected' : ''}`}
      data-row-id={row.id}
      data-vkey={row.id}
      role="listitem"
      {...nav}
      ref={measure}
      onPointerDown={onPointerDown}
      onClick={() => !editing && onOpen()}
      onContextMenu={onContextMenu}
    >
      {selection && !readOnly && <input type="checkbox" className="tb-select vw-select" aria-label={t('Selecionar linha', 'Select row')} checked={selection.has(row.id)} onChange={() => {}} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); selection.toggle(row.id, e.shiftKey) }} />}
      {preview === 'cover' && row.cover && <div className="bd-card-preview bd-card-cover" style={coverCss(row.cover, row.coverPosition)} />}
      {preview === 'content' && row.text.trim() && <div className="bd-card-preview bd-card-content">{row.text.trim().slice(0, 280)}</div>}
      {preview === 'property' && image && <div className="bd-card-preview bd-card-cover" style={{ backgroundImage: `url("${image.replace(/"/g, '%22')}")` }} />}
      <div className="bd-card-title">
        {row.icon && <RowIcon page={row} />}
        {editing ? <InlineTitleInput page={row} onDone={onStopEditing} /> : <><RowTitle page={row} /><RenameButton page={row} readOnly={readOnly} onRename={rename} /></>}
      </div>
      {values.length > 0 && (
        <div className="bd-card-props">
          {values.map(({ prop, value }) => (
            <div key={prop.id} className="bd-card-prop" title={prop.name} {...propHandlers(row, prop)}>
              <PropValueView prop={prop} value={value} rowId={row.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddGroupInput({ onDone }: { onDone: (name: string | null) => void }) {
  const [value, setValue] = useState('')
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      autoFocus
      className="bd-add-group-input"
      placeholder={t('Nome do grupo', 'Group name')}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

interface ColumnMenuProps {
  anchor: HTMLElement
  option: SelectOption
  onClose: () => void
  onRename: (name: string) => void
  onColor: (color: OptionColor) => void
  onDelete: () => void
}

function ColumnMenu({ anchor, option, onClose, onRename, onColor, onDelete }: ColumnMenuProps) {
  const [name, setName] = useState(option.name)
  const commit = () => {
    const n = name.trim()
    if (n && n !== option.name) onRename(n)
  }
  const close = () => {
    commit()
    onClose()
  }
  return (
    <Popover anchor={anchor} onClose={close} width={240}>
      <input
        autoFocus
        className="vw-menu-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') close()
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
      <MenuItem icon={<Trash2 size={16} />} label={t('Excluir', 'Delete')} danger onClick={onDelete} />
      <MenuSeparator />
      <MenuLabel>{t('Cores', 'Colors')}</MenuLabel>
      {OPTION_COLORS.map((c) => (
        <MenuItem
          key={c}
          icon={<span className={`vw-color-swatch db-color-${c}`} />}
          label={optionColorLabel(c)}
          checked={option.color === c}
          onClick={() => onColor(c)}
        />
      ))}
    </Popover>
  )
}
