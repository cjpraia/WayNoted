const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { createCalendarService, registerCalendarIpc } = require('../electron/calendar.cjs')
const { createDictationService, toEvent, parseLines } = require('../electron/dictation.cjs')
const { runHelper, helperPath, registerPrivacySettingsIpc, PRIVACY_PANES } = require('../electron/native-helper.cjs')

function fakeChild(lines, code = 0) {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough()
  child.written = ''
  child.stdin.on('data', chunk => { child.written += chunk })
  child.kill = signal => { child.killed = signal; child.emit('close', null) }
  setImmediate(() => { for (const line of lines) child.stdout.write(line + '\n'); child.stdout.end(); setImmediate(() => child.emit('close', code)) })
  return child
}

test('calendar service validates input before reaching the native helper', async () => {
  const calls = []
  const service = createCalendarService({ available: () => ({ available: true }), run: async (args, input) => { calls.push({ args, input }); return { authorization: 'fullAccess', events: [], event: { id: 'e1' }, deleted: true } } })
  assert.deepEqual(await service.status(), { available: true, authorization: 'fullAccess' })
  await assert.rejects(service.events({ start: 'yesterday', end: '2026-10-08T00:00:00.000Z', calendarIds: ['a'] }), /INVALID_INPUT/)
  await assert.rejects(service.events({ start: '2026-01-01T00:00:00.000Z', end: '2028-01-01T00:00:00.000Z', calendarIds: ['a'] }), /INVALID_INPUT/)
  assert.deepEqual(await service.events({ start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z', calendarIds: [] }), [])
  assert.equal(calls.length, 1, 'no helper call for an empty calendar selection')
  await assert.rejects(service.createEvent({ title: 'x', start: '2026-10-07T09:00:00Z', end: '2026-10-07T08:00:00Z', allDay: false }), /INVALID_INPUT/)
  await assert.rejects(service.createEvent({ title: 'x', start: '2026-10-07T09:00:00Z', end: '2026-10-07T10:00:00Z', allDay: false, url: 'https://evil.example' }), /INVALID_INPUT/)
  await service.createEvent({ title: 'Reunião', start: '2026-10-07T09:00:00.000Z', end: '2026-10-07T10:00:00.000Z', allDay: false, url: "workspace://page/x", calendarId: 'cal' })
  assert.deepEqual(calls.at(-1).args, ['calendar', 'create'])
  assert.equal(calls.at(-1).input.calendarId, 'cal')
  await assert.rejects(service.updateEvent({ start: '2026-10-07T09:00:00Z' }), /INVALID_INPUT/)
  assert.deepEqual(await service.deleteEvent({ id: 'e1' }), { deleted: true })
  const missing = createCalendarService({ available: () => ({ available: false, reason: 'NATIVE_HELPER_MISSING' }), run: async () => { throw new Error('must not run') } })
  assert.deepEqual(await missing.status(), { available: false, reason: 'NATIVE_HELPER_MISSING', authorization: 'unavailable' })
})

test('calendar IPC registers every channel through the trusted handler', () => {
  const channels = []
  registerCalendarIpc(channel => channels.push(channel), createCalendarService({ run: async () => ({}) }))
  registerPrivacySettingsIpc(channel => channels.push(channel), () => {})
  assert.deepEqual(channels.sort(), ['np:calendarCreateEvent', 'np:calendarDeleteEvent', 'np:calendarEvents', 'np:calendarList', 'np:calendarRequestAccess', 'np:calendarStatus', 'np:calendarUpdateEvent', 'np:openPrivacySettings'])
  assert.ok(Object.values(PRIVACY_PANES).every(url => url.startsWith('x-apple.systempreferences:')))
})

test('runHelper parses JSON output, maps helper errors and sends JSON on stdin without a shell', async () => {
  const file = process.execPath
  let options, child
  const ok = await runHelper(['calendar', 'status'], { a: 1 }, { file, platform: 'darwin', spawnImpl: (f, args, opts) => { options = opts; child = fakeChild(['{"authorization":"denied"}']); return child } })
  assert.deepEqual(ok, { authorization: 'denied' })
  assert.equal(options.shell, false)
  assert.equal(child.written, '{"a":1}')
  await assert.rejects(runHelper(['calendar', 'list'], undefined, { file, platform: 'darwin', spawnImpl: () => fakeChild(['{"error":{"code":"CALENDAR_ACCESS_DENIED","message":"no"}}'], 2) }), /^Error: CALENDAR_ACCESS_DENIED: no$/)
  await assert.rejects(runHelper(['x'], undefined, { file: "/nonexistent/workspace-native", platform: 'darwin' }), /NATIVE_HELPER_MISSING/)
  await assert.rejects(runHelper(['x'], undefined, { file, platform: 'linux' }), /NATIVE_UNSUPPORTED/)
  assert.equal(helperPath({ isPackaged: true, resourcesPath: '/App/Contents/Resources' }), path.join('/App/Contents/Resources', process.platform === 'win32' ? 'workspace-native.exe' : 'workspace-native'))
  assert.ok(helperPath({ isPackaged: false }).endsWith(path.join('build', 'native', ...(process.platform === 'win32' ? ['win32-' + process.arch, 'workspace-native.exe'] : ['workspace-native']))))
})

test('dictation service streams helper events, stops via stdin and refuses denied microphone', async () => {
  const events = []
  let child
  const service = createDictationService({ available: () => ({ available: true }), file: () => '/helper', microphone: async () => true, spawnImpl: (file, args, options) => {
    assert.deepEqual(args, ['dictation', 'start', '--locale', 'pt-BR']); assert.equal(options.shell, false)
    child = fakeChild(['{"type":"ready","locale":"pt-BR","onDevice":true}', '{"type":"partial","segment":0,"text":"olá"}', 'garbage', '{"type":"final","segment":0,"text":"Olá."}', '{"type":"end"}'])
    return child
  } })
  const { sessionId } = await service.start(7, { locale: 'pt-BR' }, event => events.push(event))
  service.stop(7)
  assert.equal(child.written, 'stop\n')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(events.map(event => event.type), ['ready', 'partial', 'final', 'end'])
  assert.ok(events.every(event => event.sessionId === sessionId))
  assert.equal(events[2].text, 'Olá.')
  await assert.rejects(service.start(7, { locale: 'fr-FR' }, () => {}), /UNSUPPORTED_LOCALE/)
  const denied = createDictationService({ available: () => ({ available: true }), microphone: async () => false, spawnImpl: () => { throw new Error('must not spawn') } })
  await assert.rejects(denied.start(1, { locale: 'en-US' }, () => {}), /MIC_DENIED/)
  const missing = createDictationService({ available: () => ({ available: false, reason: 'NATIVE_HELPER_MISSING' }) })
  assert.deepEqual(await missing.status('pt-BR'), { available: false, reason: 'NATIVE_HELPER_MISSING' })
  assert.deepEqual(toEvent({ error: { code: 'ON_DEVICE_UNAVAILABLE', message: 'x' } }), { type: 'error', code: 'ON_DEVICE_UNAVAILABLE', message: 'x' })
  assert.equal(toEvent({ type: 'shell', text: 'x' }), null)
  const seen = []; assert.equal(parseLines('{"type":"re', 'ady"}\n{"ty', object => seen.push(object.type)), '{"ty'); assert.deepEqual(seen, ['ready'])
})

test('packaging embeds the helper, permission strings and the ad-hoc signing step', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.match(pkg.scripts.dist, /npm run build:native/)
  assert.match(fs.readFileSync('build/package.mjs', 'utf8'), /extraResource: \[nativeFile/)
  assert.match(fs.readFileSync('build/package.mjs', 'utf8'), /build\/sign-app\.mjs/)
  const plist = fs.readFileSync('build/app-info.plist', 'utf8')
  for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSCalendarsFullAccessUsageDescription']) assert.ok(plist.includes(`<key>${key}</key>`), key)
  const swift = fs.readFileSync('native/Dictation.swift', 'utf8')
  assert.match(swift, /requiresOnDeviceRecognition = true/)
  assert.doesNotMatch(swift, /requiresOnDeviceRecognition = false/)
})

test('embed (A3b): helper wired, on-device only, falls back silently; runHelper can lower priority', async () => {
  const main = fs.readFileSync('native/main.swift', 'utf8'), swift = fs.readFileSync('native/Embedding.swift', 'utf8'), build = fs.readFileSync('build/build-native.mjs', 'utf8')
  assert.match(main, /case "embed": runEmbed/); assert.match(build, /Embedding\.swift/); assert.match(build, /NaturalLanguage/)
  assert.match(swift, /NLContextualEmbedding/); assert.match(swift, /#available\(macOS 14\.0/)
  assert.doesNotMatch(swift, /URLSession|URLRequest|http:\/\/|https:\/\//, 'sem rede no helper')
  // Protocolo simulado: status e vetores em JSON; erro estruturado quando indisponível.
  const ok = await runHelper(['embed'], { texts: ['a'] }, { file: process.execPath, platform: 'darwin', spawnImpl: () => fakeChild(['{"vectors":[[1,2]],"dimension":2}']) })
  assert.deepEqual(ok.vectors, [[1, 2]])
  await assert.rejects(runHelper(['embed'], { texts: ['a'] }, { file: process.execPath, platform: 'darwin', spawnImpl: () => fakeChild(['{"error":{"code":"EMBEDDING_UNAVAILABLE","message":"x"}}'], 2) }), /EMBEDDING_UNAVAILABLE/)
  // Helper real (se compilado neste Mac): status coerente; se disponível, vetores com a dimensão informada.
  const real = helperPath()
  if (process.platform !== 'darwin' || !fs.existsSync(real)) return
  const status = await runHelper(['embed', '--status'], undefined, { timeout: 30000 })
  assert.equal(typeof status.available, 'boolean')
  if (!status.available) { assert.equal(typeof status.reason, 'string'); return }
  const result = await runHelper(['embed'], { texts: ['receita de bolo de cenoura', 'trocar o óleo do motor', ''], script: 'latin' }, { timeout: 60000, niceness: 10 })
  assert.equal(result.vectors.length, 3); assert.ok(result.vectors.every(v => v.length === status.dimension))
  assert.ok(result.vectors[0].some(x => x !== 0)); assert.ok(result.vectors[2].every(x => x === 0), 'texto vazio => vetor nulo')
  await assert.rejects(runHelper(['embed'], { texts: 'não é lista' }), /INVALID_INPUT/)
})
