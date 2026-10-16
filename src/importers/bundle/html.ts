import COMPAT from '../../../shared/compatibility.ts'
// HTML exportado pelo Export Bundle → blocos BlockNote. Recebe um Document (DOMParser do navegador ou jsdom nos testes).
import { block, codeLanguage, mediaBlock, mergeInline, pageBlock, pageHref, paragraph, text, type Block, type ConvertContext, type InlineNode, type Styles, type TextNode } from './blocks.ts'
import { isExternalHref, newId } from './util.ts'
import { normalizeHint, type CellSample, type BundleHint } from './properties.ts'

const ELEMENT = 1, TEXT = 3
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'FIGURE', 'PRE', 'HR', 'TABLE', 'DIV', 'DETAILS', 'ASIDE', 'NAV', 'SECTION', 'ARTICLE', 'HEADER', 'IMG'])
const COLOR = /(?:^|\s)(?:highlight|block-color)-(gray|brown|orange|yellow|green|blue|purple|pink|red|teal)(_background)?(?:\s|$)/

function colorStyles(element: Element): Styles {
  const match = COLOR.exec(element.getAttribute('class') ?? '')
  if (!match) return {}
  const color = match[1] === 'teal' ? 'green' : match[1]
  return match[2] ? { backgroundColor: color } : { textColor: color }
}

function latexOf(element: Element): string {
  const annotation = element.querySelector('annotation[encoding="application/x-tex"]')
  return (annotation?.textContent ?? element.textContent ?? '').trim()
}

export interface HtmlPage {
  title: string
  icon: string | null
  cover: string | null
  coverPosition: number
  /** Propriedades de linha (tabela `.properties`). */
  properties: { name: string; sample: Omit<CellSample, 'fromFile'> }[]
  body: Element | null
  /** Tabela de banco (`table.collection-content`) quando a página é um banco. */
  collection: Element | null
}

export function readHtmlPage(doc: Document, ctx: ConvertContext): HtmlPage {
  const header = doc.querySelector('header')
  const title = (doc.querySelector('.page-title')?.textContent ?? doc.querySelector('title')?.textContent ?? '').trim()
  let icon: string | null = null
  const iconElement = header?.querySelector('.page-header-icon')
  if (iconElement) {
    const image = iconElement.querySelector('img')
    if (image) {
      const src = image.getAttribute('src') ?? ''
      const asset = ctx.resolveAsset(src)
      icon = asset?.mime.startsWith('image/') ? asset.url : /^data:image\//.test(src) ? src : null
    } else icon = (iconElement.textContent ?? '').trim() || null
  }
  let cover: string | null = null, coverPosition = 50
  const coverImage = header?.querySelector('img.page-cover-image') ?? doc.querySelector('img.page-cover-image')
  if (coverImage) {
    const src = coverImage.getAttribute('src') ?? ''
    const asset = ctx.resolveAsset(src)
    if (asset?.mime.startsWith('image/')) cover = asset.url
    else if (/^data:image\//.test(src)) cover = src
    else if (src) ctx.warn('remote-cover', src)
    const position = /object-position:\s*[^;]*?\s(\d+(?:\.\d+)?)%/.exec(coverImage.getAttribute('style') ?? '')
    if (position) coverPosition = Math.max(0, Math.min(100, Number(position[1])))
  }
  const properties: HtmlPage['properties'] = []
  for (const row of header?.querySelectorAll('table.properties tr') ?? doc.querySelectorAll('table.properties tr')) {
    const name = (row.querySelector('th')?.textContent ?? '').trim()
    const cell = row.querySelector('td')
    if (!name || !cell) continue
    const rowHint = [...row.classList].find(name => name.startsWith('property-row-'))
    properties.push({ name, sample: cellSample(cell, normalizeHint(rowHint)) })
  }
  const collection = doc.querySelector('table.collection-content')
  const body = doc.querySelector('.page-body') ?? doc.querySelector('article') ?? doc.body
  return { title, icon, cover, coverPosition, properties, body, collection }
}

/** Valor de uma célula/propriedade HTML do Export Bundle, preservando opções coloridas, links e checkbox. */
export function cellSample(cell: Element, hint?: BundleHint): Omit<CellSample, 'fromFile'> {
  const chips = [...cell.querySelectorAll('.selected-value, .status-value')].map(chip => ({
    name: (chip.textContent ?? '').trim(),
    color: /(?:select|status)-value-color-(\w+)/.exec(chip.getAttribute('class') ?? '')?.[1],
  })).filter(chip => chip.name)
  const checkbox = cell.querySelector('.checkbox')
  const links = [...cell.querySelectorAll('a[href]')].map(anchor => ({ text: (anchor.textContent ?? '').trim(), href: anchor.getAttribute('href') ?? '' }))
  const raw = chips.length ? chips.map(chip => chip.name).join(', ') : (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
  const sample: Omit<CellSample, 'fromFile'> = { raw, hint }
  if (chips.length) sample.chips = chips
  if (checkbox) { sample.checked = checkbox.classList.contains('checkbox-on'); sample.raw = sample.checked ? 'Yes' : 'No' }
  if (links.length && hint !== 'url' && hint !== 'email' && hint !== 'phone') sample.links = links
  return sample
}

/** Cabeçalho de banco HTML: nome da coluna + tipo declarado pelo ícone. */
export function collectionHeaders(table: Element): { name: string; hint?: BundleHint }[] {
  return [...table.querySelectorAll('thead th')].map(th => {
    const svgClass = th.querySelector('svg')?.getAttribute('class') ?? ''
    const hintClass = svgClass.split(/\s+/).find(name => /^types/i.test(name)) ?? th.getAttribute('data-type') ?? ''
    return { name: (th.textContent ?? '').trim(), hint: normalizeHint(hintClass) }
  })
}

// ---------------------------------------------------------------- inline

function inlineFrom(nodes: Iterable<ChildNode>, ctx: ConvertContext, media: Block[], styles: Styles = {}): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.nodeType === TEXT) { out.push(text((node.textContent ?? '').replace(/[ \t\r\n]+/g, ' '), styles)); continue }
    if (node.nodeType !== ELEMENT) continue
    const element = node as Element
    const tag = element.tagName
    if (tag === 'BR') { out.push(text('\n', styles)); continue }
    if (tag === 'IMG') {
      const src = element.getAttribute('src') ?? ''
      if (element.closest('.icon')) continue
      const asset = ctx.resolveAsset(src)
      if (asset) media.push(mediaBlock(asset, element.getAttribute('alt') ?? ''))
      else if (src) ctx.warn(isExternalHref(src) ? 'remote-media' : 'missing-asset', src)
      continue
    }
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG') continue
    const cls = element.getAttribute('class') ?? ''
    if (new RegExp(COMPAT.record079, "").test(cls) || tag === 'MATH') { out.push({ type: 'inlineEquation', props: { id: newId(), latex: latexOf(element) } }); continue }
    const next: Styles = { ...styles, ...colorStyles(element) }
    if (tag === 'STRONG' || tag === 'B') next.bold = true
    if (tag === 'EM' || tag === 'I') next.italic = true
    if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') next.strike = true
    if (tag === 'U' || tag === 'INS' || /(^|\s)underline(\s|$)/.test(cls)) next.underline = true
    if (tag === 'CODE') next.code = true
    if (tag === 'MARK') next.backgroundColor = next.backgroundColor ?? 'yellow'
    if (tag === 'TIME') { out.push(text((element.textContent ?? '').replace(/^@/, ''), next)); continue }
    if (tag === 'A') {
      const href = element.getAttribute('href') ?? ''
      const inner = inlineFrom(element.childNodes, ctx, media, next)
      const flat = inner.flatMap((item): TextNode[] => item.type === 'text' ? [item] : item.type === 'link' ? item.content : [text(item.props.latex, next)])
      const pageId = ctx.resolvePage(href)
      if (pageId) out.push({ type: 'link', href: pageHref(pageId), content: flat })
      else if (/^(https?|mailto|tel|ftp):/i.test(href)) out.push({ type: 'link', href, content: flat })
      else {
        const asset = href && !href.startsWith('#') && !isExternalHref(href) ? ctx.resolveAsset(href) : null
        if (asset) media.push(mediaBlock(asset))
        else if (href && !href.startsWith('#') && !isExternalHref(href)) ctx.warn('broken-link', href)
        out.push(...flat)
      }
      continue
    }
    out.push(...inlineFrom(element.childNodes, ctx, media, next))
  }
  return mergeInline(out)
}

function trimInline(nodes: InlineNode[]): InlineNode[] {
  const first = nodes[0], last = nodes[nodes.length - 1]
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '')
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '')
  return mergeInline(nodes)
}

// ---------------------------------------------------------------- blocos

function isBlockElement(node: ChildNode): boolean {
  return node.nodeType === ELEMENT && BLOCK_TAGS.has((node as Element).tagName)
}

/** Divide os filhos de um item em conteúdo inline (antes do primeiro bloco) e blocos filhos. */
function splitItem(element: Element, ctx: ConvertContext, skip?: (node: Element) => boolean): { content: InlineNode[]; children: Block[] } {
  const inline: ChildNode[] = [], rest: ChildNode[] = []
  for (const node of element.childNodes) {
    if (node.nodeType === ELEMENT && skip?.(node as Element)) continue
    if (!rest.length && !isBlockElement(node)) inline.push(node)
    else if (!rest.length && node.nodeType === ELEMENT && (node as Element).tagName === 'P' && !inline.some(item => (item.textContent ?? '').trim())) inline.push(...(node as Element).childNodes)
    else rest.push(node)
  }
  const media: Block[] = []
  const content = trimInline(inlineFrom(inline, ctx, media))
  return { content, children: [...media, ...convertNodes(rest, ctx)] }
}

function itemBlock(type: string, props: Record<string, unknown>, element: Element, ctx: ConvertContext, skip?: (node: Element) => boolean): Block[] {
  const { content, children } = splitItem(element, ctx, skip)
  return [block(type, props, content, children)]
}

function linkToPage(anchor: Element | null, ctx: ConvertContext): Block[] {
  const href = anchor?.getAttribute('href') ?? ''
  const pageId = ctx.resolvePage(href)
  if (!pageId) {
    if (href) ctx.warn('broken-link', href)
    return anchor ? [paragraph(trimInline([text(anchor.textContent ?? '')]))] : []
  }
  const child = ctx.isChild(pageId)
  if (child) ctx.referenced.add(pageId)
  return [pageBlock(pageId, !child)]
}

export function convertNodes(nodes: Iterable<ChildNode>, ctx: ConvertContext): Block[] {
  const out: Block[] = []
  let loose: ChildNode[] = []
  const flushLoose = () => {
    if (!loose.length) return
    const media: Block[] = []
    const content = trimInline(inlineFrom(loose, ctx, media))
    if (content.length) out.push(paragraph(content))
    out.push(...media)
    loose = []
  }
  for (const node of nodes) {
    if (!isBlockElement(node)) {
      if (node.nodeType === TEXT && !(node.textContent ?? '').trim() && !loose.length) continue
      if (node.nodeType === ELEMENT || node.nodeType === TEXT) loose.push(node)
      continue
    }
    flushLoose()
    out.push(...convertElement(node as Element, ctx))
  }
  flushLoose()
  return out
}

function convertElement(element: Element, ctx: ConvertContext): Block[] {
  const tag = element.tagName
  const cls = element.getAttribute('class') ?? ''
  const color = colorStyles(element)
  const colorProps = color.textColor ? { textColor: color.textColor } : color.backgroundColor ? { backgroundColor: color.backgroundColor } : {}
  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const media: Block[] = []
      return [block('heading', { level: Number(tag[1]), ...colorProps }, trimInline(inlineFrom(element.childNodes, ctx, media))), ...media]
    }
    case 'P': {
      const media: Block[] = []
      const content = trimInline(inlineFrom(element.childNodes, ctx, media))
      if (!content.length && media.length) return media
      // Parágrafo que é só um link para página importada → bloco de página.
      if (content.length === 1 && content[0].type === 'link' && content[0].href.startsWith("workspace://page/")) {
        const pageId = content[0].href.slice("workspace://page/".length)
        const child = ctx.isChild(pageId)
        if (child) ctx.referenced.add(pageId)
        return [pageBlock(pageId, !child), ...media]
      }
      return [block('paragraph', colorProps, content), ...media]
    }
    case 'HR': return [block('divider', {})]
    case 'BLOCKQUOTE': return itemBlock('quote', colorProps, element, ctx)
    case 'PRE': {
      const code = element.querySelector('code') ?? element
      const language = /language-([\w+#-]+)/i.exec(code.getAttribute('class') ?? '')?.[1] ?? ''
      if (/^mermaid$/i.test(language)) return [block('mermaid', { source: code.textContent ?? '' })]
      return [block('codeBlock', { language: codeLanguage(language.replace(/_/g, ' ')) }, [text(code.textContent ?? '')])]
    }
    case 'UL': case 'OL': {
      const out: Block[] = []
      const toggle = /\btoggle\b/.test(cls), todo = /to-do-list/.test(cls)
      for (const li of element.children) {
        if (li.tagName !== 'LI') { out.push(...convertElement(li, ctx)); continue }
        const details = toggle || li.firstElementChild?.tagName === 'DETAILS' ? li.querySelector(':scope > details') : null
        if (details) { out.push(...convertDetails(details, ctx)); continue }
        if (todo) {
          const checked = !!li.querySelector(':scope > .checkbox-on, :scope > div.checkbox-on')
          const label = li.querySelector(':scope > span') ?? li
          const media: Block[] = []
          const content = trimInline(inlineFrom(label === li ? [...li.childNodes].filter(node => !(node.nodeType === ELEMENT && ((node as Element).classList.contains('checkbox') || isBlockElement(node)))) : label.childNodes, ctx, media))
          const nested = [...li.childNodes].filter(node => node !== label && isBlockElement(node) && !(node as Element).classList.contains('checkbox'))
          out.push(block('checkListItem', { checked }, content, [...media, ...convertNodes(nested, ctx)]))
          continue
        }
        out.push(...itemBlock(tag === 'OL' ? 'numberedListItem' : 'bulletListItem', {}, li, ctx))
      }
      if (tag === 'OL') {
        const start = Number(element.getAttribute('start') ?? '1')
        if (start > 1 && out[0]?.type === 'numberedListItem') out[0].props = { ...out[0].props, start }
      }
      return out
    }
    case 'DETAILS': return convertDetails(element, ctx)
    case 'TABLE': {
      if (/collection-content|properties/.test(cls)) return []
      const rows = [...element.querySelectorAll('tr')]
      if (!rows.length) return []
      const media: Block[] = []
      const cells = rows.map(row => [...row.children].filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH').map(cell => trimInline(inlineFrom(cell.childNodes, ctx, media))))
      const width = Math.max(...cells.map(row => row.length))
      const headerRows = rows[0].closest('thead') || [...rows[0].children].every(cell => cell.tagName === 'TH') ? 1 : 0
      return [block('table', {}, { type: 'tableContent', ...(headerRows ? { headerRows } : {}), rows: cells.map(row => ({ cells: Array.from({ length: width }, (_, index) => row[index] ?? []) })) }), ...media]
    }
    case 'IMG': {
      const media: Block[] = []
      inlineFrom([element], ctx, media)
      return media
    }
    case 'FIGURE': return convertFigure(element, ctx)
    case 'ASIDE': return [calloutBlock(element, null, ctx)]
    case 'NAV': return /table_of_contents/.test(cls) ? [block('tableOfContents', {})] : convertNodes(element.childNodes, ctx)
    case 'DIV': {
      if (/\bcolumn-list\b/.test(cls)) {
        const columns = [...element.children].filter(child => /\bcolumn\b/.test(child.getAttribute('class') ?? ''))
        if (columns.length >= 2) return [block('columnList', {}, undefined, columns.map(column => block('column', { width: 1 }, undefined, convertNodes(column.childNodes, ctx))))]
      }
      return convertNodes(element.childNodes, ctx)
    }
    default: return convertNodes(element.childNodes, ctx)
  }
}

function convertDetails(details: Element, ctx: ConvertContext): Block[] {
  const summary = details.querySelector(':scope > summary')
  const heading = summary?.querySelector('h1, h2, h3')
  const media: Block[] = []
  const content = trimInline(inlineFrom((heading ?? summary)?.childNodes ?? [], ctx, media))
  const rest = [...details.childNodes].filter(node => node !== summary)
  const children = [...media, ...convertNodes(rest, ctx)]
  if (heading) return [block('heading', { level: Number(heading.tagName[1]), isToggleable: true }, content, children)]
  return [block('toggleListItem', {}, content, children)]
}

function calloutBlock(container: Element, iconElement: Element | null, ctx: ConvertContext): Block {
  let icon = '💡'
  const iconNode = iconElement ?? container.querySelector('.icon')
  if (iconNode) {
    const image = iconNode.tagName === 'IMG' ? iconNode : iconNode.querySelector('img')
    if (image) { const asset = ctx.resolveAsset(image.getAttribute('src') ?? ''); if (asset?.mime.startsWith('image/')) icon = asset.url }
    else if ((iconNode.textContent ?? '').trim()) icon = (iconNode.textContent ?? '').trim()
  }
  // No Export Bundle o texto fica no último <div>; o ícone no primeiro.
  const divs = [...container.children].filter(child => child.tagName === 'DIV')
  const bodyElement = divs.length >= 2 ? divs[divs.length - 1] : container
  const skip = (node: Element) => node === iconNode || (!!iconNode && node.contains(iconNode))
  const { content, children } = splitItem(bodyElement, ctx, skip)
  return block('callout', { icon }, content, children)
}

function convertFigure(figure: Element, ctx: ConvertContext): Block[] {
  const cls = figure.getAttribute('class') ?? ''
  const caption = (figure.querySelector('figcaption')?.textContent ?? '').trim()
  if (/\bcallout\b/.test(cls)) return [calloutBlock(figure, null, ctx)]
  if (/\bequation\b/.test(cls)) return [block('equation', { latex: latexOf(figure) })]
  if (/link-to-page/.test(cls)) return linkToPage(figure.querySelector('a'), ctx)
  if (/\bbookmark\b|link-preview/.test(cls)) {
    const anchor = figure.querySelector('a')
    const href = anchor?.getAttribute('href') ?? ''
    const title = (figure.querySelector('.bookmark-title')?.textContent ?? anchor?.textContent ?? href).trim()
    return /^https?:/i.test(href) ? [paragraph([{ type: 'link', href, content: [text(title || href)] }])] : []
  }
  const image = figure.querySelector('img')
  if (image && !/\bcallout\b/.test(cls)) {
    const src = image.getAttribute('src') ?? image.parentElement?.getAttribute('href') ?? ''
    const asset = ctx.resolveAsset(src)
    if (asset) return [mediaBlock(asset, caption)]
    ctx.warn(isExternalHref(src) ? 'remote-media' : 'missing-asset', src)
    return isExternalHref(src) && /^https?:/i.test(src) ? [paragraph([{ type: 'link', href: src, content: [text(caption || src)] }])] : []
  }
  const source = figure.querySelector('.source a, a')
  if (source) {
    const href = source.getAttribute('href') ?? ''
    const asset = isExternalHref(href) ? null : ctx.resolveAsset(href)
    if (asset) return [mediaBlock(asset, caption)]
    if (/^https?:/i.test(href)) return [paragraph([{ type: 'link', href, content: [text((source.textContent ?? '').trim() || href)] }])]
  }
  return convertNodes(figure.childNodes, ctx)
}
