const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { saveDocument, readDocument, listVersions, importVersions, deleteDocument, drainDocuments } = require('../electron/document-history.cjs')

test('history preserves every distinct saved document and forced restore preserves current content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-history-test-"))
  const file = path.join(dir, 'doc.json'), history = path.join(dir, 'versions')
  try {
    const original = [{ content: 'original' }], second = [{ content: 'second' }], latest = [{ content: 'latest' }]
    await saveDocument(file, history, original)
    await saveDocument(file, history, second)
    await saveDocument(file, history, latest)
    let versions = await listVersions(file, history)
    assert.equal(versions.length, 2)
    assert.deepEqual(versions[0].blocks, second)
    assert.deepEqual(versions[1].blocks, original)
    await saveDocument(file, history, versions[1].blocks, { checkpoint: true })
    versions = await listVersions(file, history)
    assert.deepEqual(versions[0].blocks, latest)
    assert.deepEqual(await readDocument(file), original)
    await drainDocuments()
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('history retains 50 versions in order and imports a backup without replacing existing history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-history-limit-"))
  const file = path.join(dir, 'doc.json'), history = path.join(dir, 'versions')
  try {
    await Promise.all(Array.from({ length: 54 }, (_, index) => saveDocument(file, history, [{ index }], { checkpoint: true, limit: 50 })))
    const versions = await listVersions(file, history)
    assert.equal(versions.length, 50)
    assert.equal(versions[0].blocks[0].index, 52)
    assert.equal(versions.at(-1).blocks[0].index, 3)
    assert.equal((await readDocument(file))[0].index, 53)
    const imported = path.join(dir, 'imported.json'), importedHistory = path.join(dir, 'imported-history')
    await importVersions(imported, importedHistory, versions)
    const restored = await listVersions(imported, importedHistory)
    assert.deepEqual(restored.map(v => v.blocks), versions.map(v => v.blocks))
    await assert.rejects(importVersions(imported, importedHistory, versions), /já existe/)
    await deleteDocument(file, history)
    assert.equal(await readDocument(file), null)
    assert.deepEqual(await listVersions(file, history), [])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
