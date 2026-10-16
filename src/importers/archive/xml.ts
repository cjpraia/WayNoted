// Leitor XML mínimo e seguro para ENEX/ENML. Não resolve DOCTYPE, entidades externas nem entidades
// declaradas (XXE e "billion laughs" não se aplicam): só as cinco predefinidas, numéricas e algumas HTML.
// Estrito: tags mal formadas lançam XmlError. Limites de profundidade e de nós.
export interface XNode { name: string; attrs: Record<string, string>; children: (XNode | string)[] }
export class XmlError extends Error { constructor(message: string) { super(message); this.name = 'XmlError' } }
export interface XmlLimits { maxDepth: number; maxNodes: number }
export const XML_LIMITS: XmlLimits = { maxDepth: 200, maxNodes: 2_000_000 }

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', euro: '€', deg: '°' }

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
    }
    // Entidades não conhecidas (inclusive as declaradas num DOCTYPE) ficam literais: nada é expandido.
    return NAMED[body.toLowerCase()] ?? whole
  })
}

const NAME = /[^\s=\/>"']+/y
const ATTR = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y

/** Procura o fim de uma tag de abertura respeitando aspas. */
function tagEnd(src: string, from: number): number {
  let quote = ''
  for (let i = from; i < src.length; i++) {
    const char = src[i]
    if (quote) { if (char === quote) quote = '' } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return i
  }
  return -1
}

export function parseXml(src: string, limits: XmlLimits = XML_LIMITS): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] }
  const stack: XNode[] = [root]
  let nodes = 0
  let i = 0
  const push = (text: string) => { if (text) stack[stack.length - 1].children.push(text) }
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { push(decodeEntities(src.slice(i))); break }
    if (lt > i) push(decodeEntities(src.slice(i, lt)))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      if (end < 0) throw new XmlError('Comentário não terminado.')
      i = end + 3; continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      if (end < 0) throw new XmlError('CDATA não terminado.')
      push(src.slice(lt + 9, end)); i = end + 3; continue
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2)
      if (end < 0) throw new XmlError('Instrução não terminada.')
      i = end + 2; continue
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE (com subconjunto interno [...]): descartado por inteiro, nunca interpretado.
      let depth = 0, quote = '', j = lt + 2
      for (; j < src.length; j++) {
        const char = src[j]
        if (quote) { if (char === quote) quote = ''; continue }
        if (char === '"' || char === "'") quote = char
        else if (char === '[') depth++
        else if (char === ']') depth = Math.max(0, depth - 1)
        else if (char === '>' && depth === 0) break
      }
      if (j >= src.length) throw new XmlError('Declaração não terminada.')
      i = j + 1; continue
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt + 2)
      if (end < 0) throw new XmlError('Tag de fechamento não terminada.')
      const name = src.slice(lt + 2, end).trim().toLowerCase()
      const top = stack[stack.length - 1]
      if (stack.length < 2 || top.name !== name) throw new XmlError(`Tag </${name}> inesperada.`)
      stack.pop(); i = end + 1; continue
    }
    const end = tagEnd(src, lt + 1)
    if (end < 0) throw new XmlError('Tag não terminada.')
    let body = src.slice(lt + 1, end)
    const selfClosing = body.endsWith('/')
    if (selfClosing) body = body.slice(0, -1)
    NAME.lastIndex = 0
    const match = NAME.exec(body)
    if (!match) throw new XmlError('Tag sem nome.')
    const node: XNode = { name: match[0].toLowerCase(), attrs: {}, children: [] }
    ATTR.lastIndex = NAME.lastIndex
    for (let guard = 0; ATTR.lastIndex < body.length && guard < 200; guard++) {
      while (ATTR.lastIndex < body.length && /\s/.test(body[ATTR.lastIndex])) ATTR.lastIndex++
      if (ATTR.lastIndex >= body.length) break
      const attr = ATTR.exec(body)
      if (!attr) break
      node.attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '')
    }
    if (++nodes > limits.maxNodes) throw new XmlError('Documento com nós demais.')
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) {
      if (stack.length > limits.maxDepth) throw new XmlError('Documento aninhado demais.')
      stack.push(node)
    }
    i = end + 1
  }
  if (stack.length > 1) throw new XmlError(`Tag <${stack[stack.length - 1].name}> não foi fechada.`)
  return root
}

export function textOf(node: XNode | string): string {
  if (typeof node === 'string') return node
  let out = ''
  for (const child of node.children) out += textOf(child)
  return out
}
export function child(node: XNode, name: string): XNode | undefined {
  for (const item of node.children) if (typeof item !== 'string' && item.name === name) return item
  return undefined
}
export function childrenNamed(node: XNode, name: string): XNode[] {
  return node.children.filter((item): item is XNode => typeof item !== 'string' && item.name === name)
}
