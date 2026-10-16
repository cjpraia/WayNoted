// Estado da integração com o Calendário do macOS: configurações, eventos sobrepostos e vínculos linha → evento.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { actions, getState, useStore } from '../../store'
import { DEFAULT_CALENDAR_SETTINGS, bumpCalendarRevision, calendarSettings, hasNativeCalendar, nativeCalendar, revision, revisionListeners, updateCalendarSettings } from './calendarCore'
import type { CalendarEventLink, CalendarIntegrationSettings, DateValue, Page, SystemCalendar, SystemCalendarEvent, SystemCalendarStatus } from '../../types'
import { getValue, isDateValue } from '../database/lib'
import { eventRangeForDate, linkSignature } from './eventMapping'
import { requestSettingsSection } from '../../quick/QuickCaptureSettings'

export { DEFAULT_CALENDAR_SETTINGS, nativeCalendar, hasNativeCalendar, calendarSettings, updateCalendarSettings, bumpCalendarRevision }

export function useCalendarSettings(): CalendarIntegrationSettings {
  return calendarSettings(useStore().settings)
}

// ---------- Revisão: força nova leitura após criar/alterar eventos ou trocar permissões ----------

function useRevision() {
  return useSyncExternalStore((listener) => { revisionListeners.add(listener); return () => revisionListeners.delete(listener) }, () => revision())
}

// ---------- Permissão e calendários ----------

export function useCalendarAccess(active = true) {
  const rev = useRevision()
  const [status, setStatus] = useState<SystemCalendarStatus | null>(null)
  const [calendars, setCalendars] = useState<SystemCalendar[]>([])
  const [defaultCalendarId, setDefaultCalendarId] = useState('')
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (!active) return
    const native = nativeCalendar()
    if (!native?.calendarStatus) { setStatus({ available: false, reason: 'NATIVE_UNSUPPORTED', authorization: 'unavailable' }); return }
    let cancelled = false
    void (async () => {
      try {
        const next = await native.calendarStatus!()
        if (cancelled) return
        setStatus(next); setError(null)
        if (next.authorization === 'fullAccess') {
          const list = await native.calendarList!()
          if (!cancelled) { setCalendars(list.calendars); setDefaultCalendarId(list.defaultCalendarId) }
        } else setCalendars([])
      } catch (cause) { if (!cancelled) setError(cause) }
    })()
    const onFocus = () => bumpCalendarRevision()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [active, rev])
  /** Só por clique do usuário: o macOS mostra o pedido uma única vez; depois responde com o estado salvo. */
  const requestAccess = useCallback(async () => {
    const native = nativeCalendar()
    if (!native?.calendarRequestAccess) return
    try { setStatus(await native.calendarRequestAccess()); setError(null) } catch (cause) { setError(cause) }
    bumpCalendarRevision()
  }, [])
  return { status, calendars, defaultCalendarId, error, requestAccess }
}

// ---------- Eventos sobrepostos ----------

const eventCache = new Map<string, SystemCalendarEvent[]>()

/** Eventos dos calendários escolhidos numa janela; vazio quando a integração está desligada. */
export function useSystemEvents(range: { start: string; end: string } | null, enabled = true) {
  const settings = useCalendarSettings()
  const rev = useRevision()
  const ids = settings.enabled && enabled && range ? settings.calendarIds : []
  const key = range && ids.length ? `${range.start}|${range.end}|${ids.join(',')}` : ''
  const [events, setEvents] = useState<SystemCalendarEvent[]>(() => (key && eventCache.get(key)) || [])
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    const native = nativeCalendar()
    if (!key || !range || !native?.calendarEvents) { setEvents([]); setError(null); return }
    let cancelled = false
    const cached = eventCache.get(key)
    if (cached) setEvents(cached)
    native.calendarEvents({ start: range.start, end: range.end, calendarIds: ids })
      .then((list) => { if (cancelled) return; eventCache.set(key, list); if (eventCache.size > 40) eventCache.delete(eventCache.keys().next().value!); setEvents(list); setError(null) })
      .catch((cause) => { if (!cancelled) { setEvents([]); setError(cause) } })
    const timer = window.setInterval(() => bumpCalendarRevision(), 5 * 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rev])
  return { events, error }
}

// ---------- Vínculos linha → evento ----------

export function rowLink(rowId: string): CalendarEventLink | undefined {
  return calendarSettings().links?.[rowId]
}

function setLink(rowId: string, link: CalendarEventLink | null) {
  updateCalendarSettings((current) => {
    const links = { ...current.links }
    if (link) links[rowId] = link
    else delete links[rowId]
    return { ...current, links }
  })
}

function rowDate(row: Page, propId: string): DateValue | null {
  const schema = row.parentId ? getState().pages[row.parentId]?.database : undefined
  const prop = schema?.properties.find((item) => item.id === propId)
  if (!prop) return null
  const value = getValue(row, prop)
  return isDateValue(value) ? value : null
}

const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const rowTitle = (row: Page) => row.title?.trim() || (getState().settings.locale === 'en-US' ? 'Untitled' : 'Sem título')
const rowUrl = (row: Page) => `workspace://page/${row.id}`

export async function addRowToCalendar(rowId: string, propId: string) {
  const native = nativeCalendar()
  const row = getState().pages[rowId]
  if (!native?.calendarCreateEvent || !row) throw new Error('NATIVE_UNSUPPORTED')
  const value = rowDate(row, propId)
  const range = eventRangeForDate(value, viewerZone())
  if (!range) throw new Error(getState().settings.locale === 'en-US' ? 'This row has no date.' : 'Esta linha não tem data.')
  const settings = calendarSettings()
  const event = await native.calendarCreateEvent({ ...range, title: rowTitle(row), url: rowUrl(row), ...(settings.defaultCalendarId ? { calendarId: settings.defaultCalendarId } : {}) })
  const now = Date.now()
  setLink(rowId, { eventId: event.id, itemId: event.itemId, calendarId: event.calendarId, propId, signature: linkSignature(value, rowTitle(row)), createdAt: now, syncedAt: now })
  bumpCalendarRevision()
  return event
}

export async function syncRowEvent(rowId: string) {
  const native = nativeCalendar()
  const link = rowLink(rowId), row = getState().pages[rowId]
  if (!native?.calendarUpdateEvent || !link || !row) return
  const value = rowDate(row, link.propId)
  const signature = linkSignature(value, rowTitle(row))
  const range = eventRangeForDate(value, viewerZone())
  // Sem data: mantém o evento como está até o usuário escolher remover.
  if (!range) { setLink(rowId, { ...link, signature, error: 'NO_DATE' }); return }
  try {
    const event = await native.calendarUpdateEvent({ id: link.eventId, itemId: link.itemId, ...range, timeZone: range.timeZone ?? null, title: rowTitle(row) })
    setLink(rowId, { ...link, eventId: event.id || link.eventId, itemId: event.itemId || link.itemId, signature, syncedAt: Date.now(), error: undefined })
    bumpCalendarRevision()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    setLink(rowId, { ...link, signature, error: /EVENT_NOT_FOUND/.test(message) ? 'EVENT_NOT_FOUND' : message.slice(0, 300) })
    throw cause
  }
}

export async function removeRowFromCalendar(rowId: string, deleteEvent: boolean) {
  const native = nativeCalendar()
  const link = rowLink(rowId)
  if (!link) return
  if (deleteEvent && native?.calendarDeleteEvent) await native.calendarDeleteEvent({ id: link.eventId, itemId: link.itemId })
  setLink(rowId, null)
  bumpCalendarRevision()
}

/** Linhas vinculadas cuja data/título mudaram desde a última sincronização. */
export function staleLinks(pages: Record<string, Page>, links: Record<string, CalendarEventLink> = {}): string[] {
  return Object.entries(links).filter(([rowId, link]) => {
    const row = pages[rowId]
    if (!row || row.trashed) return false
    return linkSignature(rowDate(row, link.propId), rowTitle(row)) !== link.signature
  }).map(([rowId]) => rowId)
}

// ---------- Abrir Configurações → Calendário ----------

export function openCalendarSettings() { requestSettingsSection('calendar'); actions.setSettingsOpen(true) }
