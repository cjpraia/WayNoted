import COMPAT from '../../../shared/compatibility.ts'
// Importador de exportações do Export Bundle (Markdown & CSV ou HTML) → páginas, bancos e documentos do aplicativo.
// Puro: recebe um VirtualFS e devolve páginas/documentos; quem grava é a store (actions.importPageTree).
import type { DatabaseSchema, Page, Property, PropValue, View } from '../../types.ts'
import type { Locale } from '../../localization.ts'
import { translate } from '../../localization.ts'
import { pageBlock, type AssetRef, type Block, type ConvertContext, type WarningCode } from './blocks.ts'
import { markdownPlain, parseMarkdownBlocks } from './markdown.ts'
import { cellSample, collectionHeaders, convertNodes, readHtmlPage } from './html.ts'
import { detectDayFirst, planColumn, type CellSample, type ColumnEnv, type ColumnPlan, type BundleHint, type PageFields } from './properties.ts'
import { basename, dirname, joinPath, readText, type VirtualFS, type VfsIssue } from './vfs.ts'
import { dataUrl, idFromHref, isExternalHref, mimeFor, newId, resolveRelative, splitBundleName, stripId } from './util.ts'

export type ImportPhase = 'read' | 'analyze' | 'convert' | 'save'
export interface ImportWarning { code: WarningCode | VfsIssue['kind'] | 'empty' | 'enml-invalid' | 'encrypted' | 'resource-invalid' | 'note-too-large' | 'enex-truncated' | 'enex-note-invalid' | 'enex-empty'; message: string; count: number; examples: string[] }
export interface ImportPreview { pages: number; databases: number; rows: number; files: number; bytes: number; format: 'markdown' | 'html' | 'mixed' | 'none'; nestedArchives: number; warnings: ImportWarning[] }
export interface ImportResult { rootId: string; pages: Page[]; documents: Record<string, unknown[]>; warnings: ImportWarning[]; stats: { pages: number; databases: number; rows: number; files: number; links: number } }
export interface ImportOptions {
  locale: Locale
  /** DOMParser para exportações HTML (navegador: `new DOMParser().parseFromString`). */
  parseHTML?: (html: string) => Document
  signal?: AbortSignal
  onProgress?: (phase: ImportPhase, done: number, total: number) => void
  rootTitle?: string
  author?: string
  now?: number
  /** Arquivos maiores que isto não são copiados (aviso). */
  maxAssetBytes?: number
}

interface PlanNode {
  key: string
  file: string
  format: 'md' | 'html' | 'csv'
  /** CSV "_all" (todas as linhas) quando existe. */
  csvAll?: string
  /** HTML com a tabela do banco, quando a exportação é HTML. */
  kind: 'page' | 'database' | 'row'
  fileTitle: string
  bundleId: string | null
  childDir: string | null
  parent: PlanNode | null
  children: PlanNode[]
  id: string
  /** Linhas criadas a partir do CSV sem arquivo próprio. */
  synthetic?: boolean
}

export interface ExportPlan {
  vfs: VirtualFS
  nodes: PlanNode[]
  roots: PlanNode[]
  byFile: Map<string, PlanNode>
  byBundleId: Map<string, PlanNode>
  assets: string[]
  format: ImportPreview['format']
  csvRows: number
  warnings: Warnings
}

const PAGE_EXT = new Set(['md', 'markdown', 'html', 'htm'])

export class Warnings {
  private map = new Map<string, { count: number; examples: string[] }>()
  add(code: string, detail?: string) {
    const entry = this.map.get(code) ?? { count: 0, examples: [] }
    entry.count++
    if (detail && entry.examples.length < 5 && !entry.examples.includes(detail)) entry.examples.push(detail)
    this.map.set(code, entry)
  }
  list(locale: Locale): ImportWarning[] {
    return [...this.map].map(([code, entry]) => ({ code: code as ImportWarning['code'], message: warningMessage(locale, code, entry.count), count: entry.count, examples: entry.examples }))
  }
}

export function warningMessage(locale: Locale, code: string, count: number): string {
  const tr = (pt: string, en: string) => translate(locale, pt, en, { count })
  switch (code) {
    case 'broken-link': return tr('{count} link(s) apontam para páginas que não estão na exportação; o texto foi mantido sem link.', '{count} link(s) point to pages missing from the export; the text was kept without a link.')
    case 'missing-asset': return tr('{count} arquivo(s) ou imagem(ns) referenciados não estão na exportação.', '{count} referenced file(s) or image(s) are missing from the export.')
    case 'remote-media': return tr('{count} imagem(ns)/mídia(s) externas não foram baixadas (o app funciona offline); ficou um link.', '{count} external image(s)/media were not downloaded (the app works offline); a link was kept.')
    case 'remote-cover': return tr("{count} capa(s) externas da galeria do Export Bundle não foram baixadas.", "{count} external Export Bundle gallery cover(s) were not downloaded.")
    case 'asset-too-large': return tr('{count} arquivo(s) muito grandes não foram copiados.', '{count} file(s) were too large to copy.')
    case 'formula-static': return tr('{count} coluna(s) de fórmula viraram valores estáticos (texto/número); recrie a fórmula se precisar recalcular.', '{count} formula column(s) became static values (text/number); recreate the formula if it needs to recalculate.')
    case 'rollup-static': return tr('{count} coluna(s) de rollup viraram valores estáticos.', '{count} rollup column(s) became static values.')
    case 'relation-unresolved': return tr('{count} relação(ões) apontam para linhas fora da exportação e foram descartadas ou viraram texto.', '{count} relation(s) point to rows outside the export and were dropped or kept as text.')
    case 'person-text': return tr('{count} coluna(s) de pessoa foram importadas como texto.', '{count} person column(s) were imported as text.')
    case 'unparsed-file': return tr('{count} arquivo(s) de página não puderam ser lidos.', '{count} page file(s) could not be read.')
    case 'duplicate-page': return tr('{count} página(s) apareciam em Markdown e HTML; foi usada uma só cópia.', '{count} page(s) appeared as both Markdown and HTML; only one copy was used.')
    case 'unsupported-block': return tr('{count} bloco(s) sem equivalente foram convertidos em texto.', '{count} block(s) without an equivalent were converted to text.')
    case 'columns': return tr('{count} layout(s) em colunas foram ajustados.', '{count} column layout(s) were adjusted.')
    case 'unsafe-path': return tr('{count} entrada(s) com caminho inseguro foram ignoradas.', '{count} entr(ies) with unsafe paths were skipped.')
    case 'too-large': return tr('{count} entrada(s) acima do limite de tamanho foram ignoradas.', '{count} entr(ies) above the size limit were skipped.')
    case 'nested-depth': return tr('{count} ZIP(s) aninhados em profundidade excessiva foram ignorados.', '{count} ZIP(s) nested too deeply were skipped.')
    case 'bad-zip': return tr('{count} ZIP(s) corrompidos ou protegidos foram ignorados.', '{count} corrupted or protected ZIP(s) were skipped.')
    case 'duplicate': return tr('{count} arquivo(s) repetidos entre partes do ZIP com conteúdo diferente; o primeiro foi mantido.', '{count} file(s) repeated across ZIP parts with different content; the first was kept.')
    case 'enml-invalid': return tr('{count} nota(s) com conteúdo ENML inválido foram importadas como texto simples.', '{count} note(s) with invalid ENML content were imported as plain text.')
    case 'encrypted': return tr("{count} trecho(s) criptografados do ENEX Archive não podem ser lidos; ficou um aviso no lugar.", "{count} ENEX Archive-encrypted passage(s) cannot be read; a placeholder was left.")
    case 'resource-invalid': return tr('{count} anexo(s) com dados inválidos foram ignorados.', '{count} attachment(s) with invalid data were skipped.')
    case 'note-too-large': return tr('{count} nota(s) acima do limite de tamanho foram ignoradas.', '{count} note(s) above the size limit were skipped.')
    case 'enex-truncated': return tr('{count} arquivo(s) ENEX terminam no meio de uma nota (truncados); a última nota foi ignorada.', '{count} ENEX file(s) end mid-note (truncated); the last note was skipped.')
    case 'enex-note-invalid': return tr('{count} nota(s) com XML inválido foram ignoradas.', '{count} note(s) with invalid XML were skipped.')
    case 'apple-locked': return tr('{count} nota(s) protegidas por senha no Notas foram ignoradas (o conteúdo não é lido).', '{count} password-protected note(s) in Notes were skipped (their content is never read).')
    case 'apple-note-too-large': return tr('{count} nota(s) acima do limite de tamanho foram ignoradas.', '{count} note(s) above the size limit were skipped.')
    case 'apple-note-failed': return tr('{count} nota(s) com HTML inesperado foram importadas como texto simples.', '{count} note(s) with unexpected HTML were imported as plain text.')
    case 'apple-batch-failed': return tr('{count} lote(s) de notas não puderam ser lidos do Notas e foram ignorados.', '{count} batch(es) of notes could not be read from Notes and were skipped.')
    case 'enex-empty': return tr("Nenhuma nota do ENEX Archive foi encontrada. Escolha um ou mais arquivos .enex (Arquivo → Exportar notas no ENEX Archive).", "No ENEX Archive notes were found. Choose one or more .enex files (File → Export Notes in ENEX Archive).")
    case 'empty': return tr("Nenhuma página do Export Bundle foi encontrada. Escolha o ZIP ou a pasta exportada com “Markdown & CSV” ou “HTML”.", "No Export Bundle pages were found. Choose the ZIP or folder exported with “Markdown & CSV” or “HTML”.")
    default: return tr('{count} aviso(s).', '{count} warning(s).')
  }
}

function abortError(): Error { const error = new Error('Importação cancelada.'); error.name = 'AbortError'; return error }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

// ---------------------------------------------------------------- análise

export function analyzeExport(vfs: VirtualFS): ExportPlan {
  const warnings = new Warnings()
  for (const issue of vfs.issues) warnings.add(issue.kind, issue.path)
  const directories = new Set<string>()
  for (const path of vfs.files.keys()) { let dir = dirname(path); while (dir && !directories.has(dir)) { directories.add(dir); dir = dirname(dir) } }

  const byKey = new Map<string, PlanNode>()
  const assets: string[] = []
  let markdown = 0, html = 0
  const paths = [...vfs.files.keys()].sort((a, b) => a.localeCompare(b))
  for (const path of paths) {
    const name = basename(path)
    const parsed = splitBundleName(name)
    const dir = dirname(path)
    if (!dir && /^index\.html?$/i.test(name)) continue
    if (parsed.ext === 'csv') {
      const stem = parsed.id ? `${parsed.title} ${parsed.id}` : parsed.title
      const key = joinPath(dir, stem)
      const existing = byKey.get(key)
      if (existing) {
        existing.kind = 'database'
        if (parsed.all) existing.csvAll = path
        else if (existing.format !== 'html') { existing.file = path; existing.format = 'csv' }
        if (parsed.all && existing.format === 'md') { existing.format = 'csv'; existing.file = path }
        continue
      }
      byKey.set(key, node(key, path, 'csv', 'database', parsed.title, parsed.id, parsed.all ? { csvAll: path } : {}))
      continue
    }
    if (!PAGE_EXT.has(parsed.ext)) { assets.push(path); continue }
    const isHtml = parsed.ext === 'html' || parsed.ext === 'htm'
    if (isHtml) html++; else markdown++
    const key = joinPath(dir, name.slice(0, name.lastIndexOf('.')))
    const existing = byKey.get(key)
    if (existing) {
      if (existing.format === 'csv' && isHtml) {
        // Banco em HTML + CSV: o HTML traz cores e tipos; o CSV continua como fonte das linhas.
        existing.csvAll = existing.csvAll ?? existing.file
        existing.file = path; existing.format = 'html'
      } else if (existing.format !== 'csv') warnings.add('duplicate-page', path)
      continue
    }
    let kind: PlanNode['kind'] = 'page'
    if (isHtml && /class="[^"]*collection-content/.test(readText(vfs.files.get(path)!))) kind = 'database'
    byKey.set(key, node(key, path, isHtml ? 'html' : 'md', kind, parsed.title, parsed.id))
  }

  // Pasta de filhos: "Nome id/" ou, em exportações novas, "Nome/" quando não é ambíguo.
  const nodes = [...byKey.values()]
  const strippedClaims = new Map<string, number>()
  for (const item of nodes) { const stripped = joinPath(dirname(item.key), stripId(basename(item.key))); strippedClaims.set(stripped, (strippedClaims.get(stripped) ?? 0) + 1) }
  const owners = new Map<string, PlanNode>()
  for (const item of nodes) {
    if (directories.has(item.key) && !owners.has(item.key)) { item.childDir = item.key; owners.set(item.key, item); continue }
    const stripped = joinPath(dirname(item.key), stripId(basename(item.key)))
    if (stripped !== item.key && directories.has(stripped) && strippedClaims.get(stripped) === 1 && !byKey.has(stripped) && !owners.has(stripped)) { item.childDir = stripped; owners.set(stripped, item) }
  }
  const roots: PlanNode[] = []
  for (const item of nodes) {
    let dir = dirname(item.file)
    let parent: PlanNode | null = null
    while (dir) { const owner = owners.get(dir); if (owner && owner !== item) { parent = owner; break } dir = dirname(dir) }
    item.parent = parent
    if (parent) parent.children.push(item)
    else roots.push(item)
  }
  for (const item of nodes) if (item.parent?.kind === 'database') item.kind = 'row'

  const byFile = new Map<string, PlanNode>()
  const byBundleId = new Map<string, PlanNode>()
  for (const item of nodes) {
    byFile.set(item.file, item)
    if (item.csvAll) byFile.set(item.csvAll, item)
    byFile.set(item.key, item)
    if (item.bundleId && !byBundleId.has(item.bundleId)) byBundleId.set(item.bundleId, item)
  }
  // Ambos os arquivos (.md/.html/.csv) do mesmo nó resolvem para ele.
  for (const path of paths) { const ext = splitBundleName(basename(path)).ext; if (PAGE_EXT.has(ext) || ext === 'csv') { const key = path.slice(0, path.lastIndexOf('.')).replace(/_all$/i, ''); const target = byKey.get(key); if (target && !byFile.has(path)) byFile.set(path, target) } }

  let csvRows = 0
  for (const item of nodes) if (item.kind === 'database' && (item.csvAll ?? (item.format === 'csv' ? item.file : null))) {
    const rows = parseCsv(readText(vfs.files.get(item.csvAll ?? item.file)!))
    csvRows += Math.max(0, rows.length - 1)
  }
  if (!nodes.length) warnings.add('empty')
  const format = markdown && html ? 'mixed' : html ? 'html' : markdown || nodes.length ? 'markdown' : 'none'
  return { vfs, nodes, roots, byFile, byBundleId, assets, format, csvRows, warnings }
}

function node(key: string, file: string, format: PlanNode['format'], kind: PlanNode['kind'], fileTitle: string, bundleId: string | null, extra: Partial<PlanNode> = {}): PlanNode {
  return { key, file, format, kind, fileTitle, bundleId, childDir: null, parent: null, children: [], id: newId(), ...extra }
}

export function previewExport(plan: ExportPlan, locale: Locale): ImportPreview {
  const databases = plan.nodes.filter(item => item.kind === 'database')
  const rowFiles = plan.nodes.filter(item => item.kind === 'row').length
  const rows = Math.max(rowFiles, plan.csvRows)
  const pages = plan.nodes.filter(item => item.kind === 'page').length
  let bytes = 0
  for (const data of plan.vfs.files.values()) bytes += data.byteLength
  return { pages: pages + rows, databases: databases.length, rows, files: plan.assets.length, bytes, format: plan.format, nestedArchives: plan.vfs.nestedArchives, warnings: plan.warnings.list(locale) }
}

// ---------------------------------------------------------------- CSV

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { cell += '"'; index++ } else quoted = false }
      else cell += char
      continue
    }
    if (char === '"' && cell === '') { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(cell); rows.push(row); row = []; cell = ''
      continue
    }
    cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(entry => entry.some(value => value.trim() !== ''))
}

// ---------------------------------------------------------------- construção

interface Loaded {
  title: string
  icon: string | null
  cover: string | null
  coverPosition: number
  /** Markdown sem título/propriedades. */
  markdown?: string
  /** Document HTML (conversão do corpo é feita na 2ª fase). */
  htmlBody?: Element | null
  htmlCollection?: Element | null
  /** Propriedades declaradas no arquivo da linha. */
  props: Map<string, Omit<CellSample, 'fromFile'>>
}

const PROP_LINE = /^([^:\n]{1,120}?):\s?(.*)$/

function loadMarkdown(source: string, knownColumns: Set<string> | null): Loaded {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length && !lines[index].trim()) index++
  let title = ''
  if (/^#\s+/.test(lines[index] ?? '')) { title = markdownPlain(lines[index].replace(/^#\s+/, '').trim()); index++ }
  const props = new Map<string, Omit<CellSample, 'fromFile'>>()
  if (knownColumns) {
    let cursor = index
    while (cursor < lines.length && !lines[cursor].trim()) cursor++
    const start = cursor
    while (cursor < lines.length) {
      const match = PROP_LINE.exec(lines[cursor])
      if (!match || (knownColumns.size && !knownColumns.has(match[1].trim())) || /^\s/.test(lines[cursor]) || /^(#|-|\*|>|\d+\.|!\[|\[|<)/.test(lines[cursor])) break
      props.set(match[1].trim(), { raw: match[2].trim() })
      cursor++
    }
    if (cursor > start) index = cursor
  }
  return { title, icon: null, cover: null, coverPosition: 50, markdown: lines.slice(index).join('\n'), props }
}

export async function buildImport(plan: ExportPlan, options: ImportOptions): Promise<ImportResult> {
  const { vfs } = plan
  const locale = options.locale
  const warnings = plan.warnings
  const now = options.now ?? Date.now()
  const maxAsset = options.maxAssetBytes ?? 100 * 1024 * 1024
  const author = options.author ?? translate(locale, "Importado do Export Bundle", "Imported from Export Bundle")
  const rootId = newId()
  const check = () => { if (options.signal?.aborted) throw abortError() }
  const loaded = new Map<PlanNode, Loaded>()
  const assetCache = new Map<string, AssetRef | null>()
  let assetsCopied = 0, links = 0

  const lookupFile = (path: string): PlanNode | undefined => plan.byFile.get(path) ?? plan.byFile.get(path.replace(/\.(md|html?|csv)$/i, '')) ?? plan.byFile.get(path.replace(/_all\.csv$/i, ''))
  const resolveNode = (fromFile: string, href: string): PlanNode | null => {
    if (!href) return null
    if (isExternalHref(href)) {
      if (!new RegExp(COMPAT.record077, "i").test(href)) return null
      const id = idFromHref(href)
      return id ? plan.byBundleId.get(id) ?? null : null
    }
    const path = resolveRelative(fromFile, href)
    const direct = path ? lookupFile(path) : undefined
    if (direct) return direct
    if (path && vfs.files.has(path) && !/\.(md|html?|csv)$/i.test(path)) return null
    const id = idFromHref(href)
    return id ? plan.byBundleId.get(id) ?? null : null
  }
  const resolveAsset = (fromFile: string, href: string): AssetRef | null => {
    if (!href || isExternalHref(href)) return null
    let path = resolveRelative(fromFile, href)
    if (path && !vfs.files.has(path)) {
      // Alguns exports referenciam a partir da raiz.
      const fromRoot = resolveRelative('', href)
      path = fromRoot && vfs.files.has(fromRoot) ? fromRoot : path
    }
    if (!path || !vfs.files.has(path) || /\.(md|html?|csv)$/i.test(path)) return null
    if (assetCache.has(path)) return assetCache.get(path)!
    const data = vfs.files.get(path)!
    if (data.byteLength > maxAsset) { warnings.add('asset-too-large', path); assetCache.set(path, null); return null }
    const mime = mimeFor(path)
    const asset = { url: dataUrl(data, mime), name: basename(path), mime, size: data.byteLength }
    assetCache.set(path, asset)
    assetsCopied++
    return asset
  }

  // Fase 1: lê títulos, ícones e propriedades de todos os arquivos.
  const columnsOf = new Map<PlanNode, string[]>()
  const csvOf = new Map<PlanNode, string[][]>()
  for (const item of plan.nodes) if (item.kind === 'database') {
    const csvPath = item.csvAll ?? (item.format === 'csv' ? item.file : null)
    if (csvPath) { const rows = parseCsv(readText(vfs.files.get(csvPath)!)); csvOf.set(item, rows); columnsOf.set(item, rows[0] ?? []) }
  }
  let done = 0
  for (const item of plan.nodes) {
    if (++done % 100 === 0) { check(); options.onProgress?.('analyze', done, plan.nodes.length); await tick() }
    if (item.format === 'csv') { loaded.set(item, { title: item.fileTitle, icon: null, cover: null, coverPosition: 50, props: new Map() }); continue }
    const data = vfs.files.get(item.file)!
    try {
      if (item.format === 'md') {
        const known = item.kind === 'row' && item.parent ? new Set(columnsOf.get(item.parent)?.slice(1) ?? []) : null
        loaded.set(item, loadMarkdown(readText(data), known))
      } else {
        if (!options.parseHTML) throw new Error('HTML parser unavailable')
        const doc = options.parseHTML(readText(data))
        const ctx = contextFor(item)
        const page = readHtmlPage(doc, ctx)
        const props = new Map(page.properties.map(entry => [entry.name, entry.sample]))
        loaded.set(item, { title: page.title, icon: page.icon, cover: page.cover, coverPosition: page.coverPosition, htmlBody: page.body, htmlCollection: page.collection, props })
      }
    } catch {
      warnings.add('unparsed-file', item.file)
      loaded.set(item, { title: item.fileTitle, icon: null, cover: null, coverPosition: 50, markdown: '', props: new Map() })
    }
  }

  function contextFor(item: PlanNode): ConvertContext {
    const childIds = new Set(item.children.map(child => child.id))
    return {
      file: item.file,
      resolvePage: href => { const target = resolveNode(item.file, href); if (target) links++; return target?.id ?? null },
      isChild: id => childIds.has(id),
      resolveAsset: href => resolveAsset(item.file, href),
      warn: (code, detail) => warnings.add(code, detail ? `${item.file} → ${detail}` : item.file),
      referenced: new Set(),
    }
  }

  // Linhas: CSV/tabela HTML + arquivos de linha.
  interface RowEntry { node: PlanNode; title: string; samples: Map<string, CellSample> }
  const rowsOf = new Map<PlanNode, RowEntry[]>()
  const headersOf = new Map<PlanNode, { name: string; hint?: BundleHint }[]>()
  for (const db of plan.nodes) {
    if (db.kind !== 'database') continue
    const rowNodes = db.children.filter(child => child.kind === 'row')
    const unmatched = new Map<string, PlanNode[]>()
    for (const row of rowNodes) { const title = loaded.get(row)?.title || row.fileTitle; unmatched.set(title, [...unmatched.get(title) ?? [], row]) }
    const take = (title: string, href?: string): PlanNode | null => {
      if (href) { const target = resolveNode(db.csvAll ?? db.file, href); if (target && target.parent === db) { const list = unmatched.get(loaded.get(target)?.title || target.fileTitle); if (list?.includes(target)) list.splice(list.indexOf(target), 1); return target } }
      const list = unmatched.get(title)
      return list?.length ? list.shift()! : null
    }
    const entries: RowEntry[] = []
    const csv = csvOf.get(db)
    const collection = loaded.get(db)?.htmlCollection
    let headers: { name: string; hint?: BundleHint }[] = []
    if (collection) {
      headers = collectionHeaders(collection)
      for (const tr of collection.querySelectorAll('tbody tr')) {
        const cells = [...tr.children].filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH')
        const titleCell = cells[0]
        const title = (titleCell?.textContent ?? '').trim()
        const href = titleCell?.querySelector('a')?.getAttribute('href') ?? undefined
        const rowNode = take(title, href) ?? syntheticRow(db, title)
        const samples = new Map<string, CellSample>()
        cells.forEach((cell, index) => { if (index > 0 && headers[index]) samples.set(headers[index].name, { ...cellSample(cell, headers[index].hint), fromFile: db.file }) })
        entries.push({ node: rowNode, title, samples })
      }
    } else if (csv?.length) {
      headers = csv[0].map(name => ({ name: name.trim() }))
      const csvFile = db.csvAll ?? db.file
      for (const record of csv.slice(1)) {
        const title = (record[0] ?? '').trim()
        const rowNode = take(title) ?? syntheticRow(db, title)
        const samples = new Map<string, CellSample>()
        headers.forEach((header, index) => { if (index > 0) samples.set(header.name, { raw: record[index] ?? '', fromFile: csvFile }) })
        entries.push({ node: rowNode, title, samples })
      }
    }
    // Linhas que só existem como arquivo (sem CSV/tabela).
    for (const list of unmatched.values()) for (const row of list) entries.push({ node: row, title: loaded.get(row)?.title || row.fileTitle, samples: new Map() })
    // Complementa com as propriedades do arquivo de cada linha (tipos do HTML, valores ausentes no CSV).
    for (const entry of entries) {
      const own = loaded.get(entry.node)?.props
      if (!own) continue
      for (const [name, sample] of own) {
        if (!headers.some(header => header.name === name)) headers.push({ name })
        const existing = entry.samples.get(name)
        if (!existing || (!existing.raw.trim() && !existing.chips?.length)) entry.samples.set(name, { ...sample, fromFile: entry.node.file })
        else if (sample.hint && !existing.hint) existing.hint = sample.hint
      }
    }
    if (!headers.length) headers = [{ name: translate(locale, 'Nome', 'Name') }]
    headersOf.set(db, headers)
    rowsOf.set(db, entries)
    for (const entry of entries) if (!entry.node.synthetic) loaded.get(entry.node)!.title = loaded.get(entry.node)!.title || entry.title
  }

  function syntheticRow(db: PlanNode, title: string): PlanNode {
    const row = node(`${db.key}/#row-${db.children.length}`, db.file, 'csv', 'row', title, null, { synthetic: true })
    row.parent = db
    db.children.push(row)
    plan.nodes.push(row)
    loaded.set(row, { title, icon: null, cover: null, coverPosition: 50, markdown: '', props: new Map() })
    return row
  }

  // Índice de títulos de linhas (relações exportadas só com nomes).
  const rowsByTitle = new Map<string, { pageId: string; databaseId: string }[]>()
  for (const [db, entries] of rowsOf) for (const entry of entries) {
    const title = (loaded.get(entry.node)?.title || entry.title).trim()
    rowsByTitle.set(title, [...rowsByTitle.get(title) ?? [], { pageId: entry.node.id, databaseId: db.id }])
  }
  const env: ColumnEnv = {
    resolveLink: (fromFile, href) => { const target = resolveNode(fromFile, href); return target ? { pageId: target.id, databaseId: target.kind === 'row' ? target.parent!.id : null } : null },
    rowsByTitle: title => rowsByTitle.get(title.trim()) ?? [],
    resolveAsset,
    warn: (code, detail) => warnings.add(code, detail),
  }

  // Esquemas e valores.
  const schemas = new Map<PlanNode, DatabaseSchema>()
  const rowValues = new Map<PlanNode, { props: Record<string, PropValue>; page: PageFields }>()
  const relationProps: { db: PlanNode; property: Property }[] = []
  for (const [db, headers] of headersOf) {
    const entries = rowsOf.get(db)!
    const titleIndex = Math.max(0, headers.findIndex(header => header.hint === 'title'))
    const titleProperty: Property = { id: newId(), name: headers[titleIndex]?.name || translate(locale, 'Nome', 'Name'), type: 'title' }
    const plans: ColumnPlan[] = []
    headers.forEach((header, index) => {
      if (index === titleIndex) return
      const samples = entries.map(entry => entry.samples.get(header.name) ?? { raw: '', fromFile: db.file })
      for (const sample of samples) if (!sample.hint && header.hint) sample.hint = header.hint
      plans.push(planColumn(header.name, samples, env, { dayFirst: detectDayFirst(samples.map(sample => sample.raw), locale) }))
    })
    for (const entry of entries) {
      const props: Record<string, PropValue> = {}
      const page: PageFields = {}
      headers.forEach((header, index) => {
        if (index === titleIndex) return
        const columnPlan = plans[index > titleIndex ? index - 1 : index]
        const sample = entry.samples.get(header.name)
        if (!sample) return
        const converted = columnPlan.convert(sample)
        if (converted.value !== undefined && converted.value !== null && !(Array.isArray(converted.value) && !converted.value.length) && converted.value !== '') props[columnPlan.property.id] = converted.value
        Object.assign(page, converted.page)
      })
      rowValues.set(entry.node, { props, page })
    }
    const properties = [titleProperty, ...plans.map(item => item.property)]
    const view: View = { id: newId(), name: translate(locale, 'Tabela', 'Table'), type: 'table', filters: [], sorts: [], hidden: [], widths: {} }
    schemas.set(db, { properties, views: [view], activeViewId: view.id })
    for (const property of properties) if (property.type === 'relation') relationProps.push({ db, property })
  }
  // Relações de mão dupla: pareia quando há exatamente uma em cada sentido.
  for (const { db, property } of relationProps) {
    const target = plan.nodes.find(item => item.id === property.relationDatabaseId)
    if (!target || target === db || property.relationMirrorPropertyId) continue
    const forward = relationProps.filter(entry => entry.db === db && entry.property.relationDatabaseId === target.id)
    const backward = relationProps.filter(entry => entry.db === target && entry.property.relationDatabaseId === db.id)
    if (forward.length === 1 && backward.length === 1 && !backward[0].property.relationMirrorPropertyId) {
      property.relationMirrorPropertyId = backward[0].property.id
      backward[0].property.relationMirrorPropertyId = property.id
    }
  }

  // Fase 2: corpo das páginas.
  const documents: Record<string, unknown[]> = {}
  const pages: Page[] = []
  const orderOf = new Map<PlanNode, number>()
  const total = plan.nodes.length
  done = 0
  for (const item of plan.nodes) {
    if (++done % 50 === 0) { check(); options.onProgress?.('convert', done, total); await tick() }
    const info = loaded.get(item)!
    const ctx = contextFor(item)
    let blocks: Block[] = []
    if (item.kind !== 'database') {
      try {
        if (info.markdown !== undefined) blocks = parseMarkdownBlocks(info.markdown, ctx)
        else if (info.htmlBody) blocks = convertNodes(info.htmlBody.childNodes, ctx)
      } catch {
        warnings.add('unparsed-file', item.file)
        blocks = []
      }
      // Subpáginas que o corpo não citou continuam visíveis no fim, como no Export Bundle.
      for (const child of item.children) if (!ctx.referenced.has(child.id)) blocks.push(pageBlock(child.id, false))
    }
    // Ordem entre irmãos: ordem em que o pai os cita.
    let order = 0
    for (const id of ctx.referenced) { const child = item.children.find(entry => entry.id === id); if (child && !orderOf.has(child)) orderOf.set(child, order++) }
    for (const child of [...item.children].sort((a, b) => (loaded.get(a)?.title || a.fileTitle).localeCompare(loaded.get(b)?.title || b.fileTitle))) if (!orderOf.has(child)) orderOf.set(child, order++)
    documents[item.id] = blocks
  }
  const entriesOrder = new Map<PlanNode, number>()
  for (const entries of rowsOf.values()) entries.forEach((entry, index) => entriesOrder.set(entry.node, index))
  const rootChildren = [...plan.roots].sort((a, b) => (loaded.get(a)?.title || a.fileTitle).localeCompare(loaded.get(b)?.title || b.fileTitle))
  rootChildren.forEach((item, index) => orderOf.set(item, index))

  for (const item of plan.nodes) {
    const info = loaded.get(item)!
    const values = rowValues.get(item)
    const title = (info.title || item.fileTitle || '').trim()
    pages.push(makePage({
      id: item.id,
      parentId: item.parent ? item.parent.id : rootId,
      title: title === 'Untitled' ? '' : title,
      icon: info.icon,
      cover: info.cover,
      coverPosition: info.coverPosition,
      order: item.kind === 'row' ? entriesOrder.get(item) ?? 0 : orderOf.get(item) ?? 0,
      createdAt: values?.page.createdAt ?? now,
      updatedAt: values?.page.updatedAt ?? now,
      createdBy: values?.page.createdBy ?? author,
      updatedBy: values?.page.updatedBy ?? author,
      ...(item.kind === 'database' ? { database: schemas.get(item) } : {}),
      ...(item.kind === 'row' ? { props: values?.props ?? {} } : {}),
    }))
  }
  const rootTitle = options.rootTitle ?? translate(locale, "Importado do Export Bundle", "Imported from Export Bundle")
  documents[rootId] = rootChildren.map(item => pageBlock(item.id, false))
  pages.unshift(makePage({ id: rootId, parentId: null, title: rootTitle, icon: '📥', cover: null, coverPosition: 50, order: 0, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author }))
  options.onProgress?.('convert', total, total)
  const databases = plan.nodes.filter(item => item.kind === 'database').length
  const rows = plan.nodes.filter(item => item.kind === 'row').length
  return {
    rootId, pages, documents,
    warnings: warnings.list(locale),
    stats: { pages: plan.nodes.length - databases, databases, rows, files: assetsCopied, links },
  }
}

function makePage(init: Pick<Page, 'id' | 'parentId' | 'title' | 'icon' | 'cover' | 'coverPosition' | 'order' | 'createdAt' | 'updatedAt'> & Partial<Page>): Page {
  return {
    favorite: false, trashed: false, trashedAt: null, fullWidth: false, smallText: false, font: 'default', locked: false, text: '',
    blockOwnerId: null,
    ...init,
  }
}

/** Atalho: VFS → resultado completo. */
export async function importBundleExport(vfs: VirtualFS, options: ImportOptions): Promise<ImportResult> {
  return buildImport(analyzeExport(vfs), options)
}
