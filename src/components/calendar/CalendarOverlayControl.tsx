// Botão no cabeçalho da visualização Calendário: liga/desliga a sobreposição do Calendário do macOS nesta visualização.
import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Popover } from '../database/views/shared/Popover'
import { useI18n } from '../../i18n'
import { hasNativeCalendar, updateCalendarSettings, useCalendarSettings } from './calendarState'
import { CalendarAccessPanel } from './CalendarAccessPanel'

export function CalendarOverlayControl({ viewId }: { viewId: string }) {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!hasNativeCalendar()) return null
  const shown = settings.enabled && !settings.hiddenViews?.[viewId]
  const setShown = (on: boolean) => updateCalendarSettings((current) => {
    const hiddenViews = { ...current.hiddenViews }
    if (on) delete hiddenViews[viewId]
    else hiddenViews[viewId] = true
    return { ...current, enabled: on ? true : current.enabled, hiddenViews }
  })
  return <>
    <button type="button" className={`cal-nav-btn cal-icon npcal-overlay-btn${shown ? ' is-on' : ''}`} title={t('Calendário do macOS', 'macOS Calendar')} aria-label={t('Calendário do macOS', 'macOS Calendar')} aria-expanded={!!anchor} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
      <CalendarRange size={16} />
    </button>
    {anchor && <Popover anchor={anchor} align="end" width={300} onClose={() => setAnchor(null)}>
      <div className="vw-menu-section">{t('Calendário do macOS', 'macOS Calendar')}</div>
      <label className="npcal-switch-row is-menu">
        <span className="npcal-label">{t('Sobrepor eventos nesta visualização', 'Overlay events in this view')}</span>
        <input type="checkbox" role="switch" checked={shown} onChange={(event) => setShown(event.target.checked)} />
      </label>
      {shown && <CalendarAccessPanel compact />}
    </Popover>}
  </>
}
