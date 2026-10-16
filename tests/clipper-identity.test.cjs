const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')
const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
const root = path.join(__dirname, '..', 'clipper')

for (const page of ['popup', 'options']) test(`clipper ${page} loads its shipped scripts and preserves existing pairing after a rename`, async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, page + '.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://extension.example/' })
  try {
    const store = { [COMPAT.clipperStorageKey]: { base: 'http://127.0.0.1:1234', token: 'fixture-token' } }
    dom.window.chrome = { tabs: { query: async () => [] }, runtime: { openOptionsPage() {} }, storage: { local: {
      get(keys, callback) { callback(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, store[key]]))) },
      set(value, callback) { Object.assign(store, value); callback() },
      remove(key, callback) { delete store[key]; callback() },
    } } }
    for (const script of dom.window.document.querySelectorAll('script[src]')) dom.window.eval(fs.readFileSync(path.join(root, script.getAttribute('src')), 'utf8'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(dom.window.document.title, PRODUCT.name + ' Web Clipper')
    assert.ok(dom.window.document.querySelector('h1').textContent.includes(PRODUCT.name))
    assert.equal((await dom.window.WorkspaceClipper.load()).token, 'fixture-token')
    await dom.window.WorkspaceClipper.clear()
    assert.equal((await dom.window.WorkspaceClipper.load()).token, undefined)
  } finally { dom.window.close() }
})
