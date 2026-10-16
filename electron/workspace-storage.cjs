const COMPAT = require('../shared/compatibility.cjs')
const path = require('node:path')
const fs = require('node:fs/promises')
const { atomicWrite, readJson } = require('./storage.cjs')
const history = require('./document-history.cjs')
const { indexBlocks, isLivePage } = require('./content-index.cjs')
const mergeModule = import('./meta-merge.mjs')
const productivityModule = import('./productivity-data.mjs')
const ownershipModule = import('./page-block-ownership.mjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const queues = new Map()
const { randomUUID } = require('node:crypto')
const pageLocks = require('./vault-pages.cjs')
const vault = require('./vault.cjs')
const { isPageEncrypted } = require('./encryption.cjs')
const guard = require('./canvas-guard.cjs')
const schema = require('./migrations/index.cjs')

/** Política de histórico: o texto das Configurações (Padrão / Mais longo / Sem limite) vira opções do armazenamento. */
const historyOptions = (settings, id, isProtected) => ({ policy: ['default', 'long', 'unlimited'].includes(settings?.historyPolicy) ? settings.historyPolicy : 'default', limit: settings?.historyLimit ?? 0, dedupe: !isProtected(id) })

function transaction(directory, operation) {
  const next = (queues.get(directory) ?? Promise.resolve()).catch(() => {}).then(operation)
  queues.set(directory, next)
  next.finally(() => { if (queues.get(directory) === next) queues.delete(directory) }).catch(() => {})
  return next
}

function createWorkspaceStorage(directory) {
  const metaFile = path.join(directory, 'meta.json')
  const activityFile = path.join(directory, 'activity.json')
  // Registro de produtividade (docs/USAGE.md): só contadores por dia, segue a cifra do espaço.
  const productivityFile = path.join(directory, 'productivity.json')
  const journalFile = path.join(directory, 'content-transaction.json')
  const deletedFile = path.join(directory, 'deleted-pages.json')
  const docFile = id => { if (!UUID.test(String(id))) throw new Error('ID inválido'); return path.join(directory, 'docs', `${id}.json`) }
  const versionDir = id => { docFile(id); return path.join(directory, 'versions', id) }
  const draftFile = (id, owner) => { docFile(id); if (!UUID.test(owner)) throw new Error('Janela inválida'); return path.join(directory, 'drafts', id, `${owner}.json`) }
  // Password-protected pages: the disk form never keeps their content index (and hidden
  // titles) in clear text; callers always receive the revealed form.
  const readDiskMeta = async () => {
    const meta = await readJson(metaFile)
    schema.assertSchemaReadable(meta, directory) // app antigo: recusa, sem regravar nada
    return meta
  }
  const readMeta = async () => pageLocks.revealMeta(directory, await readDiskMeta())
  const relative = file => path.relative(directory, file).split(path.sep).join('/')
  // Removes only the workspace layer (device/vault), keeping the page layer.
  const outerPayload = async file => vault.decodeOuter(directory, relative(file), await fs.readFile(file))
  async function pageFiles(id) {
    const files = [docFile(id)]
    for (const folder of [versionDir(id), path.join(versionDir(id), 'blobs'), path.join(directory, 'drafts', id)]) {
      try { for (const name of await fs.readdir(folder)) if (name.endsWith('.json')) files.push(path.join(folder, name)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const present = []
    for (const file of files) { try { await fs.access(file); present.push(file) } catch { /* not created yet */ } }
    return present
  }
  async function sealedFiles(id) {
    const result = {}
    for (const file of await pageFiles(id)) if (!file.includes(`${path.sep}drafts${path.sep}`)) { const payload = await outerPayload(file); if (isPageEncrypted(payload)) result[relative(file)] = payload.toString('base64') }
    return result
  }
  const writeDiskMeta = async next => atomicWrite(metaFile, JSON.stringify({ ...pageLocks.sealMeta(directory, next, await readDiskMeta()), schemaVersion: schema.CURRENT_SCHEMA_VERSION }))
  async function activity(entries, settings) {
    if (!entries.length) return
    const current = await readJson(activityFile) ?? []
    const existing = new Set(current.map(entry => entry.id))
    const next = [...entries.filter(entry => !existing.has(entry.id)).map(entry => ({ id: randomUUID(), at: Date.now(), author: settings?.userName || (settings?.locale === 'en-US' ? 'You' : 'Você'), ...entry })), ...current]
    const limit = settings?.activityLimit ?? 2000
    await atomicWrite(activityFile, JSON.stringify(limit > 0 ? next.slice(0, limit) : next))
  }
  /** Brings pages under an unlocked protected root and seals their existing files. */
  async function adoptPages(rootId, ids) {
    const files = []
    for (const id of ids) for (const file of await pageFiles(id)) files.push({ file, value: await readJson(file) })
    const added = await pageLocks.addPages(directory, rootId, ids, atomicWrite)
    for (const { file, value } of files) if (value !== null) await atomicWrite(file, JSON.stringify(value))
    await pageLocks.finishPending(directory, rootId, atomicWrite)
    return added
  }
  async function writeMeta(current, next) {
    // Subpages of a locked page are rejected; under an unlocked inheriting page they get its lock.
    let adopted = false
    for (const [rootId, ids] of pageLocks.planChildren(directory, current, next)) { await adoptPages(rootId, ids); adopted = true }
    const { pageContentChanged } = await mergeModule
    for (const page of Object.values(next.pages)) {
      const seen = new Set([page.id])
      let parentId = page.parentId
      while (parentId) {
        if (!next.pages[parentId] || seen.has(parentId)) throw new Error(`CONCURRENT_CHANGE:pages.${page.id}.parentId`)
        seen.add(parentId); parentId = next.pages[parentId].parentId
      }
    }
    const removed = Object.values(current?.pages ?? {}).filter(page => !next.pages[page.id])
    // Persist tombstones before deleting metadata. Late saves from another window
    // must never recreate a deleted file or be silently removed by cleanup.
    if (removed.length) {
      const deleted = await readJson(deletedFile) ?? {}
      for (const page of removed) deleted[page.id] = { deletedAt: Date.now() }
      await atomicWrite(deletedFile, JSON.stringify(deleted))
    }
    for (const page of Object.values(current?.pages ?? {})) if (pageContentChanged(page, next.pages[page.id]) && pageLocks.canWrite(directory, page.id)) await history.checkpointPage(docFile(page.id), versionDir(page.id), page, historyOptions(next.settings, page.id, id => pageLocks.isProtected(directory, id)))
    await writeDiskMeta(next)
    const entries = [], title = (id, page) => pageLocks.publicTitle(directory, id, page)
    for (const [id, page] of Object.entries(next.pages)) {
      const before = current?.pages[id]
      if (!before) entries.push({ pageId: id, pageTitle: title(id, page), action: 'page.created' })
      else if (pageContentChanged(before, page)) entries.push({ pageId: id, pageTitle: title(id, page), action: !before.trashed && page.trashed ? 'page.trashed' : before.trashed && !page.trashed ? 'page.restored' : 'page.updated', fields: Object.keys(page).filter(key => JSON.stringify(page[key]) !== JSON.stringify(before[key])) })
    }
    for (const id of Object.keys(current?.pages ?? {})) if (!next.pages[id]) entries.push({ pageId: id, pageTitle: title(id, current.pages[id]), action: 'page.deleted' })
    await activity(entries, next.settings)
    // Adopted pages come back with their lock (and without clear-text index) for every window.
    return adopted ? pageLocks.revealMeta(directory, pageLocks.sealMeta(directory, next, null)) : next
  }
  async function recoverContent() {
    const pending = await readJson(journalFile)
    if (!pending) return
    const current = await readMeta()
    if (!current?.pages[pending.pageId] || !Array.isArray(pending.blocks) || !pending.page) throw new Error('Transação de conteúdo inválida. Os arquivos foram preservados.')
    await history.saveDocument(docFile(pending.pageId), versionDir(pending.pageId), pending.blocks, { base: pending.base, checkpoint: pending.checkpoint, page: pending.page, previousPage: current.pages[pending.pageId], ...historyOptions(current.settings, pending.pageId, id => pageLocks.isProtected(directory, id)) })
    const next = { ...current, pages: { ...current.pages, ...(pending.relatedPages ?? {}), [pending.pageId]: pending.page } }
    await writeMeta(current, next)
    await activity([{ id: pending.transactionId, pageId: pending.pageId, pageTitle: pageLocks.publicTitle(directory, pending.pageId, pending.page), action: 'content.updated', author: pending.page.updatedBy }], next.settings)
    await fs.rm(journalFile, { force: true })
  }
  // Primeira abertura com esquema antigo: copia os metadados e só então grava a versão nova.
  let schemaChecked = false
  async function migrateSchema() {
    if (schemaChecked) return
    const disk = await readDiskMeta()
    if (!disk) return
    const result = schema.migrateMeta(disk)
    if (result.changed) {
      if (result.from < schema.CURRENT_SCHEMA_VERSION) {
        const target = path.join(directory, 'migration-backups', `schema-v${result.from}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await fs.mkdir(target, { recursive: true, mode: 0o700 })
        for (const name of ['meta.json', 'activity.json', 'deleted-pages.json', 'content-transaction.json']) {
          try { await fs.copyFile(path.join(directory, name), path.join(target, name)) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
      }
      await atomicWrite(metaFile, JSON.stringify(result.meta))
    }
    schemaChecked = true
  }
  const tx = operation => transaction(directory, async () => { await migrateSchema(); await recoverContent(); return operation() })
  async function saveDocLocked(id, blocks, options, meta, deletedMap) {
      if (!Array.isArray(blocks)) throw new Error('Blocos inválidos')
      if (!meta?.pages[id]) {
        const deleted = (await deletedMap())?.[id]
        if (deleted) {
          const conflict = { id: randomUUID(), kind: 'deleted-document', pageId: id, savedAt: Date.now(), blocks, page: options.page ?? { id, parentId: null, title: '' } }
          await atomicWrite(path.join(directory, 'conflicts', `${conflict.id}.json`), JSON.stringify(conflict))
          throw new Error('DOC_DELETED: A página foi excluída em outra janela. Recupere suas edições em Configurações → Dados. / The page was deleted in another window. Recover your edits in Settings → Data.')
        }
      }
      const before = await history.readDocument(docFile(id))
      // Só o editor da própria página (ou uma escolha explícita do usuário) pode mudar lousa/bloco sincronizado.
      if (!options.userEdit && Array.isArray(before)) guard.assertProtectedPreserved(before, blocks)
      const { ownedPageBlockChanges } = await ownershipModule
      const changes = meta?.pages[id] && isLivePage(id, meta.pages) ? ownedPageBlockChanges(id, before ?? [], blocks, meta.pages, Number.isFinite(options.ownershipAt) ? options.ownershipAt : Date.now()) : {}
      const conflicting = options.base !== undefined && options.base !== (before === null ? null : JSON.stringify(before)) && JSON.stringify(before) !== JSON.stringify(blocks)
      if (!conflicting && Object.keys(changes).length) {
        const relatedPages = Object.fromEntries(Object.entries(changes).map(([key, patch]) => [key, { ...meta.pages[key], ...patch }]))
        await atomicWrite(journalFile, JSON.stringify({ transactionId: randomUUID(), pageId: id, blocks, base: options.base, checkpoint: options.checkpoint, page: meta.pages[id], relatedPages }))
        await recoverContent()
        const changed = await readMeta()
        if (changed) changedByDocument.add(changed)
        return changed
      }
      await history.saveDocument(docFile(id), versionDir(id), blocks, { ...options, previousPage: meta?.pages[id], ...historyOptions(meta?.settings, id, x => pageLocks.isProtected(directory, x)) })
      if (meta?.pages[id] && JSON.stringify(before) !== JSON.stringify(blocks)) await activity([{ pageId: id, pageTitle: pageLocks.publicTitle(directory, id, meta.pages[id]), action: 'content.updated' }], meta.settings)
      return meta ?? undefined
  }
  return {
    directory,
    loadMeta: () => tx(() => readMeta()),
    saveMeta: (proposed, base) => tx(async () => {
      if (!proposed || typeof proposed !== 'object' || !proposed.pages || !proposed.settings) throw new Error('Dados inválidos')
      const current = await readMeta()
      const { mergeMeta, assignSequences } = await mergeModule
      const merged = assignSequences(current, current && base ? mergeMeta(current, base, proposed) : proposed)
      // Registros de blocos sincronizados nunca somem por uma gravação do meta.
      if (current?.syncedBlocks && Object.keys(current.syncedBlocks).some(key => !merged.syncedBlocks?.[key])) merged.syncedBlocks = { ...current.syncedBlocks, ...merged.syncedBlocks }
      return writeMeta(current, merged)
    }),
    mutateMeta: updater => tx(async () => {
      const current = await readMeta()
      if (!current) return null
      const next = await updater(current)
      if (!next || next === current) return current
      guard.assertSyncedRecordsUntouched(current.syncedBlocks, next.syncedBlocks)
      return writeMeta(current, next)
    }),
    loadDoc: id => tx(() => history.readDocument(docFile(id))),
    saveDoc: (id, blocks, options = {}) => tx(async () => saveDocLocked(id, blocks, options, await readMeta(), () => readJson(deletedFile))),
    /**
     * Gravação em lote (importações): uma transação, o meta e as exclusões lidos uma única vez, sem
     * devolver o meta inteiro a cada página. Cada documento é gravado como no `saveDoc` (atômico);
     * se algum falhar, os documentos NOVOS deste lote são removidos e o erro é propagado.
     */
    saveDocs: (entries) => tx(async () => {
      if (!Array.isArray(entries)) throw new Error('Lote inválido')
      let meta = await readMeta(), deleted
      const deletedMap = async () => (deleted ??= await readJson(deletedFile))
      const created = []
      const one = async (entry) => {
        const id = entry?.id, existed = (await history.readDocument(docFile(id))) !== null
        const result = await saveDocLocked(id, entry.blocks, { ...(entry.options ?? {}), userEdit: false }, meta, deletedMap)
        if (!existed) created.push(id)
        return result
      }
      try {
        // Páginas ainda fora do meta (importação) não mexem no meta: gravadas em paralelo (8 por vez),
        // cada arquivo continua atômico. As demais seguem em série, como no saveDoc.
        const fresh = entries.filter(entry => !meta?.pages[entry?.id]), known = entries.filter(entry => meta?.pages[entry?.id])
        let failure = null
        for (let i = 0; i < fresh.length && !failure; i += 8) {
          const results = await Promise.allSettled(fresh.slice(i, i + 8).map(one))
          failure = results.find(result => result.status === 'rejected')?.reason ?? null
        }
        if (failure) throw failure
        for (const entry of known) {
          const result = await one(entry)
          if (result && result !== meta) meta = result
        }
      } catch (error) {
        for (const id of created) await fs.rm(docFile(id), { force: true }).catch(() => {})
        throw error
      }
      return { saved: entries.length }
    }),
    editDocument: (id, blocks, base, author = 'Local API') => tx(async () => {
      const meta = await readMeta(), current = await history.readDocument(docFile(id))
      if (!meta || !isLivePage(id, meta.pages) || meta.pages[id].locked) throw new Error('Página bloqueada ou indisponível')
      if (!Array.isArray(blocks)) throw new Error('Blocos inválidos')
      if (base !== (current === null ? null : JSON.stringify(current))) throw new Error('DOC_CONFLICT')
      guard.assertProtectedPreserved(current, blocks)
      const nextPage = { ...meta.pages[id], ...indexBlocks(blocks, meta.syncedBlocks), updatedAt: Date.now(), updatedBy: author }
      const { ownedPageBlockChanges } = await ownershipModule
      const relatedPages = Object.fromEntries(Object.entries(ownedPageBlockChanges(id, current ?? [], blocks, meta.pages)).map(([key, patch]) => [key, { ...meta.pages[key], ...patch }]))
      await atomicWrite(journalFile, JSON.stringify({ transactionId: randomUUID(), pageId: id, blocks, base, page: nextPage, relatedPages }))
      await recoverContent()
      return readMeta()
    }),
    listVersions: id => tx(() => history.listVersions(docFile(id), versionDir(id))),
    importVersions: (id, versions) => tx(() => history.importVersions(docFile(id), versionDir(id), versions, { dedupe: !pageLocks.isProtected(directory, id) })),
    pinVersion: (id, versionId, options) => tx(() => history.pinVersion(docFile(id), versionDir(id), versionId, options)),
    deleteDoc: id => tx(async () => {
      if ((await readMeta())?.pages[id]) throw new Error('A página ainda existe. / The page still exists.')
      await history.deleteDocument(docFile(id), versionDir(id))
    }),
    listDocumentConflicts: () => tx(async () => {
      const folder = path.join(directory, 'conflicts')
      let names
      try { names = await fs.readdir(folder) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
      const records = []
      for (const name of names.filter(name => UUID.test(name.replace(/\.json$/, '')))) {
        const record = await readJson(path.join(folder, name))
        if (record?.kind === 'deleted-document' && Array.isArray(record.blocks)) records.push(record)
      }
      return records.sort((a, b) => b.savedAt - a.savedAt)
    }),
    listActivity: () => tx(async () => await readJson(activityFile) ?? []),
    /** Eventos sem conteúdo de outros módulos (ex.: pedidos de IA em nuvem, electron/ai/service.cjs). */
    recordActivity: entries => tx(async () => activity(entries, (await readMeta())?.settings)),
    /** Espaço bloqueado: nada é lido nem gravado (o renderer mantém os incrementos na memória). */
    productivity: {
      load: () => tx(async () => { if (vault.isLocked(directory)) return null; const { normalizeData } = await productivityModule; return normalizeData(await readJson(productivityFile)) }),
      record: delta => tx(async () => {
        if (vault.isLocked(directory)) return { locked: true }
        const { applyDelta } = await productivityModule
        const next = applyDelta(await readJson(productivityFile), delta)
        await atomicWrite(productivityFile, JSON.stringify(next))
        return next
      }),
      backfill: days => tx(async () => {
        if (vault.isLocked(directory)) return { locked: true }
        const { applyBackfill, normalizeData } = await productivityModule
        const current = normalizeData(await readJson(productivityFile))
        if (current.backfilledAt) return current
        const next = applyBackfill(current, days)
        await atomicWrite(productivityFile, JSON.stringify(next))
        return next
      }),
      clear: () => tx(async () => {
        if (vault.isLocked(directory)) return { locked: true }
        const { clearedData } = await productivityModule
        const next = clearedData()
        await atomicWrite(productivityFile, JSON.stringify(next))
        return next
      }),
    },
    saveMetaConflict: meta => tx(async () => atomicWrite(path.join(directory, 'conflicts', `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ savedAt: Date.now(), meta: pageLocks.sealMeta(directory, meta, await readDiskMeta()) }))),
    draftSave: (id, owner, blocks) => tx(async () => {
      if (!Array.isArray(blocks)) throw new Error('Rascunho inválido')
      await atomicWrite(draftFile(id, owner), JSON.stringify({ blocks, savedAt: Date.now() }))
    }),
    draftDelete: (id, owner) => tx(() => fs.rm(draftFile(id, owner), { force: true })),
    draftLoad: (id, owner, activeOwners = []) => tx(async () => {
      const ownFile = draftFile(id, owner), own = await readJson(ownFile)
      if (own) { if (!Array.isArray(own.blocks)) throw new Error('Rascunho inválido'); return own.blocks }
      let names
      try { names = await fs.readdir(path.dirname(ownFile)) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
      const abandoned = []
      for (const name of names.filter(n => UUID.test(n.replace(/\.json$/, '')) && !activeOwners.includes(n.replace(/\.json$/, '')))) {
        const candidate = await readJson(path.join(path.dirname(ownFile), name))
        if (candidate && Array.isArray(candidate.blocks)) abandoned.push({ ...candidate, name })
      }
      abandoned.sort((a, b) => b.savedAt - a.savedAt)
      if (!abandoned.length) return null
      const latest = abandoned[0]
      await atomicWrite(ownFile, JSON.stringify({ blocks: latest.blocks, savedAt: latest.savedAt }))
      await fs.rm(path.join(path.dirname(ownFile), latest.name))
      return latest.blocks
    }),
    backup: () => tx(async () => {
      // Disk form of meta: protected pages keep no clear-text index or hidden title. Their
      // content is carried only in its page-encrypted form, even while unlocked.
      const meta = await readDiskMeta()
      if (!meta) return null
      const documents = {}, versions = {}, sealedPages = {}
      for (const id of Object.keys(meta.pages)) {
        if (pageLocks.isProtected(directory, id)) { documents[id] = []; versions[id] = []; sealedPages[id] = await sealedFiles(id); continue }
        documents[id] = await history.readDocument(docFile(id)) ?? []; versions[id] = await history.listVersions(docFile(id), versionDir(id))
      }
      return { format: COMPAT.record011, version: 1, schemaVersion: schema.CURRENT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), meta, documents, versions, ...(Object.keys(sealedPages).length ? { sealedPages } : {}), activity: await readJson(activityFile) ?? [] }
    }),
    pageFiles,
    protectPages: (rootId, password, options = {}) => tx(async () => {
      const meta = await readMeta()
      if (!meta?.pages[rootId] || !isLivePage(rootId, meta.pages)) throw new Error('Página indisponível / Page unavailable')
      const ids = [rootId, ...(options.includeChildren ? descendantsOf(meta.pages, rootId) : [])]
      const files = []
      for (const id of ids) for (const file of await pageFiles(id)) files.push({ file, value: await readJson(file) })
      await pageLocks.protect(directory, { rootId, pageIds: ids, password, hideTitle: !!options.hideTitle, includeChildren: !!options.includeChildren, kdf: options.kdf, hint: options.hint }, atomicWrite)
      for (const { file, value } of files) if (value !== null) await atomicWrite(file, JSON.stringify(value))
      await pageLocks.finishPending(directory, rootId, atomicWrite)
      await writeDiskMeta(meta)
      if (options.hideTitle) {
        // Earlier activity entries must not keep the hidden title either.
        const entries = await readJson(activityFile)
        if (Array.isArray(entries) && entries.some(entry => ids.includes(entry.pageId) && entry.pageTitle)) await atomicWrite(activityFile, JSON.stringify(entries.map(entry => ids.includes(entry.pageId) ? { ...entry, pageTitle: '' } : entry)))
      }
      return readMeta()
    }),
    unprotectPages: rootId => tx(async () => {
      const info = pageLocks.rootInfo(directory, rootId)
      if (!info) return readMeta()
      if (!info.unlocked) throw pageLocks.lockedError()
      const meta = await readMeta(), files = []
      for (const id of info.pages) for (const file of await pageFiles(id)) files.push({ file, value: await readJson(file) })
      pageLocks.beginUnprotect(directory, rootId)
      try { for (const { file, value } of files) if (value !== null) await atomicWrite(file, JSON.stringify(value)) }
      catch (error) { pageLocks.registry(directory).unsealing.delete(rootId); throw error }
      // Clear-text files are complete before the key record disappears (crash-safe order).
      const revealed = { ...meta, pages: Object.fromEntries(Object.entries(meta.pages).map(([id, page]) => { const copy = { ...page }; delete copy.passwordLock; return [id, copy] })) }
      await pageLocks.finishUnprotect(directory, rootId, atomicWrite)
      await atomicWrite(metaFile, JSON.stringify({ ...pageLocks.sealMeta(directory, revealed, null), schemaVersion: schema.CURRENT_SCHEMA_VERSION }))
      return readMeta()
    }),
    /** Seals any clear-text file left by an interrupted protection (requires the page key). */
    resealProtected: rootId => tx(async () => {
      const info = pageLocks.rootInfo(directory, rootId)
      if (!info?.unlocked) return 0
      let sealed = 0
      for (const id of info.pages) for (const file of await pageFiles(id)) {
        if (!isPageEncrypted(await outerPayload(file))) { const value = await readJson(file); if (value !== null) { await atomicWrite(file, JSON.stringify(value)); sealed++ } }
      }
      await pageLocks.finishPending(directory, rootId, atomicWrite)
      return sealed
    }),
    /** Adds pages (or every unprotected live descendant) to an unlocked protected root. */
    protectChildren: (rootId, pageIds) => tx(async () => {
      const info = pageLocks.rootInfo(directory, rootId)
      if (!info) throw new Error('NOT_PROTECTED')
      if (!info.unlocked) throw pageLocks.parentLockedError()
      const meta = await readMeta()
      const candidates = Array.isArray(pageIds) ? pageIds : [...new Set(info.pages.flatMap(id => descendantsOf(meta.pages, id)))]
      const ids = candidates.filter(id => meta.pages[id] && isLivePage(id, meta.pages) && !pageLocks.isProtected(directory, id))
      if (ids.length) { await adoptPages(rootId, ids); await writeDiskMeta(meta) }
      return { meta: await readMeta(), added: ids.length }
    }),
    /** Rewrites meta after a lock-state change (e.g. hidden-title option). */
    refreshProtectedMeta: () => tx(async () => { const meta = await readMeta(); if (meta) await writeDiskMeta(meta); return readMeta() }),
  }
}
function descendantsOf(pages, rootId) {
  const out = [], seen = new Set([rootId]), walk = parentId => { for (const page of Object.values(pages)) if (page.parentId === parentId && !seen.has(page.id)) { seen.add(page.id); out.push(page.id); walk(page.id) } }
  walk(rootId); return out
}
async function drainWorkspaces() { while (queues.size) await Promise.all([...queues.values()]) }
/** Metas que um saveDoc realmente alterou (transferência de páginas-bloco); os demais são só leitura. */
const changedByDocument = new WeakSet()
const metaChangedByDocument = meta => !!meta && changedByDocument.has(meta)

module.exports = { createWorkspaceStorage, drainWorkspaces, metaChangedByDocument }
