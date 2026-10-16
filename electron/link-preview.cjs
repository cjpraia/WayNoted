const PRODUCT = require('../shared/product.json')
const dns = require('node:dns/promises')
const http = require('node:http')
const https = require('node:https')
const { isIP } = require('node:net')
const { gunzipSync, inflateSync, brotliDecompressSync } = require('node:zlib')

const HTML_LIMIT = 1_000_000
const IMAGE_LIMIT = 1_500_000

function publicAddress(address, family) {
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  // Public global unicast only; reject link-local, loopback, mapped IPv4 and documentation.
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address)
}

async function destination(value, resolver = dns.lookup) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Endereço externo inválido.')
  let url
  try { url = new URL(value) } catch { throw new Error('Endereço externo inválido.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.local')) throw new Error('Endereço externo inválido.')
  const addresses = await resolver(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address, family }) => !publicAddress(address, family))) throw new Error('Endereço externo indisponível.')
  return { url, address: addresses[0] }
}

async function boundedRequest(value, limit, options = {}) {
  const { url, address } = await destination(value, options.resolver)
  const requester = options.requester ?? (url.protocol === 'https:' ? https.request : http.request)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => { if (settled) return; settled = true; error ? reject(error) : resolve(value) }
    const request = requester(url, {
      method: 'GET', signal: AbortSignal.timeout(7000),
      lookup: (_host, lookupOptions, callback) => lookupOptions.all
        ? callback(null, [address])
        : callback(null, address.address, address.family),
      headers: { Accept: limit === HTML_LIMIT ? 'text/html' : 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'Accept-Encoding': 'identity', 'User-Agent': `${PRODUCT.name}/1.0 link-preview` },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        if ((options.hops ?? 0) >= 3) { finish(new Error('Redirecionamentos demais.')); return }
        let redirected
        try { redirected = new URL(response.headers.location, url).href } catch { finish(new Error('Redirecionamento inválido.')); return }
        boundedRequest(redirected, limit, { ...options, hops: (options.hops ?? 0) + 1 }).then(result => finish(null, result), finish)
        return
      }
      if (response.statusCode !== 200) { response.resume(); finish(new Error('Prévia indisponível.')); return }
      const chunks = []; let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > limit) { request.destroy(); finish(new Error('Prévia maior que o limite.')); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try {
          let data = Buffer.concat(chunks)
          const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
          if (encoding === 'gzip') data = gunzipSync(data, { maxOutputLength: limit })
          else if (encoding === 'deflate') data = inflateSync(data, { maxOutputLength: limit })
          else if (encoding === 'br') data = brotliDecompressSync(data, { maxOutputLength: limit })
          if (data.length > limit) throw new Error('Prévia maior que o limite.')
          finish(null, { url: url.href, contentType: String(response.headers['content-type'] ?? '').split(';')[0].toLowerCase(), data })
        } catch (error) { finish(error) }
      })
      response.on('error', finish)
    })
    request.on('error', finish)
    request.end()
  })
}

const decode = text => String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_all, entity) => {
  if (entity[0] === '#') { const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '' }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] ?? ''
}).replace(/\s+/g, ' ').trim()

function attributes(tag) {
  const result = {}
  for (const match of tag.matchAll(/([a-z][a-z0-9:-]*)\s*=\s*(["'])(.*?)\2|([a-z][a-z0-9:-]*)\s*=\s*([^\s"'>]+)/gis)) {
    const name = match[1] || match[4]
    result[name.toLowerCase()] = decode(match[3] ?? match[5])
  }
  return result
}

function pageMetadata(html, base) {
  const head = html.split(/<\/head\s*>/i)[0].slice(0, 300_000)
  const meta = {}
  let icon = ''
  for (const tag of head.match(/<(?:meta|link)\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag)
    if (/^<meta/i.test(tag)) {
      const key = (attrs.property || attrs.name || '').toLowerCase()
      if (key && !meta[key]) meta[key] = attrs.content || ''
    } else if (/\bicon\b/i.test(attrs.rel ?? '') && !icon) icon = attrs.href || ''
  }
  const title = decode(meta['og:title'] || meta['twitter:title'] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || '').slice(0, 200)
  const description = decode(meta['og:description'] || meta.description || meta['twitter:description'] || '').slice(0, 500)
  const absolute = value => { try { return value ? new URL(value, base).href : '' } catch { return '' } }
  return { title, description, imageURL: absolute(meta['og:image'] || meta['twitter:image']), iconURL: absolute(icon || '/favicon.ico') }
}

async function imageData(value, options = {}) {
  try {
    const result = await boundedRequest(value, IMAGE_LIMIT, options)
    const mime = result.contentType
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(mime)) return ''
    return `data:${mime};base64,${result.data.toString('base64')}`
  } catch { return '' }
}

async function fetchLinkPreview(url, options = {}) {
  const html = await boundedRequest(url, HTML_LIMIT, options)
  if (!['text/html', 'application/xhtml+xml'].includes(html.contentType)) throw new Error('Esta página não oferece prévia HTML.')
  const metadata = pageMetadata(html.data.toString('utf8'), html.url)
  const [image, icon] = await Promise.all([imageData(metadata.imageURL, options), imageData(metadata.iconURL, options)])
  return { url: html.url, title: metadata.title || new URL(html.url).hostname, description: metadata.description, image, icon }
}

module.exports = { publicAddress, destination, pageMetadata, fetchLinkPreview }
