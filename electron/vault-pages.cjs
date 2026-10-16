const COMPAT = require('../shared/compatibility.cjs')
// Password-protected pages. Each protected tree ("root") has its own random page key,
// wrapped by a key derived from the page password (scrypt, per-root salt). Document,
// version and draft files of protected pages get an inner AES-256-GCM layer bound to the
// page id; the workspace layer (device or vault) is applied on top of it.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { seal, open, isPageEncrypted, PAGE_MAGIC } = require('./encryption.cjs')
const vault = require('./vault.cjs')

const FILE = 'page-locks.json'
const PAGE_FILE = /^(?:docs\/([0-9a-f-]{36})\.json|versions\/([0-9a-f-]{36})\/[^/]+|drafts\/([0-9a-f-]{36})\/[^/]+)$/i
const registries = new Map()
let decodeFile = (_file, data) => data

function pageError(code, pt, en) { const error = new Error(`${code}: ${pt} / ${en}`); error.code = code; return error }
const parentLockedError = () => pageError('PARENT_LOCKED', 'Desbloqueie a página para adicionar subpáginas.', 'Unlock the page to add subpages.')
const lockedError = () => pageError('PAGE_LOCKED', 'Esta página está protegida por senha. Desbloqueie-a para continuar.', 'This page is password protected. Unlock it to continue.')

function configure(options) { if (options.decodeFile) decodeFile = options.decodeFile }
function pageIdOf(rel) { const match = PAGE_FILE.exec(rel); return match ? (match[1] || match[2] || match[3]).toLowerCase() : null }
function emptyData() { return { version: 1, settings: { relockMinutes: 5 }, roots: {} } }

/** Synchronous, fail-closed load (the storage codec is synchronous). Never caches a failure. */
function registry(dir) {
  const key = path.resolve(dir)
  let reg = registries.get(key)
  if (reg?.loaded) return reg
  const file = path.join(key, FILE)
  let data
  try { data = JSON.parse(decodeFile(file, fs.readFileSync(file)).toString('utf8')) }
  catch (error) { if (error.code === 'ENOENT') data = emptyData(); else throw error }
  if (!data || typeof data !== 'object' || typeof data.roots !== 'object') throw new Error('Registro de páginas protegidas inválido; os arquivos foram preservados.')
  reg = { loaded: true, dir: key, data, pageRoot: new Map(), keys: reg?.keys ?? new Map(), unsealing: new Set(), activity: new Map() }
  for (const [rootId, root] of Object.entries(data.roots)) for (const id of root.pages ?? []) reg.pageRoot.set(id, rootId)
  registries.set(key, reg)
  return reg
}
function tryRegistry(dir) { try { return registry(dir) } catch { return null } }
function forget(dir) {
  const reg = registries.get(path.resolve(dir))
  if (!reg) return
  for (const key of reg.keys.values()) key.fill(0)
  registries.delete(path.resolve(dir))
}
async function persist(dir, data, write) {
  await write(path.join(path.resolve(dir), FILE), JSON.stringify(data))
  const reg = registry(dir)
  reg.data = data
  reg.pageRoot = new Map()
  for (const [rootId, root] of Object.entries(data.roots)) for (const id of root.pages ?? []) reg.pageRoot.set(id, rootId)
}

/**
 * New subpages inherit the protection when the lock was created with "include subpages".
 * Older records without the flag inherit when they already protect more than the root page.
 */
function inherits(root, rootId) { return root?.includeChildren === undefined ? (root?.pages ?? []).some(id => id !== rootId) : !!root.includeChildren }
function rootOf(dir, pageId) { return registry(dir).pageRoot.get(pageId) ?? null }
function isProtected(dir, pageId) { return !!rootOf(dir, pageId) }
function isUnlocked(dir, rootId) { return registry(dir).keys.has(rootId) }
function canWrite(dir, pageId) { const rootId = rootOf(dir, pageId); return !rootId || isUnlocked(dir, rootId) }
function rootInfo(dir, rootId) { const root = registry(dir).data.roots[rootId]; return root ? { rootId, pages: [...root.pages], hideTitle: !!root.hideTitle, includeChildren: inherits(root, rootId), unlocked: isUnlocked(dir, rootId), pending: !!root.pending, hasHint: !!root.hint, createdAt: root.createdAt } : null }
/** Hint shown on the page unlock screen (lock metadata, readable before unlocking). */
function hintOf(dir, pageId) { const rootId = rootOf(dir, pageId); return (rootId && registry(dir).data.roots[rootId]?.hint) || null }
function list(dir) { return Object.keys(registry(dir).data.roots).map(id => rootInfo(dir, id)) }
function settings(dir) { return { relockMinutes: 5, ...(registry(dir).data.settings ?? {}) } }

/**
 * Pages that are new or moved under a protected page: a locked parent rejects the change;
 * an unlocked, inheriting parent adopts them. Pages that already have a lock keep it.
 */
function planChildren(dir, current, next) {
  const reg = registry(dir)
  if (!reg.pageRoot.size || !next?.pages) return new Map()
  const adopt = new Map()
  for (const [id, page] of Object.entries(next.pages)) {
    const before = current?.pages?.[id]
    if ((before && before.parentId === page.parentId) || reg.pageRoot.has(id)) continue
    let parentId = page.parentId, rootId = null
    const seen = new Set([id])
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      if (reg.pageRoot.has(parentId)) { rootId = reg.pageRoot.get(parentId); break }
      parentId = next.pages[parentId]?.parentId ?? null
    }
    if (!rootId) continue
    if (!reg.keys.has(rootId)) throw parentLockedError()
    if (inherits(reg.data.roots[rootId], rootId)) { if (!adopt.has(rootId)) adopt.set(rootId, []); adopt.get(rootId).push(id) }
  }
  return adopt
}
/** Adds pages to an unlocked root (their files are sealed by the caller). */
async function addPages(dir, rootId, pageIds, write) {
  if (!isUnlocked(dir, rootId)) throw parentLockedError()
  const data = structuredClone(registry(dir).data), root = data.roots[rootId]
  if (!root) throw pageError('NOT_PROTECTED', 'A página não está protegida.', 'The page is not protected.')
  const fresh = pageIds.filter(id => !registry(dir).pageRoot.has(id))
  if (!fresh.length) return []
  root.pages = [...root.pages, ...fresh]
  root.pending = true
  await persist(dir, data, write)
  return fresh
}
function encodeLayer(dir, rel, payload) {
  const id = pageIdOf(rel)
  if (!id) return payload
  const reg = registry(dir), rootId = reg.pageRoot.get(id)
  if (!rootId || reg.unsealing.has(rootId)) return payload
  const key = reg.keys.get(rootId)
  if (!key) throw lockedError()
  return seal(payload, key, PAGE_MAGIC, `${COMPAT.record013}${id}`)
}
function decodeLayer(dir, rel, payload) {
  if (!isPageEncrypted(payload)) return payload
  const id = pageIdOf(rel)
  if (!id) throw new Error('Arquivo protegido fora do lugar; o original foi preservado.')
  const reg = registry(dir), key = reg.keys.get(reg.pageRoot.get(id))
  if (!key) throw lockedError()
  return open(payload, key, PAGE_MAGIC, `${COMPAT.record013}${id}`)
}

/* ----------------------------- meta transforms ---------------------------- */

const titleLabel = id => `${COMPAT.record014}${id}`
/** Disk form: no content index, links or (optionally) title in clear text. */
function sealMeta(dir, next, diskCurrent) {
  if (!next?.pages) return next
  const reg = registry(dir)
  const pages = {}
  for (const [id, page] of Object.entries(next.pages)) {
    const rootId = reg.pageRoot.get(id), root = rootId && reg.data.roots[rootId]
    if (!root) {
      if (page.passwordLock) { const copy = { ...page }; delete copy.passwordLock; pages[id] = copy } else pages[id] = page
      continue
    }
    const out = { ...page, text: '', bodyText: '', outboundPageIds: [], bodyOutboundPageIds: [], passwordLock: { rootId, hideTitle: !!root.hideTitle, inherit: inherits(root, rootId) } }
    if (root.hideTitle) {
      const key = reg.keys.get(rootId)
      const previous = diskCurrent?.pages?.[id]?.passwordLock?.sealedTitle
      if (key && typeof page.title === 'string' && (page.title || !previous)) out.passwordLock.sealedTitle = seal(Buffer.from(page.title, 'utf8'), key, PAGE_MAGIC, titleLabel(id)).toString('base64')
      else if (previous) out.passwordLock.sealedTitle = previous
      out.title = ''
    }
    pages[id] = out
  }
  return { ...next, pages }
}
/** Renderer/API form: hidden titles are revealed only while the page is unlocked. */
function revealMeta(dir, meta) {
  if (!meta?.pages) return meta
  const reg = registry(dir)
  if (!reg.pageRoot.size && !Object.values(meta.pages).some(page => page.passwordLock)) return meta
  const pages = {}
  for (const [id, page] of Object.entries(meta.pages)) {
    const rootId = reg.pageRoot.get(id), root = rootId && reg.data.roots[rootId]
    if (!root) { if (page.passwordLock) { const copy = { ...page }; delete copy.passwordLock; pages[id] = copy } else pages[id] = page; continue }
    const key = reg.keys.get(rootId), out = { ...page, passwordLock: { rootId, hideTitle: !!root.hideTitle, inherit: inherits(root, rootId), unlocked: !!key } }
    if (root.hideTitle) {
      out.title = ''
      const sealed = page.passwordLock?.sealedTitle
      if (key && sealed) { try { out.title = open(Buffer.from(sealed, 'base64'), key, PAGE_MAGIC, titleLabel(id)).toString('utf8') } catch { out.title = '' } }
    }
    pages[id] = out
  }
  return { ...meta, pages }
}
function publicTitle(dir, id, page) {
  const reg = tryRegistry(dir), rootId = reg?.pageRoot.get(id)
  return rootId && reg.data.roots[rootId]?.hideTitle ? '' : page?.title ?? ''
}

/* ------------------------------- operations ------------------------------ */

async function protect(dir, { rootId, pageIds, password, hideTitle, includeChildren, kdf, hint }, write) {
  vault.validatePassword(password)
  const cleanHint = vault.normalizeHint(hint, password)
  const reg = registry(dir)
  for (const id of pageIds) if (reg.pageRoot.has(id)) throw pageError('ALREADY_PROTECTED', 'Uma das páginas já está protegida por senha.', 'One of these pages is already password protected.')
  const record = { kdf: vault.newKdf(kdf), hideTitle: !!hideTitle, includeChildren: !!includeChildren, pages: [...pageIds], createdAt: Date.now(), pending: true, ...(cleanHint ? { hint: cleanHint } : {}) }
  const key = crypto.randomBytes(32), kek = await vault.deriveKey(password, record.kdf)
  record.wrapped = vault.wrapKey(kek, key, `${COMPAT.record015}${rootId}`); kek.fill(0)
  const data = structuredClone(reg.data); data.roots[rootId] = record
  // Persist the wrapped key first: an interruption leaves readable clear-text files that
  // are sealed on the next unlock, never sealed files without a key record.
  registry(dir).keys.set(rootId, key)
  try { await persist(dir, data, write) } catch (error) { registry(dir).keys.delete(rootId); throw error }
  return key
}
async function finishPending(dir, rootId, write) {
  const data = structuredClone(registry(dir).data)
  if (!data.roots[rootId]?.pending) return
  delete data.roots[rootId].pending
  await persist(dir, data, write)
}
async function unlock(dir, rootId, password) {
  const root = registry(dir).data.roots[rootId]
  if (!root) throw pageError('NOT_PROTECTED', 'A página não está protegida.', 'The page is not protected.')
  const kek = await vault.deriveKey(String(password ?? ''), root.kdf)
  let key
  try { key = vault.unwrapKey(kek, root.wrapped, `${COMPAT.record015}${rootId}`) } finally { kek.fill(0) }
  registry(dir).keys.set(rootId, key)
  registry(dir).activity.set(rootId, Date.now())
  return key
}
function relock(dir, rootId) {
  const reg = registries.get(path.resolve(dir))
  const key = reg?.keys.get(rootId)
  if (key) { key.fill(0); reg.keys.delete(rootId) }
  reg?.activity.delete(rootId)
  return !!key
}
function touch(dir, rootId) { const reg = tryRegistry(dir); if (reg?.keys.has(rootId)) reg.activity.set(rootId, Date.now()) }
function unlockedRoots(dir) { const reg = registries.get(path.resolve(dir)); return reg ? [...reg.keys.keys()].map(rootId => ({ rootId, lastActivity: reg.activity.get(rootId) ?? 0 })) : [] }
function beginUnprotect(dir, rootId) { if (!isUnlocked(dir, rootId)) throw lockedError(); registry(dir).unsealing.add(rootId) }
async function finishUnprotect(dir, rootId, write) {
  const data = structuredClone(registry(dir).data); delete data.roots[rootId]
  try { await persist(dir, data, write) } finally { registry(dir).unsealing.delete(rootId) }
  relock(dir, rootId)
}
async function changePassword(dir, rootId, oldPassword, newPassword, write, options = {}) {
  vault.validatePassword(newPassword)
  const current = registry(dir).data.roots[rootId]
  const cleanHint = vault.normalizeHint(options.hint === undefined ? current?.hint : options.hint, newPassword)
  const key = await unlock(dir, rootId, oldPassword)
  const data = structuredClone(registry(dir).data), root = data.roots[rootId]
  if (cleanHint) root.hint = cleanHint; else delete root.hint
  root.kdf = vault.newKdf(root.kdf)
  const kek = await vault.deriveKey(newPassword, root.kdf)
  root.wrapped = vault.wrapKey(kek, key, `${COMPAT.record015}${rootId}`); kek.fill(0)
  await persist(dir, data, write)
}
async function setOptions(dir, patch, write) {
  const data = structuredClone(registry(dir).data)
  data.settings = { ...settings(dir), ...(Number.isFinite(patch.relockMinutes) ? { relockMinutes: Math.max(0, Math.min(1440, Math.round(patch.relockMinutes))) } : {}) }
  await persist(dir, data, write)
  return data.settings
}
async function setHideTitle(dir, rootId, hideTitle, write) {
  if (!isUnlocked(dir, rootId)) throw lockedError()
  const data = structuredClone(registry(dir).data)
  if (!data.roots[rootId]) throw pageError('NOT_PROTECTED', 'A página não está protegida.', 'The page is not protected.')
  data.roots[rootId].hideTitle = !!hideTitle
  await persist(dir, data, write)
}

/* ------------------------------ local API/MCP ----------------------------- */

/**
 * Storage view for the local HTTP API and MCP: protected pages look like trashed, empty pages
 * (so every live-page check rejects them), their documents are unreachable and their
 * activity is hidden. Writes can never change a protected page.
 */
function guardForApi(storage, dir = storage.directory) {
  const hidden = () => { const reg = tryRegistry(dir); return reg ? reg.pageRoot : new Map() }
  const notFound = () => Object.assign(new Error('Page not found'), { status: 404 })
  const mask = meta => {
    const ids = hidden()
    if (!meta?.pages || !ids.size) return meta
    const pages = { ...meta.pages }
    for (const id of ids.keys()) if (pages[id]) pages[id] = { ...pages[id], title: '', text: '', bodyText: '', props: {}, comments: [], trashed: true, passwordLock: { hidden: true } }
    return { ...meta, pages }
  }
  const guardId = id => { if (hidden().has(String(id).toLowerCase())) throw notFound() }
  return {
    ...storage,
    loadMeta: async () => mask(await storage.loadMeta()),
    saveMeta: async (proposed, base) => mask(await storage.saveMeta(proposed, base)),
    mutateMeta: async updater => mask(await storage.mutateMeta(async current => {
      const masked = mask(current), next = await updater(masked)
      if (!next || next === masked) return current
      const pages = { ...next.pages }
      for (const id of hidden().keys()) { if (current.pages[id]) pages[id] = current.pages[id]; else delete pages[id] }
      return { ...next, pages }
    })),
    loadDoc: async id => { guardId(id); return storage.loadDoc(id) },
    saveDoc: async (id, ...rest) => { guardId(id); return storage.saveDoc(id, ...rest) },
    editDocument: async (id, ...rest) => { guardId(id); return storage.editDocument(id, ...rest) },
    listVersions: async id => { guardId(id); return storage.listVersions(id) },
    listActivity: async () => { const ids = hidden(); return (await storage.listActivity()).filter(entry => !ids.has(entry.pageId)) },
  }
}

module.exports = {
  guardForApi, planChildren, addPages, inherits, parentLockedError,
  FILE, configure, pageIdOf, hintOf, registry, forget, rootOf, isProtected, isUnlocked, canWrite, rootInfo, list, settings,
  encodeLayer, decodeLayer, sealMeta, revealMeta, publicTitle,
  protect, finishPending, unlock, relock, touch, unlockedRoots, beginUnprotect, finishUnprotect, changePassword, setOptions, setHideTitle,
  lockedError,
}
