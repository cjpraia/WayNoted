const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { initializeSecureStorage } = require('../electron/secure-storage.cjs')
const { setStorageCodec, readJson, atomicWrite, drain } = require('../electron/storage.cjs')
const { createLocalAI } = require('../electron/local-ai.cjs')

test('migration encrypts local content atomically and reopening uses the protected key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-secure-test-")), file = path.join(dir, 'data', 'docs', 'example.json')
  const keychain = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`test-protection:${text}`), decryptString: bytes => bytes.toString().replace('test-protection:', '') }
  try {
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '{"content":"private"}')
    const result = await initializeSecureStorage(dir, keychain, { deviceCipher: 'keychain' })
    assert.equal(result.enabled, true); assert.equal((await fs.readFile(file)).includes(Buffer.from('private')), false)
    assert.deepEqual(await readJson(file), { content: 'private' })
    await atomicWrite(file, JSON.stringify({ content: 'next' }))
    setStorageCodec(null); await initializeSecureStorage(dir, keychain, { deviceCipher: 'keychain' })
    assert.deepEqual(await readJson(file), { content: 'next' })
    const portable = path.join(dir, 'export.json')
    await atomicWrite(portable, '{"portable":true}'); assert.equal(await fs.readFile(portable, 'utf8'), '{"portable":true}')
  } finally { await drain(); setStorageCodec(null); await fs.rm(dir, { recursive: true, force: true }) }
})

test('local AI only uses fixed loopback routes and rejects cloud models without inference', async () => {
  const calls = []
  const ai = createLocalAI(async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [
      { name: 'local:7b', size: 1000, details: { format: 'gguf' } }, { name: 'remote:cloud', size: 1000, details: { format: 'gguf' } }, { name: 'alias', size: 1000, remote_host: 'https://remote.example', details: { format: 'gguf' } },
    ] }) }
    return { ok: true, json: async () => ({ response: 'Only a preview' }) }
  })
  assert.deepEqual(await ai.models(), ['local:7b'])
  await assert.rejects(ai.generate({ model: 'remote:cloud', prompt: 'Write', context: '', operation: 'write', locale: 'en-US' }), /MODEL_UNAVAILABLE/)
  assert.equal(calls.filter(call => call.url.endsWith('/api/generate')).length, 0)
  assert.equal(await ai.generate({ model: 'local:7b', prompt: 'Summarize', context: 'Example', operation: 'summarize', locale: 'en-US' }), 'Only a preview')
  assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:11434/') && call.init.redirect === 'error'))
  assert.equal(JSON.parse(calls.at(-1).init.body).stream, false)
})

test('unavailable Keychain fails before creating or migrating workspace files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-keychain-unavailable-"))
  try {
    await assert.rejects(initializeSecureStorage(dir, { isEncryptionAvailable: () => false }, { deviceCipher: 'keychain' }), /KEYCHAIN_UNAVAILABLE/)
    assert.deepEqual(await fs.readdir(dir), [])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
