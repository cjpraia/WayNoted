import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceSchedule, collectDueReminders } from '../electron/reminders.mjs'
import { translate } from '../src/localization.ts'

test('recurring reminders catch up once after downtime and preserve inbox history', () => {
  const now = new Date(2026, 9, 6, 10).getTime(), dueAt = new Date(2026, 9, 3, 10).getTime()
  const item: any = { id: 'n', pageId: 'p', title: 'Note', body: '', dueAt, createdAt: dueAt, firedAt: null, readAt: null, repeat: 'daily' }
  const pages: any = { p: { id: 'p', parentId: null } }
  const result = collectDueReminders({ n: item }, pages, now, () => 'next')
  assert.equal(result.due.length, 1); assert.equal(result.notifications.n.firedAt, now)
  assert.ok(result.notifications.next.dueAt > now)
  assert.equal(collectDueReminders(result.notifications, pages, now, () => 'another').due.length, 0)
  assert.equal(collectDueReminders({ n: item }, { p: { ...pages.p, trashed: true } }, now, () => 'next').due.length, 0)
})
test('calendar recurrence clamps January 31 to the last day of February', () => {
  const date = new Date(advanceSchedule(new Date(2026, 0, 31, 9, 15).getTime(), 'monthly'))
  assert.equal(date.getMonth(), 1); assert.equal(date.getDate(), 28); assert.equal(date.getHours(), 9)
})
test('interface locale switches messages and substitutes variables without changing content', () => {
  assert.equal(translate('en-US', '{count} páginas', '{count} pages', { count: 3 }), '3 pages')
  assert.equal(translate('pt-BR', 'Português', 'English'), 'Português')
})
