const COMPAT = require('../shared/compatibility.cjs')
const MEDIA_BLOCKS = new Set(['image', 'video', 'audio', 'file', 'pdfPreview', 'localAttachment'])
/** Nome do arquivo e legenda de blocos de mídia/anexo (espelha src/search/extract.ts). */
function attachmentText(block) {
  if (!block || !MEDIA_BLOCKS.has(block.type)) return ''
  return [block.props?.name, block.props?.caption].filter(value => typeof value === 'string' && value).join('\n')
}
function indexBlocks(blocks, syncedBlocks = {}) {
  const text = [], synced = new Set(), links = new Set()
  const inline = value => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(inline).join('')
    if (!value || typeof value !== 'object') return ''
    if (value.type === 'tableContent') return (value.rows ?? []).map(row => (row.cells ?? []).map(inline).join(' ')).join('\n')
    return typeof value.text === 'string' ? value.text : value.content ? inline(value.content) : ''
  }
  const references = value => {
    if (Array.isArray(value)) { value.forEach(references); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.syncedId === 'string') synced.add(value.syncedId)
    if (typeof value.pageId === 'string' && /^[a-f0-9-]{36}$/i.test(value.pageId)) links.add(value.pageId)
    if (typeof value.targetPageId === 'string' && /^[a-f0-9-]{36}$/i.test(value.targetPageId)) links.add(value.targetPageId)
    for (const href of [value.href, value.url]) {
      const match = typeof href === 'string' && new RegExp(`^(?:workspace|${COMPAT.record007}):\\/\\/page\\/([a-f0-9-]{36})(?:[#?].*)?$`, "i").exec(href)
      if (match) links.add(match[1])
    }
    Object.values(value).forEach(references)
  }
  const walk = list => { for (const block of list) {
    let value = block.type === 'bookmark' || block.type === 'externalReference' || block.type === 'onlineVideo' ? [block.props?.title, block.props?.description, block.props?.caption, block.props?.url].filter(value => typeof value === 'string').join('\n') : inline(block.content)
    if (block.type === 'mermaid') value = typeof block.props?.source === 'string' ? block.props.source : ''
    // Lousa (espelha canvasText em src/canvas/model.ts): texto digitado no quadro, nunca o das páginas dos cartões.
    if (block.type === 'canvas') value = (Array.isArray(block.props?.objects) ? block.props.objects : []).map(o => !o || typeof o !== 'object' ? ''
      : ['note', 'text', 'shape'].includes(o.type) ? o.text : o.type === 'section' ? o.title : o.type === 'connector' ? o.label : o.type === 'image' || o.type === 'file' ? o.name : '').filter(v => typeof v === 'string' && v).join('\n')
    if (block.type === 'htmlSandbox') value = typeof block.props?.html === 'string' ? block.props.html.replace(/<[^>]*>/g, ' ') : ''
    if (block.type === 'aiBlock' || block.type === 'aiMeetingNotes') value = [block.props?.prompt, block.props?.context, block.props?.output].filter(value => typeof value === 'string').join('\n')
    if (block.type === 'tabs' && typeof block.props?.tabsJson === 'string') {
      try { const tabs = JSON.parse(block.props.tabsJson); if (Array.isArray(tabs)) value = tabs.flatMap(tab => [tab?.title, tab?.body]).filter(value => typeof value === 'string').join('\n') } catch { /* Keep invalid tabs recoverable. */ }
    }
    if (value) text.push(value)
    const attachment = attachmentText(block)
    if (attachment) text.push(attachment)
    if (Array.isArray(block.children)) walk(block.children)
  } }
  walk(blocks); references(blocks)
  const bodyText = text.join('\n'), original = [...synced], bodyOutboundPageIds = [...links].sort()
  for (const id of original) { const record = syncedBlocks[id]; if (Array.isArray(record?.blocks)) { walk(record.blocks); references(record.blocks) } }
  return { bodyText, text: text.join('\n'), syncedBlockIds: original, outboundPageIds: [...links].sort(), bodyOutboundPageIds }
}
function isLivePage(id, pages) {
  const visited = new Set(); let page = pages[id]
  if (!page) return false
  while (page) {
    if (page.trashed || visited.has(page.id) || page.parentId && !pages[page.parentId]) return false
    visited.add(page.id); page = pages[page.parentId]
  }
  return true
}

// ---------- busca da API local / MCP / CLI (A2) ----------
// Em vez de montar e normalizar `título + texto + JSON(props)` de todas as páginas a cada chamada,
// guarda por página o texto já normalizado (chave = versão da página) e só percorre `includes`.
const fold = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const HAYSTACK_LIMIT = 100_000
function propText(value, depth = 0, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (typeof value === 'number') out.push(String(value))
  else if (Array.isArray(value) && depth < 3) value.forEach(item => propText(item, depth + 1, out))
  else if (value && typeof value === 'object' && depth < 3) Object.values(value).forEach(item => propText(item, depth + 1, out))
  return out
}
function createSearchIndex() {
  const cache = new Map()
  const versionOf = page => `${page.updatedAt}|${page.title}|${(page.text ?? '').length}|${page.props ? Object.keys(page.props).length : 0}`
  const haystack = page => {
    const key = versionOf(page), hit = cache.get(page.id)
    if (hit?.key === key) return hit.text
    const text = fold(`${page.title ?? ''}\n${(page.text ?? '').slice(0, HAYSTACK_LIMIT)}\n${page.props ? propText(page.props).join(' ') : ''}`)
    cache.set(page.id, { key, text, title: fold(page.title) })
    return text
  }
  return {
    /** Páginas vivas que contêm TODAS as palavras da consulta (título primeiro). `limit` opcional. */
    search(pages, query, { limit = 0 } = {}) {
      const terms = fold(query).split(/\s+/).filter(Boolean)
      const titleHits = [], bodyHits = []
      const ids = Object.keys(pages)
      if (cache.size > ids.length * 2 + 100) for (const id of cache.keys()) if (!pages[id]) cache.delete(id)
      for (const id of ids) {
        const page = pages[id]
        if (!isLivePage(id, pages)) continue
        if (terms.length) {
          const text = haystack(page)
          if (!terms.every(term => text.includes(term))) continue
          const title = cache.get(id).title
          ;(terms.every(term => title.includes(term)) ? titleHits : bodyHits).push(page)
        } else bodyHits.push(page)
      }
      const results = titleHits.concat(bodyHits)
      return limit > 0 ? results.slice(0, limit) : results
    },
    size: () => cache.size,
  }
}
module.exports = { indexBlocks, isLivePage, attachmentText, createSearchIndex }
