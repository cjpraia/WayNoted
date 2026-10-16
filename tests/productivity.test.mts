import COMPAT from '../shared/compatibility.ts'
// Painel de Produtividade: lógica pura (src/activity, electron/productivity-data.mjs).
process.env.TZ = 'America/New_York'
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyBackfill, applyDelta, clearedData, dayKey, emptyData, normalizeData, PAGES_PER_DAY, SESSION_GAP_MS, trimPages } from '../electron/productivity-data.mjs'
import { countChecked, countWords, docStats } from '../src/activity/words.ts'
import { ActivityRecorder, EDIT_WINDOW_MS } from '../src/activity/recorder.ts'
import { addDays, heatmap, resolveWeekStart, startOfWeek, streaks, summarize, topPageIds, weekComparison, workedLists, yearsWithData } from '../src/activity/stats.ts'
import { reconstruct, runBackfill } from '../src/activity/backfill.ts'
import { bookComparison, bookSentence } from '../src/activity/books.ts'
import { completesTask } from '../src/activity/tasks.ts'
import { ProductivityClient, browserBackend } from '../src/activity/client.ts'

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (iso: string) => new Date(iso).getTime()
const memory = () => { const store = new Map<string, string>(); return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } }
const text = (value: string) => [{ id: 'b', type: 'paragraph', content: [{ type: 'text', text: value }], children: [] }]
const toText = (blocks: unknown[]) => (blocks as { content?: { text: string }[] }[]).map(b => (b.content ?? []).map(c => c.text).join('')).join('\n')

test('words: letters/numbers, contractions and hyphens; checked items at any depth', () => {
  assert.equal(countWords(''), 0)
  assert.equal(countWords('Olá, mundo! 2026 é guarda-chuva e it’s ok'), 8)
  assert.equal(countWords('  —  … ##'), 0)
  const blocks = [{ type: 'checkListItem', props: { checked: true }, children: [{ type: 'checkListItem', props: { checked: true } }, { type: 'checkListItem', props: { checked: false } }] }, { type: 'paragraph' }]
  assert.equal(countChecked(blocks), 2)
  assert.deepEqual(docStats(text('um dois três'), toText), { words: 3, checked: 0 })
})

test('recorder: positive gains with a high-water mark per burst (deleting/retyping/reformatting is not rewarded)', () => {
  let now = at('2026-10-07T09:00:00')
  const r = new ActivityRecorder({ now: () => now })
  r.docSaved(P(1), { words: 0, checked: 0 }, { words: 100, checked: 0 }, true)
  now += 5000; r.docSaved(P(1), { words: 100, checked: 0 }, { words: 50, checked: 0 }, true) // apagou
  now += 5000; r.docSaved(P(1), { words: 50, checked: 0 }, { words: 100, checked: 0 }, true) // reescreveu
  now += 5000; r.docSaved(P(1), { words: 100, checked: 0 }, { words: 100, checked: 0 }, true) // reformatou
  now += 5000; r.docSaved(P(1), { words: 100, checked: 0 }, { words: 130, checked: 2 }, true)
  now += 5000; r.docSaved(P(1), { words: 130, checked: 2 }, { words: 130, checked: 1 }, true)
  now += 5000; r.docSaved(P(1), { words: 130, checked: 1 }, { words: 130, checked: 2 }, true) // desmarcar/marcar não infla
  let delta = r.take()!
  const day = delta.days['2026-10-07']
  assert.equal(day.words, 130)
  assert.equal(day.tasks, 2)
  assert.equal(day.edits, 2, 'saves within 30 s coalesce into edits (0 s and 30 s)')
  assert.equal(day.hours![9], 2)
  assert.deepEqual(day.pages![P(1)], [130, 2])
  // Pausa ≥ 10 min: nova rajada parte do tamanho atual; reescrever depois da pausa conta.
  now += SESSION_GAP_MS; r.docSaved(P(1), { words: 130, checked: 2 }, { words: 80, checked: 2 }, true)
  now += 1000; r.docSaved(P(1), { words: 80, checked: 2 }, { words: 90, checked: 2 }, true)
  delta = r.take()!
  assert.equal(delta.days['2026-10-07'].words, 0, 'below the new burst baseline (130 → 80 → 90)')
  assert.equal(delta.spans!.length, 2)
})

test('recorder: edits coalesce per page, creation and row completions, protected pages are never named', () => {
  let now = at('2026-10-07T22:59:50')
  const r = new ActivityRecorder({ now: () => now })
  r.edited(P(1), true); now += EDIT_WINDOW_MS - 1; r.edited(P(1), true); r.edited(P(2), false)
  r.created(P(3), true); r.created(P(4), false)
  r.taskCompleted(P(5), true); r.taskCompleted(P(5), true)
  now = at('2026-10-08T00:00:01'); r.taskCompleted(P(5), true)
  const delta = r.take()!
  const d7 = delta.days['2026-10-07'], d8 = delta.days['2026-10-08']
  assert.equal(d7.edits, 2)
  assert.equal(d7.created, 2)
  assert.equal(d7.tasks, 1, 'a row completed twice the same day counts once')
  assert.equal(d8.tasks, 1)
  assert.deepEqual(Object.keys(d7.pages!).sort(), [P(1), P(3), P(5)])
  assert.equal(r.take(), null)
  r.restore(delta)
  assert.equal(r.take()!.days['2026-10-07'].edits, 2, 'a failed write is retried with the same counts')
})

test('merge: commutative sums across windows, sessions counted once, top 20 pages per day', () => {
  const a = { at: 1, days: { '2026-10-07': { words: 10, edits: 1, hours: Array.from({ length: 24 }, (_, h) => h === 9 ? 1 : 0), pages: { [P(1)]: [10, 1] as [number, number] } } }, spans: [[at('2026-10-07T09:00'), at('2026-10-07T09:05')]] as [number, number][] }
  const b = { at: 2, days: { '2026-10-07': { words: 5, edits: 2, tasks: 1, pages: { [P(1)]: [5, 2] as [number, number], [P(2)]: [0, 1] as [number, number] } } }, spans: [[at('2026-10-07T09:03'), at('2026-10-07T09:12')]] as [number, number][] }
  const ab = applyDelta(applyDelta(emptyData(), a), b), ba = applyDelta(applyDelta(emptyData(), b), a)
  for (const merged of [ab, ba]) {
    const day = merged.days['2026-10-07']
    assert.equal(day.words, 15); assert.equal(day.edits, 3); assert.equal(day.tasks, 1)
    assert.deepEqual(day.pages![P(1)], [15, 3])
  }
  assert.equal(ab.days['2026-10-07'].sessions, 1, 'overlapping bursts from two windows are one session')
  // Reenvio da rajada aberta (mesmo início) não cria sessão nova.
  const again = applyDelta(ab, { days: {}, spans: [[at('2026-10-07T09:03'), at('2026-10-07T09:20')]] })
  assert.equal(again.days['2026-10-07'].sessions, 1)
  const later = applyDelta(again, { days: {}, spans: [[at('2026-10-07T09:31'), at('2026-10-07T09:40')]] })
  assert.equal(later.days['2026-10-07'].sessions, 2)
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [P(i + 1), [i, 0] as [number, number]]))
  const trimmed = trimPages(many)
  assert.equal(Object.keys(trimmed).length, PAGES_PER_DAY)
  assert.ok(!(P(1) in trimmed) && P(30) in trimmed)
  // Lixo no arquivo é descartado, nunca propagado.
  const dirty = normalizeData({ days: { 'x': { words: 1 }, '2026-01-01': { words: -5, edits: 'a', pages: { 'not-a-uuid': [1, 1] }, title: 'segredo' } }, extra: 'segredo' })
  assert.deepEqual(Object.keys(dirty.days), ['2026-01-01'])
  assert.equal(JSON.stringify(dirty).includes('segredo'), false)
  assert.equal(dirty.days['2026-01-01'].words, 0)
})

test('backfill applies once, only before live tracking, marked as estimated; clearing blocks a rebuild', () => {
  const live = applyDelta(emptyData(), { at: at('2026-10-05T10:00'), days: { '2026-10-05': { edits: 1 } } })
  const filled = applyBackfill(live, { '2026-10-04': { words: 50, edits: 2 }, '2026-10-05': { words: 999 } }, at('2026-10-07T10:00'))
  assert.equal(filled.days['2026-10-04'].estimated, true)
  assert.equal(filled.days['2026-10-05'].words, 0, 'days with live tracking are not touched')
  assert.equal(applyBackfill(filled, { '2026-10-01': { words: 1 } }).days['2026-10-01'], undefined, 'only once')
  const cleared = clearedData(at('2026-10-07T10:00'))
  assert.deepEqual(cleared.days, {})
  assert.equal(applyBackfill(cleared, { '2026-10-01': { words: 1 } }).days['2026-10-01'], undefined)
})

test('aggregation: periods, peak hour, busiest weekday, active days, streaks (no guilt for today)', () => {
  const data = normalizeData({ days: {
    '2026-10-01': { words: 10, edits: 3, hours: hoursAt(18, 3) },
    '2026-10-02': { words: 0, edits: 1, hours: hoursAt(9, 1) },
    '2026-10-03': { created: 1 },
    '2026-10-05': { words: 5, edits: 2, hours: hoursAt(18, 2), estimated: true },
    '2026-10-06': { tasks: 2 },
    '2026-09-01': { words: 100, edits: 10, hours: hoursAt(7, 10) },
    '2026-10-04': { words: 0, edits: 0 },
  } })
  const all = summarize(data, 'all', '2026-10-07')
  assert.equal(all.words, 115); assert.equal(all.activeDays, 6); assert.equal(all.peakHour, 7); assert.equal(all.estimatedDays, 1)
  assert.equal(all.busiestWeekday, 2, '2026-09-01 is a Tuesday')
  const week = summarize(data, '7d', '2026-10-07')
  assert.equal(week.words, 15); assert.equal(week.peakHour, 18); assert.equal(week.tasks, 2)
  assert.equal(summarize(data, 'today', '2026-10-06').tasks, 2)
  assert.deepEqual(streaks(data, '2026-10-07'), { current: 2, longest: 3 }, 'today without activity keeps yesterday’s streak')
  assert.deepEqual(streaks(data, '2026-10-09'), { current: 0, longest: 3 })
})

test('week comparison and heatmap: 53×7 grid, week start, levels, months; DST-safe date math', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08')
  assert.equal(addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(addDays('2026-11-01', 1), '2026-11-02')
  // Fuso America/New_York: horário de verão começa 08/03/2026 às 02:00.
  assert.equal(dayKey(at('2026-03-08T01:59:00-05:00')), '2026-03-08')
  assert.equal(dayKey(at('2026-03-08T23:30:00-04:00')), '2026-03-08')
  assert.equal(dayKey(at('2026-11-01T23:59:00-05:00')), '2026-11-01')
  const r = new ActivityRecorder({ now: () => at('2026-03-08T03:30:00-04:00') })
  r.edited(P(1), true)
  assert.equal(r.take()!.days['2026-03-08'].hours![3], 1, 'local hour after the clock jump')
  assert.equal(startOfWeek('2026-10-07', 0), '2026-10-04')
  assert.equal(startOfWeek('2026-10-07', 1), '2026-10-05')
  const data = normalizeData({ days: { '2026-10-05': { words: 40, edits: 4 }, '2026-10-06': { words: 60 }, '2026-09-28': { words: 50, edits: 4 }, '2026-09-29': { words: 999 }, '2026-01-02': { words: 1 }, '2025-06-01': { words: 7 } } })
  const cmp = weekComparison(data, '2026-10-06', 1)
  assert.equal(cmp.current.words, 100); assert.equal(cmp.previous.words, 1049)
  assert.equal(cmp.change.edits, 0); assert.equal(weekComparison(data, '2026-10-05', 1).change.words, -20)
  const map = heatmap(data, '2026-10-07', 0, 'words')
  assert.equal(map.weeks.length, 53)
  assert.ok(map.weeks.every(week => week.length === 7 && week.every((cell, i) => i === 0 || addDays(week[i - 1].key, 1) === cell.key)))
  assert.equal(map.weeks[0][0].key, '2025-10-05'); assert.equal(map.weeks.at(-1)![6].key, '2026-10-10')
  assert.equal(map.weeks.at(-1)!.find(c => c.key === '2026-10-08')!.inRange, false)
  const levels = map.weeks.flat().filter(c => c.value).map(c => c.level)
  assert.ok(levels.every(level => level >= 1 && level <= 4) && levels.includes(4))
  assert.equal(map.weeks.flat().find(c => c.key === '2026-09-29')!.level, 4)
  assert.ok(map.months.length >= 12 && map.months.every((m, i) => i === 0 || m.column > map.months[i - 1].column))
  const year = heatmap(data, '2025-12-31', 1, 'words', '2025-01-01')
  assert.equal(year.weeks.flat().filter(c => c.inRange).length, 365)
  assert.deepEqual(yearsWithData(data, '2026-10-07'), [2026, 2025])
  assert.equal(resolveWeekStart('monday', 'pt-BR'), 1)
  assert.equal(resolveWeekStart('auto', 'en-US'), 0)
  assert.equal(resolveWeekStart('auto', 'pt-BR'), 0)
})

test('most worked: protected and trashed pages never appear; rows add up to their database', () => {
  const page = (id: string, parentId: string | null = null, extra = {}) => ({ id, parentId, title: id, ...extra })
  const pages = { [P(1)]: page(P(1)), [P(2)]: page(P(2), null, { secret: true }), [P(3)]: page(P(3), null, { database: {} }), [P(4)]: page(P(4), P(3)), [P(5)]: page(P(5), P(3)), [P(6)]: page(P(6), null, { trashed: true }) } as Record<string, { id: string; parentId: string | null; title: string; database?: unknown; secret?: boolean; trashed?: boolean }>
  const data = normalizeData({ days: { '2026-10-07': { words: 1, pages: { [P(1)]: [10, 1], [P(2)]: [500, 9], [P(4)]: [20, 1], [P(5)]: [5, 2], [P(6)]: [99, 9], [P(9)]: [1, 1] } } } })
  const ids = topPageIds(data, 'all', '2026-10-07')
  assert.equal(ids[0].id, P(2))
  const lists = workedLists(ids, pages, id => !pages[id].secret && !pages[id].trashed)
  assert.deepEqual(lists.pages.map(e => e.page.id), [P(1)])
  assert.deepEqual(lists.databases.map(e => [e.page.id, e.words, e.edits]), [[P(3), 25, 3]])
})

test('backfill reconstruction: created/updated dates, word gains between versions, completions, sessions', () => {
  const pages = [
    { id: P(1), createdAt: at('2026-09-01T10:00'), updatedAt: at('2026-09-03T15:00'), named: true, snapshots: [
      { savedAt: at('2026-09-01T10:05'), text: 'um dois três', checked: 0 },
      { savedAt: at('2026-09-02T11:00'), text: 'um dois', checked: 1 },
      { savedAt: at('2026-09-02T11:01'), text: 'um dois', checked: 1 },
      { savedAt: at('2026-09-03T15:00'), text: 'um dois três quatro cinco', checked: 1 },
    ] },
    { id: P(2), createdAt: at('2026-09-02T08:00'), updatedAt: at('2026-09-05T08:00'), named: false, doneAt: [at('2026-09-04T12:00')] },
    { id: P(3), createdAt: at('2026-10-07T08:00'), updatedAt: at('2026-10-07T09:00'), named: true },
  ]
  const days = reconstruct(pages, '2026-10-01')
  assert.equal(days['2026-09-01'].words, 3); assert.equal(days['2026-09-01'].created, 1)
  assert.equal(days['2026-09-02'].words, 0); assert.equal(days['2026-09-02'].tasks, 1); assert.equal(days['2026-09-02'].edits, 1, 'identical snapshots do not count')
  assert.equal(days['2026-09-03'].words, 3)
  assert.equal(days['2026-09-04'].tasks, 1)
  assert.equal(days['2026-09-05'].edits, 1)
  assert.equal(days['2026-09-05'].pages, undefined, 'unnamed (protected) pages never stored by id')
  assert.deepEqual(days['2026-09-01'].pages![P(1)], [3, 1])
  assert.equal(days['2026-10-07'], undefined, 'only before live tracking')
  assert.ok(Object.values(days).every(day => day.estimated))
  assert.equal(days['2026-09-01'].sessions, 1, 'created 10:00 and saved 10:05 are one session')
  assert.equal(days['2026-09-01'].hours[10], 1)
})

test('backfill runner: reads versions in idle slices, skips protected pages, cancellable', async () => {
  const page = (n: number, extra = {}) => ({ id: P(n), parentId: null, title: 't', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: at('2026-08-01T10:00'), updatedAt: at('2026-08-03T10:00'), order: 0, fullWidth: false, smallText: false, font: 'default' as const, locked: false, text: 'a b c d', bodyText: 'a b c d', ...extra })
  const pages = { [P(1)]: page(1), [P(2)]: page(2, { passwordLock: { rootId: P(2), hideTitle: true } }) }
  const read: string[] = []
  const source = {
    pages, hidden: (id: string) => id === P(2), isProtected: (id: string) => id === P(2),
    listVersions: async (id: string) => { read.push(id); return [{ id: 'v', savedAt: at('2026-08-02T10:00'), blocks: text('a b'), reason: 'edit' as const }] },
    loadDoc: async () => text('a b c d'), toText,
  }
  const progress: number[] = []
  const days = await runBackfill(source, '2026-10-01', { onProgress: done => progress.push(done) })
  assert.deepEqual(read, [P(1)], 'protected page history is never opened')
  assert.equal(days['2026-08-02'].words, 2); assert.equal(days['2026-08-03'].words, 2)
  assert.equal(days['2026-08-01'].created, 2, 'protected pages still count in totals')
  assert.deepEqual(progress, [0, 1])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runBackfill(source, '2026-10-01', { signal: controller.signal }), /Cancelado/)
})

test('completion rules: status "complete" group and the completion checkbox only', () => {
  const schema = { properties: [{ id: 'title', name: 'Nome', type: 'title' }, { id: 's', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] }, { id: 'c', name: 'Arquivado', type: 'checkbox' }], views: [], activeViewId: '' } as never
  assert.equal(completesTask(schema, 's', 'todo', 'done'), true)
  assert.equal(completesTask(schema, 's', 'done', 'done'), false)
  assert.equal(completesTask(schema, 'c', false, true), false, 'other checkboxes are not tasks')
  const checklist = { properties: [{ id: 'title', name: 'Nome', type: 'title' }, { id: 'c', name: 'Feito', type: 'checkbox' }], views: [], activeViewId: '' } as never
  assert.equal(completesTask(checklist, 'c', false, true), true)
})

test('book comparison sentence in pt/en', () => {
  assert.equal(bookComparison(0), null)
  assert.equal(bookComparison(8500)!.book.en, 'The Little Prince')
  assert.equal(bookComparison(80000)!.book.en, "Harry Potter and the Philosopher's Stone")
  assert.match(bookSentence(34000, 'pt-BR')!, /~1,5× o tamanho de “A Metamorfose”/)
  assert.match(bookSentence(1700, 'en-US')!, /about 10% of the length of “The Little Prince”/)
})

test('client: batched writes, locked workspace keeps counts in memory, disabled drops them, clear', async () => {
  const storage = memory()
  let locked = false, enabled = true, writes = 0
  const base = browserBackend(storage)
  const backend = { ...base, record: async (delta: Parameters<typeof base.record>[0]) => { if (locked) return { locked: true as const }; writes++; return base.record(delta) } }
  const client = new ProductivityClient(backend, () => enabled, undefined, 60000)
  client.edited(P(1), true); client.created(P(2), true)
  assert.equal(writes, 0, 'nothing written per event')
  assert.equal(client.view().days[dayKey(Date.now())].created, 1, 'pending counts visible before the write')
  locked = true; await client.flush()
  assert.equal(storage.getItem(COMPAT.record024), null)
  locked = false; await client.flush()
  assert.equal(writes, 1)
  assert.equal(normalizeData(JSON.parse(storage.getItem(COMPAT.record024)!)).days[dayKey(Date.now())].created, 1)
  enabled = false; client.edited(P(3), true); await client.flush()
  assert.equal(writes, 1)
  enabled = true; await client.clear()
  assert.deepEqual(JSON.parse(storage.getItem(COMPAT.record024)!).days, {})
})

function hoursAt(hour: number, count: number) { return Array.from({ length: 24 }, (_, h) => h === hour ? count : 0) }
