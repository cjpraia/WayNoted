// A1 — permissões de agentes: escopos, fila de aprovação, prazo, concessão de 1 h, escrita automática,
// "Privado para IA", registro de chamadas e migração do token antigo (API local de verdade, em loopback).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')
const { createAgentAccess } = require('../electron/agent-access.cjs')
const { privateIds, maskMeta } = require('../electron/agent-privacy.cjs')

const page = (id, extra = {}) => ({ id, title: 'Página ' + id.slice(0, 4), parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {}, ...extra })
const para = text => ({ id: randomUUID(), type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })

async function harness(fn, { timeoutMs, auto = false, decide = 'approve' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-agent-test-"))
  const store = createWorkspaceStorage(dir), events = []
  let access
  access = createAgentAccess({ directory: dir, testTimeoutMs: timeoutMs, notify: event => { events.push(event); if (event.type === 'pending' && decide) setImmediate(() => access.decide(event.approval.id, decide)) } })
  await access.load()
  const legacy = await access.adoptLegacyToken('legacy-token')
  const service = await startLocalApi({ storage: store, token: 'legacy-token', access, onChange: () => {} })
  const call = (token, route, options = {}) => fetch(service.url + route, { ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  try { await fn({ dir, store, access, service, call, events, legacy }) } finally { await service.close(); await access.flush(); await fs.rm(dir, { recursive: true, force: true }) }
}

test('migração: o token antigo continua válido com leitura e escrita COM aprovação (não automática)', async () => harness(async ({ access, legacy, call, store }) => {
  assert.equal(legacy.legacy, true); assert.deepEqual(legacy.scopes, ['read', 'write']); assert.equal(legacy.autoWrite, false)
  assert.equal((await access.settings()).legacyNotice, true, 'o usuário é avisado uma vez')
  await access.updateSettings({ legacyNoticeShown: true })
  assert.equal((await access.settings()).legacyNotice, false)
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  assert.equal((await call('legacy-token', '/v1/pages')).status, 200)
  assert.equal((await call('outro-token', '/v1/pages')).status, 401)
}))

test('clientes: o token só aparece ao criar, o arquivo guarda apenas o hash e revogar corta o acesso', async () => harness(async ({ access, dir, call, store }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  const { client, token } = await access.createClient({ name: 'Claude Desktop', scopes: ['read'] })
  assert.match(token, /^nps_[a-f0-9]{48}$/)
  const stored = await fs.readFile(path.join(dir, 'agent-access.json'), 'utf8')
  assert.ok(!stored.includes(token), 'token em claro nunca vai para o disco')
  assert.equal((await call(token, '/v1/pages')).status, 200)
  assert.equal((await access.listClients()).find(item => item.id === client.id).lastUsedAt > 0, true)
  await access.revokeClient(client.id)
  assert.equal((await call(token, '/v1/pages')).status, 401)
}))

test('escopo somente leitura: toda escrita é negada com SCOPE_REQUIRED e nada muda', async () => harness(async ({ access, call, store, events }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  const { token } = await access.createClient({ name: 'Leitor', scopes: ['read'] })
  for (const [method, route, body] of [['POST', '/v1/pages', { title: 'x' }], ['PATCH', `/v1/pages/${id}`, { title: 'y' }], ['POST', `/v1/pages/${id}/append`, { text: 'z' }], ['POST', '/v1/tasks', { title: 't' }], ['POST', '/v1/daily/today/append', { text: 'd' }]]) {
    const response = await call(token, route, { method, body: JSON.stringify(body) })
    assert.equal(response.status, 403, route); assert.equal((await response.json()).code, 'SCOPE_REQUIRED')
  }
  assert.equal(events.filter(event => event.type === 'pending').length, 0, 'nem chega a pedir aprovação')
  assert.equal((await store.loadMeta()).pages[id].title, page(id).title)
  assert.equal((await call(token, '/v1/query', { method: 'POST', body: JSON.stringify({ text: 'list from all pages' }) })).status, 200, 'consulta é leitura')
}))

test('escrita com aprovação: fica pendente com diff, aprovar grava, rejeitar não grava e devolve erro claro', async () => {
  await harness(async ({ access, call, store, events }) => {
    const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} }); await store.saveDoc(id, [para('um')])
    const { token } = await access.createClient({ name: 'Escritor', scopes: ['read', 'write'] })
    const tag = (await call(token, `/v1/pages/${id}/blocks`)).headers.get('etag')
    const next = [para('um'), para('dois')]
    const done = await call(token, `/v1/pages/${id}/blocks`, { method: 'PUT', headers: { 'If-Match': tag }, body: JSON.stringify(next) })
    assert.equal(done.status, 200)
    const pending = events.find(event => event.type === 'pending').approval
    assert.equal(pending.clientName, 'Escritor'); assert.equal(pending.change.kind, 'blocks.replace'); assert.equal(pending.change.diff.added, 1)
    assert.ok(pending.change.diff.ops.some(op => op.t === 'add' && op.text === 'dois'))
    assert.equal((await store.loadDoc(id)).length, 2)
  })
  await harness(async ({ access, call, store }) => {
    const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} }); await store.saveDoc(id, [para('um')])
    const { token } = await access.createClient({ name: 'Escritor', scopes: ['read', 'write'] })
    const tag = (await call(token, `/v1/pages/${id}/blocks`)).headers.get('etag')
    const response = await call(token, `/v1/pages/${id}/blocks`, { method: 'PUT', headers: { 'If-Match': tag }, body: JSON.stringify([para('x')]) })
    assert.equal(response.status, 403); const body = await response.json()
    assert.equal(body.code, 'APPROVAL_REJECTED'); assert.match(body.error, /rejeitada/)
    assert.equal((await store.loadDoc(id)).length, 1, 'nada gravado')
    const created = await call(token, '/v1/pages', { method: 'POST', body: JSON.stringify({ title: 'Nova' }) })
    assert.equal(created.status, 403)
    assert.equal(Object.keys((await store.loadMeta()).pages).length, 1)
  }, { decide: 'reject' })
})

test('prazo: sem resposta a escrita é rejeitada (408 APPROVAL_TIMEOUT) e a fila esvazia', async () => harness(async ({ access, call, store }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  const { token } = await access.createClient({ name: 'Lento', scopes: ['read', 'write'] })
  const response = await call(token, `/v1/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Tarde demais' }) })
  assert.equal(response.status, 408); assert.equal((await response.json()).code, 'APPROVAL_TIMEOUT')
  assert.equal((await store.loadMeta()).pages[id].title, page(id).title)
  assert.equal(access.listPending().length, 0)
}, { timeoutMs: 60, decide: null }))

test('timeout configurável: limitado a 10-300 s e persistido', async () => harness(async ({ access }) => {
  assert.equal((await access.settings()).timeoutSec, 60)
  assert.equal((await access.updateSettings({ timeoutSec: 5 })).timeoutSec, 10)
  assert.equal((await access.updateSettings({ timeoutSec: 9999 })).timeoutSec, 300)
  assert.equal((await access.updateSettings({ timeoutSec: 90 })).timeoutSec, 90)
}))

test('"aprovar tudo deste cliente por 1 h": a próxima escrita não pergunta e a concessão expira', async () => {
  let clock = 1_000_000
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-agent-grant-"))
  const asked = []
  let access
  access = createAgentAccess({ directory: dir, now: () => clock, notify: event => { if (event.type === 'pending') { asked.push(event.approval.id); setImmediate(() => access.decide(event.approval.id, 'approve', { grantHour: asked.length === 1 })) } } })
  try {
    const { client } = await access.createClient({ name: 'Confiável', scopes: ['read', 'write'] })
    assert.equal(await access.requestApproval(client, { kind: 'x' }), 'grant')
    assert.equal(await access.requestApproval(client, { kind: 'x' }), 'grant')
    assert.equal(asked.length, 1)
    clock += 61 * 60 * 1000
    await access.requestApproval(client, { kind: 'x' }).catch(() => {})
    assert.equal(asked.length, 2, 'passada 1 h volta a perguntar')
  } finally { await access.flush(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('escrita automática (opt-in): grava sem fila e o registro marca "auto"', async () => harness(async ({ access, call, store, events }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  const { client, token } = await access.createClient({ name: 'Robô', scopes: ['read', 'write'] })
  await access.updateClient(client.id, { autoWrite: true })
  assert.equal((await call(token, `/v1/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Automático' }) })).status, 200)
  assert.equal(events.filter(event => event.type === 'pending').length, 0)
  assert.equal((await store.loadMeta()).pages[id].title, 'Automático')
  assert.equal((await access.listLog())[0].result, 'auto')
  await access.updateClient(client.id, { scopes: ['read'] })
  assert.equal((await access.listClients()).find(item => item.id === client.id).autoWrite, false, 'tirar a escrita desliga o automático')
}))

test('Privado para IA: a página e as subpáginas somem para busca, leitura, escrita e criação', async () => harness(async ({ access, call, store, dir }) => {
  const root = randomUUID(), child = randomUUID(), open = randomUUID()
  await store.saveMeta({ pages: { [root]: page(root, { title: 'Segredo', text: 'palavra-secreta', aiPrivate: true }), [child]: page(child, { title: 'Filha', parentId: root, text: 'palavra-secreta' }), [open]: page(open, { title: 'Aberta', text: 'palavra-secreta' }) }, settings: {} })
  await store.saveDoc(root, [para('palavra-secreta')]); await store.saveDoc(child, [para('palavra-secreta')])
  const { token } = await access.createClient({ name: 'Leitor', scopes: ['read', 'write'], autoWrite: true })
  await access.updateClient((await access.listClients()).find(c => c.name === 'Leitor').id, { autoWrite: true })
  const found = (await (await call(token, '/v1/search?q=palavra-secreta')).json()).results.map(item => item.id)
  assert.deepEqual(found, [open])
  assert.equal((await (await call(token, '/v1/pages')).json()).results.some(item => item.id === child), false)
  for (const suffix of ['', '/blocks', '/properties']) for (const id of [root, child]) assert.equal((await call(token, `/v1/pages/${id}${suffix}`)).status, 404, `${id}${suffix}`)
  assert.equal((await call(token, `/v1/pages/${root}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) })).status, 404)
  assert.equal((await call(token, `/v1/pages/${child}/append`, { method: 'POST', body: JSON.stringify({ text: 'x' }) })).status, 404)
  assert.equal((await call(token, '/v1/pages', { method: 'POST', body: JSON.stringify({ title: 'Nova', parentId: child }) })).status, 400)
  assert.equal((await call(token, '/v1/query', { method: 'POST', body: JSON.stringify({ text: 'list from all pages' }) }).then(r => r.json())).rows.some(row => row.id === child || row.id === root), false)
  // o disco continua com os dados reais e o flag intacto
  const real = await store.loadMeta()
  assert.equal(real.pages[root].title, 'Segredo'); assert.equal(real.pages[root].aiPrivate, true); assert.equal(real.pages[child].text, 'palavra-secreta')
  // escrever numa página aberta não estraga as privadas
  assert.equal((await call(token, `/v1/pages/${open}`, { method: 'PATCH', body: JSON.stringify({ title: 'Aberta 2' }) })).status, 200)
  const after = await store.loadMeta()
  assert.equal(after.pages[root].title, 'Segredo'); assert.equal(after.pages[child].title, 'Filha'); assert.equal(after.pages[open].title, 'Aberta 2')
  assert.ok(!(await fs.readFile(path.join(dir, 'agent-log.json'), 'utf8').catch(() => '')).includes('palavra-secreta'))
}))

test('privacidade: privateIds herda por ancestral, resiste a ciclos e o esqueleto não vaza texto', () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID()
  const pages = { [a]: page(a, { aiPrivate: true, text: 'x', title: 'T' }), [b]: page(b, { parentId: a }), [c]: page(c, { parentId: b }) }
  assert.deepEqual([...privateIds(pages)].sort(), [a, b, c].sort())
  const cyclic = { [a]: page(a, { parentId: b }), [b]: page(b, { parentId: a, aiPrivate: true }) }
  assert.equal(privateIds(cyclic).size, 2)
  const masked = maskMeta({ pages, settings: {} }).pages[a]
  assert.equal(masked.title, ''); assert.equal(masked.text, ''); assert.equal(masked.trashed, true)
})

test('lousa (U1): o agente não manda para a lixeira uma página com lousa nem apaga o quadro', async () => harness(async ({ access, call, store }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id) }, settings: {} })
  const canvas = { id: 'cv1', type: 'canvas', props: { objects: [{ type: 'note', text: 'n' }] }, children: [] }
  await store.saveDoc(id, [canvas, para('texto')])
  const { client, token } = await access.createClient({ name: 'Robô', scopes: ['read', 'write'] })
  await access.updateClient(client.id, { autoWrite: true })
  const trash = await call(token, `/v1/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
  assert.equal(trash.status, 409); assert.equal((await trash.json()).code, 'CANVAS_PROTECTED')
  assert.ok(!(await store.loadMeta()).pages[id].trashed)
  const tag = (await call(token, `/v1/pages/${id}/blocks`)).headers.get('etag')
  const wipe = await call(token, `/v1/pages/${id}/blocks`, { method: 'PUT', headers: { 'If-Match': tag }, body: '[]' })
  assert.equal(wipe.status, 200)
  assert.equal((await store.loadDoc(id)).some(block => block.type === 'canvas' && block.props.objects.length === 1), true, 'lista vazia não apaga o quadro')
  const forged = await call(token, `/v1/pages/${id}/append`, { method: 'POST', body: JSON.stringify({ blocks: [{ type: 'canvas', props: {} }] }) })
  assert.equal(forged.status, 409)
}))

test('registro de chamadas: quem, o quê, quando e resultado; limpar esvazia', async () => harness(async ({ access, call, store }) => {
  const id = randomUUID(); await store.saveMeta({ pages: { [id]: page(id, { title: 'Alvo' }) }, settings: {} })
  const { token } = await access.createClient({ name: 'Logger', scopes: ['read', 'write'] })
  await call(token, '/v1/search?q=alvo'); await call(token, `/v1/pages/${id}`)
  await call(token, `/v1/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Novo' }) })
  await call('token-ruim', '/v1/pages')
  const log = await access.listLog()
  assert.deepEqual(log.map(entry => entry.action), ['page.update', 'page.read', 'search'])
  assert.equal(log[0].client, 'Logger'); assert.equal(log[0].result, 'approved'); assert.ok(log[0].at > 0)
  assert.equal(log.find(entry => entry.action === 'search').target, 'alvo')
  await access.clearLog()
  assert.deepEqual(await access.listLog(), [])
}))
