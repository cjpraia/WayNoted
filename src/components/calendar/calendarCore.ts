// Núcleo sem React da integração com o Calendário do macOS: configurações, ponte nativa e revisão de leitura.
// Separado de calendarState.ts para poder ser usado (e testado) fora da interface.
import { actions, getState } from '../../store.ts'
import type { CalendarIntegrationSettings } from '../../types.ts'

export const DEFAULT_CALENDAR_SETTINGS: CalendarIntegrationSettings = { enabled: false, calendarIds: [] }

export const nativeCalendar = () => (typeof window !== 'undefined' ? window.api : undefined)
export const hasNativeCalendar = () => !!nativeCalendar()?.calendarStatus

export function calendarSettings(settings = getState().settings): CalendarIntegrationSettings {
  return { ...DEFAULT_CALENDAR_SETTINGS, ...settings.calendarIntegration }
}

export function updateCalendarSettings(update: Partial<CalendarIntegrationSettings> | ((current: CalendarIntegrationSettings) => CalendarIntegrationSettings)) {
  const current = calendarSettings()
  actions.updateSettings({ calendarIntegration: typeof update === 'function' ? update(current) : { ...current, ...update } })
}

// Revisão: força nova leitura após criar/alterar eventos ou trocar permissões.
let version = 0
export const revisionListeners = new Set<() => void>()
export const revision = () => version
export function bumpCalendarRevision() { version++; for (const listener of revisionListeners) listener() }
