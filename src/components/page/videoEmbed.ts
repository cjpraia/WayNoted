// Vídeos e áudios online incorporáveis (docs/LOCAL-INTEGRATIONS.md, docs/SECURITY.md).
// Lista FECHADA de provedores: só estes hosts viram <iframe>, sempre com a URL oficial de incorporação
// montada aqui a partir de um identificador validado — nunca a URL colada pelo usuário.

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'dailymotion' | 'spotify'
export type EmbedMode = 'always' | 'click' | 'never'

export interface VideoRef {
  provider: VideoProvider
  /** Identificador validado (vídeo, lista ou "tipo/id" no Spotify). */
  id: string
  kind: 'video' | 'playlist' | 'audio'
  /** Segundos de início (0 = começo). */
  start: number
  /** Endereço canônico para abrir no navegador. */
  watchUrl: string
  /** Endereço de incorporação oficial (HTTPS, host da lista fechada). */
  embedUrl: string
  /** Largura / altura; ausente = altura fixa em `height`. */
  ratio: number
  /** Altura fixa em px (áudio do Spotify). */
  height?: number
  label: string
}

export const PROVIDER_LABEL: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', dailymotion: 'Dailymotion', spotify: 'Spotify' }

/** Hosts autorizados em `frame-src` (index.html) e no processo principal (electron/local-policy.cjs). */
export const EMBED_FRAME_HOSTS: readonly string[] = Object.freeze([
  'www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'www.dailymotion.com', 'open.spotify.com',
])

export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups'
export const IFRAME_ALLOW = 'fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope'
export const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin' as const

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_LIST = /^[A-Za-z0-9_-]{10,80}$/
const VIMEO_ID = /^\d{5,12}$/
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i
const LOOM_ID = /^[0-9a-f]{32}$/i
const DM_ID = /^x[0-9a-z]{4,12}$/i
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist'])

/** `90`, `90s`, `1m30s`, `1h2m3s` → segundos (0 se inválido; máx. 24 h). */
export function parseStartTime(value: string | null | undefined): number {
  if (!value) return 0
  const text = value.trim().toLowerCase()
  let seconds = 0
  if (/^\d{1,6}s?$/.test(text)) seconds = parseInt(text, 10)
  else {
    const match = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(text)
    if (!match || !match[0]) return 0
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  }
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : 0
}

export function formatStartTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function safeUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
  return url
}

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

function youtube(url: URL, host: string): VideoRef | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const params = url.searchParams
  const list = params.get('list')
  const validList = list && YT_LIST.test(list) ? list : null
  const start = parseStartTime(params.get('start') ?? params.get('t') ?? (/^t=/.test(url.hash.slice(1)) ? url.hash.slice(3) : null))
  let id: string | null = null
  if (host === 'youtu.be') id = segments[0] ?? null
  else if (segments[0] === 'watch') id = params.get('v')
  else if (['shorts', 'embed', 'live', 'v'].includes(segments[0]) && segments.length >= 2) id = segments[1]
  if (segments[0] === 'embed' && segments[1] === 'videoseries') { if (!validList) return null; return playlist(validList, start) }
  if (segments[0] === 'playlist') { if (!validList) return null; return playlist(validList, start) }
  if (!id || !YT_ID.test(id)) return null
  const query = new URLSearchParams()
  if (validList) query.set('list', validList)
  if (start) query.set('start', String(start))
  const embedQuery = query.toString()
  const watch = new URLSearchParams({ v: id })
  if (validList) watch.set('list', validList)
  if (start) watch.set('t', `${start}s`)
  return {
    provider: 'youtube', id, kind: 'video', start,
    watchUrl: `https://www.youtube.com/watch?${watch}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}${embedQuery ? `?${embedQuery}` : ''}`,
    ratio: 16 / 9, label: 'YouTube',
  }
}

function playlist(list: string, start: number): VideoRef {
  return {
    provider: 'youtube', id: list, kind: 'playlist', start,
    watchUrl: `https://www.youtube.com/playlist?list=${list}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}${start ? `&start=${start}` : ''}`,
    ratio: 16 / 9, label: 'YouTube',
  }
}

function vimeo(url: URL, host: string): VideoRef | null {
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | undefined, hash = url.searchParams.get('h') ?? undefined
  if (host === 'player.vimeo.com') { if (segments[0] !== 'video') return null; id = segments[1] }
  else {
    // vimeo.com/123, vimeo.com/123/abcdef, vimeo.com/channels/x/123, vimeo.com/groups/x/videos/123
    const numeric = segments.findIndex((segment) => VIMEO_ID.test(segment))
    if (numeric < 0) return null
    const prefix = segments.slice(0, numeric)
    const allowed = prefix.length === 0 || (prefix.length === 2 && prefix[0] === 'channels') || (prefix.length === 3 && prefix[0] === 'groups' && prefix[2] === 'videos')
    if (!allowed) return null
    id = segments[numeric]
    if (!hash && segments[numeric + 1] && VIMEO_HASH.test(segments[numeric + 1])) hash = segments[numeric + 1]
  }
  if (!id || !VIMEO_ID.test(id)) return null
  if (hash && !VIMEO_HASH.test(hash)) hash = undefined
  const start = parseStartTime(/^t=/.test(url.hash.slice(1)) ? url.hash.slice(3) : url.searchParams.get('t'))
  return {
    provider: 'vimeo', id, kind: 'video', start,
    watchUrl: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}${start ? `#t=${start}s` : ''}`,
    embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}${start ? `#t=${start}s` : ''}`,
    ratio: 16 / 9, label: 'Vimeo',
  }
}

function loom(url: URL): VideoRef | null {
  const [kind, id] = url.pathname.split('/').filter(Boolean)
  if (!['share', 'embed'].includes(kind) || !id || !LOOM_ID.test(id)) return null
  const start = parseStartTime(url.searchParams.get('t'))
  return { provider: 'loom', id, kind: 'video', start, watchUrl: `https://www.loom.com/share/${id}${start ? `?t=${start}` : ''}`, embedUrl: `https://www.loom.com/embed/${id}${start ? `?t=${start}` : ''}`, ratio: 16 / 9, label: 'Loom' }
}

function dailymotion(url: URL, host: string): VideoRef | null {
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | undefined
  if (host === 'dai.ly') id = segments[0]
  else if (segments[0] === 'video') id = segments[1]
  else if (segments[0] === 'embed' && segments[1] === 'video') id = segments[2]
  id = id?.split('_')[0]
  if (!id || !DM_ID.test(id)) return null
  const start = parseStartTime(url.searchParams.get('start'))
  return { provider: 'dailymotion', id, kind: 'video', start, watchUrl: `https://www.dailymotion.com/video/${id}`, embedUrl: `https://www.dailymotion.com/embed/video/${id}${start ? `?startTime=${start}` : ''}`, ratio: 16 / 9, label: 'Dailymotion' }
}

function spotify(url: URL): VideoRef | null {
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0]?.startsWith('intl-')) segments.shift()
  if (segments[0] === 'embed') segments.shift()
  const [kind, id] = segments
  if (!kind || !SPOTIFY_KINDS.has(kind) || !id || !SPOTIFY_ID.test(id)) return null
  return { provider: 'spotify', id: `${kind}/${id}`, kind: 'audio', start: 0, watchUrl: `https://open.spotify.com/${kind}/${id}`, embedUrl: `https://open.spotify.com/embed/${kind}/${id}`, ratio: 0, height: kind === 'track' || kind === 'episode' ? 152 : 352, label: 'Spotify' }
}

/** Reconhece uma URL de provedor da lista fechada; qualquer outra coisa (inclusive hosts parecidos) devolve null. */
export function parseVideoUrl(raw: string): VideoRef | null {
  const url = safeUrl(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (YT_HOSTS.has(host) || host === 'youtu.be') return youtube(url, host)
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') return vimeo(url, host)
  if (host === 'loom.com' || host === 'www.loom.com') return loom(url)
  if (host === 'dailymotion.com' || host === 'www.dailymotion.com' || host === 'dai.ly') return dailymotion(url, host)
  if (host === 'open.spotify.com') return spotify(url)
  return null
}

/** Mesmo vídeo com outro tempo de início (usado por "Reiniciar em 0:00"). */
export function withStart(ref: VideoRef, start: number): VideoRef {
  const s = Math.max(0, Math.min(86_400, Math.floor(start) || 0))
  let raw: string
  if (ref.provider === 'spotify') return ref
  if (ref.provider === 'youtube' && ref.kind === 'playlist') raw = `https://www.youtube.com/playlist?list=${ref.id}${s ? `&start=${s}` : ''}`
  else if (ref.provider === 'youtube') { const u = new URL(ref.watchUrl); u.searchParams.delete('t'); if (s) u.searchParams.set('t', `${s}s`); raw = u.href }
  else if (ref.provider === 'vimeo') raw = ref.watchUrl.split('#')[0] + (s ? `#t=${s}s` : '')
  else if (ref.provider === 'loom') raw = ref.watchUrl.split('?')[0] + (s ? `?t=${s}` : '')
  else raw = ref.watchUrl.split('?')[0] + (s ? `?start=${s}` : '')
  return parseVideoUrl(raw) ?? ref
}

export interface IframeAttributes {
  src: string; title: string; sandbox: string; allow: string; referrerPolicy: typeof IFRAME_REFERRER_POLICY; loading: 'lazy'
}

/** Atributos do <iframe>: sandbox mínimo, sem `allow-top-navigation`, sem formulários, sem downloads. */
export function iframeAttributes(ref: VideoRef, title: string): IframeAttributes {
  return { src: ref.embedUrl, title: title || `${ref.label}`, sandbox: IFRAME_SANDBOX, allow: IFRAME_ALLOW, referrerPolicy: IFRAME_REFERRER_POLICY, loading: 'lazy' }
}

const escapeAttr = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** HTML do iframe para exportação (só quando o usuário marca "incluir players"). */
export function iframeHtml(ref: VideoRef, title: string, width = 640): string {
  const a = iframeAttributes(ref, title)
  const height = ref.height ?? Math.round(width / (ref.ratio || 16 / 9))
  return `<iframe src="${escapeAttr(a.src)}" title="${escapeAttr(a.title)}" width="${width}" height="${height}" sandbox="${a.sandbox}" allow="${a.allow}" referrerpolicy="${a.referrerPolicy}" loading="lazy"></iframe>`
}

export function normalizeEmbedMode(value: unknown): EmbedMode {
  return value === 'click' || value === 'never' ? value : 'always'
}

/** Modo efetivo: o interruptor "Bloquear conteúdo remoto" vale como Nunca. */
export function effectiveEmbedMode(settings: { embedVideos?: unknown; blockRemoteContent?: boolean } | undefined): EmbedMode {
  return settings?.blockRemoteContent ? 'never' : normalizeEmbedMode(settings?.embedVideos)
}

/** Título legível derivado só da URL (sem rede). */
export function fallbackVideoTitle(ref: VideoRef): string {
  const kind = ref.provider === 'spotify' ? 'áudio' : ref.kind === 'playlist' ? 'lista de reprodução' : 'vídeo'
  return `${ref.label} · ${kind}${ref.provider === 'spotify' ? '' : ` ${ref.id.slice(0, 11)}`}`
}
