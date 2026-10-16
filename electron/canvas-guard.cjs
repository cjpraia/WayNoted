// Proteção da lousa (bloco `canvas` em docs/<id>.json, docs/USAGE.md).
// A API local e o MCP nunca despejam nem sobrescrevem a cena: o bloco sai como resumo opaco
// e, ao gravar, o bloco real guardado é reinserido. Escrever uma cena por aqui é recusado.
const { createHash } = require('node:crypto')

const isCanvas = block => !!block && typeof block === 'object' && block.type === 'canvas'
const fingerprint = block => createHash('sha256').update(JSON.stringify(block.props ?? null)).digest('hex').slice(0, 16)

function canvasError(message) {
  return Object.assign(new Error('CANVAS_PROTECTED: ' + message), { status: 409, code: 'CANVAS_PROTECTED' })
}

/** Bloco opaco: id, nº de objetos e uma impressão digital da cena (muda quando o quadro muda). */
function opaqueBlock(block, title = '') {
  const objects = Array.isArray(block.props?.objects) ? block.props.objects.length : 0
  return { id: block.id, type: 'canvas', props: { opaque: true, objects, title: String(title ?? ''), rev: fingerprint(block) }, children: [] }
}
const exposeBlocks = (blocks, title) => (Array.isArray(blocks) ? blocks : []).map(block => isCanvas(block) ? opaqueBlock(block, title) : block)

/**
 * Funde a lista recebida com o documento atual: blocos canvas guardados ficam intactos.
 * - placeholder opaco (mesmo id e `rev` atual) => volta o bloco real;
 * - canvas recebido que não seja placeholder, ou com `rev` velho => CANVAS_PROTECTED;
 * - canvas omitido => reinserido na posição original (lista vazia não apaga o quadro).
 */
function mergeCanvasBlocks(current, incoming) {
  const stored = (Array.isArray(current) ? current : []).map((block, index) => ({ block, index })).filter(item => isCanvas(item.block))
  if (!stored.length && !incoming.some(isCanvas)) return incoming
  const byId = new Map(stored.map(item => [item.block.id, item.block]))
  const used = new Set()
  const merged = []
  for (const block of incoming) {
    if (!isCanvas(block)) { merged.push(block); continue }
    const real = byId.get(block.id)
    if (!real || block.props?.opaque !== true) throw canvasError('a lousa não pode ser escrita por esta ferramenta.')
    if (block.props.rev !== fingerprint(real)) throw canvasError('a lousa mudou desde a leitura; leia os blocos de novo.')
    merged.push(real); used.add(real.id)
  }
  for (const { block, index } of stored) if (!used.has(block.id)) merged.splice(Math.min(index, merged.length), 0, block)
  return merged
}

/** Garantia final no armazenamento: todo bloco canvas atual precisa continuar idêntico. */
function assertCanvasPreserved(current, next) {
  for (const block of (Array.isArray(current) ? current : []).filter(isCanvas)) {
    const kept = next.find(candidate => candidate?.id === block.id && candidate.type === 'canvas')
    if (!kept || JSON.stringify(kept) !== JSON.stringify(block)) throw canvasError('a gravação alteraria ou apagaria a lousa.')
  }
}

function syncedError(message) {
  return Object.assign(new Error('SYNCED_BLOCK_PROTECTED: ' + message), { status: 409, code: 'SYNCED_BLOCK_PROTECTED' })
}

/** Referências a blocos sincronizados (id do bloco -> syncedId), em qualquer nível. */
function syncedReferences(blocks) {
  const found = new Map()
  const walk = items => { for (const block of Array.isArray(items) ? items : []) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'syncedBlock' && typeof block.props?.syncedId === 'string' && block.props.syncedId) found.set(block.id, block.props.syncedId)
    walk(block.children)
  } }
  walk(blocks)
  return found
}

/** Caminhos externos (API, MCP, importações, restauração) não removem nem reapontam blocos sincronizados. */
function assertSyncedPreserved(current, next) {
  const kept = syncedReferences(next)
  for (const [id, syncedId] of syncedReferences(current)) if (kept.get(id) !== syncedId) throw syncedError('a gravação removeria ou reapontaria um bloco sincronizado.')
}

/** Guarda única de escrita externa: lousa e blocos sincronizados. */
function assertProtectedPreserved(current, next) {
  assertCanvasPreserved(current, next)
  assertSyncedPreserved(current, next)
}

/** O meta nunca perde registros de blocos sincronizados; o conteúdo só muda pelo editor. */
function assertSyncedRecordsUntouched(current, next) {
  if (JSON.stringify(current ?? {}) !== JSON.stringify(next ?? {})) throw syncedError('os blocos sincronizados não podem ser alterados por esta operação.')
}

module.exports = { assertSyncedPreserved, assertProtectedPreserved, assertSyncedRecordsUntouched, syncedError, syncedReferences, isCanvas, opaqueBlock, exposeBlocks, mergeCanvasBlocks, assertCanvasPreserved, canvasError }
