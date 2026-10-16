// Itens do menu de contexto da linha: adicionar ao Calendário do macOS, atualizar ou remover o vínculo.
import { useState } from 'react'
import { CalendarCheck, CalendarMinus, CalendarPlus, RefreshCw } from 'lucide-react'
import { MenuItem } from '../database/views/shared/Popover'
import { useI18n } from '../../i18n'
import { addRowToCalendar, hasNativeCalendar, removeRowFromCalendar, syncRowEvent, useCalendarSettings } from './calendarState'
import { calendarErrorMessage } from './eventMapping'

export function RowCalendarMenuItems({ rowId, propId, close }: { rowId: string; propId: string | undefined; close: () => void }) {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!hasNativeCalendar() || !propId) return null
  const link = settings.links?.[rowId]
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await task(); close() } catch (cause) { setError(calendarErrorMessage(cause, t)) } finally { setBusy(false) }
  }
  return <>
    {!link && <MenuItem icon={<CalendarPlus size={16} />} label={busy ? t('Adicionando…', 'Adding…') : t('Adicionar ao Calendário', 'Add to Calendar')} onClick={() => { if (!busy) void run(() => addRowToCalendar(rowId, propId)) }} />}
    {link && <>
      <MenuItem icon={link.error ? <RefreshCw size={16} /> : <CalendarCheck size={16} />} label={t('Atualizar evento no Calendário', 'Update Calendar event')} hint={link.error ? t('erro', 'error') : undefined} onClick={() => { if (!busy) void run(() => syncRowEvent(rowId)) }} />
      <MenuItem icon={<CalendarMinus size={16} />} label={t('Remover do Calendário', 'Remove from Calendar')} onClick={() => { if (!busy) void run(() => removeRowFromCalendar(rowId, true)) }} />
      {link.error === 'EVENT_NOT_FOUND' && <MenuItem icon={<CalendarMinus size={16} />} label={t('Desvincular (evento apagado)', 'Unlink (event deleted)')} onClick={() => void run(() => removeRowFromCalendar(rowId, false))} />}
    </>}
    {error && <div className="npcal-menu-error" role="alert">{error}</div>}
  </>
}
