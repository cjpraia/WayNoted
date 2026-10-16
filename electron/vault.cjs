const COMPAT = require('../shared/compatibility.cjs')
// Workspace vault: opt-in password encryption of a whole workspace data folder.
// A random 256-bit data key (DEK) encrypts every file (AES-256-GCM, path bound as AAD).
// The DEK is wrapped by a key derived from the password (scrypt, per-workspace salt) and,
// separately, by a one-time recovery key. Changing the password only rewraps the DEK.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { seal, open, decrypt, isVaultEncrypted, VAULT_MAGIC, MAGIC } = require('./encryption.cjs')

const HEADER_FILE = 'vault.json'
const TOUCH_FILE = 'vault-touchid.json'
// Files that must stay readable before unlocking. They are still device-encrypted on disk
// and never contain the password or an unwrapped key.
const EXEMPT = new Set([HEADER_FILE, TOUCH_FILE])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_KDF = Object.freeze({ name: 'scrypt', N: 2 ** 17, r: 8, p: 1 })
const MIN_PASSWORD = 8
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const dirs = new Map()
let configured = { root: null, deviceKey: null, pages: null }

function vaultError(code, pt, en) { const error = new Error(`${code}: ${pt} / ${en}`); error.code = code; return error }
const lockedError = () => vaultError('VAULT_LOCKED', 'O espaço está bloqueado. Desbloqueie com a senha para continuar.', 'The workspace is locked. Unlock it with the password to continue.')
const busyError = () => vaultError('VAULT_BUSY', 'A criptografia do espaço está sendo alterada. Tente novamente em instantes.', 'Workspace encryption is being changed. Try again shortly.')
const wrongPassword = () => vaultError('WRONG_PASSWORD', 'Senha incorreta.', 'Incorrect password.')

function state(dir) {
  const key = path.resolve(dir)
  if (!dirs.has(key)) dirs.set(key, { enabled: undefined, key: null, migrating: false, header: null })
  return dirs.get(key)
}
function isEnabled(dir) {
  const entry = state(dir)
  if (entry.enabled === undefined) entry.enabled = fs.existsSync(path.join(dir, HEADER_FILE))
  return entry.enabled
}
function isLocked(dir) { return isEnabled(dir) && !state(dir).key }
function isMigrating(dir) { return state(dir).migrating }
function getKey(dir) { const key = state(dir).key; if (!key) throw lockedError(); return key }
function setKey(dir, key) {
  const entry = state(dir)
  if (entry.key && entry.key !== key) entry.key.fill(0)
  entry.key = key
}
function setEnabled(dir, value) { state(dir).enabled = value }
function setMigrating(dir, value) { state(dir).migrating = value }
/** Forget the data key (zeroed) and every page key of this workspace. */
function lock(dir) {
  const entry = state(dir)
  if (entry.key) entry.key.fill(0)
  entry.key = null
  configured.pages?.forget(dir)
}
function unlockedDirs() { return [...dirs.entries()].filter(([, entry]) => entry.key).map(([dir]) => dir) }

/* ---------------------------- key derivation ---------------------------- */

function validatePassword(password) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD) throw vaultError('WEAK_PASSWORD', `Use uma senha com pelo menos ${MIN_PASSWORD} caracteres.`, `Use a password with at least ${MIN_PASSWORD} characters.`)
  if (password.length > 1024) throw vaultError('WEAK_PASSWORD', 'Senha longa demais.', 'Password is too long.')
}
const MAX_HINT = 120
/**
 * Optional password hint. It must be readable before unlocking, so it is stored next to the
 * KDF parameters (never inside the encrypted data) and therefore must not reveal the password.
 * Returns the cleaned hint, or undefined when empty.
 */
function normalizeHint(hint, password) {
  if (hint === undefined || hint === null) return undefined
  if (typeof hint !== 'string') throw vaultError('INVALID_HINT', 'Dica inválida.', 'Invalid hint.')
  const clean = hint.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  if ([...clean].length > MAX_HINT) throw vaultError('HINT_TOO_LONG', `A dica pode ter no máximo ${MAX_HINT} caracteres.`, `The hint can have at most ${MAX_HINT} characters.`)
  if (typeof password === 'string' && password && clean.toLocaleLowerCase().includes(password.toLocaleLowerCase())) throw vaultError('HINT_HAS_PASSWORD', 'A dica não pode conter a senha.', 'The hint cannot contain the password.')
  return clean
}
function deriveKey(password, kdf) {
  const salt = Buffer.from(kdf.salt, 'base64')
  if (kdf.name !== 'scrypt' || salt.length < 16 || kdf.N < 2 ** 14 || kdf.r < 8 || kdf.p < 1) return Promise.reject(new Error('Parâmetros de derivação inválidos'))
  return new Promise((resolve, reject) => crypto.scrypt(Buffer.from(password.normalize('NFKC'), 'utf8'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)))
}
function newKdf(params = DEFAULT_KDF) { return { name: 'scrypt', N: params.N, r: params.r, p: params.p, salt: crypto.randomBytes(16).toString('base64') } }
function wrapKey(kek, key, label) { return seal(key, kek, VAULT_MAGIC, label).toString('base64') }
function unwrapKey(kek, wrapped, label) {
  try { const key = open(Buffer.from(wrapped, 'base64'), kek, VAULT_MAGIC, label); if (key.length !== 32) throw new Error('size'); return key }
  catch { throw wrongPassword() }
}
function recoveryKek(bytes, salt) { return Buffer.from(crypto.hkdfSync('sha256', bytes, Buffer.from(salt, 'base64'), COMPAT.record017, 32)) }

function encodeRecovery(bytes) {
  let bits = 0, value = 0, out = ''
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g).join('-')
}
function decodeRecovery(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[O]/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
  if (clean.length !== 52) throw vaultError('WRONG_RECOVERY', 'Chave de recuperação inválida.', 'Invalid recovery key.')
  let bits = 0, value = 0
  const out = []
  for (const char of clean) {
    const index = CROCKFORD.indexOf(char)
    if (index < 0) throw vaultError('WRONG_RECOVERY', 'Chave de recuperação inválida.', 'Invalid recovery key.')
    value = ((value << 5) | index) & 0xffff; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out.slice(0, 32))
}

function recoveryRecord(dek) {
  const bytes = crypto.randomBytes(32), salt = crypto.randomBytes(16).toString('base64')
  const record = { kdf: { name: 'hkdf-sha256', salt }, wrapped: wrapKey(recoveryKek(bytes, salt), dek, COMPAT.record018) }
  const recoveryKey = encodeRecovery(bytes); bytes.fill(0)
  return { record, recoveryKey }
}

async function createVault(password, options = {}) {
  validatePassword(password)
  const dek = crypto.randomBytes(32), kdf = newKdf(options.kdf)
  const kek = await deriveKey(password, kdf)
  const { record, recoveryKey } = recoveryRecord(dek)
  const hint = normalizeHint(options.hint, password)
  const header = {
    format: COMPAT.record019, version: 1, cipher: 'AES-256-GCM', createdAt: Date.now(),
    password: { kdf, wrapped: wrapKey(kek, dek, COMPAT.record020) }, recovery: record,
    settings: { autoLockMinutes: 15, lockOnSleep: true, touchId: false, locale: options.locale === 'en-US' ? 'en-US' : 'pt-BR', ...(options.settings ?? {}) },
    ...(hint ? { hint } : {}),
  }
  kek.fill(0)
  return { header, dek, recoveryKey }
}
function validateHeader(header) {
  if (header?.format !== COMPAT.record019 || header.version !== 1 || !header.password?.wrapped || !header.recovery?.wrapped) throw new Error('Cabeçalho do cofre inválido; os arquivos foram preservados.')
  return header
}
async function unwrapWithPassword(header, password) {
  validateHeader(header)
  if (typeof password !== 'string' || !password) throw wrongPassword()
  const kek = await deriveKey(password, header.password.kdf)
  try { return unwrapKey(kek, header.password.wrapped, COMPAT.record020) } finally { kek.fill(0) }
}
function unwrapWithRecovery(header, recoveryKey) {
  validateHeader(header)
  const bytes = decodeRecovery(recoveryKey), kek = recoveryKek(bytes, header.recovery.kdf.salt)
  try { return unwrapKey(kek, header.recovery.wrapped, COMPAT.record018) }
  catch { throw vaultError('WRONG_RECOVERY', 'Chave de recuperação incorreta.', 'Incorrect recovery key.') }
  finally { kek.fill(0); bytes.fill(0) }
}
async function rewrapPassword(header, dek, newPassword, options = {}) {
  validatePassword(newPassword)
  // `hint: undefined` keeps the current hint (still checked against the new password); `null`/'' removes it.
  const hint = normalizeHint(options.hint === undefined ? header.hint : options.hint, newPassword)
  const kdf = newKdf(options.kdf ?? header.password.kdf), kek = await deriveKey(newPassword, kdf)
  try {
    const next = { ...header, password: { kdf, wrapped: wrapKey(kek, dek, COMPAT.record020) }, passwordChangedAt: Date.now() }
    if (hint) next.hint = hint; else delete next.hint
    return next
  } finally { kek.fill(0) }
}
function regenerateRecovery(header, dek) {
  const { record, recoveryKey } = recoveryRecord(dek)
  return { header: { ...header, recovery: record, recoveryCreatedAt: Date.now() }, recoveryKey }
}

/* ------------------------------ file codec ------------------------------ */

/** Maps an absolute file to its workspace data folder and folder-relative path. */
function locate(root, file) {
  if (!root) return null
  const parts = path.relative(root, file).split(path.sep)
  if (parts[0] === 'data' && parts.length > 1) return { dir: path.join(root, 'data'), rel: parts.slice(1).join('/') }
  if (parts[0] === 'workspaces' && UUID.test(parts[1] ?? '') && parts[2] === 'data' && parts.length > 3) return { dir: path.join(root, 'workspaces', parts[1], 'data'), rel: parts.slice(3).join('/') }
  return null
}
const aad = rel => `${COMPAT.record010}${rel}`
function encodeVaultFile(key, rel, payload) { return seal(payload, key, VAULT_MAGIC, aad(rel)) }
function decodeVaultFile(key, rel, payload) { return open(payload, key, VAULT_MAGIC, aad(rel)) }
/** Removes only the outer layer (vault or device), keeping a page layer intact. */
function decodeOuter(dir, rel, content, deviceKey = configured.deviceKey) {
  if (isVaultEncrypted(content)) return decodeVaultFile(getKey(dir), rel, content)
  return decrypt(content, deviceKey)
}
/** The device layer is optional (Keychain opt-in / legacy): without a key, files stay plain. */
function setDeviceKey(key) { configured = { ...configured, deviceKey: key ?? null } }

function configure({ root, deviceKey, pages }) { configured = { root, deviceKey, pages } }

/**
 * Layered codec used by storage.cjs: page layer (inner, optional) + vault layer when the
 * workspace has a password, otherwise the device layer. Fails closed: a locked vault or
 * locked page never falls back to a weaker layer or to plaintext.
 */
function createLayeredCodec({ root, deviceKey, appliesTo, pages }) {
  configure({ root, deviceKey: deviceKey ?? null, pages })
  // The device key is read on every call so the Keychain layer can be switched on/off at runtime.
  const device = () => configured.deviceKey
  const sealDevice = payload => device() ? seal(payload, device(), MAGIC) : payload
  return {
    encode(file, data) {
      if (!appliesTo(file)) return data
      let payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
      const location = locate(root, file)
      if (!location) return sealDevice(payload)
      if (state(location.dir).migrating) throw busyError()
      if (pages) payload = pages.encodeLayer(location.dir, location.rel, payload)
      if (isEnabled(location.dir) && !EXEMPT.has(location.rel)) return encodeVaultFile(getKey(location.dir), location.rel, payload)
      return sealDevice(payload)
    },
    decode(file, data) {
      const location = locate(root, file)
      if (!location) {
        if (isVaultEncrypted(data)) throw lockedError()
        return decrypt(data, device())
      }
      const payload = decodeOuter(location.dir, location.rel, data, device())
      return pages ? pages.decodeLayer(location.dir, location.rel, payload) : payload
    },
  }
}

module.exports = {
  HEADER_FILE, TOUCH_FILE, EXEMPT, DEFAULT_KDF, MIN_PASSWORD,
  isEnabled, isLocked, isMigrating, getKey, setKey, setEnabled, setMigrating, lock, unlockedDirs, state,
  validatePassword, normalizeHint, MAX_HINT, deriveKey, newKdf, wrapKey, unwrapKey, createVault, unwrapWithPassword, unwrapWithRecovery, rewrapPassword, regenerateRecovery, validateHeader,
  encodeRecovery, decodeRecovery, locate, encodeVaultFile, decodeVaultFile, decodeOuter, createLayeredCodec, configure, setDeviceKey, vaultError, lockedError, wrongPassword,
  get deviceKey() { return configured.deviceKey },
}
