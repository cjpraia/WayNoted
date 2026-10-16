import type { CSSProperties } from 'react'
import './feedback.css'

/** Esqueleto de carregamento. Use só depois de 400 ms (veja `useDelayedFlag`). Decorativo. */
export function Skeleton({ width = '100%', height = 16, radius, lines = 1, className = '' }: { width?: number | string; height?: number; radius?: number | string; lines?: number; className?: string }) {
  const style = { width, height, borderRadius: radius } as CSSProperties
  if (lines <= 1) return <span className={`np-skeleton ${className}`} style={style} aria-hidden="true" />
  return <span className={`np-skeleton-stack ${className}`} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} className="np-skeleton" style={{ ...style, width: i === lines - 1 ? '60%' : width }} />)}</span>
}
