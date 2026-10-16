const PRODUCT = require('../shared/product.json')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHmac } = require('node:crypto')
const { createMcpHandler } = require('../electron/mcp-server.cjs')
const { validWebhookURL, deliverWebhooks } = require('../electron/local-webhooks.cjs')

test('MCP handshake and tool calls stay on the authenticated local API', async () => {
  const calls = []
  const handler = createMcpHandler({ baseURL: 'http://127.0.0.1:32123', token: 'example-token', fetcher: async (url, init) => {
    calls.push({ url, init }); return { ok: true, headers: new Map([['etag', 'version-one']]), json: async () => ({ results: [] }) }
  } })
  assert.equal((await handler({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).error.code, -32002)
  assert.equal((await handler({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).result.protocolVersion, '2025-11-25')
  const list = await handler({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
  assert.deepEqual(list.result.tools.map(tool => tool.name).sort(), ['add_task', 'append_to_daily', 'append_to_page', 'create_page', 'get_blocks', 'get_daily_note', 'get_page', 'get_row_properties', 'list_tasks', 'list_types', 'replace_blocks', 'run_query', 'search_pages', 'update_page', 'update_row_properties'])
  const blocks = await handler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_blocks', arguments: { pageId: '11111111-1111-4111-8111-111111111111' } } })
  assert.equal(JSON.parse(blocks.result.content[0].text).etag, 'version-one')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer example-token')
  assert.equal(calls[0].init.redirect, 'error')
  assert.throws(() => createMcpHandler({ baseURL: 'https://example.com', token: 'example-token' }), /loopback/)
  assert.equal(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
})

test('webhooks only deliver signed local events, retry failure and do not redeliver success', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-hook-test-"))
  const now = Date.now(), event = { id: 'event-1', at: now, action: 'page.updated', pageId: 'p', pageTitle: 'Example', author: 'You' }
  const storage = { directory, listActivity: async () => [event] }
  const settings = { webhooks: [{ id: 'h', url: 'http://127.0.0.1:32124/events', secret: 'local-secret', createdAt: now - 1, enabled: true }] }
  let fail = true, calls = 0
  const fetcher = async (url, init) => {
    calls++; assert.equal(url, settings.webhooks[0].url)
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers['X-Workspace-Signature'], 'sha256=' + createHmac('sha256', 'local-secret').update(init.body).digest('hex'))
    return { ok: !fail, status: fail ? 503 : 200 }
  }
  try {
    assert.equal((await deliverWebhooks(storage, settings, fetcher, now))[0].attempts, 1)
    assert.equal((await deliverWebhooks(storage, settings, fetcher, now + 1000)).length, 0)
    fail = false
    assert.ok((await deliverWebhooks(storage, settings, fetcher, now + 20000))[0].sentAt)
    assert.equal((await deliverWebhooks(storage, settings, fetcher, now + 30000)).length, 0)
    assert.equal(calls, 2)
    for (const url of ['https://example.com', 'http://localhost:3000/', 'http://127.0.0.1:3000@evil.test/']) assert.equal(validWebhookURL(url), false)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
