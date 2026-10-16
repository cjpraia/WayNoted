const PRODUCT = require('../shared/product.json')
// Armazenamento local: modos da "cifra do dispositivo" (docs/SECURITY.md).
//   none      (padrão)  arquivos normais 0600/0700; NENHUMA chamada a safeStorage/Keychain.
//   keychain  (opt-in)  AES-256-GCM com chave aleatória guardada no Keychain (Configurações → Segurança).
//   legacy              espaço antigo cifrado com a chave do Keychain, ainda não migrado.
// A proteção real continua sendo a senha do espaço (cofre) e a senha por página (não usam o Keychain).
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes, randomUUID, createHash } = require('node:crypto')
const { isEncrypted, isVaultEncrypted, decrypt, seal, MAGIC } = require('./encryption.cjs')
const vault = require('./vault.cjs')
const pageLocks = require('./vault-pages.cjs')
const migration = require('./vault-migration.cjs')
const { atomicWrite, setStorageCodec } = require('./storage.cjs')

const MODE_FILE = 'security-mode.json'
const KEY_FILE = 'storage-key.keychain'
const ROOT_FILES = ['workspaces.json', 'quick-capture.json']
const BACKUP_SUFFIX = '.pre-keychain-migration'
const ROOT_BACKUP = `root${BACKUP_SUFFIX}`
const RETENTION_MS = 14 * 24 * 3600 * 1000
const SKIP = /(\.pre-keychain-migration(-\d+)?|\.vault-new|\.vault-old|\.vault-journal|\.tmp)$/
const sha = buffer => createHash('sha256').update(buffer).digest('hex')
const coded = (code, pt, en) => { const error = new Error(`${code}: ${pt} / ${en}`); error.code = code; return error }
const exists = file => fs.access(file).then(() => true, () => false)

let runtime = { root: null, mode: 'none' }

/* --------------------------------- files --------------------------------- */

async function writeRaw(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const handle = await fs.open(tmp, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await fs.rename(tmp, file)
}
async function readMode(root) {
  try { const value = JSON.parse(await fs.readFile(path.join(root, MODE_FILE), 'utf8')); return value && typeof value === 'object' ? value : null }
  catch { return null }
}
async function writeMode(root, patch) {
  const current = (await readMode(root)) ?? {}
  await writeRaw(path.join(root, MODE_FILE), JSON.stringify({ ...current, ...patch, version: 1 }))
}
async function startsWithMagic(file) {
  let handle
  try {
    handle = await fs.open(file, 'r')
    const head = Buffer.alloc(MAGIC.length)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return bytesRead === head.length && head.equals(MAGIC)
  } catch { return false } finally { await handle?.close() }
}
async function anyDeviceEncrypted(dir, relative = '') {
  let entries
  try { entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true }) } catch { return false }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || SKIP.test(entry.name)) continue
    const rel = path.join(relative, entry.name)
    if (entry.isDirectory()) { if (await anyDeviceEncrypted(dir, rel)) return true }
    else if (entry.isFile() && await startsWithMagic(path.join(dir, rel))) return true
  }
  return false
}
/** True when any workspace file still uses the old Keychain device layer. */
async function hasDeviceEncrypted(root) {
  for (const name of ROOT_FILES) if (await startsWithMagic(path.join(root, name))) return true
  return (await anyDeviceEncrypted(path.join(root, 'data'))) || (await anyDeviceEncrypted(path.join(root, 'workspaces')))
}
async function dataDirs(root) {
  const dirs = [path.join(root, 'data')]
  try { for (const name of await fs.readdir(path.join(root, 'workspaces'))) if (!SKIP.test(name)) dirs.push(path.join(root, 'workspaces', name, 'data')) } catch { /* sem espaços extras */ }
  return dirs
}
/** Folders and top-level files only (cheap): keeps other local users out. Failures are ignored. */
async function hardenPermissions(root) {
  const chmod = (file, mode) => fs.chmod(file, mode).catch(() => {})
  await chmod(root, 0o700); await chmod(path.join(root, 'workspaces'), 0o700)
  for (const dir of await dataDirs(root)) {
    await chmod(path.dirname(dir), 0o700); await chmod(dir, 0o700)
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) if (!entry.isSymbolicLink()) await chmod(path.join(dir, entry.name), entry.isDirectory() ? 0o700 : 0o600)
  }
  for (const name of [...ROOT_FILES, MODE_FILE, KEY_FILE]) await chmod(path.join(root, name), 0o600)
}

/* ------------------------------ device key ------------------------------ */

/** Reads (or, when `create`, creates) the Keychain-protected random key. The ONLY place that touches the Keychain at startup, and only in keychain/legacy modes. */
async function loadDeviceKey(root, safeStorage, { create = false } = {}) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw coded('KEYCHAIN_UNAVAILABLE', `Desbloqueie o Keychain do macOS e abra o ${PRODUCT.name} novamente. Nenhum dado foi alterado.`, `Unlock the macOS Keychain and reopen ${PRODUCT.name}. No data was changed.`)
  const keyFile = path.join(root, KEY_FILE)
  let raw
  try { raw = await fs.readFile(keyFile) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!create) throw coded('DEVICE_KEY_MISSING', 'A chave antiga do chaveiro não foi encontrada. Os arquivos foram preservados.', 'The old keychain key was not found. Files were preserved.')
    const fresh = randomBytes(32)
    await writeRaw(keyFile, safeStorage.encryptString(fresh.toString('base64')))
    return fresh
  }
  let key
  try { key = Buffer.from(safeStorage.decryptString(raw), 'base64') }
  catch { throw coded('KEYCHAIN_DENIED', `Não foi possível desbloquear a chave do ${PRODUCT.name} no Keychain. Os dados foram preservados.`, `Could not unlock the ${PRODUCT.name} key in the Keychain. Your data was preserved.`) }
  if (key.length !== 32) throw coded('DEVICE_KEY_INVALID', 'Chave local inválida. Os arquivos foram preservados.', 'Invalid local key. Files were preserved.')
  return key
}

/* ------------------------------ conversion ------------------------------ */

async function dirNeedsChange(dir, toKey) {
  let found = false
  for (const rel of await migration.walk(dir)) {
    const raw = await fs.readFile(path.join(dir, ...rel.split('/')))
    if (toKey ? !isEncrypted(raw) && !isVaultEncrypted(raw) : isEncrypted(raw)) { found = true; break }
  }
  return found
}
async function convertRootFile(root, name, { fromKey, toKey, keepBackup, failAt }) {
  const file = path.join(root, name)
  let raw
  try { raw = await fs.readFile(file) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  if (toKey ? isEncrypted(raw) : !isEncrypted(raw)) return false
  const plain = decrypt(raw, fromKey)
  const next = toKey ? seal(plain, toKey, MAGIC) : plain
  if (keepBackup) {
    const backup = path.join(root, ROOT_BACKUP, name)
    if (!(await exists(backup))) await writeRaw(backup, raw)
  }
  if (failAt === 'root') { const error = new Error('SIMULATED_CRASH:root'); error.code = 'SIMULATED_CRASH'; throw error }
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeRaw(tmp, next)
  try {
    const back = await fs.readFile(tmp)
    if (sha(decrypt(back, toKey)) !== sha(plain)) throw new Error(`Verificação falhou: ${name}`)
    await fs.rename(tmp, file)
  } catch (error) { await fs.rm(tmp, { force: true }).catch(() => {}); throw error }
  return true
}
/**
 * Atomically converts every workspace between the device layer (key) and plain files.
 * Each data folder uses vault-migration.transform: copy to <dir>.vault-new, read back and compare
 * SHA-256 of the decrypted content, swap, and keep the old folder as <dir>.pre-keychain-migration.
 * Idempotent: folders already converted are skipped, so an interrupted run can simply be repeated.
 */
async function convertAll(root, { fromKey = null, toKey = null, keepBackups = false, failAt } = {}) {
  const summary = { dirs: 0, files: 0, root: 0 }
  for (const dir of await dataDirs(root)) {
    await migration.recover(dir)
    if (!(await exists(dir)) || !(await dirNeedsChange(dir, toKey))) continue
    const result = await migration.transform(dir, {
      mode: toKey ? 'device-cipher-on' : 'device-cipher-off', keepOldAs: keepBackups ? await freeBackupName(dir) : undefined, failAt,
      decode: (_rel, raw) => isVaultEncrypted(raw) ? raw : decrypt(raw, fromKey),
      encode: (_rel, plain) => toKey && !isVaultEncrypted(plain) ? seal(plain, toKey, MAGIC) : plain,
      verifyDecode: (_rel, bytes) => { if (isVaultEncrypted(bytes)) return bytes; if (!toKey && isEncrypted(bytes)) throw new Error('Arquivo ainda cifrado'); return decrypt(bytes, toKey) },
    })
    summary.dirs++; summary.files += result.files
  }
  for (const name of ROOT_FILES) if (await convertRootFile(root, name, { fromKey, toKey, keepBackup: keepBackups, failAt })) summary.root++
  return summary
}

/* -------------------------------- backups -------------------------------- */

const BACKUP_NAME = /\.pre-keychain-migration(-\d+)?$/
/** First unused `<dir>.pre-keychain-migration[-n]`: an earlier backup (original cipher text) is never overwritten. */
async function freeBackupName(dir) {
  let name = dir + BACKUP_SUFFIX, n = 1
  while (await exists(name)) name = `${dir}${BACKUP_SUFFIX}-${++n}`
  return name
}
async function backupPaths(root) {
  const found = []
  for (const dir of await dataDirs(root)) {
    const parent = path.dirname(dir), base = path.basename(dir)
    try { for (const name of await fs.readdir(parent)) if (name.startsWith(base) && BACKUP_NAME.test(name) && name.slice(0, name.search(BACKUP_NAME)) === base) found.push(path.join(parent, name)) } catch { /* sem pasta */ }
  }
  if (await exists(path.join(root, ROOT_BACKUP))) found.push(path.join(root, ROOT_BACKUP))
  return found
}
async function backupInfo(root) {
  const paths = await backupPaths(root)
  const mode = await readMode(root)
  return paths.length ? { exists: true, count: paths.length, expiresAt: mode?.migratedAt ? mode.migratedAt + RETENTION_MS : null } : { exists: false, count: 0, expiresAt: null }
}
/** Deletes the pre-migration backups (user asked, or 14 days passed). */
async function removeMigrationBackups(root) {
  for (const file of await backupPaths(root)) await fs.rm(file, { recursive: true, force: true })
  // Without backups and without Keychain files the old key file has no use any more.
  if (runtime.mode === 'none' && !(await hasDeviceEncrypted(root))) await fs.rm(path.join(root, KEY_FILE), { force: true })
  await writeMode(root, { backupsRemovedAt: Date.now() })
}
async function purgeExpiredBackups(root, now = Date.now()) {
  const mode = await readMode(root)
  if (!mode?.migratedAt || now - mode.migratedAt < RETENTION_MS) return false
  if (!(await backupPaths(root)).length) return false
  await removeMigrationBackups(root)
  return true
}

/* --------------------------------- startup -------------------------------- */

async function resolveMode(root, options) {
  if (options.deviceCipher === 'keychain' || options.deviceCipher === 'none') return options.deviceCipher
  const stored = (await readMode(root))?.deviceCipher
  if (stored === 'keychain' || stored === 'none') return stored
  // No mode file: an upgrade from the old always-on Keychain layer (key file or device-encrypted files) or a brand-new space.
  if ((await exists(path.join(root, KEY_FILE))) || await hasDeviceEncrypted(root)) return 'legacy'
  await writeMode(root, { deviceCipher: 'none' })
  return 'none'
}

/**
 * options: { deviceCipher: 'keychain'|'none' (force), confirmMigration(): 'continue'|'later' (legacy only), failAt }
 * Default mode never calls safeStorage. Legacy spaces ask `confirmMigration` BEFORE the Keychain is touched.
 */
async function initializeSecureStorage(root, safeStorage, options = {}) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  // Finish or roll back an interrupted migration (password vault or Keychain removal) before touching files.
  const recovered = await migration.recoverAll(root)
  let mode = await resolveMode(root, options), deviceKey = null, migrated = null, legacyPending = false
  if (mode === 'legacy') {
    if (!(await hasDeviceEncrypted(root))) { await writeMode(root, { deviceCipher: 'none' }); mode = 'none' }
    else {
      const choice = options.confirmMigration ? await options.confirmMigration() : 'later'
      deviceKey = await loadDeviceKey(root, safeStorage)
      if (choice === 'continue') {
        migrated = await convertAll(root, { fromKey: deviceKey, toKey: null, keepBackups: true, failAt: options.failAt })
        await writeMode(root, { deviceCipher: 'none', migratedAt: Date.now(), migratedFrom: 'keychain' })
        deviceKey.fill(0); deviceKey = null; mode = 'none'
      } else legacyPending = true
    }
  } else if (mode === 'keychain') deviceKey = await loadDeviceKey(root, safeStorage, { create: !(await hasDeviceEncrypted(root)) })
  if ((options.deviceCipher === 'keychain' || options.deviceCipher === 'none') && mode === options.deviceCipher) await writeMode(root, { deviceCipher: mode })
  runtime = { root, mode }
  const appliesTo = file => {
    const relative = path.relative(root, file)
    // quick-capture.json (raiz) guarda só atalhos/menu/início; rascunhos e caixa de entrada
    // da captura rápida ficam na pasta de cada espaço (electron/quick-drafts.cjs).
    return relative === 'workspaces.json' || relative === 'quick-capture.json' || relative.startsWith(`data${path.sep}`) || relative.startsWith(`workspaces${path.sep}`)
  }
  // Layered codec: page layer (protected pages) + vault layer (workspace password) or device layer (only with a key).
  const codec = vault.createLayeredCodec({ root, deviceKey, appliesTo, pages: pageLocks })
  pageLocks.configure({ decodeFile: codec.decode })
  setStorageCodec(codec)
  // Only the opt-in mode seals leftovers; a postponed legacy migration must not rewrite files.
  if (deviceKey && mode === 'keychain') await sealPlainFiles(root, deviceKey)
  await hardenPermissions(root)
  return status(recovered, migrated, legacyPending)
}

/** keychain/legacy: plain files left behind (e.g. written while the layer was off) are sealed. */
async function sealPlainFiles(root, key) {
  async function migrate(directory) {
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || SKIP.test(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await migrate(file)
      else if (entry.name.endsWith('.json')) {
        const content = await fs.readFile(file)
        // Vault files need the workspace password; protected pages keep their inner layer.
        if (isVaultEncrypted(content)) continue
        if (isEncrypted(content)) decrypt(content, key)
        else {
          JSON.parse(content.toString('utf8'))
          // A clear-text file of a locked vault/page is sealed on its next unlock instead.
          try { await atomicWrite(file, content) } catch (error) { if (!['VAULT_LOCKED', 'PAGE_LOCKED'].includes(error.code)) throw error }
        }
      }
    }
  }
  await migrate(path.join(root, 'data'))
  await migrate(path.join(root, 'workspaces'))
  for (const name of ROOT_FILES) {
    try {
      const catalog = path.join(root, name), content = await fs.readFile(catalog)
      if (!isEncrypted(content)) { JSON.parse(content.toString('utf8')); await atomicWrite(catalog, content) }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError && name !== 'workspaces.json')) throw error }
  }
}

function status(recovered = {}, migrated = null, legacyPending = false) {
  const mode = runtime.mode
  return {
    enabled: true, deviceCipher: mode, keyProtection: mode === 'none' ? 'none' : 'Keychain', ...(mode === 'none' ? {} : { algorithm: 'AES-256-GCM' }),
    ...(legacyPending ? { legacyPending: true } : {}), ...(migrated ? { migrated } : {}),
    ...(Object.keys(recovered).length ? { recoveredMigrations: recovered } : {}),
  }
}

/* ------------------------------ runtime toggle ------------------------------ */

/**
 * Settings → Security: turns the Keychain layer on (opt-in) or off (also finishes a legacy migration
 * that the user postponed). The caller flushes pending writes first. Old folders are kept 14 days when turning off.
 */
async function setDeviceCipher(root, safeStorage, enabled, options = {}) {
  const dirs = await dataDirs(root)
  const lock = value => { for (const dir of dirs) vault.setMigrating(dir, value) }
  if (enabled) {
    if (runtime.mode === 'keychain' || runtime.mode === 'legacy') return status()
    const key = await loadDeviceKey(root, safeStorage, { create: !(await hasDeviceEncrypted(root)) })
    lock(true)
    try {
      vault.setDeviceKey(key)
      await convertAll(root, { toKey: key, failAt: options.failAt })
      await writeMode(root, { deviceCipher: 'keychain' })
      runtime.mode = 'keychain'
    } catch (error) { if (runtime.mode === 'none') vault.setDeviceKey(null); throw error } finally { lock(false) }
    return status()
  }
  if (runtime.mode === 'none') return status()
  const key = vault.deviceKey ?? await loadDeviceKey(root, safeStorage)
  lock(true)
  try {
    await convertAll(root, { fromKey: key, keepBackups: true, failAt: options.failAt })
    await writeMode(root, { deviceCipher: 'none', migratedAt: Date.now(), migratedFrom: 'keychain' })
    runtime.mode = 'none'; vault.setDeviceKey(null)
  } finally { lock(false) }
  return status()
}
async function deviceCipherStatus(root = runtime.root) {
  return { mode: runtime.mode, backups: await backupInfo(root) }
}

module.exports = { initializeSecureStorage, setDeviceCipher, deviceCipherStatus, removeMigrationBackups, purgeExpiredBackups, hasDeviceEncrypted, convertAll, loadDeviceKey, backupInfo, readMode, status: () => status(), mode: () => runtime.mode, MODE_FILE, KEY_FILE, BACKUP_SUFFIX, ROOT_BACKUP, RETENTION_MS }
