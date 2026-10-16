// Tipos na página: chips + "+ Tipo" (cabeçalho), campos do tipo (mesmo layout de RowProperties,
// editores existentes) e a sugestão "#Livro → Aplicar tipo Livro?". docs/USAGE.md
import { Fragment, useMemo, useState } from 'react'
import { ArrowUpRight, Plus, Settings2, Table2, Trash2, X } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { Page, Property, PropValue, PropType } from '../../types'
import { PropDisplay } from '../database/PropDisplay'
import { PropTypeIcon } from '../database/icons'
import { PageIcon } from '../page/PageIcon'
import { PropertyEditor } from '../database/editors/PropertyEditor'
import { openUrl } from '../database/editors/TextEditor'
import { resolveValue, isComputedProperty } from '../database/derived'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep } from '../database/ui/Popover'
import { propertyTypeLabel } from '../database/labels'
import { effectiveProperties, FIELD_TYPES, isEmptyValue, orphanTypeValues, pageTypeFields, pageTypes, readTypeProps, typeDataHidden, typeSchemaId, typeTagsIn, type ObjectType } from '../../objecttypes/model'
import { addField, convertField, deleteField, moveField, objectTypes, purgeOrphans, removeType, reorderField, restorableTypes, updateField } from '../../objecttypes/actions'
import { useReorder } from './useReorder'
import { openTypeCollection, openTypesManager } from '../../objecttypes/ui'
import { TypePicker, applyTypeFlow } from './TypePicker'
import '../database/dbview.css'
import './objecttypes.css'
import { Button } from '../ui/Button'

/** Valor de um campo de tipo (campos automáticos — criado em/por — vêm da página). */
export function typeFieldValue(page: Page, property: Property, pages: Record<string, Page>): PropValue {
  if (typeDataHidden(page)) return null
  return resolveValue({ ...page, props: readTypeProps(objectTypes(), page) }, property, pages)
}

export function TypeHeader({ page, locked }: { page: Page; locked: boolean }) {
  const { t } = useI18n()
  useStore()
  const [picker, setPicker] = useState<Element | null>(null)
  const [menu, setMenu] = useState<{ type: ObjectType; el: Element } | null>(null)
  const types = pageTypes(objectTypes(), page)
  if (page.database || (locked && !types.length)) return null
  return <div className={`ot-head${types.length ? '' : ' ot-head--empty'}`} data-ot="head">
    {types.map((type) => <span key={type.id} className={`ot-chip db-color-${type.color}`} role="button" tabIndex={0} title={type.description || type.name} onClick={(e) => setMenu({ type, el: e.currentTarget })} onKeyDown={(e) => { if (e.key === 'Enter') setMenu({ type, el: e.currentTarget }) }}>
      {type.icon && <span className="ot-chip-icon" aria-hidden><PageIcon value={type.icon} style={{ width: 14, height: 14 }} /></span>}
      <span className="ot-chip-name">{type.name}</span>
      {!locked && <span className="ot-chip-x" role="button" aria-label={t('Remover tipo {name}', 'Remove type {name}', { name: type.name })} onClick={(e) => { e.stopPropagation(); removeType([page.id], type.id) }}><X size={12} /></span>}
    </span>)}
    {!locked && <button type="button" className="ot-add" aria-expanded={!!picker} aria-haspopup="menu" onClick={(e) => setPicker(picker ? null : e.currentTarget)}><Plus size={14} /> {t('Tipo', 'Type')}</button>}
    {picker && <TypePicker pageIds={[page.id]} anchor={picker} onClose={() => setPicker(null)} />}
    {menu && <TypeChipPopover page={page} type={menu.type} anchor={menu.el} locked={locked} onClose={() => setMenu(null)} />}
  </div>
}

/** Popover do chip: o que o tipo traz (campos), abrir a coleção, editar e remover (mantendo ou descartando valores). */
export function TypeChipPopover({ page, type, anchor, locked, onClose }: { page: Page; type: ObjectType; anchor: Element; locked: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const [removing, setRemoving] = useState(false)
  const fields = effectiveProperties(objectTypes(), type.id)
  const filled = fields.filter((prop) => !isEmptyValue(readTypeProps(objectTypes(), page)[prop.id] ?? null)).length
  return <DbPopover anchor={anchor} onClose={onClose} label={type.name} className="ot-chip-pop">
    <Menu width={280}>
      {!removing ? <>
        <div className="ot-chip-pop-head" data-ot="chip-pop">
          <span className={`ot-chip-pop-icon db-color-${type.color}`} aria-hidden>{type.icon ? <PageIcon value={type.icon} style={{ width: 16, height: 16 }} /> : null}</span>
          <div><strong>{type.name}</strong>{type.description && <span>{type.description}</span>}</div>
        </div>
        {fields.length > 0 && <div className="ot-chip-pop-fields" aria-label={t('Campos do tipo', 'Type fields')}>{fields.slice(0, 8).map((prop) => <span key={prop.id}><PropTypeIcon type={prop.type} />{prop.name}</span>)}{fields.length > 8 && <span>+{fields.length - 8}</span>}</div>}
        <MenuItem icon={<Table2 size={16} />} label={t('Abrir coleção', 'Open collection')} onClick={() => { onClose(); openTypeCollection(type.id) }} />
        <MenuItem icon={<Settings2 size={16} />} label={t('Editar tipo', 'Edit type')} onClick={() => { onClose(); openTypesManager(type.id, 'fields') }} />
        {!locked && <><MenuSep /><MenuItem danger icon={<Trash2 size={16} />} label={t('Remover tipo desta página…', 'Remove type from this page…')} onClick={() => setRemoving(true)} /></>}
      </> : <>
        <MenuLabel>{filled ? t('Remover {name}? {n} campo(s) preenchido(s).', 'Remove {name}? {n} filled field(s).', { name: type.name, n: filled }) : t('Remover {name} desta página?', 'Remove {name} from this page?', { name: type.name })}</MenuLabel>
        <MenuItem label={t('Remover e manter os valores', 'Remove and keep the values')} hint={t('dá para restaurar', 'can restore')} onClick={() => { onClose(); removeType([page.id], type.id) }} />
        <MenuItem danger label={t('Remover e descartar os valores', 'Remove and discard the values')} onClick={() => { onClose(); removeType([page.id], type.id, { discard: true }) }} />
        <MenuSep />
        <MenuItem label={t('Cancelar', 'Cancel')} onClick={() => setRemoving(false)} />
      </>}
    </Menu>
  </DbPopover>
}

/** Campos do tipo que a página mostra: sem os que o banco da linha já tem (mesmo id), que ficam em "Propriedades". */
function visibleTypeFields(page: Page) {
  const rowSchema = selectors.parentDatabase(page.id)?.database
  return pageTypeFields(objectTypes(), page).filter((field) => !rowSchema?.properties.some((p) => p.id === field.property.id))
}

/** Linhas dos campos do tipo, sem moldura: dentro de RowProperties formam a MESMA lista dos campos do banco (uma tabela só,
 *  só com uma divisória sutil e o tooltip "Campo do tipo X" quando a origem muda); em páginas soltas, o TypeFields as agrupa. */
export function TypeFieldRows({ page, locked, divideFirst = false, groupLabels = false }: { page: Page; locked: boolean; divideFirst?: boolean; groupLabels?: boolean }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [editing, setEditing] = useState<{ propId: string; typeId: string; el: Element } | null>(null)
  const [fieldMenu, setFieldMenu] = useState<{ prop: Property; type: ObjectType; el: Element } | null>(null)
  const types = objectTypes()
  // Reordenar os campos próprios de cada tipo (alça no hover ou ⌥↑/⌥↓); os herdados ficam no tipo de origem.
  const ownerOf = (id: string) => types.find((candidate) => candidate.properties.some((p) => p.id === id))
  const reorder = useReorder(
    (id, targetId, after) => { const owner = ownerOf(id); if (owner) reorderField(owner.id, id, targetId, after) },
    (id, delta) => { const owner = ownerOf(id); if (owner) moveField(owner.id, id, delta) },
    { enabled: !locked, canMove: (id) => !!ownerOf(id), canDrop: (id, targetId) => !!ownerOf(id) && ownerOf(id) === ownerOf(targetId) },
  )
  const fields = typeDataHidden(page) ? [] : visibleTypeFields(page)
  if (page.database || !fields.length) return null
  const editingProp = editing ? fields.find((field) => field.property.id === editing.propId)?.property : undefined
  const onValueClick = (prop: Property, typeId: string, el: Element, e: React.MouseEvent) => {
    if (locked || isComputedProperty(prop) || ['createdTime', 'updatedTime', 'createdBy', 'updatedBy'].includes(prop.type)) return
    const value = typeFieldValue(page, prop, pages)
    if (prop.type === 'url' && e.metaKey && typeof value === 'string' && value) return openUrl(value)
    if (prop.type === 'checkbox') return actions.setProp(page.id, prop.id, value !== true)
    setEditing({ propId: prop.id, typeId, el })
  }
  const groups = new Map<string, { type: ObjectType; props: Property[] }>()
  for (const { type, property } of fields) { let group = groups.get(type.id); if (!group) groups.set(type.id, (group = { type, props: [] })); group.props.push(property) }
  return <>
    {[...groups.values()].map(({ type, props }, groupIndex) => <Fragment key={type.id}>
      {groupLabels && groups.size > 1 && <div className="ot-fields-group"><span className={`ot-dot db-color-${type.color}`} />{type.icon && <PageIcon value={type.icon} style={{ width: 14, height: 14 }} />} {type.name}</div>}
      {props.map((prop, index) => {
        const value = typeFieldValue(page, prop, pages)
        const empty = isEmptyValue(value) && prop.type !== 'checkbox'
        const readOnly = locked || ['createdTime', 'updatedTime', 'createdBy', 'updatedBy'].includes(prop.type)
        const origin = index === 0 && (groupIndex > 0 || divideFirst) && !groupLabels
        return <div key={prop.id} className={`dbv-rp-row${origin ? ' dbv-rp-row--origin' : ''}`} role="row" data-prop={prop.id} data-type-field={type.id} {...reorder.row(prop.id)}>
          {reorder.grip(prop.id, prop.name)}
          <button type="button" className="dbv-rp-name" disabled={locked} title={t('Campo do tipo {name}', '{name} type field', { name: type.name })} onClick={(e) => setFieldMenu({ prop, type, el: e.currentTarget })}><PropTypeIcon type={prop.type} /><span>{prop.name}</span></button>
          <div className={`dbv-rp-value${readOnly ? ' dbv-rp-value--ro' : ''}`} role="cell" onClick={(e) => onValueClick(prop, type.id, e.currentTarget, e)}>
            {empty ? <span className="dbv-rp-empty">{t('Vazio', 'Empty')}</span> : <PropDisplay property={prop} value={value} rowId={page.id} />}
            {prop.type === 'url' && !empty && <button type="button" className="dbv-icon-btn" style={{ marginLeft: 6, width: 20, height: 20 }} title={t('Abrir link', 'Open link')} onClick={(e) => { e.stopPropagation(); openUrl(String(value)) }}><ArrowUpRight size={14} /></button>}
          </div>
        </div>
      })}
    </Fragment>)}
    {editing && editingProp && editing.el.isConnected && <PropertyEditor key={editingProp.id} dbId={typeSchemaId(editing.typeId)} property={editingProp} value={typeFieldValue(page, editingProp, pages)} anchor={editing.el} rowId={page.id} onChange={(v) => actions.setProp(page.id, editingProp.id, v)} onClose={() => setEditing(null)} />}
    {fieldMenu && <FieldMenu prop={fieldMenu.prop} type={fieldMenu.type} anchor={fieldMenu.el} onClose={() => setFieldMenu(null)} />}
  </>
}

export function TypeFields({ page, locked }: { page: Page; locked: boolean }) {
  const { t } = useI18n()
  useStore()
  const [adding, setAdding] = useState<{ type: ObjectType; el: Element } | null>(null)
  const types = objectTypes()
  // Linha de banco: os campos do tipo moram na lista única de RowProperties; aqui ficam só os avisos.
  const inRow = !!selectors.parentDatabase(page.id)?.database
  const fields = visibleTypeFields(page)
  const orphans = page.typeProps ? orphanTypeValues(types, page) : []
  if (page.database) return null
  if (typeDataHidden(page) && fields.length) return <p className="ot-locked">{t('Campos ocultos enquanto a página estiver trancada.', 'Fields hidden while the page is locked.')}</p>
  if (!fields.length && !orphans.length && !page.types?.length) return null
  const restorable = orphans.length ? restorableTypes(page) : []
  const pageTypeList = pageTypes(types, page)
  return <div className="ot-fields" data-ot="fields">
    {!inRow && fields.length > 0 && <div className="dbv-rowprops" role="table" aria-label={t('Campos do tipo', 'Type fields')}>
      <TypeFieldRows page={page} locked={locked} groupLabels />
      {!locked && pageTypeList.map((type) => <button key={type.id} type="button" className="dbv-rp-add" onClick={(e) => setAdding({ type, el: e.currentTarget })}><Plus size={16} /><span>{pageTypeList.length > 1 ? t('Adicionar campo a {name}', 'Add a field to {name}', { name: type.name }) : t('Adicionar um campo', 'Add a field')}</span></button>)}
    </div>}
    {!inRow && !fields.length && !locked && pageTypeList.map((type) => <button key={type.id} type="button" className="dbv-rp-add" onClick={(e) => setAdding({ type, el: e.currentTarget })}><Plus size={16} /><span>{t('Adicionar um campo a {name}', 'Add a field to {name}', { name: type.name })}</span></button>)}
    {orphans.length > 0 && <div className="ot-orphans" role="status">
      <span>{t('{n} valor(es) guardado(s) de tipos removidos', '{n} kept value(s) from removed types', { n: orphans.length })}</span>
      {!locked && restorable.map((type) => <button key={type.id} type="button" onClick={() => void applyTypeFlow([page.id], type.id)}>{t('Restaurar {name}', 'Restore {name}', { name: type.name })}</button>)}
      {!locked && <button type="button" onClick={() => { if (window.confirm(t('Descartar os valores guardados? Isso não pode ser desfeito depois de fechar o aviso.', 'Discard the kept values? This cannot be undone after the notice closes.'))) purgeOrphans(page.id) }}>{t('Descartar', 'Discard')}</button>}
    </div>}
    {adding && <FieldTypeMenu anchor={adding.el} onClose={() => setAdding(null)} onPick={(type) => { addField(adding.type.id, type); setAdding(null) }} />}
  </div>
}

/** Lista de tipos de campo permitidos em tipos de objeto. */
export function FieldTypeMenu({ anchor, current, onPick, onClose }: { anchor: Element; current?: PropType; onPick: (type: PropType) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const list = FIELD_TYPES.filter((type) => propertyTypeLabel(type).toLowerCase().includes(query.trim().toLowerCase()))
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Tipo do campo', 'Field type')}>
    <Menu width={240}>
      <div className="dbv-input-wrap"><input autoFocus className="dbv-input" placeholder={t('Buscar tipo de campo…', 'Search field type…')} aria-label={t('Buscar tipo de campo', 'Search field type')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0]) } }} /></div>
      <MenuLabel>{t('Tipo do campo', 'Field type')}</MenuLabel>
      {list.map((type) => <MenuItem key={type} icon={<PropTypeIcon type={type} />} label={propertyTypeLabel(type)} checked={current === type} onClick={() => onPick(type)} />)}
    </Menu>
  </DbPopover>
}

/** Menu do nome do campo na página: renomear, mudar tipo (conversão segura), excluir, editar tipo. */
function FieldMenu({ prop, type, anchor, onClose }: { prop: Property; type: ObjectType; anchor: Element; onClose: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(prop.name)
  const [typeMenu, setTypeMenu] = useState<Element | null>(null)
  const owner = useMemo(() => objectTypes().find((candidate) => candidate.properties.some((p) => p.id === prop.id)) ?? type, [prop.id, type])
  const commit = () => { const next = name.trim(); if (next && next !== prop.name) updateField(owner.id, prop.id, { name: next }) }
  return <DbPopover anchor={anchor} onClose={() => { commit(); onClose() }} className="ot-fieldmenu" label={prop.name}>
    <Menu width={260}>
      <div className="dbv-input-wrap"><input autoFocus className="dbv-input" aria-label={t('Nome do campo', 'Field name')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); onClose() } }} /></div>
      {owner.id !== type.id && <MenuLabel>{t('Herdado de {name}', 'Inherited from {name}', { name: owner.name })}</MenuLabel>}
      <MenuItem icon={<PropTypeIcon type={prop.type} />} label={t('Tipo: {type}', 'Type: {type}', { type: propertyTypeLabel(prop.type) })} onClick={(e) => setTypeMenu(e.currentTarget)} />
      <MenuItem icon={<Settings2 size={16} />} label={t('Editar tipo “{name}”…', 'Edit “{name}” type…', { name: owner.name })} onClick={() => { commit(); onClose(); openTypesManager(owner.id, 'fields') }} />
      <MenuSep />
      <MenuItem danger icon={<Trash2 size={16} />} label={t('Excluir campo do tipo', 'Delete field from type')} onClick={() => { deleteField(owner.id, prop.id); onClose() }} />
    </Menu>
    {typeMenu && <FieldTypeMenu anchor={typeMenu} current={prop.type} onClose={() => setTypeMenu(null)} onPick={(next) => { setTypeMenu(null); if (next !== prop.type) convertField(owner.id, prop.id, next); onClose() }} />}
  </DbPopover>
}

/** Faixa "Aplicar tipo X?" quando o título/corpo cita `#X` e a página ainda não tem o tipo. */
const dismissed = new Set<string>()
export function TypeTagSuggestion({ page, locked }: { page: Page; locked: boolean }) {
  const { t } = useI18n()
  useStore()
  const [, force] = useState(0)
  if (locked || page.database) return null
  const tags = typeTagsIn(`${page.title}\n${page.text}`, objectTypes(), page).filter((type) => !dismissed.has(`${page.id}:${type.id}`))
  const type = tags[0]
  if (!type) return null
  return <div className="ot-suggest" role="status" data-ot="suggest">
    <span>{t('Esta página cita', 'This page mentions')} <strong>#{type.name}</strong>. {t('Aplicar tipo {name}?', 'Apply type {name}?', { name: type.name })}</span>
    <Button variant="primary" onClick={() => void applyTypeFlow([page.id], type.id).catch(actions.reportSaveError)}>{type.icon && <PageIcon value={type.icon} style={{ width: 14, height: 14 }} />} {t('Aplicar', 'Apply')}</Button>
    <Button onClick={() => { dismissed.add(`${page.id}:${type.id}`); force((n) => n + 1) }}>{t('Ignorar', 'Dismiss')}</Button>
  </div>
}
