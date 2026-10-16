const http = require('node:http')
const { timingSafeEqual, createHash, randomUUID } = require('node:crypto')
const { isLivePage, createSearchIndex } = require('./content-index.cjs')
const { guardAiPrivate } = require('./agent-privacy.cjs')
const { legacyAccess } = require('./agent-access.cjs')
const { diffBlocks, diffValues } = require('./agent-diff.cjs')
const { loadAgentRuntime } = require('./agent-runtime.cjs')
const { dateExtras } = require('./date-extras.cjs')
const clip = require('./clip.cjs')
const { exposeBlocks, mergeCanvasBlocks, assertProtectedPreserved } = require('./canvas-guard.cjs')
const etag = blocks => '"' + createHash('sha256').update(JSON.stringify(blocks)).digest('hex') + '"'
const rowPropertiesEtag = (row, database) => etag({ parentId: row.parentId, props: row.props ?? {}, properties: database.properties })
const editablePropertyTypes = new Set(['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'relation', 'person', 'place'])
const computedPropertyTypes = new Set(['title', 'createdTime', 'updatedTime', 'formula', 'rollup', 'createdBy', 'updatedBy', 'button', 'uniqueId', 'files'])
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }) }
function normalizePropertyValue(property, value, meta) {
  if (computedPropertyTypes.has(property.type) || !editablePropertyTypes.has(property.type)) invalid('Property "' + property.name + '" cannot be edited through the local API')
  if (value === null && property.type === 'relation') return []
  if (value === null) return null
  if (['text', 'url', 'email', 'phone', 'person'].includes(property.type)) {
    if (typeof value !== 'string' || value.length > 10000) invalid('Invalid value for "' + property.name + '"')
    return value
  }
  if (property.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid('Invalid value for "' + property.name + '"')
    return value
  }
  if (property.type === 'checkbox') {
    if (typeof value !== 'boolean') invalid('Invalid value for "' + property.name + '"')
    return value
  }
  if (property.type === 'select' || property.type === 'status') {
    if (typeof value !== 'string') invalid('Invalid option for "' + property.name + '"')
    const option = property.options?.find(item => item.id === value || item.name === value)
    if (!option) invalid('Unknown option for "' + property.name + '"')
    return option.id
  }
  if (property.type === 'multiSelect') {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) invalid('Invalid options for "' + property.name + '"')
    const ids = value.map(item => {
      const option = property.options?.find(candidate => candidate.id === item || candidate.name === item)
      if (!option) invalid('Unknown option for "' + property.name + '"')
      return option.id
    })
    return [...new Set(ids)]
  }
  if (property.type === 'date') {
    const date = typeof value === 'string' ? { start: value } : value
    const validDate = item => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item) && !Number.isNaN(Date.parse(item + 'T00:00:00Z')) && new Date(item + 'T00:00:00Z').toISOString().slice(0, 10) === item
    if (!date || typeof date !== 'object' || Array.isArray(date) || !validDate(date.start) || date.end !== undefined && !validDate(date.end) || date.end && date.end < date.start) invalid('Invalid date for "' + property.name + '"')
    const result = { start: date.start }
    if (date.end !== undefined) result.end = date.end
    for (const key of ['startTime', 'endTime', 'timeZone']) if (date[key] !== undefined) {
      if (typeof date[key] !== 'string' || date[key].length > 100) invalid('Invalid date for "' + property.name + '"')
      result[key] = date[key]
    }
    if (date.repeat !== undefined) {
      if (!['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(date.repeat)) invalid('Invalid recurrence for "' + property.name + '"')
      result.repeat = date.repeat
    }
    Object.assign(result, dateExtras(date, field => invalid('Invalid ' + field + ' for "' + property.name + '"')))
    return result
  }
  if (property.type === 'relation') {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) invalid('Invalid related pages for "' + property.name + '"')
    const targetId = property.relationDatabaseId
    const ids = [...new Set(value)]
    if (!targetId || ids.some(id => !meta.pages[id] || meta.pages[id].parentId !== targetId || !isLivePage(id, meta.pages))) invalid('A related page does not belong to "' + property.name + '"')
    return ids
  }
  if (property.type === 'place') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.label !== 'string' || value.label.length > 500 || typeof value.lat !== 'number' || !Number.isFinite(value.lat) || Math.abs(value.lat) > 90 || typeof value.lng !== 'number' || !Number.isFinite(value.lng) || Math.abs(value.lng) > 180) invalid('Invalid place for "' + property.name + '"')
    return { label: value.label, lat: value.lat, lng: value.lng }
  }
  invalid('Unsupported property "' + property.name + '"')
}
const safeEqual = (a, b) => { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb) }
const plainText = blocks => {
  const parts = []
  const visit = value => {
    if (typeof value === 'string') { parts.push(value); return }
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.text === 'string') parts.push(value.text)
    if (value.content) visit(value.content)
    if (value.children) visit(value.children)
  }
  visit(blocks); return parts.join(' ')
}
async function body(req, limit = 16 * 1024 * 1024) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request exceeds ' + (limit >= 1024 * 1024 ? Math.round(limit / 1024 / 1024) + ' MB' : limit + ' bytes')), { status: 413 }); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
}
function send(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(data)) }

// ---------- helpers de conteúdo ----------
const ERROR_CODES = new Set(['CANVAS_PROTECTED', 'SYNCED_BLOCK_PROTECTED', 'APPROVAL_REJECTED', 'APPROVAL_TIMEOUT', 'SCOPE_REQUIRED', 'REVOKED'])
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, ...(code ? { code } : {}) }) }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDay = value => typeof value === 'string' && DATE.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
const inline = text => [{ type: 'text', text, styles: {} }]
const baseProps = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }
/** Texto simples → blocos: "# título", "- item", "[ ] tarefa", "[x] feita"; o restante vira parágrafo. */
function textToBlocks(text) {
  if (typeof text !== 'string' || text.length > 200000) fail(400, 'Expected text up to 200,000 characters')
  const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(0, 1000)
  return lines.filter((line, index) => line.trim() || index < lines.length - 1).map(line => {
    let match
    if ((match = /^\s*(?:[-*] )?\[( |x|X)\] ?(.*)$/.exec(line))) return { id: randomUUID(), type: 'checkListItem', props: { ...baseProps, checked: match[1] !== ' ' }, content: inline(match[2]), children: [] }
    if ((match = /^(#{1,3}) (.*)$/.exec(line))) return { id: randomUUID(), type: 'heading', props: { ...baseProps, level: match[1].length }, content: inline(match[2]), children: [] }
    if ((match = /^\s*[-*] (.*)$/.exec(line))) return { id: randomUUID(), type: 'bulletListItem', props: baseProps, content: inline(match[1]), children: [] }
    return { id: randomUUID(), type: 'paragraph', props: baseProps, content: line ? inline(line) : [], children: [] }
  })
}
function blocksFromInput(input) {
  if (Array.isArray(input.blocks)) {
    if (input.blocks.length > 1000 || input.blocks.some(block => !block || typeof block !== 'object' || typeof block.type !== 'string')) fail(400, 'Expected up to 1000 blocks with a type')
    if (input.blocks.some(block => block.type === 'canvas')) fail(409, 'CANVAS_PROTECTED: a lousa não pode ser escrita por esta ferramenta.', 'CANVAS_PROTECTED')
    return input.blocks.map(block => block.id ? block : { ...block, id: randomUUID() })
  }
  return textToBlocks(input.text)
}
const hasCanvas = blocks => (Array.isArray(blocks) ? blocks : []).some(block => block?.type === 'canvas' || hasCanvas(block?.children))
function newPage(meta, { id, parentId = null, title, props, text = '', database, icon = null }) {
  const now = Date.now()
  return { id, parentId, title, icon, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, createdBy: 'Local API', updatedBy: 'Local API', order: Math.max(0, ...Object.values(meta.pages).map(p => p.order)) + 1, fullWidth: false, smallText: false, font: 'default', locked: false, text, ...(text ? { bodyText: text } : {}), ...(props ? { props } : {}), ...(database ? { database } : {}) }
}
const CLIP_ROUTES = new Set(['/v1/clip', '/v1/clip/pair', '/v1/clip/whoami'])
const clampLimit = (value, fallback = 200) => Math.max(1, Math.min(1000, Math.floor(Number(value)) || fallback))

/** Opt-in API, bound exclusively to loopback, without browser-origin access. */
async function startLocalApi({ storage: rawStorage, token, onChange, port = 0, access: providedAccess }) {
  // Páginas "Privadas para IA" (e suas subpáginas) nunca aparecem para agentes (A1).
  const storage = guardAiPrivate(rawStorage)
  const access = providedAccess ?? legacyAccess(token)
  const searchIndex = createSearchIndex()
  const checklistCache = new Map()
  const clipRate = clip.createRateLimiter({ limit: 30, windowMs: 60_000 })
  // Os renderers recebem o meta REAL (nunca a vista mascarada dos agentes): senão páginas privadas viriam como esqueletos.
  const emit = async change => { try { onChange?.(change.meta ? { ...change, meta: await rawStorage.loadMeta() } : change) } catch { /* O app já foi avisado pelo disco. */ } }
  /** Itens de checklist por página, relidos só quando a página mudou (chave = versão). */
  async function loadChecklists(meta, runtime) {
    const out = new Map(), todo = []
    for (const page of Object.values(meta.pages)) {
      if (page.trashed || page.database || page.pendingTemplateBlocks || page.passwordLock || !page.text?.trim() || !isLivePage(page.id, meta.pages)) { checklistCache.delete(page.id); continue }
      const key = `${page.updatedAt}:${page.text.length}`, hit = checklistCache.get(page.id)
      if (hit?.key === key) { if (hit.entries.length) out.set(page.id, hit.entries) } else todo.push([page.id, key])
    }
    for (let at = 0; at < todo.length; at += 16) await Promise.all(todo.slice(at, at + 16).map(async ([id, key]) => {
      const entries = runtime.extractChecklist(await storage.loadDoc(id).catch(() => null) ?? [])
      checklistCache.set(id, { key, entries }); if (entries.length) out.set(id, entries)
    }))
    return out
  }
  function dailyLookup(meta, runtime, date) {
    const dbId = meta.settings?.dailyFlow?.databaseId, db = dbId ? meta.pages[dbId] : undefined
    const valid = !!db?.database && isLivePage(dbId, meta.pages) && !!runtime.dailyDateProperty(db.database)
    const note = valid ? runtime.dailyIndex(meta.pages, dbId, id => isLivePage(id, meta.pages)).get(date) : undefined
    return { dbId: valid ? dbId : null, propId: valid ? runtime.dailyDateProperty(db.database) : null, note }
  }
  const dayParam = (runtime, value) => value === 'today' || value === 'hoje' ? runtime.localDay() : validDay(value) ? value : fail(400, 'Invalid date (use YYYY-MM-DD or "today")')

  /** POST /v1/clip/pair (código → token), POST /v1/clip (cria um recorte) e GET /v1/clip/whoami. */
  async function handleClip(req, res, url, call, setClient) {
    const extensionId = clip.extensionIdFromOrigin(req.headers.origin)
    if (!extensionId) return send(res, 403, { error: 'Origin must be a browser extension (chrome-extension://…)' })
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' }
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Cache-Control': 'no-store' }); return res.end() }
    await access.load?.()
    if (url.pathname === '/v1/clip/pair') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, cors)
      call.action = 'clip.pair'
      const input = await body(req, 4096)
      if (!access.completePairing) return send(res, 404, { error: 'Pairing is not available' }, cors)
      try {
        const paired = await access.completePairing({ code: input?.code, extensionId })
        access.record({ clientId: paired.client.id, client: 'Clipper', method: 'POST', action: 'clip.pair', target: extensionId.slice(0, 8), result: 'approved', status: 200 })
        return send(res, 200, { token: paired.token, client: paired.client.name }, cors)
      } catch (error) {
        access.record({ client: 'Clipper', method: 'POST', action: 'clip.pair', target: extensionId.slice(0, 8), result: 'denied', status: error.status || 403, detail: error.message })
        return send(res, error.status || 403, { error: error.message, ...(error.code ? { code: error.code } : {}) }, cors)
      }
    }
    // As demais rotas pedem o token do Clipper, preso à extensão que foi pareada.
    const found = access.authenticate(req.headers.authorization || '')
    if (!found) return send(res, 401, { error: 'Bearer token required' }, cors)
    if (found.kind !== 'clipper') return send(res, 403, { error: 'Only a paired web clipper can use this route', code: 'SCOPE_REQUIRED' }, cors)
    if (found.extensionId !== extensionId) return send(res, 403, { error: 'This token belongs to another extension', code: 'SCOPE_REQUIRED' }, cors)
    setClient(found); call.client = found
    try {
      if (url.pathname === '/v1/clip/whoami') {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' }, cors)
        const meta = await storage.loadMeta()
        return send(res, 200, { client: found.name, folder: clip.clipFolderName(meta?.settings?.locale), canCreateOnly: true }, cors)
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, cors)
      call.action = 'clip.create'
      const wait = clipRate(found.id)
      if (wait) return send(res, 429, { error: 'Too many clips; try again shortly', code: 'RATE_LIMITED' }, { ...cors, 'Retry-After': String(wait) })
      const clean = clip.parseClip(await body(req, clip.LIMITS.body)); call.target = clean.title
      const meta = await storage.loadMeta()
      if (!meta) return send(res, 503, { error: 'Workspace is not initialized' }, cors)
      const locale = meta.settings?.locale === 'en-US' ? 'en-US' : 'pt-BR'
      const blocks = clip.clipBlocks(clean, locale)
      const existing = clip.findClipDatabase(meta.pages, id => isLivePage(id, meta.pages))
      if (existing?.page.locked) fail(423, 'Page is locked')
      // Guarda U1: a aprovação do clipper é dada uma vez ao parear e só vale para clip.create.
      call.mode = await access.requestApproval(found, { kind: 'clip.create', title: clean.title, parentTitle: clip.clipFolderName(locale), diff: diffBlocks([], blocks) })
      const id = randomUUID(), day = clip.localDay()
      await storage.saveDoc(id, blocks)
      let target
      const next = await storage.mutateMeta(current => {
        const live = clip.findClipDatabase(current.pages, pageId => isLivePage(pageId, current.pages))
        if (live?.page.locked) throw Object.assign(new Error('Page is locked'), { status: 423 })
        const pages = { ...current.pages }
        let folder = live
        if (!folder) {
          const schema = clip.clipDatabaseSchema(locale, randomUUID), dbId = randomUUID()
          pages[dbId] = newPage({ ...current, pages }, { id: dbId, title: clip.clipFolderName(locale), icon: 'lucide:scissors:blue', database: schema })
          folder = { page: pages[dbId], urlId: schema.properties[1].id, dateId: schema.properties[2].id }
        }
        target = newPage({ ...current, pages }, { id, parentId: folder.page.id, title: clean.title, props: { [folder.urlId]: clean.url, [folder.dateId]: { start: day } }, text: clip.blocksText(blocks) })
        pages[id] = target
        return { ...current, pages }
      })
      emit({ meta: next })
      return send(res, 201, { pageId: id, title: target.title, folder: clip.clipFolderName(locale) }, cors)
    } catch (error) {
      call.error = error
      return send(res, error.status || 500, { error: error.message, ...(ERROR_CODES.has(error.code) ? { code: error.code } : {}) }, cors)
    }
  }

  const server = http.createServer(async (req, res) => {
    const call = { method: req.method, action: '', target: '', mode: null }
    let client = null
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), parts = url.pathname.split('/').filter(Boolean)
      // B1: rotas do web clipper — as ÚNICAS que aceitam Origin, e só `chrome-extension://<id>`; tudo o mais segue fechado a navegadores.
      if (CLIP_ROUTES.has(url.pathname)) return await handleClip(req, res, url, call, v => { client = v })
      if (req.headers.origin) return send(res, 403, { error: 'Browser origins are not allowed' })
      await access.load?.()
      client = access.authenticate(req.headers.authorization || '')
      if (!client) return send(res, 401, { error: 'Bearer token required' })
      if (client.kind === 'clipper') fail(403, 'Este token só pode criar recortes em /v1/clip.', 'SCOPE_REQUIRED')
      const writes = req.method !== 'GET' && req.method !== 'HEAD' && !(req.method === 'POST' && url.pathname === '/v1/query')
      if (writes && !client.scopes.includes('write')) fail(403, 'Este cliente tem acesso somente de leitura. Ative "escrever" para ele em Configurações → Dados → Agentes.', 'SCOPE_REQUIRED')
      if (!client.scopes.includes('read')) fail(403, 'Este cliente não tem permissão de leitura.', 'SCOPE_REQUIRED')
      /** Toda escrita passa por aqui antes de gravar: pede aprovação (ou segue se o cliente é automático/liberado). */
      const gate = async change => { call.mode = await access.requestApproval(client, change) }
      const meta = await storage.loadMeta()
      if (!meta) return send(res, 503, { error: 'Workspace is not initialized' })
      const locale = meta.settings?.locale === 'en-US' ? 'en-US' : 'pt-BR'

      async function appendToDoc(id, page, additions, { gated = false, kind = 'blocks.append' } = {}) {
        if (page.locked) fail(423, 'Page is locked')
        for (let attempt = 0; attempt < 3; attempt++) {
          const stored = await storage.loadDoc(id), current = stored ?? []
          if (!gated) {
            await gate({ kind, pageId: id, title: page.title, diff: diffBlocks(exposeBlocks(current, page.title), exposeBlocks([...current, ...additions], page.title)) })
            gated = true
          }
          // Depois da aprovação o documento pode ter mudado: releia e anexe sobre a versão atual.
          const fresh = await storage.loadDoc(id), blocks = [...(fresh ?? []), ...additions]
          try {
            const next = await storage.editDocument(id, blocks, fresh === null ? null : JSON.stringify(fresh), 'Local API')
            emit({ documentId: id, meta: next }); return blocks
          } catch (error) { if (!String(error.message).includes('DOC_CONFLICT') || attempt === 2) throw error }
        }
      }
      async function dailyAppend(date, additions) {
        const runtime = await loadAgentRuntime()
        const found = dailyLookup(meta, runtime, date)
        if (found.note) { call.target = found.note.title; const blocks = await appendToDoc(found.note.id, found.note, additions, { kind: 'daily.append' }); return { pageId: found.note.id, created: false, blocks } }
        const checklists = await loadChecklists(meta, runtime)
        const day = runtime.listTasks({ pages: meta.pages, checklists, locale, today: runtime.localDay(), bucket: 'all', databaseId: found.dbId, limit: 1000 }).tasks.filter(task => task.due === date)
        const template = meta.settings?.dailyFlow?.templateId ? meta.settings.personalTemplates?.find(item => item.id === meta.settings.dailyFlow.templateId)?.blocks : null
        const built = runtime.buildDailyNote({ date, locale, template, userName: meta.settings?.userName, tasks: day.map(task => ({ title: task.title, pageTitle: task.page, time: task.time, href: `workspace://page/${task.pageId}${task.blockId ? '#block=' + task.blockId : ''}` })) })
        call.target = built.title
        await gate({ kind: 'daily.create', title: built.title, diff: diffBlocks([], [...built.blocks, ...additions]) })
        const id = randomUUID(); let existing = null
        await storage.saveDoc(id, built.blocks)
        await storage.mutateMeta(current => {
          const lookup = dailyLookup(current, runtime, date)
          if (lookup.note) { existing = lookup.note.id; return current }
          const pages = { ...current.pages }; let settings = current.settings, dbId = lookup.dbId, propId = lookup.propId
          if (!dbId) {
            const created = runtime.dailyDatabaseSchema(locale, randomUUID)
            dbId = randomUUID(); propId = created.datePropertyId
            pages[dbId] = newPage(current, { id: dbId, title: locale === 'en-US' ? 'Daily notes' : 'Notas diárias', icon: 'lucide:calendar-days:red', database: created.schema })
            settings = { ...settings, dailyFlow: { ...settings.dailyFlow, databaseId: dbId } }
          }
          pages[id] = newPage({ ...current, pages }, { id, parentId: dbId, title: built.title, props: { [propId]: { start: date } }, text: built.text })
          return { ...current, pages, settings }
        })
        if (existing) { await rawStorage.deleteDoc?.(id).catch(() => {}); const note = (await storage.loadMeta()).pages[existing]; return { pageId: existing, created: false, blocks: await appendToDoc(existing, note, additions, { gated: true }) } }
        emit({ meta: await storage.loadMeta() })
        const page = (await storage.loadMeta()).pages[id]
        return { pageId: id, created: true, blocks: additions.length ? await appendToDoc(id, page, additions, { gated: true }) : built.blocks }
      }

      if (req.method === 'GET' && url.pathname === '/v1/whoami') {
        call.action = 'whoami'
        return send(res, 200, { client: client.name, scopes: client.scopes, autoWrite: !!client.autoWrite, approvalTimeoutSec: (await access.settings?.())?.timeoutSec ?? 60 })
      }
      if (req.method === 'GET' && url.pathname === '/v1/events') {
        call.action = 'events'
        return send(res, 200, { results: (await storage.listActivity()).filter(item => item.at > Number(url.searchParams.get('after') || 0)) })
      }
      if (req.method === 'GET' && (url.pathname === '/v1/pages' || url.pathname === '/v1/search')) {
        const q = url.searchParams.get('q') || ''
        call.action = 'search'; call.target = q.slice(0, 80)
        return send(res, 200, { results: searchIndex.search(meta.pages, q, { limit: clampLimit(url.searchParams.get('limit')) }) })
      }
      if (req.method === 'GET' && url.pathname === '/v1/types') {
        call.action = 'types.read'
        return send(res, 200, { results: (await loadAgentRuntime()).listTypes(meta.settings?.objectTypes) })
      }
      if (req.method === 'GET' && url.pathname === '/v1/tasks') {
        call.action = 'tasks.read'; call.target = url.searchParams.get('bucket') || 'all'
        const runtime = await loadAgentRuntime(), found = dailyLookup(meta, runtime, '0000-00-00')
        const checklists = await loadChecklists(meta, runtime)
        return send(res, 200, runtime.listTasks({ pages: meta.pages, checklists, locale, today: validDay(url.searchParams.get('today')) ? url.searchParams.get('today') : undefined, bucket: url.searchParams.get('bucket') || 'all', databaseId: found.dbId, includeDone: url.searchParams.get('done') === '1', limit: url.searchParams.get('limit') }))
      }
      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        call.action = 'tasks.add'
        const input = await body(req), runtime = await loadAgentRuntime()
        if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 2000) return send(res, 400, { error: 'Expected a title up to 2000 characters' })
        if (input.due !== undefined && !validDay(input.due)) return send(res, 400, { error: 'Invalid due date (use YYYY-MM-DD)' })
        const title = input.title.trim().replace(/\s+/g, ' ')
        if (input.pageId !== undefined) {
          if (typeof input.pageId !== 'string' || !isLivePage(input.pageId, meta.pages) || meta.pages[input.pageId].database) return send(res, 404, { error: 'Page not found' })
          const block = runtime.taskBlock(title, input.due, randomUUID)
          call.target = meta.pages[input.pageId].title
          await appendToDoc(input.pageId, meta.pages[input.pageId], [block], { kind: 'task.add' })
          return send(res, 201, { pageId: input.pageId, blockId: block.id, title, due: input.due ?? null })
        }
        const date = input.due ?? runtime.localDay(), block = runtime.taskBlock(title, undefined, randomUUID)
        const result = await dailyAppend(date, [block])
        return send(res, 201, { pageId: result.pageId, blockId: block.id, title, due: date })
      }
      if (req.method === 'POST' && url.pathname === '/v1/query') {
        call.action = 'query'
        const input = await body(req), runtime = await loadAgentRuntime()
        if (!input || typeof input.text !== 'string' || !input.text.trim()) return send(res, 400, { error: 'Expected the query text' })
        call.target = input.text.slice(0, 120)
        const found = dailyLookup(meta, runtime, '0000-00-00')
        const checklists = /\b(tarefas?|tasks?)\b/i.test(input.text) ? await loadChecklists(meta, runtime) : new Map()
        const result = runtime.runTextQuery({ text: input.text, pages: meta.pages, checklists, locale, types: meta.settings?.objectTypes, databaseId: found.dbId, limit: input.limit })
        return send(res, result.ok ? 200 : 400, result)
      }
      if (parts[0] === 'v1' && parts[1] === 'daily' && parts[2] && !parts[4]) {
        const runtime = await loadAgentRuntime(), date = dayParam(runtime, parts[2])
        if (req.method === 'GET' && parts.length === 3) {
          call.action = 'daily.read'; call.target = date
          const found = dailyLookup(meta, runtime, date)
          if (!found.note) return send(res, 200, { date, exists: false })
          const shown = exposeBlocks(await storage.loadDoc(found.note.id) ?? [], found.note.title)
          return send(res, 200, { date, exists: true, page: found.note, blocks: shown }, { ETag: etag(shown) })
        }
        if (req.method === 'POST' && parts[3] === 'append') {
          call.action = 'daily.append'; call.target = date
          const input = await body(req)
          if (!input || typeof input !== 'object') return send(res, 400, { error: 'Expected text or blocks' })
          const additions = blocksFromInput(input)
          if (!additions.length) return send(res, 400, { error: 'Nothing to append' })
          const result = await dailyAppend(date, additions)
          return send(res, 200, { date, pageId: result.pageId, created: result.created, appended: additions.length })
        }
      }
      if (req.method === 'POST' && url.pathname === '/v1/pages') {
        call.action = 'page.create'
        const input = await body(req)
        if (!input || typeof input.title !== 'string' || input.parentId && (!isLivePage(input.parentId, meta.pages) || meta.pages[input.parentId].locked && !meta.pages[input.parentId].database)) return send(res, 400, { error: 'Invalid title or parent' })
        const initial = input.text !== undefined || input.blocks !== undefined ? blocksFromInput(input) : []
        call.target = input.title
        await gate({ kind: 'page.create', title: input.title, parentTitle: input.parentId ? meta.pages[input.parentId].title : '', diff: diffBlocks([], [{ type: 'heading', content: inline(input.title) }, ...initial]) })
        const id = randomUUID()
        const page = newPage(meta, { id, parentId: input.parentId || null, title: input.title })
        await storage.saveDoc(id, initial)
        const next = await storage.saveMeta({ ...meta, pages: { ...meta.pages, [id]: page } }, meta)
        emit({ meta: next }); return send(res, 201, page)
      }
      if (parts[0] !== 'v1' || parts[1] !== 'pages' || !isLivePage(parts[2], meta.pages)) return send(res, 404, { error: 'Page not found' })
      const id = parts[2], page = meta.pages[id]
      call.target = page.title || id
      if (parts.length === 3 && req.method === 'GET') { call.action = 'page.read'; return send(res, 200, page) }
      if (parts.length === 4 && parts[3] === 'append' && req.method === 'POST') {
        call.action = 'page.append'
        if (page.database) return send(res, 400, { error: 'Cannot append text to a database' })
        const additions = blocksFromInput(await body(req))
        if (!additions.length) return send(res, 400, { error: 'Nothing to append' })
        await appendToDoc(id, page, additions)
        return send(res, 200, { pageId: id, appended: additions.length })
      }
      if (parts.length === 4 && parts[3] === 'properties') {
        const database = page.parentId ? meta.pages[page.parentId] : undefined
        if (!database?.database) return send(res, 400, { error: 'Page is not a database row' })
        if (req.method === 'GET') {
          call.action = 'row.read'
          const properties = database.database.properties.map(property => ({ ...property, value: property.type === 'title' ? page.title : page.props?.[property.id] ?? null }))
          return send(res, 200, { rowId: page.id, parentId: page.parentId, properties }, { ETag: rowPropertiesEtag(page, database.database) })
        }
        if (req.method === 'PATCH') {
          call.action = 'row.write'
          if (page.locked) return send(res, 423, { error: 'Page is locked' })
          if (!req.headers['if-match']) return send(res, 428, { error: 'Read the current row properties and supply their ETag in If-Match' })
          const input = await body(req)
          if (!input || typeof input !== 'object' || Array.isArray(input) || !input.properties || typeof input.properties !== 'object' || Array.isArray(input.properties) || !Object.keys(input.properties).length || Object.keys(input.properties).length > 100) return send(res, 400, { error: 'Expected a properties object with 1 to 100 property IDs' })
          if (req.headers['if-match'] !== rowPropertiesEtag(page, database.database)) fail(412, 'ROW_CONFLICT: Read current properties before retrying')
          // Prévia (antes → depois) para a aprovação; a gravação abaixo valida de novo dentro da transação.
          const byName = new Map(database.database.properties.map(property => [property.id, property]))
          const before = {}, after = {}
          for (const [propertyId, value] of Object.entries(input.properties)) {
            const property = byName.get(propertyId)
            if (!property || property.type === 'title') fail(400, 'Unknown or read-only property: ' + propertyId)
            before[property.name] = page.props?.[propertyId]; after[property.name] = normalizePropertyValue(property, value, meta)
          }
          await gate({ kind: 'row.update', pageId: id, title: page.title, diff: diffValues(before, after) })
          let saved
          const next = await storage.mutateMeta(current => {
            const row = current.pages[id], parent = row?.parentId ? current.pages[row.parentId] : undefined
            if (!row || !isLivePage(id, current.pages) || !parent?.database) throw Object.assign(new Error('Page is not a live database row'), { status: 404 })
            if (row.locked) throw Object.assign(new Error('Page is locked'), { status: 423 })
            if (req.headers['if-match'] !== rowPropertiesEtag(row, parent.database)) throw Object.assign(new Error('ROW_CONFLICT: Read current properties before retrying'), { status: 412 })
            const byId = new Map(parent.database.properties.map(property => [property.id, property]))
            const nextProps = { ...row.props }
            for (const [propertyId, value] of Object.entries(input.properties)) {
              const property = byId.get(propertyId)
              if (!property || property.type === 'title') throw Object.assign(new Error('Unknown or read-only property: ' + propertyId), { status: 400 })
              nextProps[propertyId] = normalizePropertyValue(property, value, current)
            }
            const relatedPages = {}
            for (const [propertyId, value] of Object.entries(input.properties)) {
              const property = byId.get(propertyId)
              if (property.type !== 'relation' || !property.relationMirrorPropertyId) continue
              const targetDatabase = current.pages[property.relationDatabaseId]?.database
              const reverse = targetDatabase?.properties.find(candidate => candidate.id === property.relationMirrorPropertyId && candidate.type === 'relation' && candidate.relationDatabaseId === row.parentId)
              if (!reverse) continue
              const beforeIds = Array.isArray(row.props?.[propertyId]) ? row.props[propertyId] : []
              const afterIds = nextProps[propertyId]
              for (const targetId of new Set([...beforeIds, ...afterIds])) {
                const target = current.pages[targetId]
                if (!target || target.parentId !== property.relationDatabaseId || !isLivePage(targetId, current.pages)) continue
                const existing = Array.isArray(target.props?.[reverse.id]) ? target.props[reverse.id] : []
                const updated = afterIds.includes(targetId) ? [...new Set([...existing, id])] : existing.filter(linkedId => linkedId !== id)
                if (updated.length === existing.length && updated.every((linkedId, index) => linkedId === existing[index])) continue
                if (target.locked) throw Object.assign(new Error('A related page is locked'), { status: 423 })
                const pending = relatedPages[targetId] ?? target
                relatedPages[targetId] = { ...pending, props: { ...pending.props, [reverse.id]: updated }, updatedAt: Date.now(), updatedBy: 'Local API' }
              }
            }
            saved = { ...row, props: nextProps, updatedAt: Date.now(), updatedBy: 'Local API' }
            return { ...current, pages: { ...current.pages, ...relatedPages, [id]: saved } }
          }).catch(error => { error.status ||= String(error.message).includes('ROW_CONFLICT') ? 412 : 500; throw error })
          emit({ meta: next }); return send(res, 200, { rowId: saved.id, props: saved.props ?? {} }, { ETag: rowPropertiesEtag(saved, next.pages[saved.parentId].database) })
        }
      }
      if (parts.length === 3 && req.method === 'PATCH') {
        call.action = 'page.update'
        if (page.locked) return send(res, 423, { error: 'Page is locked' })
        const input = await body(req), patch = {}
        for (const key of ['title', 'favorite', 'trashed']) if (input[key] !== undefined) {
          if (typeof input[key] !== (key === 'title' ? 'string' : 'boolean')) return send(res, 400, { error: `Invalid ${key}` })
          patch[key] = input[key]
        }
        if (patch.trashed !== undefined) patch.trashedAt = patch.trashed ? Date.now() : null
        // Lousa: um agente não manda para a lixeira uma página que contém quadro (U1, docs/USAGE.md).
        if (patch.trashed === true && hasCanvas(await storage.loadDoc(id))) fail(409, 'CANVAS_PROTECTED: a página contém uma lousa; só o app pode movê-la para a lixeira.', 'CANVAS_PROTECTED')
        const changes = Object.fromEntries(Object.entries(patch).filter(([key, value]) => key !== 'trashedAt' && page[key] !== value))
        if (Object.keys(changes).length) await gate({ kind: 'page.update', pageId: id, title: page.title, diff: diffValues({ title: page.title, favorite: page.favorite, trashed: page.trashed }, changes) })
        const updated = { ...page, ...patch, updatedAt: Date.now(), updatedBy: 'Local API' }
        const next = await storage.saveMeta({ ...meta, pages: { ...meta.pages, [id]: updated } }, meta)
        emit({ meta: next }); return send(res, 200, updated)
      }
      if (parts.length === 4 && parts[3] === 'blocks') {
        const stored = await storage.loadDoc(id), current = stored ?? []
        // O lousa sai como bloco opaco (resumo); o ETag cobre a cena via `rev`.
        const shown = exposeBlocks(current, page.title)
        if (req.method === 'GET') { call.action = 'blocks.read'; return send(res, 200, { results: shown }, { ETag: etag(shown) }) }
        if (req.method === 'PUT') {
          call.action = 'blocks.write'
          if (page.locked) return send(res, 423, { error: 'Page is locked' })
          if (req.headers['if-match'] !== etag(shown)) return send(res, 412, { error: 'Read the current blocks and supply their ETag in If-Match' })
          const incoming = await body(req)
          if (!Array.isArray(incoming)) return send(res, 400, { error: 'Expected an array of blocks' })
          const blocks = mergeCanvasBlocks(current, incoming)
          assertProtectedPreserved(current, blocks)
          await gate({ kind: 'blocks.replace', pageId: id, title: page.title, diff: diffBlocks(shown, exposeBlocks(blocks, page.title)) })
          // A página pode ter mudado enquanto esperava a aprovação: confere o ETag de novo antes de gravar.
          const latest = await storage.loadDoc(id)
          if (etag(exposeBlocks(latest ?? [], page.title)) !== req.headers['if-match']) return send(res, 412, { error: 'The page changed while waiting for approval; read the blocks again and retry', code: 'STALE_AFTER_APPROVAL' })
          const next = await storage.editDocument(id, blocks, stored === null ? null : JSON.stringify(current), 'Local API')
          const result = exposeBlocks(blocks, page.title)
          emit({ documentId: id, meta: next }); return send(res, 200, { results: result }, { ETag: etag(result) })
        }
      }
      send(res, 405, { error: 'Method not allowed' })
    } catch (error) {
      call.error = error
      send(res, error.status || (String(error.message).includes('CONFLICT') || String(error.message).includes('CONCURRENT') ? 409 : 500), { error: error.message, ...(ERROR_CODES.has(error.code) ? { code: error.code } : {}) })
    } finally {
      if (client && call.action && call.action !== 'events' && call.action !== 'whoami') {
        const status = res.statusCode, code = call.error?.code
        const result = status < 300 ? (call.mode === 'auto' ? 'auto' : call.mode === 'grant' ? 'granted' : call.mode === 'approved' ? 'approved' : 'ok')
          : code === 'APPROVAL_REJECTED' ? 'rejected' : code === 'APPROVAL_TIMEOUT' ? 'timeout' : code === 'SCOPE_REQUIRED' || code === 'REVOKED' ? 'denied' : 'error'
        access.record({ clientId: client.id, client: client.name, method: call.method, action: call.action, target: call.target, result, status, detail: result === 'error' ? call.error?.message : undefined })
      }
    }
  })
  server.requestTimeout = 15000
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local API port')
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  server.unref()
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }) }
}
module.exports = { startLocalApi, normalizePropertyValue, textToBlocks }
