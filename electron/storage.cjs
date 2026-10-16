const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const writes = new Map()
let codec = null
function setStorageCodec(value) { codec = value }

function ordered(file, operation) {
  const result = (writes.get(file) || Promise.resolve()).catch(() => {}).then(operation)
  writes.set(file, result)
  result.finally(() => { if (writes.get(file) === result) writes.delete(file) }).catch(() => {})
  return result
}

/** Durabilidade: sem fsync do diretório, o rename pode se perder numa queda de energia. */
async function syncDirectory(directory) {
  let handle
  try { handle = await fs.open(directory, 'r'); await handle.sync() }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'EACCES', 'ENOENT'].includes(error?.code)) throw error }
  finally { await handle?.close().catch(() => {}) }
}

function atomicWrite(file, content) {
  return ordered(file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(tmp, 'wx', 0o600)
      try { await handle.writeFile(codec ? codec.encode(file, content) : content, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await require('./fs-retry.cjs').rename(tmp, file)
      await syncDirectory(path.dirname(file))
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  })
}

async function readJson(file) {
  if (writes.has(file)) await writes.get(file)
  let content
  try { content = await fs.readFile(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  let text
  try { text = (codec ? codec.decode(file, content) : content).toString('utf8') }
  catch (error) { if (['VAULT_LOCKED', 'PAGE_LOCKED', 'VAULT_BUSY', 'DEVICE_KEY_REQUIRED'].includes(error?.code)) throw error; throw new Error(`Não foi possível descriptografar ${path.basename(file)}. A chave deste dispositivo é necessária; o arquivo foi preservado.`) }
  try { return JSON.parse(text) }
  catch { throw new Error(`O arquivo ${path.basename(file)} está corrompido. O original foi preservado; restaure uma cópia válida para continuar.`) }
}

function removeFile(file) { return ordered(file, () => fs.rm(file, { force: true })) }
async function drain() { while (writes.size) await Promise.all([...writes.values()]) }

module.exports = { atomicWrite, readJson, removeFile, drain, setStorageCodec }
