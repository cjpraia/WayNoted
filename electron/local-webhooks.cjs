const PRODUCT = require('../shared/product.json')
const { createHmac } = require('node:crypto')
const path = require('node:path')
const { readJson, atomicWrite } = require('./storage.cjs')
function validWebhookURL(value) {
  try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port) && !url.username && !url.password && !url.hash } catch { return false }
}
async function deliverWebhooks(storage, settings, fetcher = fetch, now = Date.now()) {
  const hooks = (settings.webhooks ?? []).filter(hook => hook.enabled && validWebhookURL(hook.url)).slice(0, 10)
  if (!hooks.length) return []
  const file = path.join(storage.directory, 'webhook-deliveries.json')
  const deliveries = await readJson(file) ?? {}, events = (await storage.listActivity()).slice().reverse()
  const results = []
  for (const hook of hooks) {
    let count = 0
    for (const event of events) {
      if (event.at < hook.createdAt) continue
      const key = hook.id + ':' + event.id, previous = deliveries[key]
      if (previous?.sentAt || previous?.nextAttempt > now || count++ >= 4) continue
      const payload = JSON.stringify({ id: event.id, type: event.action, createdAt: event.at, pageId: event.pageId, pageTitle: event.pageTitle, author: event.author, fields: event.fields })
      const attempts = (previous?.attempts ?? 0) + 1
      try {
        const response = await fetcher(hook.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/json', 'X-Workspace-Event': event.id, 'X-Workspace-Signature': 'sha256=' + createHmac('sha256', hook.secret).update(payload).digest('hex') }, body: payload })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        deliveries[key] = { hookId: hook.id, eventId: event.id, attempts, sentAt: now }
      } catch (error) { deliveries[key] = { hookId: hook.id, eventId: event.id, attempts, error: error.message, nextAttempt: now + Math.min(3600000, 5000 * 2 ** Math.min(attempts, 9)) } }
      results.push(deliveries[key])
    }
  }
  if (results.length) {
    const eventIds = new Set(events.map(event => event.id)), hookIds = new Set((settings.webhooks ?? []).map(hook => hook.id))
    const keep = Object.entries(deliveries).filter(([, value]) => eventIds.has(value.eventId) && hookIds.has(value.hookId))
    await atomicWrite(file, JSON.stringify(Object.fromEntries(keep)))
  }
  return results
}
module.exports = { validWebhookURL, deliverWebhooks }
