const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
// Backup do espaço FORA da pasta de dados (docs/DEVELOPMENT.md F3).
// Cada cópia é uma pasta `<raiz>/<espaço>/<AAAAMMDDThhmmssmmmZ>-<tipo>/` com `manifest.json` + `files/…`.
// Copia os arquivos exatamente como estão em disco: num espaço com senha eles já são texto cifrado
// (AES-256-GCM, chave do espaço) e o backup NUNCA grava texto claro; arquivos sem cifra num espaço
// com senha são selados com a chave do espaço antes de gravar. Sem Electron aqui: tudo testável.
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash, randomUUID } = require('node:crypto')
const { seal, open, isEncrypted, isVaultEncrypted, isPageEncrypted, VAULT_MAGIC } = require('./encryption.cjs')

const FORMAT = COMPAT.record008
const MANIFEST = 'manifest.json'
const SETTINGS_FILE = 'backup-settings.json'
// Versão de esquema que este app entende (electron/migrations, F2). Backups de esquema mais antigo são migrados ao abrir.
const SUPPORTED_SCHEMA = (() => { try { return Number(require('./migrations/index.cjs').CURRENT_SCHEMA_VERSION) || 1 } catch { return 1 } })()
const DEFAULT_RETENTION = Object.freeze({ daily: 7, weekly: 4, monthly: 6 })
const KINDS = ['auto', 'manual', 'pre-restore']
const SET_NAME = /^(\d{8}T\d{9}Z)-(auto|manual|pre-restore)$/
const VAULT_EXEMPT = new Set(['vault.json', 'vault-touchid.json'])
const SKIP_TOP = new Set(['backups']) // cópias JSON antigas ficam na pasta de dados e não entram (nem são apagadas)

function backupError(code, pt, en, cause) {
  const error = new Error(`${code}: ${pt} / ${en}`)
  error.code = code
  if (cause) error.cause = cause
  return error
}
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const sealAad = rel => `${COMPAT.record009}${rel}`
const vaultAad = rel => `${COMPAT.record010}${rel}`
const posix = rel => rel.split(path.sep).join('/')

function stamp(ms) { return new Date(ms).toISOString().replace(/[-:.]/g, '') } // 20261008T153000123Z
function parseStamp(text) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(text)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : NaN
}

/* ------------------------------ configuração ------------------------------ */

function defaultDirectory(userData) { return path.join(userData, 'Backups') }
/** Sugestão (nunca criada sozinha): pasta no iCloud Drive, se o iCloud Drive existir neste Mac. */
async function suggestICloud(home = os.homedir()) {
  const drive = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  let available = false
  try { available = (await fs.stat(drive)).isDirectory() } catch { /* sem iCloud Drive */ }
  return { path: path.join(drive, `${PRODUCT.name} Backups`), available }
}
function normalizeSettings(value, userData) {
  const v = value && typeof value === 'object' ? value : {}
  const int = (n, min, max, d) => Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Math.round(Number(n)))) : d
  const r = v.retention && typeof v.retention === 'object' ? v.retention : {}
  return {
    enabled: v.enabled !== false,
    intervalHours: int(v.intervalHours, 1, 24 * 30, 24),
    directory: typeof v.directory === 'string' && path.isAbsolute(v.directory) ? path.normalize(v.directory) : defaultDirectory(userData),
    retention: { daily: int(r.daily, 1, 365, DEFAULT_RETENTION.daily), weekly: int(r.weekly, 0, 520, DEFAULT_RETENTION.weekly), monthly: int(r.monthly, 0, 240, DEFAULT_RETENTION.monthly) },
  }
}
async function readSettings(userData) {
  let value = null
  try { value = JSON.parse(await fs.readFile(path.join(userData, SETTINGS_FILE), 'utf8')) } catch { /* padrão */ }
  return normalizeSettings(value, userData)
}
/** A pasta de backup não pode ficar dentro das pastas de dados do app (a cópia precisa sobreviver a elas). */
function assertOutsideData(directory, userData) {
  const target = path.resolve(directory)
  for (const forbidden of [path.join(userData, 'data'), path.join(userData, 'workspaces')]) {
    const rel = path.relative(forbidden, target)
    if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw backupError('BACKUP_DIR_INSIDE_DATA', `Escolha uma pasta fora da pasta de dados do ${PRODUCT.name}.`, `Choose a folder outside the ${PRODUCT.name} data folder.`)
  }
}
async function writeSettings(userData, patch) {
  const next = normalizeSettings({ ...(await readSettings(userData)), ...patch, retention: { ...(await readSettings(userData)).retention, ...(patch?.retention ?? {}) } }, userData)
  assertOutsideData(next.directory, userData)
  await writeFileAtomic(path.join(userData, SETTINGS_FILE), JSON.stringify(next, null, 2))
  return next
}

/* ------------------------------ arquivos ------------------------------ */

async function writeFileAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(tmp, 'wx', 0o600)
    try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
    await fs.rename(tmp, file)
  } catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error }
}

/** Arquivos regulares de uma pasta de dados (caminhos relativos com `/`), sem `backups/`, `.tmp` e links simbólicos. */
async function listDataFiles(root) {
  const out = []
  async function walk(dir, rel) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name
      if (!rel && SKIP_TOP.has(entry.name)) continue
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), r)
      else if (entry.isFile() && !entry.name.endsWith('.tmp') && entry.name !== '.DS_Store') out.push(r)
    }
  }
  await walk(root, '')
  return out.sort()
}
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.split('/').some(part => part === '..' || part === '' || part === '.')) throw backupError('BACKUP_BAD_PATH', 'Caminho inválido no backup.', 'Invalid path in backup.')
  return rel
}
const isProtected = buffer => isEncrypted(buffer) || isVaultEncrypted(buffer) || isPageEncrypted(buffer)

async function assertSpace(destRoot, needed) {
  if (typeof fs.statfs !== 'function') return
  let free
  try { const s = await fs.statfs(destRoot); free = s.bavail * s.bsize } catch { return }
  if (free < needed * 1.1 + 1024 * 1024) throw backupError('BACKUP_NO_SPACE', 'Sem espaço suficiente na pasta de backup.', 'Not enough free space in the backup folder.')
}

/* ------------------------------ criação ------------------------------ */

/**
 * @param {object} o
 * @param {string} o.dataDir pasta de dados do espaço
 * @param {string} o.destRoot pasta de backup (fora dos dados)
 * @param {string} o.workspaceId
 * @param {'auto'|'manual'|'pre-restore'} [o.kind]
 * @param {number} [o.schemaVersion]
 * @param {{enabled:boolean,key:Buffer|null}} [o.vault] estado do cofre do espaço
 * @param {(step:string,index:number)=>void} [o.failAt] gancho de teste: lança para simular falha de disco
 * @param {(done:number,total:number)=>void} [o.onProgress]
 */
async function createBackup(o) {
  const { dataDir, destRoot, workspaceId, kind = 'manual', schemaVersion = SUPPORTED_SCHEMA, vault = { enabled: false, key: null }, now = Date.now(), failAt, onProgress } = o
  if (!KINDS.includes(kind)) throw new Error('kind inválido')
  if (vault.enabled && !vault.key) throw backupError('VAULT_LOCKED', 'Desbloqueie o espaço para fazer o backup.', 'Unlock the workspace to back it up.')
  const files = await listDataFiles(dataDir)
  if (!files.length) throw backupError('BACKUP_EMPTY', 'Não há dados para copiar.', 'There is no data to copy.')
  const wsRoot = path.join(destRoot, workspaceId)
  const name = `${stamp(now)}-${kind}`
  const final = path.join(wsRoot, name), tmp = path.join(wsRoot, `.tmp-${randomUUID()}`)
  try {
    await fs.mkdir(path.join(tmp, 'files'), { recursive: true, mode: 0o700 })
    let total = 0
    const entries = {}, buffers = []
    for (const rel of files) {
      let raw
      try { raw = await fs.readFile(path.join(dataDir, rel)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      let sealed = false, data = raw
      if (vault.enabled && !VAULT_EXEMPT.has(rel) && !isProtected(raw)) { data = seal(raw, vault.key, VAULT_MAGIC, sealAad(rel)); sealed = true }
      entries[rel] = { sha256: sha256(data), size: data.length, ...(sealed ? { sealed: true } : {}) }
      total += data.length
      buffers.push([rel, data])
    }
    await assertSpace(destRoot, total)
    let done = 0
    for (const [rel, data] of buffers) {
      failAt?.('copy', done)
      const target = path.join(tmp, 'files', ...rel.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const handle = await fs.open(target, 'wx', 0o600)
      try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
      done++
      onProgress?.(done, buffers.length)
    }
    const manifest = { format: FORMAT, version: 1, schemaVersion, workspaceId, kind, createdAt: now, encrypted: !!vault.enabled, fileCount: done, totalSize: total, files: entries }
    failAt?.('manifest', done)
    await writeFileAtomic(path.join(tmp, MANIFEST), JSON.stringify(manifest, null, 2))
    // Verificação depois de copiar: relê do destino e confere cada hash antes de publicar a cópia.
    failAt?.('verify', done)
    const check = await verifyBackup(tmp)
    if (!check.ok) throw backupError('BACKUP_VERIFY_FAILED', 'A cópia gravada não confere com o original.', 'The written copy does not match the original.')
    await fs.rename(tmp, final)
    return { id: name, path: final, manifest }
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    if (error.code && /^(BACKUP_|VAULT_)/.test(error.code)) throw error
    throw backupError('BACKUP_WRITE_FAILED', `Não foi possível gravar o backup (${error.code || error.message}). Nenhuma cópia anterior foi alterada.`, `Could not write the backup (${error.code || error.message}). No earlier copy was changed.`, error)
  }
}

/* ------------------------------ verificação ------------------------------ */

async function readManifest(setDir) {
  let manifest
  try { manifest = JSON.parse(await fs.readFile(path.join(setDir, MANIFEST), 'utf8')) } catch { return null }
  if (!manifest || manifest.format !== FORMAT || typeof manifest.files !== 'object' || !manifest.files || !Number.isFinite(manifest.createdAt)) return null
  return manifest
}
/** Confere existência, tamanho e SHA-256 de cada arquivo. `quick` confere só existência e tamanho. */
async function verifyBackup(setDir, { quick = false } = {}) {
  const manifest = await readManifest(setDir)
  if (!manifest) return { ok: false, manifest: null, problems: [{ file: MANIFEST, reason: 'manifest' }] }
  const problems = []
  for (const [rel, entry] of Object.entries(manifest.files)) {
    try {
      safeRel(rel)
      const file = path.join(setDir, 'files', ...rel.split('/'))
      if (quick) { const stat = await fs.stat(file); if (stat.size !== entry.size) problems.push({ file: rel, reason: 'size' }); continue }
      const data = await fs.readFile(file)
      if (data.length !== entry.size) problems.push({ file: rel, reason: 'size' })
      else if (sha256(data) !== entry.sha256) problems.push({ file: rel, reason: 'hash' })
    } catch (error) { problems.push({ file: rel, reason: error.code === 'ENOENT' ? 'missing' : 'unreadable' }) }
  }
  return { ok: problems.length === 0, manifest, problems }
}

async function listBackups(destRoot, workspaceId, { verify = 'quick' } = {}) {
  const wsRoot = path.join(destRoot, workspaceId)
  let names
  try { names = await fs.readdir(wsRoot) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const out = []
  for (const id of names.filter(n => SET_NAME.test(n))) {
    const dir = path.join(wsRoot, id), match = SET_NAME.exec(id)
    const result = verify === 'none' ? { ok: null, manifest: await readManifest(dir), problems: [] } : await verifyBackup(dir, { quick: verify === 'quick' })
    const m = result.manifest
    out.push({
      id, kind: match[2], createdAt: m?.createdAt ?? parseStamp(match[1]), size: m?.totalSize ?? 0, fileCount: m?.fileCount ?? 0,
      encrypted: !!m?.encrypted, schemaVersion: m?.schemaVersion ?? null,
      // ok: true = hashes conferidos; 'quick' só confere tamanhos (não é "verificado").
      verified: verify === 'full' ? result.ok : null, healthy: result.ok, problems: result.problems.length,
    })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}
const setPath = (destRoot, workspaceId, id) => {
  if (!SET_NAME.test(String(id))) throw backupError('BACKUP_BAD_ID', 'Backup inválido.', 'Invalid backup.')
  return path.join(destRoot, workspaceId, id)
}

/* ------------------------------ retenção ------------------------------ */

// Semanas começam na segunda-feira (5/jan/1970 foi uma segunda).
const isoWeek = ms => Math.floor((ms - Date.UTC(1970, 0, 5)) / 604800000)
/** Quais cópias manter: a mais recente de cada um dos N últimos dias, semanas e meses (com cópia), + 3 "antes-da-restauração". */
function planRetention(sets, policy = DEFAULT_RETENTION) {
  const keep = new Set(), regular = sets.filter(s => s.kind !== 'pre-restore').sort((a, b) => b.createdAt - a.createdAt)
  const buckets = [['daily', ms => new Date(ms).toISOString().slice(0, 10)], ['weekly', isoWeek], ['monthly', ms => new Date(ms).toISOString().slice(0, 7)]]
  for (const [key, bucketOf] of buckets) {
    const seen = new Set()
    for (const set of regular) {
      const b = bucketOf(set.createdAt)
      if (seen.has(b)) continue
      if (seen.size >= (policy[key] ?? 0)) break
      seen.add(b); keep.add(set.id)
    }
  }
  if (regular[0]) keep.add(regular[0].id)
  sets.filter(s => s.kind === 'pre-restore').sort((a, b) => b.createdAt - a.createdAt).slice(0, 3).forEach(s => keep.add(s.id))
  return { keep: [...keep], remove: sets.filter(s => !keep.has(s.id)).map(s => s.id) }
}
async function applyRetention(destRoot, workspaceId, policy) {
  const sets = await listBackups(destRoot, workspaceId, { verify: 'none' })
  const { remove } = planRetention(sets, policy)
  // Nunca apaga a única cópia íntegra: se a mais recente estiver danificada, preserva a última boa.
  const lastGood = (await listBackups(destRoot, workspaceId, { verify: 'quick' })).find(s => s.healthy && s.kind !== 'pre-restore')
  for (const id of remove) if (id !== lastGood?.id) await fs.rm(setPath(destRoot, workspaceId, id), { recursive: true, force: true })
  return remove.filter(id => id !== lastGood?.id)
}
function isDue(sets, intervalHours, now = Date.now()) {
  const latest = sets.find(s => s.kind !== 'pre-restore')
  return !latest || now - latest.createdAt >= Math.max(1, intervalHours) * 3600000
}

/* ------------------------------ restauração ------------------------------ */

/** Resumo para a confirmação: data, tamanho, páginas, cifrado, versão do esquema. */
async function describeBackup(setDir) {
  const check = await verifyBackup(setDir)
  const m = check.manifest
  if (!m) return { ok: false, problems: check.problems }
  return {
    ok: check.ok, problems: check.problems, createdAt: m.createdAt, kind: m.kind, encrypted: !!m.encrypted, schemaVersion: m.schemaVersion,
    fileCount: m.fileCount, totalSize: m.totalSize, pages: Object.keys(m.files).filter(rel => /^docs\/[^/]+\.json$/.test(rel)).length,
    newerThanApp: m.schemaVersion > SUPPORTED_SCHEMA,
  }
}

async function readRestorable(setDir, manifest, rel, vault) {
  const entry = manifest.files[rel]
  let data = await fs.readFile(path.join(setDir, 'files', ...safeRel(rel).split('/')))
  if (entry.sealed) {
    if (!vault?.key) throw backupError('VAULT_LOCKED', 'Desbloqueie o espaço para restaurar este backup.', 'Unlock the workspace to restore this backup.')
    try { data = seal(open(data, vault.key, VAULT_MAGIC, sealAad(rel)), vault.key, VAULT_MAGIC, vaultAad(rel)) }
    catch (error) { throw backupError('BACKUP_KEY_MISMATCH', 'A senha atual do espaço não abre este backup.', 'The current workspace password cannot open this backup.', error) }
  }
  return data
}

/**
 * Restauração completa: verifica, guarda o estado atual como cópia "pre-restore", monta a árvore nova ao lado
 * e troca por renomeação. Se algo falhar antes da troca, a pasta de dados fica intacta.
 */
async function restoreFull(o) {
  const { setDir, dataDir, destRoot, workspaceId, vault = { enabled: false, key: null }, schemaVersion = SUPPORTED_SCHEMA, now = Date.now(), failAt } = o
  const check = await verifyBackup(setDir)
  if (!check.manifest) throw backupError('BACKUP_CORRUPT', 'Este backup está danificado (sem manifesto).', 'This backup is damaged (no manifest).')
  if (!check.ok) throw backupError('BACKUP_CORRUPT', `Este backup está danificado (${check.problems.length} arquivo(s) não conferem) e não será restaurado.`, `This backup is damaged (${check.problems.length} file(s) do not match) and will not be restored.`)
  const manifest = check.manifest
  if (manifest.schemaVersion > schemaVersion) throw backupError('BACKUP_TOO_NEW', `Este backup é de uma versão mais nova do ${PRODUCT.name}.`, `This backup comes from a newer ${PRODUCT.name} version.`)
  const rels = Object.keys(manifest.files)
  // Prepara todo o conteúdo (inclusive abrir arquivos selados) antes de tocar em qualquer coisa.
  const staging = `${dataDir}.restore-${randomUUID()}`, replaced = `${dataDir}.replaced-${randomUUID()}`
  let safety = null
  try {
    await fs.mkdir(staging, { recursive: true, mode: 0o700 })
    for (const rel of rels) {
      const data = await readRestorable(setDir, manifest, rel, vault)
      const target = path.join(staging, ...rel.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      failAt?.('stage', rel)
      const handle = await fs.open(target, 'wx', 0o600)
      try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
      if (!manifest.files[rel].sealed && sha256(await fs.readFile(target)) !== manifest.files[rel].sha256) throw backupError('BACKUP_VERIFY_FAILED', 'Falha ao conferir um arquivo restaurado.', 'A restored file failed verification.')
    }
    // Cópia de segurança do estado atual (mesmo corrompido: é uma cópia de arquivos, não interpreta o meta).
    if ((await listDataFiles(dataDir)).length) {
      safety = await createBackup({ dataDir, destRoot, workspaceId, kind: 'pre-restore', schemaVersion, vault, now: now + 1 })
    }
    failAt?.('swap', 0)
    let hadOld = true
    try { await fs.rename(dataDir, replaced) } catch (error) { if (error.code === 'ENOENT') hadOld = false; else throw error }
    try {
      if (hadOld) { try { await fs.rename(path.join(replaced, 'backups'), path.join(staging, 'backups')) } catch (error) { if (error.code !== 'ENOENT') throw error } }
      await fs.rename(staging, dataDir)
    } catch (error) {
      if (hadOld) await fs.rename(replaced, dataDir).catch(() => {}) // desfaz a troca
      throw error
    }
    if (hadOld) await fs.rm(replaced, { recursive: true, force: true }).catch(() => {})
    return { restored: rels.length, safetyBackup: safety?.id ?? null, encrypted: !!manifest.encrypted }
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Restauração parcial: sobrescreve só os arquivos escolhidos (ex.: o conteúdo de algumas páginas), com cópia de segurança antes. */
async function restoreFiles(o) {
  const { setDir, dataDir, destRoot, workspaceId, include, vault = { enabled: false, key: null }, schemaVersion = SUPPORTED_SCHEMA, now = Date.now() } = o
  const check = await verifyBackup(setDir)
  if (!check.manifest || !check.ok) throw backupError('BACKUP_CORRUPT', 'Este backup está danificado e não será restaurado.', 'This backup is damaged and will not be restored.')
  const manifest = check.manifest
  if (manifest.schemaVersion > schemaVersion) throw backupError('BACKUP_TOO_NEW', `Este backup é de uma versão mais nova do ${PRODUCT.name}.`, `This backup comes from a newer ${PRODUCT.name} version.`)
  const rels = Object.keys(manifest.files).filter(rel => rel !== 'meta.json' || include?.('meta.json')).filter(rel => !include || include(rel))
  const prepared = []
  for (const rel of rels) prepared.push([rel, await readRestorable(setDir, manifest, rel, vault)])
  let safety = null
  if ((await listDataFiles(dataDir)).length) safety = await createBackup({ dataDir, destRoot, workspaceId, kind: 'pre-restore', schemaVersion, vault, now: now + 1 })
  for (const [rel, data] of prepared) await writeFileAtomic(path.join(dataDir, ...rel.split('/')), data)
  return { restored: prepared.map(([rel]) => rel), safetyBackup: safety?.id ?? null }
}

/** Se uma restauração foi interrompida entre as duas renomeações, devolve a pasta antiga. */
async function recoverInterruptedRestore(dataDir) {
  try { await fs.access(dataDir); return false } catch { /* ausente */ }
  const parent = path.dirname(dataDir), base = path.basename(dataDir)
  let names = []
  try { names = (await fs.readdir(parent)).filter(n => n.startsWith(`${base}.replaced-`)) } catch { return false }
  if (!names.length) return false
  await fs.rename(path.join(parent, names[0]), dataDir)
  return true
}

/** Há uma cópia íntegra? (para a tela de recuperação "Abrir último backup verificado") */
async function latestVerified(destRoot, workspaceId) {
  for (const set of await listBackups(destRoot, workspaceId, { verify: 'none' })) {
    if (set.kind === 'pre-restore') continue
    if ((await verifyBackup(setPath(destRoot, workspaceId, set.id))).ok) return set.id
  }
  return null
}

module.exports = {
  FORMAT, MANIFEST, SUPPORTED_SCHEMA, DEFAULT_RETENTION, SET_NAME,
  defaultDirectory, suggestICloud, normalizeSettings, readSettings, writeSettings, assertOutsideData,
  listDataFiles, createBackup, verifyBackup, listBackups, setPath, planRetention, applyRetention, isDue,
  describeBackup, restoreFull, restoreFiles, recoverInterruptedRestore, latestVerified, backupError, sha256,
}
