// Ícone de linha como marcação SVG estática (exportação HTML, sem tokens de tema). Puro TS — roda no Node e no app.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { glyphComponent } from './catalog.ts'
import { parseIconValue, type IconColor } from './iconValue.ts'

/** Tons do tema claro (mesmos de --icon-tint-* em src/styles/tokens.css). */
export const GLYPH_HEX: Record<IconColor, string> = {
  default: '#5f5e5b', gray: '#7d7a75', brown: '#9f6b53', orange: '#d9730d', yellow: '#c29343',
  green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47',
}

/** SVG de um valor `lucide:nome:cor`; null para emoji/imagem/vazio. Nome desconhecido vira o documento. */
export function glyphSvg(value: unknown, size = 64): string | null {
  const parsed = parseIconValue(value)
  if (parsed?.kind !== 'glyph') return null
  const component = glyphComponent(parsed.name) ?? glyphComponent('file-text')!
  return renderToStaticMarkup(createElement(component, { size, strokeWidth: size >= 28 ? 1.5 : 1.75, color: GLYPH_HEX[parsed.color], 'aria-hidden': true }))
}
