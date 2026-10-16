import COMPAT from '../../shared/compatibility.ts'
// Pacote Markdown exportado pelo aplicativo → backup interno (WorkspaceBackup), pronto para `actions.importBackup`.
// Usa `schema.json` de cada banco e o front-matter de cada página; o manifesto é opcional (ordem, blocos sincronizados).
import type { DatabaseSchema, Page, PageComment, PropValue, SyncedBlockRecord, WorkspaceBackup } from '../types'
import { defaultSettings } from '../workspace.ts'
import { effectiveProperties, findTypeByName, normalizeObjectTypes, normalizePageTypes, validPropValue, type ObjectType } from '../objecttypes/model.ts'
import { blocksToText } from '../components/page/util.ts'
import { parseFrontMatter } from './frontMatter.ts'
import { markdownToBlocks, type BlockReadContext } from './parseMarkdown.ts'
import { fromReadable } from './values.ts'
import {
  assetDataUrl, decodeLinkPath, dirname, internalizeAssets, newId, object, PACKAGE_MANIFEST, resolvePath, UUID,
  type PackageManifest, type RawBlock,
} from './model.ts'

export type PackageInput = Record<string, Uint8Array>
const decoder = new TextDecoder()
const text = (bytes: Uint8Array | undefined) => (bytes ? decoder.decode(bytes) : '')

/** Detecta um pacote do aplicativo (com ou sem pasta-raiz dentro do ZIP). */
export function findPackageRoot(paths: string[]): string | null {
  const manifest = paths.filter((path) => [PACKAGE_MANIFEST, COMPAT.record043].some(name => path === name || path.endsWith('/' + name))).sort((a, b) => a.length - b.length)[0]
  return manifest === undefined ? null : dirname(manifest)
}

function stripRoot(files: PackageInput, root: string): PackageInput {
  if (!root) return files
  const prefix = root + '/'
  return Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, bytes]) => [path.slice(prefix.length), bytes]))
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const bool = (value: unknown) => value === true
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const time = (value: unknown, fallback: number) => { const ms = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN; return Number.isFinite(ms) ? ms : fallback }

/** Anexos exportados sem arquivos (opção desligada) não têm conteúdo: são descartados na importação. */
function withoutMissingFiles(props: Record<string, PropValue>): Record<string, PropValue> {
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key, Array.isArray(value) && value.length && value.every((item) => object(item) && 'data' in item)
    ? (value as unknown as Record<string, unknown>[]).filter((file) => typeof file.data === 'string' && file.data.startsWith('data:')) as unknown as PropValue
    : value]))
}

interface Entry { path: string; data: Record<string, unknown>; body: string; id: string; database?: DatabaseSchema }

export function packageToBackup(input: PackageInput, now = Date.now()): WorkspaceBackup {
  const root = findPackageRoot(Object.keys(input))
  if (root === null) throw new Error("NOT_A_WORKSPACE_PACKAGE")
  const files = { ...stripRoot(input, root) }
  if (!files[PACKAGE_MANIFEST] && files[COMPAT.record043]) files[PACKAGE_MANIFEST] = files[COMPAT.record043]
  let manifest: Partial<PackageManifest> = {}
  try { manifest = JSON.parse(text(files[PACKAGE_MANIFEST])) } catch { throw new Error('INVALID_MANIFEST') }
  const headers = object(manifest.assets) ? manifest.assets as Record<string, string> : {}
  const assetsIn = <T,>(value: T, from: string) => internalizeAssets(value, from, files, headers)

  // 1. Páginas: front-matter + caminho.
  const entries: Entry[] = []
  const byPath = new Map<string, Entry>()
  const usedIds = new Set<string>()
  for (const path of Object.keys(files).sort()) {
    if (!path.endsWith('.md') || path.startsWith('assets/')) continue
    const { data, body } = parseFrontMatter(text(files[path]))
    let id = str(data.id)
    if (!UUID.test(id) || usedIds.has(id)) id = newId()
    usedIds.add(id)
    const entry: Entry = { path, data, body, id }
    if (path.endsWith('/index.md') || path === 'index.md') {
      const schemaPath = dirname(path) ? `${dirname(path)}/schema.json` : 'schema.json'
      if (files[schemaPath]) {
        try {
          const parsed = JSON.parse(text(files[schemaPath]))
          if (object(parsed) && object(parsed.schema)) entry.database = assetsIn(parsed.schema, schemaPath) as unknown as DatabaseSchema
        } catch { throw new Error(`INVALID_SCHEMA:${schemaPath}`) }
      }
    }
    entries.push(entry)
    byPath.set(path, entry)
  }
  if (!entries.length) throw new Error('EMPTY_PACKAGE')
  const ids = new Set(entries.map((entry) => entry.id))

  // Pai: front-matter, senão a pasta (A/B.md → A.md ou A/index.md).
  const folderOwner = (path: string): Entry | undefined => {
    let dir = dirname(path)
    if (path.endsWith('/index.md')) dir = dirname(dir)
    if (!dir) return undefined
    return byPath.get(`${dir}.md`) ?? byPath.get(`${dir}/index.md`)
  }
  const parentOf = (entry: Entry): string | null => {
    const declared = str(entry.data.parent)
    if (declared && ids.has(declared) && declared !== entry.id) return declared
    return folderOwner(entry.path)?.id ?? null
  }

  // Links: caminho relativo a um .md do pacote → workspace://page/<id>.
  const resolveLink = (from: string, destination: string): string => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('#')) return destination
    const [rawPath, fragment = ''] = destination.split('#')
    const path = resolvePath(from, decodeLinkPath(rawPath))
    const target = path ? byPath.get(path) ?? byPath.get(path.replace(/\/$/, '') + '/index.md') : undefined
    if (target) return `workspace://page/${target.id}${/^block=/.test(fragment) ? '#' + fragment : ''}`
    return destination
  }
  const readContext = (from: string): BlockReadContext => ({
    href: (destination) => resolveLink(from, destination),
    media: (destination) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return destination
      const path = resolvePath(from, decodeLinkPath(destination))
      return path && files[path] ? assetDataUrl(path, files[path], headers) : destination
    },
    json: (value) => assetsIn(value, from),
  })

  const pages: Record<string, Page> = {}
  const documents: Record<string, unknown[]> = {}
  const titles = new Map<string, string>()
  for (const entry of entries) titles.set(str(entry.data.title), entry.id)
  const schemaOf = (id: string | null) => {
    const entry = id ? entries.find((item) => item.id === id) : undefined
    if (!entry?.database) return undefined
    const linked = entry.database.linkedSourceId ? entries.find((item) => item.id === entry.database!.linkedSourceId)?.database : undefined
    return linked ? { ...entry.database, properties: linked.properties } : entry.database
  }
  // Tipos de objeto: `types.json` (definições) + `type_ids`/`type_props` (exato) ou `tipos`/`campos` (legível).
  let objectTypes: ObjectType[] = []
  if (files['types.json']) {
    try { const parsed = JSON.parse(text(files['types.json'])); objectTypes = normalizeObjectTypes(object(parsed) ? assetsIn(parsed.types, 'types.json') : []) } catch { throw new Error('INVALID_TYPES:types.json') }
  }
  const typesFor = (data: Record<string, unknown>): string[] | undefined => {
    const ids = normalizePageTypes(data.type_ids)
    if (ids) return ids
    const names = Array.isArray(data.tipos) ? data.tipos : typeof data.tipos === 'string' ? [data.tipos] : []
    return normalizePageTypes(names.map((name) => findTypeByName(objectTypes, String(name))?.id))
  }
  const manifestOrder = new Map((Array.isArray(manifest.pages) ? manifest.pages : []).map((item, index) => [item.id, num(item.order, index)]))

  entries.forEach((entry, index) => {
    const data = entry.data
    const parentId = parentOf(entry)
    let body = entry.body.replace(/^\s*\n/, '')
    if (/^# .*(\n|$)/.test(body)) body = body.replace(/^# .*(\n|$)/, '')
    const blocks = markdownToBlocks(body, readContext(entry.path))
    const extra = object(data.extra) ? assetsIn(data.extra, entry.path) : {}
    const schema = schemaOf(parentId)
    let props: Record<string, PropValue> | undefined = object(data.props) ? withoutMissingFiles(assetsIn(data.props, entry.path) as Record<string, PropValue>) : undefined
    if (!props && schema && object(data.properties)) {
      const readable = data.properties
      const fromNames: Record<string, PropValue> = {}
      for (const prop of schema.properties) {
        const value = fromReadable(readable[prop.name], prop, titles)
        if (value !== undefined) fromNames[prop.id] = value
      }
      if (Object.keys(fromNames).length) props = fromNames
    }
    const page: Page = {
      ...(extra as Partial<Page>),
      id: entry.id,
      parentId,
      title: str(data.title, entry.path.split('/').pop()!.replace(/\.md$/, '')),
      icon: data.icon ? assetsIn(str(data.icon), entry.path) || null : null,
      cover: data.cover ? assetsIn(str(data.cover), entry.path) || null : null,
      coverPosition: num(data.cover_position, 50),
      favorite: bool(data.favorite),
      trashed: false,
      trashedAt: null,
      createdAt: time(data.created, now),
      updatedAt: time(data.updated, now),
      order: num(data.order, manifestOrder.get(entry.id) ?? index),
      fullWidth: bool(data.full_width),
      smallText: bool(data.small_text),
      font: data.font === 'serif' || data.font === 'mono' ? data.font : 'default',
      locked: bool(data.locked),
      text: blocksToText(blocks),
    }
    if (typeof data.created_by === 'string') page.createdBy = data.created_by
    if (typeof data.updated_by === 'string') page.updatedBy = data.updated_by
    if (typeof data.sequence === 'number') page.sequence = data.sequence
    if (typeof data.subitem_parent === 'string') page.subitemParentId = data.subitem_parent
    if (Array.isArray(data.dependencies)) page.dependencyIds = data.dependencies.filter((id): id is string => typeof id === 'string')
    if (typeof data.block_owner === 'string' && UUID.test(data.block_owner)) page.blockOwnerId = data.block_owner
    if (entry.database) page.database = entry.database
    if (props) page.props = props
    if (Array.isArray(data.comments)) page.comments = assetsIn(data.comments, entry.path) as PageComment[]
    const pageTypeIds = typesFor(data)
    if (pageTypeIds) {
      page.types = pageTypeIds
      let typeProps: Record<string, PropValue> | undefined = object(data.type_props) ? withoutMissingFiles(assetsIn(data.type_props, entry.path) as Record<string, PropValue>) : undefined
      if (!typeProps && object(data.campos)) {
        const readable = data.campos
        typeProps = {}
        for (const id of pageTypeIds) for (const prop of effectiveProperties(objectTypes, id)) {
          const value = fromReadable(readable[prop.name], prop, titles)
          if (value !== undefined) typeProps[prop.id] = value
        }
      }
      if (typeProps) { const valid = Object.fromEntries(Object.entries(typeProps).filter(([, value]) => validPropValue(value))); if (Object.keys(valid).length) page.typeProps = valid }
    }
    pages[entry.id] = page
    documents[entry.id] = blocks
  })

  const syncedBlocks: Record<string, SyncedBlockRecord> = {}
  for (const record of Array.isArray(manifest.syncedBlocks) ? manifest.syncedBlocks : []) {
    if (!object(record) || typeof record.id !== 'string') continue
    syncedBlocks[record.id] = { id: record.id, sourcePageId: str(record.sourcePageId), updatedAt: num(record.updatedAt, now), blocks: markdownToBlocks(str(record.markdown), readContext(PACKAGE_MANIFEST)) as RawBlock[] }
  }

  return {
    format: COMPAT.record011, version: 1, exportedAt: str(manifest.exportedAt, new Date(now).toISOString()),
    meta: { pages, settings: { ...defaultSettings, ...(objectTypes.length ? { objectTypes } : {}), workspaceName: str(manifest.workspaceName, defaultSettings.workspaceName), locale: manifest.locale === 'en-US' ? 'en-US' : 'pt-BR' }, notifications: {}, syncedBlocks },
    documents,
  }
}
