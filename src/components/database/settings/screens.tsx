// Telas do painel: visibilidade das propriedades, filtro e ordenação.
import { useState, type ReactNode } from 'react'
import { actions } from '../../../store'
import { getLocale, t } from '../../../i18n'
import type { Filter, FilterOp, Property, Sort, View } from '../../../types'
import type { FilterTree } from '../../../database-models'
import { Icon } from '../../ui/icons'
import { Dropdown } from '../ui/Popover'
import { PropTypeIcon } from '../icons'
import { filterOpsFor, hasOptions } from '../lib'
import { filterOperatorLabel } from '../labels'
import { OptionChip } from '../PropDisplay'
import { newFilterFor } from '../PropertyMenu'
import { PropertyPicker, filterProperties } from '../ViewControls'
import { moveProperty, parseNumber } from '../schemaOps'
import { appendFilterRule, filterTreeFromIds, moveFilterRule, nestFilterRule, removeFilterRule, setGroupOperator, ungroupFilterGroup } from '../filterTree'
import { moveId, splitVisibility } from './model'
import { NavRow, SectionLabel } from './ui'
import { inType, type ScreenProps } from './types'

// ---------- Arrastar para reordenar (HTML5) ----------

type DropAt = { id: string; after: boolean } | null
function useReorder(onMove: (id: string, targetId: string, after: boolean) => void, enabled: boolean) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropAt>(null)
  const handle = (id: string) => enabled ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) },
    onDragEnd: () => { setDragId(null); setDrop(null) },
  } : {}
  const target = (id: string) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!dragId || dragId === id) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const after = e.clientY > r.top + r.height / 2
      if (drop?.id !== id || drop.after !== after) setDrop({ id, after })
    },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragId && drop) onMove(dragId, drop.id, drop.after); setDragId(null); setDrop(null) },
    'data-drop': drop?.id === id ? (drop.after ? 'after' : 'before') : undefined,
  })
  return { handle, target, dragId }
}

// ---------- Visibilidade das propriedades ----------

export function VisibilityScreen({ ctx }: ScreenProps) {
  const { db, schema, view, schemaLocked } = ctx
  const [query, setQuery] = useState('')
  const { shown, hidden } = splitVisibility(schema, view, query)
  const [inPt, inEn] = inType(view.type)
  const setHidden = (ids: string[]) => actions.updateView(db.id, view.id, { hidden: ids })
  const toggle = (p: Property) => setHidden(view.hidden.includes(p.id) ? view.hidden.filter((id) => id !== p.id) : [...view.hidden, p.id])
  const reorder = useReorder((id, targetId, after) => moveProperty(db.id, id, targetId, after), !schemaLocked)
  // Alt+↑/↓ move a propriedade entre as mostradas (alternativa de teclado ao arraste).
  const keyMove = (e: React.KeyboardEvent, p: Property, list: Property[]) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || schemaLocked) return
    const i = list.indexOf(p), j = e.key === 'ArrowUp' ? i - 1 : i + 1
    if (j < 0 || j >= list.length || list[j].type === 'title') return
    e.preventDefault(); e.stopPropagation()
    moveProperty(db.id, p.id, list[j].id, e.key === 'ArrowDown')
  }
  const row = (p: Property, list: Property[], on: boolean) => {
    const isTitle = p.type === 'title'
    const drag = isTitle ? {} : reorder.handle(p.id)
    return (
      <div key={p.id} className={`vs-prop${reorder.dragId === p.id ? ' is-dragging' : ''}`} {...(isTitle ? {} : reorder.target(p.id))}>
        <span className={`vs-grip${isTitle || schemaLocked ? ' vs-grip--off' : ''}`} {...drag} title={isTitle ? undefined : t('Arraste para reordenar', 'Drag to reorder')}><Icon name="grip" size={14} /></span>
        <span className="vs-row-icon"><PropTypeIcon type={p.type} size={16} /></span>
        <span className="vs-row-label">{p.name}</span>
        <button type="button" className={`vs-eye${on ? '' : ' is-off'}`} data-vs-nav disabled={isTitle} aria-pressed={on}
          aria-label={on ? t('Ocultar {name}', 'Hide {name}', { name: p.name }) : t('Mostrar {name}', 'Show {name}', { name: p.name })}
          title={isTitle ? t('O título fica sempre visível', 'The title is always shown') : undefined}
          onClick={() => toggle(p)} onKeyDown={(e) => keyMove(e, p, list)}>
          <Icon name={on ? 'eye' : 'eye-off'} size={16} />
        </button>
      </div>
    )
  }
  const nonTitle = schema.properties.filter((p) => p.type !== 'title')
  return (
    <>
      <div className="vs-search"><input className="vs-input vs-input--focus" data-autofocus data-vs-nav placeholder={t('Buscar uma propriedade…', 'Search for a property…')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('Buscar uma propriedade', 'Search for a property')} /></div>
      <SectionLabel action={nonTitle.some((p) => !view.hidden.includes(p.id)) ? { label: t('Ocultar todas', 'Hide all'), onClick: () => setHidden(nonTitle.map((p) => p.id)) } : undefined}>{t('Mostradas {where}', 'Shown in {where}', { where: getLocale() === 'pt-BR' ? inPt : inEn })}</SectionLabel>
      {shown.map((p) => row(p, shown, true))}
      {hidden.length > 0 && <>
        <SectionLabel action={{ label: t('Mostrar todas', 'Show all'), onClick: () => setHidden([]) }}>{t('Ocultas {where}', 'Hidden in {where}', { where: getLocale() === 'pt-BR' ? inPt : inEn })}</SectionLabel>
        {hidden.map((p) => row(p, hidden, false))}
      </>}
      {!shown.length && !hidden.length && <div className="vs-empty">{t('Nenhuma propriedade encontrada', 'No properties found')}</div>}
    </>
  )
}

// ---------- Filtro ----------

function FilterValue({ prop, filter, update }: { prop: Property; filter: Filter; update: (patch: Partial<Filter>) => void }) {
  const [text, setText] = useState(() => filter.value === null ? '' : typeof filter.value === 'number' ? String(filter.value) : String(filter.value))
  if (filter.op === 'isEmpty' || filter.op === 'isNotEmpty') return null
  if (prop.type === 'checkbox') return <Dropdown value={filter.value === true ? 'true' : 'false'} options={[{ value: 'true', label: t('Marcado', 'Checked') }, { value: 'false', label: t('Desmarcado', 'Unchecked') }]} onChange={(value) => update({ value: value === 'true' })} className="vs-filter-value" />
  if (hasOptions(prop.type)) return <Dropdown value={typeof filter.value === 'string' ? filter.value : ''} options={[{ value: '', label: t('Escolha…', 'Choose…') }, ...(prop.options ?? []).map((o) => ({ value: o.id, label: o.name, icon: <OptionChip name="" color={o.color} custom={o.customColor} dot /> }))]} onChange={(value) => update({ value: value || null })} className="vs-filter-value" />
  if (prop.type === 'date' || prop.type === 'createdTime' || prop.type === 'updatedTime') return <input type="date" className="vs-input vs-filter-value" aria-label={t('Valor', 'Value')} value={typeof filter.value === 'string' ? filter.value : ''} onChange={(e) => update({ value: e.target.value || null })} />
  const numeric = prop.type === 'number' || prop.type === 'formula' || prop.type === 'rollup'
  return <input className="vs-input vs-filter-value" aria-label={t('Valor', 'Value')} placeholder={t('Valor…', 'Value…')} inputMode={numeric ? 'decimal' : undefined} value={text}
    onChange={(e) => { setText(e.target.value); update({ value: numeric ? (e.target.value.trim() ? parseNumber(e.target.value) : null) : e.target.value }) }} />
}

export function FilterScreen({ ctx }: ScreenProps) {
  const { db, schema, view } = ctx
  const [picker, setPicker] = useState<{ el: Element; groupId?: string; newGroup?: boolean } | null>(null)
  const ids = view.filters.map((f) => f.id)
  const tree: FilterTree = view.filterTree ?? filterTreeFromIds(ids)
  const save = (patch: Partial<View>) => actions.updateView(db.id, view.id, patch)
  const updateFilter = (id: string, patch: Partial<Filter>) => save({ filters: view.filters.map((f) => f.id === id ? { ...f, ...patch } : f) })
  const remove = (id: string) => save({ filters: view.filters.filter((f) => f.id !== id), filterTree: removeFilterRule(view.filterTree, id) })
  const add = (p: Property, groupId?: string, newGroup?: boolean) => {
    const f = newFilterFor(p)
    let next = appendFilterRule(view.filterTree ?? (groupId || newGroup ? filterTreeFromIds(ids) : undefined), ids, f.id)
    if (groupId && groupId !== 'root') next = moveFilterRule(next, f.id, groupId)
    if (newGroup) next = nestFilterRule(next, f.id, crypto.randomUUID())
    save({ filters: [...view.filters, f], ...(view.filterTree || groupId || newGroup ? { filterTree: next } : {}) })
  }
  const props = filterProperties(schema, view)
  const renderGroup = (group: Extract<FilterTree, { kind: 'group' }>, depth: number): ReactNode => {
    const groupId = group.id ?? 'root'
    return group.children.map((child, index) => {
      const prefix = index === 0 ? <span className="vs-filter-where">{t('Onde', 'Where')}</span>
        : index === 1 ? <Dropdown<'and' | 'or'> value={group.operator} options={[{ value: 'and', label: t('E', 'And') }, { value: 'or', label: t('Ou', 'Or') }]} onChange={(operator) => save({ filterTree: setGroupOperator(tree, groupId, operator) })} className="vs-filter-op" />
        : <span className="vs-filter-where">{group.operator === 'and' ? t('E', 'And') : t('Ou', 'Or')}</span>
      if (child.kind === 'group') {
        const childId = child.id ?? ''
        return (
          <div key={childId} className="vs-filter-line">
            <span className="vs-filter-prefix">{prefix}</span>
            <div className="vs-filter-group">
              {renderGroup(child, depth + 1)}
              <div className="vs-filter-group-actions">
                <button type="button" className="vs-link" data-vs-nav onClick={(e) => setPicker({ el: e.currentTarget, groupId: childId })}><Icon name="plus" size={14} /> {t('Adicionar filtro', 'Add filter rule')}</button>
                <button type="button" className="vs-link vs-link--muted" data-vs-nav onClick={() => save({ filterTree: ungroupFilterGroup(tree, childId) })}>{t('Desagrupar', 'Ungroup')}</button>
              </div>
            </div>
          </div>
        )
      }
      const filter = view.filters.find((f) => f.id === child.filterId)
      const prop = filter && props.find((p) => p.id === filter.propertyId)
      if (!filter || !prop) return null
      return (
        <div key={filter.id} className="vs-filter-line">
          <span className="vs-filter-prefix">{prefix}</span>
          <div className="vs-filter-rule">
            <Dropdown value={prop.id} options={props.map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={14} /> }))} className="vs-filter-prop"
              onChange={(id) => { const next = props.find((p) => p.id === id); if (next) updateFilter(filter.id, { ...newFilterFor(next), id: filter.id }) }} />
            <Dropdown<FilterOp> value={filter.op} options={filterOpsFor(prop.type).map((op) => ({ value: op, label: filterOperatorLabel(op) }))} onChange={(op) => updateFilter(filter.id, { op })} className="vs-filter-cond" />
            <button type="button" className="vs-icon-btn" data-vs-nav aria-label={t('Remover filtro', 'Remove filter')} title={t('Remover filtro', 'Remove filter')} onClick={() => remove(filter.id)}><Icon name="close" size={14} /></button>
            <FilterValue key={`${filter.id}:${prop.id}:${filter.op}`} prop={prop} filter={filter} update={(patch) => updateFilter(filter.id, patch)} />
          </div>
        </div>
      )
    })
  }
  return (
    <>
      {view.filters.length === 0 && <div className="vs-empty vs-empty--hint">{t('Nenhum filtro. Filtros mostram só as linhas que atendem às condições.', 'No filters. Filters show only rows that match the conditions.')}</div>}
      <div className="vs-filters">{tree.kind === 'group' && renderGroup(tree, 0)}</div>
      <NavRow icon={<Icon name="plus" size={16} />} label={t('Adicionar filtro', 'Add filter rule')} chevron={false} disabled={!props.length} onClick={(e) => setPicker({ el: e.currentTarget })} />
      <NavRow icon={<Icon name="plus" size={16} />} label={t('Adicionar grupo de filtros', 'Add filter group')} chevron={false} disabled={!props.length} onClick={(e) => setPicker({ el: e.currentTarget, newGroup: true })} />
      {view.filters.length > 0 && <NavRow icon={<Icon name="trash" size={16} />} label={t('Excluir filtros', 'Delete filters')} danger chevron={false} onClick={() => save({ filters: [], filterTree: undefined })} />}
      {picker && <PropertyPicker schema={schema} anchor={picker.el} title={t('Filtrar por…', 'Filter by…')} onClose={() => setPicker(null)} onPick={(p) => { add(p, picker.groupId, picker.newGroup); setPicker(null) }} />}
    </>
  )
}

// ---------- Ordenar ----------

export function SortScreen({ ctx }: ScreenProps) {
  const { db, schema, view } = ctx
  const [picker, setPicker] = useState<Element | null>(null)
  const sorts = view.sorts.filter((s) => schema.properties.some((p) => p.id === s.propertyId))
  const setSorts = (next: Sort[]) => actions.updateView(db.id, view.id, { sorts: next })
  const used = sorts.map((s) => s.propertyId)
  const reorder = useReorder((id, targetId, after) => { const order = moveId(used, id, targetId, after); setSorts(order.map((pid) => sorts.find((s) => s.propertyId === pid)!)) }, true)
  return (
    <>
      {!sorts.length && <div className="vs-empty vs-empty--hint">{t('Nenhuma ordenação. A ordem manual das linhas é usada.', 'No sorts. Rows use their manual order.')}</div>}
      <div className="vs-sorts">
        {sorts.map((s, i) => (
          <div key={s.propertyId} className={`vs-sort${reorder.dragId === s.propertyId ? ' is-dragging' : ''}`} {...reorder.target(s.propertyId)}>
            <span className="vs-grip" {...reorder.handle(s.propertyId)} title={t('Arraste para reordenar', 'Drag to reorder')}><Icon name="grip" size={14} /></span>
            <Dropdown value={s.propertyId} className="vs-sort-prop" options={schema.properties.filter((p) => p.id === s.propertyId || !used.includes(p.id)).map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={14} /> }))} onChange={(id) => setSorts(sorts.map((x, j) => j === i ? { ...x, propertyId: id } : x))} />
            <Dropdown<'asc' | 'desc'> value={s.direction} options={[{ value: 'asc', label: t('Crescente', 'Ascending') }, { value: 'desc', label: t('Decrescente', 'Descending') }]} onChange={(direction) => setSorts(sorts.map((x, j) => j === i ? { ...x, direction } : x))} />
            <button type="button" className="vs-icon-btn" data-vs-nav aria-label={t('Remover ordenação', 'Remove sort')} title={t('Remover ordenação', 'Remove sort')} onClick={() => setSorts(sorts.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
      <NavRow icon={<Icon name="plus" size={16} />} label={t('Adicionar ordenação', 'Add sort')} chevron={false} disabled={used.length >= schema.properties.length} onClick={(e) => setPicker(e.currentTarget)} />
      {sorts.length > 0 && <NavRow icon={<Icon name="trash" size={16} />} label={t('Excluir ordenações', 'Delete sorts')} danger chevron={false} onClick={() => setSorts([])} />}
      {picker && <PropertyPicker schema={schema} anchor={picker} title={t('Ordenar por…', 'Sort by…')} exclude={used} onClose={() => setPicker(null)} onPick={(p) => { setSorts([...sorts, { propertyId: p.id, direction: 'asc' }]); setPicker(null) }} />}
    </>
  )
}
