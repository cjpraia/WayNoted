#!/usr/bin/env node
const PRODUCT = require('../shared/product.json')
// aplicativo CLI (A2): `workspace search|page|daily|tasks|query|types|mcp|whoami`.
// Fala com a API local do app em execução (127.0.0.1, token). No app empacotado roda com o próprio
// Electron em ELECTRON_RUN_AS_NODE (Desktop.app/Contents/Resources/bin/workspace); no repositório,
// `node electron/cli.cjs ...`. Escritas passam pela aprovação do usuário no app (docs/SECURITY.md).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { blockLines } = require('./agent-diff.cjs')

const lang = env => /^(en)/i.test(env.WORKSPACE_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'en' : 'pt'
const tr = (env, pt, en) => lang(env) === 'en' ? en : pt

class CliError extends Error { constructor(message, code = 1) { super(message); this.exitCode = code } }

const HELP = env => tr(env, `${PRODUCT.name} CLI

Uso: workspace <comando> [opções]

  search <texto> [--limit N]            busca páginas
  page get <id>                         mostra a página (texto dos blocos)
  page create <título> [--parent <id>] [--text <texto|->]
  page append <id> <texto|->            anexa texto ao fim da página
  daily [AAAA-MM-DD|hoje] [--append <texto|->]   lê (ou anexa à) nota diária
  tasks today|overdue|upcoming|all      lista tarefas
  tasks add <título> [--due AAAA-MM-DD] [--page <id>]
  query "<consulta>"                    consulta viva (mesma sintaxe do app)
  types list                            tipos de objeto
  whoami                                cliente, escopos e prazo de aprovação
  mcp                                   servidor MCP por stdio

Opções gerais: --json (saída bruta), --url <http://127.0.0.1:porta>, --token <token>, --data-dir <pasta>.
Escritas pedem aprovação no ${PRODUCT.name} (em Configurações → Dados → Agentes você ajusta isso).
O app precisa estar aberto com "API local" ativada. Texto "-" lê da entrada padrão.`, `${PRODUCT.name} CLI

Usage: workspace <command> [options]

  search <text> [--limit N]             search pages
  page get <id>                         show the page (block text)
  page create <title> [--parent <id>] [--text <text|->]
  page append <id> <text|->             append text to the end of the page
  daily [YYYY-MM-DD|today] [--append <text|->]   read (or append to) the daily note
  tasks today|overdue|upcoming|all      list tasks
  tasks add <title> [--due YYYY-MM-DD] [--page <id>]
  query "<query>"                       live query (same syntax as the app)
  types list                            object types
  whoami                                client, scopes and approval timeout
  mcp                                   MCP server over stdio

Global options: --json (raw output), --url <http://127.0.0.1:port>, --token <token>, --data-dir <folder>.
Writes ask for approval in ${PRODUCT.name} (Settings → Data → Agents).
The app must be running with "Local API" enabled. Text "-" reads from standard input.`)

function parseArgs(argv) {
  const positional = [], flags = {}
  const withValue = new Set(['limit', 'parent', 'text', 'append', 'due', 'page', 'url', 'token', 'data-dir', 'date', 'bucket'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break }
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2)
      if (withValue.has(key)) flags[key] = inlineValue ?? argv[++i]
      else flags[key] = inlineValue ?? true
    } else positional.push(arg)
  }
  return { positional, flags }
}

/** Pasta de dados do app: --data-dir, WORKSPACE_DATA_DIR, WORKSPACE_USER_DATA/data ou o padrão do macOS. */
function dataDir(env, flags) {
  env = require('./brand.cjs').legacyEnv({ ...env })
  if (flags['data-dir']) return path.resolve(String(flags['data-dir']))
  if (env.WORKSPACE_DATA_DIR) return path.resolve(env.WORKSPACE_DATA_DIR)
  if (env.WORKSPACE_USER_DATA) return path.join(path.resolve(env.WORKSPACE_USER_DATA), 'data')
  return path.join(require('./brand.cjs').userDataPath(require('./platform.cjs').appDataRoot({ env })), 'data')
}

function connection(env, flags) {
  env = require('./brand.cjs').legacyEnv({ ...env })
  const url = String(flags.url || env.WORKSPACE_API_URL || ''), token = String(flags.token || env.WORKSPACE_API_TOKEN || '')
  if (url && token) return { url, token }
  const file = path.join(dataDir(env, flags), 'api-token.json')
  let stored
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') throw new CliError(tr(env, `API local não encontrada. Abra o ${PRODUCT.name} e ative Configurações → Dados → API local para integrações.`, `Local API not found. Open ${PRODUCT.name} and enable Settings → Data → Local API for integrations.`))
    throw new CliError(tr(env, `Não foi possível ler ${file} (arquivo cifrado?). Copie o token em Configurações e use --url e --token.`, `Could not read ${file} (encrypted?). Copy the token in Settings and use --url and --token.`))
  }
  if (!stored?.token || !stored?.port) throw new CliError(tr(env, `A API local ainda não iniciou. Abra o ${PRODUCT.name} e ative a API local.`, `The local API has not started yet. Open ${PRODUCT.name} and enable the local API.`))
  return { url: url || `http://127.0.0.1:${stored.port}`, token: token || stored.token }
}

async function readStdin(stdin) { const chunks = []; for await (const chunk of stdin) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8') }

async function run(argv, io = {}) {
  const env = io.env ?? process.env, out = io.stdout ?? process.stdout, err = io.stderr ?? process.stderr, fetcher = io.fetcher ?? fetch
  const print = text => out.write(text + '\n')
  const { positional, flags } = parseArgs(argv)
  const [command, sub, ...rest] = positional
  try {
    if (!command || command === 'help' || flags.help || command === '--help') { print(HELP(env)); return 0 }
    if (command === 'mcp') {
      const { url, token } = connection(env, flags)
      require('./mcp-server.cjs').serveStdio({ ...env, WORKSPACE_API_URL: url, WORKSPACE_API_TOKEN: token })
      return null // o servidor mantém o processo vivo
    }
    const { url, token } = connection(env, flags)
    const text = async value => value === '-' ? (await readStdin(io.stdin ?? process.stdin)).replace(/\n$/, '') : String(value ?? '')
    async function call(method, endpoint, body, headers = {}) {
      let response
      try { response = await fetcher(url + endpoint, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) }
      catch (error) { throw new CliError(tr(env, `Não consegui falar com o ${PRODUCT.name} em ${url}: ${error.cause?.code ?? error.message}. Ele está aberto?`, `Could not reach ${PRODUCT.name} at ${url}: ${error.cause?.code ?? error.message}. Is it running?`)) }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const hint = data.code === 'APPROVAL_TIMEOUT' || data.code === 'APPROVAL_REJECTED' ? ' ' + tr(env, `(aprove a alteração no ${PRODUCT.name})`, `(approve the change in ${PRODUCT.name})`) : ''
        throw new CliError(`${data.error ?? response.status}${hint}`, data.code === 'APPROVAL_REJECTED' ? 3 : data.code === 'APPROVAL_TIMEOUT' ? 4 : 2)
      }
      return data
    }
    const show = (data, human) => print(flags.json ? JSON.stringify(data, null, 2) : human(data))
    const day = value => value === undefined ? 'today' : /^(hoje|today)$/i.test(value) ? 'today' : value
    const pageLine = page => `${page.id}  ${page.title || tr(env, 'Sem título', 'Untitled')}`
    const taskLine = task => `${task.due ?? '          '}${task.time ? ' ' + task.time : ''}  ${task.title}  (${task.page})  ${task.id}`

    switch (command) {
      case 'whoami': {
        const data = await call('GET', '/v1/whoami')
        show(data, d => `${d.client}\n${tr(env, 'escopos', 'scopes')}: ${d.scopes.join(', ')}${d.autoWrite ? ' · ' + tr(env, 'escrita automática', 'auto-write') : ''}\n${tr(env, 'prazo de aprovação', 'approval timeout')}: ${d.approvalTimeoutSec} s`)
        return 0
      }
      case 'search': {
        const query = [sub, ...rest].filter(Boolean).join(' ')
        const data = await call('GET', `/v1/search?q=${encodeURIComponent(query)}${flags.limit ? '&limit=' + encodeURIComponent(flags.limit) : ''}`)
        show(data, d => d.results.length ? d.results.map(pageLine).join('\n') : tr(env, 'Nada encontrado.', 'No matches.'))
        return 0
      }
      case 'page': {
        if (sub === 'get') {
          const id = rest[0]; if (!id) throw new CliError(tr(env, 'Informe o id da página.', 'Provide the page id.'))
          const page = await call('GET', `/v1/pages/${encodeURIComponent(id)}`), blocks = await call('GET', `/v1/pages/${encodeURIComponent(id)}/blocks`)
          show({ page, blocks: blocks.results }, d => `# ${d.page.title || tr(env, 'Sem título', 'Untitled')}\n\n${blockLines(d.blocks).join('\n')}`)
          return 0
        }
        if (sub === 'create') {
          const title = rest[0]; if (title === undefined) throw new CliError(tr(env, 'Informe o título.', 'Provide the title.'))
          const created = await call('POST', '/v1/pages', { title, ...(flags.parent ? { parentId: flags.parent } : {}), ...(flags.text !== undefined ? { text: await text(flags.text) } : {}) })
          show(created, pageLine); return 0
        }
        if (sub === 'append') {
          const [id, value] = rest; if (!id || value === undefined) throw new CliError(tr(env, "Uso: workspace page append <id> <texto|->", "Usage: workspace page append <id> <text|->"))
          const data = await call('POST', `/v1/pages/${encodeURIComponent(id)}/append`, { text: await text(value) })
          show(data, d => tr(env, `${d.appended} bloco(s) anexado(s).`, `${d.appended} block(s) appended.`)); return 0
        }
        throw new CliError(tr(env, "Uso: workspace page get|create|append", "Usage: workspace page get|create|append"))
      }
      case 'daily': {
        const date = day(sub)
        if (flags.append !== undefined) {
          const data = await call('POST', `/v1/daily/${encodeURIComponent(date)}/append`, { text: await text(flags.append) })
          show(data, d => tr(env, `${d.appended} bloco(s) anexado(s) à nota de ${d.date}${d.created ? ' (nota criada)' : ''}.`, `${d.appended} block(s) appended to the ${d.date} note${d.created ? ' (note created)' : ''}.`)); return 0
        }
        const data = await call('GET', `/v1/daily/${encodeURIComponent(date)}`)
        show(data, d => d.exists ? `# ${d.page.title}\n\n${blockLines(d.blocks).join('\n')}` : tr(env, `Não há nota diária em ${d.date}.`, `No daily note on ${d.date}.`))
        return 0
      }
      case 'tasks': {
        if (sub === 'add') {
          const title = rest[0]; if (!title) throw new CliError(tr(env, 'Informe o título da tarefa.', 'Provide the task title.'))
          const data = await call('POST', '/v1/tasks', { title, ...(flags.due ? { due: flags.due } : {}), ...(flags.page ? { pageId: flags.page } : {}) })
          show(data, d => tr(env, `Tarefa adicionada (${d.due ?? 'sem data'}) na página ${d.pageId}.`, `Task added (${d.due ?? 'no date'}) to page ${d.pageId}.`)); return 0
        }
        const bucket = sub ?? 'today'
        if (!['today', 'overdue', 'upcoming', 'undated', 'all'].includes(bucket)) throw new CliError(tr(env, "Uso: workspace tasks today|overdue|upcoming|all|add", "Usage: workspace tasks today|overdue|upcoming|all|add"))
        const data = await call('GET', `/v1/tasks?bucket=${bucket}${flags.limit ? '&limit=' + encodeURIComponent(flags.limit) : ''}`)
        show(data, d => d.tasks.length ? d.tasks.map(taskLine).join('\n') : tr(env, 'Nenhuma tarefa.', 'No tasks.')); return 0
      }
      case 'query': {
        const queryText = [sub, ...rest].filter(Boolean).join(' ')
        if (!queryText) throw new CliError(tr(env, 'Informe a consulta entre aspas.', 'Provide the query in quotes.'))
        const data = await call('POST', '/v1/query', { text: queryText, ...(flags.limit ? { limit: Number(flags.limit) } : {}) })
        show(data, d => `${d.total} ${tr(env, 'resultado(s)', 'result(s)')}\n` + d.rows.map(row => `${row.id}  ${row.title}${Object.values(row.fields).some(Boolean) ? '  · ' + Object.entries(row.fields).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}`).join('\n')); return 0
      }
      case 'types': {
        if (sub !== 'list') throw new CliError(tr(env, "Uso: workspace types list", "Usage: workspace types list"))
        const data = await call('GET', '/v1/types')
        show(data, d => d.results.length ? d.results.map(type => `${type.name}  (${type.properties.map(property => property.name).join(', ')})`).join('\n') : tr(env, 'Nenhum tipo de objeto.', 'No object types.')); return 0
      }
      default: throw new CliError(tr(env, `Comando desconhecido: ${command}. Rode "workspace help".`, `Unknown command: ${command}. Run "workspace help".`))
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    err.write(error.message + '\n'); return error.exitCode
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { if (code !== null) process.exitCode = code }, error => { process.stderr.write(String(error?.message ?? error) + '\n'); process.exitCode = 1 })
}
module.exports = { run, parseArgs, connection, dataDir }
