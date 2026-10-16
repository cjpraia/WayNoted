// Único ponto de acesso ao Keychain do macOS (Electron `safeStorage`). Nada no app chama
// `safeStorage` diretamente: tudo passa por este invólucro PREGUIÇOSO, que só toca o Keychain
// quando alguém realmente cifra/decifra algo (opt-in do usuário ou migração da cifra antiga).
// Nunca é chamado na inicialização nem no uso normal (docs/SECURITY.md, seção "Keychain").
//
// Ganchos de teste (ignorados em app empacotado, `testHooks=false`):
//   WORKSPACE_TEST_TRACE_SAFESTORAGE=1       registra cada chamada em WORKSPACE_TEST_TRACE_FILE
//   WORKSPACE_TEST_FAKE_SAFESTORAGE_KEY=hex  substitui o Keychain real por AES-GCM com essa chave
//   WORKSPACE_TEST_DENY_SAFESTORAGE=1        simula o usuário negando o acesso ao Keychain
const fs = require('node:fs')
const crypto = require('node:crypto')

const FAKE_MAGIC = Buffer.from('FAKEKC1\n')

function fakeSafeStorage(hexKey) {
  const key = Buffer.from(hexKey, 'hex')
  if (key.length !== 32) throw new Error("WORKSPACE_TEST_FAKE_SAFESTORAGE_KEY deve ter 32 bytes em hex")
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
      return Buffer.concat([FAKE_MAGIC, iv, cipher.getAuthTag(), body])
    },
    decryptString(bytes) {
      const buffer = Buffer.from(bytes)
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(8, 20))
      decipher.setAuthTag(buffer.subarray(20, 36))
      return Buffer.concat([decipher.update(buffer.subarray(36)), decipher.final()]).toString('utf8')
    },
  }
}

function createKeychain({ real, testHooks = false, env = process.env } = {}) {
  const calls = []
  const trace = env.WORKSPACE_TEST_TRACE_SAFESTORAGE === '1' ? env.WORKSPACE_TEST_TRACE_FILE : null
  const fake = testHooks && env.WORKSPACE_TEST_FAKE_SAFESTORAGE_KEY ? fakeSafeStorage(env.WORKSPACE_TEST_FAKE_SAFESTORAGE_KEY) : null
  const deny = testHooks && env.WORKSPACE_TEST_DENY_SAFESTORAGE === '1'
  const backend = () => fake ?? real
  const note = method => {
    calls.push(method)
    if (trace) try { fs.appendFileSync(trace, `${Date.now()} safeStorage.${method}\n`) } catch { /* rastreio opcional */ }
  }
  return {
    calls,
    get callCount() { return calls.length },
    isEncryptionAvailable() { note('isEncryptionAvailable'); return !!backend()?.isEncryptionAvailable?.() },
    encryptString(text) {
      note('encryptString')
      if (deny) throw new Error('KEYCHAIN_DENIED (test)')
      return backend().encryptString(text)
    },
    decryptString(bytes) {
      note('decryptString')
      if (deny) throw new Error('KEYCHAIN_DENIED (test)')
      return backend().decryptString(bytes)
    },
  }
}

module.exports = { createKeychain, fakeSafeStorage }
