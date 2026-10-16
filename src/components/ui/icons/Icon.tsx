// Registro central de ícones de interface do aplicativo.
// Regras (docs/DEVELOPMENT.md): só ícones de linha, tamanhos 14/16/18/20, traço 1.5–1.75,
// cor herdada (currentColor) ou um `tone` ligado aos tokens — nunca cor fixa.
import type { CSSProperties, ReactNode, SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight, Bell, CircleAlert, Calendar1, CalendarDays, ChartColumnIncreasing, Clock, Database, FileText, Inbox, LayoutTemplate, ListFilter, ListTodo,
  GraduationCap, Mic, PanelLeft, Plus, Presentation, Search, Settings, Shapes, Sparkles, SquarePen, Star, Table2, Trash2, Zap, Sunrise,
  // Painel de configurações da visualização de banco (docs/DEVELOPMENT.md).
  ArrowLeft, ArrowUpDown, Check, ChevronDown, ChevronRight, ChevronUp, Columns3, Copy, Download, Ellipsis, Eye, EyeOff, GripVertical, Info, Link2, ListTree,
  Lock, LockOpen, Maximize2, PaintRoller, Rows3, SlidersHorizontal, Upload, Waypoints, X, PenLine, ArrowUpRight,
} from 'lucide-react'
import { glyphComponent } from './catalog.ts'
import type { IconColor } from './iconValue.ts'

export type IconSize = 14 | 16 | 18 | 20
export type IconTone = 'inherit' | 'default' | 'muted' | 'strong' | 'accent' | 'danger' | IconColor

type Drawing = (props: { size: number | string; strokeWidth: number }) => ReactNode

/** Desenhos próprios onde o lucide não tem a metáfora certa. Grade 24×24, traço arredondado. */
const CUSTOM: Record<string, Drawing> = {
  // Documento com dobra e duas linhas — o mesmo traço do BlockIcon "page", padrão para páginas sem ícone.
  page: () => <><path d="M6.5 2.5h7.5l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z" /><path d="M14 2.5V7h4.5M8.5 12.5h7M8.5 16.5h5" /></>,
  // Grafo: quatro nós nítidos ligados por arestas que param na borda de cada nó.
  graph: () => <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="7.5" r="2.5" /><circle cx="7.5" cy="18" r="2.5" /><circle cx="17" cy="17.5" r="2.5" /><path d="M8.5 6.4l7 .7M6.4 8.5l.7 7M10 17.9l4.5-.3M16.1 15.1l1.3-5.1M8.3 8.1l6.9 7.4" /></>,
}

const LUCIDE: Record<string, LucideIcon> = {
  // "Meu dia": o sol nascente da marca (docs/DEVELOPMENT.md).
  home: Sunrise,
  today: Calendar1,
  calendar: CalendarDays,
  tasks: ListTodo,
  review: GraduationCap,
  productivity: ChartColumnIncreasing,
  search: Search,
  settings: Settings,
  trash: Trash2,
  inbox: Bell,
  'quick-notes': Inbox,
  'quick-capture': Zap,
  database: Table2,
  'database-source': Database,
  canvas: Presentation,
  query: ListFilter,
  types: Shapes,
  template: LayoutTemplate,
  dictation: Mic,
  ai: Sparkles,
  favorite: Star,
  recent: Clock,
  sidebar: PanelLeft,
  'new-page': SquarePen,
  plus: Plus,
  'arrow-right': ArrowRight,
  document: FileText,
  alert: CircleAlert,
  // Painel "Configurações da visualização" e barra de ferramentas do banco.
  'view-settings': SlidersHorizontal,
  filter: ListFilter,
  sort: ArrowUpDown,
  group: Columns3,
  subgroup: Rows3,
  'conditional-color': PaintRoller,
  'link-view': Link2,
  'data-source': Waypoints,
  'edit-properties': ListTree,
  automation: Zap,
  more: Ellipsis,
  lock: Lock,
  unlock: LockOpen,
  info: Info,
  expand: Maximize2,
  back: ArrowLeft,
  close: X,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  check: Check,
  eye: Eye,
  'eye-off': EyeOff,
  grip: GripVertical,
  copy: Copy,
  download: Download,
  upload: Upload,
  rename: PenLine,
  'arrow-up-right': ArrowUpRight,
}

/** Nomes semânticos do registro (além deles, qualquer id do catálogo de ícones de página funciona). */
export const ICON_NAMES = [...Object.keys(CUSTOM), ...Object.keys(LUCIDE)]

export function hasIcon(name: string): boolean {
  return name in CUSTOM || name in LUCIDE || !!glyphComponent(name)
}

export function toneColor(tone: IconTone | undefined): string | undefined {
  switch (tone) {
    case undefined: case 'inherit': return undefined
    case 'default': return 'var(--icon)'
    case 'muted': return 'var(--text-tertiary)'
    case 'strong': return 'var(--text)'
    case 'accent': return 'var(--accent)'
    case 'danger': return 'var(--danger)'
    default: return `var(--icon-tint-${tone})`
  }
}

/** Fundo suave de ladrilho para um tom de cor (ladrilhos de modelos/tipos na Home). */
export function toneSurface(tone: IconColor): string {
  return `var(--icon-tint-${tone}-bg)`
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'ref'> {
  name: string
  size?: number | string
  strokeWidth?: number
  title?: string
  tone?: IconTone
}

/**
 * Ícone único do app. `name` é semântico (home, today, tasks, graph…) ou um id do catálogo (book-open…).
 * Sem `title`, é decorativo (aria-hidden). Nomes desconhecidos caem no documento e marcam `data-icon-fallback`.
 */
export function Icon({ name, size = 16, strokeWidth = 1.75, title, tone, className, style, ...rest }: IconProps) {
  const color = toneColor(tone)
  const mergedStyle: CSSProperties | undefined = color ? { color, ...style } : style
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const }
  const custom = CUSTOM[name]
  const common = { 'data-icon': name, className: ['np-icon', className].filter(Boolean).join(' '), style: mergedStyle, ...a11y, ...rest }
  if (custom) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...common}>
      {title && <title>{title}</title>}
      {custom({ size, strokeWidth })}
    </svg>
  }
  const Lucide = LUCIDE[name] ?? glyphComponent(name)
  if (Lucide) return <Lucide size={size} strokeWidth={strokeWidth} {...common} />
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" data-icon-fallback="true" {...common}>
    {CUSTOM.page({ size, strokeWidth })}
  </svg>
}
