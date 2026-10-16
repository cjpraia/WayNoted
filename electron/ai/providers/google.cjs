// Google Gemini API (nuvem, opt-in). A chave vai só no cabeçalho `x-goog-api-key`, nunca na URL.
// Gemini aceita papéis `user`/`model`; o `system` vira `systemInstruction`.
const { AIError, open, sseEvents, textSink, estimateTokens } = require('../net.cjs')

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

function createGoogle({ fetchImpl = fetch, getKey, policy = {}, base = BASE } = {}) {
  async function request(path, init = {}) {
    const key = await getKey()
    if (!key) throw new AIError('AI_NO_KEY')
    return open({ provider: 'google', url: `${base}${path}`, fetchImpl, policy, cloud: true, secrets: [key], ...init, headers: { 'x-goog-api-key': key, ...(init.headers ?? {}) } })
  }
  const modelPath = model => {
    const id = String(model ?? '').replace(/^models\//, '')
    if (!MODEL_ID.test(id)) throw new AIError('AI_NOT_FOUND')
    return `/models/${encodeURIComponent(id)}`
  }
  function toGemini(req) {
    const system = req.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const contents = req.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const generationConfig = { ...(Number.isFinite(req.temperature) ? { temperature: req.temperature } : {}), ...(Number.isFinite(req.maxTokens) ? { maxOutputTokens: req.maxTokens } : {}) }
    return { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), ...(Object.keys(generationConfig).length ? { generationConfig } : {}) }
  }
  const textOf = response => (response?.candidates?.[0]?.content?.parts ?? []).map(part => typeof part?.text === 'string' && !part.thought ? part.text : '').join('')
  const usageOf = meta => meta ? { promptTokens: Number(meta.promptTokenCount) || 0, completionTokens: Number(meta.candidatesTokenCount) || Math.max(0, (Number(meta.totalTokenCount) || 0) - (Number(meta.promptTokenCount) || 0)), estimated: false } : null
  async function listModels(signal) {
    const out = []
    let token = ''
    for (let page = 0; page < 5; page++) {
      const session = await request(`/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { signal, totalMs: 30000 })
      let data
      try { data = await session.json() } finally { session.close() }
      for (const model of Array.isArray(data?.models) ? data.models : []) {
        if (typeof model?.name !== 'string') continue
        const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : []
        out.push({ id: model.name.replace(/^models\//, ''), name: model.displayName || model.name, contextLength: Number(model.inputTokenLimit) || undefined, generate: methods.includes('generateContent'), embed: methods.includes('embedContent') })
      }
      token = typeof data?.nextPageToken === 'string' ? data.nextPageToken : ''
      if (!token) break
    }
    return out.filter(model => model.generate)
  }
  async function stream(req, onDelta, signal) {
    const session = await request(`${modelPath(req.model)}:streamGenerateContent?alt=sse`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toGemini(req)) })
    const sink = textSink(onDelta)
    let usage = null, blocked = null
    try {
      for await (const data of sseEvents(session.lines())) {
        let chunk
        try { chunk = JSON.parse(data) } catch { continue }
        if (chunk.error) throw new AIError(Number(chunk.error.code) === 429 ? 'AI_RATE_LIMIT' : 'AI_SERVER', { detail: String(chunk.error.message ?? '').slice(0, 200) })
        sink.push(textOf(chunk))
        if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason
        usage = usageOf(chunk.usageMetadata) ?? usage
      }
    } finally { session.close() }
    if (!sink.text && blocked) throw new AIError('AI_REFUSED', { detail: String(blocked) })
    return { text: sink.text, usage: usage ?? { promptTokens: estimateTokens(req.messages.map(m => m.content).join('\n')), completionTokens: estimateTokens(sink.text), estimated: true } }
  }
  async function chat(req, signal) {
    const session = await request(`${modelPath(req.model)}:generateContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toGemini(req)) })
    try { const data = await session.json(); return { text: textOf(data), usage: usageOf(data.usageMetadata) ?? { promptTokens: 0, completionTokens: 0, estimated: true } } } finally { session.close() }
  }
  async function embed(texts, model, signal) {
    if (!Array.isArray(texts) || texts.length !== 1) throw new AIError('AI_BAD_REQUEST')
    const session = await request(`${modelPath(model)}:embedContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: texts[0] }] } }) })
    try { const data = await session.json(); const values = data?.embedding?.values; if (!Array.isArray(values)) throw new AIError('AI_BAD_RESPONSE'); return [values] } finally { session.close() }
  }
  return {
    id: 'google', cloud: true,
    listModels, stream, chat, embed,
    async test(signal) { const session = await request('/models?pageSize=1', { signal, totalMs: 20000 }); try { await session.json(); return { ok: true } } finally { session.close() } },
  }
}
module.exports = { createGoogle, BASE }
