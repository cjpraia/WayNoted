const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
// Device layer (legacy / opt-in: key protected by the macOS Keychain). Format kept stable since v1.
// By default there is NO device layer any more (docs/SECURITY.md): files are plain 0600 JSON.
const MAGIC = Buffer.from('NPENC01\n')
// Workspace vault layer (data key wrapped by the workspace password).
const VAULT_MAGIC = Buffer.from('NPVLT01\n')
// Password-protected page layer (page key wrapped by the page password).
const PAGE_MAGIC = Buffer.from('NPPGL01\n')
const HEADER = 8 + 12 + 16

function hasMagic(content, magic) { return Buffer.isBuffer(content) && content.length >= magic.length && content.subarray(0, magic.length).equals(magic) }
function seal(content, key, magic = MAGIC, aad) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid storage key')
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')), cipher.final()])
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted])
}
function open(content, key, magic = MAGIC, aad) {
  if (content.length < HEADER) throw new Error('Encrypted file is incomplete')
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Invalid storage key')
  const decipher = createDecipheriv('aes-256-gcm', key, content.subarray(8, 20))
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(content.subarray(20, 36))
  return Buffer.concat([decipher.update(content.subarray(36)), decipher.final()])
}
function encrypt(content, key) { return seal(content, key, MAGIC) }
function isEncrypted(content) { return hasMagic(content, MAGIC) }
function isVaultEncrypted(content) { return hasMagic(content, VAULT_MAGIC) }
function isPageEncrypted(content) { return hasMagic(content, PAGE_MAGIC) }
function deviceKeyRequired() {
  const error = new Error('DEVICE_KEY_REQUIRED: este arquivo usa a cifra antiga do chaveiro do Mac. Ele foi preservado. / This file uses the old Mac keychain cipher. It was preserved.')
  error.code = 'DEVICE_KEY_REQUIRED'
  return error
}
function decrypt(content, key) {
  if (!isEncrypted(content)) return content
  if (!key) throw deviceKeyRequired()
  return open(content, key, MAGIC)
}
function createCodec(key, appliesTo) { return { encode: (file, data) => appliesTo(file) ? encrypt(data, key) : data, decode: (_file, data) => decrypt(data, key) } }
module.exports = { encrypt, decrypt, isEncrypted, isVaultEncrypted, isPageEncrypted, createCodec, deviceKeyRequired, seal, open, MAGIC, VAULT_MAGIC, PAGE_MAGIC }
