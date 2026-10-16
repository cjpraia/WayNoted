// Configurações → Tipos: liga a seção da barra lateral e embute o gerenciador de tipos.
import { actions, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { patchTypesUi } from '../../objecttypes/ui'
import { TypesManager, UndoRedoButtons } from './TypesManager'
import { useReviewCount } from './Harvest'
import { Button } from '../ui/Button'
import { openTypesReview } from '../../objecttypes/ui'
import { missingNativeCount, restoreNative, setTypeSidebarHidden } from '../../objecttypes/actions'
import './objecttypes.css'

export function TypesSettings() {
  const { t } = useI18n()
  const { settings } = useStore()
  const review = useReviewCount()
  const missing = missingNativeCount()
  const sidebarHidden = (settings.objectTypes ?? []).filter((type) => type.sidebarHidden)
  return <>
    <h2 className="st-h">{t('Tipos', 'Types')}</h2>
    <div className="st-row st-row-col">
      <p className="ot-collection-note" style={{ margin: 0 }}>{t('Um tipo dá campos e um modelo a qualquer página (ex.: Pessoa tem e-mail e telefone). As páginas continuam onde estão. Pessoa, Projeto, Reunião e outros já vêm prontos; mais em ⌘K → “Explorar tipos”.', 'A type gives any page fields and a template (e.g. Person has email and phone). Pages stay where they are. Person, Project, Meeting and others come ready; more in ⌘K → “Explore types”.')}</p>
      <label className="st-label"><input type="checkbox" checked={settings.objectTypesSidebar !== false} onChange={(e) => actions.updateSettings({ objectTypesSidebar: e.target.checked })} /> {t('Mostrar a seção “Tipos” na barra lateral (tipos nativos e os seus)', 'Show the “Types” section in the sidebar (built-in types and yours)')}</label>
      {sidebarHidden.length > 0 && <div className="ot-row" data-ot="sidebar-hidden"><span>{t('Ocultos da barra lateral:', 'Hidden from the sidebar:')}</span>{sidebarHidden.map((type) => <Button key={type.id} onClick={() => setTypeSidebarHidden(type.id, false)}>{t('Mostrar {name}', 'Show {name}', { name: type.name })}</Button>)}</div>}
      <div className="ot-row"><UndoRedoButtons />{missing > 0 && <Button onClick={() => restoreNative()}>{t('Restaurar tipos nativos ({n})', 'Restore built-in types ({n})', { n: missing })}</Button>}<Button onClick={openTypesReview}>{review ? t('Revisar tipos ({n})', 'Review types ({n})', { n: review }) : t('Revisar tipos', 'Review types')}</Button></div>
    </div>
    <TypesManager embedded onOpenPage={(pageId) => { actions.setSettingsOpen(false); patchTypesUi({ manager: null }); actions.openPage(pageId) }} />
  </>
}
