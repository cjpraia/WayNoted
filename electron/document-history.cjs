const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { atomicWrite, readJson, removeFile } = require('./storage.cjs')

const transactions = new Map()

function run(file, operation) {
  const next = (transactions.get(file) || Promise.resolve()).catch(() => {}).then(operation)
  transactions.set(file, next)
  next.finally(() => { if (transactions.get(file) === next) transactions.delete(file) }).catch(() => {})
  return next
}

async function versionFiles(directory) {
  try { return (await fs.readdir(directory)).filter(name => /^\d{13}-[0-9a-f-]{36}\.json$/.test(name)).sort().reverse() }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

// --- Política de retenção (docs/USAGE.md, Histórico de versões) ---------------------------------
const HOUR = 3600000, DAY = 24 * HOUR
/** all: tudo até `all`; hourly: 1 por hora até `hourly`; daily: 1 por dia até `daily`; max: teto por página. */
const POLICIES = {
  default: { all: DAY, hourly: 7 * DAY, daily: 90 * DAY, max: 200 },
  long: { all: 7 * DAY, hourly: 30 * DAY, daily: 365 * DAY, max: 1000 },
  unlimited: null,
}

/** Decide quais versões ficam. `ids` em ordem do mais novo para o mais antigo; a data vem do prefixo do id. */
function retainedIds(ids, now, policyName = 'default', pinned = new Set()) {
  const policy = policyName in POLICIES ? POLICIES[policyName] : POLICIES.default
  if (!policy) return new Set(ids)
  const keep = new Set(ids.filter(id => pinned.has(id))), buckets = new Set(), candidates = []
  ids.forEach((id, index) => {
    if (pinned.has(id)) return
    const at = Number(id.slice(0, 13)), age = now - at
    if (index === 0 || age <= policy.all) { candidates.push(id); return }
    let bucket = null
    if (age <= policy.hourly) bucket = `h${Math.floor(at / HOUR)}`
    else if (age <= policy.daily) bucket = `d${Math.floor(at / DAY)}`
    if (bucket && !buckets.has(bucket)) { buckets.add(bucket); candidates.push(id) } // o mais recente de cada janela
  })
  for (const id of candidates.slice(0, policy.max)) keep.add(id)
  return keep
}

// --- Mídia deduplicada: blobs grandes (data:) ficam em versions/<id>/blobs/<sha256>.json --------
const BLOB_MARKER = 'np-blob:sha256:'
const BLOB_PATTERN = /np-blob:sha256:([0-9a-f]{64})/g
const BLOB_MIN_LENGTH = 4096
const blobFile = (directory, hash) => path.join(directory, 'blobs', `${hash}.json`)

async function externalize(directory, value, dedupe = true) {
  if (!dedupe) return JSON.stringify(value)
  const blobs = new Map()
  const text = JSON.stringify(value, (key, item) => {
    if (typeof item === 'string' && item.length > BLOB_MIN_LENGTH && item.startsWith('data:')) {
      const hash = createHash('sha256').update(item).digest('hex')
      blobs.set(hash, item); return BLOB_MARKER + hash
    }
    return item
  })
  for (const [hash, data] of blobs) {
    const file = blobFile(directory, hash)
    try { await fs.access(file) } catch { await atomicWrite(file, JSON.stringify(data)) }
  }
  return text
}

/** Versões antigas (sem marcadores) passam intactas. */
async function resolveBlobs(directory, version) {
  const text = JSON.stringify(version)
  const hashes = [...new Set([...text.matchAll(BLOB_PATTERN)].map(match => match[1]))]
  if (!hashes.length) return version
  let out = text
  for (const hash of hashes) {
    const data = await readJson(blobFile(directory, hash))
    if (typeof data === 'string') out = out.split(BLOB_MARKER + hash).join(JSON.stringify(data).slice(1, -1))
  }
  return JSON.parse(out)
}

async function collectBlobs(directory) {
  let names
  try { names = await fs.readdir(path.join(directory, 'blobs')) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const used = new Set()
  for (const name of await versionFiles(directory)) {
    const version = await readJson(path.join(directory, name))
    for (const match of JSON.stringify(version ?? '').matchAll(BLOB_PATTERN)) used.add(match[1])
  }
  for (const name of names) if (name.endsWith('.json') && !used.has(name.slice(0, -5))) await removeFile(path.join(directory, 'blobs', name))
}

// --- Versões fixadas/nomeadas (nunca podadas): versions/<id>/pins.json --------------------------
const pinsFile = directory => path.join(directory, 'pins.json')
const readPins = async directory => { const pins = await readJson(pinsFile(directory)); return pins && typeof pins === 'object' && !Array.isArray(pins) ? pins : {} }

async function prune(directory, options) {
  const files = await versionFiles(directory)
  const ids = files.map(name => name.slice(0, -5))
  const pins = await readPins(directory)
  const pinned = new Set(Object.keys(pins).filter(id => ids.includes(id)))
  const policy = options.policy ?? (options.limit > 0 ? 'unlimited' : 'default')
  let keep = retainedIds(ids, Date.now(), policy, pinned)
  // Teto legado por contagem (configuração antiga): o mais antigo cai primeiro, fixadas ficam.
  if (options.limit > 0) { const unpinned = ids.filter(id => keep.has(id) && !pinned.has(id)); for (const id of unpinned.slice(options.limit)) keep.delete(id) }
  let removed = 0
  for (const id of ids) if (!keep.has(id)) { await removeFile(path.join(directory, `${id}.json`)); removed++ }
  if (removed) await collectBlobs(directory)
}

function saveDocument(file, directory, blocks, options = {}) {
  return run(file, async () => {
    const previous = await readJson(file)
    const content = JSON.stringify(blocks)
    if (previous !== null && !Array.isArray(previous)) throw new Error('Conteúdo inválido; o original foi preservado.')
    const previousContent = previous === null ? null : JSON.stringify(previous)
    if (options.base !== undefined && options.base !== previousContent && previousContent !== content) {
      await snapshot(directory, blocks, options.page, 'conflict', Date.now(), options.dedupe)
      throw new Error('DOC_CONFLICT: Outra janela alterou esta página. Suas alterações foram preservadas no histórico como conflito.')
    }
    if (previous !== null && JSON.stringify(previous) !== content) {
      await snapshot(directory, previous, options.previousPage ?? options.page, options.checkpoint ? 'checkpoint' : 'edit', (await fs.stat(file)).mtimeMs, options.dedupe)
    }
    await atomicWrite(file, content)
    await prune(directory, options)
  })
}

async function snapshot(directory, blocks, page, reason, savedAt = Date.now(), dedupe = true) {
  const files = await versionFiles(directory)
  const timestamp = Math.max(Date.now(), files.length ? Number(files[0].slice(0, 13)) + 1 : 0)
  const id = `${timestamp}-${randomUUID()}`
  await atomicWrite(path.join(directory, `${id}.json`), await externalize(directory, { id, savedAt, blocks, page, reason }, dedupe))
}

function checkpointPage(file, directory, page, options = 0) {
  if (typeof options !== 'object') options = { limit: options }
  return run(file, async () => {
    const blocks = await readJson(file) ?? []
    if (!Array.isArray(blocks)) throw new Error('Conteúdo inválido; o original foi preservado.')
    await snapshot(directory, blocks, page, 'metadata', Date.now(), options.dedupe)
    await prune(directory, options)
  })
}

async function readDocument(file) {
  if (transactions.has(file)) await transactions.get(file)
  return readJson(file)
}

async function listVersions(file, directory) {
  if (transactions.has(file)) await transactions.get(file)
  const files = await versionFiles(directory)
  const versions = []
  for (const name of files) {
    const version = await resolveBlobs(directory, await readJson(path.join(directory, name)))
    if (!version || typeof version.id !== 'string' || !Array.isArray(version.blocks) || !Number.isFinite(version.savedAt)) throw new Error('Há uma versão inválida no histórico; os arquivos foram preservados.')
    versions.push(version)
  }
  const pins = await readPins(directory)
  return versions.map(version => pins[version.id] ? { ...version, pinned: true, ...(pins[version.id].name ? { name: pins[version.id].name } : {}) } : version)
}

function deleteDocument(file, directory) {
  return run(file, async () => { await removeFile(file); await fs.rm(directory, { recursive: true, force: true }) })
}

function importVersions(file, directory, versions, options = {}) {
  return run(file, async () => {
    if (!Array.isArray(versions) || versions.some(v => !v || !Array.isArray(v.blocks) || !Number.isFinite(v.savedAt))) throw new Error('Histórico inválido.')
    const files = await versionFiles(directory)
    if (files.length) throw new Error('O histórico desta página já existe.')
    const timestamp = Date.now()
    for (let index = versions.length - 1; index >= 0; index--) {
      const source = versions[index]
      const id = `${timestamp - index}-${randomUUID()}`
      await atomicWrite(path.join(directory, `${id}.json`), await externalize(directory, { ...source, id, savedAt: source.savedAt, blocks: source.blocks }, options.dedupe))
    }
  })
}

/** Fixa/nomeia (ou solta) uma versão: versões fixadas nunca são podadas. */
function pinVersion(file, directory, versionId, { pinned = true, name } = {}) {
  return run(file, async () => {
    if (!(await versionFiles(directory)).includes(`${versionId}.json`)) throw new Error('Versão não encontrada.')
    const pins = await readPins(directory)
    if (pinned) pins[versionId] = name ? { name: String(name).slice(0, 120) } : {}
    else delete pins[versionId]
    await atomicWrite(pinsFile(directory), JSON.stringify(pins))
  })
}

async function drainDocuments() { while (transactions.size) await Promise.all([...transactions.values()]) }
module.exports = { POLICIES, retainedIds, pinVersion, saveDocument, readDocument, listVersions, deleteDocument, drainDocuments, importVersions, checkpointPage }
