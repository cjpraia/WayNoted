// Rascunhos e caixa de entrada da captura rápida, por espaço de trabalho.
// Ficam dentro da pasta de dados do espaço (`<data>/quick-draft.json`, `<data>/quick-capture.json`),
// então passam pela mesma camada de cifra dos demais arquivos: a do cofre quando a senha do
// espaço está ativa (e são recifrados na ativação/desativação junto com a pasta) ou a do
// dispositivo. Com o espaço bloqueado nada é lido nem gravado em disco: o rascunho fica só na
// memória do processo principal e é gravado (cifrado) no próximo acesso após o desbloqueio.
// Versões antigas gravavam `quick-draft.json` em texto claro na raiz dos dados: ele é migrado
// para o espaço ativo e apagado (`purgeLegacy`), inclusive antes de ativar a senha.
const fs = require('node:fs/promises')
const path = require('node:path')
const { atomicWrite, readJson, removeFile } = require('./storage.cjs')

const LOCK_CODES = new Set(['VAULT_LOCKED', 'VAULT_BUSY', 'PAGE_LOCKED'])
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const isEmptyDraft = value => !isObject(value) || !Object.values(value).some(item => Array.isArray(item) ? item.length : typeof item === 'string' ? item.trim() : item)

/** deps: { userData(), dataDir(wsId), isLocked(wsId) } */
function createQuickDrafts(deps) {
  const memory = new Map()      // wsId → último rascunho conhecido
  const pending = new Set()     // wsIds com rascunho ainda não gravado (espaço bloqueado/ocupado)
  const legacyFile = () => path.join(deps.userData(), 'quick-draft.json')
  const draftFile = ws => path.join(deps.dataDir(ws), 'quick-draft.json')
  const inboxFile = ws => path.join(deps.dataDir(ws), 'quick-capture.json')

  /** Move o rascunho antigo em texto claro da raiz para o espaço `ws` (se gravável) e o apaga. */
  async function purgeLegacy(ws) {
    let raw
    try { raw = await fs.readFile(legacyFile()) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
    let value = null
    try { value = JSON.parse(raw.toString('utf8')) } catch { value = null }
    if (isObject(value) && !isEmptyDraft(value) && !memory.has(ws)) {
      memory.set(ws, value)
      pending.add(ws)
    }
    // Só apaga o texto claro depois de gravar a versão cifrada; com o espaço bloqueado o arquivo
    // antigo continua até o desbloqueio (o texto nunca se perde).
    if (!await flush(ws).catch(() => false)) return false
    await removeFile(legacyFile())
    return true
  }

  async function flush(ws) {
    if (!pending.has(ws)) return true
    if (deps.isLocked(ws)) return false
    const value = memory.get(ws) ?? {}
    try { await atomicWrite(draftFile(ws), JSON.stringify(value)) }
    catch (error) { if (LOCK_CODES.has(error?.code)) return false; throw error }
    if (memory.get(ws) === value) pending.delete(ws)
    return true
  }
  async function flushAll() { for (const ws of [...pending]) await flush(ws).catch(console.error) }

  /** { draft, locked }: bloqueado devolve o que houver na memória (nunca lê o disco). */
  async function load(ws) {
    await purgeLegacy(ws).catch(console.error)
    if (deps.isLocked(ws)) return { draft: memory.get(ws) ?? {}, locked: true }
    if (pending.has(ws)) { await flush(ws).catch(console.error); return { draft: memory.get(ws) ?? {}, locked: false } }
    let value = null
    try { value = await readJson(draftFile(ws)) }
    catch (error) { if (LOCK_CODES.has(error?.code)) return { draft: memory.get(ws) ?? {}, locked: true }; value = null }
    const draft = isObject(value) ? value : (memory.get(ws) ?? {})
    memory.set(ws, draft)
    return { draft, locked: false }
  }

  /** Guarda na memória sempre; grava cifrado quando o espaço está desbloqueado. */
  async function save(ws, value) {
    memory.set(ws, value)
    pending.add(ws)
    const written = await flush(ws)
    return { locked: !written }
  }
  async function clear(ws) { memory.delete(ws); pending.delete(ws); if (!deps.isLocked(ws)) await atomicWrite(draftFile(ws), '{}').catch(error => { if (!LOCK_CODES.has(error?.code)) throw error }) }

  async function loadInbox(ws) {
    if (deps.isLocked(ws)) return null
    try { const value = await readJson(inboxFile(ws)); return typeof value?.inbox === 'string' ? value.inbox : null }
    catch (error) { if (LOCK_CODES.has(error?.code)) return null; return null }
  }
  async function saveInbox(ws, inboxId) { await atomicWrite(inboxFile(ws), JSON.stringify({ inbox: inboxId })) }

  return { load, save, clear, flush, flushAll, purgeLegacy, loadInbox, saveInbox, hasPending: ws => pending.has(ws), memoryDraft: ws => memory.get(ws) }
}

module.exports = { createQuickDrafts, isEmptyDraft }
