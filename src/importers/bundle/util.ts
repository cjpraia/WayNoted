// Utilitários puros do importador do Export Bundle: nomes com id, links relativos, mime e base64.
import { dirname, joinPath, normalizePath } from './vfs.ts'

export const BUNDLE_ID = /[0-9a-f]{32}/i
const NAME_WITH_ID = /^(.*?)[\s_-]+([0-9a-f]{32})$/i

/** "Página 1a2b…c3d.md" → { title: "Página", id: "1a2b…c3d", ext: "md" }. */
export function splitBundleName(fileName: string): { title: string; id: string | null; ext: string; all: boolean } {
  const dot = fileName.lastIndexOf('.')
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  let stem = dot > 0 ? fileName.slice(0, dot) : fileName
  let all = false
  if (ext === 'csv' && /_all$/i.test(stem)) { all = true; stem = stem.slice(0, -4) }
  const match = NAME_WITH_ID.exec(stem)
  if (match) return { title: match[1].trim() || stem, id: match[2].toLowerCase(), ext, all }
  return { title: stem.trim(), id: null, ext, all }
}

/** Remove o id de um nome de pasta/arquivo sem extensão. */
export function stripId(name: string): string {
  const match = NAME_WITH_ID.exec(name)
  return match ? match[1].trim() || name : name
}

export function idFromHref(href: string): string | null {
  const decoded = safeDecode(href)
  const matches = decoded.match(/[0-9a-f]{32}/gi)
  if (!matches) {
    const dashed = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i.exec(decoded)
    return dashed ? dashed.slice(1).join('').toLowerCase() : null
  }
  return matches[matches.length - 1].toLowerCase()
}

export function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch {
    return value.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  }
}

export function isExternalHref(href: string): boolean { return /^[a-z][a-z0-9+.-]*:/i.test(href) }

/** Resolve um link relativo (codificado com %20) a partir do diretório do arquivo de origem. */
export function resolveRelative(fromFile: string, href: string): string | null {
  if (!href || isExternalHref(href) || href.startsWith('#')) return null
  const clean = safeDecode(href.split('#')[0].split('?')[0]).normalize('NFC')
  if (!clean) return null
  const parts = (clean.startsWith('/') ? clean.slice(1) : joinPath(dirname(fromFile), clean)).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (!out.length) return null; out.pop(); continue }
    out.push(part)
  }
  return normalizePath(out.join('/'))
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', heic: 'image/heic', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export function mimeFor(name: string): string { return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream' }
export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

export function toBase64(data: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }).Buffer
  if (maybeBuffer) return maybeBuffer.from(data).toString('base64')
  let binary = ''
  for (let index = 0; index < data.length; index += 0x8000) binary += String.fromCharCode.apply(null, data.subarray(index, index + 0x8000) as unknown as number[])
  return btoa(binary)
}

export function dataUrl(data: Uint8Array, mime: string): string { return `data:${mime};base64,${toBase64(data)}` }

export function newId(): string { return crypto.randomUUID() }

/** Emoji/ícone no começo de um texto (callouts do Markdown). */
export function leadingEmoji(text: string): { icon: string; rest: string } | null {
  const match = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2})\s*/u.exec(text)
  return match ? { icon: match[1], rest: text.slice(match[0].length) } : null
}
