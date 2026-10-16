import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Painel reutilizável (Configurações e popover da visualização): permissão, ativação e escolha de calendários.
import { CalendarDays, ExternalLink, Lock } from 'lucide-react'
import { useI18n } from '../../i18n'
import { nativeCalendar, updateCalendarSettings, useCalendarAccess, useCalendarSettings } from './calendarState'
import { calendarErrorMessage } from './eventMapping'
import './calendar.css'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'

export function permissionLabel(authorization: string | undefined, t: (pt: string, en: string) => string): string {
  switch (authorization) {
    case 'fullAccess': return t('Acesso total concedido', 'Full access granted')
    case 'writeOnly': return t('Somente adicionar eventos', 'Add events only')
    case 'denied': return t('Acesso negado', 'Access denied')
    case 'restricted': return t('Restrito por política do Mac', 'Restricted by Mac policy')
    case 'notDetermined': return t('Ainda não solicitado', 'Not requested yet')
    default: return t('Indisponível', 'Unavailable')
  }
}

export function CalendarAccessPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const settings = useCalendarSettings()
  const { status, calendars, defaultCalendarId, error, requestAccess } = useCalendarAccess(true)
  const authorization = status?.authorization
  const openSettings = () => void nativeCalendar()?.openPrivacySettings?.('calendars')
  if (status && !status.available) {
    return <div className="npcal-panel"><p className="npcal-hint">{status.reason === 'NATIVE_HELPER_MISSING'
      ? t('O componente nativo do Calendário não foi encontrado neste build (npm run build:native).', 'The native Calendar component is missing from this build (npm run build:native).')
      : t('A integração com o Calendário está disponível somente no app para macOS.', 'Calendar integration is available only in the macOS app.')}</p></div>
  }
  const sources = [...new Set(calendars.map((calendar) => calendar.source))]
  const toggleCalendar = (id: string, on: boolean) => updateCalendarSettings((current) => ({ ...current, calendarIds: on ? [...new Set([...current.calendarIds, id])] : current.calendarIds.filter((item) => item !== id) }))
  return <div className={`npcal-panel${compact ? ' is-compact' : ''}`}>
    {!compact && <label className="npcal-switch-row">
      <span><span className="npcal-label">{t('Mostrar eventos do Calendário do macOS', 'Show macOS Calendar events')}</span>
        <span className="npcal-hint">{t('Somente leitura nas visualizações Calendário e no bloco Agenda de hoje. Nada sai deste Mac.', 'Read-only in Calendar views and the Today’s agenda block. Nothing leaves this Mac.')}</span></span>
      <input type="checkbox" role="switch" checked={settings.enabled} onChange={(event) => updateCalendarSettings({ enabled: event.target.checked })} />
    </label>}
    <div className="npcal-status" data-state={authorization ?? 'loading'}>
      <Lock size={14} aria-hidden />
      <span>{t('Permissão do macOS', 'macOS permission')}: <strong>{status ? permissionLabel(authorization, t) : t('Verificando…', 'Checking…')}</strong></span>
      {authorization === 'notDetermined' && <Button variant="primary" type="button" onClick={() => void requestAccess()}>{t('Permitir acesso…', 'Allow access…')}</Button>}
      {(authorization === 'denied' || authorization === 'writeOnly' || authorization === 'restricted' || authorization === 'fullAccess') && <Button type="button" onClick={openSettings}><ExternalLink size={14} aria-hidden /> {t('Abrir Ajustes do Sistema', 'Open System Settings')}</Button>}
    </div>
    {authorization === 'denied' && <p className="npcal-hint">{t(`Ative o ${PRODUCT.name} em Ajustes do Sistema → Privacidade e Segurança → Calendários e volte para esta janela.`, `Enable ${PRODUCT.name} in System Settings → Privacy & Security → Calendars, then return to this window.`)}</p>}
    {!!error && <p className="npcal-error" role="alert">{calendarErrorMessage(error, t)}</p>}
    {authorization === 'fullAccess' && (calendars.length ? <div className="npcal-list" role="group" aria-label={t('Calendários sobrepostos', 'Overlaid calendars')}>
      {sources.map((source) => <div key={source} className="npcal-source">
        <div className="npcal-source-title">{source || t('Neste Mac', 'On My Mac')}</div>
        {calendars.filter((calendar) => calendar.source === source).map((calendar) => <label key={calendar.id} className="npcal-calendar">
          <input type="checkbox" checked={settings.calendarIds.includes(calendar.id)} onChange={(event) => toggleCalendar(calendar.id, event.target.checked)} />
          <span className="npcal-dot" style={{ background: calendar.color }} aria-hidden />
          <span className="npcal-calendar-title">{calendar.title}</span>
          {!calendar.allowsModify && <span className="npcal-tag">{t('leitura', 'read-only')}</span>}
        </label>)}
      </div>)}
    </div> : <p className="npcal-hint"><CalendarDays size={14} aria-hidden /> {t('Nenhum calendário encontrado neste Mac.', 'No calendars found on this Mac.')}</p>)}
    {!compact && authorization === 'fullAccess' && calendars.length > 0 && <label className="npcal-field">
      <span className="npcal-label">{t('Calendário para novos eventos', 'Calendar for new events')}</span>
      <Select value={settings.defaultCalendarId ?? ''} onChange={(event) => updateCalendarSettings({ defaultCalendarId: event.target.value })}>
        <option value="">{t('Padrão do sistema', 'System default')}{defaultCalendarId ? ` (${calendars.find((calendar) => calendar.id === defaultCalendarId)?.title ?? ''})` : ''}</option>
        {calendars.filter((calendar) => calendar.allowsModify).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.title}</option>)}
      </Select>
      <span className="npcal-hint">{t('Usado por “Adicionar ao Calendário” no menu de uma linha com data. O evento é atualizado quando a data da linha muda.', 'Used by “Add to Calendar” in a dated row’s menu. The event updates when the row’s date changes.')}</span>
    </label>}
  </div>
}
