const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT = 200
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Aceita só os parâmetros listados, sem repetição, texto limpo e curto. */
function onlyParams(search, names) {
  const params = new URLSearchParams(search.slice(1))
  const out = {}
  const seen = new Set()
  for (const [key, value] of params) {
    if (!names.includes(key) || seen.has(key) || CONTROL.test(value) || [...value].length > MAX_TEXT) return null
    seen.add(key); out[key] = value
  }
  return out
}

/**
 * Rotas aceitas (qualquer outra coisa devolve null, sem efeito colateral):
 *   workspace://home | tasks | graph | productivity
 *   workspace://page/UUID[#block=ID&view=ID]  (também ?view=ID)
 *   workspace://type/UUID   (coleção de um tipo de objeto)
 *   workspace://daily/AAAA-MM-DD
 *   workspace://search?q=texto
 *   workspace://new?title=texto
 */
function parseDeepLink(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null
    const url = new URL(value)
    if (![PRODUCT.protocol + ":", COMPAT.record005, ...(PRODUCT.protocolAliases ?? []).map(scheme => scheme + ":")].includes(url.protocol) || url.username || url.password || url.port) return null
    const bare = ['', '/'].includes(url.pathname) && !url.hash && !url.search
    if (['home', 'tasks', 'graph', 'productivity'].includes(url.hostname)) return bare ? { type: url.hostname } : null
    if (url.hostname === 'daily') {
      const date = url.pathname.slice(1)
      return validDate(date) && !url.hash && !url.search ? { type: 'daily', date } : null
    }
    if (url.hostname === 'search') {
      if (!['', '/'].includes(url.pathname) || url.hash) return null
      const params = onlyParams(url.search, ['q'])
      const q = params?.q?.trim()
      return q ? { type: 'search', q } : null
    }
    if (url.hostname === 'new') {
      if (!['', '/'].includes(url.pathname) || url.hash) return null
      const params = onlyParams(url.search, ['title'])
      return params ? { type: 'new', title: (params.title ?? '').trim() } : null
    }
    if (url.hostname === 'type') {
      const typeId = url.pathname.slice(1)
      return UUID.test(typeId) && !url.hash && !url.search ? { type: 'objectType', id: typeId } : null
    }
    if (url.hostname !== 'page') return null
    const id = url.pathname.slice(1)
    if (!UUID.test(id)) return null
    const query = url.search ? onlyParams(url.search, ['view']) : {}
    if (!query) return null
    const hash = new URLSearchParams(url.hash.slice(1)), blockId = hash.get('block'), viewId = hash.get('view') ?? query.view ?? null
    return { type: 'page', id, ...(blockId && /^[\w-]{1,128}$/.test(blockId) ? { blockId } : {}), ...(viewId && /^[\w-]{1,128}$/.test(viewId) ? { viewId } : {}) }
  } catch { return null }
}

/** Rota aceita ao abrir uma janela (Mover aba para nova janela): qualquer outra coisa vira o Meu dia. */
function sanitizeWindowRoute(route) {
  if (route?.type === 'page' && typeof route.id === 'string' && UUID.test(route.id)) return { type: 'page', id: route.id }
  if (route?.type === 'objectType' && typeof route.id === 'string' && UUID.test(route.id)) return { type: 'objectType', id: route.id }
  if (['graph', 'productivity', 'tasks', 'review'].includes(route?.type)) return { type: route.type }
  return { type: 'home' }
}

/** O meta (settings.objectTypes) deste espaço tem o tipo? Usado para abrir o link no espaço que o contém. */
function metaHasObjectType(meta, id) {
  const types = meta?.settings?.objectTypes
  return Array.isArray(types) && types.some(type => type && type.id === id)
}
module.exports = { parseDeepLink, sanitizeWindowRoute, metaHasObjectType }
