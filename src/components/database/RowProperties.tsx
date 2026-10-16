// Painel de propriedades exibido na página de uma linha de banco de dados (entre o título e o corpo).
import { Fragment, useRef, useState } from 'react'
import { ArrowUpRight, Plus } from 'lucide-react'
import { actions, getState, selectors, useStore } from '../../store'
import type { Property } from '../../types'
import { getValue, isEmptyValue } from './lib'
import { PropDisplay } from './PropDisplay'
import { PropTypeIcon } from './icons'
import { PropertyEditor } from './editors/PropertyEditor'
import { openUrl } from './editors/TextEditor'
import { NewPropertyMenu, PropertyMenu } from './PropertyMenu'
import { addProperty, moveProperty } from './schemaOps'
import { moveRelative } from '../../objecttypes/adjust'
import { announceReorder, useReorder } from '../objecttypes/useReorder'
import { isComputedProperty } from './derived'
import { CellComments } from './CellComments'
import { canAssignSubitemParent, subitemsFor, unresolvedDependencies } from './engines'
import { t } from '../../i18n'
import './dbview.css'
import { Select } from '../ui/Select'
import { TypeFieldRows, FieldTypeMenu } from '../objecttypes/PageTypes'
import { PageIcon } from '../page/PageIcon'
import { DbPopover, Menu, MenuItem, MenuLabel } from './ui/Popover'
import { objectTypes, addField } from '../../objecttypes/actions'
import { pageTypes, pageTypeFields, typeDataHidden, type ObjectType } from '../../objecttypes/model'

/** Reordena uma propriedade na página da linha: dentro da seção, ou na ordem do banco (vale para todas as linhas). */
function moveRowProperty(dbId: string, id: string, targetId: string, after: boolean) {
  const schema = getState().pages[dbId]?.database
  if (!schema || id === targetId) return
  const sections = schema.rowLayout?.sections ?? []
  const section = sections.find((item) => item.propertyIds.includes(id))
  if (section) {
    if (!section.propertyIds.includes(targetId)) return
    const ids = moveRelative(section.propertyIds.map((value) => ({ id: value })), id, targetId, after).map((item) => item.id)
    actions.updateSchema(dbId, (current) => ({ ...current, rowLayout: { ...current.rowLayout, sections: current.rowLayout?.sections?.map((item) => (item.id === section.id ? { ...item, propertyIds: ids } : item)) } }))
  } else {
    if (sections.some((item) => item.propertyIds.includes(targetId))) return
    moveProperty(dbId, id, targetId, after)
  }
  announceReorder(t('Ordem dos campos alterada para todas as páginas deste banco', 'Field order changed for every page in this database'), () => { actions.undoDatabase() }, t('Desfazer', 'Undo'))
}

/** Menu único "+ Adicionar campo": seção "Neste banco" (propriedade do banco) e seção "Neste tipo" (campo de cada tipo da página). */
function AddFieldChooser({ anchor, types, onDb, onType, onClose }: { anchor: Element; types: ObjectType[]; onDb: () => void; onType: (type: ObjectType) => void; onClose: () => void }) {
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Adicionar campo', 'Add field')}>
    <Menu width={260}>
      <MenuLabel>{t('Neste banco', 'In this database')}</MenuLabel>
      <MenuItem icon={<Plus size={16} />} label={t('Propriedade do banco', 'Database property')} onClick={onDb} />
      <MenuLabel>{t('Neste tipo', 'In this type')}</MenuLabel>
      {types.map((type) => <MenuItem key={type.id} icon={type.icon ? <PageIcon value={type.icon} style={{ width: 16, height: 16 }} /> : <Plus size={16} />} label={t('Campo de {name}', '{name} field', { name: type.name })} onClick={() => onType(type)} />)}
    </Menu>
  </DbPopover>
}

export function RowProperties({ pageId, placement = 'main', typeLocked = false }: { pageId: string; placement?: 'main' | 'pinned' | 'details'; typeLocked?: boolean }) {
  useStore()
  const row = selectors.page(pageId)
  const db = selectors.parentDatabase(pageId)
  const [editing, setEditing] = useState<{ propId: string; el: Element } | null>(null)
  const [menu, setMenu] = useState<{ propId: string; el: Element; autoRename?: boolean } | null>(null)
  const [addEl, setAddEl] = useState<Element | null>(null)
  const [chooser, setChooser] = useState<Element | null>(null)
  const [addType, setAddType] = useState<{ type: ObjectType; el: Element } | null>(null)
  const order = useRef<string[]>([])
  const reorder = useReorder(
    (id, targetId, after) => { if (db) moveRowProperty(db.id, id, targetId, after) },
    (id, delta) => { const index = order.current.indexOf(id); const neighbor = order.current[index + delta]; if (db && neighbor) moveRowProperty(db.id, id, neighbor, delta > 0) },
    { enabled: !!db && !db.locked && !row?.locked },
  )
  if (!row || !db?.database) return null

  const schema = db.database
  const readOnly = row.locked
  const schemaLocked = db.locked
  const props = schema.properties.filter((p) => p.type !== 'title' && !schema.rowLayout?.hidden?.includes(p.id) && (placement === 'pinned' ? schema.rowLayout?.pinnedPropertyIds?.includes(p.id) : placement === 'details' ? schema.rowLayout?.detailsPropertyIds?.includes(p.id) : !schema.rowLayout?.pinnedPropertyIds?.includes(p.id) && !schema.rowLayout?.detailsPropertyIds?.includes(p.id)))
  const sections = schema.rowLayout?.sections ?? []
  const assigned = new Set(sections.flatMap((section) => section.propertyIds))
  const orderedProps = [...props.filter((property) => !assigned.has(property.id)), ...sections.flatMap((section) => section.propertyIds.map((id) => props.find((property) => property.id === id)).filter((property): property is Property => !!property))]
  order.current = orderedProps.map((property) => property.id)
  const sectionName = (property: Property) => sections.find((section) => section.propertyIds.includes(property.id))?.name
  const rows = selectors.rows(db.id)
  // Campos do tipo: entram na mesma lista (só no bloco principal); a divisória sutil aparece quando as origens diferem.
  const typeFieldsOn = placement === 'main' && !typeDataHidden(row)
  const typeList = typeFieldsOn && !typeLocked ? pageTypes(objectTypes(), row) : []
  const hasTypeFields = typeFieldsOn && pageTypeFields(objectTypes(), row).some((field) => !schema.properties.some((p) => p.id === field.property.id))
  const canAddDb = !schemaLocked && placement === 'main'
  const onAdd = (el: Element) => {
    if (canAddDb && typeList.length) setChooser(el)
    else if (canAddDb) setAddEl(el)
    else if (typeList.length === 1) setAddType({ type: typeList[0], el })
    else if (typeList.length) setChooser(el)
  }
  const subitems = subitemsFor(row.id, rows)
  const dependencies = (row.dependencyIds ?? []).map((id) => getState().pages[id]).filter((page): page is NonNullable<typeof page> => !!page && !page.trashed)
  const blocking = unresolvedDependencies(row, getState().pages)
  const editingProp = editing ? props.find((p) => p.id === editing.propId) : undefined
  const menuProp = menu ? props.find((p) => p.id === menu.propId) : undefined

  const onValueClick = (p: Property, el: Element, e: React.MouseEvent) => {
    if (readOnly || isComputedProperty(p)) return
    const value = getValue(row, p)
    if (p.type === 'url' && e.metaKey && typeof value === 'string' && value) return openUrl(value)
    if (p.type === 'checkbox') return actions.setProp(row.id, p.id, value !== true)
    setEditing({ propId: p.id, el })
  }

  return (
    <div className={`dbv-rowprops dbv-rowprops-${placement}`} role="table" aria-label={t('Propriedades', 'Properties')}>
      {orderedProps.map((p, index) => {
        const value = getValue(row, p)
        const empty = isEmptyValue(value) && p.type !== 'checkbox' && p.type !== 'button'
        return (
          <Fragment key={p.id}>
          {sectionName(p) && (index === 0 || sectionName(orderedProps[index - 1]) !== sectionName(p)) && <div className="dbv-rp-section">{sectionName(p)}</div>}
          <div className="dbv-rp-row" role="row" data-prop={p.id} {...reorder.row(p.id)}>
            {reorder.grip(p.id, p.name)}
            <button
              type="button"
              className="dbv-rp-name"
              disabled={schemaLocked}
              onClick={(e) => setMenu({ propId: p.id, el: e.currentTarget })}
            >
              {schema.rowLayout?.showPropertyIcons !== false && <PropTypeIcon type={p.type} />}
              <span>{p.name}</span>
            </button>
            <div
              className={`dbv-rp-value${readOnly || isComputedProperty(p) ? ' dbv-rp-value--ro' : ''}`}
              role="cell"
              onClick={(e) => onValueClick(p, e.currentTarget, e)}
            >
              {empty ? <span className="dbv-rp-empty">{t('Vazio', 'Empty')}</span> : <PropDisplay property={p} value={value} rowId={row.id} />}
              {p.type === 'url' && !empty && (
                <button
                  type="button"
                  className="dbv-icon-btn"
                  style={{ marginLeft: 6, width: 20, height: 20 }}
                  title={t('Abrir link', 'Open link')}
                  onClick={(e) => {
                    e.stopPropagation()
                    openUrl(String(value))
                  }}
                >
                  <ArrowUpRight size={14} />
                </button>
              )}
              <CellComments row={row} property={p} />
            </div>
          </div>
          </Fragment>
        )
      })}
      {typeFieldsOn && <TypeFieldRows page={row} locked={typeLocked || readOnly} divideFirst={orderedProps.length > 0} />}
      {placement === 'main' && (canAddDb || typeList.length > 0) && (
        <button type="button" className="dbv-rp-add" aria-haspopup="menu" onClick={(e) => onAdd(e.currentTarget)}>
          <Plus size={16} />
          <span>{canAddDb && !typeList.length && !hasTypeFields ? t('Adicionar uma propriedade', 'Add a property') : t('Adicionar campo', 'Add field')}</span>
        </button>
      )}
      {placement === 'main' && <div className="dbv-rowlinks">
        <label>{t('Subitem de', 'Subitem of')}<Select disabled={readOnly} value={row.subitemParentId ?? ''} onChange={(event) => actions.updatePage(row.id, { subitemParentId: event.target.value || null })}><option value="">{t('Nenhum', 'None')}</option>{rows.filter((candidate) => canAssignSubitemParent(row.id, candidate.id, getState().pages)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title || t('Sem título', 'Untitled')}</option>)}</Select></label>
        <div><strong>{t('Subitens', 'Subitems')} ({subitems.length})</strong>{subitems.map((child) => <button type="button" key={child.id} onClick={() => actions.openPeek(child.id)}>{child.title || t('Sem título', 'Untitled')}</button>)}{!readOnly && <button type="button" onClick={() => { const id = actions.createRow(db.id, {}, { subitemParentId: row.id }); actions.openPeek(id) }}>{t('Adicionar subitem', 'Add subitem')}</button>}</div>
        <div><strong>{t('Dependências', 'Dependencies')} ({dependencies.length})</strong>{dependencies.map((dependency) => <span key={dependency.id} className={blocking.some((page) => page.id === dependency.id) ? 'dbv-dependency-blocking' : 'dbv-dependency-done'}><button type="button" onClick={() => actions.openPeek(dependency.id)}>{dependency.title || t('Sem título', 'Untitled')}</button>{!readOnly && <button type="button" aria-label={t('Remover dependência', 'Remove dependency')} onClick={() => actions.updatePage(row.id, { dependencyIds: row.dependencyIds?.filter((id) => id !== dependency.id) })}>×</button>}</span>)}{!readOnly && <Select value="" aria-label={t('Adicionar dependência', 'Add dependency')} onChange={(event) => { if (event.target.value) actions.updatePage(row.id, { dependencyIds: [...new Set([...(row.dependencyIds ?? []), event.target.value])] }) }}><option value="">{t('Adicionar dependência…', 'Add dependency…')}</option>{rows.filter((candidate) => candidate.id !== row.id && !row.dependencyIds?.includes(candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title || t('Sem título', 'Untitled')}</option>)}</Select>}</div>
      </div>}

      {editing && editingProp && editing.el.isConnected && (
        <PropertyEditor
          key={editingProp.id}
          dbId={db.id}
          property={editingProp}
          value={getValue(row, editingProp)}
          anchor={editing.el}
          onChange={(v) => actions.setProp(row.id, editingProp.id, v)}
          onClose={() => setEditing(null)}
          rowId={row.id}
        />
      )}
      {menu && menuProp && (
        <PropertyMenu
          key={menuProp.id}
          dbId={db.id}
          property={menuProp}
          anchor={menu.el}
          readOnly={schemaLocked}
          autoRename={menu.autoRename}
          onClose={() => setMenu(null)}
        />
      )}
      {chooser && <AddFieldChooser anchor={chooser} types={typeList} onClose={() => setChooser(null)} onDb={() => { const el = chooser; setChooser(null); if (canAddDb) setAddEl(el) }} onType={(type) => { const el = chooser; setChooser(null); setAddType({ type, el }) }} />}
      {addType && <FieldTypeMenu anchor={addType.el} onClose={() => setAddType(null)} onPick={(kind) => { addField(addType.type.id, kind); setAddType(null) }} />}
      {addEl && (
        <NewPropertyMenu
          anchor={addEl}
          onClose={() => setAddEl(null)}
          onPick={(t) => {
            const el = addEl
            setAddEl(null)
            const id = addProperty(db.id, t)
            // A linha nova aparece no próximo render; ancora o menu de renomear nela.
            requestAnimationFrame(() => {
              const nameEl = el.parentElement?.querySelector(`[data-prop="${id}"] .dbv-rp-name`)
              setMenu({ propId: id, el: nameEl ?? el, autoRename: true })
            })
          }}
        />
      )}
    </div>
  )
}
