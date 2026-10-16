import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Marca do aplicativo (docs/DEVELOPMENT.md): ladrilho "Maré" com o sol nascendo sobre a linha —
// o dia no centro (plano) apoiado numa linha de texto (notas). Desenho original, só formas simples (Prägnanz).
import type { CSSProperties } from 'react'

/** Símbolo: ladrilho com cantos generosos, sol nascente e linha do horizonte. */
export function LogoMark({ size = 28, title, className = '', style }: { size?: number; title?: string; className?: string; style?: CSSProperties }) {
  return <svg className={`np-logo-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={style}>
    <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
    <path d="M10 18.5a6 6 0 0 1 12 0Z" fill="var(--on-accent)" />
    <path d="M7.5 18.5h17" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M11 23h10" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
  </svg>
}

/** Logotipo: símbolo + nome em Newsreader. */
export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <span className={`np-logo ${className}`.trim()} aria-label={PRODUCT.name} role="img">
    <LogoMark size={size} />
    <span className="np-logo-word" aria-hidden style={{ fontSize: Math.round(size * 0.82) }}>{PRODUCT.name}</span>
  </span>
}
