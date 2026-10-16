// Sobreposição somente leitura dos eventos do Calendário do macOS na visualização Calendário dos bancos.
import { useMemo } from 'react'
import { useI18n } from '../../i18n'
import type { SystemCalendarEvent } from '../../types'
import { useCalendarSettings, useSystemEvents } from './calendarState'
import { eventTimeLabel, layoutSystemWeek, localDay, rangeForDays, type SystemSegment } from './eventMapping'
import './calendar.css'

/** Eventos do sistema para o mês exibido (com a margem das semanas vizinhas). */
export function useCalendarOverlay(viewId: string, month: Date) {
  const settings = useCalendarSettings()
  const shown = settings.enabled && !settings.hiddenViews?.[viewId] && settings.calendarIds.length > 0
  const range = useMemo(() => rangeForDays(localDay(new Date(month.getFullYear(), month.getMonth(), -6)), localDay(new Date(month.getFullYear(), month.getMonth() + 1, 7))), [month])
  const { events } = useSystemEvents(shown ? range : null)
  return useMemo(() => {
    const cache = new Map<string, { segments: SystemSegment[]; lanes: number }>()
    return (weekStart: string) => {
      if (!events.length) return { segments: [], lanes: 0 }
      if (!cache.has(weekStart)) cache.set(weekStart, layoutSystemWeek(weekStart, events))
      return cache.get(weekStart)!
    }
  }, [events])
}

function eventTitle(event: SystemCalendarEvent, locale: string) {
  return [event.title || (locale === 'en-US' ? '(No title)' : '(Sem título)'), eventTimeLabel(event, locale), event.calendarTitle, event.location].filter(Boolean).join(' · ')
}

export function SystemEventBars({ segments, laneOffset }: { segments: SystemSegment[]; laneOffset: number }) {
  const { locale, t } = useI18n()
  return <>{segments.map((segment) => <div
    key={`${segment.event.id}-${segment.event.start}`}
    className={`cal-event npcal-event${segment.continuesLeft ? ' cal-cont-left' : ''}${segment.continuesRight ? ' cal-cont-right' : ''}${segment.event.allDay ? ' is-all-day' : ''}`}
    style={{ gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`, gridRow: laneOffset + segment.lane + 2, ['--npcal-color' as string]: segment.event.color }}
    title={`${eventTitle(segment.event, locale)} — ${t('Calendário do macOS (somente leitura)', 'macOS Calendar (read-only)')}`}
    aria-label={eventTitle(segment.event, locale)}
    data-system-event=""
  >
    <div className="cal-event-title">
      <span className="npcal-dot" aria-hidden />
      {!segment.event.allDay && <span className="npcal-time">{eventTimeLabel(segment.event, locale).split('–')[0]}</span>}
      <span className="npcal-event-name">{segment.event.title || t('(Sem título)', '(No title)')}</span>
    </div>
  </div>)}</>
}
