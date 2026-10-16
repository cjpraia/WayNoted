// B1 — web clipper: pareamento por código, Origin restrito à extensão pareada, token que só CRIA recortes,
// validação rígida (tamanho, URL, vazio), limite de taxa, registro de chamadas e conversor Markdown → blocos.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')
const { createAgentAccess } = require('../electron/agent-access.cjs')
const clip = require('../electron/clip.cjs')

const EXT = 'a'.repeat(32), OTHER = 'b'.repeat(32)
const origin = id => `chrome-extension://${id}`
const page = (id, extra = {}) => ({ id, title: 'Página ' + id.slice(0, 4), parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {}, ...extra })

async function harness(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-clipper-test-"))
  const store = createWorkspaceStorage(dir), changes = []
  const access = createAgentAccess({ directory: dir, testTimeoutMs: 200, notify: () => {} })
  await access.load(); await access.adoptLegacyToken('legacy-token')
  const keep = randomUUID()
  await store.saveMeta({ pages: { [keep]: page(keep, { title: 'Minha nota' }) }, settings: { locale: 'pt-BR' } })
  const service = await startLocalApi({ storage: store, token: 'legacy-token', access, onChange: change => changes.push(change) })
  const call = (route, { token, from, method = 'POST', body, raw } = {}) => fetch(service.url + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(from ? { Origin: from } : {}) },
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: raw ?? JSON.stringify(body ?? {}) }),
  })
  const pair = async (id = EXT) => {
    const { code } = access.startPairing()
    const response = await call('/v1/clip/pair', { from: origin(id), body: { code } })
    return { response, code, token: response.status === 200 ? (await response.json()).token : null }
  }
  try { await fn({ dir, store, access, service, call, pair, keep, changes }) } finally { await service.close(); await access.flush(); await fs.rm(dir, { recursive: true, force: true }) }
}
const sample = { title: 'Um artigo', url: 'https://exemplo.com/artigo?x=1', text: 'Primeiro parágrafo.\n\nSegundo parágrafo.', selection: 'trecho citado' }

test('pareamento: código de uso único, 5 tentativas, expira, só aceita Origin de extensão', async () => harness(async ({ call, access, pair }) => {
  assert.equal((await call('/v1/clip/pair', { from: origin(EXT), body: { code: 'AAAA-AAAA' } })).status, 403, 'sem pareamento ativo')
  const view = access.startPairing()
  assert.match(view.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.equal((await call('/v1/clip/pair', { body: { code: view.code } })).status, 403, 'sem Origin')
  assert.equal((await call('/v1/clip/pair', { from: 'https://evil.example', body: { code: view.code } })).status, 403, 'origem http')
  assert.equal((await call('/v1/clip/pair', { from: origin(EXT), body: { code: 'ZZZZ-ZZZZ' } })).status, 403, 'código errado')
  const ok = await call('/v1/clip/pair', { from: origin(EXT), body: { code: view.code.toLowerCase().replace('-', ' ') } })
  assert.equal(ok.status, 200, 'o código tolera caixa e separador')
  const { token } = await ok.json(); assert.match(token, /^npc_[a-f0-9]{48}$/)
  assert.equal((await call('/v1/clip/pair', { from: origin(EXT), body: { code: view.code } })).status, 403, 'uso único')
  assert.equal(access.pairingState(), null)
  // 5 erros invalidam o código inclusive para quem acerta depois
  const second = access.startPairing()
  for (let i = 0; i < 5; i++) await call('/v1/clip/pair', { from: origin(EXT), body: { code: 'WRONGCODE' } })
  assert.equal((await call('/v1/clip/pair', { from: origin(EXT), body: { code: second.code } })).status, 403)
  // expiração
  const real = Date.now; const t0 = real()
  access.startPairing(); Date.now = () => t0 + 6 * 60 * 1000
  try { assert.equal(access.pairingState(), null) } finally { Date.now = real }
}))

test('o token só aparece no pareamento; o arquivo guarda só o hash; parear de novo troca o token da mesma extensão', async () => harness(async ({ pair, dir, access, call }) => {
  const first = await pair(); assert.equal(first.response.status, 200)
  await access.flush()
  assert.ok(!(await fs.readFile(path.join(dir, 'agent-access.json'), 'utf8')).includes(first.token))
  const second = await pair()
  assert.notEqual(first.token, second.token)
  assert.equal((await call('/v1/clip/whoami', { token: first.token, from: origin(EXT), method: 'GET' })).status, 401, 'token antigo morreu')
  assert.equal((await call('/v1/clip/whoami', { token: second.token, from: origin(EXT), method: 'GET' })).status, 200)
  const clients = await access.listClients()
  assert.equal(clients.filter(client => client.kind === 'clipper').length, 1)
  assert.deepEqual(clients.find(client => client.kind === 'clipper').scopes, ['clip'])
}))

test('recorte: cria a linha em "Recortes da web" com URL e data, corpo em blocos, registro e sem tocar em outras páginas', async () => harness(async ({ pair, call, store, keep, access, changes }) => {
  const { token } = await pair()
  const before = await store.loadMeta()
  const response = await call('/v1/clip', { token, from: origin(EXT), body: { ...sample, markdown: '# Título\n\nTexto **forte** com [link](https://a.example/b).\n\n- um\n- [x] dois\n\n```js\nconst a = 1\n```' } })
  assert.equal(response.status, 201)
  const created = await response.json()
  const meta = await store.loadMeta()
  const database = Object.values(meta.pages).find(item => item.title === 'Recortes da web')
  assert.ok(database?.database && database.parentId === null, 'banco na raiz')
  const row = meta.pages[created.pageId]
  assert.equal(row.parentId, database.id); assert.equal(row.title, 'Um artigo')
  const urlProp = database.database.properties.find(p => p.type === 'url'), dateProp = database.database.properties.find(p => p.type === 'date')
  assert.equal(row.props[urlProp.id], 'https://exemplo.com/artigo?x=1')
  assert.match(row.props[dateProp.id].start, /^\d{4}-\d{2}-\d{2}$/)
  const blocks = await store.loadDoc(created.pageId)
  const types = blocks.map(block => block.type)
  assert.ok(types.includes('heading') && types.includes('quote') && types.includes('codeBlock') && types.includes('bulletListItem') && types.includes('checkListItem'), types.join())
  assert.deepEqual(Object.keys(meta.pages).sort(), Object.keys(before.pages).concat([database.id, created.pageId]).sort(), 'só criou o banco e a linha')
  assert.deepEqual(meta.pages[keep], before.pages[keep], 'outras páginas intactas')
  assert.ok(changes.length >= 1)
  // segundo recorte reutiliza o banco
  await call('/v1/clip', { token, from: origin(EXT), body: sample })
  assert.equal(Object.values((await store.loadMeta()).pages).filter(item => item.title === 'Recortes da web').length, 1)
  await new Promise(resolve => setTimeout(resolve, 20))
  const log = await access.listLog(10)
  assert.ok(log.some(entry => entry.action === 'clip.create' && entry.client === 'Clipper' && entry.result === 'auto'), JSON.stringify(log.map(l => [l.action, l.result])))
  assert.ok(log.some(entry => entry.action === 'clip.pair'))
}))

test('origem: sem Origin, de outra extensão ou http é recusada; token errado 401; cliente comum não usa /v1/clip', async () => harness(async ({ pair, call, access }) => {
  const { token } = await pair()
  assert.equal((await call('/v1/clip', { token, body: sample })).status, 403, 'sem Origin')
  assert.equal((await call('/v1/clip', { token, from: origin(OTHER), body: sample })).status, 403, 'extensão diferente da pareada')
  assert.equal((await call('/v1/clip', { token, from: 'https://exemplo.com', body: sample })).status, 403, 'página web')
  assert.equal((await call('/v1/clip', { token: 'npc_errado', from: origin(EXT), body: sample })).status, 401)
  assert.equal((await call('/v1/clip', { from: origin(EXT), body: sample })).status, 401)
  const { token: agent } = await access.createClient({ name: 'Agente', scopes: ['read', 'write'] })
  assert.equal((await call('/v1/clip', { token: agent, from: origin(EXT), body: sample })).status, 403)
  assert.equal((await call('/v1/clip', { token: 'legacy-token', from: origin(EXT), body: sample })).status, 403)
  const preflight = await call('/v1/clip', { from: origin(EXT), method: 'OPTIONS' })
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin(EXT))
  assert.equal((await call('/v1/clip', { from: 'https://exemplo.com', method: 'OPTIONS' })).status, 403)
  assert.equal((await call('/v1/pages', { token: 'legacy-token', from: origin(EXT), method: 'GET' })).status, 403, 'rotas de agentes continuam fechadas a qualquer Origin')
}))

test('só cria: o token do clipper não lê, edita, apaga nem acessa nenhuma outra rota', async () => harness(async ({ pair, call, keep, store }) => {
  const { token } = await pair()
  for (const [method, route, body] of [['GET', '/v1/pages'], ['GET', `/v1/pages/${keep}`], ['GET', `/v1/pages/${keep}/blocks`], ['POST', '/v1/pages', { title: 'x' }], ['PATCH', `/v1/pages/${keep}`, { title: 'hackeada' }], ['POST', `/v1/pages/${keep}/append`, { text: 'z' }], ['PUT', `/v1/pages/${keep}/blocks`, []], ['POST', '/v1/tasks', { title: 't' }], ['POST', '/v1/query', { text: 'list from all pages' }]]) {
    for (const from of [undefined, origin(EXT)]) {
      const response = await call(route, { token, from, method, body })
      assert.ok([403].includes(response.status), `${method} ${route} ${from ? 'com origem' : ''} → ${response.status}`)
    }
  }
  assert.equal((await store.loadMeta()).pages[keep].title, 'Minha nota')
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), method: 'PATCH', body: sample })).status, 405)
}))

test('validação: tamanho, URL, vazio, JSON e limite de taxa', async () => harness(async ({ pair, call, store }) => {
  const { token } = await pair()
  const send = body => call('/v1/clip', { token, from: origin(EXT), body })
  assert.equal((await send({ ...sample, url: 'javascript:alert(1)' })).status, 400)
  assert.equal((await send({ ...sample, url: 'file:///etc/passwd' })).status, 400)
  assert.equal((await send({ ...sample, url: 'https://user:senha@exemplo.com/' })).status, 400)
  assert.equal((await send({ title: 'x', url: 'https://a.example' })).status, 400, 'sem conteúdo')
  assert.equal((await send({ ...sample, text: 'x'.repeat(clip.LIMITS.text + 1) })).status, 413)
  assert.equal((await send({ ...sample, markdown: 'x'.repeat(clip.LIMITS.markdown + 1) })).status, 413)
  assert.equal((await send({ ...sample, selection: 5 })).status, 400)
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), raw: '{' })).status, 400)
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), raw: JSON.stringify({ ...sample, text: 'y'.repeat(2 * 1024 * 1024 + 10) }) })).status, 413, 'corpo > 2 MB')
  assert.equal((await send([])).status, 400)
  const meta = await store.loadMeta()
  assert.ok(!Object.values(meta.pages).some(item => item.title === 'Recortes da web'), 'nenhuma rejeição cria página')
  const odd = await send({ ...sample, title: '  \u0007Título\n\ncom  espaços  ', image: 'ftp://x/y.png' })
  assert.equal(odd.status, 201); assert.equal((await odd.json()).title, 'Título com espaços')
  let limited = 0
  for (let i = 0; i < 40; i++) if ((await send(sample)).status === 429) limited++
  assert.ok(limited >= 10, `limite de taxa: ${limited}`)
}))

test('revogar corta o clipper; abrir o banco travado impede novos recortes', async () => harness(async ({ pair, call, access, store }) => {
  const { token } = await pair()
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), body: sample })).status, 201)
  const meta = await store.loadMeta(), database = Object.values(meta.pages).find(item => item.title === 'Recortes da web')
  await store.saveMeta({ ...meta, pages: { ...meta.pages, [database.id]: { ...database, locked: true } } }, meta)
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), body: sample })).status, 423)
  await store.saveMeta({ ...(await store.loadMeta()), pages: { ...(await store.loadMeta()).pages, [database.id]: { ...database, locked: false } } }, await store.loadMeta())
  const client = (await access.listClients()).find(item => item.kind === 'clipper')
  await access.revokeClient(client.id)
  assert.equal((await call('/v1/clip', { token, from: origin(EXT), body: sample })).status, 401)
}))

test('conversor Markdown → blocos: estrutura, estilos, links seguros, tabelas, limites', () => {
  const { blocks } = clip.markdownToBlocks('# T1\n## T2\n#### T4\n\nParágrafo com **negrito**, *itálico*, ~~riscado~~ e `código` e [ok](https://a.example) e [mau](javascript:alert(1)) e ![alt](https://i.example/a.png).\nContinua.\n\n> citação\n> segunda linha\n\n1. um\n2. dois\n   - filho\n\n- [ ] a fazer\n- [x] feito\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\n~~~py\nprint(1)\n~~~')
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'heading', 'heading', 'paragraph', 'quote', 'numberedListItem', 'numberedListItem', 'checkListItem', 'checkListItem', 'table', 'divider', 'codeBlock'])
  assert.deepEqual(blocks.slice(0, 3).map(block => block.props.level), [1, 2, 3])
  const p = blocks[3].content
  assert.ok(p.some(n => n.type === 'text' && n.styles.bold && n.text === 'negrito'))
  assert.ok(p.some(n => n.type === 'text' && n.styles.italic)); assert.ok(p.some(n => n.type === 'text' && n.styles.strike)); assert.ok(p.some(n => n.type === 'text' && n.styles.code))
  const links = p.filter(n => n.type === 'link').map(n => n.href)
  assert.deepEqual(links, ['https://a.example', 'https://i.example/a.png'], 'javascript: nunca vira link')
  assert.ok(p.some(n => n.type === 'text' && n.text.includes('mau')), 'texto do link inseguro permanece')
  assert.equal(blocks[6].children[0].type, 'bulletListItem', 'aninhamento por indentação')
  assert.deepEqual(blocks.slice(7, 9).map(block => block.props.checked), [false, true])
  assert.equal(blocks[9].content.headerRows, 1); assert.equal(blocks[9].content.rows.length, 2)
  assert.equal(blocks[11].props.language, 'py')
  const many = clip.markdownToBlocks(Array.from({ length: 2000 }, (_, i) => `par ${i}`).join('\n\n'))
  assert.equal(many.blocks.length, clip.LIMITS.blocks); assert.equal(many.truncated, true)
  assert.ok(blocks.every(block => typeof block.id === 'string'))
  assert.equal(clip.markdownToBlocks('<script>alert(1)</script> <img src=x onerror=1>').blocks[0].content[0].text.includes('<script>'), true, 'HTML vira texto literal, nunca é interpretado')
})
