const PRODUCT = require('../shared/product.json')
// "Buscar atualizações" sem telemetria (docs/DEVELOPMENT.md F7).
// Regras: só roda quando o usuário clica; uma única requisição HTTPS GET ao feed JSON cuja URL ELE configurou
// (não existe URL embutida); cabeçalhos genéricos, sem cookies, sem identificadores; nunca baixa nem instala nada —
// "Abrir página de download" apenas abre o navegador padrão.
const https = require('node:https')
const { destination } = require('./link-preview.cjs')

const FEED_LIMIT = 64 * 1024
const TIMEOUT_MS = 8000
const MAX_HOPS = 2

class UpdateError extends Error { constructor(code) { super(code); this.code = code } }

const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/
function parseSemver(value) {
  const match = SEMVER.exec(String(value ?? '').trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}
/** -1, 0 ou 1 (semver 2.0: pré-lançamento vem antes da versão final). */
function compareSemver(a, b) {
  const x = typeof a === 'string' ? parseSemver(a) : a, y = typeof b === 'string' ? parseSemver(b) : b
  if (!x || !y) throw new UpdateError('invalid-feed')
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const numeric = /^\d+$/.test(p) && /^\d+$/.test(q)
    if (numeric) return Number(p) < Number(q) ? -1 : 1
    if (/^\d+$/.test(p)) return -1
    if (/^\d+$/.test(q)) return 1
    return p < q ? -1 : 1
  }
  return 0
}

/** Aceita só https público: sem credenciais, sem IP, sem porta de serviço local. */
function httpsUrl(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new UpdateError(code)
  let url
  try { url = new URL(value.trim()) } catch { throw new UpdateError(code) }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw new UpdateError(code)
  return url
}

const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)

/** Valida o JSON do feed e devolve apenas campos conhecidos e saneados. */
function validateFeed(json, { platform = process.platform, arch = process.arch } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new UpdateError('invalid-feed')
  const version = cleanText(json.version, 60).replace(/^v/, '')
  if (!parseSemver(version)) throw new UpdateError('invalid-feed')
  const raw = json.notes ?? json.releaseNotes
  const notes = {}
  if (typeof raw === 'string') notes.default = cleanText(raw, 4000)
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const key of ['pt-BR', 'en-US', 'default']) if (typeof raw[key] === 'string') notes[key] = cleanText(raw[key], 4000)
  let downloadUrl = ''
  if (json.downloads !== undefined && (!json.downloads || typeof json.downloads !== 'object' || Array.isArray(json.downloads))) throw new UpdateError('invalid-feed')
  const link = json.downloads ? json.downloads[`${platform}-${arch}`] : json.downloadUrl ?? json.url
  if (link !== undefined) {
    try { downloadUrl = httpsUrl(link, 'invalid-feed').href } catch { throw new UpdateError('invalid-feed') }
  }
  return { version, notes, downloadUrl }
}

/** GET do feed com limites: https obrigatório (inclusive em redirecionamentos), endereço público, 64 KB, 8 s. */
async function fetchFeed(value, options = {}, hops = 0) {
  const parsed = httpsUrl(value, 'invalid-url')
  let target
  try { target = await (options.destination ?? destination)(parsed.href, options.resolver) } catch { throw new UpdateError('invalid-url') }
  const { url, address } = target
  const requester = options.requester ?? https.request
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, result) => { if (settled) return; settled = true; error ? reject(error) : resolve(result) }
    const request = requester(url, {
      method: 'GET', signal: AbortSignal.timeout(options.timeout ?? TIMEOUT_MS), agent: false,
      lookup: (_host, lookupOptions, callback) => lookupOptions.all ? callback(null, [address]) : callback(null, address.address, address.family),
      // Cabeçalhos genéricos: sem cookies, sem versão, sem identificador do usuário ou do espaço.
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': `${PRODUCT.name}` },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if (hops >= MAX_HOPS) { finish(new UpdateError('network')); return }
        let next
        try { next = new URL(response.headers.location, url).href } catch { finish(new UpdateError('network')); return }
        fetchFeed(next, options, hops + 1).then(result => finish(null, result), finish)
        return
      }
      if (response.statusCode !== 200) { response.resume(); finish(new UpdateError('http')); return }
      const chunks = []; let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > FEED_LIMIT) { request.destroy(); finish(new UpdateError('too-large')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { finish(new UpdateError('invalid-feed')) }
      })
      response.on('error', () => finish(new UpdateError('network')))
    })
    request.on('error', error => finish(new UpdateError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network')))
    request.end()
  })
}

/** Resultado para a interface; nunca lança (erros viram `{ status: 'error', code }`). */
async function checkForUpdates(feedUrl, currentVersion, options = {}) {
  try {
    const feed = validateFeed(await fetchFeed(feedUrl, options), options)
    const newer = compareSemver(feed.version, currentVersion) > 0
    return newer ? { status: 'available', current: currentVersion, latest: feed.version, notes: feed.notes, hasDownload: !!feed.downloadUrl, downloadUrl: feed.downloadUrl }
      : { status: 'current', current: currentVersion, latest: feed.version }
  } catch (error) {
    return { status: 'error', code: error instanceof UpdateError ? error.code : 'network', current: currentVersion }
  }
}

/** Registra `np:checkForUpdates` (só quando o usuário clica) e `np:openUpdatePage` (abre a URL do último resultado). */
function registerUpdateCheck({ trustedHandler, shell, app, options = {} }) {
  let lastDownload = ''
  trustedHandler('np:checkForUpdates', async (_event, feedUrl) => {
    const result = await checkForUpdates(feedUrl, app.getVersion(), options)
    lastDownload = result.status === 'available' ? result.downloadUrl : ''
    const { downloadUrl, ...publicResult } = result
    return publicResult
  })
  trustedHandler('np:openUpdatePage', async () => {
    if (!lastDownload) throw new Error('Nenhuma página de download disponível.')
    await shell.openExternal(lastDownload)
  })
}

module.exports = { registerUpdateCheck, checkForUpdates, fetchFeed, validateFeed, parseSemver, compareSemver, httpsUrl, FEED_LIMIT, TIMEOUT_MS }
