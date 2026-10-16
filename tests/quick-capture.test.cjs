const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../electron/quick-capture-core.cjs')
const { trayBitmap } = require('../electron/tray.cjs')

const UUID = /^[0-9a-f-]{36}$/
function meta(extra = {}) {
  const now = 1
  const page = (id, init = {}) => ({ id, parentId: null, title: id, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...init })
  return { settings: { locale: 'pt-BR', userName: 'Ana', recent: ['22222222-2222-4222-8222-222222222222'] }, pages: {
    '11111111-1111-4111-8111-111111111111': page('11111111-1111-4111-8111-111111111111', { title: 'Projetos' }),
    '22222222-2222-4222-8222-222222222222': page('22222222-2222-4222-8222-222222222222', { title: 'Tarefas', database: { properties: [{ id: 'p-title', name: 'Nome', type: 'title' }, { id: 'p-tags', name: 'Tags', type: 'multiSelect', options: [{ id: 'o1', name: 'Ideia', color: 'blue' }] }, { id: 'p-date', name: 'Prazo', type: 'date' }, { id: 'p-url', name: 'Link', type: 'url' }], views: [], activeViewId: '' } }),
    '33333333-3333-4333-8333-333333333333': page('33333333-3333-4333-8333-333333333333', { title: 'Linha', parentId: '22222222-2222-4222-8222-222222222222' }),
    '44444444-4444-4444-8444-444444444444': page('44444444-4444-4444-8444-444444444444', { title: 'Lixo', trashed: true }),
    ...extra,
  } }
}
const para = text => ({ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] })

test('accelerators need a non-Shift modifier and a single valid key', () => {
  for (const ok of ['Alt+Command+N', 'Alt+Shift+Command+N', 'Control+Space', 'Command+F5']) assert.equal(core.isValidAccelerator(ok), true, ok)
  for (const bad of ['N', 'Shift+N', 'Command+', 'Command+Command+N', 'Hyper+N', 'Command+NN', '', 42]) assert.equal(core.isValidAccelerator(bad), false, String(bad))
})

test('preferences fall back to safe defaults and drop invalid inbox ids', () => {
  const prefs = core.normalizePrefs({ shortcut: 'Shift+X', captureShortcut: '', showTray: 'yes', inbox: { default: '11111111-1111-4111-8111-111111111111', evil: 'x', '../a': '11111111-1111-4111-8111-111111111111' } })
  assert.equal(prefs.shortcut, 'Alt+Command+N')
  assert.equal(prefs.captureShortcut, '')
  assert.equal(prefs.showTray, true)
  assert.deepEqual(Object.keys(prefs.inbox), ['default'])
})

test('destination search lists live pages and databases, never rows or trash, recent first', () => {
  const results = core.searchDestinations(meta(), '')
  assert.deepEqual(results.map(item => item.title), ['Tarefas', 'Projetos'])
  assert.equal(results[0].database, true)
  assert.deepEqual(core.searchDestinations(meta(), 'proj').map(item => item.title), ['Projetos'])
  const info = core.destinationInfo(meta(), '22222222-2222-4222-8222-222222222222')
  assert.equal(info.tags.id, 'p-tags'); assert.deepEqual(info.tags.options, ['Ideia']); assert.equal(info.date.name, 'Prazo')
})

test('default destination creates the "Notas rápidas" database once and adds the note as a row', () => {
  const first = core.applyQuickNote(meta(), { title: 'Comprar pão', blocks: [para('na padaria')], tags: ['casa'] }, { now: 5 })
  const inbox = first.meta.pages[first.parentId]
  assert.equal(inbox.title, 'Notas rápidas'); assert.ok(inbox.database); assert.equal(first.createdInbox, true)
  const row = first.meta.pages[first.pageId]
  assert.equal(row.parentId, first.parentId); assert.equal(row.title, 'Comprar pão'); assert.equal(row.text, 'na padaria'); assert.equal(row.createdBy, 'Ana')
  const tagsProp = inbox.database.properties.find(prop => prop.type === 'multiSelect')
  assert.equal(tagsProp.options[0].name, 'casa'); assert.deepEqual(row.props[tagsProp.id], [tagsProp.options[0].id])
  const second = core.applyQuickNote(first.meta, { title: 'Outra', blocks: [] }, { inboxId: first.inboxId })
  assert.equal(second.parentId, first.parentId); assert.equal(second.createdInbox, false)
})

test('database destination maps existing/new tags, date and source URL; page destination creates a subpage', () => {
  const db = core.applyQuickNote(meta(), { title: '', blocks: [para('Primeira linha vira título')], destinationId: '22222222-2222-4222-8222-222222222222', tags: ['ideia', 'Novo'], date: '2026-10-07', sourceUrl: 'https://example.com/a' })
  const row = db.meta.pages[db.pageId], tags = db.meta.pages['22222222-2222-4222-8222-222222222222'].database.properties[1].options
  assert.equal(row.title, 'Primeira linha vira título')
  assert.equal(row.props['p-tags'][0], 'o1'); assert.equal(tags.length, 2); assert.equal(tags[1].name, 'Novo')
  assert.deepEqual(row.props['p-date'], { start: '2026-10-07' }); assert.equal(row.props['p-url'], 'https://example.com/a')
  assert.equal(db.blocks.at(-1).content[1].href, 'https://example.com/a')
  const sub = core.applyQuickNote(meta(), { title: 'Sub', blocks: [], destinationId: '11111111-1111-4111-8111-111111111111', tags: ['x'] })
  assert.equal(sub.meta.pages[sub.pageId].parentId, '11111111-1111-4111-8111-111111111111'); assert.equal(sub.meta.pages[sub.pageId].props, undefined)
})

test('invalid input is rejected or sanitized', () => {
  assert.throws(() => core.applyQuickNote(meta(), { title: '  ', blocks: [] }), /Nada para salvar/)
  assert.throws(() => core.applyQuickNote(meta(), { title: 'x', blocks: [], destinationId: '44444444-4444-4444-8444-444444444444' }), /Destino indisponível/)
  const locked = meta({ '55555555-5555-4555-8555-555555555555': { ...meta().pages['11111111-1111-4111-8111-111111111111'], id: '55555555-5555-4555-8555-555555555555', locked: true } })
  assert.throws(() => core.applyQuickNote(locked, { title: 'x', blocks: [], destinationId: '55555555-5555-4555-8555-555555555555' }), /bloqueada/)
  const clean = core.validateInput({ title: 'a', date: '2026-02-30', sourceUrl: 'javascript:alert(1)', destinationId: '../x' })
  assert.equal(clean.date, null); assert.equal(clean.sourceUrl, null); assert.equal(clean.destinationId, null)
})

test('capture links and clipboard capture read text plus a browser source URL when present', () => {
  assert.deepEqual(core.parseCaptureLink("workspace://capture?text=Ol%C3%A1&url=https%3A%2F%2Fa.dev%2Fx&title=T"), { text: 'Olá', title: 'T', sourceUrl: 'https://a.dev/x' })
  assert.equal(core.parseCaptureLink("workspace://capture?url=file:///etc/passwd").sourceUrl, null)
  assert.equal(core.parseCaptureLink("workspace://page/abc"), null)
  const chromium = { readText: () => 'trecho', availableFormats: () => ['text/plain', 'org.chromium.source-url'], readBuffer: type => Buffer.from(type === 'org.chromium.source-url' ? 'https://news.example/item\u0000' : ''), readBookmark: () => ({ title: '', url: '' }) }
  assert.deepEqual(core.clipboardCapture(chromium), { text: 'trecho', sourceUrl: 'https://news.example/item' })
  const plain = { readText: () => 'só texto', availableFormats: () => ['text/plain'], readBuffer: () => Buffer.alloc(0), readBookmark: () => ({ title: '', url: '' }) }
  assert.deepEqual(core.clipboardCapture(plain), { text: 'só texto', sourceUrl: null })
})

test('tray template icon is a monochrome bitmap with transparent background', () => {
  const bitmap = trayBitmap(32)
  assert.equal(bitmap.length, 32 * 32 * 4)
  let opaque = 0, colored = 0
  for (let i = 0; i < bitmap.length; i += 4) { if (bitmap[i + 3] > 0) opaque++; if (bitmap[i] || bitmap[i + 1] || bitmap[i + 2]) colored++ }
  assert.equal(colored, 0)
  assert.ok(opaque > 100 && opaque < 700, String(opaque))
  assert.equal(bitmap[3], 0)
})

test('main process wires quick capture, tray, focus menu and keeps running without windows', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/main.cjs'), 'utf8')
  assert.match(source, /createQuickCapture\(/); assert.match(source, /createTray\(/)
  assert.match(source, /accelerator: accel\('focus', 'CmdOrCtrl\+Shift\+F'\), click: \(\) => sendCommand\('focus-mode'\)/)
  assert.match(source, /if \(process\.platform !== 'darwin'\) app\.quit\(\)/)
  assert.match(source, /quickCapture\.handleUrl/)
  assert.ok(UUID.test('11111111-1111-4111-8111-111111111111'))
})
