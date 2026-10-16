// Menu de uma propriedade (cabeçalho da coluna / painel de propriedades): renomear, tipo,
// ordenar, filtrar, ocultar, duplicar e excluir.
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Copy, EyeOff, ListFilter, Trash2, Pin, PinOff, WrapText, ArrowRightToLine, Smile, Group, ArrowDownUp, Calendar, Clock, Hash, Plus, X } from 'lucide-react'
import { actions, getState } from '../../store'
import { resolveLinkedRoot } from './linkedSource'
import type { Filter, Property, PropType, SelectOption, View } from '../../types'
import { filterOpsFor } from './lib'
import { matchesPropertyType, propertyTypeLabel } from './labels'
import { PROP_TYPE_ORDER, PropTypeIcon } from './icons'
import { PROP_TYPES_COMMON, PROP_TYPES_MORE } from './propertyTypeGroups'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep, type DbAnchor, type DbPlacement } from './ui/Popover'
import { convertProperty, createOption, deleteProperty, duplicateProperty, renameProperty } from './schemaOps'
import { dbEvents } from './ui/events'
import { isLivePage } from './derived'
import { FormulaEditor } from './editors/FormulaEditor'
import { RelatedRulesEditor } from './RelatedRulesEditor'
import { RelationPropertyConfig } from './DataSourcePicker'
import { AGGREGATION_GROUPS, AGGREGATION_LABELS } from './aggregations'
import { useI18n } from '../../i18n'
import type { ButtonAction } from '../../database-models'
import { appendFilterRule } from './filterTree'
import { formatDisplayDate, formatDisplayTime, type DateDisplayFormat, type TimeDisplayFormat } from './formatting'
import { OptionChip } from './OptionChip'
import { groupLabel, OptionMenu, STATUS_GROUPS } from './OptionMenu'
import './dbview.css'
import { Select } from '../ui/Select'
import { isGroupableType } from './grouping'

export function newFilterFor(prop: Property): Filter {
  return { id: crypto.randomUUID(), propertyId: prop.id, op: filterOpsFor(prop.type)[0], value: prop.type === 'checkbox' ? true : null }
}

export function PropertyMenu(props: {
  dbId: string
  property: Property
  /** Visualização atual (habilita ordenar/filtrar/ocultar). */
  view?: View
  anchor: DbAnchor
  placement?: DbPlacement
  readOnly?: boolean
  viewReadOnly?: boolean
  properties?: Property[]
  /** Foca e seleciona o nome ao abrir (propriedade recém-criada). */
  autoRename?: boolean
  onClose: () => void
}) {
  const { dbId, property, view, readOnly } = props
  const { t, locale } = useI18n()
  const [name, setName] = useState(property.name)
  const nameRef = useRef(name)
  nameRef.current = name
  const inputRef = useRef<HTMLInputElement>(null)
  const [sub, setSub] = useState<{ kind: 'type' | 'sort' | 'group' | 'dateFormat' | 'timeFormat' | 'numberFormat'; el: HTMLElement } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const viewReadOnly = props.viewReadOnly ?? readOnly
  const isTitle = property.type === 'title'
  // Visão vinculada: as propriedades vivem na fonte (docs/USAGE.md).
  const db = getState().pages[resolveLinkedRoot(getState().pages, dbId)]
  const columns = props.properties ?? db?.database?.properties ?? []
  const visibleColumns = columns.filter(p => !view?.hidden.includes(p.id))
  const relations = db?.database?.properties.filter((p) => p.type === 'relation' && p.relationDatabaseId && getState().pages[p.relationDatabaseId]?.database && isLivePage(p.relationDatabaseId, getState().pages)) ?? []
  const rollupRelation = relations.find((p) => p.id === property.rollup?.relationPropertyId)
  const targets = rollupRelation?.relationDatabaseId ? getState().pages[rollupRelation.relationDatabaseId]?.database?.properties ?? [] : []
  const rollupTarget = targets.find((p) => p.id === property.rollup?.targetPropertyId)
  const patchProperty = (patch: Partial<Property>) => actions.updateSchema(dbId, (schema) => ({ ...schema, properties: schema.properties.map((p) => p.id === property.id ? { ...p, ...patch } : p) }))
  const buttonProps = db?.database?.properties.filter((item) => ['text', 'number', 'checkbox', 'select', 'status', 'url', 'email', 'phone', 'person'].includes(item.type)) ?? []
  const defaultActionValue = (item?: Property): string | number | boolean | null => item?.type === 'number' ? 0 : item?.type === 'checkbox' ? false : item?.type === 'select' || item?.type === 'status' ? item.options?.[0]?.id ?? null : ''
  const patchButtonAction = (index: number, next: ButtonAction) => patchProperty({ buttonActions: (property.buttonActions ?? []).map((item, at) => at === index ? next : item) })

  const commitName = () => {
    const n = nameRef.current.trim()
    if (n && n !== property.name) renameProperty(dbId, property.id, n)
  }
  // O nome pode mudar por fora (ex.: relação renomeada para o banco escolhido).
  useEffect(() => { if (document.activeElement !== inputRef.current) setName(property.name) }, [property.name])
  useEffect(() => {
    // Relação nova: o foco vai para a busca "Vincular a uma fonte de dados…", como no Export Bundle.
    if (props.autoRename && !(property.type === 'relation' && !property.relationDatabaseId)) inputRef.current?.select()
    return commitName
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => props.onClose()

  const sort = (direction: 'asc' | 'desc') => {
    if (!view) return
    actions.updateView(dbId, view.id, { sorts: [...view.sorts.filter(item => item.propertyId !== property.id), { propertyId: property.id, direction }] })
    close()
  }

  const filter = () => {
    if (!view) return
    const f = newFilterFor(property)
    actions.updateView(dbId, view.id, { filters: [...view.filters, f], filterTree: appendFilterRule(view.filterTree, view.filters.map((item) => item.id), f.id) })
    close()
    setTimeout(() => dbEvents.emit('openFilter', { dbId, filterId: f.id }), 0)
  }

  const hide = () => {
    if (!view) return
    actions.updateView(dbId, view.id, { hidden: [...view.hidden, property.id] })
    close()
  }

  type Sub = 'type' | 'sort' | 'group' | 'dateFormat' | 'timeFormat' | 'numberFormat'
  const openSub = (kind: Sub) => (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget
    setSub((cur) => (cur?.kind === kind ? null : { kind, el }))
  }
  const closeSub = () => setSub(null)
  const hasOptions = property.type === 'select' || property.type === 'multiSelect' || property.type === 'status'
  const subLabel = (kind: Sub) => kind === 'type' ? t('Tipo da propriedade', 'Property type') : kind === 'sort' ? t('Ordenar', 'Sort') : kind === 'group' ? t('Agrupar por', 'Group by') : kind === 'dateFormat' ? t('Formato da data', 'Date format') : kind === 'timeFormat' ? t('Formato da hora', 'Time format') : t('Formato do número', 'Number format')
  const dateFormats: { value: DateDisplayFormat; label: string }[] = [
    { value: 'full', label: t('Data completa', 'Full date') },
    { value: 'short', label: t('Data curta', 'Short date') },
    { value: 'monthDayYear', label: t('Mês/Dia/Ano', 'Month/Day/Year') },
    { value: 'dayMonthYear', label: t('Dia/Mês/Ano', 'Day/Month/Year') },
    { value: 'yearMonthDay', label: t('Ano/Mês/Dia', 'Year/Month/Day') },
    { value: 'relative', label: t('Relativa', 'Relative') },
  ]
  const timeFormats: { value: TimeDisplayFormat; label: string }[] = [
    { value: '12h', label: t('12 horas', '12 hour') },
    { value: '24h', label: t('24 horas', '24 hour') },
  ]
  const numberFormats: { value: NonNullable<Property['numberFormat']>; label: string }[] = [
    { value: 'number', label: t('Número', 'Number') },
    { value: 'currency', label: t('Moeda', 'Currency') },
    { value: 'percent', label: t('Percentual', 'Percent') },
    { value: 'progress', label: t('Progresso', 'Progress') },
  ]
  const currentTimeFormat: TimeDisplayFormat = property.timeFormat ?? (locale === 'en-US' ? '12h' : '24h')
  const valueHint = (label: string) => <span className="dbv-propmenu-value">{label}<ChevronRight size={14} /></span>

  return (
    <DbPopover anchor={props.anchor} placement={props.placement} onClose={close} className="dbv-propmenu" label={t('Propriedade {name}', 'Property {name}', { name: property.name })}>
      <Menu width={property.type === 'formula' || property.type === 'rollup' || property.type === 'relation' ? 380 : 280}>
        {!readOnly && (
          <div className="dbv-propmenu-name">
            <span className="dbv-propmenu-icon" aria-hidden="true">
              <PropTypeIcon type={property.type} />
            </span>
            <input
              ref={inputRef}
              className="dbv-input"
              value={name}
              aria-label={t('Nome da propriedade', 'Property name')}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitName()
                  close()
                }
              }}
            />
          </div>
        )}
        {readOnly && <div className="dbv-propmenu-title"><span className="dbv-menu-icon"><PropTypeIcon type={property.type} /></span><span>{property.name}</span></div>}

        {/* Tipo e opções do tipo */}
        {!readOnly && !isTitle && (
          <>
            <MenuSep />
            <MenuItem icon={<PropTypeIcon type={property.type} />} label={t('Tipo', 'Type')} hint={valueHint(propertyTypeLabel(property.type))} active={sub?.kind === 'type'} onClick={openSub('type')} />
            {property.type === 'date' && (
              <>
                <MenuItem icon={<Calendar size={16} />} label={t('Formato da data', 'Date format')} hint={valueHint(dateFormats.find((f) => f.value === (property.dateFormat ?? 'full'))!.label)} active={sub?.kind === 'dateFormat'} onClick={openSub('dateFormat')} />
                <MenuItem icon={<Clock size={16} />} label={t('Formato da hora', 'Time format')} hint={valueHint(timeFormats.find((f) => f.value === currentTimeFormat)!.label)} active={sub?.kind === 'timeFormat'} onClick={openSub('timeFormat')} />
              </>
            )}
            {property.type === 'number' && (
              <>
                <MenuItem icon={<Hash size={16} />} label={t('Formato do número', 'Number format')} hint={valueHint(numberFormats.find((f) => f.value === (property.numberFormat ?? 'number'))!.label)} active={sub?.kind === 'numberFormat'} onClick={openSub('numberFormat')} />
                {property.numberFormat === 'currency' && <div className="db-property-config"><label htmlFor={`currency-${property.id}`}>{t('Código da moeda', 'Currency code')}</label><input id={`currency-${property.id}`} className="dbv-input" value={property.currency ?? (locale === 'en-US' ? 'USD' : 'BRL')} maxLength={3} onChange={(e) => patchProperty({ currency: e.target.value.toUpperCase() })} /></div>}
              </>
            )}
            {hasOptions && <PropertyOptions dbId={dbId} property={property} />}
            {hasOptions && <DependentOptionsConfig dbId={dbId} property={property} onPatch={patchProperty} />}
          </>
        )}
        {!readOnly && property.type === 'formula' && <div className="db-property-config">
          <label htmlFor={`formula-${property.id}`}>{t('Fórmula', 'Formula')}</label>
          <FormulaEditor dbId={dbId} property={property} onChange={(formula) => patchProperty({ formula })} />
        </div>}
        {!readOnly && property.type === 'relation' && <RelationPropertyConfig dbId={dbId} property={property} onPatch={patchProperty} onClose={close} />}
        {!readOnly && property.type === 'uniqueId' && <div className="db-property-config"><label>{t('Prefixo do ID', 'ID prefix')}</label><input className="dbv-input" value={property.uniqueIdPrefix ?? ''} onChange={(e) => patchProperty({ uniqueIdPrefix: e.target.value })} /></div>}
        {!readOnly && property.type === 'button' && <div className="db-property-config">
          <label>{t('Ações do botão', 'Button actions')}</label>
          {(property.buttonActions ?? []).map((action, index) => {
            const selected = action.kind === 'setProperty' ? buttonProps.find((item) => item.id === action.propertyId) : undefined
            return <div className="db-button-action" key={index}>
              <Select block value={action.kind} onChange={(event) => {
                const kind = event.target.value as ButtonAction['kind']
                const next: ButtonAction = kind === 'setProperty' ? { kind, propertyId: buttonProps[0]?.id ?? '', value: defaultActionValue(buttonProps[0]) } : kind === 'setTitle' ? { kind, value: '' } : kind === 'createRow' ? { kind } : kind === 'duplicateRow' ? { kind } : { kind: 'archiveRow' }
                patchButtonAction(index, next)
              }}>
                <option value="setProperty">{t('Definir propriedade', 'Set property')}</option><option value="setTitle">{t('Definir título', 'Set title')}</option><option value="createRow">{t('Criar linha', 'Create row')}</option><option value="duplicateRow">{t('Duplicar linha', 'Duplicate row')}</option><option value="archiveRow">{t('Mover para lixeira', 'Move to trash')}</option>
              </Select>
              {action.kind === 'setProperty' && <>
                <Select block value={action.propertyId} onChange={(event) => { const item = buttonProps.find((candidate) => candidate.id === event.target.value); patchButtonAction(index, { ...action, propertyId: event.target.value, value: defaultActionValue(item) }) }}><option value="">{t('Propriedade', 'Property')}</option>{buttonProps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
                {selected?.type === 'checkbox' ? <label className="db-button-boolean"><input type="checkbox" checked={action.value === true} onChange={(event) => patchButtonAction(index, { ...action, value: event.target.checked })} />{t('Marcado', 'Checked')}</label> : selected && ['select', 'status'].includes(selected.type) ? <Select block value={String(action.value ?? '')} onChange={(event) => patchButtonAction(index, { ...action, value: event.target.value || null })}><option value="">{t('Vazio', 'Empty')}</option>{selected.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select> : <input className="dbv-input" type={selected?.type === 'number' ? 'number' : 'text'} value={String(action.value ?? '')} onChange={(event) => patchButtonAction(index, { ...action, value: selected?.type === 'number' ? event.target.value ? Number(event.target.value) : null : event.target.value })} />}
              </>}
              {action.kind === 'setTitle' && <input className="dbv-input" value={action.value} onChange={(event) => patchButtonAction(index, { ...action, value: event.target.value })} />}
              {action.kind === 'createRow' && <Select block value={action.templateId ?? ''} onChange={(event) => patchButtonAction(index, { ...action, templateId: event.target.value || undefined })}><option value="">{t('Sem modelo', 'No template')}</option>{db?.database?.templates?.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</Select>}
              <button type="button" className="dbv-link" onClick={() => patchProperty({ buttonActions: (property.buttonActions ?? []).filter((_, at) => at !== index) })}>{t('Remover ação', 'Remove action')}</button>
            </div>
          })}
          <button type="button" className="dbv-link" onClick={() => patchProperty({ buttonActions: [...(property.buttonActions ?? []), { kind: 'duplicateRow' }] })}>{t('Adicionar ação', 'Add action')}</button>
        </div>}
        {!readOnly && property.type === 'rollup' && <div className="db-property-config">
          <small>{t('Agrega os valores das páginas vinculadas por uma relação.', 'Aggregates values from pages linked through a relation.')}</small>
          {!relations.length && <small role="status">{t('Adicione uma propriedade Relação e escolha o banco relacionado para configurar este Rollup.', 'Add a Relation property and choose its related database to configure this Rollup.')}</small>}
          <label htmlFor={`rollup-relation-${property.id}`}>{t('Relação', 'Relation')}</label>
          <Select id={`rollup-relation-${property.id}`} block disabled={!relations.length} value={rollupRelation?.id ?? ''} onChange={(e) => patchProperty({ rollup: { relationPropertyId: e.target.value, targetPropertyId: '', aggregation: 'count' } })}>
            <option value="">{t('Escolha uma relação', 'Choose a relation')}</option>
            {relations.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label htmlFor={`rollup-target-${property.id}`}>{t('Propriedade relacionada', 'Related property')}</label>
          <Select id={`rollup-target-${property.id}`} block disabled={!rollupRelation} value={rollupTarget?.id ?? ''} onChange={(e) => patchProperty({ rollup: { ...property.rollup, relationPropertyId: rollupRelation!.id, targetPropertyId: e.target.value, aggregation: property.rollup?.aggregation ?? 'count' } })}>
            <option value="">{t('Escolha uma propriedade', 'Choose a property')}</option>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label htmlFor={`rollup-calculate-${property.id}`}>{t('Calcular', 'Calculate')}</label>
          <Select id={`rollup-calculate-${property.id}`} block disabled={!rollupTarget} value={property.rollup?.aggregation ?? 'count'} onChange={(e) => patchProperty({ rollup: { ...property.rollup, relationPropertyId: rollupRelation!.id, targetPropertyId: rollupTarget!.id, aggregation: e.target.value as NonNullable<Property['rollup']>['aggregation'] } })}>
            {AGGREGATION_GROUPS.map((group) => <optgroup key={group.label[0]} label={t(...group.label)}>{group.kinds.map((aggregation) => <option key={aggregation} value={aggregation}>{t(...AGGREGATION_LABELS[aggregation])}</option>)}</optgroup>)}
          </Select>
          {rollupRelation && <>
            <label>{t('Filtrar páginas relacionadas', 'Filter related pages')}</label>
            <small>{t('Só as páginas que atendem às regras entram no cálculo.', 'Only pages matching the rules are aggregated.')}</small>
            <RelatedRulesEditor databaseId={rollupRelation.relationDatabaseId} rules={property.rollup?.filter ?? []} operator={property.rollup?.filterOperator ?? 'and'} onChange={(filter, filterOperator) => patchProperty({ rollup: { ...property.rollup!, filter: filter.length ? filter : undefined, filterOperator } })} />
          </>}
        </div>}

        {/* Ações da visualização */}
        {view && !viewReadOnly && (
          <>
            <MenuSep />
            {isTitle && view.type === 'table' && <MenuItem icon={<Smile size={16} />} label={t('Mostrar ícone da página', 'Show page icon')} checked={view.showPageIcon !== false} onClick={() => { actions.updateView(dbId, view.id, { showPageIcon: view.showPageIcon === false }); close() }} />}
            <MenuItem icon={<ListFilter size={16} />} label={t('Filtrar', 'Filter')} onClick={filter} />
            <MenuItem icon={<ArrowDownUp size={16} />} label={t('Ordenar', 'Sort')} hint={<ChevronRight size={14} className="dbv-propmenu-caret" />} active={sub?.kind === 'sort'} onClick={openSub('sort')} />
            {['table', 'list', 'gallery', 'feed'].includes(view.type) && <MenuItem icon={<Group size={16} />} label={t('Agrupar', 'Group')} hint={<ChevronRight size={14} className="dbv-propmenu-caret" />} active={sub?.kind === 'group'} onClick={openSub('group')} />}
            {view.type === 'table' && <>
              <MenuItem icon={<Pin size={16} />} label={t('Congelar até esta coluna', 'Freeze through this column')} checked={visibleColumns.findIndex(p => p.id === property.id) < (view.frozenColumns ?? 0)} onClick={() => {
                const count = visibleColumns.findIndex(p => p.id === property.id) + 1
                actions.updateView(dbId, view.id, { frozenColumns: (view.frozenColumns ?? 0) === count ? 0 : count }); close()
              }} />
              {(view.frozenColumns ?? 0) > 0 && <MenuItem icon={<PinOff size={16} />} label={t('Descongelar colunas', 'Unfreeze columns')} onClick={() => { actions.updateView(dbId, view.id, { frozenColumns: 0 }); close() }} />}
              <MenuItem icon={view.wrappedColumns?.includes(property.id) ? <ArrowRightToLine size={16} /> : <WrapText size={16} />} label={view.wrappedColumns?.includes(property.id) ? t('Recolher conteúdo', 'Unwrap content') : t('Quebrar conteúdo em linhas', 'Wrap content')} onClick={() => {
                const wrapped = view.wrappedColumns ?? []
                actions.updateView(dbId, view.id, { wrappedColumns: wrapped.includes(property.id) ? wrapped.filter(id => id !== property.id) : [...wrapped, property.id] }); close()
              }} />
            </>}
            {!isTitle && <MenuItem icon={<EyeOff size={16} />} label={t('Ocultar na visualização', 'Hide in view')} onClick={hide} />}
          </>
        )}

        {/* Duplicar / excluir */}
        {!readOnly && !isTitle && (
          <>
            <MenuSep />
            <MenuItem
              icon={<Copy size={16} />}
              label={t('Duplicar propriedade', 'Duplicate property')}
              onClick={() => {
                duplicateProperty(dbId, property.id)
                close()
              }}
            />
            <MenuItem
              icon={<Trash2 size={16} />}
              label={confirmDelete ? t('Clique de novo para excluir', 'Click again to delete') : t('Excluir propriedade', 'Delete property')}
              danger
              active={confirmDelete}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true)
                nameRef.current = property.name
                deleteProperty(dbId, property.id)
                close()
              }}
            />
          </>
        )}
      </Menu>
      {sub && (
        <DbPopover anchor={sub.el} placement="right-start" onClose={closeSub} label={subLabel(sub.kind)}>
          {sub.kind === 'type' && <PropertyTypeMenu current={property.type} onPick={(type) => {
            commitName()
            convertProperty(dbId, property.id, type)
            closeSub()
          }} />}
          {sub.kind === 'sort' && view && <Menu>
            <MenuItem icon={<ArrowUp size={16} />} label={t('Crescente', 'Ascending')} checked={view.sorts.some(item => item.propertyId === property.id && item.direction === 'asc')} onClick={() => sort('asc')} />
            <MenuItem icon={<ArrowDown size={16} />} label={t('Decrescente', 'Descending')} checked={view.sorts.some(item => item.propertyId === property.id && item.direction === 'desc')} onClick={() => sort('desc')} />
            {view.sorts.some(item => item.propertyId === property.id) && <><MenuSep /><MenuItem icon={<X size={16} />} label={t('Remover ordenação', 'Remove sort')} onClick={() => { actions.updateView(dbId, view.id, { sorts: view.sorts.filter(item => item.propertyId !== property.id) }); close() }} /></>}
          </Menu>}
          {sub.kind === 'group' && view && <Menu>
            <MenuItem label={t('Sem agrupamento', 'No grouping')} checked={!view.groupBy} onClick={() => { actions.updateView(dbId, view.id, { groupBy: undefined, subgroupBy: undefined, hiddenGroups: [] }); close() }} />
            {columns.filter(p => isGroupableType(p.type)).map(p => <MenuItem key={p.id} icon={<PropTypeIcon type={p.type} />} label={p.name} checked={view.groupBy === p.id} onClick={() => { actions.updateView(dbId, view.id, { groupBy: p.id, subgroupBy: undefined, hiddenGroups: [] }); close() }} />)}
          </Menu>}
          {sub.kind === 'dateFormat' && <Menu>
            {dateFormats.map((f) => <MenuItem key={f.value} label={f.label} hint={formatDisplayDate(EXAMPLE_DATE, locale, { dateFormat: f.value, today: f.value === 'relative' ? new Date(2026, 9, 8) : undefined })} checked={(property.dateFormat ?? 'full') === f.value} onClick={() => { patchProperty({ dateFormat: f.value === 'full' ? undefined : f.value }); closeSub() }} />)}
          </Menu>}
          {sub.kind === 'timeFormat' && <Menu>
            {timeFormats.map((f) => <MenuItem key={f.value} label={f.label} hint={formatDisplayTime('14:30', locale, f.value)} checked={currentTimeFormat === f.value} onClick={() => { patchProperty({ timeFormat: f.value }); closeSub() }} />)}
          </Menu>}
          {sub.kind === 'numberFormat' && <Menu>
            {numberFormats.map((f) => <MenuItem key={f.value} label={f.label} checked={(property.numberFormat ?? 'number') === f.value} onClick={() => { patchProperty({ numberFormat: f.value }); closeSub() }} />)}
          </Menu>}
        </DbPopover>
      )}
    </DbPopover>
  )
}

const EXAMPLE_DATE = '2026-10-08'

/** Lista de opções (seleção / multisseleção / status) dentro do menu da propriedade.
 *  Status aparece agrupado em "A fazer / Em andamento / Concluído", como no Export Bundle. */
function PropertyOptions({ dbId, property }: { dbId: string; property: Property }) {
  const { t } = useI18n()
  const isStatus = property.type === 'status'
  const options = property.options ?? []
  const [adding, setAdding] = useState<NonNullable<SelectOption['group']> | 'all' | null>(null)
  const [draft, setDraft] = useState('')
  const [menuFor, setMenuFor] = useState<{ id: string; el: Element } | null>(null)
  const sections: { key: NonNullable<SelectOption['group']> | 'all'; label: string; options: SelectOption[] }[] = isStatus
    ? STATUS_GROUPS.map((group) => ({ key: group, label: groupLabel(group), options: options.filter((o) => (o.group ?? 'todo') === group) }))
    : [{ key: 'all', label: t('Opções', 'Options'), options }]
  const commit = (key: NonNullable<SelectOption['group']> | 'all') => {
    const n = draft.trim()
    if (n && !options.some((o) => o.name.toLowerCase() === n.toLowerCase())) createOption(dbId, property.id, n, key === 'all' ? 'todo' : key)
    setDraft('')
  }
  const editing = menuFor ? options.find((o) => o.id === menuFor.id) : undefined
  return (
    <div className="dbv-propopts">
      {sections.map((section) => (
        <div key={section.key} className="dbv-propopts-group">
          <div className="dbv-propopts-head">
            <span>{section.label}</span>
            <button type="button" className="dbv-icon-btn dbv-propopts-add" aria-label={t('Adicionar opção em {group}', 'Add option to {group}', { group: section.label })} title={t('Adicionar opção', 'Add option')} onClick={() => { setDraft(''); setAdding(section.key) }}>
              <Plus size={14} />
            </button>
          </div>
          {section.options.map((o) => (
            <button key={o.id} type="button" className={`dbv-menu-item dbv-propopts-row${menuFor?.id === o.id ? ' dbv-menu-item--active' : ''}`} onClick={(e) => { const el = e.currentTarget; setMenuFor((cur) => cur?.id === o.id ? null : { id: o.id, el }) }}>
              <span className="dbv-propopts-chip"><OptionChip name={o.name} color={o.color} custom={o.customColor} dot={isStatus} /></span>
              <ChevronRight size={14} className="dbv-propmenu-caret" />
            </button>
          ))}
          {adding === section.key && (
            <div className="dbv-propopts-new">
              <input
                autoFocus
                className="dbv-input"
                value={draft}
                placeholder={t('Nome da opção', 'Option name')}
                aria-label={t('Nova opção', 'New option')}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { commit(section.key); setAdding(null) }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') { e.preventDefault(); commit(section.key) }
                }}
              />
            </div>
          )}
          {!section.options.length && adding !== section.key && !isStatus && <div className="dbv-propopts-empty">{t('Nenhuma opção ainda', 'No options yet')}</div>}
        </div>
      ))}
      {menuFor && editing && (
        <OptionMenu dbId={dbId} propId={property.id} option={editing} isStatus={isStatus} anchor={menuFor.el} onClose={() => setMenuFor(null)} />
      )}
    </div>
  )
}

/** Menu de escolha de tipo ao criar uma propriedade nova. */
export function NewPropertyMenu(props: { anchor: DbAnchor; placement?: DbPlacement; onPick: (t: PropType) => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <DbPopover anchor={props.anchor} placement={props.placement} onClose={props.onClose} label={t('Nova propriedade', 'New property')}>
      <PropertyTypeMenu onPick={props.onPick} />
    </DbPopover>
  )
}

function PropertyTypeMenu({ current, onPick }: { current?: PropType; onPick: (type: PropType) => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [more, setMore] = useState(false)
  const searching = !!query.trim()
  const common = PROP_TYPES_COMMON.filter((type) => matchesPropertyType(type, query))
  const rest = [...PROP_TYPES_MORE, ...PROP_TYPE_ORDER.filter((type) => !PROP_TYPES_COMMON.includes(type) && !PROP_TYPES_MORE.includes(type))].filter((type) => matchesPropertyType(type, query))
  const types = searching || more ? [...common, ...rest] : common
  const item = (type: PropType) => <MenuItem key={type} icon={<PropTypeIcon type={type} />} label={propertyTypeLabel(type)} checked={current === type} onClick={() => onPick(type)} />
  return <Menu width={250}>
    <div className="dbv-input-wrap">
      <input autoFocus className="dbv-input" aria-label={t('Buscar tipo de propriedade', 'Search property type')} placeholder={t('Buscar tipo de propriedade…', 'Search property type…')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && types.length) { e.preventDefault(); onPick(types[0]) }
      }} />
    </div>
    {common.length > 0 && <MenuLabel>{searching ? t('Resultados', 'Results') : t('Comuns', 'Common')}</MenuLabel>}
    {common.map(item)}
    {(searching || more) && rest.length > 0 && <><MenuSep /><MenuLabel>{searching ? t('Outros tipos', 'Other types') : t('Mais tipos', 'More types')}</MenuLabel>{rest.map(item)}</>}
    {!searching && !more && <MenuItem icon={<ChevronRight size={16} />} label={t('Mais', 'More')} hint={`${rest.length}`} onClick={() => setMore(true)} />}
    {!types.length && <MenuLabel>{t('Nenhum tipo encontrado', 'No property types found')}</MenuLabel>}
  </Menu>
}

/** Seleção dependente: escolhe a propriedade-mãe e, para cada opção, em quais opções da mãe ela aparece. */
function DependentOptionsConfig({ dbId, property, onPatch }: { dbId: string; property: Property; onPatch: (patch: Partial<Property>) => void }) {
  const { t } = useI18n()
  const parents = getState().pages[resolveLinkedRoot(getState().pages, dbId)]?.database?.properties.filter((p) => p.id !== property.id && ['select', 'status', 'multiSelect'].includes(p.type) && p.dependsOn?.propertyId !== property.id) ?? []
  const parent = parents.find((p) => p.id === property.dependsOn?.propertyId)
  const links = property.dependsOn?.links ?? {}
  const toggle = (childId: string, parentId: string) => {
    const current = links[childId] ?? []
    const next = current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId]
    const nextLinks = { ...links, [childId]: next }
    if (!next.length) delete nextLinks[childId]
    onPatch({ dependsOn: { propertyId: parent!.id, links: nextLinks } })
  }
  return <div className="db-property-config db-dependent">
    <label htmlFor={`depends-${property.id}`}>{t('Opções dependem de', 'Options depend on')}</label>
    <Select id={`depends-${property.id}`} block value={parent?.id ?? ''} onChange={(event) => onPatch({ dependsOn: event.target.value ? { propertyId: event.target.value, links: event.target.value === property.dependsOn?.propertyId ? links : {} } : undefined })}>
      <option value="">{t('Nenhuma (todas as opções)', 'None (all options)')}</option>
      {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
    {parent && <>
      <small>{t('Marque em quais opções de “{parent}” cada opção aparece. Sem marcação, a opção aparece sempre.', 'Mark which “{parent}” options show each option. Unmarked options always show.', { parent: parent.name })}</small>
      <div className="db-dependent-grid">
        {(property.options ?? []).map((option) => <div className="db-dependent-row" key={option.id}>
          <OptionChip name={option.name} color={option.color} custom={option.customColor} />
          <div className="db-dependent-parents" role="group" aria-label={t('Mostrar “{name}” quando', 'Show “{name}” when', { name: option.name })}>
            {(parent.options ?? []).map((choice) => {
              const on = (links[option.id] ?? []).includes(choice.id)
              return <button type="button" key={choice.id} aria-pressed={on} className={`db-dependent-toggle${on ? ' is-on' : ''}`} onClick={() => toggle(option.id, choice.id)}>{choice.name}</button>
            })}
          </div>
        </div>)}
      </div>
    </>}
  </div>
}
