// Controles da visualização: filtros (pílulas + editor) e ordenação. As demais opções ficam no
// painel "Configurações da visualização" (settings/ViewSettingsPanel.tsx).
import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, ChevronDown, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { actions } from '../../store'
import type { DatabaseSchema, Filter, FilterOp, Property, Sort, View } from '../../types'
import type { FilterTree } from '../../database-models'
import { filterOpsFor, findOption, formatDate, hasOptions } from './lib'
import { filterOperatorLabel } from './labels'
import { OptionChip } from './PropDisplay'
import { PropTypeIcon } from './icons'
import { DbPopover, Dropdown, Menu, MenuItem, type DbAnchor } from './ui/Popover'
import { newFilterFor } from './PropertyMenu'
import { parseNumber } from './schemaOps'
import { dbEvents } from './ui/events'
import { appendFilterRule, filterGroupIds, filterTreeFromIds, moveFilterRule, nestFilterRule, removeFilterRule, setGroupOperator, ungroupFilterGroup } from './filterTree'
import { getLocale, t } from '../../i18n'
import { Select } from '../ui/Select'
import { PAGE_TYPE_FIELD, pageTypeProperty } from '../../query/typeField'
import { registeredTypes } from '../../objecttypes/registry'

/** Propriedades + o campo sintético "Tipo" quando algum filtro o usa (visualização vinda de uma consulta). */
export function filterProperties(schema: DatabaseSchema, view: View): Property[] {
  return view.filters.some((filter) => filter.propertyId === PAGE_TYPE_FIELD) ? [...schema.properties, pageTypeProperty(registeredTypes(), t('Tipo', 'Type'))] : schema.properties
}

// ---------- Escolha de propriedade ----------

export function PropertyPicker(props: {
  schema: DatabaseSchema
  anchor: DbAnchor
  title: string
  exclude?: string[]
  onPick: (p: Property) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = props.schema.properties.filter((p) => !props.exclude?.includes(p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <DbPopover anchor={props.anchor} onClose={props.onClose} label={props.title}>
      <Menu width={240}>
        <div className="dbv-input-wrap">
          <input
            autoFocus
            className="dbv-input"
            placeholder={props.title}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) props.onPick(list[0])
            }}
          />
        </div>
        {list.map((p) => (
          <MenuItem key={p.id} icon={<PropTypeIcon type={p.type} />} label={p.name} onClick={() => props.onPick(p)} />
        ))}
        {!list.length && <div className="dbv-empty">{t('Nenhuma propriedade', 'No properties')}</div>}
      </Menu>
    </DbPopover>
  )
}

// ---------- Filtros ----------

function filterValueText(f: Filter, prop: Property): string {
  if (f.op === 'isEmpty' || f.op === 'isNotEmpty') return ''
  if (prop.type === 'checkbox') return f.value === true ? t('Marcado', 'Checked') : t('Desmarcado', 'Unchecked')
  if (f.value === null || f.value === '') return ''
  if (hasOptions(prop.type)) return findOption(prop, f.value)?.name ?? ''
  if (prop.type === 'date' && typeof f.value === 'string') return formatDate(f.value, prop)
  if (typeof f.value === 'number') return f.value.toLocaleString(getLocale())
  return String(f.value)
}

export function FilterBar(props: { dbId: string; schema: DatabaseSchema; view: View; readOnly: boolean; onOpenSort: (el: Element) => void }) {
  const { dbId, schema, view } = props
  const [openId, setOpenId] = useState<string | null>(null)
  const [addEl, setAddEl] = useState<Element | null>(null)
  const [logicEl, setLogicEl] = useState<Element | null>(null)
  const pillRefs = useRef(new Map<string, HTMLElement>())

  useEffect(
    () =>
      dbEvents.on('openFilter', (p) => {
        if (p.dbId === dbId && p.filterId) setOpenId(p.filterId)
      }),
    [dbId],
  )

  const allProps = filterProperties(schema, view)
  const filters = view.filters.filter((f) => allProps.some((p) => p.id === f.propertyId))
  const open = openId ? filters.find((f) => f.id === openId) : undefined
  const openProp = open ? allProps.find((p) => p.id === open.propertyId) : undefined
  const sorts = view.sorts.filter((s) => schema.properties.some((p) => p.id === s.propertyId))

  return (
    <div className="dbv-filterbar">
      {sorts.length > 0 && (
        <button type="button" className="dbv-pill dbv-pill--set" disabled={props.readOnly} onClick={(e) => props.onOpenSort(e.currentTarget)}>
          <ArrowUpDown size={14} />
          <span>
            {sorts.length === 1
              ? `${schema.properties.find((p) => p.id === sorts[0].propertyId)?.name} ${sorts[0].direction === 'asc' ? '↑' : '↓'}`
              : `${sorts.length} ${t('ordenações', 'sorts')}`}
          </span>
          <ChevronDown size={12} />
        </button>
      )}
      {sorts.length > 0 && filters.length > 0 && <span className="dbv-filterbar-sep" />}
      {filters.map((f) => {
        const prop = allProps.find((p) => p.id === f.propertyId)!
        const val = filterValueText(f, prop)
        const noValue = f.op === 'isEmpty' || f.op === 'isNotEmpty'
        return (
          <button
            key={f.id}
            type="button"
            ref={(el) => {
              if (el) pillRefs.current.set(f.id, el)
              else pillRefs.current.delete(f.id)
            }}
            className={`dbv-pill${val || noValue ? ' dbv-pill--set' : ''}`}
            disabled={props.readOnly}
            onClick={() => setOpenId(f.id)}
          >
            <PropTypeIcon type={prop.type} size={14} />
            <span className="dbv-pill-text">
              <b>{prop.name}</b>
              {(val || noValue) && <span> · {filterOperatorLabel(f.op)}</span>}
              {val && <span> · {val}</span>}
            </span>
            <ChevronDown size={12} />
          </button>
        )
      })}
      {!props.readOnly && <button type="button" className="dbv-pill dbv-pill--add" onClick={(e) => setAddEl(e.currentTarget)}>
        <Plus size={14} />
        <span>{t('Adicionar filtro', 'Add filter')}</span>
      </button>}
      {filters.length > 1 && !props.readOnly && <button type="button" className="dbv-pill" onClick={(event) => setLogicEl(event.currentTarget)}>{view.filterTree ? 'AND / OR' : 'AND'} <ChevronDown size={12} /></button>}

      {open && openProp && pillRefs.current.get(open.id) && (
        <FilterEditor
          key={open.id}
          dbId={dbId}
          view={view}
          filter={open}
          prop={openProp}
          anchor={pillRefs.current.get(open.id)!}
          onClose={() => setOpenId(null)}
        />
      )}
      {addEl && (
        <PropertyPicker
          schema={schema}
          anchor={addEl}
          title={t('Filtrar por…', 'Filter by…')}
          onClose={() => setAddEl(null)}
          onPick={(p) => {
            const f = newFilterFor(p)
            actions.updateView(dbId, view.id, { filters: [...view.filters, f], ...(view.filterTree ? { filterTree: appendFilterRule(view.filterTree, view.filters.map((filter) => filter.id), f.id) } : {}) })
            setAddEl(null)
            setTimeout(() => setOpenId(f.id), 0)
          }}
        />
      )}
      {logicEl && <FilterLogicEditor dbId={dbId} schema={schema} view={view} anchor={logicEl} onClose={() => setLogicEl(null)} />}
    </div>
  )
}

function FilterLogicEditor({ dbId, schema, view, anchor, onClose }: { dbId: string; schema: DatabaseSchema; view: View; anchor: DbAnchor; onClose: () => void }) {
  const tree = view.filterTree ?? filterTreeFromIds(view.filters.map((filter) => filter.id))
  const groups = filterGroupIds(tree)
  const save = (next: FilterTree) => actions.updateView(dbId, view.id, { filterTree: next })
  const groupName = (id: string) => id === 'root' ? t('Raiz', 'Root') : `${t('Grupo', 'Group')} ${groups.indexOf(id)}`
  const render = (node: FilterTree, depth: number): React.ReactNode => node.kind === 'rule' ? <div key={node.filterId} className="dbv-logic-rule" style={{ paddingLeft: depth * 14 }}>
    <span>{filterProperties(schema, view).find((property) => property.id === view.filters.find((filter) => filter.id === node.filterId)?.propertyId)?.name ?? node.filterId}</span>
    <button type="button" onClick={() => save(nestFilterRule(tree, node.filterId, crypto.randomUUID()))} title={t('Criar grupo aninhado', 'Create nested group')}>{t('Agrupar', 'Group')}</button>
    {groups.length > 1 && <Select aria-label={t('Mover condição para grupo', 'Move condition to group')} value="" onChange={(event) => { if (event.target.value) save(moveFilterRule(tree, node.filterId, event.target.value)) }}><option value="">{t('Mover para…', 'Move to…')}</option>{groups.map((id) => <option key={id} value={id}>{groupName(id)}</option>)}</Select>}
  </div> : <div key={node.id ?? 'root'} className="dbv-logic-group" style={{ marginLeft: depth * 12 }}>
    <div className="dbv-logic-head"><strong>{groupName(node.id ?? 'root')}</strong><Dropdown<'and' | 'or'> value={node.operator} options={[{ value: 'and', label: t('Todas (AND)', 'All (AND)') }, { value: 'or', label: t('Qualquer (OR)', 'Any (OR)') }]} onChange={(operator) => save(setGroupOperator(tree, node.id ?? 'root', operator))} />{depth > 0 && <button type="button" onClick={() => save(ungroupFilterGroup(tree, node.id!))}>{t('Desagrupar', 'Ungroup')}</button>}</div>
    {node.children.map((child) => render(child, depth + 1))}
  </div>
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Lógica dos filtros', 'Filter logic')}><div className="dbv-logic"><p>{t('Combine condições com AND/OR. Agrupe uma condição e mova outras para o grupo.', 'Combine conditions with AND/OR. Group a condition and move others into the group.')}</p>{render(tree, 0)}</div></DbPopover>
}

function FilterEditor(props: { dbId: string; view: View; filter: Filter; prop: Property; anchor: DbAnchor; onClose: () => void }) {
  const { dbId, view, filter: f, prop } = props
  const update = (patch: Partial<Filter>) =>
    actions.updateView(dbId, view.id, { filters: view.filters.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) })
  const remove = () => {
    actions.updateView(dbId, view.id, { filters: view.filters.filter((x) => x.id !== f.id), filterTree: removeFilterRule(view.filterTree, f.id) })
    props.onClose()
  }
  const noValue = f.op === 'isEmpty' || f.op === 'isNotEmpty'
  const [text, setText] = useState(() => (f.value === null ? '' : typeof f.value === 'number' ? String(f.value).replace('.', ',') : String(f.value)))

  return (
    <DbPopover anchor={props.anchor} onClose={props.onClose} label={`${t('Filtro', 'Filter')} ${prop.name}`} className="dbv-filter-pop">
      <div className="dbv-filter-head">
        <span className="dbv-filter-prop">
          <PropTypeIcon type={prop.type} size={14} />
          {prop.name}
        </span>
        <Dropdown<FilterOp>
          value={f.op}
          options={filterOpsFor(prop.type).map((op) => ({ value: op, label: filterOperatorLabel(op) }))}
          onChange={(op) => update({ op })}
        />
        <span className="dbv-spacer" />
        <button type="button" className="dbv-icon-btn" title={t('Excluir filtro', 'Delete filter')} onClick={remove}>
          <Trash2 size={14} />
        </button>
      </div>
      {!noValue && (
        <div className="dbv-filter-value">
          {prop.type === 'checkbox' ? (
            <div className="dbv-seg">
              <button type="button" className={f.value === true ? 'on' : ''} onClick={() => update({ value: true })}>
                {t('Marcado', 'Checked')}
              </button>
              <button type="button" className={f.value !== true ? 'on' : ''} onClick={() => update({ value: false })}>
                {t('Desmarcado', 'Unchecked')}
              </button>
            </div>
          ) : prop.type === 'date' || prop.type === 'createdTime' || prop.type === 'updatedTime' ? (
            <input
              type="date"
              className="dbv-input"
              value={typeof f.value === 'string' ? f.value : ''}
              onChange={(e) => update({ value: e.target.value || null })}
            />
          ) : hasOptions(prop.type) ? (
            <div className="dbv-filter-opts">
              {(prop.options ?? []).map((o) => (
                <MenuItem
                  key={o.id}
                  label={<OptionChip name={o.name} color={o.color} custom={o.customColor} dot={prop.type === 'status'} />}
                  checked={f.value === o.id}
                  onClick={() => update({ value: f.value === o.id ? null : o.id })}
                />
              ))}
              {!prop.options?.length && <div className="dbv-empty">{t('Nenhuma opção', 'No options')}</div>}
            </div>
          ) : (
            <input
              autoFocus
              className="dbv-input"
              placeholder={t('Digite um valor…', 'Enter a value…')}
              inputMode={prop.type === 'number' ? 'decimal' : undefined}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (prop.type === 'number' || prop.type === 'formula' || prop.type === 'rollup') update({ value: e.target.value.trim() ? parseNumber(e.target.value) : null })
                else update({ value: e.target.value })
              }}
              onKeyDown={(e) => e.key === 'Enter' && props.onClose()}
            />
          )}
        </div>
      )}
    </DbPopover>
  )
}

// ---------- Ordenação ----------

export function SortPopover(props: { dbId: string; schema: DatabaseSchema; view: View; anchor: DbAnchor; onClose: () => void }) {
  const { dbId, schema, view } = props
  const [addEl, setAddEl] = useState<Element | null>(null)
  const sorts = view.sorts.filter((s) => schema.properties.some((p) => p.id === s.propertyId))
  const setSorts = (next: Sort[]) => actions.updateView(dbId, view.id, { sorts: next })
  const used = sorts.map((s) => s.propertyId)

  return (
    <DbPopover anchor={props.anchor} placement="bottom-end" onClose={props.onClose} label={t('Ordenação', 'Sort')} className="dbv-sort-pop">
      <div className="dbv-sort-list">
        {sorts.map((s, i) => (
          <div key={s.propertyId} className="dbv-sort-row">
            <GripVertical size={14} className="dbv-sort-grip" />
            <Dropdown
              value={s.propertyId}
              options={schema.properties
                .filter((p) => p.id === s.propertyId || !used.includes(p.id))
                .map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={14} /> }))}
              onChange={(id) => setSorts(sorts.map((x, j) => (j === i ? { ...x, propertyId: id } : x)))}
              className="dbv-sort-prop"
            />
            <Dropdown<'asc' | 'desc'>
              value={s.direction}
              options={[
                { value: 'asc', label: t('Crescente', 'Ascending') },
                { value: 'desc', label: t('Decrescente', 'Descending') },
              ]}
              onChange={(direction) => setSorts(sorts.map((x, j) => (j === i ? { ...x, direction } : x)))}
            />
            <span className="dbv-spacer" />
            <button type="button" className="dbv-icon-btn" title={t('Remover ordenação', 'Remove sort')} onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </div>
        ))}
        {!sorts.length && <div className="dbv-empty">{t('Nenhuma ordenação. A ordem manual das linhas é usada.', 'No sort. Rows use their manual order.')}</div>}
      </div>
      <Menu>
        {used.length < schema.properties.length && (
          <MenuItem icon={<Plus size={16} />} label={t('Adicionar ordenação', 'Add sort')} onClick={(e) => setAddEl(e.currentTarget)} />
        )}
        {sorts.length > 0 && (
          <MenuItem
            icon={<Trash2 size={16} />}
            label={t('Excluir ordenação', 'Clear sorting')}
            danger
            onClick={() => {
              setSorts([])
              props.onClose()
            }}
          />
        )}
      </Menu>
      {addEl && (
        <PropertyPicker
          schema={schema}
          anchor={addEl}
          title={t('Ordenar por…', 'Sort by…')}
          exclude={used}
          onClose={() => setAddEl(null)}
          onPick={(p) => {
            setSorts([...sorts, { propertyId: p.id, direction: 'asc' }])
            setAddEl(null)
          }}
        />
      )}
    </DbPopover>
  )
}
