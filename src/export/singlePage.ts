// Exportação/importação de UMA página em Markdown/HTML: front-matter com ícone, capa e tipos.
// Puro (sem store/DOM) para rodar nos testes; src/components/page/exportMarkdown.ts faz a ligação com o app.
import { parseFrontMatter, stringifyFrontMatter } from './frontMatter.ts'
import { glyphSvg } from '../components/ui/icons/svg.ts'
import { normalizePageIcon, parseIconValue } from '../components/ui/icons/iconValue.ts'

export interface SinglePageMeta { title?: string; icon?: string | null; cover?: string | null; coverPosition?: number; types?: string[] }

const LOCAL_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i
const COLOR_COVER = /^#[0-9a-f]{3,8}$/i
const GRADIENT_COVER = /^(?:linear|radial)-gradient\([#a-z0-9(),.%\s-]+\)$/i

/** Aceita somente emoji/texto curto, `lucide:nome:cor` válido ou imagem local; qualquer outra coisa é descartada. */
export function safeImportedIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (text.startsWith('lucide:')) return parseIconValue(text)?.kind === 'glyph' ? normalizePageIcon(text) : null
  if (/^data:/i.test(text)) return text.length <= 360_000 && LOCAL_IMAGE.test(text) ? text : null
  if (/[:/\\<>]/.test(text) || [...text].length > 8) return null
  return text
}

export function safeImportedCover(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (COLOR_COVER.test(text) || (text.length <= 600 && GRADIENT_COVER.test(text))) return text
  return text.length <= 8_000_000 && LOCAL_IMAGE.test(text) ? text : null
}

export function singlePageMarkdown(input: { title: string; body: string; icon?: string | null; cover?: string | null; coverPosition?: number; typeNames?: string[] }): string {
  const entries: [string, unknown][] = [['title', input.title]]
  if (input.icon) entries.push(['icone', input.icon])
  if (input.cover) { entries.push(['capa', input.cover]); if (input.coverPosition !== undefined && input.coverPosition !== 50) entries.push(['capa_posicao', input.coverPosition]) }
  if (input.typeNames?.length) entries.push(['tipos', input.typeNames])
  return `${stringifyFrontMatter(entries)}\n\n# ${input.title}\n\n${input.body}`
}

/** Separa o front-matter (se houver) e devolve os metadados reconhecidos. Markdown simples passa intacto. */
export function splitSinglePageMarkdown(source: string): { body: string; meta: SinglePageMeta; hadFrontMatter: boolean } {
  const { data, body } = parseFrontMatter(source)
  const had = Object.keys(data).length > 0
  if (!had) return { body: source, meta: {}, hadFrontMatter: false }
  const pick = (...keys: string[]) => keys.map((key) => data[key]).find((value) => value !== undefined && value !== null)
  const meta: SinglePageMeta = {}
  const title = pick('title', 'titulo', 'título')
  if (typeof title === 'string' && title.trim()) meta.title = title.trim().slice(0, 300)
  const icon = safeImportedIcon(pick('icone', 'ícone', 'icon'))
  if (icon) meta.icon = icon
  const cover = safeImportedCover(pick('capa', 'cover'))
  if (cover) meta.cover = cover
  const position = pick('capa_posicao', 'cover_position')
  if (typeof position === 'number' && position >= 0 && position <= 100) meta.coverPosition = position
  const tipos = pick('tipos', 'types')
  const names = (Array.isArray(tipos) ? tipos : typeof tipos === 'string' ? [tipos] : []).filter((name): name is string => typeof name === 'string' && !!name.trim()).slice(0, 20)
  if (names.length) meta.types = names
  // O título repetido como H1 pelo exportador não deve virar bloco.
  let rest = body
  const heading = /^\s*# (.*)(\n|$)/.exec(rest)
  if (heading && (!meta.title || heading[1].trim() === meta.title)) { if (!meta.title) meta.title = heading[1].trim(); rest = rest.slice(heading[0].length).replace(/^\n/, '') }
  return { body: rest, meta, hadFrontMatter: true }
}

const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function singlePageHtml(input: { title: string; body: string; icon?: string | null; cover?: string | null; coverPosition?: number; locale: string }): string {
  const parsed = parseIconValue(input.icon)
  const iconHtml = !parsed ? '' : parsed.kind === 'glyph' ? glyphSvg(input.icon, 56) ?? '' : parsed.kind === 'image' ? (LOCAL_IMAGE.test(parsed.src) ? `<img src="${esc(parsed.src)}" alt="" width="56" height="56">` : '') : esc(parsed.text)
  const cover = safeImportedCover(input.cover)
  const coverHtml = !cover ? '' : cover.startsWith('data:') ? `<div class="cover" style="background-image:url('${esc(cover)}');background-position:center ${Number(input.coverPosition) || 50}%"></div>` : `<div class="cover" style="background:${esc(cover)}"></div>`
  const label = parsed?.kind === 'text' ? `${parsed.text} ${input.title}` : input.title
  const css = '.cover{height:200px;background-size:cover}.page-icon{font-size:56px;line-height:1;margin-bottom:8px}.page-icon svg,.page-icon img{display:block}'
  return `<!doctype html>\n<html lang="${esc(input.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(label)}</title><style>${css}</style></head><body>${coverHtml}<main>${iconHtml ? `<div class="page-icon">${iconHtml}</div>` : ''}<h1>${esc(input.title)}</h1>${input.body}</main></body></html>`
}
