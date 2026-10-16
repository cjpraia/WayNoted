// "Privado para IA" (A1): a marca `aiPrivate` de uma página vale também para as subpáginas e tira o
// conteúdo da vista dos agentes (API local, MCP, CLI) e do envio a provedores de IA em nuvem.
// Aqui fica a máscara da vista dos agentes: páginas privadas viram esqueletos inexistentes (404).
const notFound = () => Object.assign(new Error('Page not found'), { status: 404 })

/** Ids das páginas privadas para IA: marcadas ou com algum ancestral marcado. */
function privateIds(pages) {
  const memo = new Map()
  const visit = id => {
    if (memo.has(id)) return memo.get(id)
    const page = pages[id]
    memo.set(id, false) // ciclo
    const result = !!page && (page.aiPrivate === true || (page.parentId ? visit(page.parentId) : false))
    memo.set(id, result)
    return result
  }
  const out = new Set()
  for (const id of Object.keys(pages)) if (visit(id)) out.add(id)
  return out
}

const isPrivate = (pages, id) => privateIds(pages).has(id)

function maskMeta(meta) {
  if (!meta?.pages) return meta
  let hidden = null
  for (const page of Object.values(meta.pages)) if (page?.aiPrivate === true) { hidden = privateIds(meta.pages); break }
  if (!hidden?.size) return meta
  const pages = { ...meta.pages }
  for (const id of hidden) {
    const page = pages[id]
    pages[id] = { id: page.id, parentId: page.parentId, order: page.order, createdAt: page.createdAt, updatedAt: page.updatedAt, title: '', text: '', bodyText: '', props: {}, comments: [], trashed: true, aiPrivate: true, locked: true }
  }
  return { ...meta, pages }
}

/** Envolve o armazenamento: leitura/escrita de páginas privadas é recusada; o restante passa intacto. */
function guardAiPrivate(storage) {
  const hiddenOf = meta => meta?.pages ? privateIds(meta.pages) : new Set()
  const guardId = async id => { if (hiddenOf(await storage.loadMeta()).has(String(id))) throw notFound() }
  return {
    ...storage,
    loadMeta: async () => maskMeta(await storage.loadMeta()),
    saveMeta: async (proposed, base) => {
      const current = await storage.loadMeta(), hidden = hiddenOf(current)
      if (!hidden.size) return maskMeta(await storage.saveMeta(proposed, base))
      // Os esqueletos nunca são gravados: páginas privadas voltam ao valor real em `proposed` e `base`.
      const restore = meta => meta?.pages ? { ...meta, pages: { ...meta.pages, ...Object.fromEntries([...hidden].filter(id => current.pages[id]).map(id => [id, current.pages[id]])) } } : meta
      return maskMeta(await storage.saveMeta(restore(proposed), restore(base)))
    },
    mutateMeta: async updater => maskMeta(await storage.mutateMeta(async current => {
      const masked = maskMeta(current), next = await updater(masked)
      if (!next || next === masked) return current
      const pages = { ...next.pages }
      for (const id of hiddenOf(current)) { if (current.pages[id]) pages[id] = current.pages[id]; else delete pages[id] }
      return { ...next, pages }
    })),
    loadDoc: async id => { await guardId(id); return storage.loadDoc(id) },
    saveDoc: async (id, ...rest) => { await guardId(id); return storage.saveDoc(id, ...rest) },
    editDocument: async (id, ...rest) => { await guardId(id); return storage.editDocument(id, ...rest) },
    listVersions: async id => { await guardId(id); return storage.listVersions(id) },
    listActivity: async () => { const ids = hiddenOf(await storage.loadMeta()); return ids.size ? (await storage.listActivity()).filter(entry => !ids.has(entry.pageId)) : storage.listActivity() },
  }
}

module.exports = { privateIds, isPrivate, maskMeta, guardAiPrivate, notFound }
