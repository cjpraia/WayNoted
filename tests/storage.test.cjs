const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { atomicWrite, readJson, removeFile, drain } = require('../electron/storage.cjs')

test('concurrent saves preserve submission order and leave no temporary files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-storage-test-"))
  try {
    const file = path.join(dir, 'meta.json')
    await Promise.all(Array.from({ length: 30 }, (_, revision) => atomicWrite(file, JSON.stringify({ revision, body: 'a'.repeat(revision === 0 ? 200000 : 1) }))))
    await drain()
    assert.equal((await readJson(file)).revision, 29)
    assert.deepEqual(await fs.readdir(dir), ['meta.json'])
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    const saving = atomicWrite(file, '{"final":true}')
    const deleting = removeFile(file)
    await Promise.all([saving, deleting])
    assert.equal(await readJson(file), null)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('corruption raises an error without moving, truncating or replacing original bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-corrupt-test-"))
  try {
    const file = path.join(dir, 'page.json'), original = '{"blocks": unfinished'
    await fs.writeFile(file, original)
    await assert.rejects(readJson(file), /corrompido/)
    assert.equal(await fs.readFile(file, 'utf8'), original)
    assert.deepEqual(await fs.readdir(dir), ['page.json'])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('directory is fsynced after rename', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-fsync-test-"))
  const realOpen = fs.open, synced = []
  try {
    fs.open = async (target, flags, ...rest) => {
      const handle = await realOpen.call(fs, target, flags, ...rest)
      if (flags === 'r') { const sync = handle.sync.bind(handle); handle.sync = async () => { synced.push(target); return sync() } }
      return handle
    }
    await atomicWrite(path.join(dir, 'a.json'), '{}')
    assert.deepEqual(synced, [dir])
  } finally { fs.open = realOpen; await fs.rm(dir, { recursive: true, force: true }) }
})

test('disk full (ENOSPC) keeps the original intact, leaves no temp file and surfaces the error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-enospc-test-"))
  const file = path.join(dir, 'meta.json'), realOpen = fs.open, realRename = fs.rename
  const enospc = () => Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
  try {
    await atomicWrite(file, '{"v":1}')
    // 1) falha ao gravar o conteúdo
    fs.open = async (target, flags, ...rest) => {
      const handle = await realOpen.call(fs, target, flags, ...rest)
      if (flags === 'wx') handle.writeFile = async () => { throw enospc() }
      return handle
    }
    await assert.rejects(atomicWrite(file, '{"v":2}'), error => error.code === 'ENOSPC')
    fs.open = realOpen
    assert.equal(await fs.readFile(file, 'utf8'), '{"v":1}')
    assert.deepEqual(await fs.readdir(dir), ['meta.json'])
    // 2) falha no rename
    fs.rename = async () => { throw enospc() }
    await assert.rejects(atomicWrite(file, '{"v":3}'), error => error.code === 'ENOSPC')
    fs.rename = realRename
    assert.equal(await fs.readFile(file, 'utf8'), '{"v":1}')
    assert.deepEqual(await fs.readdir(dir), ['meta.json'])
    // a fila continua saudável depois do erro
    await atomicWrite(file, '{"v":4}'); assert.equal((await readJson(file)).v, 4)
  } finally { fs.open = realOpen; fs.rename = realRename; await fs.rm(dir, { recursive: true, force: true }) }
})

test('1,000 small writes stay fast enough with the directory fsync', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-perf-test-"))
  try {
    const started = Date.now()
    for (let i = 0; i < 200; i++) await atomicWrite(path.join(dir, 'p.json'), JSON.stringify({ i }))
    const per = (Date.now() - started) / 200
    console.log(`atomicWrite: ${per.toFixed(2)} ms/write`)
    assert.ok(per < 100, `too slow: ${per} ms/write`)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
