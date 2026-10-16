// Barra de ação e menu de contexto da seleção múltipla de páginas na barra lateral. docs/USAGE.md
import { useEffect, useRef } from 'react'
import { Copy, FolderInput, Star, Table2, Trash2, X } from 'lucide-react'
import { useStore } from '../store.ts'
import { t } from '../i18n.ts'
import { Popover, MenuItem, menuKeyNav, type Anchor } from '../components/sidebar/Popover.tsx'
import { clearSelection, pruneSelection, useSelection } from './selection.ts'
import { openSubpagesDialog } from './ui.ts'
import { selectionConversionBlocker } from './actions.ts'
import { bulkDuplicate, bulkFavorite, bulkTrash } from './bulk.ts'
import './subpages.css'

/** Mantém a seleção coerente (páginas excluídas ou movidas saem dela) e limpa com Esc dentro da barra lateral. */
export function useSelectionHygiene() {
  const { pages } = useStore()
  const { ids } = useSelection()
  useEffect(() => { if (ids.length) pruneSelection() }, [pages, ids.length])
}

function useActions(ids: readonly string[], done: () => void) {
  return {
    create: () => { done(); openSubpagesDialog({ kind: 'selection', ids: [...ids] }) },
    move: () => { done(); openSubpagesDialog({ kind: 'move', ids: [...ids] }) },
    duplicate: () => { done(); void bulkDuplicate(ids) },
    favorite: () => { done(); bulkFavorite(ids) },
    trash: () => { done(); bulkTrash(ids); clearSelection() },
  }
}

export function SelectionBar() {
  const { ids } = useSelection()
  useSelectionHygiene()
  const run = useActions(ids, () => {})
  if (ids.length < 1) return null
  const blocker = selectionConversionBlocker([...ids])
  return (
    <div className="sb-selbar" role="toolbar" aria-label={t('Ações para as páginas selecionadas', 'Actions for the selected pages')}>
      <div className="sb-selbar-count" role="status">
        <span>{ids.length === 1 ? t('1 página selecionada', '1 page selected') : t('{n} páginas selecionadas', '{n} pages selected', { n: ids.length })}</span>
        <button type="button" aria-label={t('Limpar seleção (Esc)', 'Clear selection (Esc)')} data-tip={t('Limpar seleção (Esc)', 'Clear selection (Esc)')} onClick={clearSelection}><X size={14} /></button>
      </div>
      <button type="button" className="is-primary" disabled={!!blocker} onClick={run.create}><Table2 size={14} aria-hidden />{t('Criar banco de dados com estas páginas', 'Create database with these pages')}</button>
      {blocker && <div className="sb-selbar-note">{blocker}</div>}
      <button type="button" aria-label={t('Mover para banco de dados…', 'Move to database…')} data-tip={t('Mover para banco de dados…', 'Move to database…')} onClick={run.move}><FolderInput size={14} aria-hidden /></button>
      <button type="button" aria-label={t('Duplicar', 'Duplicate')} data-tip={t('Duplicar', 'Duplicate')} onClick={run.duplicate}><Copy size={14} aria-hidden /></button>
      <button type="button" aria-label={t('Favoritar', 'Favorite')} data-tip={t('Favoritar', 'Favorite')} onClick={run.favorite}><Star size={14} aria-hidden /></button>
      <button type="button" className="is-danger" aria-label={t('Mover para a lixeira', 'Move to trash')} data-tip={t('Mover para a lixeira', 'Move to trash')} onClick={run.trash}><Trash2 size={14} aria-hidden /></button>
    </div>
  )
}

export function SelectionMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const { ids } = useSelection()
  const ref = useRef<HTMLDivElement>(null)
  const run = useActions(ids, onClose)
  useEffect(() => { ref.current?.focus() }, [])
  if (!ids.length) return null
  const blocker = selectionConversionBlocker([...ids])
  return (
    <Popover anchor={anchor} placement={'width' in anchor ? 'bottom-start' : 'point'} onClose={onClose} className="sb-menu" label={t('Ações da seleção', 'Selection actions')}>
      <div ref={ref} role="menu" tabIndex={-1} className="sb-menu-body" onKeyDown={menuKeyNav}>
        <div className="sb-menu-group">
          <MenuItem icon={<Table2 size={18} />} label={t('Criar banco de dados com estas páginas', 'Create database with these pages')} disabled={!!blocker} onClick={run.create} />
          <MenuItem icon={<FolderInput size={18} />} label={t('Mover para banco de dados…', 'Move to database…')} onClick={run.move} />
        </div>
        <div className="sb-menu-sep" />
        <div className="sb-menu-group">
          <MenuItem icon={<Copy size={18} />} label={t('Duplicar', 'Duplicate')} onClick={run.duplicate} />
          <MenuItem icon={<Star size={18} />} label={t('Favoritar', 'Favorite')} onClick={run.favorite} />
        </div>
        <div className="sb-menu-sep" />
        <div className="sb-menu-group">
          <MenuItem icon={<Trash2 size={18} />} label={t('Mover para a lixeira', 'Move to trash')} danger onClick={run.trash} />
        </div>
        {blocker && <div className="sb-menu-footer">{blocker}</div>}
      </div>
    </Popover>
  )
}
