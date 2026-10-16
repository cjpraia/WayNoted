// Chaves de provedores em nuvem (docs/AI.md §2). Cada chave fica no arquivo cifrado do cofre do espaço, selada pelo Keychain (opt-in explícito) ou só na memória;
// o arquivo `ai-keys.json` do espaço é gravado por atomicWrite (camada do dispositivo ou do cofre).
// Fica fora do meta: não entra em backup, exportação, API local/MCP nem localStorage.
// Somente `get` devolve a chave em claro, e só para o processo principal montar o cabeçalho.
const path = require('node:path')
const { atomicWrite, readJson } = require('../storage.cjs')

const PROVIDERS = new Set(['openrouter', 'google'])
const FILE = 'ai-keys.json'

function validKey(key) { return typeof key === 'string' && key.length >= 8 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key) }

/**
 * Onde a chave fica (nunca o Keychain no startup; só quando o usuário salva/usa uma chave):
 *  - 'file'     dentro de ai-keys.json, que já é cifrado pelo cofre do espaço (senha) ou pela cifra opt-in do Keychain;
 *  - 'keychain' selada por safeStorage — o macOS pode pedir a senha do chaveiro na primeira chamada de IA da sessão;
 *  - 'session'  só na memória ("Não guardar a chave"): some ao fechar o app.
 * `isFileProtected(dir)` diz se o arquivo já é cifrado por algo que o usuário ativou.
 */
function createKeyStore({ safeStorage, isFileProtected = () => false }) {
  const file = dir => path.join(dir, FILE)
  const session = new Map()
  const sessionKey = (dir, provider) => `${path.resolve(dir)}\0${provider}`
  async function read(dir) { const data = await readJson(file(dir)); return data && typeof data === 'object' && !Array.isArray(data) ? data : {} }
  const kind = entry => entry?.plain ? 'file' : entry?.sealed ? 'keychain' : null
  return {
    async status(dir) {
      const data = await read(dir)
      const out = {}
      for (const provider of PROVIDERS) {
        const mem = session.get(sessionKey(dir, provider))
        const storage = mem ? 'session' : kind(data[provider])
        out[provider] = storage ? { configured: true, last4: String(mem ? mem.slice(-4) : data[provider].last4 ?? '').slice(-4), storage } : { configured: false }
      }
      return out
    },
    async set(dir, provider, key, options = {}) {
      if (!PROVIDERS.has(provider)) throw new Error('AI_BAD_REQUEST')
      const trimmed = typeof key === 'string' ? key.trim() : ''
      if (!validKey(trimmed)) throw new Error('AI_KEY_INVALID_FORMAT')
      const data = await read(dir)
      const last4 = trimmed.slice(-4)
      if (options.storage === 'session') {
        session.set(sessionKey(dir, provider), trimmed)
        if (data[provider]) { delete data[provider]; await atomicWrite(file(dir), JSON.stringify(data)) }
        return { configured: true, last4, storage: 'session' }
      }
      session.delete(sessionKey(dir, provider))
      if (isFileProtected(dir)) {
        data[provider] = { plain: trimmed, last4, savedAt: Date.now() }
        await atomicWrite(file(dir), JSON.stringify(data))
        return { configured: true, last4, storage: 'file' }
      }
      if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('AI_KEYCHAIN_UNAVAILABLE')
      data[provider] = { sealed: safeStorage.encryptString(trimmed).toString('base64'), last4, savedAt: Date.now() }
      await atomicWrite(file(dir), JSON.stringify(data))
      return { configured: true, last4, storage: 'keychain' }
    },
    async remove(dir, provider) {
      if (!PROVIDERS.has(provider)) throw new Error('AI_BAD_REQUEST')
      session.delete(sessionKey(dir, provider))
      const data = await read(dir)
      if (data[provider]) { delete data[provider]; await atomicWrite(file(dir), JSON.stringify(data)) }
      return { configured: false }
    },
    /** Uso exclusivo do processo principal (cabeçalho do provedor). Nunca exposto por IPC. Só aqui o Keychain pode ser tocado (preguiçoso). */
    async get(dir, provider) {
      const mem = session.get(sessionKey(dir, provider))
      if (mem) return mem
      const entry = (await read(dir))[provider]
      if (entry?.plain) return entry.plain
      if (!entry?.sealed) return null
      if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('AI_KEYCHAIN_UNAVAILABLE')
      try { return safeStorage.decryptString(Buffer.from(entry.sealed, 'base64')) } catch { throw new Error('AI_KEYCHAIN_UNAVAILABLE') }
    },
  }
}
module.exports = { createKeyStore, validKey, FILE }
