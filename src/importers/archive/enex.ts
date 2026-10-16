import COMPAT from '../../../shared/compatibility.ts'
// Importador de ENEX Archive (.enex): uma nota = uma página, sob "Importado do ENEX Archive <data>".
// ENEX é lido em fluxo: o arquivo é percorrido por bytes, uma <note> por vez (nunca a árvore inteira),
// e o XML passa pelo leitor seguro de ./xml.ts (sem DOCTYPE/entidades externas).
import type { Page } from '../../types.ts'
import type { Locale } from '../../localization.ts'
import { translate } from '../../localization.ts'
import { block, mediaBlock, pageBlock, text, type AssetRef, type Block, type InlineNode } from '../bundle/blocks.ts'
import { Warnings, type ImportOptions, type ImportPreview, type ImportResult } from '../bundle/importer.ts'
import { dataUrl, mimeFor, newId } from '../bundle/util.ts'
import { basename, type VirtualFS } from '../bundle/vfs.ts'
import { convertEnml } from './enml.ts'
import { md5Hex } from './md5.ts'
import { child, childrenNamed, parseXml, textOf, XmlError, type XNode } from './xml.ts'

export const ENEX_LIMITS = {
  /** Tamanho máximo de um arquivo .enex (ele é lido inteiro na memória). */
  fileBytes: 512 * 1024 * 1024,
  /** Tamanho máximo de uma única nota (com anexos em base64). */
  noteBytes: 128 * 1024 * 1024,
  /** Tamanho máximo de um anexo decodificado. */
  assetBytes: 100 * 1024 * 1024,
  notes: 200_000,
}

export interface EnexFilePlan { path: string; title: string; notes: [number, number][]; resources: number; encrypted: number }
export interface EnexPlan { vfs: VirtualFS; files: EnexFilePlan[]; notes: number; attachments: number; bytes: number; warnings: Warnings }

const enc = (value: string) => new TextEncoder().encode(value)
const NOTE_OPEN = enc('<note>'), NOTE_CLOSE = enc('</note>'), RESOURCE_OPEN = enc('<resource>'), CRYPT = enc('&lt;en-crypt')
const CRYPT_CDATA = enc('<en-crypt')

function indexOfBytes(data: Uint8Array, needle: Uint8Array, from: number, to = data.length): number {
  const first = needle[0]
  for (let at = data.indexOf(first, from); at >= 0 && at + needle.length <= to; at = data.indexOf(first, at + 1)) {
    let ok = true
    for (let j = 1; j < needle.length; j++) if (data[at + j] !== needle[j]) { ok = false; break }
    if (ok) return at
  }
  return -1
}
function countBytes(data: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  let count = 0
  for (let at = indexOfBytes(data, needle, from, to); at >= 0; at = indexOfBytes(data, needle, at + needle.length, to)) count++
  return count
}

const isEnex = (path: string) => /\.enex$/i.test(path)
export function hasEnex(vfs: VirtualFS): boolean { return [...vfs.files.keys()].some(isEnex) }

/** Percorre os .enex localizando cada <note>…</note> sem decodificar o arquivo todo. */
export function analyzeEnex(vfs: VirtualFS): EnexPlan {
  const warnings = new Warnings()
  for (const issue of vfs.issues) warnings.add(issue.kind, issue.path)
  const files: EnexFilePlan[] = []
  let notes = 0, attachments = 0, bytes = 0
  for (const path of [...vfs.files.keys()].filter(isEnex).sort((a, b) => a.localeCompare(b))) {
    const data = vfs.files.get(path)!
    if (data.byteLength > ENEX_LIMITS.fileBytes) { warnings.add('too-large', path); continue }
    bytes += data.byteLength
    const plan: EnexFilePlan = { path, title: basename(path).replace(/\.enex$/i, ''), notes: [], resources: 0, encrypted: 0 }
    for (let at = indexOfBytes(data, NOTE_OPEN, 0); at >= 0;) {
      const close = indexOfBytes(data, NOTE_CLOSE, at)
      if (close < 0) { warnings.add('enex-truncated', path); break }
      const end = close + NOTE_CLOSE.length
      if (notes >= ENEX_LIMITS.notes) { warnings.add('too-large', path); break }
      if (end - at > ENEX_LIMITS.noteBytes) warnings.add('note-too-large', path)
      else {
        plan.notes.push([at, end]); notes++
        const resources = countBytes(data, RESOURCE_OPEN, at, end)
        plan.resources += resources; attachments += resources
        if (indexOfBytes(data, CRYPT_CDATA, at, end) >= 0 || indexOfBytes(data, CRYPT, at, end) >= 0) plan.encrypted++
      }
      at = indexOfBytes(data, NOTE_OPEN, end)
    }
    if (plan.encrypted) warnings.add('encrypted', `${plan.title} (${plan.encrypted})`)
    if (plan.notes.length) files.push(plan)
  }
  if (!notes) warnings.add('enex-empty')
  return { vfs, files, notes, attachments, bytes, warnings }
}

export function previewEnex(plan: EnexPlan, locale: Locale): ImportPreview {
  const notebooks = plan.files.length > 1 ? plan.files.length : 0
  return { pages: plan.notes + notebooks, databases: 0, rows: 0, files: plan.attachments, bytes: plan.bytes, format: 'none', nestedArchives: plan.vfs.nestedArchives, warnings: plan.warnings.list(locale) }
}

/** "20230115T101112Z" → milissegundos UTC. */
export function enexDate(value: string | undefined): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec((value ?? '').trim())
  if (!match) return null
  const time = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6])
  return Number.isFinite(time) ? time : null
}

interface Resource { mime: string; name: string; data: Uint8Array; md5: string; used: boolean; asset?: AssetRef }

function decodeBase64(raw: string): Uint8Array | null {
  const clean = raw.replace(/\s+/g, '')
  if (!clean || clean.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(clean)) return null
  try {
    const binary = atob(clean)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch { return null }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'text/plain': 'txt' }

const pad = (value: number) => String(value).padStart(2, '0')
function formatDate(time: number): string { const d = new Date(time); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` }
export function isoDay(time: number): string { const d = new Date(time); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function safeUrl(raw: string): string {
  const value = raw.trim()
  return /^https?:\/\//i.test(value) && value.length < 2000 ? value : ''
}

function abortError(): Error { return Object.assign(new Error('Importação cancelada.'), { name: 'AbortError' }) }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const decoder = new TextDecoder('utf-8')

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildEnexImport(plan: EnexPlan, options: ImportOptions): Promise<ImportResult> {
  const locale = options.locale
  const warnings = plan.warnings
  const now = options.now ?? Date.now()
  const maxAsset = Math.min(options.maxAssetBytes ?? ENEX_LIMITS.assetBytes, ENEX_LIMITS.assetBytes)
  const author = options.author ?? translate(locale, "Importado do ENEX Archive", "Imported from ENEX Archive")
  const rootId = newId()
  const check = () => { if (options.signal?.aborted) throw abortError() }
  const untitled = translate(locale, 'Sem título', 'Untitled')
  const cryptLabel = translate(locale, '[conteúdo criptografado não importado]', '[encrypted content not imported]')
  const urlCache = new Map<string, string>() // sha256 → data URL: anexos repetidos compartilham o mesmo texto
  let attachments = 0, notesDone = 0

  const pages: Page[] = []
  const documents: Record<string, unknown[]> = {}
  const rootChildren: Block[] = []
  const useNotebooks = plan.files.length > 1

  for (const file of plan.files) {
    const bytes = plan.vfs.files.get(file.path)!
    const notebookId = useNotebooks ? newId() : null
    const notebookChildren: Block[] = []
    let order = 0
    for (const [from, to] of file.notes) {
      check()
      if (++notesDone % 5 === 0) { options.onProgress?.('convert', notesDone, plan.notes); await tick() }
      let root: XNode
      try { root = parseXml(decoder.decode(bytes.subarray(from, to))) } catch (error) {
        if (!(error instanceof XmlError)) throw error
        warnings.add('enex-note-invalid', `${file.title}: ${error.message}`)
        continue
      }
      const note = child(root, 'note')
      if (!note) { warnings.add('enex-note-invalid', file.title); continue }
      const title = textOf(child(note, 'title') ?? '').replace(/\s+/g, ' ').trim() || untitled
      const created = enexDate(textOf(child(note, 'created') ?? '')), updated = enexDate(textOf(child(note, 'updated') ?? ''))
      const attrs = child(note, 'note-attributes')
      const field = (name: string) => attrs ? textOf(child(attrs, name) ?? '').trim() : ''

      // Anexos: decodificados um a um; o casamento com <en-media> é pelo MD5 (declarado pelo ENEX Archive).
      const resources: Resource[] = []
      for (const node of childrenNamed(note, 'resource')) {
        const dataNode = child(node, 'data')
        const mime = textOf(child(node, 'mime') ?? '').trim().toLowerCase()
        const rattrs = child(node, 'resource-attributes')
        const fileName = rattrs ? textOf(child(rattrs, 'file-name') ?? '').trim() : ''
        const rawText = dataNode ? textOf(dataNode) : ''
        if (rawText.length * 0.75 > maxAsset) { warnings.add('asset-too-large', `${title} → ${fileName || mime}`); continue }
        const data = decodeBase64(rawText)
        if (!data || !data.byteLength) { warnings.add('resource-invalid', `${title} → ${fileName || mime || '?'}`); continue }
        const type = mime || mimeFor(fileName)
        const ext = fileName.includes('.') ? '' : EXT[type] ?? 'bin'
        const name = fileName || `${translate(locale, 'anexo', 'attachment')}-${resources.length + 1}.${ext}`
        const hash = await sha256Hex(data)
        let url = urlCache.get(hash)
        if (!url) { url = dataUrl(data, type); urlCache.set(hash, url) }
        resources.push({ mime: type, name, data, md5: md5Hex(data), used: false, asset: { url, name, mime: type, size: data.byteLength } })
      }
      const byHash = new Map(resources.map(resource => [resource.md5, resource]))
      const take = (resource: Resource): AssetRef => { resource.used = true; attachments++; return resource.asset! }

      let blocks: Block[] = []
      try {
        blocks = convertEnml(textOf(child(note, 'content') ?? ''), {
          cryptLabel,
          warn: (code, detail) => warnings.add(code, detail ? `${title}: ${detail}` : title),
          media: (hash, type) => {
            const resource = byHash.get(hash) ?? resources.find(item => !item.used && item.mime === type)
            if (!resource) { warnings.add('missing-asset', `${title} → ${hash.slice(0, 8)}`); return null }
            return resource.used ? resource.asset! : take(resource)
          },
        })
      } catch { warnings.add('enex-note-invalid', title); blocks = [] }
      // Anexos que o corpo não referencia entram no fim da página.
      for (const resource of resources) if (!resource.used) blocks.push(mediaBlock(take(resource)))

      const tags = childrenNamed(note, 'tag').map(tag => textOf(tag).trim()).filter(Boolean)
      const rows: [string, InlineNode[]][] = []
      if (tags.length) rows.push([translate(locale, 'Etiquetas', 'Tags'), [text(tags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' '))]])
      if (field('author')) rows.push([translate(locale, 'Autor', 'Author'), [text(field('author'))]])
      const sourceUrl = safeUrl(field('source-url'))
      if (sourceUrl) rows.push([translate(locale, 'Origem', 'Source'), [{ type: 'link', href: sourceUrl, content: [text(sourceUrl)] }]])
      else if (field('source')) rows.push([translate(locale, 'Origem', 'Source'), [text(field('source'))]])
      if (field('source-application')) rows.push([translate(locale, 'Aplicativo de origem', 'Source app'), [text(field('source-application'))]])
      if (field('latitude') && field('longitude')) rows.push([translate(locale, 'Local', 'Location'), [text(`${field('latitude')}, ${field('longitude')}`)]])
      if (created) rows.push([translate(locale, 'Criada em', 'Created'), [text(formatDate(created))]])
      if (updated) rows.push([translate(locale, 'Atualizada em', 'Updated'), [text(formatDate(updated))]])
      if (rows.length) blocks.unshift(block('table', {}, { type: 'tableContent', rows: rows.map(([key, value]) => ({ cells: [[text(key, { bold: true })], value] })) }))

      const id = newId()
      documents[id] = blocks
      pages.push(makePage({ id, parentId: notebookId ?? rootId, title, order: order++, createdAt: created ?? updated ?? now, updatedAt: updated ?? created ?? now, createdBy: author, updatedBy: author }))
      ;(notebookId ? notebookChildren : rootChildren).push(pageBlock(id, false))
    }
    if (notebookId) {
      pages.push(makePage({ id: notebookId, parentId: rootId, title: file.title, icon: '📓', order: rootChildren.length, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author }))
      documents[notebookId] = notebookChildren
      rootChildren.push(pageBlock(notebookId, false))
    }
  }

  const rootTitle = options.rootTitle ?? `${translate(locale, "Importado do ENEX Archive", "Imported from ENEX Archive")} ${isoDay(now)}`
  documents[rootId] = rootChildren
  pages.unshift(makePage({ id: rootId, parentId: null, title: rootTitle, icon: '📥', order: 0, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author }))
  options.onProgress?.('convert', plan.notes, plan.notes)
  return { rootId, pages, documents, warnings: warnings.list(locale), stats: { pages: pages.length - 1, databases: 0, rows: 0, files: attachments, links: 0 } }
}

export function makePage(init: Pick<Page, 'id' | 'parentId' | 'title' | 'order' | 'createdAt' | 'updatedAt'> & Partial<Page>): Page {
  return { favorite: false, trashed: false, trashedAt: null, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', blockOwnerId: null, icon: null, cover: null, coverPosition: 50, ...init }
}

export async function importEnex(vfs: VirtualFS, options: ImportOptions): Promise<ImportResult> {
  return buildEnexImport(analyzeEnex(vfs), options)
}
