const path = require('node:path')
const { fileURLToPath } = require('node:url')

function localPath(url, entryFile) {
  const windows = /^[a-z]:[\\/]/i.test(entryFile) || entryFile.startsWith('\\\\')
  const paths = windows ? path.win32 : path.posix
  const normalize = value => windows ? paths.normalize(value).toLowerCase() : paths.normalize(value)
  return { actual: normalize(fileURLToPath(url, { windows })), entry: normalize(entryFile), paths }
}

function isInternalURL(value, config) {
  try {
    const url = new URL(value)
    return config.isDev ? url.origin === new URL(config.devURL).origin : url.protocol === 'file:' && (() => { const file = localPath(url, config.entryFile); return file.actual === file.entry })()
  } catch { return false }
}

function canRequest(value, config) {
  try {
    const url = new URL(value)
    if (['data:', 'blob:', 'devtools:'].includes(url.protocol)) return true
    if (value === 'about:blank' || value === 'about:srcdoc') return true
    if (url.protocol === 'file:') { const file = localPath(url, config.entryFile); return file.actual.startsWith(file.paths.dirname(file.entry) + file.paths.sep) }
    if (!config.isDev) return false
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    return url.origin === new URL(config.devURL).origin
  } catch { return false }
}

// IA (docs/AI.md): única exceção de rede do app, sempre no processo principal e opt-in.
// O renderer continua limitado por `canRequest` acima. Provedores em nuvem só com HTTPS para
// a origem exata abaixo, após consentimento por provedor e se "Bloquear provedores em nuvem"
// estiver desligado (verificado em electron/ai/service.cjs). O Ollama só em loopback.
const AI_CLOUD_ORIGINS = Object.freeze({ openrouter: 'https://openrouter.ai', google: 'https://generativelanguage.googleapis.com' })
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
function isLoopbackEndpoint(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash
  } catch { return false }
}
/** Pode o processo principal chamar `value` em nome do provedor de IA `provider`? */
function canAIRequest(provider, value, options = {}) {
  let url
  try { url = new URL(value) } catch { return false }
  if (url.username || url.password) return false
  if (provider === 'ollama') return ['http:', 'https:'].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname)
  const origin = AI_CLOUD_ORIGINS[provider]
  if (!origin) return false
  // Seam de teste (servidores simulados locais); nunca definido em produção (service.cjs).
  if (options.testOrigin) return url.origin === options.testOrigin
  return url.protocol === 'https:' && url.origin === origin
}

// Vídeos online incorporados (docs/SECURITY.md): segunda e última exceção de rede do renderer.
// Só <iframe> para os hosts da lista FECHADA abaixo (espelha EMBED_FRAME_HOSTS em
// src/components/page/videoEmbed.ts e `frame-src` em index.html; um teste compara os três) e só
// se o modo de incorporação não for "never". O player, dentro do iframe, pode buscar seus
// próprios recursos (requisições cujo quadro de origem é um host da lista); nada mais.
const EMBED_HOSTS = Object.freeze(['www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'www.dailymotion.com', 'open.spotify.com'])
// Origem fictícia (TLD reservado .localhost, nunca resolve) enviada como Referer só ao carregar o
// quadro do player: o YouTube recusa (Erro 153) incorporações sem Referer, o que ocorre com file://.
const EMBED_REFERER = "https://workspace.localhost/"

function embedHost(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && EMBED_HOSTS.includes(url.hostname) ? url.hostname : null
  } catch { return null }
}

/** `details`: { url, resourceType, frame?: { url, parent? } } do `webRequest`; `mode`: 'always' | 'click' | 'never'. */
function canEmbedRequest(details, mode = 'always') {
  if (mode === 'never') return false
  let url
  try { url = new URL(details.url) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'wss:') return false
  if (details.resourceType === 'subFrame' && embedHost(details.url)) return true
  const origin = details.frame?.url ? embedHost(details.frame.url) : null
  return Boolean(origin)
}

/** Referer a enviar ao navegar o quadro do player (null = deixar como está). */
function embedRefererFor(details) {
  if (details.resourceType !== 'subFrame' || !embedHost(details.url)) return null
  const current = details.requestHeaders?.Referer ?? details.requestHeaders?.referer
  return typeof current === 'string' && /^https?:\/\//i.test(current) ? null : EMBED_REFERER
}

module.exports = { isInternalURL, canRequest, canAIRequest, isLoopbackEndpoint, AI_CLOUD_ORIGINS, EMBED_HOSTS, EMBED_REFERER, embedHost, canEmbedRequest, embedRefererFor }
