const COMPAT = require('../shared/compatibility.cjs')
// Lembretes do macOS (EventKit via helper nativo), com ida e volta (C3b). Sem contas nem rede: só o banco local do app
// Lembretes. A permissão é pedida apenas por ação explícita (ligar a opção em Configurações). Todo canal passa por trustedHandler.
const { runHelper, helperAvailable, nativeError } = require('./native-helper.cjs')

const shortString = (value, max) => typeof value === 'string' && value.length <= max
const invalid = field => nativeError('INVALID_INPUT', `Invalid ${field}.`)
const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const validDay = value => typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

function idOf(input, field = 'id') {
  if (!input || typeof input !== 'object' || !shortString(input[field], 512) || !input[field]) throw invalid(field)
  return input[field]
}

function reminderFields(input) {
  if (!input || typeof input !== 'object') throw invalid('reminder')
  const out = {}
  if (input.title !== undefined) { if (!shortString(input.title, 500)) throw invalid('title'); out.title = input.title }
  if (input.notes !== undefined) { if (!shortString(input.notes, 5000)) throw invalid('notes'); out.notes = input.notes }
  if (input.url !== undefined) { if (!shortString(input.url, 2000) || ! new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/`, "").test(input.url)) throw invalid('url'); out.url = input.url }
  if (input.completed !== undefined) { if (typeof input.completed !== 'boolean') throw invalid('completed'); out.completed = input.completed }
  if (input.due === null) out.due = null
  else if (input.due !== undefined) {
    if (!input.due || typeof input.due !== 'object' || !validDay(input.due.date) || (input.due.time !== undefined && !TIME.test(String(input.due.time)))) throw invalid('due')
    out.due = { date: input.due.date, ...(input.due.time ? { time: input.due.time } : {}) }
  }
  return out
}

function createRemindersService({ run = runHelper, available = helperAvailable } = {}) {
  return {
    async status() {
      const availability = available()
      if (!availability.available) return { available: false, reason: availability.reason, authorization: 'unavailable' }
      const result = await run(['reminders', 'status'])
      return { available: true, authorization: String(result.authorization) }
    },
    async requestAccess() {
      const result = await run(['reminders', 'request'], undefined, { timeout: 5 * 60_000 })
      return { available: true, authorization: String(result.authorization) }
    },
    async ensureList(input) {
      const title = input && typeof input.title === 'string' ? input.title.trim() : ''
      if (!title || title.length > 200) throw invalid('title')
      if (input.id !== undefined && !shortString(input.id, 512)) throw invalid('id')
      const result = await run(['reminders', 'ensure-list'], { title, ...(input.id ? { id: input.id } : {}) })
      return { list: result.list, created: !!result.created }
    },
    async list(input) {
      const result = await run(['reminders', 'list'], { listId: idOf(input, 'listId') })
      return { reminders: Array.isArray(result.reminders) ? result.reminders : [] }
    },
    async upsert(input) {
      const fields = reminderFields(input)
      const payload = { ...fields }
      if (input.id !== undefined) payload.id = idOf(input)
      else payload.listId = idOf(input, 'listId')
      if (!payload.id && fields.title === undefined) throw invalid('title')
      const result = await run(['reminders', 'upsert'], payload)
      return result.reminder
    },
    async complete(input) {
      const id = idOf(input)
      if (input.completed !== undefined && typeof input.completed !== 'boolean') throw invalid('completed')
      const result = await run(['reminders', 'complete'], { id, completed: input.completed !== false })
      return result.reminder
    },
    async remove(input) {
      const result = await run(['reminders', 'delete'], { id: idOf(input) })
      return { deleted: !!result.deleted }
    },
  }
}

function registerRemindersIpc(trustedHandler, service = createRemindersService()) {
  trustedHandler('np:remindersStatus', () => service.status())
  trustedHandler('np:remindersRequestAccess', () => service.requestAccess())
  trustedHandler('np:remindersEnsureList', (_event, input) => service.ensureList(input))
  trustedHandler('np:remindersList', (_event, input) => service.list(input))
  trustedHandler('np:remindersUpsert', (_event, input) => service.upsert(input))
  trustedHandler('np:remindersComplete', (_event, input) => service.complete(input))
  trustedHandler('np:remindersDelete', (_event, input) => service.remove(input))
  return service
}

module.exports = { createRemindersService, registerRemindersIpc, reminderFields, validDay }
