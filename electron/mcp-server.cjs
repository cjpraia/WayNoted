#!/usr/bin/env node
const PRODUCT = require('../shared/product.json')
const readline = require('node:readline')
const properties = { pageId: { type: 'string', description: 'Local page UUID' } }
const tool = (name, description, extra, required, readOnly = true) => ({ name, description, inputSchema: { type: 'object', properties: extra, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false } })
const TOOLS = [
  tool('search_pages', `Search pages in this local ${PRODUCT.name} workspace.`, { query: { type: 'string' } }, []),
  tool('get_page', 'Read local page metadata.', properties, ['pageId']),
  tool('get_blocks', 'Read page blocks and the ETag needed for a safe replacement. A whiteboard (canvas, "lousa") comes back as one opaque block with a summary (object count, title), never the whole scene.', properties, ['pageId']),
  tool('get_row_properties', 'Read a database row schema, values and ETag before editing table properties.', { rowId: { type: 'string', description: 'Database row page UUID' } }, ['rowId']),
  tool('update_row_properties', 'Update editable database row properties. Call get_row_properties first and pass its ETag; select/status values may use option names or IDs.', { rowId: { type: 'string', description: 'Database row page UUID' }, etag: { type: 'string' }, properties: { type: 'object', description: 'Property ID to value map' } }, ['rowId', 'etag', 'properties'], false),
  tool('create_page', 'Create a local page, optionally with initial text. Needs the user approval unless this client is automatic.', { title: { type: 'string' }, parentId: { type: 'string' }, text: { type: 'string' } }, ['title'], false),
  tool('update_page', 'Rename, favorite or move a live page into trash. Restore trashed pages in the desktop app.', { ...properties, title: { type: 'string' }, favorite: { type: 'boolean' }, trashed: { type: 'boolean' } }, ['pageId'], false),
  tool('list_tasks', 'List tasks (checklist items and dated database rows). bucket: today, overdue, upcoming, undated or all.', { bucket: { type: 'string', enum: ['today', 'overdue', 'upcoming', 'undated', 'all'] }, limit: { type: 'number' } }, []),
  tool('add_task', 'Add a task. Without pageId it goes to the daily note of "due" (default: today), creating the note if needed. Needs the user approval unless this client is automatic.', { title: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, pageId: { type: 'string', description: 'Append to this page instead of the daily note' } }, ['title'], false),
  tool('get_daily_note', 'Read the daily note of a date (YYYY-MM-DD or "today"). Returns exists:false when there is none.', { date: { type: 'string' } }, []),
  tool('append_to_daily', 'Append text to the daily note of a date (default today), creating it from the template if needed. Lines like "[ ] task", "- item", "# heading" become blocks.', { date: { type: 'string' }, text: { type: 'string' } }, ['text'], false),
  tool('append_to_page', 'Append text to the end of a page without replacing its content (no ETag needed). Lines like "[ ] task", "- item", "# heading" become blocks.', { ...properties, text: { type: 'string' } }, ['pageId', 'text'], false),
  tool('run_query', `Run a live query written in the ${PRODUCT.name} query text language (pt-BR or en-US), e.g. \`lista de tarefas onde vencimento < hoje\` or \`table from all pages where edited >= last 7 days\`.`, { text: { type: 'string' }, limit: { type: 'number' } }, ['text']),
  tool('list_types', 'List the object types (supertags) of this workspace with their fields.', {}, []),
  tool('replace_blocks', 'Replace page blocks, requiring the ETag from get_blocks. Locked or changed pages reject the update. Canvas blocks are preserved untouched (an empty list does not erase them); writing a canvas scene fails with CANVAS_PROTECTED.', { ...properties, etag: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } }, ['pageId', 'etag', 'blocks'], false),
]
function createMcpHandler({ baseURL, token, fetcher = fetch }) {
  const url = new URL(baseURL)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !token) throw new Error(`Set WORKSPACE_API_URL to the loopback URL shown in ${PRODUCT.name} and WORKSPACE_API_TOKEN to its token.`)
  let initialized = false
  const requests = new Map()
  return async message => {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } }
    if (message.method === 'notifications/cancelled') { requests.get(message.params?.requestId)?.abort(); return null }
    if (message.id === undefined) return null
    const reply = result => ({ jsonrpc: '2.0', id: message.id, result })
    const error = (code, text) => ({ jsonrpc: '2.0', id: message.id, error: { code, message: text } })
    if (message.method === 'initialize') { initialized = true; return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: "workspace-local", version: '1.1.0' } }) }
    if (message.method === 'ping') return reply({})
    if (!initialized) return error(-32002, 'Initialize the connection first')
    if (message.method === 'tools/list') return reply({ tools: TOOLS })
    if (message.method !== 'tools/call') return error(-32601, 'Method not found')
    const name = message.params?.name, args = message.params?.arguments ?? {}, definition = TOOLS.find(item => item.name === name)
    if (!definition) return error(-32602, 'Unknown tool')
    if (!args || typeof args !== 'object' || Array.isArray(args) || definition.inputSchema.required.some(key => args[key] === undefined)) return error(-32602, 'Missing tool arguments')
    if (args.pageId !== undefined && !/^[a-f0-9-]{36}$/i.test(args.pageId)) return error(-32602, 'Invalid page ID')
    if (args.rowId !== undefined && !/^[a-f0-9-]{36}$/i.test(args.rowId)) return error(-32602, 'Invalid row ID')
    if (name === 'update_row_properties' && (!args.properties || typeof args.properties !== 'object' || Array.isArray(args.properties) || !Object.keys(args.properties).length)) return error(-32602, 'Properties must be a non-empty object')
    let endpoint = '/v1/pages', method = 'GET', body, headers = {}
    if (name === 'search_pages') endpoint = '/v1/search?q=' + encodeURIComponent(args.query ?? '')
    if (name === 'get_page' || name === 'update_page') endpoint += '/' + args.pageId
    if (name === 'get_blocks' || name === 'replace_blocks') endpoint += '/' + args.pageId + '/blocks'
    if (name === 'get_row_properties' || name === 'update_row_properties') endpoint += '/' + args.rowId + '/properties'
    if (name === 'create_page') { method = 'POST'; body = { title: args.title, parentId: args.parentId, ...(typeof args.text === 'string' ? { text: args.text } : {}) } }
    if (name === 'list_tasks') endpoint = '/v1/tasks?bucket=' + encodeURIComponent(args.bucket ?? 'all') + (args.limit ? '&limit=' + encodeURIComponent(args.limit) : '')
    if (name === 'add_task') { endpoint = '/v1/tasks'; method = 'POST'; body = { title: args.title, ...(args.due ? { due: args.due } : {}), ...(args.pageId ? { pageId: args.pageId } : {}) } }
    if (name === 'get_daily_note') endpoint = '/v1/daily/' + encodeURIComponent(args.date ?? 'today')
    if (name === 'append_to_daily') { endpoint = '/v1/daily/' + encodeURIComponent(args.date ?? 'today') + '/append'; method = 'POST'; body = { text: args.text } }
    if (name === 'append_to_page') { endpoint += '/' + args.pageId + '/append'; method = 'POST'; body = { text: args.text } }
    if (name === 'run_query') { endpoint = '/v1/query'; method = 'POST'; body = { text: args.text, ...(args.limit ? { limit: args.limit } : {}) } }
    if (name === 'list_types') endpoint = '/v1/types'
    if (name === 'update_page') { method = 'PATCH'; body = { title: args.title, favorite: args.favorite, trashed: args.trashed } }
    if (name === 'replace_blocks') { method = 'PUT'; body = args.blocks; headers['If-Match'] = args.etag }
    if (name === 'get_row_properties') headers['Accept'] = 'application/json'
    if (name === 'update_row_properties') { method = 'PATCH'; body = { properties: args.properties }; headers['If-Match'] = args.etag }
    // Escritas esperam a aprovação do usuário no app (prazo configurável, até 300 s).
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), definition.annotations.readOnlyHint ? 15000 : 330000)
    requests.set(message.id, controller)
    try {
      const response = await fetcher(url.origin + endpoint, { method, redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
      const data = await response.json(), tag = response.headers.get('etag')
      return reply({ content: [{ type: 'text', text: JSON.stringify(tag ? { ...data, etag: tag } : data) }], isError: !response.ok })
    } catch (cause) { return reply({ content: [{ type: 'text', text: cause.message }], isError: true }) }
    finally { clearTimeout(timeout); requests.delete(message.id) }
  }
}
/** Serve o MCP por stdio (uma mensagem JSON por linha). `env` precisa de WORKSPACE_API_URL e WORKSPACE_API_TOKEN. */
function serveStdio(env = process.env) {
  env = require('./brand.cjs').legacyEnv({ ...env })
  try {
    const handler = createMcpHandler({ baseURL: env.WORKSPACE_API_URL, token: env.WORKSPACE_API_TOKEN })
    const input = readline.createInterface({ input: process.stdin })
    input.on('line', line => {
      if (Buffer.byteLength(line) > 16 * 1024 * 1024) { process.stderr.write('Request too large\n'); return }
      let message
      try { message = JSON.parse(line) } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return }
      void handler(message).then(response => { if (response) process.stdout.write(JSON.stringify(response) + '\n') })
    })
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
if (require.main === module) serveStdio()
module.exports = { createMcpHandler, serveStdio, TOOLS }
