import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, eventRangeForDate, eventsForDay, layoutSystemWeek, linkSignature, rangeForDays, systemEventDays, calendarErrorMessage } from '../src/components/calendar/eventMapping.ts'
import { composeTranscript, dictationErrorInfo, errorCode, transcriptContent } from '../src/components/dictation/dictationText.ts'

const local = (day: string, h = 0, m = 0, s = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m, s).toISOString() }
const ev = (id: string, start: string, end: string, allDay = false) => ({ id, itemId: id, calendarId: 'c', calendarTitle: 'Work', color: '#ff0000', title: id, start, end, allDay, location: '', readOnly: true })
const t = (pt: string, en: string) => `${pt}|${en}`

test('row dates become all-day or timed event ranges, respecting explicit time zones', () => {
  const allDay = eventRangeForDate({ start: '2026-10-07', end: '2026-10-09' }, 'America/Sao_Paulo')!
  assert.equal(allDay.allDay, true)
  assert.equal(allDay.start, local('2026-10-07'))
  assert.equal(allDay.end, local('2026-10-09', 23, 59, 59))
  const timed = eventRangeForDate({ start: '2026-10-07', startTime: '09:30', endTime: '10:15', timeZone: 'America/Sao_Paulo' }, 'Europe/Lisbon')!
  assert.equal(timed.start, '2026-10-07T12:30:00.000Z')
  assert.equal(timed.end, '2026-10-07T13:15:00.000Z')
  assert.equal(timed.timeZone, 'America/Sao_Paulo')
  const noEnd = eventRangeForDate({ start: '2026-10-07', startTime: '23:30' }, 'UTC')!
  assert.equal(Date.parse(noEnd.end) - Date.parse(noEnd.start), 3_600_000)
  assert.equal(eventRangeForDate({ start: '' }, 'UTC'), null)
  assert.equal(eventRangeForDate(null, 'UTC'), null)
  assert.equal(eventRangeForDate({ start: '2026-02-30x' }, 'UTC'), null)
})

test('link signature changes with date or title and is stable otherwise', () => {
  const value = { start: '2026-10-07', startTime: '09:00' }
  assert.equal(linkSignature(value, 'A'), linkSignature({ ...value }, 'A'))
  assert.notEqual(linkSignature(value, 'A'), linkSignature({ ...value, start: '2026-10-08' }, 'A'))
  assert.notEqual(linkSignature(value, 'A'), linkSignature(value, 'B'))
  assert.notEqual(linkSignature(value, 'A'), linkSignature(null, 'A'))
})

test('system events map to inclusive local days and lay out in non-overlapping lanes', () => {
  assert.deepEqual(systemEventDays(ev('a', local('2026-10-07'), local('2026-10-07', 23, 59, 59), true)), { start: '2026-10-07', end: '2026-10-07' })
  assert.deepEqual(systemEventDays(ev('b', local('2026-10-07', 22), local('2026-10-08'))), { start: '2026-10-07', end: '2026-10-07' })
  assert.deepEqual(systemEventDays(ev('c', local('2026-10-07', 22), local('2026-10-08', 1))), { start: '2026-10-07', end: '2026-10-08' })
  const weekStart = '2026-10-04'
  const layout = layoutSystemWeek(weekStart, [
    ev('long', local('2026-10-02'), local('2026-10-06', 23, 59, 59), true),
    ev('mon', local('2026-10-05', 9), local('2026-10-05', 10)),
    ev('fri', local('2026-10-09', 9), local('2026-10-09', 10)),
    ev('outside', local('2026-10-12', 9), local('2026-10-12', 10)),
  ])
  assert.equal(layout.segments.length, 3)
  const long = layout.segments.find((segment) => segment.event.id === 'long')!
  assert.equal(long.startCol, 0); assert.equal(long.endCol, 2); assert.equal(long.continuesLeft, true); assert.equal(long.lane, 0)
  const mon = layout.segments.find((segment) => segment.event.id === 'mon')!
  assert.equal(mon.startCol, 1); assert.equal(mon.lane, 1)
  const fri = layout.segments.find((segment) => segment.event.id === 'fri')!
  assert.equal(fri.startCol, 5); assert.equal(fri.lane, 0)
  assert.equal(layout.lanes, 2)
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('today agenda lists all-day events first, then by time, and ranges cover whole days', () => {
  const list = eventsForDay([ev('late', local('2026-10-07', 15), local('2026-10-07', 16)), ev('early', local('2026-10-07', 8), local('2026-10-07', 9)), ev('all', local('2026-10-07'), local('2026-10-07', 23, 59, 59), true), ev('other', local('2026-10-08', 8), local('2026-10-08', 9))], '2026-10-07')
  assert.deepEqual(list.map((item) => item.id), ['all', 'early', 'late'])
  const range = rangeForDays('2026-10-07', '2026-10-07')
  assert.equal(range.start, local('2026-10-07')); assert.equal(range.end, local('2026-10-08'))
})

test('calendar error codes become actionable messages', () => {
  assert.match(calendarErrorMessage(new Error("Error invoking remote method 'np:calendarList': Error: CALENDAR_ACCESS_DENIED: Calendar access is denied."), t), /Calendários/)
  assert.match(calendarErrorMessage(new Error('NATIVE_HELPER_MISSING: x'), t), /build:native/)
})

test('dictation transcript keeps final segments and shows the live partial in gray', () => {
  const finals = new Map([[1, 'segundo trecho.'], [0, 'Primeiro trecho.']])
  const composed = composeTranscript(finals, { segment: 2, text: 'ao vivo' })
  assert.equal(composed.committed, 'Primeiro trecho. segundo trecho.')
  assert.equal(composed.live, 'ao vivo')
  assert.equal(composeTranscript(finals, { segment: 1, text: 'stale' }).live, '')
  const content = transcriptContent(composed.committed, composed.live, false)
  assert.equal(content.length, 2)
  assert.equal(content[1].styles.textColor, 'gray')
  assert.deepEqual(transcriptContent(composed.committed, composed.live, true), [{ type: 'text', text: 'Primeiro trecho. segundo trecho. ao vivo', styles: {} }])
  assert.deepEqual(transcriptContent('', '', true), [])
})

test('dictation errors explain on-device unavailability without suggesting cloud fallback', () => {
  const info = dictationErrorInfo('ON_DEVICE_UNAVAILABLE', 'unavailable for pt-BR', 'pt-BR')
  assert.equal(info.pane, 'dictation')
  assert.match(info.text, /nunca usa reconhecimento na nuvem/)
  assert.equal(dictationErrorInfo('MIC_DENIED', '', 'en-US').pane, 'microphone')
  assert.equal(dictationErrorInfo('SPEECH_DENIED', '', 'en-US').pane, 'speech')
  assert.deepEqual(errorCode(new Error("Error invoking remote method 'np:dictationStart': Error: MIC_DENIED: Microphone permission was denied.")), { code: 'MIC_DENIED', message: 'Microphone permission was denied.' })
})

test('Ditado desligado no macOS (kLSRErrorDomain 201) vira mensagem amigável com atalho para Teclado', () => {
  const pt = dictationErrorInfo('SPEECH_ERROR', 'kLSRErrorDomain 201: Siri and Dictation are disabled', 'pt-BR')
  assert.equal(pt.pane, 'dictation')
  assert.match(pt.text, /Ditado está desligado/)
  assert.doesNotMatch(pt.text, /kLSR/)
  assert.match(dictationErrorInfo('X', 'Siri and Dictation are disabled', 'en-US').text, /Dictation is turned off/)
})
