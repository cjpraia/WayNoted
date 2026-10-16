// Menu da aba de visualização (clique na aba ativa ou botão direito em qualquer aba), como no Export Bundle:
// Renomear · Exibir como › · Editar visualização · Fonte › · Copiar link · Abrir como página inteira ·
// Ocultar títulos da fonte — Duplicar · Excluir. "Exibir como" converte a mesma visualização no lugar.
import { useEffect, useRef, useState } from 'react'
import { actions, selectors } from '../../../store'
import { copyText } from '../../../clipboard'
import { t } from '../../../i18n'
import type { Page, View } from '../../../types'
import { Icon } from '../../ui/icons'
import { DbPopover, Menu, MenuItem, MenuSep, type DbAnchor } from '../ui/Popover'
import { ViewTypeIcon } from '../icons'
import { LAYOUT_TYPES, type SettingsScreen } from './model'

export function viewLink(dbId: string, viewId: string) { return `workspace://page/${dbId}#view=${viewId}` }

export function ViewTabMenu(props: {
  db: Page
  view: View
  anchor: DbAnchor
  canDelete: boolean
  /** Banco aberto embutido/em prévia: oferece "Abrir como página inteira". */
  canOpenFull: boolean
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenSettings: (screen: SettingsScreen) => void
  onClose: () => void
}) {
  const { db, view } = props
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(view.name)
  const [displayEl, setDisplayEl] = useState<HTMLElement | null>(null)
  const [copied, setCopied] = useState(false)
  const nameRef = useRef(name)
  nameRef.current = name
  const commit = () => { const n = nameRef.current.trim(); if (n && n !== view.name) props.onRename(n) }
  useEffect(() => commit, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sourceId = db.database?.linkedSourceId ?? db.id
  const sourceTitle = selectors.page(sourceId)?.title || t('Sem título', 'Untitled')
  const locked = !!db.locked
  const showTitles = view.showSourceTitle !== false
  return (
    <DbPopover anchor={props.anchor} onClose={props.onClose} label={t('Visualização', 'View')} className="vs-tabmenu">
      <Menu width={290}>
        {renaming ? (
          <div className="dbv-input-wrap">
            <input
              autoFocus
              className="dbv-input"
              value={name}
              aria-label={t('Nome da visualização', 'View name')}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onClose() } }}
            />
          </div>
        ) : (
          <MenuItem icon={<Icon name="rename" size={16} />} label={t('Renomear', 'Rename')} disabled={locked} onClick={() => setRenaming(true)} />
        )}
        <MenuItem icon={<ViewTypeIcon type={view.type} size={16} />} label={t('Exibir como', 'Display as')} hint={<Icon name="chevron-right" size={14} />} active={!!displayEl} disabled={locked} onClick={(e) => setDisplayEl(displayEl ? null : e.currentTarget)} />
        <MenuItem icon={<Icon name="view-settings" size={16} />} label={t('Editar visualização', 'Edit view')} onClick={() => { props.onClose(); props.onOpenSettings('main') }} />
        <MenuItem icon={<Icon name="data-source" size={16} />} label={t('Fonte', 'Source')} hint={<span className="vs-tabmenu-hint">{sourceTitle}<Icon name="chevron-right" size={14} /></span>} onClick={() => { props.onClose(); props.onOpenSettings('source') }} />
        <MenuItem icon={<Icon name="link-view" size={16} />} label={copied ? t('Link copiado', 'Link copied') : t('Copiar link da visualização', 'Copy link to view')} onClick={() => void copyText(viewLink(db.id, view.id)).then(() => { setCopied(true); setTimeout(props.onClose, 700) }).catch(actions.reportSaveError)} />
        {props.canOpenFull && <MenuItem icon={<Icon name="arrow-up-right" size={16} />} label={t('Abrir como página inteira', 'Open as full page')} onClick={() => { props.onClose(); actions.openPage(db.id, { viewId: view.id }) }} />}
        <MenuItem icon={<Icon name={showTitles ? 'eye-off' : 'eye'} size={16} />} label={showTitles ? t('Ocultar títulos da fonte de dados', 'Hide data source titles') : t('Mostrar títulos da fonte de dados', 'Show data source titles')} disabled={locked} onClick={() => { actions.updateView(db.id, view.id, { showSourceTitle: !showTitles }); props.onClose() }} />
        <MenuSep />
        <MenuItem icon={<Icon name="copy" size={16} />} label={t('Duplicar visualização', 'Duplicate view')} disabled={locked} onClick={() => { props.onDuplicate(); props.onClose() }} />
        <MenuItem icon={<Icon name="trash" size={16} />} label={t('Excluir visualização', 'Delete view')} danger disabled={locked || !props.canDelete} onClick={() => { nameRef.current = view.name; props.onDelete(); props.onClose() }} />
      </Menu>
      {displayEl && (
        <DbPopover anchor={displayEl} placement="right-start" onClose={() => setDisplayEl(null)} label={t('Exibir como', 'Display as')} className="vs-tabmenu">
          <Menu width={220}>
            {LAYOUT_TYPES.map((item) => (
              <MenuItem key={item.type} icon={<ViewTypeIcon type={item.type} size={16} />} label={t(item.pt, item.en)} checked={view.type === item.type}
                onClick={() => { actions.changeViewType(db.id, view.id, item.type); setDisplayEl(null); props.onClose() }} />
            ))}
          </Menu>
        </DbPopover>
      )}
    </DbPopover>
  )
}
