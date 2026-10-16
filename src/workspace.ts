import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.ts'
import type { Meta, Page, Settings, WorkspaceBackup } from './types'
import { normalizeObjectTypes, normalizePageTypes } from './objecttypes/model.ts'
import { parseQueryJson } from './query/model.ts'
import { normalizeCanvasPageInfo } from './canvas/model.ts'
import { normalizeLibrary } from './canvas/library.ts'
import { normalizePageIcon } from './components/ui/icons/iconValue.ts'
import { sanitizeOverrides } from './shortcuts.ts'
import { normalizeViewSettings } from './components/database/settings/model.ts'

export const defaultSettings: Settings = {
  locale: 'en-US', theme: 'system', userName: '', workspaceName: `${PRODUCT.name}`, sidebarWidth: 240,
  sidebarCollapsed: false, expanded: {}, recent: [],
  historyLimit: 0, personalTemplates: [],
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string')
const propTypes = new Set(['title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'createdTime', 'updatedTime', 'formula', 'relation', 'rollup', 'person', 'files', 'createdBy', 'updatedBy', 'button', 'uniqueId', 'place'])
const viewTypes = new Set(['table', 'board', 'calendar', 'list', 'gallery', 'timeline', 'chart', 'dashboard', 'map', 'feed', 'form'])
// Agregações de rollup/rodapé (RollupAggregation em database-models.ts).
const ROLLUP_AGGREGATIONS = new Set(['count', 'countValues', 'countUnique', 'sum', 'average', 'median', 'min', 'max', 'range', 'showOriginal', 'unique', 'empty', 'notEmpty', 'percentEmpty', 'percentNotEmpty', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked', 'earliest', 'latest', 'dateRange'])
const filterOps = new Set(['contains', 'notContains', 'is', 'isNot', 'gt', 'lt', 'gte', 'lte', 'before', 'after', 'isEmpty', 'isNotEmpty'])

function validateDatabase(schema: unknown): void {
  const invalid = () => { throw new Error('O esquema de um banco de dados está inválido. Nenhum dado foi substituído.') }
  if (!object(schema) || !Array.isArray(schema.properties) || !Array.isArray(schema.views) || !schema.views.length) return invalid()
  const linked = typeof schema.linkedSourceId === 'string' && UUID.test(schema.linkedSourceId)
  if (schema.linkedSourceId !== undefined && !linked) return invalid()
  const ids = new Set<string>(), views = new Set<string>()
  let titles = 0
  for (const property of schema.properties) {
    if (!object(property) || !nonEmpty(property.id) || ids.has(property.id) || typeof property.name !== 'string' || !propTypes.has(String(property.type))) return invalid()
    ids.add(property.id)
    if (property.type === 'title') titles++
    if (property.options !== undefined && (!Array.isArray(property.options) || property.options.some(option => !object(option) || !nonEmpty(option.id) || typeof option.name !== 'string' || typeof option.color !== 'string'))) return invalid()
    if (property.formula !== undefined && typeof property.formula !== 'string') return invalid()
    if (property.relationDatabaseId !== undefined && typeof property.relationDatabaseId !== 'string') return invalid()
    if (property.rollup !== undefined && (!object(property.rollup) || typeof property.rollup.relationPropertyId !== 'string' || typeof property.rollup.targetPropertyId !== 'string' || !ROLLUP_AGGREGATIONS.has(String(property.rollup.aggregation))
      || (property.rollup.filter !== undefined && (!Array.isArray(property.rollup.filter) || property.rollup.filter.some(rule => !object(rule) || typeof rule.propertyId !== 'string' || typeof rule.op !== 'string'))))) return invalid()
    if (property.dependsOn !== undefined && (!object(property.dependsOn) || typeof property.dependsOn.propertyId !== 'string' || !object(property.dependsOn.links) || Object.values(property.dependsOn.links).some(links => !stringArray(links)))) return invalid()
    if (property.relationPicker !== undefined && (!object(property.relationPicker) || (property.relationPicker.filters !== undefined && !Array.isArray(property.relationPicker.filters)) || (property.relationPicker.shownPropertyIds !== undefined && !stringArray(property.relationPicker.shownPropertyIds)))) return invalid()
    if (property.options?.some(option => option.customColor !== undefined && (typeof option.customColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(option.customColor)))) return invalid()
  }
  // Linked views created by DatabaseView intentionally keep properties empty;
  // their title and other property definitions live in the source database.
  if (titles !== 1 && !(linked && titles === 0 && schema.properties.length === 0)) return invalid()
  for (const view of schema.views) {
    // Opções do painel de visualização: inválidas são descartadas, nunca recusam o arquivo.
    if (object(view)) normalizeViewSettings(view)
    if (!object(view) || !nonEmpty(view.id) || views.has(view.id) || typeof view.name !== 'string' || !viewTypes.has(String(view.type))
      || !Array.isArray(view.filters) || !Array.isArray(view.sorts) || !stringArray(view.hidden) || !object(view.widths)
      || Object.values(view.widths).some(width => !finite(width) || width <= 0)
      || (view.openPagesIn !== undefined && (typeof view.openPagesIn !== 'string' || !['side', 'center', 'full'].includes(view.openPagesIn)))) return invalid()
    if (view.wrappedColumns !== undefined && !stringArray(view.wrappedColumns)) return invalid()
    if (view.showPageIcon !== undefined && typeof view.showPageIcon !== 'boolean') return invalid()
    views.add(view.id)
    if (view.filters.some(filter => !object(filter) || !nonEmpty(filter.id) || (!linked && !ids.has(String(filter.propertyId))) || !filterOps.has(String(filter.op))
      || !(filter.value === null || typeof filter.value === 'string' || typeof filter.value === 'boolean' || finite(filter.value)))) return invalid()
    if (view.sorts.some(sort => !object(sort) || (!linked && !ids.has(String(sort.propertyId))) || !['asc', 'desc'].includes(String(sort.direction)))) return invalid()
    if (view.timelineScale !== undefined && !['week', 'month', 'quarter'].includes(String(view.timelineScale))) return invalid()
    if (view.chartAggregation !== undefined && !['count', 'sum', 'average'].includes(String(view.chartAggregation))) return invalid()
    if (view.tableCalculations !== undefined && (!object(view.tableCalculations) || Object.values(view.tableCalculations).some(v => v !== 'none' && (!ROLLUP_AGGREGATIONS.has(String(v)) || v === 'showOriginal' || v === 'unique')))) return invalid()
  }
  if (!views.has(String(schema.activeViewId))) return invalid()
  if (schema.templates !== undefined && (!Array.isArray(schema.templates) || schema.templates.some(template => !object(template) || !nonEmpty(template.id) || typeof template.name !== 'string' || !object(template.props) || (template.bodyBlocks !== undefined && !Array.isArray(template.bodyBlocks))))) return invalid()
}

function propValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value) || stringArray(value)
    || (object(value) && typeof value.start === 'string' && (value.end === undefined || typeof value.end === 'string'))
    || (object(value) && typeof value.label === 'string' && finite(value.lat) && finite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180)
    || (object(value) && value.type === 'richText' && Array.isArray(value.runs) && value.runs.every(run => object(run) && typeof run.text === 'string'))
    || (Array.isArray(value) && value.every(file => object(file) && nonEmpty(file.id) && typeof file.name === 'string' && typeof file.mimeType === 'string' && typeof file.data === 'string' && file.data.startsWith('data:') && finite(file.size) && file.size >= 0))
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/**
 * Datas com intervalo (início `start`, prazo `end`): fim anterior ao início é invertido e fim inválido é
 * descartado (vira só prazo = `start`), sem perder a data. Tarefas antigas sem `end` ficam intactas.
 */
export function normalizeDateRanges(props: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null
  for (const [key, value] of Object.entries(props)) {
    if (!object(value) || typeof value.start !== 'string' || value.end === undefined) continue
    const { start, end } = value as { start: string; end: unknown }
    let fixed: Record<string, unknown> | null = null
    if (typeof end !== 'string' || !ISO_DAY.test(end) || !ISO_DAY.test(start)) {
      if (typeof end !== 'string' || (ISO_DAY.test(start) && !ISO_DAY.test(end))) { const { end: _end, endTime: _endTime, ...rest } = value; fixed = rest }
    } else if (end < start) fixed = { ...value, start: end, end: start }
    if (fixed) (out ??= { ...props })[key] = fixed
  }
  return out ?? props
}

/** Validate before changing the active workspace. Corruption must never look like an empty file. */
export function validateMeta(value: unknown): Meta {
  if (!object(value) || !object(value.pages) || !object(value.settings)) throw new Error('O arquivo de páginas está inválido. Seus arquivos foram preservados.')
  const pages: Record<string, Page> = {}
  for (const [id, raw] of Object.entries(value.pages)) {
    if (!UUID.test(id) || !object(raw) || raw.id !== id || typeof raw.title !== 'string'
      || !(raw.parentId === null || typeof raw.parentId === 'string')) throw new Error('Uma página possui dados inválidos. Nenhum dado foi substituído.')
    if (raw.database !== undefined) validateDatabase(raw.database)
    if (raw.props !== undefined && (!object(raw.props) || Object.values(raw.props).some(v => !propValue(v)))) throw new Error('Uma página possui valores de propriedades inválidos.')
    if (object(raw.props)) raw.props = normalizeDateRanges(raw.props)
    if (raw.pendingTemplateBlocks !== undefined && !Array.isArray(raw.pendingTemplateBlocks)) throw new Error('O conteúdo inicial de uma página está inválido.')
    if (raw.blockOwnerId !== undefined && raw.blockOwnerId !== null && (typeof raw.blockOwnerId !== 'string' || !UUID.test(raw.blockOwnerId))) throw new Error('O vínculo de uma subpágina está inválido.')
    if (raw.blockConversion !== undefined && (!object(raw.blockConversion) || typeof raw.blockConversion.sourceId !== 'string' || !UUID.test(raw.blockConversion.sourceId) || !Array.isArray(raw.blockConversion.childIds) || raw.blockConversion.childIds.some((id: unknown) => typeof id !== 'string' || !UUID.test(id)))) throw new Error('A conversão de uma subpágina está inválida.')
    if (raw.removedByBlock !== undefined && (!object(raw.removedByBlock) || typeof raw.removedByBlock.ownerId !== 'string' || !UUID.test(raw.removedByBlock.ownerId) || typeof raw.removedByBlock.blockId !== 'string')) throw new Error('A recuperação de um bloco está inválida.')
    if (raw.comments !== undefined && (!Array.isArray(raw.comments) || raw.comments.some(c => !object(c) || !nonEmpty(c.id) || typeof c.body !== 'string' || typeof c.author !== 'string' || typeof c.resolved !== 'boolean' || !finite(c.createdAt) || !finite(c.updatedAt)))) throw new Error('Uma página possui comentários inválidos.')
    if (Array.isArray(raw.comments)) for (const comment of raw.comments) {
      const anchor = (comment as Record<string, unknown>).textAnchor
      if (anchor !== undefined && (!object(anchor) || !Array.isArray(anchor.segments) || !anchor.segments.length || anchor.segments.length > 1000 || anchor.segments.some(segment => !object(segment) || !nonEmpty(segment.blockId) || !nonEmpty(segment.quote) || !finite(segment.from) || !finite(segment.to) || segment.from < 0 || segment.to <= segment.from || typeof segment.prefix !== 'string' || typeof segment.suffix !== 'string'))) throw new Error('Um comentário possui uma seleção inválida.')
    }
    pages[id] = {
      icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null,
      createdAt: 0, updatedAt: 0, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '',
      ...raw,
    } as unknown as Page
    const page = pages[id]
    // Ícone: emoji, imagem local ou `lucide:nome:cor` — tolerante (tipo errado vira null; nunca recusa o meta).
    if (raw.icon !== undefined) page.icon = normalizePageIcon(raw.icon)
    // Tipos de objeto (src/objecttypes): tolerante — formatos inválidos são descartados, nunca recusam o meta.
    if (raw.types !== undefined) { const types = normalizePageTypes(raw.types); if (types) page.types = types; else delete page.types }
    // Lousa: marcador tolerante (inválido é descartado, nunca recusa o meta).
    if (raw.canvas !== undefined) { const info = normalizeCanvasPageInfo(raw.canvas); if (info) page.canvas = info; else delete page.canvas }
    if (raw.typeProps !== undefined) {
      if (!object(raw.typeProps)) delete page.typeProps
      else { const valid = Object.entries(raw.typeProps).filter(([, v]) => propValue(v)); page.typeProps = Object.fromEntries(valid) as Page['typeProps']; if (!valid.length) delete page.typeProps }
    }
    if (![page.createdAt, page.updatedAt, page.order, page.coverPosition].every(n => typeof n === 'number' && Number.isFinite(n))
      || typeof page.text !== 'string') throw new Error('Uma página possui campos inválidos.')
  }
  for (const page of Object.values(pages)) {
    const seen = new Set([page.id])
    let parentId = page.parentId
    while (parentId) {
      if (!pages[parentId]) throw new Error('Uma página aponta para uma página pai ausente.')
      if (seen.has(parentId)) throw new Error('A árvore de páginas possui uma referência circular.')
      seen.add(parentId)
      parentId = pages[parentId].parentId
    }
  }
  const input = value.settings
  const settings: Settings = {
    ...defaultSettings, ...input,
    locale: input.locale === 'en-US' ? 'en-US' : 'pt-BR',
    historyLimit: finite(input.historyLimit) && input.historyLimit >= 0 ? Math.floor(input.historyLimit) : 0,
    ...(input.historyPolicy === 'default' || input.historyPolicy === 'long' || input.historyPolicy === 'unlimited' ? { historyPolicy: input.historyPolicy } : {}),
    personalTemplates: Array.isArray(input.personalTemplates) ? input.personalTemplates.filter(p => object(p) && nonEmpty(p.id) && typeof p.title === 'string' && Array.isArray(p.blocks)) as Settings['personalTemplates'] : [],
    theme: ['system', 'light', 'dark'].includes(String(input.theme)) ? input.theme as Settings['theme'] : 'system',
    userName: typeof input.userName === 'string' ? input.userName : '',
    workspaceName: typeof input.workspaceName === 'string' && input.workspaceName !== COMPAT.record002 ? input.workspaceName : `${PRODUCT.name}`,
    sidebarWidth: typeof input.sidebarWidth === 'number' ? Math.max(200, Math.min(480, input.sidebarWidth)) : 240,
    expanded: object(input.expanded) ? input.expanded as Record<string, boolean> : {},
    recent: Array.isArray(input.recent) ? input.recent.filter((id): id is string => typeof id === 'string' && !!pages[id]) : [],
    ...(input.objectTypes !== undefined ? { objectTypes: normalizeObjectTypes(input.objectTypes) } : {}),
    ...(input.shortcutOverrides !== undefined ? { shortcutOverrides: sanitizeOverrides(input.shortcutOverrides) } : {}),
    ...(input.canvasLibrary !== undefined ? { canvasLibrary: normalizeLibrary(input.canvasLibrary) } : {}),
    openTabs: Array.isArray(input.openTabs) ? input.openTabs.filter((tab) => object(tab) && typeof tab.id === 'string'
      && object(tab.route) && (tab.route.type === 'home' || tab.route.type === 'graph' || tab.route.type === 'productivity' || tab.route.type === 'tasks' || tab.route.type === 'review' || (tab.route.type === 'objectType' && typeof tab.route.id === 'string' && Array.isArray(input.objectTypes) && input.objectTypes.some((type: unknown) => object(type) && type.id === (tab.route as { id?: unknown }).id)) || (tab.route.type === 'page' && typeof tab.route.id === 'string' && !!pages[tab.route.id]))) as Settings['openTabs'] : [],
  }
  if (value.notifications !== undefined && (!object(value.notifications) || Object.values(value.notifications).some(n => !object(n) || !nonEmpty(n.id) || !nonEmpty(n.pageId) || !finite(n.dueAt) || typeof n.title !== 'string' || typeof n.body !== 'string' || !finite(n.createdAt)))) throw new Error('Lembretes locais inválidos. Os dados foram preservados.')
  if (value.syncedBlocks !== undefined && (!object(value.syncedBlocks) || Object.values(value.syncedBlocks).some(b => !object(b) || !nonEmpty(b.id) || !Array.isArray(b.blocks) || !nonEmpty(b.sourcePageId) || !finite(b.updatedAt)))) throw new Error('Blocos sincronizados inválidos. Os dados foram preservados.')
  return { pages, settings, notifications: (value.notifications ?? {}) as Meta['notifications'], syncedBlocks: (value.syncedBlocks ?? {}) as Meta['syncedBlocks'] }
}

/** Maior versão de esquema do meta.json que este app entende (espelha electron/migrations/index.cjs). */
export const SUPPORTED_SCHEMA_VERSION = 2

export function validateBackup(value: unknown): WorkspaceBackup {
  if (!object(value) || value.format !== COMPAT.record011 || value.version !== 1 || !object(value.documents)) throw new Error(`Escolha um backup JSON do ${PRODUCT.name} (versão 1).`)
  // JSON imports create fresh page IDs. Password-bound ciphertext cannot be
  // remapped, and the JSON format does not include its key registry. Never turn
  // a protected page into an empty imported page while reporting success.
  if ((object(value.sealedPages) && Object.keys(value.sealedPages).length > 0)
    || (object(value.meta) && object(value.meta.pages) && Object.values(value.meta.pages).some(page => object(page) && page.passwordLock))) {
    const portuguese = object(value.meta) && object(value.meta.settings) && value.meta.settings.locale === 'pt-BR'
    throw new Error(portuguese
      ? 'Páginas protegidas precisam do Backup externo completo. Use Configurações → Dados → Backup externo para criar ou restaurar uma cópia que inclua as chaves cifradas. Nenhum dado foi alterado.'
      : 'Protected pages require a full External backup. Use Settings → Data → External backup to create or restore a copy that includes the wrapped encryption keys. No data was changed.')
  }
  if (finite(value.schemaVersion) && value.schemaVersion > SUPPORTED_SCHEMA_VERSION) throw new Error(`Este backup foi criado por uma versão mais nova do ${PRODUCT.name} (esquema ${value.schemaVersion}; este app entende até ${SUPPORTED_SCHEMA_VERSION}). Atualize o app para restaurá-lo. / This backup was created by a newer ${PRODUCT.name} (schema ${value.schemaVersion}; this app supports up to ${SUPPORTED_SCHEMA_VERSION}). Update the app to restore it.`)
  const meta = validateMeta(value.meta)
  for (const id of Object.keys(meta.pages)) {
    if (!Array.isArray(value.documents[id])) throw new Error(`O backup não contém o conteúdo da página “${meta.pages[id].title || 'Sem título'}”.`)
  }
  if (value.versions !== undefined) {
    if (!object(value.versions)) throw new Error('Histórico de backup inválido.')
    for (const [id, versions] of Object.entries(value.versions)) {
      if (!meta.pages[id] || !Array.isArray(versions) || versions.some(v => !object(v) || !nonEmpty(v.id) || !finite(v.savedAt) || !Array.isArray(v.blocks))) throw new Error('O backup contém uma versão de conteúdo inválida.')
      for (const version of versions) if (object(version) && version.page !== undefined) {
        if (!object(version.page) || version.page.id !== id || !(version.page.parentId === null || typeof version.page.parentId === 'string')) throw new Error('O backup contém metadados de versão inválidos.')
        // A historical parent may have been deleted since this snapshot. Validate
        // the page independently; restoration retains the current parent.
        validateMeta({ pages: { [id]: { ...version.page, parentId: null } }, settings: meta.settings })
      }
    }
  }
  return { format: COMPAT.record011, version: 1, exportedAt: String(value.exportedAt ?? ''), meta, documents: value.documents as Record<string, unknown[]>, versions: value.versions as WorkspaceBackup['versions'] }
}

/** Remap only exact identifiers (including relation arrays and page mentions), never arbitrary prose. */
export function remapReferences<T>(value: T, ids: Record<string, string>): T {
  if (typeof value === 'string') {
    if (ids[value]) return ids[value] as T
    for (const prefix of [PRODUCT.protocol + "://page/", COMPAT.record061, ...PRODUCT.protocolAliases.map(scheme => scheme + "://page/"), '#page/']) if (value.startsWith(prefix)) {
      const [id, ...suffix] = value.slice(prefix.length).split('#')
      const hash = new URLSearchParams(suffix.join('#'))
      for (const key of ['block', 'view']) { const old = hash.get(key); if (old && ids[old]) hash.set(key, ids[old]) }
      if (ids[id] || suffix.length) return (prefix + (ids[id] ?? id) + (suffix.length ? '#' + hash.toString() : '')) as T
    }
    return value
  }
  if (Array.isArray(value)) return value.map(v => remapReferences(v, ids)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => {
    if (key === 'actionsJson' && typeof v === 'string') {
      try { const actions = JSON.parse(v); if (Array.isArray(actions)) return [key, JSON.stringify(remapReferences(actions, ids))] } catch { /* Preserve an invalid configuration for the editor to report. */ }
    }
    // Consulta viva (bloco "query"): ids de bancos/páginas vivem dentro do JSON. Dado antigo ou inválido é preservado.
    if (key === 'query' && typeof v === 'string' && v.trim().startsWith('{')) {
      const query = parseQueryJson(v)
      if (query) return [key, JSON.stringify(remapReferences(query, ids))]
    }
    return [key, remapReferences(v, ids)]
  })) as T
  return value
}

export function cloneDocument(blocks: unknown[], ids: Record<string, string>): unknown[] {
  return remapReferences(blocks, { ...collectBlockMapping(blocks), ...ids })
}

export function collectBlockMapping(blocks: unknown[]): Record<string, string> {
  const ids: Record<string, string> = {}
  const walk = (list: unknown[]) => list.forEach(block => {
    if (!object(block)) return
    if (typeof block.id === 'string') ids[block.id] = crypto.randomUUID()
    if (Array.isArray(block.children)) walk(block.children)
  })
  walk(blocks)
  return ids
}

export function foldSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
}

export function documentLinks(blocks: unknown[]): string[] {
  const ids = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!object(value)) return
    if (typeof value.pageId === 'string' && UUID.test(value.pageId)) ids.add(value.pageId)
    if (typeof value.targetPageId === 'string' && UUID.test(value.targetPageId)) ids.add(value.targetPageId)
    for (const href of [value.href, value.url]) if (typeof href === 'string') {
      const match = new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/page\\/([0-9a-f-]{36})(?:[#?].*)?$`, "i").exec(href)
      if (match && UUID.test(match[1])) ids.add(match[1])
    }
    Object.values(value).forEach(walk)
  }
  walk(blocks)
  return [...ids].sort()
}
