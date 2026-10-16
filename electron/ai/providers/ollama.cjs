// Ollama local (padrão). Só loopback; nunca instala nem baixa modelos. Modelos "cloud"/remotos
// do próprio Ollama são ignorados (mesmo filtro de electron/local-ai.cjs).
const { isLocalModel } = require('../../local-ai.cjs')
const { isLoopbackEndpoint } = require('../../local-policy.cjs')
const { AIError, open, textSink, estimateTokens } = require('../net.cjs')

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'

function createOllama({ fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT, policy = {} } = {}) {
  if (!isLoopbackEndpoint(endpoint)) throw new AIError('AI_BLOCKED_HOST')
  const base = endpoint.replace(/\/+$/, '')
  const request = (path, init = {}) => open({ provider: 'ollama', url: `${base}${path}`, fetchImpl, policy, cloud: false, ...init })
  const toOllama = messages => messages.map(m => ({ role: m.role, content: m.content }))
  async function listModels(signal) {
    const session = await request('/api/tags', { signal, totalMs: 5000 })
    try {
      const data = await session.json()
      return (Array.isArray(data?.models) ? data.models : []).filter(isLocalModel).map(model => ({ id: model.name, name: model.name, size: model.size, family: model.details?.family }))
    } finally { session.close() }
  }
  async function stream(req, onDelta, signal) {
    const session = await request('/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: req.model, messages: toOllama(req.messages), stream: true, options: { ...(Number.isFinite(req.temperature) ? { temperature: req.temperature } : {}), ...(Number.isFinite(req.maxTokens) ? { num_predict: req.maxTokens } : {}) } }) })
    const sink = textSink(onDelta)
    let usage = null
    try {
      for await (const line of session.lines()) {
        if (!line.trim()) continue
        let data
        try { data = JSON.parse(line) } catch { throw new AIError('AI_BAD_RESPONSE') }
        if (data.error) throw new AIError(/not found|pull/i.test(data.error) ? 'AI_NOT_FOUND' : 'AI_SERVER', { detail: String(data.error).slice(0, 200) })
        sink.push(data.message?.content ?? data.response ?? '')
        if (data.done) { usage = { promptTokens: data.prompt_eval_count ?? 0, completionTokens: data.eval_count ?? 0, estimated: !Number.isFinite(data.eval_count) }; break }
      }
    } finally { session.close() }
    if (!usage) usage = { promptTokens: estimateTokens(req.messages.map(m => m.content).join('\n')), completionTokens: estimateTokens(sink.text), estimated: true }
    return { text: sink.text, usage }
  }
  async function embed(texts, model, signal) {
    if (!Array.isArray(texts) || !texts.length || texts.length > 64 || texts.some(text => typeof text !== 'string' || text.length > 8000)) throw new AIError('AI_BAD_REQUEST')
    const session = await request('/api/embed', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: texts }), totalMs: 120000 })
    try {
      const data = await session.json(32 * 1024 * 1024)
      const vectors = data?.embeddings
      if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some(v => !Array.isArray(v) || !v.length || v.some(n => typeof n !== 'number'))) throw new AIError('AI_BAD_RESPONSE')
      return vectors
    } finally { session.close() }
  }
  return {
    id: 'ollama', cloud: false, endpoint: base,
    listModels, stream, embed,
    chat: (req, signal) => stream(req, null, signal),
    async test(signal) { const models = await listModels(signal); return { ok: true, models: models.length } },
  }
}
module.exports = { createOllama, DEFAULT_ENDPOINT }
