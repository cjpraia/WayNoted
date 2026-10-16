// Chip de uma opção (seleção, multisseleção, status). Sem dependências da store, para poder ser
// usado em menus leves (ex.: menu da propriedade).
import type { CSSProperties } from 'react'
import type { OptionColor } from '../../types'
import { customColorStyle } from './customColors'
import { PageIcon } from '../page/PageIcon'
import './db-tokens.css'

/** Classe e estilo de cor de uma opção: cor livre (hex) quando houver, senão a da paleta. */
export function optionColorProps(color: OptionColor, custom?: string): { className: string; style?: CSSProperties } {
  const style = customColorStyle(custom)
  return style ? { className: 'db-color-custom', style: style as CSSProperties } : { className: `db-color-${color}` }
}

export function OptionChip({ name, color, dot, custom, icon }: { name: string; color: OptionColor; dot?: boolean; custom?: string; icon?: string }) {
  const colors = optionColorProps(color, custom)
  return (
    <span className={`db-chip ${colors.className}${dot ? ' db-chip-status' : ''}`} style={colors.style}>
      {dot && <span className="db-chip-dot" />}
      {icon && <span className="db-chip-icon" aria-hidden="true"><PageIcon value={icon} style={{ width: 13, height: 13 }} /></span>}
      <span className="db-chip-label">{name}</span>
    </span>
  )
}
