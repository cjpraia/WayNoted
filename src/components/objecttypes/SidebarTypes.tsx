// Seção "Tipos" da barra lateral: os tipos nativos e os do usuário, sempre (sem contador "0"); cada um abre sua
// coleção como tela própria. Menu do item: ocultar da barra, mover, excluir. docs/USAGE.md
import { useState } from 'react'
import { ArrowDown, ArrowUp, EyeOff, MoreHorizontal, Trash2 } from 'lucide-react'
import { actions, useStore } from '../../store'
import { DND_TYPE, dragSet } from '../sidebar/PageTree'
import { expandTargets } from '../../objecttypes/actions'
import { applyTypeFlow } from './TypePicker'
import { ReviewBadge } from './Harvest'
import { useI18n } from '../../i18n'
import { PageIcon } from '../page/PageIcon'
import { sidebarSectionTypes } from '../../objecttypes/visibility'
import { moveSidebarType, setTypeSidebarHidden } from '../../objecttypes/actions'
import { MenuItem, Popover, menuKeyNav } from '../sidebar/Popover'
import { DeleteTypeDialog } from './TypesManager'
import type { ObjectType } from '../../objecttypes/model'
import { openTypeCollection } from '../../objecttypes/ui'
import './objecttypes.css'

export function SidebarTypes() {
  const { t } = useI18n()
  const { pages, settings, route } = useStore()
  const list = sidebarSectionTypes(pages, settings.objectTypes ?? [], settings.objectTypesPrefs)
  const [menu, setMenu] = useState<{ type: ObjectType; count: number; anchor: DOMRect | { x: number; y: number }; trigger: Element | null } | null>(null)
  const [deleting, setDeleting] = useState<{ type: ObjectType; count: number } | null>(null)
  const ids = list.map((entry) => entry.type.id)
  // Soltar uma página da árvore sobre um tipo aplica o tipo (docs/USAGE.md).
  const [over, setOver] = useState<string | null>(null)
  const accepts = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DND_TYPE)
  return <div role="list" aria-label={t('Tipos', 'Types')}>
    {list.map(({ type, count }) => {
      const active = route.type === 'objectType' && route.id === type.id
      return <div key={type.id} role="listitem" className="ot-sb-item" onContextMenu={(e) => { e.preventDefault(); setMenu({ type, count, anchor: { x: e.clientX, y: e.clientY }, trigger: null }) }}>
      <button type="button" aria-current={active ? 'page' : undefined} className={`sb-row sb-nav${active ? ' sb-row--active' : ''}${over === type.id ? ' sb-row--drop-type' : ''}`} title={type.description || type.name}
        onClick={(e) => openTypeCollection(type.id, e.metaKey || e.ctrlKey)} onAuxClick={(e) => { if (e.button === 1) openTypeCollection(type.id, true) }}
        onDragOver={(e) => { if (!accepts(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (over !== type.id) setOver(type.id) }}
        onDragLeave={() => setOver((current) => current === type.id ? null : current)}
        onDrop={(e) => { if (!accepts(e)) return; e.preventDefault(); e.stopPropagation(); setOver(null); const id = e.dataTransfer.getData(DND_TYPE); if (id) void applyTypeFlow(expandTargets(dragSet(id), false), type.id).catch(actions.reportSaveError) }}>
        <span className="sb-row-icon" aria-hidden>{type.icon ? <PageIcon value={type.icon} className="sb-emoji" style={{ width: 18, height: 18 }} /> : <span className={`ot-sb-dot db-color-${type.color}`} />}</span>
        <span className="sb-row-title">{type.name || t('Sem nome', 'Untitled')}</span>
        {count > 0 && <span className="sb-row-count ot-sb-count" aria-label={t('{n} páginas', '{n} pages', { n: count })}>{count}</span>}
      </button>
      <button type="button" className="ot-sb-more" aria-label={t('Ações do tipo {name}', 'Actions for type {name}', { name: type.name })} aria-haspopup="menu" onClick={(e) => setMenu({ type, count, anchor: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget })}><MoreHorizontal size={16} /></button>
      </div>
    })}
    {menu && <Popover anchor={menu.anchor} placement={'width' in menu.anchor ? 'bottom-start' : 'point'} onClose={() => setMenu(null)} ignore={menu.trigger} className="sb-menu" label={t('Ações do tipo', 'Type actions')}>
      <div role="menu" onKeyDown={menuKeyNav}>
        <MenuItem icon={<EyeOff size={16} />} label={t('Ocultar da barra lateral', 'Hide from sidebar')} onClick={() => { setTypeSidebarHidden(menu.type.id, true); setMenu(null) }} />
        <MenuItem icon={<ArrowUp size={16} />} label={t('Mover para cima', 'Move up')} disabled={ids.indexOf(menu.type.id) <= 0} onClick={() => { moveSidebarType(ids, menu.type.id, -1); setMenu(null) }} />
        <MenuItem icon={<ArrowDown size={16} />} label={t('Mover para baixo', 'Move down')} disabled={ids.indexOf(menu.type.id) >= ids.length - 1} onClick={() => { moveSidebarType(ids, menu.type.id, 1); setMenu(null) }} />
        <MenuItem danger icon={<Trash2 size={16} />} label={t('Excluir tipo…', 'Delete type…')} onClick={() => { setDeleting({ type: menu.type, count: menu.count }); setMenu(null) }} />
      </div>
    </Popover>}
    {deleting && <DeleteTypeDialog type={deleting.type} count={deleting.count} onClose={() => setDeleting(null)} />}
    <ReviewBadge />
  </div>
}
