// Formato serializado dos ícones de página (puro, sem React — usado por workspace.ts, exportação e testes).
// `page.icon` continua sendo string | null e aceita três formas:
//   • emoji/texto curto (formato histórico, ex.: "📌");
//   • imagem local `data:image/...;base64,...`;
//   • ícone de linha `lucide:<nome-kebab>[:<cor>]` (ex.: "lucide:book-open:blue").
// Dados antigos nunca são recusados: formatos desconhecidos são preservados como texto.

export const ICON_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type IconColor = (typeof ICON_COLORS)[number]

export const GLYPH_PREFIX = 'lucide:'
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type ParsedIcon =
  | { kind: 'glyph'; name: string; color: IconColor }
  | { kind: 'image'; src: string }
  | { kind: 'text'; text: string }

export function isIconColor(value: unknown): value is IconColor {
  return typeof value === 'string' && (ICON_COLORS as readonly string[]).includes(value)
}

/** Monta o valor persistido de um ícone de linha. Cor padrão é omitida para manter a string curta. */
export function formatGlyphIcon(name: string, color: IconColor = 'default'): string {
  if (!NAME.test(name)) throw new Error(`Nome de ícone inválido: ${name}`)
  return color === 'default' ? `${GLYPH_PREFIX}${name}` : `${GLYPH_PREFIX}${name}:${color}`
}

export function isGlyphIcon(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(GLYPH_PREFIX)
}

/** Interpreta `page.icon`. Valores `lucide:` malformados viram null (o chamador decide o ícone padrão). */
export function parseIconValue(value: unknown): ParsedIcon | null {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith(GLYPH_PREFIX)) {
    const [name = '', color = 'default'] = value.slice(GLYPH_PREFIX.length).split(':')
    if (!NAME.test(name) || name.length > 64) return null
    return { kind: 'glyph', name, color: isIconColor(color) ? color : 'default' }
  }
  if (/^data:image\//i.test(value)) return { kind: 'image', src: value }
  return { kind: 'text', text: value }
}

/**
 * Normalização tolerante usada ao carregar o meta: tipos errados viram null, `lucide:` é canonizado
 * (cor desconhecida → padrão) e qualquer outra string é mantida como está.
 */
export function normalizePageIcon(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = parseIconValue(value)
  if (!parsed) return null
  return parsed.kind === 'glyph' ? formatGlyphIcon(parsed.name, parsed.color) : value
}

/** Texto do ícone para títulos, links, Markdown e busca: só emoji/texto; ícones de linha e imagens não viram texto. */
export function iconText(value: unknown): string {
  const parsed = parseIconValue(value)
  return parsed?.kind === 'text' && !/^(?:blob:|file:|https?:)/i.test(parsed.text) ? parsed.text : ''
}
