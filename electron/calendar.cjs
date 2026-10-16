const COMPAT = require('../shared/compatibility.cjs')
// Integração local com o Calendário do macOS (EventKit via helper nativo). Sem contas nem rede:
// o app só fala com o banco local do Calendário, e a permissão é pedida apenas por ação explícita.
const { runHelper, helperAvailable, nativeError } = require('./native-helper.cjs')

const MAX_RANGE_MS = 400 * 86_400_000
const isIso = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const shortString = (value, max) => typeof value === 'string' && value.length <= max
const invalid = field => nativeError('INVALID_INPUT', `Invalid ${field}.`)

function eventFields(input, { requireRange }) {
  if (!input || typeof input !== 'object') throw invalid('event')
  const output = {}
  if (input.title !== undefined) { if (!shortString(input.title, 500)) throw invalid('title'); output.title = input.title }
  for (const field of ['start', 'end']) {
    if (input[field] === undefined) { if (requireRange) throw invalid(field); continue }
    if (!isIso(input[field])) throw invalid(field)
    output[field] = input[field]
  }
  if (output.start && output.end && Date.parse(output.end) < Date.parse(output.start)) throw invalid('end')
  if (input.allDay !== undefined) { if (typeof input.allDay !== 'boolean') throw invalid('allDay'); output.allDay = input.allDay }
  if (input.timeZone !== undefined && input.timeZone !== null) { if (!shortString(input.timeZone, 64) || !/^[A-Za-z_+\-/0-9]+$/.test(input.timeZone)) throw invalid('timeZone'); output.timeZone = input.timeZone }
  if (input.timeZone === null) output.timeZone = null
  if (input.notes !== undefined) { if (!shortString(input.notes, 5000)) throw invalid('notes'); output.notes = input.notes }
  if (input.url !== undefined) { if (!shortString(input.url, 2000) || ! new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/`, "").test(input.url)) throw invalid('url'); output.url = input.url }
  return output
}

function identity(input) {
  if (!input || typeof input !== 'object') throw invalid('event id')
  const id = shortString(input.id, 512) ? input.id : '', itemId = shortString(input.itemId, 512) ? input.itemId : ''
  if (!id && !itemId) throw invalid('event id')
  return { id, itemId }
}

function createCalendarService({ run = runHelper, available = () => process.platform === 'darwin' ? helperAvailable() : { available: false, reason: 'APPLE_INTEGRATION_UNSUPPORTED' } } = {}) {
  return {
    async status() {
      const availability = available()
      if (!availability.available) return { available: false, reason: availability.reason, authorization: 'unavailable' }
      const result = await run(['calendar', 'status'])
      return { available: true, authorization: String(result.authorization) }
    },
    async requestAccess() {
      const result = await run(['calendar', 'request'], undefined, { timeout: 5 * 60_000 })
      return { available: true, authorization: String(result.authorization) }
    },
    async calendars() {
      const result = await run(['calendar', 'list'])
      return { calendars: Array.isArray(result.calendars) ? result.calendars : [], defaultCalendarId: String(result.defaultCalendarId || '') }
    },
    async events(input) {
      if (!input || !isIso(input.start) || !isIso(input.end)) throw invalid('range')
      const span = Date.parse(input.end) - Date.parse(input.start)
      if (span <= 0 || span > MAX_RANGE_MS) throw invalid('range')
      const calendarIds = Array.isArray(input.calendarIds) ? input.calendarIds : []
      if (calendarIds.length > 200 || !calendarIds.every(id => shortString(id, 512))) throw invalid('calendarIds')
      if (!calendarIds.length) return []
      const result = await run(['calendar', 'events'], { start: input.start, end: input.end, calendarIds })
      return Array.isArray(result.events) ? result.events : []
    },
    async createEvent(input) {
      const fields = eventFields(input, { requireRange: true })
      if (input.calendarId !== undefined && !shortString(input.calendarId, 512)) throw invalid('calendarId')
      const result = await run(['calendar', 'create'], { ...fields, ...(input.calendarId ? { calendarId: input.calendarId } : {}) })
      return result.event
    },
    async updateEvent(input) {
      const result = await run(['calendar', 'update'], { ...identity(input), ...eventFields(input, { requireRange: false }) })
      return result.event
    },
    async deleteEvent(input) {
      const result = await run(['calendar', 'delete'], identity(input))
      return { deleted: !!result.deleted }
    },
  }
}

function registerCalendarIpc(trustedHandler, service = createCalendarService()) {
  trustedHandler('np:calendarStatus', () => service.status())
  trustedHandler('np:calendarRequestAccess', () => service.requestAccess())
  trustedHandler('np:calendarList', () => service.calendars())
  trustedHandler('np:calendarEvents', (_event, input) => service.events(input))
  trustedHandler('np:calendarCreateEvent', (_event, input) => service.createEvent(input))
  trustedHandler('np:calendarUpdateEvent', (_event, input) => service.updateEvent(input))
  trustedHandler('np:calendarDeleteEvent', (_event, input) => service.deleteEvent(input))
}

module.exports = { createCalendarService, registerCalendarIpc, isIso }
