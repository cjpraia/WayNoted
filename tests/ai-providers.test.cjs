const PRODUCT = require('../shared/product.json')
// Provedores de IA contra servidores HTTP SIMULADOS locais (nenhuma chamada real à nuvem).
// Formatos: Ollama NDJSON, OpenRouter SSE (com keep-alive e usage final), Gemini SSE (alt=sse).
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('../electron/ai/net.cjs')
const { createOllama } = require('../electron/ai/providers/ollama.cjs')
const { createOpenRouter } = require('../electron/ai/providers/openrouter.cjs')
const { createGoogle } = require('../electron/ai/providers/google.cjs')
const { canAIRequest, canRequest, isLoopbackEndpoint } = require('../electron/local-policy.cjs')

const KEY = 'sk-or-v1-TESTKEY0123456789abcdef'
const GKEY = 'AIzaTESTKEY_0123456789abcdefghijk'

async function server(handler) {
  const requests = []
  const sockets = new Set()
  const srv = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const entry = { method: req.method, url: req.url, headers: req.headers, body, closed: false }
    requests.push(entry)
    res.on('close', () => { entry.closed = true })
    try { await handler(req, res, entry) } catch { if (!res.headersSent) res.writeHead(500); res.end() }
  })
  srv.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${srv.address().port}`
  return { origin, requests, close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); srv.close(resolve) }) }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Olá' }]

test('policy: cloud only over HTTPS to the exact origin; Ollama only on loopback; renderer policy unchanged', () => {
  assert.equal(canAIRequest('openrouter', 'https://openrouter.ai/api/v1/models'), true)
  assert.equal(canAIRequest('openrouter', 'http://openrouter.ai/api/v1/models'), false)
  assert.equal(canAIRequest('openrouter', 'https://openrouter.ai.evil.com/api/v1'), false)
  assert.equal(canAIRequest('openrouter', 'https://user:pw@openrouter.ai/api/v1'), false)
  assert.equal(canAIRequest('google', 'https://generativelanguage.googleapis.com/v1beta/models'), true)
  assert.equal(canAIRequest('google', 'https://openrouter.ai/api/v1/models'), false)
  assert.equal(canAIRequest('ollama', 'http://127.0.0.1:11434/api/tags'), true)
  assert.equal(canAIRequest('ollama', 'http://192.168.0.2:11434/api/tags'), false)
  assert.equal(canAIRequest('ollama', 'https://ollama.com/api/tags'), false)
  assert.equal(canAIRequest('other', 'https://openrouter.ai/'), false)
  assert.equal(isLoopbackEndpoint('http://localhost:11434'), true)
  assert.equal(isLoopbackEndpoint('http://10.0.0.1:11434'), false)
  // O renderer continua sem acesso a nenhum host de IA.
  const config = { isDev: false, entryFile: '/app/dist/index.html', devURL: 'http://localhost:5310' }
  for (const url of ['https://openrouter.ai/api/v1/models', 'https://generativelanguage.googleapis.com/v1beta/models', 'http://127.0.0.1:11434/api/tags']) assert.equal(canRequest(url, config), false, url)
})

test('production providers refuse plain HTTP and foreign hosts before any connection', async () => {
  let calls = 0
  const spy = async () => { calls++; throw new Error('should not be called') }
  const insecure = createOpenRouter({ fetchImpl: spy, getKey: async () => KEY, base: 'http://openrouter.ai/api/v1' })
  await assert.rejects(insecure.listModels(), /AI_INSECURE/)
  const foreign = createOpenRouter({ fetchImpl: spy, getKey: async () => KEY, base: 'https://evil.example/api/v1' })
  await assert.rejects(foreign.stream({ model: 'm', messages }), /AI_BLOCKED_HOST/)
  const google = createGoogle({ fetchImpl: spy, getKey: async () => GKEY, base: 'http://generativelanguage.googleapis.com/v1beta' })
  await assert.rejects(google.listModels(), /AI_INSECURE/)
  assert.throws(() => createOllama({ fetchImpl: spy, endpoint: 'http://example.com:11434' }), /AI_BLOCKED_HOST/)
  const noKey = createOpenRouter({ fetchImpl: spy, getKey: async () => null })
  await assert.rejects(noKey.listModels(), /AI_NO_KEY/)
  assert.equal(calls, 0)
})

test('Ollama: lists only local GGUF models, streams NDJSON, embeds and maps errors', async () => {
  const srv = await server(async (req, res, entry) => {
    if (req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b', size: 10, details: { format: 'gguf', family: 'llama' } }, { name: 'gpt-oss:120b-cloud', size: 10, details: { format: 'gguf' } }, { name: 'remote', size: 10, remote_host: 'https://ollama.com', details: { format: 'gguf' } }] })) }
    if (req.url === '/api/chat') {
      const body = JSON.parse(entry.body)
      if (body.model === 'missing') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: "model 'missing' not found" })) }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      for (const piece of ['Olá', ', ', 'mundo']) { res.write(JSON.stringify({ message: { role: 'assistant', content: piece }, done: false }) + '\n'); await sleep(5) }
      return res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 12, eval_count: 3 }) + '\n')
    }
    if (req.url === '/api/embed') { const body = JSON.parse(entry.body); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ embeddings: body.input.map((_, i) => [i, 1, 0]) })) }
    res.writeHead(404); res.end()
  })
  try {
    const ai = createOllama({ endpoint: srv.origin })
    assert.deepEqual((await ai.listModels()).map(m => m.id), ['llama3.2:3b'])
    const deltas = []
    const result = await ai.stream({ model: 'llama3.2:3b', messages, temperature: 0.2, maxTokens: 50 }, d => deltas.push(d))
    assert.deepEqual(deltas, ['Olá', ', ', 'mundo'])
    assert.equal(result.text, 'Olá, mundo')
    assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 3, estimated: false })
    const sent = JSON.parse(srv.requests.find(r => r.url === '/api/chat').body)
    assert.equal(sent.stream, true); assert.equal(sent.options.num_predict, 50); assert.equal(sent.options.temperature, 0.2)
    assert.deepEqual(await ai.embed(['a', 'b'], 'nomic-embed-text'), [[0, 1, 0], [1, 1, 0]])
    await assert.rejects(ai.stream({ model: 'missing', messages }), /AI_NOT_FOUND/)
  } finally { await srv.close() }
  // Ollama desligado: porta fechada => offline.
  await assert.rejects(createOllama({ endpoint: srv.origin }).listModels(), /AI_OFFLINE/)
})

test('OpenRouter: SSE with keep-alive comments, final usage, attribution off by default, bearer only to the provider', async () => {
  const srv = await server(async (req, res) => {
    if (req.url === '/api/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', context_length: 128000 }, { id: 'anthropic/claude-x', name: 'Claude' }] })) }
    if (req.url === '/api/v1/key') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: { label: 'x' } })) }
    if (req.url === '/api/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': OPENROUTER PROCESSING\n\n')
      for (const piece of ['Re', 'sposta']) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`); await sleep(5) }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } })}\n\n`)
      return res.end('data: [DONE]\n\n')
    }
    res.writeHead(404); res.end()
  })
  try {
    const ai = createOpenRouter({ getKey: async () => KEY, base: `${srv.origin}/api/v1`, policy: { testOrigin: srv.origin } })
    assert.deepEqual((await ai.listModels()).map(m => m.id), ['openai/gpt-4o-mini', 'anthropic/claude-x'])
    assert.deepEqual(await ai.test(), { ok: true })
    const deltas = []
    const result = await ai.stream({ model: 'openai/gpt-4o-mini', messages, temperature: 0.5, maxTokens: 99 }, d => deltas.push(d))
    assert.equal(result.text, 'Resposta'); assert.deepEqual(deltas, ['Re', 'sposta'])
    assert.deepEqual(result.usage, { promptTokens: 20, completionTokens: 2, estimated: false })
    const chat = srv.requests.find(r => r.url === '/api/v1/chat/completions')
    assert.equal(chat.headers.authorization, `Bearer ${KEY}`)
    assert.equal(chat.headers['http-referer'], undefined); assert.equal(chat.headers['x-title'], undefined)
    const body = JSON.parse(chat.body)
    assert.equal(body.stream, true); assert.equal(body.max_tokens, 99); assert.deepEqual(body.messages, messages)
    const attributed = createOpenRouter({ getKey: async () => KEY, attribution: true, base: `${srv.origin}/api/v1`, policy: { testOrigin: srv.origin } })
    await attributed.test()
    assert.equal(srv.requests.at(-1).headers['x-title'], `${PRODUCT.name}`)
  } finally { await srv.close() }
})

test('OpenRouter: 401/402/429/5xx/mid-stream errors are mapped without leaking the key', async () => {
  let mode = ''
  const srv = await server(async (req, res) => {
    if (mode === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 401, message: `Invalid key ${KEY}` } })) }
    if (mode === '402') { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } })) }
    if (mode === '429') { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' }); return res.end(JSON.stringify({ error: { code: 429, message: 'Rate limited' } })) }
    if (mode === '503') { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<h1>down</h1>') }
    if (mode === 'mid') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'parcial' } }] })}\n\n`); return res.end(`data: ${JSON.stringify({ error: { code: 'server_error', message: 'Provider disconnected' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] })}\n\n`) }
    res.writeHead(404); res.end()
  })
  try {
    const ai = createOpenRouter({ getKey: async () => KEY, base: `${srv.origin}/api/v1`, policy: { testOrigin: srv.origin } })
    mode = '401'
    const error = await ai.stream({ model: 'm', messages }).then(() => null, e => e)
    assert.equal(error.code, 'AI_AUTH'); assert.equal(error.message.includes(KEY), false); assert.equal(String(error.detail).includes(KEY), false)
    mode = '402'; await assert.rejects(ai.stream({ model: 'm', messages }), /AI_PAYMENT/)
    mode = '429'
    const limited = await ai.stream({ model: 'm', messages }).then(() => null, e => e)
    assert.equal(limited.code, 'AI_RATE_LIMIT'); assert.equal(limited.retryAfter, 7); assert.match(limited.message, /retryAfter=7/)
    mode = '503'; await assert.rejects(ai.stream({ model: 'm', messages }), /AI_SERVER/)
    mode = 'mid'; await assert.rejects(ai.stream({ model: 'm', messages }), /AI_SERVER/)
  } finally { await srv.close() }
})

test('streams are cancellable, time out when the server stalls, and never follow redirects', async () => {
  const srv = await server(async (req, res) => {
    if (req.url.includes('/stall/')) { await sleep(2000); res.writeHead(200); return res.end() }
    if (req.url.endsWith('/models')) { res.writeHead(302, { Location: 'https://evil.example/steal' }); return res.end() }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let i = 0; i < 200 && !res.destroyed; i++) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `p${i} ` } }] })}\n\n`); await sleep(10) }
    res.end('data: [DONE]\n\n')
  })
  const saved = { ...net.TIMEOUTS }
  try {
    const ai = createOpenRouter({ getKey: async () => KEY, base: `${srv.origin}/api/v1`, policy: { testOrigin: srv.origin } })
    const controller = new AbortController()
    let received = 0
    const pending = ai.stream({ model: 'm', messages }, () => { if (++received === 3) controller.abort() }, controller.signal)
    await assert.rejects(pending, /AI_CANCELLED/)
    assert.ok(received < 10, `stopped after ${received} deltas`)
    await sleep(50)
    assert.equal(srv.requests.at(-1).closed, true)
    await assert.rejects(ai.listModels(), /AI_REDIRECT/)
    assert.equal(srv.requests.some(r => r.url.includes('steal')), false)
    net.TIMEOUTS.headers = 150
    const staller = createOpenRouter({ getKey: async () => KEY, base: `${srv.origin}/api/v1/stall`, policy: { testOrigin: srv.origin } })
    await assert.rejects(staller.test(), /AI_TIMEOUT/)
  } finally { Object.assign(net.TIMEOUTS, saved); await srv.close() }
})

test('response size is capped', async () => {
  const srv = await server(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const big = 'x'.repeat(64 * 1024)
    for (let i = 0; i < 40 && !res.destroyed; i++) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: big } }] })}\n\n`); await sleep(1) }
    res.end()
  })
  try {
    const ai = createOpenRouter({ getKey: async () => KEY, base: `${srv.origin}/api/v1`, policy: { testOrigin: srv.origin } })
    await assert.rejects(ai.stream({ model: 'm', messages }), /AI_TOO_LARGE/)
  } finally { await srv.close() }
})

test('Gemini: key only in x-goog-api-key, paginated models, SSE stream with systemInstruction, errors mapped', async () => {
  let fail = ''
  const srv = await server(async (req, res, entry) => {
    if (fail === 'key') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })) }
    if (fail === '429') { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3' }); return res.end(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } })) }
    if (req.url.startsWith('/v1beta/models?')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (!req.url.includes('pageToken')) return res.end(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'], inputTokenLimit: 1048576 }], nextPageToken: 'p2' }))
      return res.end(JSON.stringify({ models: [{ name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] }))
    }
    if (req.url === '/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Oi ' }] } }] })}\r\n\r\n`)
      await sleep(5)
      return res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'você' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11 } })}\r\n\r\n`)
    }
    if (req.url === '/v1beta/models/gemini-embedding-001:embedContent') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ embedding: { values: [0.1, 0.2] } })) }
    res.writeHead(404); res.end(JSON.stringify({ error: { code: 404, message: 'not found', entry: entry.url } }))
  })
  try {
    const ai = createGoogle({ getKey: async () => GKEY, base: `${srv.origin}/v1beta`, policy: { testOrigin: srv.origin } })
    assert.deepEqual((await ai.listModels()).map(m => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro'])
    const deltas = []
    const result = await ai.stream({ model: 'gemini-2.5-flash', messages: [...messages, { role: 'assistant', content: 'antes' }, { role: 'user', content: 'e agora?' }], temperature: 0.1, maxTokens: 64 }, d => deltas.push(d))
    assert.equal(result.text, 'Oi você'); assert.deepEqual(deltas, ['Oi ', 'você']); assert.deepEqual(result.usage, { promptTokens: 9, completionTokens: 2, estimated: false })
    const call = srv.requests.find(r => r.url.includes('streamGenerateContent'))
    const body = JSON.parse(call.body)
    assert.deepEqual(body.systemInstruction, { parts: [{ text: 'sys' }] })
    assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user'])
    assert.deepEqual(body.generationConfig, { temperature: 0.1, maxOutputTokens: 64 })
    for (const request of srv.requests) { assert.equal(request.headers['x-goog-api-key'], GKEY); assert.equal(request.url.includes(GKEY), false); assert.equal(/[?&]key=/.test(request.url), false) }
    assert.deepEqual(await ai.embed(['texto'], 'gemini-embedding-001'), [[0.1, 0.2]])
    await assert.rejects(ai.stream({ model: '../../evil', messages }), /AI_NOT_FOUND/)
    fail = 'key'
    const error = await ai.test().then(() => null, e => e)
    assert.equal(error.code, 'AI_AUTH'); assert.equal(error.message.includes(GKEY), false)
    fail = '429'
    const limited = await ai.stream({ model: 'gemini-2.5-flash', messages }).then(() => null, e => e)
    assert.equal(limited.code, 'AI_RATE_LIMIT'); assert.equal(limited.retryAfter, 3)
  } finally { await srv.close() }
})

test('scrub removes keys and key-like strings', () => {
  const text = net.scrub(`bad ${KEY} and ${GKEY} Bearer abcdefghijk ?key=zzz`, [KEY])
  assert.equal(text.includes(KEY) || text.includes(GKEY) || text.includes('abcdefghijk') || text.includes('zzz'), false)
})
