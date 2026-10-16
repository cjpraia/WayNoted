// Telas do painel: agrupar, subgrupo, cor condicional, fonte, propriedades, automações e "mais".
import { useLayoutEffect, useRef, useState } from 'react'
import { actions, getState, selectors } from '../../../store'
import { t } from '../../../i18n'
import { copyText } from '../../../clipboard'
import type { ConditionalColorRule } from '../../../database-models'
import { objectTypes, setNewRowType } from '../../../objecttypes/actions'
import type { Property, View } from '../../../types'
import { Icon } from '../../ui/icons'
import { PageIcon } from '../../page/PageIcon'
import { Dropdown } from '../ui/Popover'
import { PropTypeIcon } from '../icons'
import { hasOptions } from '../lib'
import { optionColorLabel } from '../labels'
import { RULE_COLORS } from '../colorRules'
import { NewPropertyMenu, PropertyMenu } from '../PropertyMenu'
import { addProperty, moveProperty } from '../schemaOps'
import { DatabaseSettings } from '../DatabaseSettings'
import { ChoiceRow, NavRow, SectionLabel, Sep, ToggleRow } from './ui'
import type { ScreenProps } from './types'
import { isGroupableType } from '../grouping'

const groupable = (properties: Property[]) => properties.filter((p) => isGroupableType(p.type))

// ---------- Agrupar ----------

export function GroupScreen({ ctx }: ScreenProps) {
  const { db, schema, view } = ctx
  const update = (patch: Partial<View>) => actions.updateView(db.id, view.id, patch)
  const props = groupable(schema.properties)
  const board = view.type === 'board'
  const current = props.find((p) => p.id === view.groupBy) ?? (board ? props[0] : undefined)
  const groups = current && current.type !== 'relation' && current.type !== 'person' ? [{ id: '__none__', name: t('Sem {name}', 'No {name}', { name: current.name }) }, ...(current.options ?? [])] : []
  const hiddenGroups = view.hiddenGroups ?? []
  const keyOf = (id: string) => `${current!.id}:${id}`
  return (
    <>
      <ChoiceRow id="group-by" icon={<Icon name="group" size={16} />} label={t('Agrupar por', 'Group by')} value={current?.id ?? ''} display={props.length ? undefined : t('Nada para agrupar', 'Nothing to group')} disabled={!props.length}
        choices={[...(board ? [] : [{ value: '', label: t('Nenhum', 'None') }]), ...props.map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={16} /> }))]}
        onChange={(groupBy) => update({ groupBy: groupBy || undefined, hiddenGroups: [], ...(groupBy === view.subgroupBy || !groupBy ? { subgroupBy: undefined } : {}) })} />
      {!props.length && <div className="vs-empty vs-empty--hint">{t('Crie uma propriedade de Seleção, Multisseleção, Status, Relação ou Pessoa para agrupar.', 'Create a Select, Multi-select, Status, Relation or Person property to group by.')}</div>}
      {current && <>
        <ChoiceRow label={t('Ordenar grupos', 'Sort groups')} value={view.groupSort ?? 'manual'} choices={[{ value: 'manual', label: t('Manual', 'Manual') }, { value: 'alphabetical', label: t('Alfabética', 'Alphabetical') }, { value: 'reverse', label: t('Alfabética inversa', 'Reverse alphabetical') }]} onChange={(groupSort) => update({ groupSort: groupSort === 'manual' ? undefined : groupSort })} />
        <ToggleRow label={t('Ocultar grupos vazios', 'Hide empty groups')} checked={view.hideEmptyGroups ?? !board} onChange={(on) => update({ hideEmptyGroups: on })} />
        <ToggleRow label={t('Mostrar contagem', 'Show count')} checked={view.showGroupCount !== false} onChange={(on) => update({ showGroupCount: on })} />
        <SectionLabel action={hiddenGroups.length ? { label: t('Mostrar todos', 'Show all'), onClick: () => update({ hiddenGroups: [] }) } : { label: t('Ocultar todos', 'Hide all'), onClick: () => update({ hiddenGroups: groups.map((g) => keyOf(g.id)) }) }}>{t('Grupos', 'Groups')}</SectionLabel>
        {groups.map((group) => {
          const key = keyOf(group.id)
          const on = !hiddenGroups.includes(key)
          return (
            <div key={key} className="vs-prop">
              <span className="vs-row-label">{group.name}</span>
              <button type="button" className={`vs-eye${on ? '' : ' is-off'}`} data-vs-nav aria-pressed={on} aria-label={on ? t('Ocultar {name}', 'Hide {name}', { name: group.name }) : t('Mostrar {name}', 'Show {name}', { name: group.name })}
                onClick={() => update({ hiddenGroups: on ? [...hiddenGroups, key] : hiddenGroups.filter((item) => item !== key) })}><Icon name={on ? 'eye' : 'eye-off'} size={16} /></button>
            </div>
          )
        })}
        {!board && <><Sep /><NavRow icon={<Icon name="trash" size={16} />} label={t('Remover agrupamento', 'Remove grouping')} danger chevron={false} onClick={() => update({ groupBy: undefined, subgroupBy: undefined, hiddenGroups: [] })} /></>}
      </>}
    </>
  )
}

export function SubgroupScreen({ ctx, push }: ScreenProps) {
  const { db, schema, view } = ctx
  const props = groupable(schema.properties).filter((p) => p.id !== view.groupBy)
  const primary = groupable(schema.properties).find((p) => p.id === view.groupBy)
  if (!primary) return <>
    <div className="vs-empty vs-empty--hint">{t('Agrupe a visualização primeiro; o subgrupo divide cada grupo.', 'Group the view first; sub-groups split each group.')}</div>
    <NavRow id="subgroup-group" icon={<Icon name="group" size={16} />} label={t('Agrupar', 'Group')} onClick={() => push('group', 'subgroup-group')} />
  </>
  return (
    <ChoiceRow icon={<Icon name="subgroup" size={16} />} label={t('Subagrupar por', 'Sub-group by')} value={props.find((p) => p.id === view.subgroupBy)?.id ?? ''} disabled={!props.length}
      choices={[{ value: '', label: t('Nenhum', 'None') }, ...props.map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={16} /> }))]}
      onChange={(subgroupBy) => actions.updateView(db.id, view.id, { subgroupBy: subgroupBy || undefined, hiddenGroups: (view.hiddenGroups ?? []).filter((key) => key.startsWith(`${primary.id}:`)) })} />
  )
}

// ---------- Cor condicional ----------

const RULE_OPERATORS: ConditionalColorRule['operator'][] = ['is', 'isNot', 'contains', 'gt', 'lt', 'isEmpty']
const operatorLabel = (op: ConditionalColorRule['operator']) => op === 'is' ? t('É', 'Is') : op === 'isNot' ? t('Não é', 'Is not') : op === 'contains' ? t('Contém', 'Contains') : op === 'gt' ? t('Maior que', 'Greater than') : op === 'lt' ? t('Menor que', 'Less than') : t('Está vazio', 'Is empty')

export function ColorScreen({ ctx }: ScreenProps) {
  const { db, schema, view } = ctx
  const rules = view.colorRules ?? []
  const save = (next: ConditionalColorRule[]) => actions.updateView(db.id, view.id, { colorRules: next })
  const patch = (id: string, change: Partial<ConditionalColorRule>) => save(rules.map((rule) => rule.id === id ? { ...rule, ...change } : rule))
  const candidates = schema.properties.filter((p) => p.type !== 'title')
  return (
    <>
      {!rules.length && <div className="vs-empty vs-empty--hint">{t('Pinte linhas e cartões que atendem a uma condição. A primeira regra que combinar vence.', 'Color rows and cards that match a condition. The first matching rule wins.')}</div>}
      {rules.map((rule) => {
        const property = schema.properties.find((p) => p.id === rule.propertyId)
        return (
          <div key={rule.id} className="vs-rule">
            <div className="vs-rule-line">
              <Dropdown value={rule.propertyId} className="vs-filter-prop" options={candidates.map((p) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={14} /> }))} onChange={(propertyId) => patch(rule.id, { propertyId, value: '' })} />
              <Dropdown value={rule.operator} options={RULE_OPERATORS.map((op) => ({ value: op, label: operatorLabel(op) }))} onChange={(operator) => patch(rule.id, { operator })} />
              <button type="button" className="vs-icon-btn" data-vs-nav aria-label={t('Remover cor condicional', 'Remove conditional color')} onClick={() => save(rules.filter((item) => item.id !== rule.id))}><Icon name="close" size={14} /></button>
            </div>
            <div className="vs-rule-line">
              {rule.operator !== 'isEmpty' && (property && hasOptions(property.type)
                ? <Dropdown value={String(rule.value ?? '')} className="vs-filter-value" options={[{ value: '', label: t('Escolha…', 'Choose…') }, ...(property.options ?? []).map((o) => ({ value: o.id, label: o.name }))]} onChange={(value) => patch(rule.id, { value })} />
                : <input className="vs-input vs-filter-value" aria-label={t('Valor da condição', 'Condition value')} type={property?.type === 'number' ? 'number' : 'text'} value={String(rule.value ?? '')} onChange={(e) => patch(rule.id, { value: property?.type === 'number' ? Number(e.target.value) : e.target.value })} />)}
              <Dropdown value={rule.color} options={RULE_COLORS.map((color) => ({ value: color, label: optionColorLabel(color), icon: <span className={`vs-swatch db-rule-${color}`} /> }))} onChange={(color) => patch(rule.id, { color })} />
            </div>
          </div>
        )
      })}
      <NavRow icon={<Icon name="plus" size={16} />} label={t('Adicionar regra de cor', 'Add color rule')} chevron={false} disabled={!candidates.length} onClick={() => save([...rules, { id: crypto.randomUUID(), propertyId: candidates[0].id, operator: 'is', value: '', color: 'blue' }])} />
    </>
  )
}

// ---------- Fonte ----------

export function SourceScreen({ ctx, push }: ScreenProps) {
  const { db, schema, rowCount } = ctx
  const linked = db.database?.linkedSourceId
  const sourceIds = [...(linked ? [linked] : schema.sourceDatabaseIds?.length ? [...(schema.properties.length ? [db.id] : []), ...schema.sourceDatabaseIds] : [db.id])]
  return (
    <>
      <SectionLabel>{sourceIds.length > 1 ? t('Fontes de dados', 'Data sources') : t('Fonte de dados', 'Data source')}</SectionLabel>
      {sourceIds.map((id) => {
        const page = selectors.page(id)
        return <NavRow key={id} icon={<PageIcon value={page?.icon ?? null} fallback="database" style={{ width: 16, height: 16 }} />} label={page?.title || t('Sem título', 'Untitled')} value={id === db.id ? t('este banco', 'this database') : t('abrir', 'open')} chevron={id === db.id ? false : 'right'} disabled={id === db.id} onClick={() => actions.openPage(id)} />
      })}
      <div className="vs-note">
        {linked ? t('Esta é uma visualização vinculada: as linhas vivem na fonte e as propriedades são compartilhadas (editar aqui altera a fonte); filtros, ordenação, colunas visíveis e layout são só desta visualização.', 'This is a linked view: rows live at the source and properties are shared (editing here changes the source); filters, sort, visible columns and layout belong to this view only.')
          : sourceIds.length > 1 ? t('Linhas combinadas por nome e tipo de propriedade; edite cada linha na sua fonte.', 'Rows combined by property name and type; edit each row at its source.')
          : t('{props} propriedades · {rows} linhas nesta visualização', '{props} properties · {rows} rows in this view', { props: schema.properties.length, rows: rowCount })}
      </div>
      {!linked && <NavRow id="source-manage" icon={<Icon name="database-source" size={16} />} label={t('Gerenciar fontes de dados', 'Manage data sources')} disabled={ctx.readOnly} onClick={() => push('sources', 'source-manage')} />}
    </>
  )
}

export const SourcesScreen = ({ ctx }: ScreenProps) => <DatabaseSettings dbId={ctx.db.id} schema={ctx.schema} only="sources" />
export const AutomationsScreen = ({ ctx }: ScreenProps) => <DatabaseSettings dbId={ctx.db.id} schema={ctx.schema} only="automations" />
export const TemplatesScreen = ({ ctx }: ScreenProps) => <DatabaseSettings dbId={ctx.db.id} schema={ctx.schema} only="templates" />
export const RowLayoutScreen = ({ ctx }: ScreenProps) => <DatabaseSettings dbId={ctx.db.id} schema={ctx.schema} only="rowLayout" />

// ---------- Editar propriedades ----------

export function PropertiesScreen({ ctx }: ScreenProps) {
  const { db, schema, view, schemaLocked } = ctx
  const [menu, setMenu] = useState<{ id: string; autoRename?: boolean } | null>(null)
  const [menuEl, setMenuEl] = useState<Element | null>(null)
  const [newEl, setNewEl] = useState<Element | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { setMenuEl(menu ? listRef.current?.querySelector(`[data-vs-id="prop-${menu.id}"]`) ?? null : null) }, [menu, schema.properties.length])
  const property = menu ? schema.properties.find((p) => p.id === menu.id) : undefined
  return (
    <>
      {schemaLocked && <div className="vs-note">{db.database?.linkedSourceId ? t('A fonte está bloqueada: desbloqueie-a para editar as propriedades.', 'The source is locked: unlock it to edit properties.') : t('Esquema somente leitura aqui.', 'Schema is read-only here.')}</div>}
      <div ref={listRef}>
        {schema.properties.map((p) => (
          <div key={p.id} className={`vs-prop vs-prop--nav${dragId === p.id ? ' is-dragging' : ''}`}
            onDragOver={(e) => { if (dragId && dragId !== p.id) e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); if (dragId) { const r = e.currentTarget.getBoundingClientRect(); moveProperty(db.id, dragId, p.id, e.clientY > r.top + r.height / 2) } setDragId(null) }}>
            <span className={`vs-grip${schemaLocked ? ' vs-grip--off' : ''}`} draggable={!schemaLocked} onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id) }} onDragEnd={() => setDragId(null)}><Icon name="grip" size={14} /></span>
            <NavRow id={`prop-${p.id}`} icon={<PropTypeIcon type={p.type} size={16} />} label={p.name} value={view.hidden.includes(p.id) ? t('oculta', 'hidden') : ''} active={menu?.id === p.id} onClick={() => setMenu({ id: p.id })} />
          </div>
        ))}
      </div>
      {!schemaLocked && <NavRow icon={<Icon name="plus" size={16} />} label={t('Nova propriedade', 'New property')} chevron={false} onClick={(e) => setNewEl(e.currentTarget)} />}
      {menu && menuEl && property && <PropertyMenu key={property.id} dbId={db.id} property={property} view={view} anchor={menuEl} placement="right-start" readOnly={schemaLocked} viewReadOnly={db.locked} properties={schema.properties} autoRename={menu.autoRename} onClose={() => setMenu(null)} />}
      {newEl && <NewPropertyMenu anchor={newEl} placement="right-start" onClose={() => setNewEl(null)} onPick={(type) => { setNewEl(null); setMenu({ id: addProperty(db.id, type), autoRename: true }) }} />}
    </>
  )
}

// ---------- Mais configurações ----------

export function MoreScreen({ ctx, push, close }: ScreenProps) {
  const { db, schema, readOnly, dataReadOnly } = ctx
  const linked = !!db.database?.linkedSourceId
  const run = (fn: () => void) => () => { close(); fn() }
  const [copied, setCopied] = useState(false)
  return (
    <>
      {!linked && <NavRow id="more-templates" icon={<Icon name="template" size={16} />} label={t('Modelos', 'Templates')} value={schema.templates?.length ? String(schema.templates.length) : ''} disabled={readOnly} onClick={() => push('templates', 'more-templates')} />}
      {!linked && <NavRow id="more-row-layout" icon={<Icon name="document" size={16} />} label={t('Layout da página', 'Page layout')} disabled={readOnly} onClick={() => push('rowLayout', 'more-row-layout')} />}
      {!linked && objectTypes().length > 0 && <ChoiceRow id="more-new-row-type" icon={<Icon name="template" size={16} />} label={t('Tipo das novas linhas', 'Type of new rows')} disabled={readOnly}
        value={schema.newRowTypeId && objectTypes().some((type) => type.id === schema.newRowTypeId) ? schema.newRowTypeId : ''}
        choices={[{ value: '', label: t('Nenhum', 'None') }, ...objectTypes().map((type) => ({ value: type.id, label: type.name || t('Sem nome', 'Untitled') }))]}
        onChange={(typeId) => setNewRowType(db.id, typeId || null)} />}
      <Sep />
      {!dataReadOnly && <NavRow icon={<Icon name="upload" size={16} />} label={t('Importar CSV', 'Import CSV')} chevron={false} disabled={readOnly} onClick={run(ctx.onImportCsv)} />}
      <NavRow icon={<Icon name="download" size={16} />} label={t('Exportar CSV', 'Export CSV')} chevron={false} onClick={run(ctx.onExportCsv)} />
      <NavRow icon={<Icon name="link-view" size={16} />} label={t('Criar visualização vinculada', 'Create linked view')} chevron={false} onClick={run(ctx.onCreateLinked)} />
      <NavRow id="copy-link" icon={<Icon name="link-view" size={16} />} label={copied ? t('Link copiado', 'Link copied') : t('Copiar link da visualização', 'Copy link to view')} chevron={false}
        onClick={() => void copyText(`workspace://page/${db.id}#view=${ctx.view.id}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(actions.reportSaveError)} />
      {ctx.onOpenFull && <NavRow icon={<Icon name="expand" size={16} />} label={t('Abrir como página inteira', 'Open as full page')} chevron={false} onClick={run(ctx.onOpenFull)} />}
      <Sep />
      <NavRow icon={<Icon name="copy" size={16} />} label={t('Duplicar visualização', 'Duplicate view')} chevron={false} disabled={readOnly} onClick={run(ctx.onDuplicateView)} />
      <NavRow icon={<Icon name="trash" size={16} />} label={t('Excluir visualização', 'Delete view')} danger chevron={false} disabled={readOnly || !ctx.canDeleteView} onClick={run(ctx.onDeleteView)} />
      {getState().pages[db.id]?.locked && <div className="vs-note">{t('Banco bloqueado: desbloqueie para editar.', 'Database locked: unlock to edit.')}</div>}
    </>
  )
}
