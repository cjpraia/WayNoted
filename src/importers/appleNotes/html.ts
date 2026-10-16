// D3b — HTML do Notas da Apple → blocos. O HTML do Notas não é XML (<br>, <img> sem fechamento, atributos soltos):
// um leitor tolerante monta a árvore e os blocos saem do MESMO conversor do ENEX Archive (convertBlocks, enml.ts).
// Imagens `data:` viram anexos; qualquer outra mídia vira aviso. Nada é interpretado como HTML ativo.
import { decodeEntities, type XNode } from '../archive/xml.ts'
import { convertBlocks, plainFromBrokenEnml } from '../archive/enml.ts'
import { text, paragraph, type AssetRef, type Block } from '../bundle/blocks.ts'

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'embed', 'source', 'track'])
const RAW = new Set(['script', 'style'])
const AUTO_CLOSE: Record<string, string[]> = { li: ['li'], p: ['p'], td: ['td', 'th'], th: ['td', 'th'], tr: ['tr', 'td', 'th'], dt: ['dt', 'dd'], dd: ['dt', 'dd'] }
export const HTML_LIMITS = { depth: 120, nodes: 400_000, imageBytes: 25 * 1024 * 1024 }

const ATTR = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g

/** HTML tolerante → árvore. Nomes em minúsculas, atributos decodificados; <script>/<style> e comentários descartados. */
export function parseHtml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] }
  const stack: XNode[] = [root]
  let nodes = 0, i = 0
  const top = () => stack[stack.length - 1]
  const push = (value: string) => { if (value) top().children.push(decodeEntities(value)) }
  while (i < src.length && nodes < HTML_LIMITS.nodes) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { push(src.slice(i)); break }
    if (lt > i) push(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt + 4); i = end < 0 ? src.length : end + 3; continue }
    if (/^<[!?]/.test(src.slice(lt, lt + 2))) { const end = src.indexOf('>', lt); i = end < 0 ? src.length : end + 1; continue }
    const close = /^<\/\s*([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(lt, lt + 80))
    if (close) {
      const name = close[1].toLowerCase()
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break }
      i = lt + close[0].length; continue
    }
    const open = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 80))
    if (!open) { push('<'); i = lt + 1; continue }
    // fim da tag respeitando aspas
    let end = -1, quote = ''
    for (let k = lt + open[0].length; k < src.length; k++) {
      const char = src[k]
      if (quote) { if (char === quote) quote = '' } else if (char === '"' || char === "'") quote = char
      else if (char === '>') { end = k; break }
    }
    if (end < 0) break
    const name = open[1].toLowerCase()
    const attrs: Record<string, string> = {}
    const body = src.slice(lt + open[0].length, end).replace(/\/\s*$/, '')
    for (const match of body.matchAll(ATTR)) attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
    i = end + 1
    if (RAW.has(name)) { const stop = src.toLowerCase().indexOf('</' + name, i); i = stop < 0 ? src.length : (src.indexOf('>', stop) + 1 || src.length); continue }
    const closes = AUTO_CLOSE[name]
    if (closes) for (let k = stack.length - 1; k > 0; k--) {
      if (closes.includes(stack[k].name)) { stack.length = k; break }
      if (/^(ul|ol|table|div|blockquote)$/.test(stack[k].name)) break
    }
    const node: XNode = { name, attrs, children: [] }
    nodes++
    top().children.push(node)
    if (!VOID.has(name) && stack.length < HTML_LIMITS.depth) stack.push(node)
  }
  return root
}

const DATA_IMAGE = /^data:(image\/(?:png|jpe?g|gif|webp|heic|tiff|bmp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/tiff': 'tiff', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }
const CHECKLIST = /(check|todo|task)/i
const DONE = /(^|[\s_-])(checked|done|complete|completed)([\s_-]|$)/i

export interface AppleHtmlResult { blocks: Block[]; images: number }
export interface AppleHtmlOptions {
  title?: string
  warn(code: string, detail?: string): void
  imageName(index: number, ext: string): string
}

/** Passo único sobre a árvore: <object> some (filhos sobem), <img data:> vira <en-media>, listas de tarefas ganham <en-todo>. */
function rewrite(nodes: (XNode | string)[], assets: Map<string, AssetRef>, options: AppleHtmlOptions, checklist = false): (XNode | string)[] {
  const out: (XNode | string)[] = []
  for (const node of nodes) {
    if (typeof node === 'string') { out.push(node); continue }
    if (node.name === 'object' || node.name === 'span' && !Object.keys(node.attrs).length) { out.push(...rewrite(node.children, assets, options, checklist)); continue }
    if (node.name === 'img') {
      const src = (node.attrs.src ?? '').trim(), match = DATA_IMAGE.exec(src)
      if (match && src.length * 0.75 <= HTML_LIMITS.imageBytes) {
        const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg'), data = match[2].replace(/\s+/g, '')
        const hash = `apple-${assets.size + 1}`
        assets.set(hash, { url: `data:${mime};base64,${data}`, name: options.imageName(assets.size + 1, EXT[mime] ?? 'img'), mime, size: Math.floor(data.length * 0.75) })
        out.push({ name: 'en-media', attrs: { hash, type: mime }, children: [] })
      } else options.warn(src.length > HTML_LIMITS.imageBytes ? 'asset-too-large' : 'remote-media', src.startsWith('data:') ? undefined : src.slice(0, 80))
      continue
    }
    if (node.name === 'ul' || node.name === 'ol') {
      const isChecklist = CHECKLIST.test(node.attrs.class ?? '')
      out.push({ ...node, children: rewrite(node.children, assets, options, isChecklist) })
      continue
    }
    if (node.name === 'li' && checklist) {
      const checked = DONE.test(node.attrs.class ?? '') || node.attrs['data-checked'] === 'true' || node.attrs['aria-checked'] === 'true'
      out.push({ ...node, children: [{ name: 'en-todo', attrs: { checked: String(checked) }, children: [] }, ...rewrite(node.children, assets, options)] })
      continue
    }
    out.push({ ...node, children: rewrite(node.children, assets, options, checklist) })
  }
  return out
}

/** Converte o corpo HTML de uma nota. O 1º bloco igual ao título é removido (o Notas repete o título no corpo). */
export function appleHtmlToBlocks(html: string, options: AppleHtmlOptions): AppleHtmlResult {
  const assets = new Map<string, AssetRef>()
  const tree = parseHtml(html)
  const body = (function find(nodes: (XNode | string)[]): XNode | null { for (const n of nodes) if (typeof n !== 'string') { if (n.name === 'body') return n; const inner = find(n.children); if (inner) return inner } return null })(tree.children)
  let blocks: Block[]
  try {
    blocks = convertBlocks(rewrite((body ?? tree).children, assets, options), {
      cryptLabel: '', warn: (code, detail) => options.warn(code, detail),
      media: hash => assets.get(hash) ?? null,
    })
  } catch {
    options.warn('apple-note-failed', options.title)
    blocks = plainFromBrokenEnml(html).split(/\n{2,}/).filter(Boolean).map(chunk => paragraph([text(chunk)]))
  }
  if (options.title && blocks[0] && (blocks[0].type === 'heading' || blocks[0].type === 'paragraph') && Array.isArray(blocks[0].content)) {
    const first = blocks[0].content.map(node => node.type === 'text' ? node.text : node.type === 'link' ? node.content.map(part => part.text).join('') : '').join('').replace(/\s+/g, ' ').trim()
    if (first && first === options.title.replace(/\s+/g, ' ').trim() && blocks[0].children.length === 0) blocks = blocks.slice(1)
  }
  return { blocks, images: assets.size }
}
