import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Bloco "/Agenda de hoje": eventos do dia nos calendários do macOS escolhidos (somente leitura, sempre o dia atual).
import { useEffect, useMemo, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { bumpCalendarRevision, openCalendarSettings, hasNativeCalendar, useCalendarAccess, useCalendarSettings, useSystemEvents } from './calendarState'
import { calendarErrorMessage, eventsForDay, eventTimeLabel, localDay, rangeForDays } from './eventMapping'
import { permissionLabel } from './CalendarAccessPanel'
import { Button, IconButton } from '../ui/Button'
import './calendar.css'

function useToday() {
  const [today, setToday] = useState(() => localDay(new Date()))
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDay(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return today
}

export function TodayAgenda() {
  const { t, locale } = useI18n()
  const today = useToday()
  const settings = useCalendarSettings()
  const native = hasNativeCalendar()
  const { status, requestAccess } = useCalendarAccess(native)
  const range = useMemo(() => rangeForDays(today, today), [today])
  const ready = native && settings.enabled && status?.authorization === 'fullAccess'
  const { events, error } = useSystemEvents(ready ? range : null)
  const list = eventsForDay(events, today)
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  let body
  if (!native) body = <div className="npcal-agenda-empty">{t('A agenda do Calendário do macOS aparece no app para Mac.', 'The macOS Calendar agenda appears in the Mac app.')}</div>
  else if (!status) body = <div className="npcal-agenda-empty">{t('Carregando…', 'Loading…')}</div>
  else if (!status.available) body = <div className="npcal-agenda-empty">{calendarErrorMessage(status.reason, t)}</div>
  else if (status.authorization === 'notDetermined') body = <div className="npcal-agenda-actions"><span className="npcal-agenda-empty">{t(`O ${PRODUCT.name} precisa de permissão para ler o Calendário.`, `${PRODUCT.name} needs permission to read Calendar.`)}</span><Button variant="primary" type="button" onClick={() => void requestAccess()}>{t('Permitir acesso…', 'Allow access…')}</Button></div>
  else if (status.authorization !== 'fullAccess') body = <div className="npcal-agenda-actions"><span className="npcal-agenda-empty">{permissionLabel(status.authorization, t)}. {t('Conceda acesso total em Ajustes do Sistema → Privacidade e Segurança → Calendários.', 'Grant full access in System Settings → Privacy & Security → Calendars.')}</span><Button type="button" onClick={() => void window.api?.openPrivacySettings?.('calendars')}>{t('Abrir Ajustes do Sistema', 'Open System Settings')}</Button></div>
  else if (!settings.enabled || !settings.calendarIds.length) body = <div className="npcal-agenda-actions"><span className="npcal-agenda-empty">{t('Escolha os calendários em Configurações → Calendário.', 'Choose calendars in Settings → Calendar.')}</span><Button type="button" onClick={() => openCalendarSettings()}>{t('Abrir Configurações', 'Open Settings')}</Button></div>
  else if (error) body = <div className="npcal-error" role="alert">{calendarErrorMessage(error, t)}</div>
  else if (!list.length) body = <div className="npcal-agenda-empty">{t('Nenhum evento hoje.', 'No events today.')}</div>
  else body = <ul className="npcal-agenda-list">{list.map((event) => <li key={`${event.id}-${event.start}`} className="npcal-agenda-item" style={{ ['--npcal-color' as string]: event.color }}>
    <span className="npcal-dot" aria-hidden />
    <span className="npcal-agenda-time">{eventTimeLabel(event, locale, today)}</span>
    <span className="npcal-agenda-title">{event.title || t('(Sem título)', '(No title)')}{(event.location || event.calendarTitle) && <span className="npcal-agenda-meta"> · {[event.location, event.calendarTitle].filter(Boolean).join(' · ')}</span>}</span>
  </li>)}</ul>
  return <div className="npcal-agenda" contentEditable={false} data-calendar-agenda="">
    <div className="npcal-agenda-head">
      <CalendarDays size={16} aria-hidden />
      <span>{t('Agenda de hoje', 'Today’s agenda')}</span>
      <span className="npcal-agenda-date">{dateLabel}</span>
      {ready && <IconButton label={t('Atualizar', 'Refresh')} onClick={() => bumpCalendarRevision()}><RefreshCw size={14} aria-hidden /></IconButton>}
    </div>
    {body}
  </div>
}

export const CalendarAgendaBlock = createReactBlockSpec(
  { type: 'calendarAgenda', propSchema: {}, content: 'none' },
  {
    render: () => <TodayAgenda />,
    toExternalHTML: () => <p>Agenda de hoje (Calendário do macOS)</p>,
  },
)
