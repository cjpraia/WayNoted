const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { retainedIds, saveDocument, listVersions, pinVersion, drainDocuments } = require('../electron/document-history.cjs')

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0), HOUR = 3600000, DAY = 24 * HOUR
const id = at => `${at}-${randomUUID()}`
const newestFirst = list => [...list].sort().reverse()

test('default retention: all in 24 h, hourly to 7 days, daily to 90 days, nothing older, max 200', () => {
  const recent = Array.from({ length: 30 }, (_, i) => id(NOW - i * 10 * 60000))          // 30 versions in the last 5 h
  const hourly = [NOW - 2 * DAY - 1800000, NOW - 2 * DAY - 2400000, NOW - 2 * DAY - 3000000].map(id) // same hour, 2 days ago
  const daily = [NOW - 30 * DAY, NOW - 30 * DAY - HOUR].map(id)                            // same day, 30 days ago
  const ancient = [id(NOW - 91 * DAY)]
  const ids = newestFirst([...recent, ...hourly, ...daily, ...ancient])
  const keep = retainedIds(ids, NOW, 'default')
  for (const item of recent) assert.ok(keep.has(item), 'recent kept')
  assert.equal(hourly.filter(item => keep.has(item)).length, 1)
  assert.ok(keep.has(newestFirst(hourly)[0]), 'newest of the hour wins')
  assert.equal(daily.filter(item => keep.has(item)).length, 1)
  assert.ok(keep.has(newestFirst(daily)[0]))
  assert.ok(!keep.has(ancient[0]))
})

test('max 200 drops the oldest first, pinned versions are never pruned and unlimited keeps everything', () => {
  const ids = newestFirst(Array.from({ length: 260 }, (_, i) => id(NOW - i * 60000)))
  const keep = retainedIds(ids, NOW, 'default')
  assert.equal(keep.size, 200); assert.ok(keep.has(ids[0])); assert.ok(!keep.has(ids[259]))
  const old = id(NOW - 400 * DAY), pinned = retainedIds(newestFirst([...ids, old]), NOW, 'default', new Set([old]))
  assert.ok(pinned.has(old)); assert.equal(pinned.size, 201)
  assert.equal(retainedIds(ids, NOW, 'unlimited').size, 260)
  assert.ok(retainedIds([id(NOW - 200 * DAY), id(NOW - 100 * DAY)], NOW, 'long').size === 2)
})

test('saving prunes on disk, keeps pinned versions and reads old (inline base64) versions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-retention-test-"))
  const file = path.join(dir, 'doc.json'), versions = path.join(dir, 'versions')
  try {
    await fs.mkdir(versions, { recursive: true })
    const media = 'data:image/png;base64,' + 'A'.repeat(9000)
    // versão antiga no formato legado: mídia inline, 100 dias atrás (fora da janela), e uma recente
    const write = (at, extra) => fs.writeFile(path.join(versions, `${at}-${randomUUID()}.json`), JSON.stringify({ savedAt: at, blocks: [{ id: 'b', props: { url: media } }], reason: 'edit', ...extra }))
    const oldId = `${Date.now() - 100 * DAY}-${randomUUID()}`
    await fs.writeFile(path.join(versions, `${oldId}.json`), JSON.stringify({ id: oldId, savedAt: Date.now() - 100 * DAY, blocks: [{ id: 'b', props: { url: media } }], reason: 'edit' }))
    const doomedId = `${Date.now() - 95 * DAY}-${randomUUID()}`
    await fs.writeFile(path.join(versions, `${doomedId}.json`), JSON.stringify({ id: doomedId, savedAt: Date.now() - 95 * DAY, blocks: [], reason: 'edit' }))
    void write
    await pinVersion(file, versions, oldId, { pinned: true, name: 'Entregue ao cliente' })
    await saveDocument(file, versions, [{ id: 'x', text: 'one' }])
    await saveDocument(file, versions, [{ id: 'x', text: 'two' }])
    const listed = await listVersions(file, versions)
    const ids = listed.map(v => v.id)
    assert.ok(ids.includes(oldId), 'pinned old version survives'); assert.ok(!ids.includes(doomedId), 'unpinned old version is pruned')
    const pinned = listed.find(v => v.id === oldId)
    assert.equal(pinned.pinned, true); assert.equal(pinned.name, 'Entregue ao cliente'); assert.equal(pinned.blocks[0].props.url, media)
    await pinVersion(file, versions, oldId, { pinned: false })
    await saveDocument(file, versions, [{ id: 'x', text: 'three' }])
    assert.ok(!(await listVersions(file, versions)).some(v => v.id === oldId), 'unpinned version is pruned')
    await drainDocuments()
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('shared media is stored once by hash, resolved on read, and collected when no version needs it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-dedupe-test-"))
  const file = path.join(dir, 'doc.json'), versions = path.join(dir, 'versions')
  try {
    const media = 'data:image/png;base64,' + 'B'.repeat(20000)
    const blocks = n => [{ id: 'img', type: 'image', props: { url: media } }, { id: 't', type: 'paragraph', content: String(n) }]
    for (let n = 0; n < 5; n++) await saveDocument(file, versions, blocks(n))
    const blobs = await fs.readdir(path.join(versions, 'blobs'))
    assert.equal(blobs.length, 1, 'one blob for four versions')
    const sizes = await Promise.all((await fs.readdir(versions)).filter(n => n.endsWith('.json')).map(async n => (await fs.stat(path.join(versions, n))).size))
    assert.ok(sizes.every(size => size < 2000), 'versions carry only a reference')
    const listed = await listVersions(file, versions)
    assert.equal(listed.length, 4)
    for (const version of listed) assert.equal(version.blocks[0].props.url, media)
    // sem versões que usem o blob, ele é coletado (limite legado de 1 versão + mídia diferente)
    await saveDocument(file, versions, [{ id: 'z', text: 'no media' }], { limit: 1 })
    await saveDocument(file, versions, [{ id: 'z', text: 'no media 2' }], { limit: 1 })
    assert.deepEqual(await fs.readdir(path.join(versions, 'blobs')), [])
    await drainDocuments()
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
