const COMPAT = require('../shared/compatibility.cjs')
// High-level workspace vault operations (no Electron dependency; testable with node --test).
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const vault = require('./vault.cjs')
const migration = require('./vault-migration.cjs')
const { seal, decrypt, MAGIC, isVaultEncrypted } = require('./encryption.cjs')

const failures = new Map()
const check = dek => crypto.createHmac('sha256', dek).update(COMPAT.record016).digest('base64')

async function writeDevice(file, value) {
  const deviceKey = vault.deviceKey
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  const handle = await fs.open(tmp, 'wx', 0o600)
  try { await handle.writeFile(deviceKey ? seal(bytes, deviceKey, MAGIC) : bytes); await handle.sync() } finally { await handle.close() }
  await fs.rename(tmp, file)
}
async function readDevice(file) {
  let raw
  try { raw = await fs.readFile(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  return JSON.parse(decrypt(raw, vault.deviceKey).toString('utf8'))
}
const headerFile = dir => path.join(dir, vault.HEADER_FILE)
async function readHeader(dir) {
  const header = await readDevice(headerFile(dir))
  if (!header) return null
  vault.validateHeader(header)
  vault.state(dir).header = header
  return header
}
async function writeHeader(dir, header) { await writeDevice(headerFile(dir), header); vault.state(dir).header = header }

function publicSettings(header) { return { autoLockMinutes: 15, lockOnSleep: true, touchId: false, locale: 'pt-BR', ...(header?.settings ?? {}) } }
async function status(dir) {
  await migration.recover(dir)
  const enabled = vault.isEnabled(dir)
  const header = enabled ? await readHeader(dir) : null
  return { enabled, locked: enabled && !vault.state(dir).key, migrating: vault.isMigrating(dir), settings: publicSettings(header), createdAt: header?.createdAt ?? null, passwordChangedAt: header?.passwordChangedAt ?? null, recoveryCreatedAt: header?.recoveryCreatedAt ?? header?.createdAt ?? null, hint: header?.hint ?? null, algorithm: 'AES-256-GCM', kdf: header ? `scrypt N=${header.password.kdf.N} r=${header.password.kdf.r} p=${header.password.kdf.p}` : null }
}

/** Throttles password guessing: after 5 failures each attempt waits longer (max 5 min). */
function throttle(dir) {
  const entry = failures.get(dir)
  if (!entry || entry.count < 5) return
  const wait = Math.min(300000, 1000 * 2 ** (entry.count - 5)) - (Date.now() - entry.at)
  if (wait > 0) throw vault.vaultError('TOO_MANY_ATTEMPTS', `Muitas tentativas. Aguarde ${Math.ceil(wait / 1000)} s.`, `Too many attempts. Wait ${Math.ceil(wait / 1000)} s.`)
}
function failed(dir) { const entry = failures.get(dir) ?? { count: 0, at: 0 }; failures.set(dir, { count: entry.count + 1, at: Date.now() }) }

async function enable(dir, password, options = {}) {
  if (vault.isEnabled(dir)) throw vault.vaultError('VAULT_ENABLED', 'A senha do espaço já está ativa.', 'The workspace password is already on.')
  await migration.recover(dir)
  const { header, dek, recoveryKey } = await vault.createVault(password, options)
  header.keyCheck = check(dek)
  const deviceKey = vault.deviceKey
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  vault.setMigrating(dir, true)
  try {
    await migration.transform(dir, {
      mode: 'enable', failAt: options.failAt,
      decode: (_rel, raw) => { if (isVaultEncrypted(raw)) throw new Error('Arquivo já cifrado pelo cofre'); return decrypt(raw, deviceKey) },
      encode: (rel, plain) => vault.encodeVaultFile(dek, rel, plain),
      verifyDecode: (rel, bytes) => vault.decodeVaultFile(dek, rel, bytes),
      extra: { [vault.HEADER_FILE]: deviceKey ? seal(headerBytes, deviceKey, MAGIC) : headerBytes },
      drop: new Set([vault.TOUCH_FILE]),
      onSwapped: () => { vault.setKey(dir, dek); vault.setEnabled(dir, true); vault.state(dir).header = header },
    })
  } catch (error) { if (!vault.isEnabled(dir)) dek.fill(0); throw error } finally { vault.setMigrating(dir, false) }
  return { recoveryKey }
}

async function disable(dir, password, options = {}) {
  const header = await readHeader(dir)
  if (!header) throw vault.vaultError('VAULT_DISABLED', 'A senha do espaço não está ativa.', 'The workspace password is not on.')
  throttle(dir)
  let dek
  try { dek = await vault.unwrapWithPassword(header, password) } catch (error) { failed(dir); throw error }
  failures.delete(dir)
  const deviceKey = vault.deviceKey
  vault.setKey(dir, Buffer.from(dek))
  vault.setMigrating(dir, true)
  try {
    await migration.transform(dir, {
      mode: 'disable', failAt: options.failAt,
      decode: (rel, raw) => isVaultEncrypted(raw) ? vault.decodeVaultFile(dek, rel, raw) : decrypt(raw, deviceKey),
      encode: (_rel, plain) => deviceKey ? seal(plain, deviceKey, MAGIC) : plain,
      verifyDecode: (_rel, bytes) => decrypt(bytes, deviceKey),
      drop: new Set([vault.HEADER_FILE, vault.TOUCH_FILE]),
      onSwapped: () => { vault.setEnabled(dir, false); vault.setKey(dir, null); vault.state(dir).header = null },
    })
  } finally { vault.setMigrating(dir, false); dek.fill(0) }
}

async function unlock(dir, password) {
  const header = await readHeader(dir)
  if (!header) return true
  throttle(dir)
  let dek
  try { dek = await vault.unwrapWithPassword(header, password) } catch (error) { if (error.code === 'WRONG_PASSWORD') failed(dir); throw error }
  failures.delete(dir)
  vault.setKey(dir, dek)
  return true
}
async function unlockWithRecovery(dir, recoveryKey, newPassword, options = {}) {
  const header = await readHeader(dir)
  if (!header) return true
  throttle(dir)
  vault.validatePassword(newPassword)
  let dek
  try { dek = vault.unwrapWithRecovery(header, recoveryKey) } catch (error) { failed(dir); throw error }
  failures.delete(dir)
  // The old hint did not help: it is dropped together with the forgotten password.
  await writeHeader(dir, { ...(await vault.rewrapPassword(header, dek, newPassword, { ...options, hint: null })), keyCheck: check(dek) })
  await fs.rm(path.join(dir, vault.TOUCH_FILE), { force: true })
  await writeHeader(dir, { ...vault.state(dir).header, settings: { ...publicSettings(header), touchId: false } })
  vault.setKey(dir, dek)
  return true
}
async function changePassword(dir, oldPassword, newPassword, options = {}) {
  const header = await readHeader(dir)
  throttle(dir)
  let dek
  try { dek = await vault.unwrapWithPassword(header, oldPassword) } catch (error) { failed(dir); throw error }
  failures.delete(dir)
  try { await writeHeader(dir, await vault.rewrapPassword(header, dek, newPassword, options)) } finally { dek.fill(0) }
}
async function regenerateRecovery(dir, password) {
  const header = await readHeader(dir)
  throttle(dir)
  let dek
  try { dek = await vault.unwrapWithPassword(header, password) } catch (error) { failed(dir); throw error }
  failures.delete(dir)
  try { const result = vault.regenerateRecovery(header, dek); await writeHeader(dir, result.header); return { recoveryKey: result.recoveryKey } } finally { dek.fill(0) }
}
async function setOptions(dir, patch = {}) {
  const header = await readHeader(dir)
  if (!header) throw vault.vaultError('VAULT_DISABLED', 'A senha do espaço não está ativa.', 'The workspace password is not on.')
  const settings = publicSettings(header)
  if (Number.isFinite(patch.autoLockMinutes)) settings.autoLockMinutes = Math.max(0, Math.min(1440, Math.round(patch.autoLockMinutes)))
  if (typeof patch.lockOnSleep === 'boolean') settings.lockOnSleep = patch.lockOnSleep
  if (patch.locale === 'pt-BR' || patch.locale === 'en-US') settings.locale = patch.locale
  await writeHeader(dir, { ...header, settings })
  return settings
}

/* Touch ID: the data key is kept encrypted by the macOS Keychain (safeStorage); the app only
   releases it after systemPreferences.promptTouchID succeeds. The password is never stored. */
async function enableTouchId(dir, safeStorage) {
  const header = await readHeader(dir), dek = vault.getKey(dir)
  if (!safeStorage?.isEncryptionAvailable()) throw vault.vaultError('KEYCHAIN_UNAVAILABLE', 'Keychain indisponível.', 'Keychain unavailable.')
  await writeDevice(path.join(dir, vault.TOUCH_FILE), { version: 1, blob: safeStorage.encryptString(dek.toString('base64')).toString('base64') })
  await writeHeader(dir, { ...header, keyCheck: header.keyCheck ?? check(dek), settings: { ...publicSettings(header), touchId: true } })
}
async function disableTouchId(dir) {
  const header = await readHeader(dir)
  await fs.rm(path.join(dir, vault.TOUCH_FILE), { force: true })
  if (header) await writeHeader(dir, { ...header, settings: { ...publicSettings(header), touchId: false } })
}
async function unlockWithKeychain(dir, safeStorage) {
  const header = await readHeader(dir), record = await readDevice(path.join(dir, vault.TOUCH_FILE))
  if (!header?.settings?.touchId || !record?.blob || !header.keyCheck) throw vault.vaultError('TOUCH_ID_OFF', 'Touch ID não está configurado para este espaço.', 'Touch ID is not set up for this workspace.')
  const dek = Buffer.from(safeStorage.decryptString(Buffer.from(record.blob, 'base64')), 'base64')
  if (dek.length !== 32 || check(dek) !== header.keyCheck) { dek.fill(0); throw vault.vaultError('TOUCH_ID_STALE', 'A chave do Touch ID não confere. Use a senha.', 'The Touch ID key does not match. Use the password.') }
  vault.setKey(dir, dek)
}

module.exports = { status, enable, disable, unlock, unlockWithRecovery, changePassword, regenerateRecovery, setOptions, enableTouchId, disableTouchId, unlockWithKeychain, readHeader, failures }
