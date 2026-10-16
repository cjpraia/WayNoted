import { useState } from 'react'
import { useI18n } from '../../../i18n'
import type { PlaceValue, PropValue } from '../../../types'
import { DbPopover, type DbAnchor } from '../ui/Popover'
import type { EditorCloseReason } from './PropertyEditor'

export function PlaceEditor({ value, anchor, onChange, onClose }: { value: PropValue; anchor: DbAnchor; onChange: (value: PropValue) => void; onClose: (reason: EditorCloseReason) => void }) {
  const { t } = useI18n()
  const place = typeof value === 'object' && value !== null && !Array.isArray(value) && 'lat' in value ? value as PlaceValue : null
  const [label, setLabel] = useState(place?.label ?? '')
  const [lat, setLat] = useState(place?.lat?.toString() ?? '')
  const [lng, setLng] = useState(place?.lng?.toString() ?? '')
  const valid = label.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180
  return <DbPopover anchor={anchor} onClose={() => onClose('outside')} label={t('Lugar', 'Place')}><div className="db-place-editor">
    <label>{t('Nome do lugar', 'Place name')}<input className="dbv-input" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    <label>{t('Latitude', 'Latitude')}<input className="dbv-input" type="number" min="-90" max="90" step="any" value={lat} onChange={(event) => setLat(event.target.value)} /></label>
    <label>{t('Longitude', 'Longitude')}<input className="dbv-input" type="number" min="-180" max="180" step="any" value={lng} onChange={(event) => setLng(event.target.value)} /></label>
    <div><button type="button" disabled={!valid} onClick={() => { onChange({ label: label.trim(), lat: Number(lat), lng: Number(lng) }); onClose('enter') }}>{t('Salvar lugar', 'Save place')}</button><button type="button" onClick={() => { onChange(null); onClose('enter') }}>{t('Limpar', 'Clear')}</button></div>
    <small>{t('Coordenadas manuais; nenhum serviço de mapas é consultado.', 'Manual coordinates; no map service is contacted.')}</small>
  </div></DbPopover>
}
