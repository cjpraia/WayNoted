// B1 — web clipper (lado do app): validação rígida do recorte recebido em POST /v1/clip, conversor
// Markdown → blocos (subconjunto seguro: nada de HTML nem de imagens remotas incorporadas) e o banco
// "Recortes da web" (Nome, URL, Data) onde cada recorte vira uma linha. Puro: sem disco, rede nem Electron.
const { randomUUID } = require('node:crypto')

const LIMITS = Object.freeze({ body: 2 * 1024 * 1024, title: 300, url: 2048, text: 300_000, selection: 100_000, markdown: 500_000, blocks: 1000, site: 120 })
const FOLDER_NAMES = Object.freeze({ 'pt-BR': 'Recortes da web', 'en-US': 'Web clips' })
const CLIP_FOLDER_NAMES = Object.freeze(Object.values(FOLDER_NAMES))
const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/

const bad = (message, status = 400) => Object.assign(new Error(message), { status })
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const oneLine = value => value.replace(CONTROL, '').replace(/\s+/g, ' ').trim()

/** `chrome-extension://<id>` → id (Chrome, Edge, Brave e Arc usam o mesmo esquema); qualquer outra origem → null. */
const extensionIdFromOrigin = origin => EXTENSION_ORIGIN.exec(String(origin ?? ''))?.[1] ?? null

function safeHttpUrl(value, field) {
  if (typeof value !== 'string' || value.length > LIMITS.url) throw bad(`Invalid ${field}`)
  let url
  try { url = new URL(value.trim()) } catch { throw bad(`Invalid ${field}`) }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw bad(`Invalid ${field}`)
  return url.href
}
function optionalString(input, field, max) {
  const value = input[field]
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw bad(`Invalid ${field}`)
  if (value.length > max) throw bad(`${field} exceeds ${max} characters`, 413)
  return value.replace(CONTROL, '').replace(/\r\n?/g, '\n')
}

/** Valida e limpa o corpo do recorte. Lança erro com `status` (400/413). */
function parseClip(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Expected a JSON object')
  const url = safeHttpUrl(input.url, 'url')
  const text = optionalString(input, 'text', LIMITS.text), selection = optionalString(input, 'selection', LIMITS.selection), markdown = optionalString(input, 'markdown', LIMITS.markdown)
  if (!text.trim() && !selection.trim() && !markdown.trim()) throw bad('Nothing to clip: send text, selection or markdown')
  let title = typeof input.title === 'string' ? oneLine(input.title) : ''
  if (typeof input.title === 'string' && input.title.length > LIMITS.title * 4) throw bad(`title exceeds ${LIMITS.title} characters`, 413)
  title = [...title].slice(0, LIMITS.title).join('') || new URL(url).hostname
  const image = input.image ? (() => { try { return safeHttpUrl(input.image, 'image') } catch { return '' } })() : ''
  const site = typeof input.site === 'string' ? [...oneLine(input.site)].slice(0, LIMITS.site).join('') : ''
  return { title, url, text, selection, markdown, image, site }
}

// ---------- Markdown → blocos ----------
const baseProps = () => ({ textColor: 'default', backgroundColor: 'default', textAlignment: 'left' })
const textNode = (text, styles = {}) => ({ type: 'text', text, styles })
const safeHref = value => /^(https?:\/\/|mailto:)/i.test(value) && value.length <= LIMITS.url && !/[\s<>"]/.test(value) ? value : null

const INLINE = /`([^`\n]+)`|!?\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+"[^"\n]*")?\s*\)|<(https?:\/\/[^>\s]+)>|\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|~~(?=\S)(.+?)(?<=\S)~~|\*(?=[^\s*])(.+?)(?<=[^\s*])\*|(?<![A-Za-z0-9])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![A-Za-z0-9])/g

/** Texto Markdown → nós inline (negrito, itálico, tachado, código, links http/https/mailto). Imagens viram links com o alt. */
function inlineNodes(source, styles = {}, depth = 0) {
  const out = []
  const push = (text, extra) => { if (text) out.push(textNode(text, { ...styles, ...extra })) }
  let last = 0
  source.replace(INLINE, (match, code, label, href, auto, bold, bold2, strike, italic, italic2, offset) => {
    push(source.slice(last, offset)); last = offset + match.length
    if (code !== undefined) push(code, { code: true })
    else if (href !== undefined) {
      const safe = safeHref(href), shown = label || href
      if (safe) {
        const content = inlineNodes(shown, styles, depth + 1).filter(node => node.type === 'text')
        out.push({ type: 'link', href: safe, content: content.length ? content : [textNode(shown, styles)] })
      } else push(label || '', {})
    } else if (auto !== undefined) out.push({ type: 'link', href: auto, content: [textNode(auto, styles)] })
    else {
      const inner = bold ?? bold2 ?? strike ?? italic ?? italic2
      const extra = bold !== undefined || bold2 !== undefined ? { bold: true } : strike !== undefined ? { strike: true } : { italic: true }
      if (depth >= 4) push(inner, extra); else out.push(...inlineNodes(inner, { ...styles, ...extra }, depth + 1))
    }
    return match
  })
  push(source.slice(last))
  return out
}

const block = (type, props, content, children = []) => ({ id: randomUUID(), type, props, content, children })

/** Markdown comum (cabeçalhos, listas, tarefas, citações, código, tabelas, linhas) → blocos do aplicativo. */
function markdownToBlocks(markdown, { limit = LIMITS.blocks } = {}) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const blocks = [], lists = [] // lists: pilha de { indent, block }
  let paragraph = [], truncated = false
  const add = item => { if (blocks.length >= limit) { truncated = true; return false } blocks.push(item); return true }
  const flush = () => { if (paragraph.length) { add(block('paragraph', baseProps(), inlineNodes(paragraph.join(' ').trim()))); paragraph = [] } }
  for (let i = 0; i < lines.length && !truncated; i++) {
    const line = lines[i]
    let m
    if ((m = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line))) {
      flush(); lists.length = 0
      const code = []
      for (i++; i < lines.length && !new RegExp('^\\s*' + m[1]).test(lines[i]); i++) code.push(lines[i])
      add(block('codeBlock', { language: m[2] || 'text' }, code.length ? [textNode(code.join('\n').slice(0, 100_000))] : []))
      continue
    }
    if (!line.trim()) { flush(); lists.length = 0; continue }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); lists.length = 0; add(block('heading', { ...baseProps(), level: Math.min(3, m[1].length) }, inlineNodes(m[2]))); continue }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); lists.length = 0; add(block('divider', {}, undefined)); continue }
    if ((m = /^\s{0,3}>\s?(.*)$/.exec(line))) {
      flush(); lists.length = 0
      const quote = [m[1]]
      while (i + 1 < lines.length && (m = /^\s{0,3}>\s?(.*)$/.exec(lines[i + 1]))) { quote.push(m[1]); i++ }
      for (const part of quote.join('\n').split(/\n{2,}/)) if (part.trim()) add(block('quote', baseProps(), inlineNodes(part.replace(/\n/g, ' ').trim())))
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush(); lists.length = 0
      const rows = [line]
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(lines[++i])
      const cells = row => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => inlineNodes(cell.replace(/\\\|/g, '|').trim()))
      const header = rows.length > 1 && /^[\s|:-]+$/.test(rows[1])
      const body = rows.filter((_, index) => !(header && index === 1)).slice(0, 200).map(row => ({ cells: cells(row).slice(0, 20) }))
      add(block('table', {}, { type: 'tableContent', ...(header ? { headerRows: 1 } : {}), rows: body }))
      continue
    }
    if ((m = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line))) {
      flush()
      const indent = m[1].replace(/\t/g, '    ').length
      const type = m[4] !== undefined ? 'checkListItem' : m[2] ? 'bulletListItem' : 'numberedListItem'
      const item = block(type, type === 'checkListItem' ? { ...baseProps(), checked: m[4] !== ' ' } : baseProps(), inlineNodes(m[5].trim()))
      while (lists.length && lists[lists.length - 1].indent >= indent) lists.pop()
      const parent = lists[lists.length - 1]
      if (parent && lists.length < 6) parent.block.children.push(item)
      else if (!add(item)) break
      lists.push({ indent, block: item })
      continue
    }
    lists.length = 0
    paragraph.push(line.trim())
  }
  flush()
  return { blocks, truncated }
}

const plainOf = nodes => (Array.isArray(nodes) ? nodes : []).map(node => node.type === 'link' ? plainOf(node.content) : node.text ?? '').join('')
function blocksText(blocks, max = 100_000) {
  const parts = []
  let size = 0
  const visit = list => {
    for (const item of list) {
      if (size > max) return
      const text = Array.isArray(item.content) ? plainOf(item.content) : item.content?.rows ? item.content.rows.map(row => row.cells.map(plainOf).join(' ')).join('\n') : ''
      if (text) { parts.push(text); size += text.length }
      if (item.children?.length) visit(item.children)
    }
  }
  visit(blocks)
  return parts.join('\n').slice(0, max)
}

const L = (locale, pt, en) => locale === 'en-US' ? en : pt

/** Corpo da página: fonte (link), seleção em citação, conteúdo limpo. Sem rede: a imagem destaque entra só como link. */
function clipBlocks(clip, locale = 'pt-BR') {
  const out = []
  const link = (href, label) => ({ type: 'link', href, content: [textNode(label)] })
  const host = new URL(clip.url).hostname.replace(/^www\./, '')
  out.push(block('paragraph', baseProps(), [textNode(L(locale, 'Fonte: ', 'Source: '), { bold: true }), link(clip.url, clip.site || host)]))
  if (clip.image) out.push(block('paragraph', baseProps(), [textNode(L(locale, 'Imagem destaque: ', 'Featured image: '), { bold: true }), link(clip.image, L(locale, 'abrir imagem', 'open image'))]))
  if (clip.selection.trim()) {
    out.push(block('heading', { ...baseProps(), level: 2 }, [textNode(L(locale, 'Seleção', 'Selection'))]))
    for (const part of clip.selection.split(/\n{2,}/)) if (part.trim()) out.push(block('quote', baseProps(), inlineNodes(part.replace(/\n/g, ' ').trim())))
  }
  const body = clip.markdown.trim() ? clip.markdown : clip.text
  if (body.trim()) {
    if (clip.selection.trim()) out.push(block('heading', { ...baseProps(), level: 2 }, [textNode(L(locale, 'Conteúdo', 'Content'))]))
    const converted = clip.markdown.trim() ? markdownToBlocks(body, { limit: LIMITS.blocks - out.length - 1 }) : { blocks: body.split(/\n{2,}/).filter(part => part.trim()).slice(0, LIMITS.blocks - out.length - 1).map(part => block('paragraph', baseProps(), [textNode(part.replace(/\n/g, ' ').trim())])), truncated: false }
    out.push(...converted.blocks)
    if (converted.truncated) out.push(block('paragraph', baseProps(), [textNode(L(locale, '[Conteúdo truncado]', '[Content truncated]'), { italic: true })]))
  }
  return out
}

// ---------- banco "Recortes da web" ----------
const clipFolderName = locale => FOLDER_NAMES[locale === 'en-US' ? 'en-US' : 'pt-BR']
/** Esquema do banco: Nome, URL, Data (dia do recorte), Criado em; tabela por data decrescente. */
function clipDatabaseSchema(locale = 'pt-BR', uid = randomUUID) {
  const name = { id: uid(), name: L(locale, 'Nome', 'Name'), type: 'title' }
  const url = { id: uid(), name: 'URL', type: 'url' }
  const date = { id: uid(), name: L(locale, 'Data', 'Date'), type: 'date' }
  const created = { id: uid(), name: L(locale, 'Criado em', 'Created'), type: 'createdTime' }
  const table = { id: uid(), name: L(locale, 'Tabela', 'Table'), type: 'table', filters: [], sorts: [{ propertyId: date.id, direction: 'desc' }], hidden: [], widths: {} }
  return { properties: [name, url, date, created], views: [table], activeViewId: table.id }
}
/** Acha o banco existente (qualquer idioma) na raiz; devolve { page, urlId, dateId } ou null. */
function findClipDatabase(pages, isLive) {
  for (const page of Object.values(pages)) {
    if (!page?.database || page.parentId || !CLIP_FOLDER_NAMES.includes(page.title) || !isLive(page.id)) continue
    const url = page.database.properties.find(property => property.type === 'url'), date = page.database.properties.find(property => property.type === 'date')
    if (url && date) return { page, urlId: url.id, dateId: date.id }
  }
  return null
}
const localDay = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/** Janela deslizante por chave (cliente): `limit` chamadas por `windowMs`. Devolve segundos de espera ou 0. */
function createRateLimiter({ limit = 30, windowMs = 60_000, now = () => Date.now() } = {}) {
  const hits = new Map()
  return key => {
    const t = now(), recent = (hits.get(key) ?? []).filter(at => t - at < windowMs)
    if (recent.length >= limit) { hits.set(key, recent); return Math.max(1, Math.ceil((windowMs - (t - recent[0])) / 1000)) }
    recent.push(t); hits.set(key, recent)
    if (hits.size > 200) for (const [k, v] of hits) if (!v.some(at => t - at < windowMs)) hits.delete(k)
    return 0
  }
}

module.exports = { LIMITS, CLIP_FOLDER_NAMES, parseClip, markdownToBlocks, inlineNodes, clipBlocks, blocksText, clipFolderName, clipDatabaseSchema, findClipDatabase, localDay, extensionIdFromOrigin, createRateLimiter }
