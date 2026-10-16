// Importador de vaults do Markdown Vault (pasta ou ZIP com .md + anexos) → páginas hierárquicas do aplicativo.
// Reaproveita o VirtualFS e o conversor Markdown do importador do Export Bundle. Puro: quem grava é a store.
import type { Page } from '../../types.ts'
import type { Locale } from '../../localization.ts'
import { translate } from '../../localization.ts'
import { block, pageBlock, text, type AssetRef, type Block, type ConvertContext, type InlineNode } from '../bundle/blocks.ts'
import { Warnings, type ImportOptions, type ImportPreview, type ImportResult } from '../bundle/importer.ts'
import { markdownPlain, parseMarkdownBlocks } from '../bundle/markdown.ts'
import { dataUrl, isExternalHref, mimeFor, newId, resolveRelative, safeDecode } from '../bundle/util.ts'
import { basename, dirname, readText, type VirtualFS } from '../bundle/vfs.ts'
import { fmDate, fmList, fmText, parseFrontmatter, type FmValue } from './frontmatter.ts'
import { convertMarkdownSyntax } from './syntax.ts'

export interface VaultNode {
  id: string
  /** Arquivo .md; null para pasta sem nota própria. */
  file: string | null
  /** Pasta que este nó representa, se houver. */
  dir: string | null
  title: string
  parent: VaultNode | null
  children: VaultNode[]
  aliases: string[]
}
export interface VaultPlan {
  vfs: VirtualFS
  nodes: VaultNode[]
  roots: VaultNode[]
  byPath: Map<string, VaultNode>
  byName: Map<string, VaultNode[]>
  /** Anexos (qualquer arquivo que não seja nota). */
  assets: string[]
  assetsByName: Map<string, string[]>
  warnings: Warnings
  notes: number
}

const NOTE = /\.(md|markdown)$/i
const hidden = (path: string) => path.split('/').some(part => part.startsWith('.'))
const stem = (name: string) => name.replace(NOTE, '')
const lower = (value: string) => value.normalize('NFC').toLowerCase()

export function isVault(vfs: VirtualFS): boolean {
  return [...vfs.files.keys()].some(path => NOTE.test(path) && !hidden(path))
}

export function analyzeVault(vfs: VirtualFS): VaultPlan {
  const warnings = new Warnings()
  for (const issue of vfs.issues) warnings.add(issue.kind, issue.path)
  const nodes: VaultNode[] = []
  const byPath = new Map<string, VaultNode>()
  const assets: string[] = []
  const assetsByName = new Map<string, string[]>()
  const fileNodes: VaultNode[] = []
  const paths = [...vfs.files.keys()].sort((a, b) => a.localeCompare(b))
  for (const path of paths) {
    if (hidden(path)) continue
    if (NOTE.test(path)) {
      const node: VaultNode = { id: newId(), file: path, dir: null, title: stem(basename(path)), parent: null, children: [], aliases: [] }
      fileNodes.push(node); byPath.set(path, node); nodes.push(node)
      continue
    }
    if (/\.(canvas|base|excalidraw)$/i.test(path)) { warnings.add('unsupported-block', path); continue }
    assets.push(path)
    const key = lower(basename(path))
    assetsByName.set(key, [...assetsByName.get(key) ?? [], path])
  }

  // Pastas com notas (diretas ou aninhadas).
  const dirs = new Set<string>()
  for (const node of fileNodes) for (let dir = dirname(node.file!); dir; dir = dirname(dir)) dirs.add(dir)
  // Dono de cada pasta: nota de pasta (Pasta/Pasta.md), nota irmã (Pasta.md ao lado de Pasta/) ou pasta sintética.
  const dirOwner = new Map<string, VaultNode>()
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
    const name = basename(dir)
    const owner = byPath.get(`${dir}/${name}.md`) ?? byPath.get(`${dir}/${name}.markdown`) ?? byPath.get(dir ? `${dirname(dir) ? dirname(dir) + '/' : ''}${name}.md` : '')
    if (owner && !owner.dir) { owner.dir = dir; dirOwner.set(dir, owner); continue }
    const synthetic: VaultNode = { id: newId(), file: null, dir, title: name, parent: null, children: [], aliases: [] }
    nodes.push(synthetic); dirOwner.set(dir, synthetic)
  }
  const ownerOf = (dir: string): VaultNode | null => (dir ? dirOwner.get(dir) ?? null : null)
  const roots: VaultNode[] = []
  for (const node of nodes) {
    // Pasta sintética e nota de pasta sobem um nível; as demais notas pertencem à pasta onde estão.
    let parent: VaultNode | null
    if (!node.file) parent = ownerOf(dirname(node.dir!))
    else { const home = dirname(node.file); parent = node.dir === home ? ownerOf(dirname(home)) : ownerOf(home) }
    node.parent = parent && parent !== node ? parent : null
    if (node.parent) node.parent.children.push(node); else roots.push(node)
  }
  const byName = new Map<string, VaultNode[]>()
  const addName = (name: string, node: VaultNode) => { const key = lower(name); const list = byName.get(key) ?? []; if (!list.includes(node)) list.push(node); byName.set(key, list) }
  for (const node of nodes) if (node.file) addName(node.title, node)
  return { vfs, nodes, roots, byPath, byName, assets, assetsByName, warnings, notes: fileNodes.length }
}

export function previewVault(plan: VaultPlan, locale: Locale): ImportPreview {
  let bytes = 0
  for (const data of plan.vfs.files.values()) bytes += data.byteLength
  return { pages: plan.nodes.length, databases: 0, rows: 0, files: plan.assets.length, bytes, format: plan.notes ? 'markdown' : 'none', nestedArchives: plan.vfs.nestedArchives, warnings: plan.warnings.list(locale) }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const abortError = () => Object.assign(new Error('Importação cancelada.'), { name: 'AbortError' })

function closest<T extends { path: string }>(candidates: T[], from: string): T {
  const dir = dirname(from)
  return [...candidates].sort((a, b) => {
    const sa = dirname(a.path) === dir ? 0 : 1, sb = dirname(b.path) === dir ? 0 : 1
    return sa - sb || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)
  })[0]
}

/** Tabela "Propriedades" com o front-matter (chave → valor), no topo da página. */
function propertiesTable(keys: string[], data: Record<string, FmValue>, locale: Locale): Block | null {
  const rows = keys.filter(key => data[key] !== null && fmText(data[key]) !== '').map(key => {
    const value = data[key]
    const display = typeof value === 'boolean' ? (value ? translate(locale, 'Sim', 'Yes') : translate(locale, 'Não', 'No'))
      : /^(tags?)$/i.test(key) ? fmList(value).map(tag => `#${tag.replace(/^#/, '')}`).join(' ') : fmText(value)
    return [[text(key, { bold: true })] as InlineNode[], [text(display)] as InlineNode[]]
  })
  if (!rows.length) return null
  return block('table', {}, { type: 'tableContent', rows: rows.map(cells => ({ cells })) })
}

export async function buildVaultImport(plan: VaultPlan, options: ImportOptions): Promise<ImportResult> {
  const { vfs } = plan
  const locale = options.locale
  const warnings = plan.warnings
  const now = options.now ?? Date.now()
  const maxAsset = options.maxAssetBytes ?? 100 * 1024 * 1024
  const author = options.author ?? translate(locale, "Importado do Markdown Vault", "Imported from Markdown Vault")
  const rootId = newId()
  const check = () => { if (options.signal?.aborted) throw abortError() }
  const assetCache = new Map<string, AssetRef | null>()
  let assetsCopied = 0, links = 0

  // Front-matter de todas as notas primeiro (aliases entram no índice de nomes).
  const parsed = new Map<VaultNode, ReturnType<typeof parseFrontmatter>>()
  let done = 0
  for (const node of plan.nodes) {
    if (!node.file) continue
    if (++done % 200 === 0) { check(); options.onProgress?.('analyze', done, plan.nodes.length); await tick() }
    const fm = parseFrontmatter(readText(vfs.files.get(node.file)!))
    parsed.set(node, fm)
    node.aliases = fmList(fm.data.aliases ?? fm.data.alias)
    for (const alias of node.aliases) { const key = lower(alias); const list = plan.byName.get(key) ?? []; if (!list.includes(node)) list.push(node); plan.byName.set(key, list) }
  }

  const pathsLower = new Map<string, VaultNode>()
  for (const node of plan.nodes) if (node.file) pathsLower.set(lower(stem(node.file)), node)

  const resolveWiki = (fromFile: string, rawTarget: string): VaultNode | null => {
    const target = lower(safeDecode(rawTarget)).replace(/\.(md|markdown)$/, '').replace(/^\/+/, '').trim()
    if (!target) return null
    if (target.includes('/')) {
      const exact = pathsLower.get(target)
      if (exact) return exact
      const suffix = [...pathsLower].filter(([path]) => path.endsWith(`/${target}`))
      if (suffix.length) return closest(suffix.map(([path, node]) => ({ path, node })), fromFile).node
      return resolveWiki(fromFile, target.split('/').pop()!)
    }
    const found = plan.byName.get(target)
    if (!found?.length) return null
    return found.length === 1 ? found[0] : closest(found.map(node => ({ path: node.file!, node })), fromFile).node
  }
  const findAssetPath = (fromFile: string, target: string): string | null => {
    const clean = safeDecode(target).replace(/^\/+/, '').normalize('NFC')
    if (vfs.files.has(clean) && !hidden(clean)) return clean
    const key = lower(basename(clean))
    const candidates = plan.assetsByName.get(key)
    if (!candidates?.length) return null
    const matching = clean.includes('/') ? candidates.filter(path => lower(path).endsWith(lower(clean))) : candidates
    const pool = matching.length ? matching : candidates
    return closest(pool.map(path => ({ path })), fromFile).path
  }
  const resolveAsset = (fromFile: string, href: string): AssetRef | null => {
    if (!href || isExternalHref(href)) return null
    let path = resolveRelative(fromFile, href)
    if (!path || !vfs.files.has(path)) {
      const fromRoot = resolveRelative('', href)
      path = fromRoot && vfs.files.has(fromRoot) ? fromRoot : findAssetPath(fromFile, href)
    }
    if (!path || !vfs.files.has(path) || NOTE.test(path)) return null
    if (assetCache.has(path)) return assetCache.get(path)!
    const data = vfs.files.get(path)!
    if (data.byteLength > maxAsset) { warnings.add('asset-too-large', path); assetCache.set(path, null); return null }
    const mime = mimeFor(path)
    const asset = { url: dataUrl(data, mime), name: basename(path), mime, size: data.byteLength }
    assetCache.set(path, asset); assetsCopied++
    return asset
  }

  const contextFor = (node: VaultNode): ConvertContext => {
    const file = node.file ?? ''
    const childIds = new Set(node.children.map(child => child.id))
    return {
      file,
      resolvePage: href => {
        let target: VaultNode | null = null
        if (href.startsWith("markdown:")) {
          const name = safeDecode(href.slice("markdown:".length))
          target = resolveWiki(file, name)
          if (!target) { warnings.add('broken-link', `${file} → [[${name}]]`); return null }
        } else if (!isExternalHref(href) && !href.startsWith('#')) {
          const path = resolveRelative(file, href) ?? resolveRelative('', href)
          target = path ? plan.byPath.get(path) ?? plan.byPath.get(`${path}.md`) ?? null : null
          if (!target && path && NOTE.test(path)) { const root = resolveRelative('', href); target = root ? plan.byPath.get(root) ?? null : null }
        }
        if (target) links++
        return target?.id ?? null
      },
      isChild: id => childIds.has(id),
      resolveAsset: href => resolveAsset(file, href),
      warn: (code, detail) => warnings.add(code, detail ? `${file} → ${detail}` : file),
      referenced: new Set(),
    }
  }

  const documents: Record<string, unknown[]> = {}
  const meta = new Map<VaultNode, { icon: string | null; createdAt: number; updatedAt: number }>()
  done = 0
  for (const node of plan.nodes) {
    if (++done % 50 === 0) { check(); options.onProgress?.('convert', done, plan.nodes.length); await tick() }
    const ctx = contextFor(node)
    let blocks: Block[] = []
    let icon: string | null = null, createdAt = now, updatedAt = now
    const fm = parsed.get(node)
    if (node.file && fm) {
      try {
        let body = fm.body
        // O título já é o nome do arquivo: remove um H1 idêntico no começo.
        const firstLine = body.replace(/^\s*\n/, '').split('\n', 1)[0]
        if (/^#\s+/.test(firstLine) && lower(markdownPlain(firstLine.replace(/^#\s+/, ''))) === lower(node.title)) body = body.replace(/^\s*\n?[^\n]*\n?/, '')
        const converted = convertMarkdownSyntax(body, {
          asset: target => { const path = findAssetPath(node.file!, target); return path ? `/${path}` : null },
          note: target => !!resolveWiki(node.file!, target),
        })
        blocks = parseMarkdownBlocks(converted, ctx)
        const table = fm.found ? propertiesTable(fm.keys, fm.data, locale) : null
        if (table) blocks.unshift(table)
        const iconValue = fm.data.icon
        if (typeof iconValue === 'string' && iconValue.length <= 8 && /\P{ASCII}/u.test(iconValue)) icon = iconValue
        const created = fmDate(fm.data.created ?? fm.data['date created'] ?? fm.data.date), updated = fmDate(fm.data.updated ?? fm.data.modified ?? fm.data['date modified'])
        if (created) createdAt = created
        updatedAt = updated ?? created ?? now
      } catch {
        warnings.add('unparsed-file', node.file)
        blocks = []
      }
    }
    for (const child of node.children) if (!ctx.referenced.has(child.id)) blocks.push(pageBlock(child.id, false))
    documents[node.id] = blocks
    meta.set(node, { icon, createdAt, updatedAt })
  }

  const byTitle = (a: VaultNode, b: VaultNode) => a.title.localeCompare(b.title, undefined, { numeric: true })
  const orderOf = new Map<VaultNode, number>()
  for (const node of [...plan.nodes, null]) {
    const list = [...(node ? node.children : plan.roots)].sort(byTitle)
    list.forEach((child, index) => orderOf.set(child, index))
  }
  const pages: Page[] = plan.nodes.map(node => makePage({
    id: node.id, parentId: node.parent ? node.parent.id : rootId, title: node.title,
    icon: meta.get(node)?.icon ?? null, cover: null, coverPosition: 50, order: orderOf.get(node) ?? 0,
    createdAt: meta.get(node)?.createdAt ?? now, updatedAt: meta.get(node)?.updatedAt ?? now, createdBy: author, updatedBy: author,
  }))
  const rootTitle = options.rootTitle ?? translate(locale, "Importado do Markdown Vault", "Imported from Markdown Vault")
  documents[rootId] = [...plan.roots].sort(byTitle).map(node => pageBlock(node.id, false))
  pages.unshift(makePage({ id: rootId, parentId: null, title: rootTitle, icon: '📥', cover: null, coverPosition: 50, order: 0, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author }))
  options.onProgress?.('convert', plan.nodes.length, plan.nodes.length)
  return { rootId, pages, documents, warnings: warnings.list(locale), stats: { pages: plan.nodes.length, databases: 0, rows: 0, files: assetsCopied, links } }
}

function makePage(init: Pick<Page, 'id' | 'parentId' | 'title' | 'icon' | 'cover' | 'coverPosition' | 'order' | 'createdAt' | 'updatedAt'> & Partial<Page>): Page {
  return { favorite: false, trashed: false, trashedAt: null, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', blockOwnerId: null, ...init }
}

export async function importMarkdownVault(vfs: VirtualFS, options: ImportOptions): Promise<ImportResult> {
  return buildVaultImport(analyzeVault(vfs), options)
}
