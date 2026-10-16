// Política e privacidade da IA no processo principal (servidores simulados; nenhuma rede real).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { initializeSecureStorage } = require('../electron/secure-storage.cjs')
const { setStorageCodec, atomicWrite, drain } = require('../electron/storage.cjs')
const { createWorkspaceStorage, drainWorkspaces } = require('../electron/workspace-storage.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')
const { createAIService } = require('../electron/ai/service.cjs')
const { redact } = require('../electron/ai/redact.cjs')

const KEY = 'sk-or-v1-SECRETKEY9876543210zyxwv'
const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const keychain = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(Buffer.from(text).map(b => b ^ 0x5a)), decryptString: bytes => Buffer.from(Buffer.from(bytes).map(b => b ^ 0x5a)).toString() }
const page = (id, extra = {}) => ({ id, parentId: null, title: `T${id.slice(-2)}`, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra })
const meta = {
  pages: {
    [P(1)]: page(P(1), { title: 'Projeto' }),
    [P(2)]: page(P(2), { title: 'Lixo', trashed: true, trashedAt: 5 }),
    [P(3)]: page(P(3), { title: 'Filho do lixo', parentId: P(2) }),
    [P(4)]: page(P(4), { title: 'Diário', passwordLock: { rootId: P(4), hideTitle: false, unlocked: true } }),
    [P(5)]: page(P(5), { title: 'Sub do diário', parentId: P(4) }),
    [P(6)]: page(P(6), { title: 'Registrada no cofre de páginas' }),
  },
  settings: { locale: 'pt-BR', userName: 'Eu' },
}

async function mockServers() {
  const requests = []
  let mode = 'ok'
  const srv = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, headers: req.headers, body })
    if (req.url === '/api/tags') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b', size: 9, details: { format: 'gguf' } }, { name: 'qwen3:cloud', size: 9, details: { format: 'gguf' } }] })) }
    if (req.url === '/api/chat') { res.writeHead(200); return res.end(JSON.stringify({ message: { content: 'local ok' }, done: true, prompt_eval_count: 4, eval_count: 2 }) + '\n') }
    if (mode === '401') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 401, message: `No auth credentials found for ${req.headers.authorization}` } })) }
    if (req.url === '/api/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }] })) }
    if (req.url === '/api/v1/key') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":{}}') }
    if (req.url === '/api/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Segundo [1].' } }] })}\n\n`)
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 50, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`)
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${srv.address().port}`
  return { origin, requests, setMode: value => { mode = value }, close: () => new Promise(resolve => srv.close(resolve)) }
}

async function setup(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-ai-service-"))
  await initializeSecureStorage(root, keychain, { deviceCipher: 'keychain' })
  const dataDir = path.join(root, 'data')
  await atomicWrite(path.join(dataDir, 'meta.json'), JSON.stringify(meta))
  const store = createWorkspaceStorage(dataDir)
  const mock = await mockServers()
  const logs = []
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  for (const name of Object.keys(original)) console[name] = (...args) => { logs.push(args.map(String).join(' ')); }
  const service = createAIService({
    dataDir: () => dataDir, safeStorage: keychain,
    loadMeta: () => store.loadMeta(),
    isProtected: (_ws, id) => id === P(4) || id === P(6), ...(overrides.native ? { native: overrides.native } : {}),
    recordActivity: (_ws, entry) => store.recordActivity([entry]),
    providerOptions: { openrouter: { base: `${mock.origin}/api/v1`, policy: { testOrigin: mock.origin } }, google: { base: `${mock.origin}/v1beta`, policy: { testOrigin: mock.origin } } },
  })
  await service.updateSettings('default', { ollamaEndpoint: mock.origin })
  const cleanup = async () => { Object.assign(console, original); await mock.close(); await drainWorkspaces(); await drain(); setStorageCodec(null); await fs.rm(root, { recursive: true, force: true }) }
  return { root, dataDir, store, mock, service, logs, cleanup }
}
const sources = [
  { pageId: P(1), title: 'Projeto', text: 'Decidimos usar SQLite. Contato: ana@example.com, +55 (11) 91234-5678, conta 1234567890123.' },
  { pageId: P(2), title: 'Lixo', text: 'TRASHED-SECRET' },
  { pageId: P(3), title: 'Filho', text: 'TRASHED-CHILD-SECRET' },
  { pageId: P(4), title: 'Diário', text: 'PROTECTED-SECRET' },
  { pageId: P(5), title: 'Sub', text: 'PROTECTED-CHILD-SECRET' },
  { pageId: P(6), title: 'Cofre', text: 'VAULT-REGISTERED-SECRET' },
  { pageId: P(99), title: 'Sumiu', text: 'MISSING-SECRET' },
]
const chatRequests = mock => mock.requests.filter(r => r.url.includes('/chat'))

test('defaults are local; consent cannot be set through settings; endpoint must be loopback', async () => {
  const h = await setup()
  try {
    const settings = await h.service.getSettings('default')
    assert.equal(settings.activeProvider, 'ollama'); assert.equal(settings.blockCloud, false); assert.equal(settings.redact, false)
    assert.deepEqual(settings.confirmEachSend, { openrouter: true, google: true }); assert.deepEqual(settings.consent, { openrouter: null, google: null })
    assert.deepEqual(settings.keys, { openrouter: { configured: false }, google: { configured: false } })
    const after = await h.service.updateSettings('default', { consent: { openrouter: { grantedAt: 1, version: 1 } }, activeProvider: 'openrouter' })
    assert.equal(after.consent.openrouter, null)
    await assert.rejects(h.service.updateSettings('default', { ollamaEndpoint: 'http://evil.example:11434' }), /AI_BLOCKED_HOST/)
  } finally { await h.cleanup() }
})

test('the key is sealed, never returned, never in meta/backup/activity/local API/logs/errors', async () => {
  const h = await setup()
  try {
    const result = await h.service.setKey('default', 'openrouter', `  ${KEY}  `)
    assert.deepEqual(result, { configured: true, last4: KEY.slice(-4), storage: 'keychain' })
    await assert.rejects(h.service.setKey('default', 'openrouter', 'short'), /AI_KEY_INVALID_FORMAT/)
    const settings = await h.service.getSettings('default')
    assert.deepEqual(settings.keys.openrouter, { configured: true, last4: KEY.slice(-4), storage: 'keychain' })
    assert.equal(JSON.stringify(settings).includes(KEY), false)
    assert.equal(JSON.stringify(await h.service.status('default')).includes(KEY), false)
    // Disco: arquivo cifrado (Keychain + camada do espaço); nada no meta.
    await drain()
    for (const name of await fs.readdir(h.dataDir)) {
      const stat = await fs.stat(path.join(h.dataDir, name))
      if (stat.isFile()) { const raw = await fs.readFile(path.join(h.dataDir, name)); assert.equal(raw.includes(Buffer.from(KEY)), false, name); assert.equal(raw.includes(Buffer.from(KEY.slice(4, 20))), false, name) }
    }
    assert.equal(JSON.stringify(await h.store.loadMeta()).includes(KEY), false)
    // Uso real: só no cabeçalho da chamada ao provedor.
    await h.service.setConsent('default', 'openrouter', true)
    await h.service.updateSettings('default', { activeProvider: 'openrouter', models: { openrouter: 'openai/gpt-4o-mini' } })
    const preview = await h.service.prepare('default', 7, { feature: 'ask', operation: 'notes', prompt: 'O que decidimos?', sources: sources.slice(0, 1) })
    assert.equal(JSON.stringify(preview).includes(KEY), false)
    const events = []
    const answer = await h.service.run(7, preview.requestId, { confirmed: true }, e => events.push(e))
    assert.equal(answer.text, 'Segundo [1].')
    assert.equal(JSON.stringify(events).includes(KEY), false); assert.equal(JSON.stringify(answer).includes(KEY), false)
    assert.equal(chatRequests(h.mock)[0].headers.authorization, `Bearer ${KEY}`)
    assert.equal(chatRequests(h.mock)[0].body.includes(KEY), false)
    // Erro do provedor que ecoa a chave: removida da mensagem e do evento.
    h.mock.setMode('401')
    const failing = await h.service.prepare('default', 7, { feature: 'ask', operation: 'notes', prompt: 'x', sources: sources.slice(0, 1) })
    const errEvents = []
    const error = await h.service.run(7, failing.requestId, { confirmed: true }, e => errEvents.push(e)).then(() => null, e => e)
    assert.equal(error.code, 'AI_AUTH'); assert.equal(error.message.includes(KEY), false); assert.equal(JSON.stringify(errEvents).includes(KEY), false)
    const testError = await h.service.test('default', 'openrouter').then(() => null, e => e)
    assert.equal(testError.code, 'AI_AUTH'); assert.equal(String(testError.detail).includes(KEY), false)
    // Backup, atividade e API local.
    const backup = JSON.stringify(await h.store.backup())
    assert.equal(backup.includes(KEY), false); assert.equal(backup.includes('Decidimos usar SQLite'), false)
    const api = await startLocalApi({ storage: h.store, token: 'tkn' })
    try {
      const events = await (await fetch(`${api.url}/v1/events`, { headers: { Authorization: 'Bearer tkn' } })).text()
      const pages = await (await fetch(`${api.url}/v1/pages`, { headers: { Authorization: 'Bearer tkn' } })).text()
      assert.equal(events.includes(KEY) || pages.includes(KEY), false)
      assert.match(events, /ai\.cloud\.request/); assert.equal(events.includes('SQLite'), false)
    } finally { await api.close() }
    assert.equal(h.logs.join('\n').includes(KEY), false)
    await h.service.removeKey('default', 'openrouter')
    assert.deepEqual((await h.service.getSettings('default')).keys.openrouter, { configured: false })
  } finally { await h.cleanup() }
})

test('no cloud call leaves without consent, key, or when "Block cloud providers" is on', async () => {
  const h = await setup()
  try {
    await h.service.updateSettings('default', { activeProvider: 'openrouter', models: { openrouter: 'openai/gpt-4o-mini' } })
    await assert.rejects(h.service.prepare('default', 1, { operation: 'summarize', prompt: 'x', sources: sources.slice(0, 1) }), /AI_CONSENT_REQUIRED/)
    await h.service.setConsent('default', 'openrouter', true)
    await assert.rejects(h.service.prepare('default', 1, { operation: 'summarize', prompt: 'x', sources: sources.slice(0, 1) }), /AI_NO_KEY/)
    await h.service.setKey('default', 'openrouter', KEY)
    const preview = await h.service.prepare('default', 1, { operation: 'summarize', prompt: 'x', sources: sources.slice(0, 1) })
    await h.service.updateSettings('default', { blockCloud: true })
    await assert.rejects(h.service.run(1, preview.requestId, { confirmed: true }), /AI_CLOUD_BLOCKED/)
    await assert.rejects(h.service.prepare('default', 1, { operation: 'summarize', prompt: 'x', sources: sources.slice(0, 1) }), /AI_CLOUD_BLOCKED/)
    await assert.rejects(h.service.listModels('default', 'openrouter'), /AI_CLOUD_BLOCKED/)
    await assert.rejects(h.service.test('default', 'google'), /AI_CLOUD_BLOCKED/)
    assert.equal((await h.service.status('default')).openrouter.state, 'blocked')
    assert.equal(h.mock.requests.filter(r => r.url.startsWith('/api/v1') || r.url.startsWith('/v1beta')).length, 0)
    // Revogar o consentimento também impede o envio.
    await h.service.updateSettings('default', { blockCloud: false })
    await h.service.setConsent('default', 'openrouter', false)
    await assert.rejects(h.service.prepare('default', 1, { operation: 'summarize', prompt: 'x', sources: [] }), /AI_CONSENT_REQUIRED/)
    assert.equal(h.mock.requests.filter(r => r.url.startsWith('/api/v1')).length, 0)
  } finally { await h.cleanup() }
})

test('each cloud send needs confirmation of the exact preview; protected, trashed and missing pages are never sent; activity has no content', async () => {
  const h = await setup()
  try {
    await h.service.setKey('default', 'openrouter', KEY); await h.service.setConsent('default', 'openrouter', true)
    await h.service.updateSettings('default', { activeProvider: 'openrouter', models: { openrouter: 'openai/gpt-4o-mini' } })
    const preview = await h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'O que decidimos?', sources })
    assert.equal(preview.needsConfirmation, true); assert.equal(preview.cloud, true); assert.equal(preview.excluded, 6); assert.equal(preview.sources, 1)
    assert.ok(preview.tokens > 10)
    const text = JSON.stringify(preview.messages)
    for (const secret of ['TRASHED-SECRET', 'TRASHED-CHILD-SECRET', 'PROTECTED-SECRET', 'PROTECTED-CHILD-SECRET', 'VAULT-REGISTERED-SECRET', 'MISSING-SECRET']) assert.equal(text.includes(secret), false, secret)
    await assert.rejects(h.service.run(3, preview.requestId, {}), /AI_CONFIRMATION_REQUIRED/)
    assert.equal(chatRequests(h.mock).length, 0)
    await assert.rejects(h.service.run(3, preview.requestId, { confirmed: true }), /AI_EXPIRED/, 'a refused request cannot be replayed')
    const again = await h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'O que decidimos?', sources })
    await assert.rejects(h.service.run(99, again.requestId, { confirmed: true }), /AI_EXPIRED/, 'another window cannot run it')
    const third = await h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'O que decidimos?', sources })
    const events = []
    await h.service.run(3, third.requestId, { confirmed: true }, e => events.push(e))
    assert.deepEqual(events.map(e => e.type), ['delta', 'done'])
    const sent = JSON.parse(chatRequests(h.mock)[0].body)
    assert.deepEqual(sent.messages, third.messages)
    // Só protegidas/lixeira? Nada a perguntar: recusa sem rede.
    await assert.rejects(h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'x', sources: sources.slice(1) }), /AI_NO_SOURCES/)
    // Uso local por provedor/mês e log de atividade sem conteúdo.
    const usage = (await h.service.getSettings('default')).usage
    const month = Object.values(usage)[0]
    assert.deepEqual(month.openrouter, { requests: 1, promptTokens: 50, completionTokens: 5, estimated: false })
    const activity = await h.store.listActivity()
    assert.equal(activity.length, 1)
    assert.equal(activity[0].action, 'ai.cloud.request'); assert.deepEqual(activity[0].fields, ['openrouter', 'ask', 'tokens:55'])
    assert.equal(JSON.stringify(activity).includes('SQLite'), false); assert.equal(JSON.stringify(activity).includes('decidimos'), false)
    // Sem "perguntar antes": não exige confirmação, mas continua sem as fontes proibidas.
    await h.service.updateSettings('default', { confirmEachSend: { openrouter: false }, redact: true })
    const direct = await h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'Contato?', sources })
    assert.equal(direct.needsConfirmation, false); assert.equal(direct.redacted, true)
    await h.service.run(3, direct.requestId, {})
    const body = chatRequests(h.mock).at(-1).body
    for (const secret of ['ana@example.com', '91234-5678', '1234567890123', 'PROTECTED-SECRET']) assert.equal(body.includes(secret), false, secret)
    assert.match(body, /\[e-mail\]/)
  } finally { await h.cleanup() }
})

test('Ollama stays local: no confirmation, no activity entry, and Ollama "cloud" models are refused', async () => {
  const h = await setup()
  try {
    const preview = await h.service.prepare('default', 5, { feature: 'assistant', operation: 'summarize', prompt: 'Resuma', sources: sources.slice(0, 1) })
    assert.equal(preview.provider, 'ollama'); assert.equal(preview.cloud, false); assert.equal(preview.needsConfirmation, false)
    assert.equal((await h.service.run(5, preview.requestId, {})).text, 'local ok')
    const remote = await h.service.prepare('default', 5, { feature: 'assistant', operation: 'write', prompt: 'x', sources: [], model: 'qwen3:cloud' })
    await assert.rejects(h.service.run(5, remote.requestId, {}), /AI_NOT_FOUND/)
    assert.equal(h.mock.requests.filter(r => r.url === '/api/chat').length, 1)
    assert.equal((await h.store.listActivity()).length, 0)
    assert.equal((await h.service.status('default')).ollama.state, 'ready')
    // Provedor por recurso: resumo local mesmo com nuvem ativa.
    await h.service.updateSettings('default', { activeProvider: 'openrouter', featureProviders: { assistant: 'ollama' } })
    assert.equal((await h.service.prepare('default', 5, { feature: 'assistant', operation: 'write', prompt: 'x', sources: [] })).provider, 'ollama')
    await assert.rejects(h.service.prepare('default', 5, { feature: 'ask', operation: 'notes', prompt: 'x', sources: sources.slice(0, 1) }), /AI_CONSENT_REQUIRED/)
  } finally { await h.cleanup() }
})

test('index and chat history persist encrypted with the workspace codec', async () => {
  const h = await setup()
  try {
    await h.service.saveFile('default', 'index', { version: 1, pages: { [P(1)]: { chunks: [{ text: 'INDEX-PLAINTEXT-MARKER' }] } } })
    await h.service.saveFile('default', 'chats', [{ id: 'c', messages: [{ role: 'user', content: 'CHAT-PLAINTEXT-MARKER' }] }])
    await drain()
    for (const [name, marker] of [['ai-index.json', 'INDEX-PLAINTEXT-MARKER'], ['ai-chats.json', 'CHAT-PLAINTEXT-MARKER']]) assert.equal((await fs.readFile(path.join(h.dataDir, name))).includes(Buffer.from(marker)), false, name)
    assert.equal((await h.service.loadFile('default', 'index')).pages[P(1)].chunks[0].text, 'INDEX-PLAINTEXT-MARKER')
    await assert.rejects(h.service.loadFile('default', 'config'), /AI_BAD_REQUEST/)
  } finally { await h.cleanup() }
})

test('redaction hides e-mails, phones and long numbers but keeps ordinary text and dates', () => {
  const out = redact('Fale com joao.silva@empresa.com.br ou (11) 98765-4321 / +1 415 555 0100. CPF 123.456.789-09, cartão 4111 1111 1111 1111. Reunião em 2026-10-08, 3 itens.')
  for (const secret of ['joao.silva@empresa.com.br', '98765-4321', '415 555 0100', '123.456.789-09', '4111 1111 1111 1111']) assert.equal(out.includes(secret), false, secret)
  assert.match(out, /2026-10-08/); assert.match(out, /3 itens/)
})

test('"Privado para IA" (A1): páginas marcadas e suas subpáginas nunca vão para a nuvem, mas o Ollama local continua vendo', async () => {
  const h = await setup()
  try {
    await h.store.mutateMeta(current => ({ ...current, pages: { ...current.pages, [P(1)]: { ...current.pages[P(1)], aiPrivate: true }, [P(7)]: page(P(7), { title: 'Filha privada', parentId: P(1) }) } }))
    const privateChild = { pageId: P(7), title: 'Filha', text: 'PRIVATE-CHILD-SECRET' }
    await h.service.setKey('default', 'openrouter', KEY); await h.service.setConsent('default', 'openrouter', true)
    await h.service.updateSettings('default', { activeProvider: 'openrouter', models: { openrouter: 'openai/gpt-4o-mini' } })
    // A única fonte que passaria nas outras regras era privada: nada a enviar.
    await assert.rejects(h.service.prepare('default', 3, { feature: 'ask', operation: 'notes', prompt: 'x', sources: [...sources, privateChild] }), /AI_NO_SOURCES/)
    const write = await h.service.prepare('default', 3, { feature: 'assistant', operation: 'write', prompt: 'x', sources: [privateChild, { pageId: P(1), title: 'Projeto', text: 'PRIVATE-ROOT-SECRET' }] })
    assert.equal(write.cloud, true); assert.equal(write.sources, 0); assert.equal(write.excluded, 2)
    assert.equal(/PRIVATE-(CHILD|ROOT)-SECRET/.test(JSON.stringify(write.messages)), false)
    await h.service.updateSettings('default', { activeProvider: 'ollama' })
    const local = await h.service.prepare('default', 3, { feature: 'assistant', operation: 'write', prompt: 'x', sources: [privateChild] })
    assert.equal(local.cloud, false); assert.equal(local.sources, 1); assert.equal(JSON.stringify(local.messages).includes('PRIVATE-CHILD-SECRET'), true, 'IA local pode ler')
  } finally { await h.cleanup() }
})

test('embeddings (A3b): Automático = Ollama com modelo -> Apple -> nenhum; modos forçados e desligado; nada vai à rede', async () => {
  const calls = []
  const native = { runHelper: async (args, input, options) => {
    calls.push({ args, input, options })
    if (args.includes('--status')) return { available: true, dimension: 3, model: 'apple-nl-contextual' }
    return { vectors: input.texts.map(text => [text.length, 1, 0]), dimension: 3 }
  } }
  const h = await setup({ native })
  try {
    // O Ollama simulado só tem llama/qwen: sem modelo de embeddings, cai na Apple.
    let status = await h.service.embedStatus('default')
    assert.equal(status.mode, 'auto'); assert.equal(status.backend, 'apple'); assert.equal(status.ollama.available, false); assert.equal(status.model, 'apple-nl-contextual')
    assert.deepEqual(await h.service.embed('default', ['ab', 'abcd']), [[2, 1, 0], [4, 1, 0]])
    const embedCall = calls.find(call => !call.args.includes('--status'))
    assert.deepEqual(embedCall.args, ['embed']); assert.equal(embedCall.options.niceness, 10, 'baixa prioridade')
    assert.equal(h.mock.requests.some(r => r.url === '/api/embed'), false, 'Apple não toca o Ollama')
    // Ollama com o modelo de embeddings => vence a Apple.
    await h.service.updateSettings('default', { embeddingModel: 'llama3.2:3b' })
    assert.equal((await h.service.embedStatus('default')).backend, 'ollama')
    await h.service.updateSettings('default', { embeddingModel: 'nomic-embed-text' })
    // Forçar Ollama sem o modelo: nenhum (não cai na Apple escondido).
    await h.service.updateSettings('default', { embeddingBackend: 'ollama' })
    status = await h.service.embedStatus('default'); assert.equal(status.backend, 'none')
    await assert.rejects(h.service.embed('default', ['x']), /AI_NO_EMBEDDING/)
    await h.service.updateSettings('default', { embeddingBackend: 'off' })
    assert.equal((await h.service.embedStatus('default')).backend, 'none')
    await h.service.updateSettings('default', { embeddingBackend: 'apple' })
    assert.equal((await h.service.embedStatus('default')).backend, 'apple')
    await h.service.updateSettings('default', { embeddingBackend: 'invalido' })
    assert.equal((await h.service.getSettings('default')).embeddingBackend, 'apple', 'valor inválido é ignorado')
    await assert.rejects(h.service.embed('default', []), /AI_BAD_REQUEST/)
  } finally { await h.cleanup() }
})

test('embeddings (A3b): helper ausente ou macOS antigo vira "nenhum" sem erro; download só quando pedido', async () => {
  const calls = []
  const old = { runHelper: async args => { calls.push(args); if (args.includes('--download')) return { available: true, dimension: 3 }; return { available: false, reason: 'ASSETS_MISSING' } } }
  const h = await setup({ native: old })
  try {
    let status = await h.service.embedStatus('default')
    assert.equal(status.backend, 'none'); assert.equal(status.apple.reason, 'ASSETS_MISSING')
    assert.equal(calls.some(args => args.includes('--download')), false, 'não baixa sozinho')
    status = await h.service.embedStatus('default', { download: true })
    assert.equal(status.backend, 'apple'); assert.ok(calls.some(args => args.includes('--download')))
  } finally { await h.cleanup() }
  const missing = { runHelper: async () => { const e = new Error('NATIVE_HELPER_MISSING'); e.code = 'NATIVE_HELPER_MISSING'; throw e } }
  const g = await setup({ native: missing })
  try {
    const status = await g.service.embedStatus('default')
    assert.equal(status.backend, 'none'); assert.equal(status.apple.reason, 'NATIVE_HELPER_MISSING')
  } finally { await g.cleanup() }
})
