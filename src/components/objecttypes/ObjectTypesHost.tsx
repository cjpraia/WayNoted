// Host global dos tipos (montado no App): painel "Editar tipo" / gerenciador, escolha de tipo vinda de
// ⌘K / "/Tipo" / barra lateral, galeria "Explorar tipos", confirmação de aplicar, guia e ⌘Z dos tipos.
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { actions } from '../../store'
import { useI18n } from '../../i18n'
import { canRedoTypes, canUndoTypes, nextTypesRedoAt, nextTypesUndoAt, redoTypes, undoTypes } from '../../objecttypes/actions'
import { patchTypesUi, useTypesUi } from '../../objecttypes/ui'
import { TypePicker } from './TypePicker'
import { TypeEditorPanel, TypesManager, UndoRedoButtons } from './TypesManager'
import { TypesDiscoveryHost } from './TypesGallery'
import './objecttypes.css'
import { IconButton } from '../ui/Button'

/**
 * ⌘Z / ⌘⇧Z fora de campos de texto desfazem o último passo de tipos (aplicar com campos, ícone e modelo; remover…)
 * quando ele é mais recente que a última transação estrutural (que o SubpagesHost trata em seguida).
 */
function useTypesUndoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.ProseMirror, .bn-editor'))) return
      if (e.shiftKey) {
        const at = nextTypesRedoAt()
        if (!canRedoTypes() || at === null || (actions.nextStructuralAt(true) ?? 0) > at) return
        if (redoTypes()) e.preventDefault()
      } else {
        const at = nextTypesUndoAt()
        if (!canUndoTypes() || at === null || (actions.nextStructuralAt() ?? 0) > at) return
        if (undoTypes()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function ObjectTypesHost() {
  const { t } = useI18n()
  const ui = useTypesUi()
  useTypesUndoKeys()
  useEffect(() => {
    if (!ui.manager) return
    const opener = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.dbv-popover, .ot-overlay .ot-dialog')) patchTypesUi({ manager: null }) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [ui.manager])
  const openPage = (pageId: string) => { patchTypesUi({ manager: null }); actions.openPage(pageId) }
  const pickerAnchor = ui.picker ? (ui.picker.anchor ?? { x: Math.round(window.innerWidth / 2 - 140), y: Math.round(window.innerHeight / 4) }) : null
  const single = !!ui.manager?.typeId
  const close = () => patchTypesUi({ manager: null })
  return <>
    {ui.manager && <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={`ot-modal${single ? ' ot-modal--panel' : ''}`} role="dialog" aria-modal="true" aria-label={single ? t('Editar tipo', 'Edit type') : t('Tipos', 'Types')}>
        <div className="ot-modal-head">
          <h2>{single ? t('Editar tipo', 'Edit type') : t('Tipos', 'Types')}</h2>
          <span className="ot-spacer" />
          <UndoRedoButtons />
          <IconButton label={t('Fechar', 'Close')} onClick={close}><X size={16} /></IconButton>
        </div>
        {single
          ? <TypeEditorPanel key={ui.manager.nonce ?? 0} typeId={ui.manager.typeId!} initialTab={ui.manager.tab} />
          : <TypesManager key={ui.manager.nonce ?? 0} initialTab={ui.manager.tab} onOpenPage={openPage} />}
      </div>
    </div>}
    {ui.picker && pickerAnchor && <TypePicker pageIds={ui.picker.pageIds} anchor={pickerAnchor} onClose={() => patchTypesUi({ picker: null })} />}
    <TypesDiscoveryHost />
  </>
}
