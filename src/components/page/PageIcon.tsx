import type { CSSProperties } from 'react'
import { Icon } from '../ui/icons/Icon'
import { iconText, parseIconValue } from '../ui/icons/iconValue'

const LOCAL_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i

export function isLocalImageIcon(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length <= 360_000 && LOCAL_IMAGE.test(value)
}

/** Texto do ícone (emoji) para títulos, links e Markdown. Ícones de linha (`lucide:`) e imagens não viram texto. */
export function iconLabel(value: string | null | undefined): string {
  return iconText(value)
}

export type PageIconFallback = 'page' | 'database' | 'canvas'

const px = (value: unknown): number | undefined => typeof value === 'number' && value > 0 ? value : typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value) ? parseFloat(value) : undefined

/**
 * Ícone de página: emoji, imagem local ou ícone de linha colorido (`lucide:nome:cor`).
 * Sem valor, devolve null — ou o ícone padrão de documento/banco/quadro quando `fallback` é informado.
 * O ícone de linha usa o tamanho de `style.width`/`style.fontSize` ou, sem eles, 1em (escala com a fonte do contêiner).
 */
export function PageIcon({ value, className, style, fallback }: { value: string | null | undefined; className?: string; style?: CSSProperties; fallback?: PageIconFallback }) {
  const parsed = parseIconValue(value)
  const size = px(style?.width) ?? px(style?.fontSize)
  if (!parsed || (parsed.kind === 'image' && !isLocalImageIcon(parsed.src))) {
    if (!fallback && !value) return null
    const name = fallback === 'database' ? 'database' : fallback === 'canvas' ? 'canvas' : 'page'
    return <span className={`np-page-icon np-page-icon--default ${className ?? ''}`} style={style} data-page-icon="default">
      <Icon name={name} size={size ?? '1em'} strokeWidth={size && size >= 28 ? 1.5 : 1.75} />
    </span>
  }
  if (parsed.kind === 'image') return <img className={`pg-custom-icon ${className ?? ''}`} style={style} src={parsed.src} alt="" draggable={false} />
  if (parsed.kind === 'glyph') {
    return <span className={`np-page-icon np-page-icon--glyph ${className ?? ''}`} style={style} data-page-icon="glyph" data-icon-color={parsed.color}>
      <Icon name={parsed.name} size={size ?? '1em'} strokeWidth={size && size >= 28 ? 1.5 : 1.75} tone={parsed.color === 'default' ? undefined : parsed.color} />
    </span>
  }
  return <span className={className} style={style}>{iconText(parsed.text) || '📄'}</span>
}
