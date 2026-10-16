// Ditado local: o helper nativo grava o microfone e transcreve com SFSpeechRecognizer on-device.
// Eventos chegam ao renderer por 'np:dictationEvent'. Nunca usa reconhecimento em servidor.
const { spawn } = require('node:child_process')
const { runHelper, helperAvailable, helperPath, nativeError } = require('./native-helper.cjs')

const LOCALES = new Set(['pt-BR', 'en-US'])
const EVENT_TYPES = new Set(['ready', 'level', 'partial', 'final', 'error', 'end'])

function parseLines(buffer, chunk, onObject) {
  const lines = (buffer + chunk).split('\n')
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    try { onObject(JSON.parse(line)) } catch { /* Linha inválida do helper: ignora. */ }
  }
  return rest.length > 1_000_000 ? '' : rest
}

/** Normaliza o que o helper imprime em eventos seguros para o renderer. */
function toEvent(object) {
  if (object?.error) return { type: 'error', code: String(object.error.code || 'DICTATION_FAILED'), message: String(object.error.message || '') }
  if (!object || !EVENT_TYPES.has(object.type)) return null
  const event = { type: object.type }
  if (typeof object.text === 'string') event.text = object.text.slice(0, 100_000)
  if (Number.isInteger(object.segment)) event.segment = object.segment
  if (typeof object.value === 'number') event.value = Math.max(0, Math.min(1, object.value))
  if (typeof object.code === 'string') event.code = object.code
  if (typeof object.message === 'string') event.message = object.message.slice(0, 2000)
  if (typeof object.locale === 'string') event.locale = object.locale
  if (object.cancelled) event.cancelled = true
  return event
}

function createDictationService({ spawnImpl = spawn, run = runHelper, available = helperAvailable, file = () => helperPath(), microphone } = {}) {
  const sessions = new Map()
  let nextId = 1
  const end = (owner) => { const session = sessions.get(owner); if (session) { sessions.delete(owner); try { session.child.kill('SIGTERM') } catch { /* já saiu */ } } }
  return {
    sessions,
    async status(locale) {
      if (!LOCALES.has(locale)) throw nativeError('UNSUPPORTED_LOCALE', 'Unsupported locale.')
      const availability = available()
      if (!availability.available) return { available: false, reason: availability.reason }
      return { available: true, ...(await run(['dictation', 'status', '--locale', locale])) }
    },
    async start(owner, input, send) {
      const locale = input?.locale
      if (!LOCALES.has(locale)) throw nativeError('UNSUPPORTED_LOCALE', 'Unsupported locale.')
      const availability = available()
      if (!availability.available) throw nativeError(availability.reason, 'Native helper unavailable.')
      // Microfone: o pedido do sistema é feito para o app (Info.plist do aplicativo), só após o clique do usuário.
      if (microphone) { const allowed = await microphone(); if (!allowed) throw nativeError('MIC_DENIED', 'Microphone permission was denied.') }
      end(owner)
      const id = nextId++
      const child = spawnImpl(file(), ['dictation', 'start', '--locale', locale], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true })
      const session = { id, child, ended: false }
      sessions.set(owner, session)
      let buffer = '', stderr = ''
      const deliver = event => { if (event) send({ sessionId: id, ...event }) }
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { buffer = parseLines(buffer, chunk, object => { const event = toEvent(object); if (event?.type === 'end') session.ended = true; deliver(event) }) })
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000) })
      child.stdin.on('error', () => {})
      child.on('error', error => deliver({ type: 'error', code: 'NATIVE_HELPER_FAILED', message: error.message }))
      child.on('close', code => {
        if (buffer.trim()) parseLines(buffer, '\n', object => deliver(toEvent(object)))
        if (sessions.get(owner) === session) sessions.delete(owner)
        if (!session.ended) deliver({ type: 'end', ...(code ? { code: 'DICTATION_EXITED', message: stderr.trim() || `exit ${code}` } : {}) })
      })
      return { sessionId: id }
    },
    stop(owner) { const session = sessions.get(owner); if (session) session.child.stdin.write('stop\n') },
    cancel: end,
  }
}

function defaultMicrophone() {
  return async () => {
    if (process.platform === 'win32') return true
    const { systemPreferences } = require('electron')
    if (!systemPreferences?.getMediaAccessStatus) return true
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return true
    if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone')
    return false
  }
}

// Com um helper alternativo (WORKSPACE_NATIVE_HELPER, uso de desenvolvimento), o próprio helper cuida das permissões.
function createDefaultDictationService() {
  return createDictationService({ microphone: process.env.WORKSPACE_NATIVE_HELPER ? undefined : defaultMicrophone() })
}

function registerDictationIpc(trustedHandler, service = createDefaultDictationService()) {
  const watched = new Set()
  trustedHandler('np:dictationStatus', (_event, locale) => service.status(locale))
  trustedHandler('np:dictationStart', async (event, input) => {
    const sender = event.sender, owner = sender.id
    const result = await service.start(owner, input, payload => { if (!sender.isDestroyed?.()) sender.send('np:dictationEvent', payload) })
    if (!watched.has(owner)) { watched.add(owner); sender.once?.('destroyed', () => { watched.delete(owner); service.cancel(owner) }) }
    return result
  })
  trustedHandler('np:dictationStop', event => service.stop(event.sender.id))
  trustedHandler('np:dictationCancel', event => service.cancel(event.sender.id))
  return service
}

module.exports = { createDictationService, createDefaultDictationService, registerDictationIpc, parseLines, toEvent }
