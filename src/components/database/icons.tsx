// Ícones de tipos de propriedade e de visualização (lucide-react).
import {
  AlignLeft,
  Calendar,
  CalendarDays,
  CircleChevronDown,
  CircleDotDashed,
  Hash,
  Mail,
  Phone,
  Clock3,
  PenLine,
  Sigma,
  ArrowUpRight,
  ChartColumn,
  GanttChart,
  Users,
  Paperclip,
  UserRound,
  MousePointerClick,
  Fingerprint,
  MapPin,
  PanelsTopLeft,
  Rss,
  ClipboardList,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  SquareCheck,
  SquareKanban,
  Table2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { PropType, ViewType } from '../../types'
import { BlockIcon } from '../ui/BlockIcon'

export const PROP_ICONS: Record<PropType, LucideIcon> = {
  title: Type,
  text: AlignLeft,
  number: Hash,
  select: CircleChevronDown,
  multiSelect: ListChecks,
  status: CircleDotDashed,
  date: Calendar,
  checkbox: SquareCheck,
  url: Link,
  email: Mail,
  phone: Phone,
  createdTime: Clock3,
  updatedTime: PenLine,
  formula: Sigma,
  relation: ArrowUpRight,
  rollup: Sigma,
  person: Users,
  files: Paperclip,
  createdBy: UserRound,
  updatedBy: UserRound,
  button: MousePointerClick,
  uniqueId: Fingerprint,
  place: MapPin,
}

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  board: SquareKanban,
  calendar: CalendarDays,
  list: List,
  gallery: LayoutGrid,
  timeline: GanttChart,
  chart: ChartColumn,
  dashboard: PanelsTopLeft,
  map: MapPin,
  feed: Rss,
  form: ClipboardList,
}

export function PropTypeIcon({ type, size = 16 }: { type: PropType; size?: number }) {
  const Icon = PROP_ICONS[type]
  return <Icon size={size} strokeWidth={1.8} />
}

export function ViewTypeIcon({ type, size = 16 }: { type: ViewType; size?: number }) {
  return <BlockIcon name={type} size={size} />
}

/** Ordem dos tipos nos menus de criação/conversão. */
export const PROP_TYPE_ORDER: PropType[] = ['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone', 'person', 'files', 'place', 'createdTime', 'createdBy', 'updatedTime', 'updatedBy', 'formula', 'relation', 'rollup', 'button', 'uniqueId']
