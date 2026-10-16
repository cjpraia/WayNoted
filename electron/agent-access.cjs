const PRODUCT = require('../shared/product.json')
// Permissões de agentes (A1, docs/SECURITY.md): clientes nomeados da API local/MCP/CLI, cada um com
// escopos `read` e `write`; leitura livre por padrão e escrita só com aprovação do usuário
// (fila + diálogo "Aprovar alteração de agente", com prazo), concessão temporária de 1 h por cliente,
// escrita automática (opt-in consciente) e registro de chamadas. Estado em `<data>/agent-access.json`
// e `<data>/agent-log.json` (passam pelo mesmo codec de cifra do restante dos dados).
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto')
const path = require('node:path')
const { atomicWrite, readJson } = require('./storage.cjs')

const SCOPES = Object.freeze(['read', 'write'])
const DEFAULT_TIMEOUT_SEC = 60
const MIN_TIMEOUT_SEC = 10
const MAX_TIMEOUT_SEC = 300
const GRANT_MS = 60 * 60 * 1000
const LOG_LIMIT = 500
const MAX_CLIENTS = 30
const LEGACY_ID = 'legacy'
// B1 — pareamento do web clipper: código curto mostrado no app, válido por 5 min e para um único pareamento.
const PAIR_TTL_MS = 5 * 60 * 1000
const PAIR_MAX_ATTEMPTS = 5
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem 0/O/1/I/L
const CLIPPER_SCOPES = Object.freeze(['clip'])
const normalizeCode = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

class AgentAccessError extends Error {
  constructor(code, message, status = 403) { super(message); this.code = code; this.status = status }
}
const sha = value => createHash('sha256').update(String(value)).digest()
const equalHash = (a, b) => a.length === b.length && timingSafeEqual(a, b)
const cleanScopes = value => {
  const list = [...new Set((Array.isArray(value) ? value : []).filter(scope => SCOPES.includes(scope)))]
  if (!list.includes('read')) list.unshift('read')
  return list
}
const cleanName = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
const clampTimeout = value => Math.max(MIN_TIMEOUT_SEC, Math.min(MAX_TIMEOUT_SEC, Math.round(Number(value)) || DEFAULT_TIMEOUT_SEC))

function createAgentAccess({ directory, now = () => Date.now(), notify = () => {}, persist = true, defaults = {}, testTimeoutMs } = {}) {
  const accessFile = directory ? path.join(directory, 'agent-access.json') : null
  const logFile = directory ? path.join(directory, 'agent-log.json') : null
  let state = { version: 1, timeoutSec: defaults.timeoutSec ?? DEFAULT_TIMEOUT_SEC, clients: [], legacyNoticeShown: false }
  let log = []
  let loaded = null
  let saveTimer = null, logTimer = null
  const pending = new Map() // id -> { view, resolve, reject, timer, clientId }
  const grants = new Map() // clientId -> expira em (só memória)
  const lastUsed = new Map()

  const save = async () => { if (persist && accessFile) await atomicWrite(accessFile, JSON.stringify(state)) }
  const saveSoon = () => { if (!persist || !accessFile) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => void save().catch(() => {}), 300); saveTimer.unref?.() }
  const saveLogSoon = () => { if (!persist || !logFile) return; clearTimeout(logTimer); logTimer = setTimeout(() => void atomicWrite(logFile, JSON.stringify(log)).catch(() => {}), 800); logTimer.unref?.() }

  async function load() {
    if (loaded) return loaded
    loaded = (async () => {
      if (persist && accessFile) {
        const stored = await readJson(accessFile).catch(() => null)
        if (stored && Array.isArray(stored.clients)) {
          state = {
            version: 1, timeoutSec: clampTimeout(stored.timeoutSec ?? DEFAULT_TIMEOUT_SEC), legacyNoticeShown: !!stored.legacyNoticeShown,
            clients: stored.clients.filter(client => client && typeof client.id === 'string' && typeof client.tokenHash === 'string').slice(0, MAX_CLIENTS).map(client => ({
              id: client.id, name: cleanName(client.name) || 'Cliente', tokenHash: client.tokenHash, scopes: cleanScopes(client.scopes), autoWrite: client.autoWrite === true,
              createdAt: Number(client.createdAt) || now(), ...(client.legacy ? { legacy: true } : {}), ...(client.revoked ? { revoked: true } : {}),
              ...(client.kind === 'clipper' && /^[a-p]{32}$/.test(client.extensionId ?? '') ? { kind: 'clipper', extensionId: client.extensionId, scopes: [...CLIPPER_SCOPES], autoWrite: false } : {}),
            })),
          }
        }
        const stored2 = await readJson(logFile).catch(() => null)
        if (Array.isArray(stored2)) log = stored2.slice(-LOG_LIMIT)
      }
      return true
    })()
    return loaded
  }

  const publicClient = client => ({
    id: client.id, name: client.name, scopes: [...client.scopes], autoWrite: client.autoWrite, createdAt: client.createdAt,
    lastUsedAt: lastUsed.get(client.id) ?? null, legacy: !!client.legacy, ...(client.kind ? { kind: client.kind } : {}), grantedUntil: (grants.get(client.id) ?? 0) > now() ? grants.get(client.id) : null,
  })

  /** Token histórico (api-token.json): vira o cliente "padrão" com leitura + escrita com aprovação. */
  async function adoptLegacyToken(token) {
    await load()
    if (!token) return null
    const hash = sha(token).toString('hex')
    let client = state.clients.find(item => item.id === LEGACY_ID)
    if (!client) {
      client = { id: LEGACY_ID, name: 'Token padrão', tokenHash: hash, scopes: ['read', 'write'], autoWrite: false, createdAt: now(), legacy: true }
      state.clients.unshift(client)
      await save()
    } else if (client.tokenHash !== hash && !client.revoked) { client.tokenHash = hash; await save() }
    return publicClient(client)
  }

  function authenticate(bearer) {
    const match = /^Bearer (.+)$/.exec(String(bearer ?? ''))
    if (!match) return null
    const digest = sha(match[1])
    let found = null
    for (const client of state.clients) if (!client.revoked && equalHash(digest, Buffer.from(client.tokenHash, 'hex')) && !found) found = client
    if (found) lastUsed.set(found.id, now())
    return found ? { id: found.id, name: found.name, scopes: [...found.scopes], autoWrite: found.autoWrite, legacy: !!found.legacy, ...(found.kind ? { kind: found.kind, extensionId: found.extensionId } : {}) } : null
  }

  async function createClient({ name, scopes, autoWrite = false } = {}) {
    await load()
    const clean = cleanName(name)
    if (!clean) throw new AgentAccessError('BAD_REQUEST', 'Informe um nome para o cliente.', 400)
    if (state.clients.filter(client => !client.revoked).length >= MAX_CLIENTS) throw new AgentAccessError('LIMIT', 'Limite de clientes atingido.', 400)
    const token = 'nps_' + randomBytes(24).toString('hex')
    const client = { id: randomUUID(), name: clean, tokenHash: sha(token).toString('hex'), scopes: cleanScopes(scopes), autoWrite: !!autoWrite && cleanScopes(scopes).includes('write'), createdAt: now() }
    state.clients.push(client)
    await save()
    return { client: publicClient(client), token }
  }

  async function updateClient(id, patch = {}) {
    await load()
    const client = state.clients.find(item => item.id === id && !item.revoked)
    if (!client) throw new AgentAccessError('NOT_FOUND', 'Cliente não encontrado.', 404)
    if (patch.name !== undefined) client.name = cleanName(patch.name) || client.name
    if (client.kind === 'clipper') { if (patch.name !== undefined) await save(); return publicClient(client) } // escopo fixo: só criar recortes
    if (patch.scopes !== undefined) client.scopes = cleanScopes(patch.scopes)
    if (patch.autoWrite !== undefined) client.autoWrite = patch.autoWrite === true
    if (!client.scopes.includes('write')) { client.autoWrite = false; grants.delete(client.id); rejectFor(client.id, 'SCOPE_REQUIRED', 'A escrita foi desativada para este cliente.') }
    await save()
    return publicClient(client)
  }

  async function revokeClient(id) {
    await load()
    const client = state.clients.find(item => item.id === id)
    if (!client) throw new AgentAccessError('NOT_FOUND', 'Cliente não encontrado.', 404)
    if (client.legacy) { client.revoked = true; client.tokenHash = sha(randomBytes(16)).toString('hex') }
    else state.clients = state.clients.filter(item => item.id !== id)
    grants.delete(id); lastUsed.delete(id)
    rejectFor(id, 'REVOKED', 'O acesso deste cliente foi revogado.')
    await save()
    return true
  }

  const listClients = async () => { await load(); return state.clients.filter(client => !client.revoked).map(publicClient) }
  const settings = async () => { await load(); return { timeoutSec: state.timeoutSec, minTimeoutSec: MIN_TIMEOUT_SEC, maxTimeoutSec: MAX_TIMEOUT_SEC, legacyNotice: !state.legacyNoticeShown && state.clients.some(client => client.legacy && !client.revoked) } }
  async function updateSettings(patch = {}) {
    await load()
    if (patch.timeoutSec !== undefined) state.timeoutSec = clampTimeout(patch.timeoutSec)
    if (patch.legacyNoticeShown === true) state.legacyNoticeShown = true
    await save()
    return settings()
  }

  // ---------- aprovação ----------
  function finish(id, outcome) {
    const entry = pending.get(id)
    if (!entry) return false
    pending.delete(id); clearTimeout(entry.timer)
    notify({ type: 'resolved', id, outcome })
    if (outcome.ok) entry.resolve(outcome.mode); else entry.reject(outcome.error)
    return true
  }
  function rejectFor(clientId, code, message) {
    for (const [id, entry] of [...pending]) if (entry.clientId === clientId) finish(id, { ok: false, error: new AgentAccessError(code, message) })
  }

  /** Resolve com 'auto' | 'grant' | 'approved'; rejeita com AgentAccessError (APPROVAL_REJECTED | APPROVAL_TIMEOUT | SCOPE_REQUIRED). */
  async function requestApproval(client, change) {
    await load()
    const current = state.clients.find(item => item.id === client.id && !item.revoked)
    // O clipper só cria recortes (clip.create): aprovado uma vez, ao parear; nenhuma outra escrita passa por aqui.
    if (current?.kind === 'clipper') {
      if (change?.kind === 'clip.create') return 'auto'
      throw new AgentAccessError('SCOPE_REQUIRED', 'O clipper só pode criar recortes da web.')
    }
    if (!current || !current.scopes.includes('write')) throw new AgentAccessError('SCOPE_REQUIRED', `Este cliente não tem permissão de escrita no ${PRODUCT.name}. Ative "escrever" para ele em Configurações → Dados → Agentes.`)
    if (current.autoWrite) return 'auto'
    if ((grants.get(current.id) ?? 0) > now()) return 'grant'
    const id = randomUUID(), timeoutMs = testTimeoutMs ?? state.timeoutSec * 1000
    const view = { id, clientId: current.id, clientName: current.name, createdAt: now(), expiresAt: now() + timeoutMs, timeoutSec: state.timeoutSec, change }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(id, { ok: false, error: new AgentAccessError('APPROVAL_TIMEOUT', `Alteração não aprovada: o usuário não respondeu em ${state.timeoutSec} s. Nada foi gravado.`, 408) }), timeoutMs)
      timer.unref?.()
      pending.set(id, { view, resolve, reject, timer, clientId: current.id })
      notify({ type: 'pending', approval: view })
    })
  }

  /** `decision`: 'approve' | 'reject'; `grantHour`: aprova também as próximas escritas deste cliente por 1 h. */
  function decide(id, decision, { grantHour = false } = {}) {
    const entry = pending.get(id)
    if (!entry) return false
    if (decision === 'approve') {
      if (grantHour) {
        grants.set(entry.clientId, now() + GRANT_MS)
        for (const [otherId, other] of [...pending]) if (other.clientId === entry.clientId && otherId !== id) finish(otherId, { ok: true, mode: 'grant' })
      }
      return finish(id, { ok: true, mode: grantHour ? 'grant' : 'approved' })
    }
    return finish(id, { ok: false, error: new AgentAccessError('APPROVAL_REJECTED', 'Alteração rejeitada pelo usuário. Nada foi gravado.') })
  }
  const listPending = () => [...pending.values()].map(entry => entry.view)
  const revokeGrant = clientId => grants.delete(clientId)

  // ---------- pareamento do clipper (B1) ----------
  let pairing = null // { code, expiresAt, attempts }
  const pairingView = () => pairing && pairing.expiresAt > now() ? { code: `${pairing.code.slice(0, 4)}-${pairing.code.slice(4)}`, expiresAt: pairing.expiresAt } : null
  function startPairing() {
    let code = ''
    const bytes = randomBytes(8)
    for (const byte of bytes) code += PAIR_ALPHABET[byte % PAIR_ALPHABET.length]
    pairing = { code, expiresAt: now() + PAIR_TTL_MS, attempts: 0 }
    return pairingView()
  }
  const cancelPairing = () => { pairing = null; return true }
  /** Troca o código por um token do clipper preso à extensão (`extensionId` vem do Origin). Uso único. */
  async function completePairing({ code, extensionId }) {
    await load()
    if (!/^[a-p]{32}$/.test(String(extensionId ?? ''))) throw new AgentAccessError('BAD_ORIGIN', 'Origem de extensão inválida.', 403)
    if (!pairing || pairing.expiresAt <= now()) { pairing = null; throw new AgentAccessError('PAIRING_INACTIVE', `Nenhum pareamento ativo. Gere um código no ${PRODUCT.name} (Configurações → Dados → Agentes).`, 403) }
    pairing.attempts++
    const supplied = sha(normalizeCode(code)), expected = sha(pairing.code)
    if (!equalHash(supplied, expected)) {
      if (pairing.attempts >= PAIR_MAX_ATTEMPTS) pairing = null
      throw new AgentAccessError('PAIRING_INVALID', 'Código incorreto.', 403)
    }
    pairing = null
    // Uma extensão = um cliente: parear de novo troca o token anterior.
    state.clients = state.clients.filter(item => !(item.kind === 'clipper' && item.extensionId === extensionId))
    if (state.clients.filter(client => !client.revoked).length >= MAX_CLIENTS) throw new AgentAccessError('LIMIT', 'Limite de clientes atingido.', 400)
    const token = 'npc_' + randomBytes(24).toString('hex')
    const client = { id: randomUUID(), name: 'Clipper', tokenHash: sha(token).toString('hex'), scopes: [...CLIPPER_SCOPES], autoWrite: false, createdAt: now(), kind: 'clipper', extensionId }
    state.clients.push(client)
    await save()
    return { client: publicClient(client), token }
  }

  // ---------- registro ----------
  function record(entry) {
    log.push({ id: randomUUID(), at: now(), clientId: entry.clientId ?? null, client: entry.client ?? '—', method: entry.method ?? '', action: entry.action ?? '', target: String(entry.target ?? '').slice(0, 200), result: entry.result ?? 'ok', status: entry.status ?? 0, detail: entry.detail ? String(entry.detail).slice(0, 200) : undefined })
    if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT)
    saveLogSoon()
  }
  const listLog = async (limit = 200) => { await load(); return log.slice(-Math.max(1, Math.min(LOG_LIMIT, limit))).reverse() }
  const clearLog = async () => { await load(); log = []; clearTimeout(logTimer); if (persist && logFile) await atomicWrite(logFile, '[]'); return true }
  async function flush() {
    clearTimeout(saveTimer); clearTimeout(logTimer)
    if (persist && accessFile && loaded) await Promise.all([save(), atomicWrite(logFile, JSON.stringify(log))]).catch(() => {})
  }
  const close = () => { for (const id of [...pending.keys()]) finish(id, { ok: false, error: new AgentAccessError('APPROVAL_REJECTED', `O ${PRODUCT.name} foi fechado antes da aprovação. Nada foi gravado.`) }) }

  return { load, adoptLegacyToken, authenticate, createClient, updateClient, revokeClient, listClients, settings, updateSettings, requestApproval, decide, listPending, revokeGrant, startPairing, cancelPairing, completePairing, pairingState: pairingView, record, listLog, clearLog, flush, close }
}

/** Substituto usado quando a API local roda sem o módulo de acesso (testes e uso legado): um token, tudo liberado. */
function legacyAccess(token) {
  const hash = sha(token)
  const client = { id: LEGACY_ID, name: 'Token padrão', scopes: ['read', 'write'], autoWrite: true, legacy: true }
  return {
    authenticate: bearer => /^Bearer .+$/.test(String(bearer ?? '')) && equalHash(sha(String(bearer).slice(7)), hash) ? client : null,
    requestApproval: async () => 'auto', record: () => {}, settings: async () => ({ timeoutSec: DEFAULT_TIMEOUT_SEC }),
  }
}

module.exports = { createAgentAccess, legacyAccess, AgentAccessError, SCOPES, DEFAULT_TIMEOUT_SEC, MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC, GRANT_MS, LEGACY_ID }
