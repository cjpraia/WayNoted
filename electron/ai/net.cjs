// Rede da IA (docs/AI.md §2): só no processo principal, só para a origem permitida do provedor,
// HTTPS obrigatório para nuvem, nenhum redirecionamento, timeouts e limite de bytes.
// Erros saem como códigos `AI_*` (traduzidos no renderer por src/ai/errors.ts), nunca com a chave.
const { canAIRequest } = require('../local-policy.cjs')

const LIMITS = Object.freeze({ responseBytes: 2 * 1024 * 1024, jsonBytes: 8 * 1024 * 1024, errorBytes: 64 * 1024 })
// Mutável só para os testes encurtarem os prazos.
const TIMEOUTS = { headers: 15000, idle: 60000, cloudTotal: 180000, localTotal: 300000 }

class AIError extends Error {
  constructor(code, info = {}) {
    const parts = [code]
    if (Number.isFinite(info.retryAfter)) parts.push(`retryAfter=${Math.max(0, Math.round(info.retryAfter))}`)
    if (info.status) parts.push(`status=${info.status}`)
    if (info.detail) parts.push(`detail=${String(info.detail).replace(/\|/g, '/').slice(0, 300)}`)
    super(parts.join('|'))
    this.code = code
    Object.assign(this, info)
  }
}

/** Remove a chave (e padrões típicos de chaves) de qualquer texto que possa chegar a logs ou à UI. */
function scrub(text, secrets = []) {
  let out = String(text ?? '')
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('[chave]')
  return out
    .replace(/sk-or-[A-Za-z0-9_-]{8,}/g, '[chave]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[chave]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[chave]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [chave]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[chave]')
}

function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : undefined
}

function errorDetail(body) {
  try {
    const data = JSON.parse(body)
    const error = data?.error ?? data
    if (typeof error === 'string') return error
    return [error?.message, error?.status, error?.metadata?.provider_name && `provider ${error.metadata.provider_name}`, Array.isArray(error?.details) && error.details.map(item => item?.reason).filter(Boolean).join(',')].filter(Boolean).join(' · ')
  } catch { return body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
}

function codeForStatus(status, detail) {
  if (status === 400 && /api[_ ]?key|API_KEY_INVALID|unauthenticated/i.test(detail)) return 'AI_AUTH'
  if (status === 401) return 'AI_AUTH'
  if (status === 402) return 'AI_PAYMENT'
  if (status === 403) return 'AI_FORBIDDEN'
  if (status === 404) return 'AI_NOT_FOUND'
  if (status === 408) return 'AI_TIMEOUT'
  if (status === 413) return 'AI_TOO_LARGE'
  if (status === 429) return 'AI_RATE_LIMIT'
  if (status >= 500) return 'AI_SERVER'
  return 'AI_BAD_REQUEST'
}

async function readBounded(body, limit) {
  if (!body?.getReader) return ''
  const reader = body.getReader(), decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { text += decoder.decode(value.subarray(0, Math.max(0, limit - (bytes - value.byteLength)))); break }
      text += decoder.decode(value, { stream: true })
    }
  } finally { reader.cancel().catch(() => {}) }
  return text
}

/**
 * Abre um pedido HTTP do provedor. Devolve `{ json(), lines(), close() }`; o chamador sempre chama `close()`.
 * `policy.testOrigin` só existe nos testes com servidor simulado.
 */
async function open({ provider, url, method = 'GET', headers = {}, body, signal, fetchImpl = fetch, policy = {}, cloud, secrets = [], totalMs }) {
  if (!canAIRequest(provider, url, policy)) {
    let insecure = false
    try { insecure = cloud && new URL(url).protocol === 'http:' } catch { /* inválido */ }
    throw new AIError(insecure ? 'AI_INSECURE' : 'AI_BLOCKED_HOST')
  }
  if (signal?.aborted) throw new AIError('AI_CANCELLED')
  const controller = new AbortController()
  let reason = null
  const abort = why => { if (!reason) { reason = why; controller.abort() } }
  const onAbort = () => abort('cancel')
  signal?.addEventListener('abort', onAbort, { once: true })
  const total = setTimeout(() => abort('timeout'), totalMs ?? (cloud ? TIMEOUTS.cloudTotal : TIMEOUTS.localTotal))
  let idle = setTimeout(() => abort('timeout'), TIMEOUTS.headers)
  const close = () => { clearTimeout(total); clearTimeout(idle); signal?.removeEventListener('abort', onAbort) }
  const failure = error => {
    if (error instanceof AIError) return error
    if (reason === 'cancel') return new AIError('AI_CANCELLED')
    if (reason === 'timeout') return new AIError('AI_TIMEOUT')
    return new AIError('AI_OFFLINE', { detail: scrub(error?.cause?.code || error?.code || '', secrets) })
  }
  let response
  try {
    response = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'manual' })
  } catch (error) { close(); throw failure(error) }
  // Nenhum redirecionamento é seguido: nem para o mesmo host (evita trocar de origem/protocolo).
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) { close(); response.body?.cancel?.().catch(() => {}); throw new AIError('AI_REDIRECT', { status: response.status }) }
  if (!response.ok) {
    let text = ''
    try { text = await readBounded(response.body, LIMITS.errorBytes) } catch { /* corpo ilegível */ }
    close()
    const detail = scrub(errorDetail(text), secrets).slice(0, 300)
    throw new AIError(codeForStatus(response.status, detail), { status: response.status, detail, retryAfter: response.status === 429 || response.status === 503 ? retryAfterSeconds(response.headers?.get?.('retry-after')) : undefined })
  }
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => abort('timeout'), TIMEOUTS.idle) }
  bump()
  return {
    async json(limit = LIMITS.jsonBytes) {
      try {
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let text = '', bytes = 0
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          bump(); bytes += value.byteLength
          if (bytes > limit) { reader.cancel().catch(() => {}); throw new AIError('AI_TOO_LARGE') }
          text += decoder.decode(value, { stream: true })
        }
        try { return JSON.parse(text) } catch { throw new AIError('AI_BAD_RESPONSE') }
      } catch (error) { throw failure(error) }
    },
    async *lines(limit = LIMITS.responseBytes * 4) {
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = '', bytes = 0
      try {
        for (;;) {
          let chunk
          try { chunk = await reader.read() } catch (error) { throw failure(error) }
          if (chunk.done) break
          bump(); bytes += chunk.value.byteLength
          if (bytes > limit) throw new AIError('AI_TOO_LARGE')
          buffer += decoder.decode(chunk.value, { stream: true })
          let index
          while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1); yield line }
          if (buffer.length > 1024 * 1024) throw new AIError('AI_TOO_LARGE')
        }
        buffer += decoder.decode()
        if (buffer) yield buffer.replace(/\r$/, '')
        if (reason) throw failure(new Error(reason))
      } finally { reader.cancel().catch(() => {}) }
    },
    close,
  }
}

/** Server-Sent Events: junta linhas `data:` até a linha vazia; ignora comentários (`: OPENROUTER PROCESSING`). */
async function* sseEvents(lines) {
  let data = []
  for await (const line of lines) {
    if (line === '') { if (data.length) { yield data.join('\n'); data = [] } continue }
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length) yield data.join('\n')
}

/** Acumula texto de streaming com teto; passa a exceder => AI_TOO_LARGE. */
function textSink(onDelta, limit = LIMITS.responseBytes) {
  let text = ''
  return {
    push(piece) {
      if (typeof piece !== 'string' || !piece) return
      if (text.length + piece.length > limit) throw new AIError('AI_TOO_LARGE')
      text += piece; onDelta?.(piece)
    },
    get text() { return text },
  }
}

const estimateTokens = text => Math.ceil(String(text ?? '').length / 4)

module.exports = { AIError, open, sseEvents, textSink, scrub, retryAfterSeconds, estimateTokens, LIMITS, TIMEOUTS }
