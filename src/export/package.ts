import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.ts'
// Monta o pacote exportado (Markdown ou HTML) a partir do formato interno do store. Puro e testável.
import type { Page, Property } from '../types'
import { stringifyCsv } from '../components/database/csv.ts'
import { localPageLink } from '../components/page/links.ts'
import { blocksToMarkdown, type BlockWriteContext } from './markdown.ts'
import { checklistsFrom, queryExport } from '../query/exportResult.ts'
import { blocksToHtml, esc, EXPORT_CSS, inlineHtml, type HtmlContext } from './html.ts'
import { stringifyFrontMatter, yamlMap } from './frontMatter.ts'
import { buildLayout, childrenOf, livePages, type Layout, type LayoutNode } from './layout.ts'
import { readableText, readableValue } from './values.ts'
import { glyphSvg } from '../components/ui/icons/svg.ts'
import { pageTypeFields, pageTypes, typeDataHidden } from '../objecttypes/model.ts'
import {
  AssetStore, encodeLinkPath, externalizeAssets, object, PACKAGE_FORMAT, PACKAGE_MANIFEST, PACKAGE_VERSION, relativePath, tr,
  type ExportOptions, type ExportSource, type ManifestPage, type PackageFiles, type PackageManifest, type RawBlock,
} from './model.ts'

/** Campos de Page gravados com nome próprio no front-matter ou derivados (não vão em `extra`). */
const KNOWN_FIELDS = new Set(['id', 'parentId', 'title', 'icon', 'cover', 'coverPosition', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'favorite', 'locked', 'fullWidth', 'smallText', 'font', 'order',
  'props', 'database', 'comments', 'sequence', 'subitemParentId', 'dependencyIds', 'blockOwnerId',
  'text', 'bodyText', 'outboundPageIds', 'bodyOutboundPageIds', 'syncedBlockIds', 'pendingTemplateBlocks', 'removedByBlock', 'blockConversion', 'trashed', 'trashedAt', 'types', 'typeProps'])

const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null)
const isImage = (value: string | null | undefined) => !!value && (value.startsWith('data:') || /^(https?:|file:|blob:)/i.test(value) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(value))

/** Ids de blocos citados por links (`#block=`) e comentários: preservados no Markdown. */
export function referencedBlockIds(source: ExportSource): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!object(value)) return
    for (const href of [value.href, value.url]) if (typeof href === 'string') { const match = localPageLink.exec(href); if (match?.[2]) ids.add(match[2]) }
    Object.values(value).forEach(walk)
  }
  walk(source.documents)
  walk(Object.values(source.syncedBlocks ?? {}).map((record) => record.blocks))
  for (const page of Object.values(source.pages)) {
    for (const comment of page.comments ?? []) {
      if (comment.blockId) ids.add(comment.blockId)
      for (const segment of comment.textAnchor?.segments ?? []) ids.add(segment.blockId)
    }
    if (page.removedByBlock?.blockId) ids.add(page.removedByBlock.blockId)
  }
  return ids
}

function rowsOf(source: ExportSource, db: Page): Page[] {
  const live = livePages(source.pages)
  const ids = [db.database?.linkedSourceId ?? db.id, ...(db.database?.sourceDatabaseIds ?? [])]
  return [...new Map(ids.flatMap((id) => childrenOf(live, id)).map((row) => [row.id, row])).values()]
}

function schemaFor(source: ExportSource, db: Page) {
  const own = db.database!
  const linked = own.linkedSourceId ? source.pages[own.linkedSourceId]?.database : undefined
  return linked ? { ...own, properties: linked.properties } : own
}

export async function buildExportPackage(source: ExportSource, options: ExportOptions): Promise<{ files: PackageFiles; manifest: PackageManifest; layout: Layout }> {
  const locale = source.locale
  const t = (pt: string, en: string) => tr(locale, pt, en)
  const untitled = t('Sem título', 'Untitled')
  const ext = options.format === 'html' ? 'html' : 'md'
  const layout = buildLayout(source.pages, options.scope, options.pageId, ext, untitled, options.stableNames === true)
  const assets = new AssetStore(options.includeFiles)
  const keepIds = options.keepIds ?? referencedBlockIds(source)
  const files: PackageFiles = {}
  const total = layout.order.length
  const label = (page: Page | undefined) => page ? `${page.icon && !page.icon.startsWith('data:') && [...page.icon].length <= 4 ? page.icon + ' ' : ''}${page.title || untitled}` : t('Página excluída', 'Deleted page')

  const linkTo = (fromFile: string, href: string): string => {
    const match = localPageLink.exec(href)
    const node = match ? layout.nodes.get(match[1]) : undefined
    if (!match || !node) return href
    return encodeLinkPath(relativePath(fromFile, node.file)) + (match[2] ? `#block=${match[2]}` : '')
  }
  const media = (fromFile: string, url: string, name: string): string => {
    if (!url.startsWith('data:')) return linkTo(fromFile, url)
    const path = assets.add(url, name)
    if (path === null) return url
    return path ? encodeLinkPath(relativePath(fromFile, path)) : ''
  }
  // Consultas vivas: resultado calculado sobre as páginas exportáveis (sem protegidas/lixeira) no momento da exportação.
  let checklists: ReturnType<typeof checklistsFrom> | null = null
  const queryResult = (pageId: string | undefined) => (props: Record<string, unknown>) => {
    try { return queryExport(props, source.pages, { thisPageId: pageId, locale: locale === 'en-US' ? 'en-US' : 'pt-BR', checklists: (checklists ??= checklistsFrom(source.documents, source.pages)) }) } catch { return null }
  }
  const contextFor = (file: string, pageId?: string): BlockWriteContext & HtmlContext => ({
    queryResult: queryResult(pageId),
    includePlayers: options.includePlayers === true,
    href: (href) => linkTo(file, href),
    media: (url, name) => media(file, url, name),
    json: (value) => externalizeAssets(value, assets, file),
    pageLink: (pageId) => {
      const node = layout.nodes.get(pageId)
      return { label: label(source.pages[pageId]), destination: node ? encodeLinkPath(relativePath(file, node.file)) : `workspace://page/${pageId}` }
    },
    synced: (id) => source.syncedBlocks?.[id]?.blocks,
    keepIds,
    activeSynced: new Set<string>(),
  })
  const doc = (id: string) => (source.documents[id] ?? []).filter(object) as RawBlock[]
  const markdownOf = (blocks: RawBlock[], ctx: BlockWriteContext) => blocksToMarkdown(blocks, ctx)

  const frontMatter = (node: LayoutNode): string => {
    const page = node.page
    const fromFile = node.file
    const json = <T,>(value: T) => externalizeAssets(value, assets, fromFile, page.title || 'arquivo')
    const parentDb = node.kind === 'row' && page.parentId ? source.pages[page.parentId] : undefined
    const schema = parentDb?.database ? schemaFor(source, parentDb) : undefined
    const readable = schema ? yamlMap(Object.fromEntries(schema.properties.filter((prop) => prop.type !== 'title' && prop.type !== 'button').map((prop) => [prop.name, readableValue(page, prop, source.pages)]))) : undefined
    const extra = Object.fromEntries(Object.entries(page).filter(([key, value]) => !KNOWN_FIELDS.has(key) && value !== undefined))
    // Tipos de objeto: nomes e valores legíveis (`tipos`, `campos`) + ids/valores exatos para o round-trip.
    const objectTypes = source.objectTypes ?? []
    const typed = page.types?.length ? pageTypes(objectTypes, page) : []
    const typeValues = typed.length && !typeDataHidden(page) ? page.typeProps : undefined
    const projected = typeValues ? { ...page, props: typeValues } : page
    const campos = typeValues ? yamlMap(Object.fromEntries(pageTypeFields(objectTypes, page).map(({ property }) => [property.name, readableValue(projected, property, source.pages)]).filter(([, value]) => value !== null))) : undefined
    return stringifyFrontMatter([
      ['id', page.id],
      ['title', page.title],
      ['kind', node.kind],
      ['parent', page.parentId],
      ['icon', page.icon ? json(page.icon) : null],
      ['cover', page.cover ? json(page.cover) : null],
      ['cover_position', page.coverPosition],
      ['created', iso(page.createdAt)],
      ['updated', iso(page.updatedAt)],
      ['created_by', page.createdBy],
      ['updated_by', page.updatedBy],
      ['favorite', page.favorite],
      ['locked', page.locked],
      ['full_width', page.fullWidth],
      ['small_text', page.smallText],
      ['font', page.font],
      ['order', page.order],
      ['sequence', page.sequence],
      ['subitem_parent', page.subitemParentId ?? undefined],
      ['dependencies', page.dependencyIds?.length ? page.dependencyIds : undefined],
      ['block_owner', page.blockOwnerId ?? undefined],
      ['schema', node.kind === 'database' ? 'schema.json' : undefined],
      ['properties', readable],
      ['props', page.props && Object.keys(page.props).length ? json(page.props) : undefined],
      ['comments', page.comments?.length ? json(page.comments) : undefined],
      ['tipos', typed.length ? typed.map((type) => type.name) : undefined],
      ['campos', campos && Object.keys(campos).length ? campos : undefined],
      ['type_ids', page.types?.length ? page.types : undefined],
      ['type_props', typeValues && Object.keys(typeValues).length ? json(typeValues) : undefined],
      ['extra', Object.keys(extra).length ? json(extra) : undefined],
    ])
  }

  const rowCells = (row: Page, prop: Property) => readableText(readableValue(row, prop, source.pages), locale)

  const databaseFiles = (node: LayoutNode) => {
    const db = node.page
    const schema = schemaFor(source, db)
    const rows = rowsOf(source, db)
    const props = schema.properties.filter((prop) => prop.type !== 'button')
    const csvName = `${node.dir ? node.dir + '/' : ''}${node.base}.csv`
    files[csvName] = stringifyCsv([[...props.map((prop) => prop.name), 'workspace_id'], ...rows.map((row) => [...props.map((prop) => rowCells(row, prop)), row.id])])
    const schemaFile = `${node.dir}/schema.json`
    const describe = (id: string | undefined) => {
      const target = id ? layout.nodes.get(id) : undefined
      return { id: id ?? null, title: id ? source.pages[id]?.title ?? null : null, path: target ? relativePath(schemaFile, target.file) : null }
    }
    files[schemaFile] = JSON.stringify({
      format: COMPAT.record046, version: 1, id: db.id, title: db.title,
      schema: externalizeAssets(db.database, assets, schemaFile),
      relations: schema.properties.filter((prop) => prop.type === 'relation').map((prop) => ({ propertyId: prop.id, name: prop.name, database: describe(prop.relationDatabaseId), mirrorPropertyId: prop.relationMirrorPropertyId ?? null })),
      formulas: schema.properties.filter((prop) => prop.type === 'formula').map((prop) => ({ propertyId: prop.id, name: prop.name, formula: prop.formula ?? '' })),
      rollups: schema.properties.filter((prop) => prop.type === 'rollup').map((prop) => ({ propertyId: prop.id, name: prop.name, ...prop.rollup })),
      linkedSource: schema === db.database ? null : describe(db.database?.linkedSourceId),
    }, null, 2)
    return { rows, props }
  }

  const markdownPage = (node: LayoutNode): string => {
    const page = node.page
    const ctx = contextFor(node.file, node.page.id)
    const heading = `# ${label(page)}`
    let body = markdownOf(doc(page.id), ctx)
    if (node.kind === 'database') {
      const { rows, props } = databaseFiles(node)
      const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
      const title = props.find((prop) => prop.type === 'title')
      const columns = props.filter((prop) => prop.type !== 'title').slice(0, 12)
      const table = [`| ${[title?.name ?? t('Nome', 'Name'), ...columns.map((prop) => prop.name)].map(cell).join(' | ')} |`, `| ${['---', ...columns.map(() => '---')].join(' | ')} |`,
        ...rows.map((row) => {
          const target = layout.nodes.get(row.id)
          const name = cell(row.title || untitled)
          const first = target ? `[${name}](${encodeLinkPath(relativePath(node.file, target.file))})` : name
          return `| ${[first, ...columns.map((prop) => cell(rowCells(row, prop)))].join(' | ')} |`
        })]
      body = [body, '<!-- np:rows -->', `*${t('Linhas do banco de dados', 'Database rows')} — ${rows.length} · [CSV](${encodeLinkPath(node.base)}.csv) · [schema.json](schema.json)*`, table.join('\n'), '<!-- /np:rows -->'].filter(Boolean).join('\n\n')
    }
    return `${frontMatter(node)}\n\n${heading}\n${body ? `\n${body}\n` : ''}`
  }

  // ---------- HTML ----------
  const treeHtml = (fromFile: string, current: string): string => {
    if (layout.order.length > 400) return ''
    const list = (items: LayoutNode[]): string => `<ul>${items.map((item) => `<li><a href="${esc(encodeLinkPath(relativePath(fromFile, item.file)))}"${item.page.id === current ? ' aria-current="page"' : ''}>${esc(label(item.page))}</a>${item.children.length && item.kind !== 'database' ? list(item.children) : ''}</li>`).join('')}</ul>`
    return `<nav class="tree" aria-label="${esc(t('Páginas', 'Pages'))}"><a class="ws" href="${esc(relativePath(fromFile, 'index.html'))}">${esc(source.workspaceName)}</a>${list(layout.roots)}</nav>`
  }
  const htmlShell = (fromFile: string, title: string, current: string, crumbs: string, content: string) =>
    `<!doctype html>\n<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="${PRODUCT.name}"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head><body><div class="shell">${treeHtml(fromFile, current)}<main>${crumbs}${content}</main></div></body></html>\n`

  const optionChip = (prop: Property, row: Page) => {
    const value = row.props?.[prop.id]
    const ids = Array.isArray(value) ? value : [value]
    if (prop.type !== 'select' && prop.type !== 'status' && prop.type !== 'multiSelect') return esc(rowCells(row, prop))
    return ids.map((id) => prop.options?.find((option) => option.id === id)).filter(Boolean).map((option) => `<span class="chip bg-${esc(option!.color)}">${esc(option!.name)}</span>`).join('')
  }
  const htmlPage = (node: LayoutNode): string => {
    const page = node.page
    const ctx = contextFor(node.file, node.page.id)
    const ancestors: LayoutNode[] = []
    for (let parent = page.parentId ? layout.nodes.get(page.parentId) : undefined; parent; parent = parent.page.parentId ? layout.nodes.get(parent.page.parentId) : undefined) ancestors.unshift(parent)
    const crumbs = `<nav class="crumbs"><a href="${esc(relativePath(node.file, 'index.html'))}">${esc(source.workspaceName)}</a>${ancestors.map((item) => `<span>/</span><a href="${esc(encodeLinkPath(relativePath(node.file, item.file)))}">${esc(label(item.page))}</a>`).join('')}<span>/</span><span>${esc(page.title || untitled)}</span></nav>`
    const cover = page.cover ? isImage(page.cover) ? `<div class="cover" style="background-image:url('${esc(ctx.media(page.cover, 'capa'))}');background-position:center ${Number(page.coverPosition) || 50}%"></div>` : /^[#a-z0-9(),.%\s-]+$/i.test(page.cover) ? `<div class="cover" style="background:${esc(page.cover)}"></div>` : '' : ''
    const icon = page.icon ? isImage(page.icon) ? `<div class="page-icon"><img src="${esc(ctx.media(page.icon, 'icone'))}" alt=""></div>` : `<div class="page-icon">${glyphSvg(page.icon) ?? esc(page.icon)}</div>` : ''
    let props = ''
    const parentDb = node.kind === 'row' && page.parentId ? source.pages[page.parentId] : undefined
    if (parentDb?.database) {
      const schema = schemaFor(source, parentDb)
      props = `<dl class="props">${schema.properties.filter((prop) => prop.type !== 'title' && prop.type !== 'button').map((prop) => `<div><dt>${esc(prop.name)}</dt><dd>${prop.type === 'relation' ? (Array.isArray(page.props?.[prop.id]) ? (page.props![prop.id] as string[]) : []).map((id) => { const link = ctx.pageLink(id); return `<a href="${esc(link.destination)}">${esc(link.label)}</a>` }).join(', ') : optionChip(prop, page)}</dd></div>`).join('')}</dl>`
    }
    let body = blocksToHtml(doc(page.id), ctx)
    if (node.kind === 'database') {
      const { rows, props: columns } = databaseFiles(node)
      body += `<p class="muted">${rows.length} · <a href="${esc(encodeLinkPath(node.base))}.csv">CSV</a> · <a href="schema.json">schema.json</a></p><div class="table-wrap"><table><tr>${columns.map((prop) => `<th>${esc(prop.name)}</th>`).join('')}</tr>${rows.map((row) => `<tr>${columns.map((prop) => {
        if (prop.type === 'title') { const target = layout.nodes.get(row.id); return `<td>${target ? `<a href="${esc(encodeLinkPath(relativePath(node.file, target.file)))}">${esc(label(row))}</a>` : esc(row.title)}</td>` }
        return `<td>${optionChip(prop, row)}</td>`
      }).join('')}</tr>`).join('')}</table></div>`
    }
    const kids = node.kind === 'database' ? [] : node.children
    const sub = kids.length ? `<section class="subpages"><ul>${kids.map((child) => `<li><a href="${esc(encodeLinkPath(relativePath(node.file, child.file)))}">${esc(label(child.page))}</a></li>`).join('')}</ul></section>` : ''
    return htmlShell(node.file, page.title || untitled, page.id, crumbs, `${cover}<article>${icon}<h1 class="title">${esc(page.title || untitled)}</h1>${props}${body}${sub}</article>`)
  }

  let done = 0
  for (const node of layout.order) {
    if (options.only && !options.only.has(node.page.id)) { done++; continue }
    options.onProgress?.(done, total, node.page.title || untitled)
    files[node.file] = ext === 'html' ? htmlPage(node) : markdownPage(node)
    done++
    if (done % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  options.onProgress?.(total, total, t('Arquivos', 'Files'))

  if (options.skipManifest) {
    const quick: PackageManifest = { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt: '', generator: `${PRODUCT.name}`, output: options.format, workspaceName: source.workspaceName, locale, scope: options.scope, rootIds: layout.roots.map((node) => node.page.id), includeFiles: options.includeFiles, pages: [], assets: {}, syncedBlocks: [] }
    if (ext === 'md' && source.objectTypes?.length) files['types.json'] = JSON.stringify({ format: COMPAT.record047, version: 1, types: externalizeAssets(source.objectTypes, assets, 'types.json') }, null, 2)
    Object.assign(files, assets.files)
    quick.assets = assets.headers
    return { files, manifest: quick, layout }
  }
  const usedTypes = new Set(layout.order.flatMap((node) => node.page.types ?? []))
  if (ext === 'md' && source.objectTypes?.length && (usedTypes.size || options.scope === 'workspace')) {
    files['types.json'] = JSON.stringify({ format: COMPAT.record047, version: 1, types: externalizeAssets(options.scope === 'workspace' ? source.objectTypes : source.objectTypes.filter((type) => usedTypes.has(type.id) || source.objectTypes!.some((child) => usedTypes.has(child.id) && child.parentTypes?.includes(type.id))), assets, 'types.json') }, null, 2)
  }
  const manifestPages: ManifestPage[] = layout.order.map((node) => ({ id: node.page.id, parentId: node.page.parentId, path: node.file, kind: node.kind, order: node.page.order, title: node.page.title }))
  const usedSynced = Object.values(source.syncedBlocks ?? {}).filter((record) => layout.order.some((node) => node.page.syncedBlockIds?.includes(record.id) || JSON.stringify(source.documents[node.page.id] ?? []).includes(record.id)))
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT, version: PACKAGE_VERSION, exportedAt: (options.now ?? new Date()).toISOString(), generator: `${PRODUCT.name}`, output: options.format,
    workspaceName: source.workspaceName, locale, scope: options.scope, rootIds: layout.roots.map((node) => node.page.id), includeFiles: options.includeFiles,
    pages: manifestPages, assets: {},
    syncedBlocks: ext === 'md' ? usedSynced.map((record) => ({ id: record.id, sourcePageId: record.sourcePageId, updatedAt: record.updatedAt, markdown: markdownOf(record.blocks.filter(object) as RawBlock[], contextFor(PACKAGE_MANIFEST)) })) : [],
  }
  if (ext === 'html') {
    const list = (items: LayoutNode[]): string => `<ul>${items.map((item) => `<li><a href="${esc(encodeLinkPath(item.file))}">${esc(label(item.page))}</a>${item.children.length && item.kind !== 'database' ? list(item.children) : ''}</li>`).join('')}</ul>`
    files['index.html'] = htmlShell('index.html', source.workspaceName, '', '', `<article><h1 class="title">${esc(source.workspaceName)}</h1>${list(layout.roots)}</article>`)
  }
  Object.assign(files, assets.files)
  manifest.assets = assets.headers
  files[PACKAGE_MANIFEST] = JSON.stringify(manifest, null, 2)
  return { files, manifest, layout }
}

export { inlineHtml }
