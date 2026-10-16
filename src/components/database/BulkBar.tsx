// Barra flutuante de seleção (como no Export Bundle): "N selecionadas" · lixeira · ⋯ (duplicar, alterar
// propriedade, copiar links, exportar CSV). Fica acima do banco e acompanha a rolagem.
import { useState } from 'react'
import { actions, api, getState } from '../../store'
import type { DatabaseSchema, Page, Property, PropValue } from '../../types'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep } from './ui/Popover'
import { isComputedProperty } from './derived'
import { exportCsv } from './csv'
import { PropTypeIcon } from './icons'
import { Icon } from '../ui/icons'
import { copyText } from '../../clipboard'
import { t } from '../../i18n'

/** Valores que uma ação em lote pode aplicar a uma propriedade (vazio = limpar). */
export function bulkChoices(prop: Property): { label: string; value: PropValue | undefined; add?: string }[] {
  if (prop.type === 'checkbox') return [{ label: t('Marcado', 'Checked'), value: true }, { label: t('Desmarcado', 'Unchecked'), value: false }]
  if (prop.type === 'select' || prop.type === 'status') return [...(prop.options ?? []).map((o) => ({ label: o.name, value: o.id })), { label: t('Vazio', 'Empty'), value: null }]
  if (prop.type === 'multiSelect') return [...(prop.options ?? []).map((o) => ({ label: t('Adicionar {name}', 'Add {name}', { name: o.name }), value: undefined, add: o.id })), { label: t('Limpar', 'Clear'), value: [] }]
  return [{ label: t('Limpar valor', 'Clear value'), value: null }]
}

export function applyBulkValue(rows: Page[], prop: Property, choice: { value: PropValue | undefined; add?: string }) {
  for (const row of rows) {
    if (row.locked) continue
    if (choice.add) {
      const cur = Array.isArray(row.props?.[prop.id]) ? (row.props[prop.id] as string[]) : []
      if (!cur.includes(choice.add)) actions.setProp(row.id, prop.id, [...cur, choice.add])
    } else actions.setProp(row.id, prop.id, choice.value as PropValue)
  }
}

export function BulkBar({ dbId, title, schema, rows, readOnly, onClear, onDone }: {
  dbId: string
  title: string
  schema: DatabaseSchema
  rows: Page[]
  /** Banco bloqueado ou multifonte: sem ações destrutivas nem edição. */
  readOnly: boolean
  onClear: () => void
  /** Mensagem de resultado (ex.: "3 linhas movidas para a lixeira"), com desfazer quando houver. */
  onDone?: (message: string, undo?: boolean) => void
}) {
  const [menu, setMenu] = useState<{ el: Element; kind: 'more' | 'props' | 'values'; propId?: string } | null>(null)
  const editable = schema.properties.filter((p) => p.type !== 'title' && !isComputedProperty(p) && ['checkbox', 'select', 'status', 'multiSelect', 'text', 'number', 'url', 'email', 'phone', 'date'].includes(p.type))
  const prop = menu?.propId ? schema.properties.find((p) => p.id === menu.propId) : undefined
  const editableRows = rows.filter((r) => !r.locked)
  const label = rows.length === 1 ? t('1 selecionada', '1 selected') : t('{n} selecionadas', '{n} selected', { n: rows.length })
  const trash = () => {
    if (readOnly || !editableRows.length) return
    actions.trackDbUndo(t('Excluir linhas', 'Delete rows'), dbId, () => editableRows.forEach((r) => actions.trashPage(r.id)))
    onClear()
    onDone?.(editableRows.length === 1 ? t('1 linha movida para a lixeira', '1 row moved to trash') : t('{n} linhas movidas para a lixeira', '{n} rows moved to trash', { n: editableRows.length }), true)
  }
  const trashLabel = editableRows.length === 1 ? t('Excluir 1 linha', 'Delete 1 row') : t('Excluir {n} linhas', 'Delete {n} rows', { n: editableRows.length })
  const close = () => setMenu(null)
  return (
    <div className="tb-bulk" role="toolbar" aria-label={t('Ações em lote', 'Bulk actions')}>
      <button type="button" className="tb-bulk-count" title={t('Limpar seleção', 'Clear selection')} onClick={onClear}>{label}</button>
      <button type="button" className={`tb-bulk-btn${menu ? ' is-open' : ''}`} aria-label={t('Mais ações', 'More actions')} title={t('Mais ações', 'More actions')} aria-haspopup="menu" onClick={(e) => setMenu(menu ? null : { el: e.currentTarget, kind: 'more' })}><Icon name="more" size={16} /></button>
      <button type="button" className="tb-bulk-btn tb-bulk-btn--danger" aria-label={trashLabel} title={trashLabel} disabled={readOnly || !editableRows.length} onClick={trash}><Icon name="trash" size={16} /></button>
      {menu?.kind === 'more' && (
        <DbPopover anchor={menu.el} ignore={menu.el} onClose={close} label={t('Ações da seleção', 'Selection actions')}>
          <Menu width={240}>
            <MenuItem icon={<Icon name="copy" size={16} />} label={t('Duplicar', 'Duplicate')} disabled={readOnly} onClick={() => { close(); void (async () => { for (const r of rows) await actions.duplicatePage(r.id) })().catch(actions.reportSaveError); onClear() }} />
            <MenuItem icon={<Icon name="edit-properties" size={16} />} label={t('Alterar propriedade', 'Edit property')} hint={<Icon name="chevron-right" size={14} />} disabled={readOnly || !editable.length} onClick={(e) => setMenu({ el: e.currentTarget, kind: 'props' })} />
            <MenuSep />
            <MenuItem icon={<Icon name="link-view" size={16} />} label={t('Copiar links', 'Copy links')} onClick={() => { close(); void copyText(rows.map((r) => `workspace://page/${r.id}`).join('\n')).then(() => onDone?.(t('{n} links copiados', '{n} links copied', { n: rows.length }))).catch(actions.reportSaveError) }} />
            <MenuItem icon={<Icon name="download" size={16} />} label={t('Exportar seleção como CSV', 'Export selection as CSV')} onClick={() => { close(); void api.exportFile(`${title || 'database'}.csv`, exportCsv(schema, rows, getState().pages)) }} />
            {!readOnly && <><MenuSep /><MenuItem icon={<Icon name="trash" size={16} />} label={t('Mover para a lixeira', 'Move to trash')} danger disabled={!editableRows.length} onClick={() => { close(); trash() }} /></>}
          </Menu>
        </DbPopover>
      )}
      {menu?.kind === 'props' && (
        <DbPopover anchor={menu.el} placement="right-start" onClose={close} label={t('Alterar propriedade', 'Edit property')}>
          <Menu width={220}>
            <MenuLabel>{t('Alterar em {n} linhas', 'Change on {n} rows', { n: editableRows.length })}</MenuLabel>
            {editable.map((p) => <MenuItem key={p.id} icon={<PropTypeIcon type={p.type} />} label={p.name} hint={['text', 'number', 'url', 'email', 'phone', 'date'].includes(p.type) ? t('limpar', 'clear') : <Icon name="chevron-right" size={14} />}
              onClick={(e) => ['text', 'number', 'url', 'email', 'phone', 'date'].includes(p.type) ? (applyBulkValue(rows, p, { value: null }), close()) : setMenu({ el: e.currentTarget, kind: 'values', propId: p.id })} />)}
          </Menu>
        </DbPopover>
      )}
      {menu?.kind === 'values' && prop && (
        <DbPopover anchor={menu.el} placement="right-start" onClose={close} label={prop.name}>
          <Menu width={220}>
            <MenuLabel>{prop.name}</MenuLabel>
            {bulkChoices(prop).map((c, i) => <MenuItem key={i} label={c.label} onClick={() => { actions.trackDbUndo(t('Alterar propriedade', 'Edit property'), dbId, () => applyBulkValue(rows, prop, c)); close() }} />)}
          </Menu>
        </DbPopover>
      )}
    </div>
  )
}
