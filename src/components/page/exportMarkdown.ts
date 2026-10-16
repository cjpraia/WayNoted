import COMPAT from '../../../shared/compatibility.ts'
// Importação e exportação local de páginas usando os conversores do BlockNote.
import { BlockNoteEditor } from '@blocknote/core'
import { withoutLockedPages } from '../../security/pageLock'
import { actions, api, getState, selectors } from '../../store'
import { schema } from './schema'
import { editorLinks } from './links'
import { iconLabel } from './PageIcon'
import { blocksToText, flushAllDocs, flushDoc } from './util'
import { getLocale, t } from '../../i18n'
import { loadPdfjs } from '../../pdfWorker'
import { importWorkspacePackage } from '../../export/importZip'
import { singlePageHtml, singlePageMarkdown, splitSinglePageMarkdown } from '../../export/singlePage'
import { findTypeByName, normalizePageTypes, pageTypes } from '../../objecttypes/model'

let headless: typeof schema.BlockNoteEditor | null = null

type RawBlock = { type?: string; props?: Record<string, unknown>; children?: RawBlock[]; [k: string]: unknown }

/** Troca blocos de subpágina por parágrafos com o nome da página (o Markdown não tem equivalente). */
function replacePageBlocks(blocks: RawBlock[]): RawBlock[] {
  return blocks.flatMap((b) => {
    const children = Array.isArray(b.children) ? replacePageBlocks(b.children) : []
    if (b.type === 'syncedBlock') {
      const record = selectors.syncedBlock(String(b.props?.syncedId ?? ''))
      return record ? replacePageBlocks(record.blocks as RawBlock[]) : [{ type: 'paragraph', content: t('[Bloco sincronizado indisponível]', '[Synced block unavailable]') }]
    }
    if (b.type !== 'page') return [{ ...b, children }]
    const ref = selectors.page(String(b.props?.pageId ?? ''))
    const text = ref ? `${iconLabel(ref.icon) ? iconLabel(ref.icon) + ' ' : ''}${ref.title || t('Sem título', 'Untitled')}` : t('Página excluída', 'Deleted page')
    return [{ id: b.id, type: 'paragraph', content: [{ type: 'text', text, styles: { underline: true } }], children }]
  })
}

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '-').trim() || t('pagina', 'page')
}

function editor() {
  if (!headless) headless = BlockNoteEditor.create({ schema, links: editorLinks })
  return headless
}

export async function pageToMarkdown(pageId: string): Promise<string> {
  await flushDoc(pageId)
  const page = selectors.page(pageId)
  const blocks = ((await api.loadDoc(pageId)) ?? []) as RawBlock[]
  const body = editor().blocksToMarkdownLossy(replacePageBlocks(blocks) as never)
  const title = page?.title || t('Sem título', 'Untitled')
  const typeNames = page ? pageTypes(getState().settings.objectTypes ?? [], page).map((type) => type.name) : []
  return singlePageMarkdown({ title, body, icon: page?.icon, cover: page?.cover, coverPosition: page?.coverPosition, typeNames })
}

export async function exportPageAsMarkdown(pageId: string): Promise<boolean> {
  const page = selectors.page(pageId)
  const md = await pageToMarkdown(pageId)
  return api.exportFile(`${safeName(page?.title || t('Sem título', 'Untitled'))}.md`, md)
}

export async function exportPageAsHTML(pageId: string): Promise<boolean> {
  const page = selectors.page(pageId)
  const html = await pageToHTML(pageId)
  return api.exportFile(`${safeName(page?.title || t('Sem título', 'Untitled'))}.html`, html)
}

export async function pageToHTML(pageId: string): Promise<string> {
  await flushDoc(pageId)
  const page = selectors.page(pageId)
  const blocks = ((await api.loadDoc(pageId)) ?? []) as RawBlock[]
  const body = editor().blocksToHTMLLossy(replacePageBlocks(scrubRemoteMedia(blocks) as RawBlock[]) as never)
  return singlePageHtml({ title: page?.title || t('Sem título', 'Untitled'), body, icon: page?.icon, cover: page?.cover, coverPosition: page?.coverPosition, locale: getLocale() })
}

/** Text pages for portability plus a full native snapshot for lossless reimport. */
export async function exportWorkspaceAsZip(): Promise<boolean> {
  if (!api.exportBinaryFile) throw new Error(t('Exportação ZIP requer o aplicativo desktop.', 'ZIP export requires the desktop app.'))
  await flushAllDocs()
  const { zipSync, strToU8 } = await import('fflate')
  // Locked password-protected pages (and their subpages) never leave the app.
  const exportable = withoutLockedPages(getState().pages)
  const pages = Object.values(exportable).filter((page) => selectors.isLive(page.id))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const pathFor = (id: string): string => {
    const parts: string[] = []
    const seen = new Set<string>()
    let current = byId.get(id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      parts.unshift(`${safeName(current.title || t('Sem título', 'Untitled')).slice(0, 72)}-${current.id.slice(0, 8)}`)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return parts.join('/')
  }
  const files: Record<string, Uint8Array> = {}
  const backup = await actions.backupSnapshot()
  files[COMPAT.record039] = strToU8(JSON.stringify(backup))
  const manifest: { id: string; parentId: string | null; title: string; markdown: string; html: string }[] = []
  for (const page of pages) {
    const base = pathFor(page.id)
    const markdown = `${base}.md`, html = `${base}.html`
    files[markdown] = strToU8(await pageToMarkdown(page.id))
    files[html] = strToU8(await pageToHTML(page.id))
    manifest.push({ id: page.id, parentId: page.parentId, title: page.title, markdown, html })
  }
  files['manifest.json'] = strToU8(JSON.stringify({ format: "workspace-workspace-export-v2", exportedAt: new Date().toISOString(), locale: getLocale(), pages: manifest, backup: COMPAT.record039, note: t('As páginas Markdown/HTML são conversões textuais. O backup JSON incluso preserva todas as páginas, lixeira, propriedades, anexos, configurações e histórico.', 'Markdown/HTML pages are text conversions. The included JSON backup preserves all pages, trash, properties, attachments, settings, and history.') }, null, 2))
  return api.exportBinaryFile(`${safeName(getState().settings.workspaceName || t('espaco', 'workspace'))}.zip`, zipSync(files, { level: 6 }))
}

function sanitizeHTML(html: string): string {
  // Remove fetch-capable attributes before DOMParser creates even an inert document.
  const noFetch = html
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(link|iframe|object|embed|base)\b[^>]*>/gi, '')
    .replace(/\s(src|srcset|poster)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (attribute, name: string, raw: string) => {
      const value = raw.replace(/^["']|["']$/g, '')
      return name.toLowerCase() === 'src' && /^data:image\//i.test(value) ? attribute : ''
    })
  const doc = new DOMParser().parseFromString(noFetch, 'text/html')
  doc.querySelectorAll('script,style,link,iframe,object,embed,form,meta,base,svg,canvas').forEach((node) => node.remove())
  doc.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'poster' || name === 'background' || name === 'xlink:href') node.removeAttribute(attribute.name)
    }
    const url = node.getAttribute('src') ?? ''
    if (url && !/^(data:|file:|blob:)/i.test(url)) node.removeAttribute('src')
  })
  return doc.body.innerHTML
}

function scrubRemoteMedia(blocks: unknown[]): unknown[] {
  return blocks.map((item) => {
    if (!item || typeof item !== 'object') return item
    const block = item as RawBlock
    const type = block.type
    const url = block.props?.url
    if (['image', 'video', 'audio', 'file'].includes(type ?? '') && typeof url === 'string' && url && !/^(data:|file:|blob:)/i.test(url)) {
      return { type: 'paragraph', content: [{ type: 'text', text: t('[Recurso externo omitido na importação local]', '[External resource omitted during local import]'), styles: {} }] }
    }
    return { ...block, children: Array.isArray(block.children) ? scrubRemoteMedia(block.children) : [] }
  })
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true })
  try {
    const document = await task.promise
    if (document.numPages > 300) throw new Error(t('O PDF excede 300 páginas.', 'The PDF exceeds 300 pages.'))
    const pages: string[] = []
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return pages.join('\n\n')
  } finally {
    await task.destroy()
  }
}

async function importSinglePage(file: File, parentId: string | null): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!['md', 'markdown', 'html', 'htm', 'txt', 'docx', 'pdf'].includes(ext ?? '')) throw new Error(t('Escolha Markdown, HTML, TXT, DOCX ou PDF.', 'Choose Markdown, HTML, TXT, DOCX, or PDF.'))
  if (file.size > 8 * 1024 * 1024) throw new Error(t('O arquivo excede o limite de 8 MB.', 'The file exceeds the 8 MB limit.'))
  let source: string
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    source = sanitizeHTML(result.value)
  } else if (ext === 'pdf') source = await pdfText(file)
  else source = await file.text()
  const isMarkdown = ext === 'md' || ext === 'markdown'
  const split = isMarkdown ? splitSinglePageMarkdown(source) : null
  const markdownBody = split?.body ?? source
  const meta = split?.meta ?? {}
  const parsed = ext === 'txt' || ext === 'pdf'
    ? source.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((part) => ({ type: 'paragraph', content: part.trim() }))
    : ext === 'html' || ext === 'htm' || ext === 'docx'
      ? editor().tryParseHTMLToBlocks(sanitizeHTML(source))
      : editor().tryParseMarkdownToBlocks(markdownBody)
  const blocks = scrubRemoteMedia(parsed)
  const title = meta.title || file.name.replace(/\.(md|markdown|html|htm|txt|docx|pdf)$/i, '').trim() || t('Página importada', 'Imported page')
  const typeIds = meta.types ? normalizePageTypes(meta.types.map((name) => findTypeByName(getState().settings.objectTypes ?? [], name)?.id)) : undefined
  const pageId = actions.createPage(parentId, { title, text: blocksToText(blocks), ...(meta.icon ? { icon: meta.icon } : {}), ...(meta.cover ? { cover: meta.cover, coverPosition: meta.coverPosition ?? 50 } : {}), ...(typeIds ? { types: typeIds } : {}) })
  await api.saveDoc(pageId, blocks)
  await actions.flushMeta()
  return pageId
}

/** B5: prévia somente-leitura (HTML já higienizado, sem recursos remotos) de um Markdown aberto avulso. */
export function markdownPreviewHtml(markdown: string): string {
  const { body } = splitSinglePageMarkdown(markdown)
  const blocks = scrubRemoteMedia(editor().tryParseMarkdownToBlocks(body))
  return sanitizeHTML(editor().blocksToHTMLLossy(replacePageBlocks(blocks as RawBlock[]) as never))
}

/** B5: "Importar como página" para um arquivo .md aberto avulso; devolve o id da página nova (na raiz). */
export function importMarkdownAsPage(name: string, text: string): Promise<string> {
  return importSinglePage(new File([text], /\.(md|markdown|txt)$/i.test(name) ? name : `${name}.md`, { type: 'text/markdown' }), null)
}

/** Importa subpáginas novas sem substituir o documento aberto. */
export async function importPageFile(file: File, parentId: string): Promise<string> {
  if (!/\.zip$/i.test(file.name)) return importSinglePage(file, parentId)
  if (file.size > 256 * 1024 * 1024) throw new Error(t('O ZIP excede 256 MB.', 'The ZIP exceeds 256 MB.'))
  const { unzipSync, strFromU8 } = await import('fflate')
  const archiveBytes = new Uint8Array(await file.arrayBuffer())
  const native = unzipSync(archiveBytes, { filter: entry => {
    if (entry.name !== COMPAT.record039) return false
    if (entry.originalSize > 512 * 1024 * 1024) throw new Error(t('O backup no ZIP excede 512 MB descompactados.', 'The backup in this ZIP exceeds 512 MB uncompressed.'))
    return true
  } })
  if (native[COMPAT.record039]) {
    const before = new Set(Object.keys(getState().pages))
    await actions.importBackup(JSON.parse(strFromU8(native[COMPAT.record039])), parentId)
    const root = Object.values(getState().pages).find(page => !before.has(page.id) && page.parentId === parentId)
    return root?.id ?? parentId
  }
  const packaged = await importWorkspacePackage(archiveBytes, parentId)
  if (packaged) return packaged
  const entries = unzipSync(archiveBytes, {
    filter: (entry) => entry.originalSize <= 8 * 1024 * 1024 && /\.(md|markdown|html|htm|txt|docx|pdf)$/i.test(entry.name),
  })
  const names = Object.keys(entries).sort()
  if (names.length === 0) throw new Error(t('O ZIP não contém páginas suportadas.', 'The ZIP contains no supported pages.'))
  if (names.length > 500 || names.reduce((sum, name) => sum + entries[name].byteLength, 0) > 64 * 1024 * 1024) throw new Error(t('O ZIP excede 500 páginas ou 64 MB extraídos.', 'The ZIP exceeds 500 pages or 64 MB extracted.'))
  for (const name of names) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..' || part === '.')) throw new Error(t('O ZIP contém um caminho inválido.', 'The ZIP contains an invalid path.'))
  }
  const rootId = actions.createPage(parentId, { title: file.name.replace(/\.zip$/i, '') || t('Importação ZIP', 'ZIP import') })
  await api.saveDoc(rootId, [])
  const folders = new Map<string, string>([['', rootId]])
  for (const name of names) {
    const parts = name.split('/')
    for (let depth = 1; depth < parts.length; depth++) {
      const path = parts.slice(0, depth).join('/')
      if (folders.has(path)) continue
      const folderId = actions.createPage(folders.get(parts.slice(0, depth - 1).join('/'))!, { title: parts[depth - 1] })
      await api.saveDoc(folderId, [])
      folders.set(path, folderId)
    }
    const bytes = entries[name]
    const imported = new File([new Uint8Array(bytes)], parts.at(-1)!, { type: 'application/octet-stream' })
    await importSinglePage(imported, folders.get(parts.slice(0, -1).join('/'))!)
  }
  await actions.flushMeta()
  return rootId
}
