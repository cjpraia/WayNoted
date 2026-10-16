const PRODUCT = require('../shared/product.json')
// A2 — CLI `workspace`, ferramentas novas do MCP, rotas de tarefas/nota diária/consulta/tipos e busca pelo índice,
// contra um espaço temporário e a API local real (loopback). Nada toca os dados do usuário.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkspaceStorage } = require('../electron/workspace-storage.cjs')
const { startLocalApi } = require('../electron/local-api.cjs')
const { createAgentAccess } = require('../electron/agent-access.cjs')
const { createMcpHandler } = require('../electron/mcp-server.cjs')
const { createSearchIndex } = require('../electron/content-index.cjs')
const cli = require('../electron/cli.cjs')
const connector = require('../electron/agent-connector.cjs')

const page = (id, extra = {}) => ({ id, title: 'Página ' + id.slice(0, 4), parentId: null, locked: false, createdAt: 1, updatedAt: 1, order: 0, text: '', props: {}, ...extra })
const para = text => ({ id: randomUUID(), type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })

async function workspace(fn, meta = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-cli-test-"))
  const store = createWorkspaceStorage(dir)
  await store.saveMeta({ pages: {}, settings: { locale: 'pt-BR' }, ...meta })
  const access = createAgentAccess({ directory: dir })
  await access.load()
  const { client, token } = await access.createClient({ name: 'CLI de teste', scopes: ['read', 'write'] })
  await access.updateClient(client.id, { autoWrite: true })
  const service = await startLocalApi({ storage: store, token: 'x', access, onChange: () => {} })
  await fs.writeFile(path.join(dir, 'api-token.json'), JSON.stringify({ token, port: Number(new URL(service.url).port) }))
  const run = async (...argv) => {
    let out = '', err = ''
    const code = await cli.run(argv, { env: { WORKSPACE_DATA_DIR: dir, WORKSPACE_LANG: 'pt' }, stdout: { write: text => { out += text } }, stderr: { write: text => { err += text } }, stdin: (async function* () { yield Buffer.from('texto da entrada\nsegunda linha') })() })
    return { code, out, err }
  }
  try { await fn({ dir, store, service, run, token, access }) } finally { await service.close(); await access.flush(); await fs.rm(dir, { recursive: true, force: true }) }
}

test('CLI: lê a conexão do api-token.json, cria/anexa/lê páginas e busca', async () => workspace(async ({ run, store }) => {
  const help = await run('help'); assert.equal(help.code, 0); assert.match(help.out, /workspace <comando>/)
  const created = await run('page', 'create', 'Ideias do dia', '--text', '# Título\n- item\n[ ] tarefa')
  assert.equal(created.code, 0, created.err)
  const id = created.out.split(/\s+/)[0]
  const meta = await store.loadMeta()
  assert.equal(meta.pages[id].title, 'Ideias do dia')
  const got = await run('page', 'get', id)
  assert.match(got.out, /# Ideias do dia/); assert.match(got.out, /\[ \] tarefa/); assert.match(got.out, /• item/)
  const appended = await run('page', 'append', id, '-')
  assert.equal(appended.code, 0, appended.err)
  assert.match((await run('page', 'get', id)).out, /segunda linha/)
  assert.match((await run('search', 'ideias')).out, new RegExp(id))
  assert.match((await run('search', 'inexistente-xyz')).out, /Nada encontrado/)
  const json = JSON.parse((await run('--json', 'search', 'ideias')).out)
  assert.equal(json.results[0].id, id)
  assert.match((await run('whoami')).out, /CLI de teste/)
}))

test('CLI: nota diária, tarefas, consulta e tipos', async () => workspace(async ({ run, store }) => {
  const added = await run('daily', '2026-10-08', '--append', '[ ] ligar para o banco')
  assert.equal(added.code, 0, added.err); assert.match(added.out, /nota criada/)
  const read = await run('daily', '2026-10-08'); assert.equal(read.err, ''); assert.match(read.out, /# 8 de outubro de 2026/); assert.match(read.out, /ligar para o banco/)
  assert.match((await run('daily', '2030-01-01')).out, /Não há nota diária/)
  const meta = await store.loadMeta()
  assert.ok(meta.settings.dailyFlow.databaseId, 'o banco "Notas diárias" foi criado e registrado')
  const again = await run('daily', '2026-10-08', '--append', 'segunda anotação'); assert.doesNotMatch(again.out, /nota criada/)
  assert.equal(Object.values((await store.loadMeta()).pages).filter(p => p.parentId === meta.settings.dailyFlow.databaseId).length, 1, 'uma nota por dia')
  const notePage = await run('page', 'create', 'Projeto X')
  const projectId = notePage.out.split(/\s+/)[0]
  assert.equal((await run('tasks', 'add', 'revisar contrato', '--due', '2026-10-01', '--page', projectId)).code, 0)
  const overdue = await run('--json', 'tasks', 'overdue'); assert.equal(overdue.code, 0)
  const tasks = JSON.parse(overdue.out).tasks
  assert.ok(tasks.some(task => task.title === 'revisar contrato' && task.due === '2026-10-01' && task.page === 'Projeto X'))
  assert.ok(!tasks.some(task => task.title === 'ligar para o banco') || JSON.parse(overdue.out).today > '2026-10-08')
  const today = JSON.parse((await run('--json', 'tasks', 'all')).out).tasks
  assert.ok(today.some(task => task.title === 'ligar para o banco' && task.due === '2026-10-08' && task.inherited), 'tarefa na nota diária herda o dia')
  const query = await run('query', 'lista de todas as páginas onde título contém "Projeto"')
  assert.equal(query.code, 0, query.err); assert.match(query.out, /1 resultado/); assert.match(query.out, /Projeto X/)
  const bad = await run('query', 'isto não é uma consulta ((('); assert.equal(bad.code, 2)
  assert.match((await run('types', 'list')).out, /Nenhum tipo/)
}))

test('CLI: erros claros (app fechado, comando desconhecido, aprovação)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-cli-err-"))
  try {
    const run = async (...argv) => { let err = ''; const code = await cli.run(argv, { env: { WORKSPACE_DATA_DIR: dir, WORKSPACE_LANG: 'en' }, stdout: { write() {} }, stderr: { write: text => { err += text } } }); return { code, err } }
    assert.match((await run('search', 'x')).err, /Local API not found/)
    await fs.writeFile(path.join(dir, 'api-token.json'), JSON.stringify({ token: 't', port: 1 }))
    assert.match((await run('search', 'x')).err, new RegExp(`Could not reach ${PRODUCT.name}`, ""))
    assert.match((await run('frobnicate')).err, /Unknown command/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('MCP: ferramentas de tarefas, nota diária, consulta e tipos chamam as rotas certas', async () => {
  const calls = []
  const handler = createMcpHandler({ baseURL: 'http://127.0.0.1:32123', token: 'tk', fetcher: async (url, init) => { calls.push({ url, init }); return { ok: true, headers: new Map(), json: async () => ({ ok: 1 }) } } })
  await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  const tools = (await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools
  for (const name of ['list_tasks', 'add_task', 'get_daily_note', 'append_to_daily', 'append_to_page', 'run_query', 'list_types']) assert.ok(tools.some(tool => tool.name === name), name)
  const readOnly = new Set(tools.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name))
  for (const name of ['add_task', 'append_to_daily', 'append_to_page', 'create_page', 'replace_blocks', 'update_page', 'update_row_properties']) assert.ok(!readOnly.has(name), `${name} é escrita`)
  for (const name of ['list_tasks', 'get_daily_note', 'run_query', 'list_types', 'search_pages']) assert.ok(readOnly.has(name), `${name} é leitura`)
  const call = (name, args) => handler({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call', params: { name, arguments: args } })
  const pageId = randomUUID()
  await call('list_tasks', { bucket: 'overdue' }); assert.match(calls.at(-1).url, /\/v1\/tasks\?bucket=overdue$/)
  await call('add_task', { title: 'x', due: '2026-10-08' }); assert.equal(calls.at(-1).init.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { title: 'x', due: '2026-10-08' })
  await call('get_daily_note', {}); assert.match(calls.at(-1).url, /\/v1\/daily\/today$/)
  await call('append_to_daily', { text: 'oi', date: '2026-10-08' }); assert.match(calls.at(-1).url, /\/v1\/daily\/2026-10-08\/append$/)
  await call('append_to_page', { pageId, text: 'oi' }); assert.match(calls.at(-1).url, new RegExp(`/v1/pages/${pageId}/append$`))
  await call('run_query', { text: 'table from all pages' }); assert.match(calls.at(-1).url, /\/v1\/query$/); assert.equal(JSON.parse(calls.at(-1).init.body).text, 'table from all pages')
  await call('list_types', {}); assert.match(calls.at(-1).url, /\/v1\/types$/)
})

test('MCP contra a API real: escrita rejeitada vira erro legível para o agente', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-test-"))
  const store = createWorkspaceStorage(dir); await store.saveMeta({ pages: {}, settings: {} })
  let access
  access = createAgentAccess({ directory: dir, notify: event => { if (event.type === 'pending') setImmediate(() => access.decide(event.approval.id, 'reject')) } })
  await access.load()
  const { token } = await access.createClient({ name: 'Claude', scopes: ['read', 'write'] })
  const service = await startLocalApi({ storage: store, token: 'x', access, onChange: () => {} })
  try {
    const handler = createMcpHandler({ baseURL: service.url, token })
    await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const result = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_page', arguments: { title: 'Vetada' } } })
    assert.equal(result.result.isError, true)
    const body = JSON.parse(result.result.content[0].text)
    assert.equal(body.code, 'APPROVAL_REJECTED'); assert.match(body.error, /Nada foi gravado/)
    assert.equal(Object.keys((await store.loadMeta()).pages).length, 0)
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('/v1/search usa o índice: filtros, ordem (título primeiro), limit e rapidez com 10 mil páginas', () => {
  const pages = {}
  for (let i = 0; i < 10000; i++) pages['p' + i] = { id: 'p' + i, title: 'Página ' + i, text: 'conteúdo lorem ipsum dolor sit amet '.repeat(10) + i, updatedAt: 1, props: { a: 'valor' + i, n: i } }
  pages.alvo = { id: 'alvo', title: 'Relatório', text: 'texto', updatedAt: 1 }
  pages.corpo = { id: 'corpo', title: 'Outra', text: 'tem um relatório no corpo', updatedAt: 1 }
  pages.lixo = { id: 'lixo', title: 'Relatório antigo', text: '', updatedAt: 1, trashed: true }
  const index = createSearchIndex()
  index.search(pages, 'aquecer')
  const started = performance.now()
  const hits = index.search(pages, 'relatorio')
  const elapsed = performance.now() - started
  assert.deepEqual(hits.map(page => page.id), ['alvo', 'corpo'], 'título primeiro, lixeira fora, sem acento')
  assert.ok(elapsed < 50, `10 mil páginas em ${elapsed.toFixed(1)} ms`)
  assert.equal(index.search(pages, 'lorem ipsum', { limit: 5 }).length, 5)
  assert.equal(index.search(pages, 'valor7777 pagina').length, 1, 'todas as palavras, inclusive valores de propriedades')
  pages.alvo = { ...pages.alvo, title: 'Mudou', updatedAt: 2 }
  assert.deepEqual(index.search(pages, 'relatorio').map(page => page.id), ['corpo'], 'índice acompanha edições')
})

test('conector: trechos de configuração MCP e link simbólico só no ~/.local/bin, sem tocar arquivos alheios', { skip: process.platform === 'win32' ? 'POSIX symlink integration; Windows PATH is covered separately' : false }, async () => {
  const snippets = connector.connectorSnippets({ command: `/Applications/${PRODUCT.name}.app/Contents/Resources/bin/workspace`, args: ['mcp'] })
  const parsed = JSON.parse(snippets.json)
  assert.deepEqual(parsed.mcpServers.workspace, { command: `/Applications/${PRODUCT.name}.app/Contents/Resources/bin/workspace`, args: ['mcp'] })
  assert.match(snippets.claudeCode, new RegExp(`^claude mcp add workspace -- \\/Applications\\/${PRODUCT.name}\\.app\\/Contents\\/Resources\\/bin\\/workspace mcp$`, ""))
  assert.deepEqual(JSON.parse(connector.connectorSnippets({ command: 'c', token: 'nps_abc' }).json).mcpServers.workspace.env, { WORKSPACE_API_TOKEN: 'nps_abc' })
  assert.match(connector.connectorSnippets({ command: "/Apps/Meu App/workspace" }).claudeCode, /'\/Apps\/Meu App\/workspace'/, 'caminho com espaço é citado')
  assert.equal(connector.cliBinPath({ packaged: false, resourcesPath: '/x' }), null)
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-home-"))
  const bin = path.join(home, 'App', 'Contents', 'Resources', 'bin', "workspace")
  await fs.mkdir(path.dirname(bin), { recursive: true }); await fs.writeFile(bin, '#!/bin/sh\n', { mode: 0o755 })
  try {
    assert.equal((await connector.cliStatus({ binPath: bin, home })).state, 'missing')
    const installed = await connector.installCli({ binPath: bin, home })
    assert.equal(installed.path, path.join(home, '.local', 'bin', "workspace")); assert.equal((await fs.readlink(installed.path)), bin)
    assert.equal((await connector.cliStatus({ binPath: bin, home })).state, 'linked')
    await connector.installCli({ binPath: bin, home }) // idempotente
    await connector.uninstallCli({ binPath: bin, home })
    assert.equal((await connector.cliStatus({ binPath: bin, home })).state, 'missing')
    await fs.writeFile(installed.path, 'meu script')
    await assert.rejects(connector.installCli({ binPath: bin, home }), /CLI_PATH_OCCUPIED/)
    await assert.rejects(connector.uninstallCli({ binPath: bin, home }), /CLI_PATH_OCCUPIED/)
    assert.equal(await fs.readFile(installed.path, 'utf8'), 'meu script', 'arquivo comum nunca é sobrescrito')
    await assert.rejects(connector.installCli({ binPath: null, home }), /CLI_UNAVAILABLE/)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
})

test("o script bin/workspace resolve link simbólico e roda a CLI com o executável do app", { skip: process.platform === 'win32' ? 'POSIX launcher; real Windows launcher is tested in the installed package' : false }, async () => {
  const script = await fs.readFile(path.join(__dirname, '..', 'build', 'bin', "workspace"), 'utf8')
  assert.match(script, /ELECTRON_RUN_AS_NODE=1/); assert.match(script, /Resources\/app\/electron\/cli\.cjs/); assert.match(script, /readlink/)
  const stat = await fs.stat(path.join(__dirname, '..', 'build', 'bin', "workspace"))
  assert.ok(stat.mode & 0o100, 'executável')
  // Simula the application.app: "MacOS/the application" é um shell que imprime os argumentos recebidos.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-bin-"))
  try {
    const contents = path.join(root, 'Desktop.app', 'Contents')
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true }); await fs.mkdir(path.join(contents, 'Resources', 'bin'), { recursive: true }); await fs.mkdir(path.join(contents, 'Resources', 'app', 'electron'), { recursive: true })
    await fs.writeFile(path.join(contents, 'MacOS', 'Desktop'), '#!/bin/sh\necho "RUN_AS_NODE=$ELECTRON_RUN_AS_NODE $@"\n', { mode: 0o755 })
    await fs.writeFile(path.join(contents, 'Resources', 'app', 'electron', 'cli.cjs'), '')
    await fs.copyFile(path.join(__dirname, '..', 'build', 'bin', "workspace"), path.join(contents, 'Resources', 'bin', "workspace")); await fs.chmod(path.join(contents, 'Resources', 'bin', "workspace"), 0o755)
    const link = path.join(root, 'bin-link'); await fs.symlink(path.join(contents, 'Resources', 'bin', "workspace"), link)
    const { execFileSync } = require('node:child_process')
    const out = execFileSync(link, ['search', 'olá'], { encoding: 'utf8' })
    assert.match(out, /RUN_AS_NODE=1 .*cli\.cjs search olá/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
