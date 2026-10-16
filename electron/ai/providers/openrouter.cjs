const PRODUCT = require('../../../shared/product.json')
// OpenRouter (nuvem, opt-in): API compatível com OpenAI em https://openrouter.ai/api/v1.
// Streaming SSE; comentários de keep-alive ignorados; `usage` no último pedaço; erro no meio do stream.
const { AIError, open, sseEvents, textSink, estimateTokens } = require('../net.cjs')

const BASE = 'https://openrouter.ai/api/v1'

function createOpenRouter({ fetchImpl = fetch, getKey, attribution = false, policy = {}, base = BASE } = {}) {
  async function request(path, init = {}) {
    const key = await getKey()
    if (!key) throw new AIError('AI_NO_KEY')
    const headers = { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) }
    // Atribuição opcional (desligada por padrão): identifica só o app, nunca o usuário.
    if (attribution) { headers['HTTP-Referer'] = "https://workspace.local"; headers['X-Title'] = `${PRODUCT.name}` }
    return open({ provider: 'openrouter', url: `${base}${path}`, fetchImpl, policy, cloud: true, secrets: [key], ...init, headers })
  }
  async function listModels(signal) {
    const session = await request('/models', { signal, totalMs: 30000 })
    try {
      const data = await session.json()
      const list = Array.isArray(data?.data) ? data.data : []
      return list.filter(model => typeof model?.id === 'string' && model.id.length < 200).map(model => ({ id: model.id, name: typeof model.name === 'string' ? model.name : model.id, contextLength: Number(model.context_length) || undefined }))
    } finally { session.close() }
  }
  async function stream(req, onDelta, signal) {
    const body = { model: req.model, messages: req.messages.map(m => ({ role: m.role, content: m.content })), stream: true, ...(Number.isFinite(req.temperature) ? { temperature: req.temperature } : {}), ...(Number.isFinite(req.maxTokens) ? { max_tokens: req.maxTokens } : {}) }
    const session = await request('/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const sink = textSink(onDelta)
    let usage = null
    try {
      for await (const data of sseEvents(session.lines())) {
        if (data === '[DONE]') break
        let chunk
        try { chunk = JSON.parse(data) } catch { continue }
        if (chunk.error) { const status = Number(chunk.error.code); throw new AIError(status === 429 ? 'AI_RATE_LIMIT' : status === 401 ? 'AI_AUTH' : status === 402 ? 'AI_PAYMENT' : 'AI_SERVER', { detail: String(chunk.error.message ?? '').slice(0, 200) }) }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null
        sink.push(choice?.delta?.content ?? choice?.message?.content ?? '')
        if (chunk.usage) usage = { promptTokens: Number(chunk.usage.prompt_tokens) || 0, completionTokens: Number(chunk.usage.completion_tokens) || 0, estimated: false }
      }
    } finally { session.close() }
    if (!usage) usage = { promptTokens: estimateTokens(req.messages.map(m => m.content).join('\n')), completionTokens: estimateTokens(sink.text), estimated: true }
    return { text: sink.text, usage }
  }
  return {
    id: 'openrouter', cloud: true,
    listModels, stream,
    chat: (req, signal) => stream(req, null, signal),
    async embed() { throw new AIError('AI_UNSUPPORTED') },
    async test(signal) {
      // /key valida a chave sem gerar texto (não consome créditos).
      const session = await request('/key', { signal, totalMs: 20000 })
      try { await session.json(); return { ok: true } } finally { session.close() }
    },
  }
}
module.exports = { createOpenRouter, BASE }
