const PRODUCT = require('../shared/product.json')
const COMPAT = require('../shared/compatibility.cjs')
// Lógica pura da captura rápida (sem Electron): preferências, destino, criação da nota.
const { randomUUID } = require('node:crypto')
const { indexBlocks, isLivePage } = require('./content-index.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_PREFS = Object.freeze({ shortcut: process.platform === 'darwin' ? 'Alt+Command+N' : 'Alt+Control+N', captureShortcut: process.platform === 'darwin' ? 'Alt+Shift+Command+N' : 'Alt+Shift+Control+N', showTray: true, trayTasks: true, trayCount: false, openAtLogin: false, inbox: {} })
const OPTION_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'brown', 'gray']
const MODIFIERS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'])
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[`\-=[\];',./\\])$/

/** Accelerator aceitável para atalho global: ≥1 modificador (não só Shift) + 1 tecla. */
function isValidAccelerator(value) {
  if (typeof value !== 'string' || !value || value.length > 60) return false
  const parts = value.split('+')
  const key = parts.pop()
  if (!parts.length || !KEY.test(key ?? '')) return false
  if (new Set(parts).size !== parts.length || parts.some(part => !MODIFIERS.has(part))) return false
  return parts.some(part => part !== 'Shift')
}

function normalizePrefs(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const normalizeShortcut = value => process.platform === 'win32' && typeof value === 'string' ? value.replace(/\b(Command|Cmd)\b/g, 'Control') : value
  const inbox = {}
  if (value.inbox && typeof value.inbox === 'object') for (const [ws, id] of Object.entries(value.inbox)) if (typeof id === 'string' && UUID.test(id) && (ws === 'default' || UUID.test(ws))) inbox[ws] = id
  return {
    shortcut: value.shortcut === '' ? '' : isValidAccelerator(value.shortcut) ? normalizeShortcut(value.shortcut) : DEFAULT_PREFS.shortcut,
    captureShortcut: value.captureShortcut === '' ? '' : isValidAccelerator(value.captureShortcut) ? normalizeShortcut(value.captureShortcut) : DEFAULT_PREFS.captureShortcut,
    showTray: typeof value.showTray === 'boolean' ? value.showTray : DEFAULT_PREFS.showTray,
    trayTasks: typeof value.trayTasks === 'boolean' ? value.trayTasks : DEFAULT_PREFS.trayTasks,
    trayCount: typeof value.trayCount === 'boolean' ? value.trayCount : DEFAULT_PREFS.trayCount,
    openAtLogin: typeof value.openAtLogin === 'boolean' ? value.openAtLogin : DEFAULT_PREFS.openAtLogin,
    inbox,
  }
}

const fold = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
function pagePath(meta, page) {
  const names = []
  let parent = page.parentId ? meta.pages[page.parentId] : null
  for (let guard = 0; parent && guard < 20; guard++) { names.unshift(parent.title || ''); parent = parent.parentId ? meta.pages[parent.parentId] : null }
  return names.filter(Boolean).join(' / ')
}

/** Páginas e bancos onde a nota pode ser criada (linhas de banco ficam de fora). */
function searchDestinations(meta, query, limit = 12) {
  if (!meta?.pages) return []
  const needle = fold(query).trim()
  const recent = new Map((meta.settings?.recent ?? []).map((id, index) => [id, index]))
  return Object.values(meta.pages)
    .filter(page => isLivePage(page.id, meta.pages) && !page.database?.linkedSourceId && !(page.parentId && meta.pages[page.parentId]?.database) && (!page.locked || page.database))
    .filter(page => !needle || fold(page.title).includes(needle))
    .sort((a, b) => (recent.get(a.id) ?? 1e6) - (recent.get(b.id) ?? 1e6) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit)
    .map(page => ({ id: page.id, title: page.title, icon: typeof page.icon === 'string' && !page.icon.startsWith('data:') && !page.icon.startsWith('lucide:') ? page.icon : null, database: !!page.database, path: pagePath(meta, page) }))
}

/** Propriedades editáveis na janela rápida quando o destino é um banco. */
function destinationInfo(meta, id) {
  const page = meta?.pages?.[id]
  if (!page || !isLivePage(id, meta.pages)) return null
  if (!page.database) return { id, title: page.title, database: false }
  const props = page.database.properties
  const tags = props.find(prop => prop.type === 'multiSelect')
  const date = props.find(prop => prop.type === 'date')
  return { id, title: page.title, database: true, tags: tags ? { id: tags.id, name: tags.name, options: (tags.options ?? []).map(option => option.name) } : null, date: date ? { id: date.id, name: date.name } : null }
}

function findInbox(meta, inboxId) {
  if (inboxId && meta.pages[inboxId]?.database && isLivePage(inboxId, meta.pages)) return inboxId
  return null
}

function inboxDatabase(locale, uid = randomUUID) {
  const en = locale === 'en-US'
  const title = { id: uid(), name: en ? 'Name' : 'Nome', type: 'title' }
  const tags = { id: uid(), name: 'Tags', type: 'multiSelect', options: [] }
  const date = { id: uid(), name: en ? 'Date' : 'Data', type: 'date' }
  const source = { id: uid(), name: en ? 'Source' : 'Fonte', type: 'url' }
  const created = { id: uid(), name: en ? 'Created' : 'Criado em', type: 'createdTime' }
  const view = { id: uid(), name: en ? 'Table' : 'Tabela', type: 'table', filters: [], sorts: [{ propertyId: created.id, direction: 'desc' }], hidden: [], widths: {}, dateProp: date.id }
  return { properties: [title, tags, date, source, created], views: [view], activeViewId: view.id }
}

function basePage(meta, id, parentId, now, author, init = {}) {
  const siblings = Object.values(meta.pages).filter(page => page.parentId === parentId)
  return { title: '', icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now,
    createdBy: author, updatedBy: author, order: Math.max(-1, ...siblings.map(page => Number(page.order) || 0)) + 1, fullWidth: false, smallText: false,
    font: 'default', locked: false, text: '', ...init, id, parentId }
}

function cleanText(value, max) { return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, max) : '' }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value }
function validHttp(value) { try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && value.length <= 4000 } catch { return false } }

/** Valida a entrada vinda da janela rápida. Lança Error com mensagem pt/en. */
function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Nota inválida / Invalid note')
  const blocks = Array.isArray(input.blocks) ? input.blocks : []
  if (JSON.stringify(blocks).length > 2 * 1024 * 1024) throw new Error('A nota excede 2 MB / The note exceeds 2 MB')
  const title = cleanText(input.title, 2000).trim()
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter(tag => typeof tag === 'string').map(tag => tag.trim().slice(0, 100)).filter(Boolean))].slice(0, 30) : []
  const destinationId = typeof input.destinationId === 'string' && UUID.test(input.destinationId) ? input.destinationId : null
  const date = validDate(input.date) ? input.date : null
  return { title, blocks, tags, destinationId, date, dateValue: date ? validDateValue(input.dateValue, date) : null, sourceUrl: validHttp(input.sourceUrl) ? input.sourceUrl : null }
}

/** Data completa de "@amanhã às 9h" / "@todo dia 5" (src/quick/tokens.ts): só campos conhecidos e válidos. */
function validDateValue(value, date) {
  if (!value || typeof value !== 'object' || value.start !== date) return null
  const out = { start: date }
  if (typeof value.startTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)) out.startTime = value.startTime
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(value.repeat)) {
    out.repeat = value.repeat
    const r = value.recurrence
    if (r && typeof r === 'object') {
      const recurrence = {}
      if (Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 999) recurrence.interval = r.interval
      if (Array.isArray(r.weekdays) && r.weekdays.length <= 7 && r.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) recurrence.weekdays = [...new Set(r.weekdays)].sort()
      if (['day', 'weekday', 'lastWeekday'].includes(r.monthly)) recurrence.monthly = r.monthly
      if (validDate(r.until)) recurrence.until = r.until
      if (Number.isInteger(r.count) && r.count >= 1 && r.count <= 10000) recurrence.count = r.count
      if (Object.keys(recurrence).length) out.recurrence = recurrence
    }
  }
  return out
}

function firstLine(blocks) {
  const { text } = indexBlocks(blocks)
  return (text.split('\n').map(line => line.trim()).find(Boolean) ?? '').slice(0, 80)
}

function sourceBlock(url, locale) {
  return { id: randomUUID(), type: 'paragraph', props: { textColor: 'gray', backgroundColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: locale === 'en-US' ? 'Source: ' : 'Fonte: ', styles: {} }, { type: 'link', href: url, content: [{ type: 'text', text: url, styles: {} }] }], children: [] }
}

/**
 * Aplica a nota ao meta (imutável). Cria a caixa de entrada se preciso.
 * Retorna { meta, pageId, parentId, inboxId, blocks }.
 */
function applyQuickNote(meta, rawInput, { inboxId = null, now = Date.now(), uid = randomUUID, author, pageId = uid() } = {}) {
  const input = validateInput(rawInput)
  const locale = meta.settings?.locale === 'en-US' ? 'en-US' : 'pt-BR'
  const by = author || meta.settings?.userName || (locale === 'en-US' ? 'You' : 'Você')
  const blocks = input.sourceUrl ? [...input.blocks, sourceBlock(input.sourceUrl, locale)] : input.blocks
  const title = input.title || firstLine(input.blocks)
  if (!title && !indexBlocks(blocks).text.trim()) throw new Error('Nada para salvar / Nothing to save')
  const pages = { ...meta.pages }
  let parentId = input.destinationId, createdInbox = null
  if (parentId) {
    const parent = pages[parentId]
    if (!parent || !isLivePage(parentId, pages)) throw new Error('Destino indisponível / Destination unavailable')
    if (parent.locked && !parent.database) throw new Error('A página de destino está bloqueada / The destination page is locked')
    if (parent.database?.linkedSourceId) parentId = parent.database.linkedSourceId
  } else {
    parentId = findInbox(meta, inboxId)
    if (!parentId) {
      parentId = uid()
      createdInbox = basePage({ pages }, parentId, null, now, by, { title: locale === 'en-US' ? 'Quick notes' : 'Notas rápidas', icon: '⚡', database: inboxDatabase(locale, uid) })
      pages[parentId] = createdInbox
    }
  }
  const parent = pages[parentId]
  const props = {}
  if (parent.database) {
    let schema = parent.database
    const tagsProp = schema.properties.find(prop => prop.type === 'multiSelect')
    if (tagsProp && input.tags.length) {
      const options = [...(tagsProp.options ?? [])]
      const ids = input.tags.map(name => {
        const existing = options.find(option => fold(option.name) === fold(name))
        if (existing) return existing.id
        const option = { id: uid(), name, color: OPTION_COLORS[options.length % OPTION_COLORS.length] }
        options.push(option); return option.id
      })
      props[tagsProp.id] = [...new Set(ids)]
      if (options.length !== (tagsProp.options ?? []).length) {
        schema = { ...schema, properties: schema.properties.map(prop => prop.id === tagsProp.id ? { ...prop, options } : prop) }
        pages[parentId] = { ...pages[parentId], database: schema, updatedAt: now, updatedBy: by }
      }
    }
    const dateProp = schema.properties.find(prop => prop.type === 'date')
    if (dateProp && input.date) props[dateProp.id] = input.dateValue ?? { start: input.date }
    const urlProp = schema.properties.find(prop => prop.type === 'url')
    if (urlProp && input.sourceUrl) props[urlProp.id] = input.sourceUrl
  }
  const indexed = indexBlocks(blocks, meta.syncedBlocks)
  pages[pageId] = basePage({ pages }, pageId, parentId, now, by, { title, ...indexed, ...(parent.database ? { props } : {}) })
  return { meta: { ...meta, pages }, pageId, parentId, inboxId: input.destinationId ? inboxId : parentId, blocks, createdInbox: !!createdInbox }
}

/** workspace://capture?text=…&title=…&url=… → dados para pré-preencher a janela rápida. */
function parseCaptureLink(value) {
  try {
    const url = new URL(value)
    if (![PRODUCT.protocol + ":", COMPAT.record005, ...(PRODUCT.protocolAliases ?? []).map(scheme => scheme + ":")].includes(url.protocol) || url.hostname !== 'capture' || url.username || url.password || url.port) return null
    const text = cleanText(url.searchParams.get('text') ?? '', 100000)
    const title = cleanText(url.searchParams.get('title') ?? '', 2000)
    const source = url.searchParams.get('url')
    return { text, title, sourceUrl: source && validHttp(source) ? source : null }
  } catch { return null }
}

/** Texto da área de transferência e, se o navegador a deixou, a URL de origem (sem AppleScript nem Acessibilidade). */
function clipboardCapture(clipboard) {
  const text = cleanText(clipboard.readText?.() ?? '', 100000)
  let sourceUrl = null
  const formats = clipboard.availableFormats?.() ?? []
  // Navegadores Chromium (Chrome, Edge, Brave, Arc…) gravam a página de origem neste tipo.
  for (const type of ['org.chromium.source-url', 'public.url', 'text/x-moz-url-priv']) {
    if (sourceUrl) break
    let raw = ''
    try { raw = formats.includes(type) || type === 'org.chromium.source-url' ? (clipboard.readBuffer?.(type)?.toString('utf8') ?? '') : '' } catch { raw = '' }
    raw = raw.replace(/\u0000/g, '').trim().split(/\s/)[0] ?? ''
    if (validHttp(raw)) sourceUrl = raw
  }
  if (!sourceUrl) {
    const bookmark = clipboard.readBookmark?.()
    if (bookmark?.url && validHttp(bookmark.url) && bookmark.url !== text.trim()) sourceUrl = bookmark.url
  }
  return { text, sourceUrl }
}

module.exports = { DEFAULT_PREFS, isValidAccelerator, normalizePrefs, searchDestinations, destinationInfo, applyQuickNote, validateInput, parseCaptureLink, clipboardCapture, inboxDatabase }
