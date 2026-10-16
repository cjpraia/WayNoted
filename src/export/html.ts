import COMPAT from '../../shared/compatibility.ts'
// Blocos → HTML autocontido (estilos próprios, sem rede). Equações em MathML nativo via KaTeX.
import katex from 'katex'
import { normalizeInline, inlinePlain } from './inline.ts'
import { object, type RawBlock, type RawInline } from './model.ts'
import type { QueryExport } from '../query/exportResult.ts'
import { canvasToSvg } from '../canvas/svg.ts'
import { iframeHtml, parseVideoUrl } from '../components/page/videoEmbed.ts'
import { LIGHT_PALETTE, type CanvasObject } from '../canvas/model.ts'

export interface HtmlContext {
  href(href: string): string
  media(url: string, name: string): string
  pageLink(pageId: string): { label: string; destination: string }
  synced(id: string): unknown[] | undefined
  /** Resultado atual de um bloco de consulta (src/query/exportResult.ts). */
  queryResult?(props: Record<string, unknown>): QueryExport | null
  /** Só com a opção "incluir players": vídeos online viram <iframe> (contactam o provedor ao abrir o HTML). */
  includePlayers?: boolean
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function math(latex: string, display: boolean): string {
  try { return katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: display }) } catch { return `<code>${esc(latex)}</code>` }
}

const COLOR = /^[a-z]+$/
function colorClasses(props: Record<string, unknown> | undefined): string {
  const out: string[] = []
  if (typeof props?.textColor === 'string' && props.textColor !== 'default' && COLOR.test(props.textColor)) out.push(`c-${props.textColor}`)
  if (typeof props?.backgroundColor === 'string' && props.backgroundColor !== 'default' && COLOR.test(props.backgroundColor)) out.push(`bg-${props.backgroundColor}`)
  if (typeof props?.textAlignment === 'string' && props.textAlignment !== 'left' && COLOR.test(props.textAlignment)) out.push(`al-${props.textAlignment}`)
  return out.join(' ')
}
const cls = (value: string) => (value ? ` class="${value}"` : '')

function safeHref(href: string): string {
  return /^\s*(javascript|vbscript|data:text\/html)/i.test(href) ? '#' : href
}

export function inlineHtml(content: unknown, ctx: HtmlContext): string {
  return normalizeInline(content).map((item: RawInline) => {
    if (item.type === 'link') {
      const href = ctx.href(String(item.href ?? ''))
      const external = /^[a-z]+:/i.test(href) && ! new RegExp(`^(?:workspace|${COMPAT.record007}):`, "i").test(href)
      return `<a href="${esc(safeHref(href))}"${external ? ' rel="noopener noreferrer"' : ''}>${inlineHtml(item.content, ctx) || esc(item.href)}</a>`
    }
    if (item.type === 'inlineEquation') return math(String(item.props?.latex ?? ''), false)
    if (item.type === 'dateMention') return `<time class="mention" datetime="${esc(item.props?.date)}">@${esc(item.props?.date)}</time>`
    if (item.type !== 'text' && item.type !== undefined) return esc(inlinePlain([item]))
    const styles = object(item.styles) ? item.styles : {}
    let out = esc(item.text).replace(/\n/g, '<br>')
    if (styles.code) out = `<code>${out}</code>`
    if (styles.bold) out = `<strong>${out}</strong>`
    if (styles.italic) out = `<em>${out}</em>`
    if (styles.underline) out = `<u>${out}</u>`
    if (styles.strike) out = `<s>${out}</s>`
    const classes = colorClasses(styles as Record<string, unknown>)
    return classes ? `<span class="${classes}">${out}</span>` : out
  }).join('')
}

const LISTS: Record<string, string> = { bulletListItem: 'ul', numberedListItem: 'ol', checkListItem: 'ul' }

function blockHtml(block: RawBlock, ctx: HtmlContext, seen: Set<string>): string {
  const props = block.props ?? {}
  const children = Array.isArray(block.children) ? block.children : []
  const inner = () => inlineHtml(block.content, ctx)
  const nested = children.length ? `<div class="children">${blocksToHtml(children, ctx, seen)}</div>` : ''
  const c = colorClasses(props)
  const str = (key: string) => String(props[key] ?? '')
  switch (block.type) {
    case 'paragraph': case undefined: return `<p${cls(c)}>${inner() || '<br>'}</p>${nested}`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(props.level) || 1)) + 1
      const heading = `<h${level}${cls(c)}>${inner()}</h${level}>`
      return props.isToggleable ? `<details open><summary>${heading}</summary>${nested}</details>` : heading + nested
    }
    case 'quote': return `<blockquote${cls(c)}>${inner()}${nested}</blockquote>`
    case 'toggleListItem': return `<details${cls(c)}><summary>${inner()}</summary>${nested}</details>`
    case 'codeBlock': {
      const language = str('language') && str('language') !== 'text' ? str('language') : ''
      return `<pre${language ? ` data-language="${esc(language)}"` : ''}><code>${esc(inlinePlain(block.content))}</code></pre>${nested}`
    }
    case 'divider': case 'pageBreak': return '<hr>'
    case 'equation': return `<div class="equation">${math(str('latex'), true)}</div>`
    case 'image': {
      const src = str('url') ? ctx.media(str('url'), str('name') || 'imagem') : ''
      const width = Number(props.previewWidth) > 0 ? ` style="width:${Number(props.previewWidth)}px"` : ''
      return `<figure${cls(c)}>${src ? `<img src="${esc(safeHref(src))}" alt="${esc(str('name'))}"${width}>` : ''}${str('caption') ? `<figcaption>${esc(str('caption'))}</figcaption>` : ''}</figure>${nested}`
    }
    case 'video': case 'audio': {
      const src = str('url') ? ctx.media(str('url'), str('name') || block.type) : ''
      return `<figure>${src ? `<${block.type} controls src="${esc(safeHref(src))}"></${block.type}>` : ''}${str('caption') || str('name') ? `<figcaption>${esc(str('caption') || str('name'))}</figcaption>` : ''}</figure>`
    }
    case 'file': case 'pdfPreview': case 'localAttachment': {
      const url = str('url') || str('data')
      const src = url ? ctx.media(url, str('name') || 'arquivo') : ''
      return `<p class="file">📎 ${src ? `<a href="${esc(safeHref(src))}">${esc(str('name') || 'arquivo')}</a>` : esc(str('name'))}</p>`
    }
    case 'callout': return `<div class="callout ${c || 'bg-gray'}"><span class="callout-icon">${esc(str('icon'))}</span><div><p>${inner()}</p>${nested}</div></div>`
    case 'table': {
      const content = object(block.content) ? block.content : {}
      const rows = Array.isArray(content.rows) ? content.rows : []
      const headerRows = Number(content.headerRows ?? 0)
      return `<div class="table-wrap"><table class="simple">${rows.map((row, index) => {
        const cells = object(row) && Array.isArray(row.cells) ? row.cells : []
        const tag = index < headerRows ? 'th' : 'td'
        return `<tr>${cells.map((cell) => {
          const tableCell = object(cell) && cell.type === 'tableCell'
          const cellProps = tableCell && object(cell.props) ? cell.props : {}
          const span = `${Number(cellProps.colspan) > 1 ? ` colspan="${Number(cellProps.colspan)}"` : ''}${Number(cellProps.rowspan) > 1 ? ` rowspan="${Number(cellProps.rowspan)}"` : ''}`
          return `<${tag}${span}${cls(colorClasses(cellProps))}>${inlineHtml(tableCell ? cell.content : cell, ctx)}</${tag}>`
        }).join('')}</tr>`
      }).join('')}</table></div>`
    }
    case 'columnList': return `<div class="columns">${children.map((column) => `<div class="column" style="flex:${Number(column.props?.width) > 0 ? Number(column.props?.width) : 1}">${blocksToHtml(Array.isArray(column.children) ? column.children : [], ctx, seen)}</div>`).join('')}</div>`
    case 'column': return blocksToHtml(children, ctx, seen)
    case 'page': {
      const link = ctx.pageLink(str('pageId'))
      return `<p class="page-link"><a href="${esc(safeHref(link.destination))}">${esc(link.label)}</a></p>`
    }
    // Lousa: SVG estático (cartões viram links para as páginas exportadas).
    case 'canvas': {
      const objects = (Array.isArray(props.objects) ? props.objects : []).map((o) => o && typeof o === 'object' && (o as { type?: string }).type === 'image' ? { ...(o as object), src: ctx.media(String((o as { src?: unknown }).src ?? ''), String((o as { name?: unknown }).name ?? 'imagem')) } : o) as CanvasObject[]
      if (!objects.length) return ''
      const svg = canvasToSvg(objects, { palette: LIGHT_PALETTE, card: (pageId) => ({ title: ctx.pageLink(pageId).label, icon: '', excerpt: '', state: 'ok' }), cardHref: (pageId) => safeHref(ctx.pageLink(pageId).destination) })
      return `<figure class="canvas" style="margin:16px 0;overflow:auto;border:1px solid #e6e5e3;border-radius:10px">${svg.replace(/ width="\d+" height="\d+"/, ' style="width:100%;height:auto"')}</figure>`
    }
    case 'syncedBlock': {
      const id = str('syncedId')
      const blocks = seen.has(id) ? undefined : ctx.synced(id)
      if (!blocks) return '<p class="muted">[Bloco sincronizado indisponível / Synced block unavailable]</p>'
      const next = new Set(seen).add(id)
      return `<div class="synced">${blocksToHtml(blocks as RawBlock[], ctx, next)}</div>`
    }
    case 'onlineVideo': {
      const url = str('url'), video = parseVideoUrl(url)
      const caption = str('caption') ? `<figcaption>${esc(str('caption'))}</figcaption>` : ''
      const link = `<a class="bookmark" href="${esc(safeHref(video?.watchUrl ?? ctx.href(url)))}" rel="noopener noreferrer"><strong>▶ ${esc(str('title') || (video ? `${video.label}` : url))}</strong><small>${esc(url)}</small></a>`
      const data = esc(JSON.stringify({ url, ...(str('title') ? { title: str('title') } : {}), ...(str('caption') ? { caption: str('caption') } : {}) })).replace(/--/g, '&#45;&#45;')
      const player = ctx.includePlayers && video ? `<div class="player">${iframeHtml(video, str('title') || video.label, Number(props.width) > 0 ? Number(props.width) : 640)}</div>` : ''
      return `<figure class="video"><!-- np:embed ${data} -->${player}${player ? '' : link}${player ? `<p>${link}</p>` : ''}${caption}</figure>`
    }
    case 'bookmark': case 'externalReference': {
      const url = str('url')
      return `<a class="bookmark" href="${esc(safeHref(ctx.href(url)))}" rel="noopener noreferrer"><strong>${esc(str('title') || url)}</strong>${str('description') ? `<span>${esc(str('description'))}</span>` : ''}<small>${esc(url)}</small></a>`
    }
    case 'mermaid': return `<pre data-language="mermaid"><code>${esc(str('source'))}</code></pre>`
    case 'htmlSandbox': return `<pre data-language="html"><code>${esc(str('html'))}</code></pre>`
    case 'tabs': {
      let tabs: { title?: string; body?: string }[] = []
      try { const parsed = JSON.parse(str('tabsJson')); if (Array.isArray(parsed)) tabs = parsed } catch { /* inválido */ }
      return tabs.map((tab) => `<details open><summary>${esc(tab.title)}</summary><p>${esc(tab.body).replace(/\n/g, '<br>')}</p></details>`).join('')
    }
    case 'aiBlock': case 'aiMeetingNotes': return `<div class="callout bg-gray"><span class="callout-icon">✦</span><div><p>${esc(str('output') || str('prompt')).replace(/\n/g, '<br>')}</p></div></div>`
    case 'localButton': return `<p><span class="button">${esc(str('label') || 'Botão')}</span></p>`
    case 'tableOfContents': case 'breadcrumb': return ''
    case 'query': {
      const result = ctx.queryResult?.(props)
      const text = result?.text ?? str('text')
      const head = `<!-- np:query ${esc(JSON.stringify(text)).replace(/--/g, '&#45;&#45;')} --><p class="query-text"><code>${esc(text)}</code></p>`
      if (!result) return `<div class="query">${head}</div>`
      const link = (row: QueryExport['rows'][number], label: string) => row.pageId ? `<a href="${esc(ctx.pageLink(row.pageId).destination)}">${esc(label || '—')}</a>` : esc(label)
      if (result.display === 'count') return `<div class="query">${head}<p><strong>${result.total}</strong></p></div>`
      if (result.display !== 'table') return `<div class="query">${head}<ul>${result.rows.map((row) => `<li>${link(row, row.cells[0] ?? '')}${row.cells.slice(1).filter(Boolean).length ? ` — ${esc(row.cells.slice(1).filter(Boolean).join(' · '))}` : ''}</li>`).join('')}</ul></div>`
      return `<div class="query">${head}<table><thead><tr>${result.columns.map((name) => `<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${result.rows.map((row) => `<tr>${row.cells.map((cell, index) => `<td>${index === 0 ? link(row, cell) : esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    }
    default: return block.content ? `<p>${inner()}</p>${nested}` : nested
  }
}

export function blocksToHtml(blocks: RawBlock[], ctx: HtmlContext, seen = new Set<string>()): string {
  let out = ''
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!object(block)) continue
    const list = LISTS[String(block.type)]
    if (!list) { out += blockHtml(block, ctx, seen); continue }
    const type = block.type
    const start = Number(block.props?.start) > 1 ? ` start="${Number(block.props?.start)}"` : ''
    out += `<${list}${type === 'checkListItem' ? ' class="todo"' : ''}${type === 'numberedListItem' ? start : ''}>`
    while (i < blocks.length && blocks[i]?.type === type) {
      const item = blocks[i]
      const children = Array.isArray(item.children) ? item.children : []
      const check = type === 'checkListItem' ? `<input type="checkbox" disabled${item.props?.checked ? ' checked' : ''}> ` : ''
      out += `<li${cls(colorClasses(item.props))}${item.props?.checked ? ' data-checked' : ''}>${check}${inlineHtml(item.content, ctx)}${children.length ? blocksToHtml(children, ctx, seen) : ''}</li>`
      i++
    }
    i--
    out += `</${list}>`
  }
  return out
}

const PALETTE: [string, string, string, string, string][] = [
  // nome, texto claro, fundo claro, texto escuro, fundo escuro
  ['gray', '#787774', '#f1f1ef', '#9b9b9b', '#2f2f2f'], ['brown', '#9f6b53', '#f4eeee', '#ba856f', '#4a3228'],
  ['orange', '#d9730d', '#fbecdd', '#c77d48', '#5c3b23'], ['yellow', '#cb912f', '#fbf3db', '#ca9849', '#56452f'],
  ['green', '#448361', '#edf3ec', '#529e72', '#243d30'], ['blue', '#337ea9', '#e7f3f8', '#5e87c9', '#143a4e'],
  ['purple', '#9065b0', '#f6f3f9', '#9d68d3', '#3c2d49'], ['pink', '#c14c8a', '#f9f0f5', '#d15796', '#4e2c3c'],
  ['red', '#d44c47', '#fdebec', '#df5452', '#522e2a'],
]

export const EXPORT_CSS = `
:root{--bg:#fffdfa;--text:#26231f;--muted:#5f584f;--border:#e7e1d8;--soft:#f6f3ee;--accent:#0f766e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1c1a17;--text:#f2eee8;--muted:#b5ada2;--border:#38332d;--soft:#23201c;--accent:#4fc1b1}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:inherit;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent);text-underline-offset:2px}a:hover{color:var(--accent)}
.shell{display:flex;min-height:100vh}
nav.tree{width:248px;flex:none;border-right:1px solid var(--border);background:var(--soft);padding:16px 8px;font-size:14px;position:sticky;top:0;max-height:100vh;overflow:auto}
nav.tree ul{list-style:none;margin:0;padding-left:12px}nav.tree>ul{padding-left:0}nav.tree li a{display:block;padding:2px 8px;border-radius:6px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav.tree li a:hover{background:var(--border)}nav.tree li a[aria-current]{background:var(--border);font-weight:600}
nav.tree .ws{font-weight:600;padding:4px 8px 10px;display:block;text-decoration:none}
main{flex:1;min-width:0}
.crumbs{font-size:14px;color:var(--muted);padding:12px 24px;display:flex;flex-wrap:wrap;gap:6px}.crumbs a{text-decoration:none}
.cover{height:200px;background-size:cover;background-position:center}
article{max-width:760px;margin:0 auto;padding:32px 24px 96px}
.page-icon{font-size:64px;line-height:1;margin-top:8px}.page-icon img{width:72px;height:72px;object-fit:cover;border-radius:8px}
h1.title{font-size:40px;line-height:1.2;margin:8px 0 16px}
h2{font-size:30px;margin:28px 0 4px}h3{font-size:24px;margin:24px 0 4px}h4{font-size:20px;margin:20px 0 4px}h5,h6,h7{font-size:16px}
p{margin:4px 0}.children{padding-left:24px}
blockquote{margin:8px 0;padding:0 14px;border-left:3px solid currentColor}
pre{background:var(--soft);border-radius:8px;padding:16px;overflow:auto;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;background:var(--soft);color:#eb5757;border-radius:4px;padding:.1em .3em}pre code{background:none;color:inherit;padding:0}
hr{border:0;border-top:1px solid var(--border);margin:16px 0}
ul.todo{list-style:none;padding-left:4px}ul.todo li[data-checked]{text-decoration:line-through;color:var(--muted)}
details>summary{cursor:pointer}details>summary h2,details>summary h3,details>summary h4{display:inline}
.callout{display:flex;gap:10px;padding:16px;border-radius:8px;margin:8px 0}.callout-icon{font-size:20px;line-height:1.3}
figure{margin:12px 0}figure.video .player iframe{max-width:100%;border:0;border-radius:8px}figure img,figure video{max-width:100%;border-radius:4px}figcaption{font-size:14px;color:var(--muted)}
.table-wrap{overflow:auto;margin:8px 0}table{border-collapse:collapse;font-size:14px}th,td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--soft);font-weight:500;color:var(--muted)}
.columns{display:flex;gap:24px}.column{min-width:0}
.page-link a{font-weight:500}.bookmark{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;padding:12px;margin:8px 0;text-decoration:none}.bookmark small,.bookmark span{color:var(--muted)}
.equation{text-align:center;margin:12px 0;overflow:auto}.mention{color:var(--muted)}.muted{color:var(--muted)}
.button{display:inline-block;border:1px solid var(--border);border-radius:6px;padding:2px 10px}
.props{margin:0 0 24px;border-bottom:1px solid var(--border);padding-bottom:12px;font-size:14px}.props div{display:flex;gap:12px;padding:3px 0}.props dt{width:160px;flex:none;color:var(--muted)}.props dd{margin:0}
.chip{display:inline-block;border-radius:4px;padding:0 6px;margin:1px 4px 1px 0;background:var(--soft)}
.subpages{margin-top:40px;border-top:1px solid var(--border);padding-top:12px}.subpages ul{padding-left:20px}
.al-center{text-align:center}.al-right{text-align:right}.al-justify{text-align:justify}
${PALETTE.map(([name, text, bg]) => `.c-${name}{color:${text}}.bg-${name}{background:${bg}}`).join('')}
@media (prefers-color-scheme:dark){${PALETTE.map(([name, , , text, bg]) => `.c-${name}{color:${text}}.bg-${name}{background:${bg}}`).join('')}}
@media (max-width:760px){nav.tree{display:none}article{padding:24px 16px 64px}.columns{flex-direction:column}}
@media print{nav.tree,.crumbs{display:none}}
`
