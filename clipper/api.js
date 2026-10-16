// Cliente da API local do aplicativo, compartilhado por popup.js e options.js (script comum, sem módulos).
// Regras: só http://127.0.0.1:<porta>; o token do pareamento fica em chrome.storage.local desta extensão e nunca
// é exibido; nenhuma outra URL é contatada. Testado em tests/clipper-extract.test.mts.
;(function (root) {
  'use strict'
  var KEY = "workspace-clipper"
  var legacyKeys = (root.WorkspaceProduct && root.WorkspaceProduct.legacyStorageKeys) || []

  /** Aceita "127.0.0.1:PORTA" ou "http://127.0.0.1:PORTA"; qualquer outro host/esquema é recusado. */
  function normalizeBase(value) {
    var raw = String(value || '').trim()
    if (!raw) return null
    if (!/^[a-z]+:\/\//i.test(raw)) raw = 'http://' + raw
    var url
    try { url = new URL(raw) } catch (e) { return null }
    var port = Number(url.port)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535 || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null
    return 'http://127.0.0.1:' + port
  }
  function load() { return new Promise(function (resolve) { chrome.storage.local.get(legacyKeys.length ? [KEY].concat(legacyKeys) : KEY, function (items) { resolve((items && (items[KEY] || legacyKeys.map(function (key) { return items[key] }).find(Boolean))) || {}) }) }) }
  function save(config) { return new Promise(function (resolve) { var o = {}; o[KEY] = config; chrome.storage.local.set(o, resolve) }) }
  function clear() { return Promise.all([KEY].concat(legacyKeys).map(function (key) { return new Promise(function (resolve) { chrome.storage.local.remove(key, resolve) }) })) }

  function request(base, path, options) {
    options = options || {}
    var headers = { 'Content-Type': 'application/json' }
    if (options.token) headers.Authorization = 'Bearer ' + options.token
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort() }, 15000)
    return fetch(base + path, { method: options.method || 'POST', headers: headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal, credentials: 'omit', cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return {} }).then(function (data) {
          if (!response.ok) { var error = new Error(data.error || ('HTTP ' + response.status)); error.status = response.status; error.code = data.code; throw error }
          return data
        })
      }, function (cause) { var error = new Error(cause && cause.name === 'AbortError' ? 'timeout' : 'offline'); error.code = 'OFFLINE'; throw error })
      .finally(function () { clearTimeout(timer) })
  }
  function pair(base, code) { return request(base, '/v1/clip/pair', { body: { code: String(code || '').trim() } }) }
  function whoami(config) { return request(config.base, '/v1/clip/whoami', { method: 'GET', token: config.token }) }
  function send(config, clip) { return request(config.base, '/v1/clip', { token: config.token, body: clip }) }

  root.WorkspaceClipper = { KEY: KEY, normalizeBase: normalizeBase, load: load, save: save, clear: clear, pair: pair, whoami: whoami, send: send }
})(typeof globalThis !== 'undefined' ? globalThis : this)
