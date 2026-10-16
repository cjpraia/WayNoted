import PRODUCT from '../../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../../shared/compatibility.ts'
// Limpeza do HTML colado de outros apps (ChatGPT/Claude web, Google Docs, Word, Export Bundle,
// Excel/Planilhas) antes do parser do BlockNote. Sanitiza (sem scripts, handlers ou URLs
// perigosas) e normaliza marcações que o parser não entende. Usa DOMParser (navegador/jsdom).

const DROP = 'script,style,meta,link,title,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,noscript,template,svg,canvas,video,audio,source,track,base,head,o\\:p,xml'
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'PRE', 'BLOCKQUOTE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'IMG'])
const SAFE_LINK = new RegExp(`^(https?:|mailto:|tel:|#|(?:${[PRODUCT.protocol, COMPAT.previousProtocol, ...PRODUCT.protocolAliases].join("|")}):)`, "i")
const SAFE_IMAGE = /^(https?:|data:image\/(png|jpe?g|gif|webp|avif|bmp);|file:\/\/)/i

export const EQ_INLINE = ''
export const EQ_BLOCK = ''

function unwrap(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

function rename(element: Element, tag: string): Element {
  const next = element.ownerDocument.createElement(tag)
  while (element.firstChild) next.appendChild(element.firstChild)
  for (const name of ['href', 'src', 'alt', 'class', 'data-language', 'colspan', 'rowspan', 'start', 'checked']) {
    const value = element.getAttribute(name)
    if (value !== null) next.setAttribute(name, value)
  }
  element.replaceWith(next)
  return next
}

function styleOf(element: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (element.getAttribute('style') ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at > 0) out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim().toLowerCase()
  }
  return out
}

function languageOf(pre: Element): string {
  const candidates = [pre, ...Array.from(pre.querySelectorAll('code,[class*="language-"],[data-language]'))]
  for (const node of candidates) {
    const data = node.getAttribute('data-language')
    if (data) return data
    const match = /(?:^|\s)(?:language|lang)-([\w#+.-]+)/.exec(node.getAttribute('class') ?? '')
    if (match) return match[1]
  }
  // ChatGPT/Claude web: cabeçalho com o nome da linguagem antes do <code>.
  const code = pre.querySelector('code')
  const header = code ? Array.from(pre.querySelectorAll('div,span')).find((node) => !node.contains(code) && /^[a-z+#]{1,15}$/i.test(node.textContent?.trim() ?? '')) : null
  return header?.textContent?.trim().toLowerCase() ?? ''
}

function texOf(element: Element): string | null {
  const annotation = element.querySelector('annotation[encoding="application/x-tex"]')
  return annotation?.textContent?.trim() || element.getAttribute('data-latex') || element.getAttribute('data-math') || null
}

/** Listas do Word (parágrafos MsoListParagraph com mso-list: lN levelM) → <ul>/<ol> aninhadas. */
function wordLists(body: HTMLElement) {
  const doc = body.ownerDocument
  const paragraphs = Array.from(body.querySelectorAll('p')).filter((p) => /mso-list:\s*l\d+\s+level\d+/i.test(p.getAttribute('style') ?? ''))
  let stack: { level: number; list: Element }[] = []
  let previous: Element | null = null
  for (const p of paragraphs) {
    const level = Number(/level(\d+)/i.exec(p.getAttribute('style') ?? '')![1])
    const marker = p.querySelector('[style*="mso-list:Ignore"],[style*="mso-list: Ignore"]')?.textContent?.replace(/ /g, ' ').trim() ?? ''
    p.querySelectorAll('[style*="mso-list:Ignore"],[style*="mso-list: Ignore"]').forEach((node) => node.remove())
    const ordered = /^[\da-z]{1,4}[.)]$/i.test(marker)
    const contiguous = previous && p.previousElementSibling === previous
    if (!contiguous) stack = []
    while (stack.length && stack[stack.length - 1].level > level) stack.pop()
    let top = stack[stack.length - 1]
    if (!top || top.level < level) {
      const list = doc.createElement(ordered ? 'ol' : 'ul')
      if (top) { const host = top.list.lastElementChild ?? top.list.appendChild(doc.createElement('li')); host.appendChild(list) }
      else p.before(list)
      top = { level, list }; stack.push(top)
    }
    const item = doc.createElement('li')
    while (p.firstChild) item.appendChild(p.firstChild)
    top.list.appendChild(item)
    previous = p
    const placeholder = doc.createElement('span'); placeholder.setAttribute('data-np-word-list', '')
    p.replaceWith(placeholder)
    previous = placeholder
  }
  body.querySelectorAll('[data-np-word-list]').forEach((node) => node.remove())
}

/** Google Docs aninha níveis como <ul> irmãos com aria-level; move-os para dentro do item anterior. */
function ariaLevels(body: HTMLElement) {
  for (const list of Array.from(body.querySelectorAll('ul,ol'))) {
    const parent = list.parentElement
    if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL')) {
      const host = list.previousElementSibling
      if (host?.tagName === 'LI') host.appendChild(list)
    }
  }
}

/** Sanitiza e normaliza HTML colado. Retorna o HTML limpo do <body>. */
export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  // Comentários (inclui condicionais do Word).
  const walker = doc.createTreeWalker(body, 128 /* SHOW_COMMENT */)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((node) => node.parentNode?.removeChild(node))

  // KaTeX/MathJax (ChatGPT, Claude web) → marcadores de equação antes de remover o MathML.
  for (const math of Array.from(body.querySelectorAll('.katex-display,.katex,mjx-container,math'))) {
    if (!math.isConnected) continue
    const tex = texOf(math)
    if (!tex) continue
    const block = math.classList.contains('katex-display') || math.getAttribute('display') === 'true' || math.getAttribute('display') === 'block'
    const marker = doc.createElement(block ? 'p' : 'span')
    marker.textContent = block ? `${EQ_BLOCK}${tex}${EQ_BLOCK}` : `${EQ_INLINE}${tex}${EQ_INLINE}`
    math.replaceWith(marker)
  }

  body.querySelectorAll(DROP).forEach((node) => node.remove())
  // Botões "Copiar código" de interfaces de chat que não são <button>.
  body.querySelectorAll('[aria-hidden="true"],[hidden],[role="button"]').forEach((node) => { if (!node.closest('pre code')) node.remove() })

  wordLists(body)
  ariaLevels(body)

  // Blocos de código: um único <pre><code class="language-x"> com o texto puro.
  for (const pre of Array.from(body.querySelectorAll('pre'))) {
    if (pre.parentElement?.closest('pre')) continue
    const language = languageOf(pre)
    const code = pre.querySelector('code') ?? pre
    let text = ''
    const collect = (node: Node) => {
      if (node.nodeType === 3) { text += node.nodeValue ?? ''; return }
      const element = node as Element
      if (element.tagName === 'BR') { text += '\n'; return }
      node.childNodes.forEach(collect)
      if (code !== pre && element !== code && /^(DIV|P)$/.test(element.tagName) && !text.endsWith('\n')) text += '\n'
    }
    collect(code)
    const next = doc.createElement('pre')
    const inner = doc.createElement('code')
    if (language) { inner.className = `language-${language.toLowerCase()}`; inner.setAttribute('data-language', language.toLowerCase()) }
    inner.textContent = text.replace(/ /g, ' ').replace(/\n$/, '')
    next.appendChild(inner)
    pre.replaceWith(next)
  }

  for (const element of Array.from(body.querySelectorAll('*'))) {
    if (!element.isConnected) continue
    // Atributos: só os úteis; nada de on*, style vira marcação semântica.
    const style = styleOf(element)
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || !['href', 'src', 'alt', 'class', 'data-language', 'colspan', 'rowspan', 'start', 'checked', 'type', 'open', 'data-checked'].includes(name)) element.removeAttribute(attr.name)
    }
    const tag = element.tagName
    if (tag === 'A') {
      const href = element.getAttribute('href')?.trim() ?? ''
      if (!SAFE_LINK.test(href)) element.removeAttribute('href')
      continue
    }
    if (tag === 'IMG') {
      const src = element.getAttribute('src')?.trim() ?? ''
      if (!SAFE_IMAGE.test(src)) element.remove()
      continue
    }
    if (tag !== 'PRE' && tag !== 'CODE' && element.getAttribute('class')) {
      const cls = element.getAttribute('class')!
      // Mantém só classes de linguagem de código; o resto é ruído de app.
      if (!/language-/.test(cls)) element.removeAttribute('class')
    }
    // Google Docs embrulha tudo num <b style="font-weight:normal" id="docs-internal-guid…">.
    if ((tag === 'B' || tag === 'STRONG') && /^(normal|[1-4]00)$/.test(style['font-weight'] ?? '')) { unwrap(element); continue }
    if (tag === 'SPAN' || tag === 'FONT') {
      let node: Element = element
      const wrap = (name: string) => { const outer = doc.createElement(name); node.replaceWith(outer); outer.appendChild(node); }
      const weight = style['font-weight'] ?? ''
      if (/^(bold|bolder|[6-9]00)$/.test(weight)) wrap('strong')
      if (style['font-style'] === 'italic') wrap('em')
      const decoration = `${style['text-decoration'] ?? ''} ${style['text-decoration-line'] ?? ''}`
      if (decoration.includes('line-through')) wrap('s')
      if (decoration.includes('underline')) wrap('u')
      if (/monospace|courier|consolas|menlo|monaco/.test(style['font-family'] ?? '') && !element.closest('pre')) wrap('code')
      unwrap(node)
      continue
    }
    if (tag === 'MARK') continue
    if (/^(SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV|FIGURE|CENTER|DL)$/.test(tag)) { unwrap(element); continue }
    if (tag === 'FIGCAPTION' || tag === 'DT' || tag === 'DD') { rename(element, 'p'); continue }
    if (tag === 'TH' || tag === 'TD') {
      // Células com <p>/<div> internos viram texto com quebras.
      for (const inner of Array.from(element.querySelectorAll('p,div'))) { if (inner.nextSibling) inner.after(doc.createElement('br')); unwrap(inner) }
    }
  }

  // <div> aninhados: folhas com conteúdo inline viram <p>; os demais são desembrulhados.
  for (const div of Array.from(body.querySelectorAll('div')).reverse()) {
    if (!div.isConnected) continue
    const hasBlock = Array.from(div.children).some((child) => BLOCK_TAGS.has(child.tagName))
    if (hasBlock || !div.textContent?.trim() && !div.querySelector('img,br')) unwrap(div)
    else if (div.parentElement?.closest('li,td,th,blockquote')) unwrap(div)
    else rename(div, 'p')
  }

  // Espaços não separáveis e de largura zero no texto (fora de <pre>).
  const texts = doc.createTreeWalker(body, 4 /* SHOW_TEXT */)
  while (texts.nextNode()) {
    const node = texts.currentNode
    if (node.parentElement?.closest('pre')) continue
    node.nodeValue = (node.nodeValue ?? '').replace(/ /g, ' ').replace(/[​‌‍﻿]/g, '')
  }
  return body.innerHTML.trim()
}

/** O HTML tem estrutura ou formatação que valha mais que o texto simples? */
export function htmlHasRichContent(html: string): boolean {
  if (!html || !/<[a-z]/i.test(html)) return false
  const body = new DOMParser().parseFromString(html, 'text/html').body
  if (body.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,img,hr,strong,b:not([style*="font-weight:normal"]):not([style*="font-weight: normal"]),em,i,u,s,del,strike,mark,code,a[href],sup,sub,details,.katex,math')) return true
  return Array.from(body.querySelectorAll('[style]')).some((node) => /font-weight:\s*(bold|[6-9]00)|font-style:\s*italic|line-through|underline/i.test(node.getAttribute('style') ?? ''))
}
