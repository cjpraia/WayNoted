import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.ts'
// Tipos e utilidades puras compartilhadas pela exportação/importação de pacotes do aplicativo.
// Sem React, sem store: tudo aqui roda no navegador, no Electron e nos testes (node --test).
import type { Page, SyncedBlockRecord } from '../types'
import type { Locale } from '../localization'

export type RawInline = { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown; props?: Record<string, unknown>; [key: string]: unknown }
export type RawBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: RawBlock[]; [key: string]: unknown }

export const PACKAGE_MANIFEST = "workspace-export.json"
export const PACKAGE_FORMAT = COMPAT.record044
export const PACKAGE_VERSION = 1

export type ExportFormat = 'markdown' | 'html'
export type ExportScope = 'page' | 'tree' | 'workspace'

/** Dados de entrada: um retrato do espaço (o mesmo formato interno do store/backup). */
export interface ExportSource {
  pages: Record<string, Page>
  documents: Record<string, unknown[]>
  syncedBlocks?: Record<string, SyncedBlockRecord>
  /** Definições dos tipos de objeto (src/objecttypes) → `types.json` no pacote. */
  objectTypes?: import('../objecttypes/model.ts').ObjectType[]
  workspaceName: string
  locale: Locale
}

export interface ExportOptions {
  format: ExportFormat
  scope: ExportScope
  /** Página de origem para os escopos `page` e `tree`. */
  pageId?: string
  /** Copia imagens/anexos para `assets/`. Desligado, os arquivos são omitidos (só o nome fica). */
  includeFiles: boolean
  /** HTML: incorpora os players de vídeo online como <iframe> (padrão: só o link). */
  includePlayers?: boolean
  now?: Date
  /** Espelho Markdown (src/mirror): nomes `título--id` estáveis. */
  stableNames?: boolean
  /** Espelho: gera só os arquivos destas páginas (o layout continua completo para resolver links). */
  only?: ReadonlySet<string>
  /** Espelho: não monta o manifesto (nem `workspace-export.json`). */
  skipManifest?: boolean
  /** Espelho: ids de bloco citados, já calculados (evita varrer todos os documentos a cada gravação). */
  keepIds?: Set<string>
  onProgress?: (done: number, total: number, label: string) => void
}

export type PackageFiles = Record<string, string | Uint8Array>

export interface ManifestPage { id: string; parentId: string | null; path: string; kind: 'page' | 'database' | 'row'; order: number; title: string }
export interface PackageManifest {
  format: typeof PACKAGE_FORMAT
  version: typeof PACKAGE_VERSION
  exportedAt: string
  generator: string
  output: ExportFormat
  workspaceName: string
  locale: Locale
  scope: ExportScope
  rootIds: string[]
  includeFiles: boolean
  pages: ManifestPage[]
  /** Cabeçalho exato do data-URL original de cada arquivo em `assets/`. */
  assets: Record<string, string>
  syncedBlocks: { id: string; sourcePageId: string; updatedAt: number; markdown: string }[]
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export const tr = (locale: Locale, pt: string, en: string) => (locale === 'en-US' ? en : pt)

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

/** Nome de arquivo legível e portátil (macOS, Windows, Linux). */
export function safeFileName(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\/:*?"<>|#%[\]^`{}]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .trim()
  const short = [...cleaned].slice(0, 80).join('').trim()
  return short || fallback
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

/** Caminho relativo de um arquivo para outro, ambos relativos à raiz do pacote. */
export function relativePath(fromFile: string, toFile: string): string {
  const from = dirname(fromFile).split('/').filter(Boolean)
  const to = toFile.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...Array(from.length - common).fill('..'), ...to.slice(common)].join('/') || to.at(-1) || ''
}

/** Resolve `../a/b.md` a partir de um arquivo do pacote. Devolve null se sair da raiz. */
export function resolvePath(fromFile: string, relative: string): string | null {
  const parts = dirname(fromFile).split('/').filter(Boolean)
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) return null; parts.pop() } else parts.push(part)
  }
  return parts.join('/')
}

/** Codifica só o necessário para um destino de link Markdown continuar legível. */
export function encodeLinkPath(path: string): string {
  return path.split('/').map((segment) => segment.replace(/[%\s()<>[\]#?"]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))).join('/')
}

export function decodeLinkPath(path: string): string {
  try { return decodeURIComponent(path) } catch { return path }
}

// ---------- data URLs ----------

const B64_CHUNK = 0x8000
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += B64_CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK))
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function parseDataUrl(value: string): { header: string; mime: string; bytes: Uint8Array } | null {
  const match = /^(data:([^,;]*)(?:;[^,;]*)*;base64),([A-Za-z0-9+/=\s]*)$/.exec(value)
  if (!match) return null
  try { return { header: match[1], mime: match[2] || 'application/octet-stream', bytes: base64ToBytes(match[3].replace(/\s+/g, '')) } } catch { return null }
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/zip': 'zip', 'application/json': 'json',
}
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))
export function extensionFor(mime: string): string { return EXT[mime] ?? 'bin' }
export function mimeForPath(path: string): string { return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream' }

function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += Math.max(1, Math.floor(value.length / 4096))) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  h ^= value.length
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Copia data-URLs para `assets/` uma única vez por conteúdo. */
export class AssetStore {
  readonly files: Record<string, Uint8Array> = {}
  readonly headers: Record<string, string> = {}
  private byValue = new Map<string, string>()
  private used = new Set<string>()
  readonly enabled: boolean
  constructor(enabled: boolean) { this.enabled = enabled }

  /** Caminho do arquivo no pacote (relativo à raiz), ou null quando não é um data-URL base64. */
  add(dataUrl: string, nameHint = 'arquivo'): string | null {
    if (!dataUrl.startsWith('data:')) return null
    const known = this.byValue.get(dataUrl)
    if (known) return known
    const parsed = parseDataUrl(dataUrl)
    if (!parsed) return null
    if (!this.enabled) return ''
    const hint = safeFileName(nameHint.replace(/\.[a-z0-9]{1,5}$/i, ''), 'arquivo').slice(0, 48)
    const extension = /\.([a-z0-9]{1,5})$/i.exec(nameHint)?.[1]?.toLowerCase() ?? extensionFor(parsed.mime)
    let path = `assets/${hash(dataUrl)}-${hint}.${extension}`
    for (let n = 2; this.used.has(path.toLowerCase()); n++) path = `assets/${hash(dataUrl)}-${hint}-${n}.${extension}`
    this.used.add(path.toLowerCase())
    this.files[path] = parsed.bytes
    this.headers[path] = parsed.header
    this.byValue.set(dataUrl, path)
    return path
  }
}

export function assetDataUrl(path: string, bytes: Uint8Array, headers: Record<string, string>): string {
  return `${headers[path] ?? `data:${mimeForPath(path)};base64`},${bytesToBase64(bytes)}`
}

/** Troca recursivamente data-URLs por `asset:<caminho relativo>` (para JSON e front-matter). */
export function externalizeAssets<T>(value: T, assets: AssetStore, fromFile: string, nameHint = 'arquivo'): T {
  if (typeof value === 'string') {
    if (!value.startsWith('data:')) return value
    const path = assets.add(value, nameHint)
    if (path === null) return value
    return (path ? `asset:${relativePath(fromFile, path)}` : '') as T
  }
  if (Array.isArray(value)) return value.map((item) => externalizeAssets(item, assets, fromFile, nameHint)) as T
  if (object(value)) {
    const hint = typeof value.name === 'string' && value.name ? value.name : nameHint
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, externalizeAssets(item, assets, fromFile, hint)])) as T
  }
  return value
}

/** Caminho do arquivo dentro do pacote; aceita `asset:` e caminhos relativos simples. */
export function internalizeAssets<T>(value: T, fromFile: string, files: Record<string, Uint8Array>, headers: Record<string, string>): T {
  if (typeof value === 'string') {
    if (!value.startsWith('asset:')) return value
    const path = resolvePath(fromFile, decodeLinkPath(value.slice(6)))
    return (path && files[path] ? assetDataUrl(path, files[path], headers) : '') as T
  }
  if (Array.isArray(value)) return value.map((item) => internalizeAssets(item, fromFile, files, headers)) as T
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, internalizeAssets(item, fromFile, files, headers)])) as T
  return value
}
