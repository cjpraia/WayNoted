// Mantém eventos criados por "Adicionar ao Calendário" alinhados com a data e o título da linha.
import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { calendarSettings, hasNativeCalendar, staleLinks, syncRowEvent } from './calendarState'

export function CalendarLinkSync() {
  const state = useStore()
  const links = state.settings.calendarIntegration?.links
  const busy = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!state.ready || !links || !Object.keys(links).length || !hasNativeCalendar()) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      if (busy.current) return
      busy.current = true
      try {
        for (const rowId of staleLinks(state.pages, calendarSettings().links)) {
          try { await syncRowEvent(rowId) } catch { /* O erro fica registrado no vínculo e aparece no menu da linha. */ }
        }
      } finally { busy.current = false }
    }, 1200)
    return () => window.clearTimeout(timer.current)
  }, [state.ready, state.pages, links])
  return null
}
