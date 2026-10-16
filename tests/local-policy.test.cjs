const COMPAT = require('../shared/compatibility.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { isInternalURL, canRequest } = require('../electron/local-policy.cjs')

test('distributed app loads its own files and in-memory assets without allowing outbound requests', () => {
  const config = { isDev: false, entryFile: '/app/dist/index.html', devURL: 'http://localhost:5310' }
  for (const url of ['file:///app/dist/index.html', 'file:///app/dist/assets/font.woff2', 'data:image/png;base64,AA', 'blob:file:///app/dist/object', 'about:blank', 'about:srcdoc']) assert.equal(canRequest(url, config), true, url)
  for (const url of [COMPAT.record064, 'http://localhost:5310', 'wss://example.com/live', 'file:///private/secret.txt', 'file:///app/dist/../../secret.txt']) assert.equal(canRequest(url, config), false, url)
  assert.equal(isInternalURL('file:///app/dist/index.html#page', config), true)
  assert.equal(isInternalURL('file:///app/dist/assets/other.html', config), false)
  for (const url of ['about:blank', 'about:srcdoc']) assert.equal(isInternalURL(url, config), false, 'In-memory frames do not gain trusted IPC')
  assert.equal(canRequest('about:config', config), false)
})

test('development grants only the exact local origin, including its websocket', () => {
  const config = { isDev: true, entryFile: '/app/dist/index.html', devURL: 'http://localhost:5310' }
  assert.equal(canRequest('ws://localhost:5310/', config), true)
  assert.equal(isInternalURL('http://localhost:5310/page', config), true)
  for (const url of ['http://localhost:53100', 'http://localhost:5310.evil.com', 'http://127.0.0.1:5310', 'https://localhost:5310']) assert.equal(canRequest(url, config), false, url)
})
