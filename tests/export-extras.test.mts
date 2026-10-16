import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exportCsv, parseCsv, parseCsvCompanion, csvCompanionHeader } from '../src/components/database/csv.ts'
import { dateExtras } from '../src/export/dateExtras.ts'

const require = createRequire(import.meta.url)
const { normalizePropertyValue } = require('../electron/local-api.cjs')
const { writePackage, safeRelative } = require('../electron/export.cjs')

const recurring = { start: '2026-10-08', startTime: '09:00', repeat: 'weekly', recurrence: { interval: 2, weekdays: [1, 3], monthly: 'weekday', until: '2027-01-01', anchor: '2026-10-08' }, reminder: 1440, completions: [1_700_000_000_000], completedCount: 3 }

test('CSV companion keeps recurrence, reminder and completion history on dates', () => {
  const parsed = parseCsvCompanion('date', JSON.stringify(recurring))
  assert.deepEqual(parsed, recurring)
  // Compatibilidade: datas antigas continuam iguais.
  assert.deepEqual(parseCsvCompanion('date', JSON.stringify({ start: '2026-01-02', repeat: 'daily' })), { start: '2026-01-02', repeat: 'daily' })
  // Campos inválidos são descartados sem perder a data.
  assert.deepEqual(parseCsvCompanion('date', JSON.stringify({ start: '2026-01-02', recurrence: { interval: 0 }, reminder: -5 })), { start: '2026-01-02' })
})

test('CSV export → companion parse round-trips a recurring date', () => {
  const schema = { properties: [{ id: 't', name: 'Nome', type: 'title' }, { id: 'd', name: 'Prazo', type: 'date' }], views: [{ id: 'v', name: 'T', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v' }
  const row = { id: 'r', parentId: 'db', title: 'Tarefa', props: { d: recurring } }
  const rows = parseCsv(exportCsv(schema as never, [row as never], {}))
  const column = rows[0].indexOf(csvCompanionHeader('date', 'd'))
  assert.ok(column > 0)
  assert.deepEqual(parseCsvCompanion('date', rows[1][column]), recurring)
})

test('dateExtras validates each field', () => {
  const rejected: string[] = []
  assert.deepEqual(dateExtras({ recurrence: { weekdays: [7] }, reminder: 1.5, completions: ['x'], completedCount: -1 }, (field) => rejected.push(field)), {})
  assert.deepEqual(rejected, ['recurrence', 'reminder', 'completions', 'completedCount'])
})

test('local API keeps recurrence and reminder on date properties and rejects invalid ones', () => {
  const property = { id: 'd', name: 'Prazo', type: 'date' }
  assert.deepEqual(normalizePropertyValue(property, recurring, { pages: {} }), recurring)
  assert.deepEqual(normalizePropertyValue(property, '2026-10-08', { pages: {} }), { start: '2026-10-08' })
  assert.throws(() => normalizePropertyValue(property, { start: '2026-10-08', recurrence: { interval: -1 } }, { pages: {} }), /Invalid recurrence/)
  assert.throws(() => normalizePropertyValue(property, { start: '2026-10-08', reminder: 'soon' }, { pages: {} }), /Invalid reminder/)
})

test('native package writer creates the tree and refuses unsafe paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'np-export-'))
  try {
    await writePackage(dir, { 'A.md': '# A', 'A/B.md': '# B', 'assets/x.png': new Uint8Array([1, 2, 3]) })
    assert.equal(await readFile(path.join(dir, 'A', 'B.md'), 'utf8'), '# B')
    assert.equal((await readFile(path.join(dir, 'assets', 'x.png'))).length, 3)
    for (const bad of ['../x.md', '/abs.md', 'a/../../x', 'a\\b.md', 'a//b.md']) assert.equal(safeRelative(bad), null, bad)
    await assert.rejects(writePackage(dir, { '../escape.md': 'x' }), /Caminho inválido/)
    await assert.rejects(writePackage(dir, { 'A.md': 'again' }), /EEXIST/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
