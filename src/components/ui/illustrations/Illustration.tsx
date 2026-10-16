// Ilustrações de linha próprias (docs/DEVELOPMENT.md → Ilustrações): traço de 2 px, cantos arredondados,
// destaque "Maré" em um único elemento por desenho, neutros via tokens (claro/escuro). Puramente decorativas.
import type { ReactNode } from 'react'

export type IllustrationName = 'pages' | 'tasks' | 'day-done' | 'inbox' | 'search' | 'link-source'

const common = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function Illustration({ name, size = 96, className = '' }: { name: IllustrationName; size?: number; className?: string }) {
  return <svg className={`np-illus ${className}`.trim()} width={size} height={size * 0.75} viewBox="0 0 128 96" aria-hidden focusable="false" data-illustration={name}>
    <ellipse className="il-soft" cx="64" cy="84" rx="44" ry="6" />
    {name === 'pages' && <g {...common}>
      <rect className="il-paper" x="30" y="22" width="44" height="56" rx="8" transform="rotate(-6 52 50)" />
      <rect className="il-paper" x="50" y="14" width="46" height="60" rx="8" />
      <path className="il-line" d="M60 30h26M60 40h20M60 50h24" />
      <path className="il-accent" d="M88 62l3 3 6-7" />
      <path className="il-accent" d="M104 18v8M100 22h8" />
    </g>}
    {name === 'tasks' && <g {...common}>
      <rect className="il-paper" x="36" y="14" width="56" height="64" rx="10" />
      <rect className="il-line" x="46" y="28" width="9" height="9" rx="2.5" />
      <path className="il-line" d="M62 32.5h20" />
      <rect className="il-line" x="46" y="44" width="9" height="9" rx="2.5" />
      <path className="il-line" d="M62 48.5h16" />
      <rect className="il-accent" x="46" y="60" width="9" height="9" rx="2.5" />
      <path className="il-accent" d="M48.3 64.6l1.8 1.8 3.4-3.6" />
      <path className="il-line" d="M62 64.5h12" />
    </g>}
    {name === 'day-done' && <g {...common}>
      <path className="il-accent-fill" d="M42 66a22 22 0 0 1 44 0Z" stroke="none" opacity="0.18" />
      <path className="il-accent" d="M42 66a22 22 0 0 1 44 0" />
      <path className="il-line" d="M26 66h76M40 76h48" />
      <path className="il-accent" d="M64 30v-8M40 40l-5-5M88 40l5-5M30 56h-6M98 56h6" />
      <path className="il-accent" d="M55 56l6 6 12-13" strokeWidth="2.6" />
    </g>}
    {name === 'inbox' && <g {...common}>
      <path className="il-paper" d="M30 50l10-28h48l10 28v20a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8Z" />
      <path className="il-line" d="M30 50h20l4 8h20l4-8h20" />
      <path className="il-accent" d="M84 14a10 10 0 1 0 10 12 8 8 0 0 1-10-12Z" />
    </g>}
    {/* Visualização vinculada sem fonte: pasta de dados com uma pergunta (qual fonte?) e um elo. */}
    {name === 'link-source' && <g {...common}>
      <path className="il-paper" d="M28 30a6 6 0 0 1 6-6h16l6 7h38a6 6 0 0 1 6 6v35a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6Z" />
      <path className="il-line" d="M28 40h72" />
      <path className="il-accent" d="M58 51a6 6 0 1 1 8.5 5.5c-1.6.8-2.5 2.1-2.5 3.8V62" strokeWidth="2.6" />
      <path className="il-accent" d="M64 69v.5" strokeWidth="3.2" />
      <path className="il-line" d="M100 16l6-6M96 12l4-4M104 20l4-4" />
    </g>}
    {name === 'search' && <g {...common}>
      <circle className="il-paper" cx="56" cy="44" r="22" />
      <path className="il-line" d="M46 40h20M46 48h14" />
      <path className="il-accent" d="M72 60l16 16" strokeWidth="4" />
    </g>}
  </svg>
}

/** Estado vazio padrão: ilustração + título em Newsreader + texto curto + ação opcional. */
export function EmptyState({ illustration, title, children, action, className = '', size }: { illustration: IllustrationName; title: string; children?: ReactNode; action?: ReactNode; className?: string; size?: number }) {
  return <div className={`np-empty${size && size < 96 ? ' np-empty--compact' : ''} ${className}`.trim()}>
    <Illustration name={illustration} size={size} />
    <div className="np-empty-title">{title}</div>
    {children && <div className="np-empty-text">{children}</div>}
    {action}
  </div>
}
