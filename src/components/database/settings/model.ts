// Lógica pura do painel "Configurações da visualização" (docs/DEVELOPMENT.md):
// navegação em pilha, quais opções cada layout oferece, troca de layout, ordem de grupos e
// normalização tolerante dos campos novos de View. Sem React nem store: testável em Node.
import type { DatabaseSchema, Property, View, ViewType } from '../../../types'
import { isGroupableType } from '../grouping.ts'

// ---------- Navegação em pilha ----------

export type SettingsScreen =
  | 'main' | 'layout' | 'visibility' | 'filter' | 'sort' | 'group' | 'subgroup' | 'color'
  | 'source' | 'properties' | 'automations' | 'more' | 'sources' | 'templates' | 'rowLayout'

export interface NavEntry { screen: SettingsScreen; /** Linha que abriu esta tela (recebe o foco ao voltar). */ from?: string }
export interface NavState { stack: NavEntry[]; /** 1 = avançou, -1 = voltou, 0 = abriu. Define a direção da animação. */ dir: 1 | -1 | 0 }

export const openNav = (screen: SettingsScreen = 'main'): NavState => ({ stack: screen === 'main' ? [{ screen: 'main' }] : [{ screen: 'main' }, { screen }], dir: 0 })
export const pushNav = (nav: NavState, screen: SettingsScreen, from?: string): NavState =>
  nav.stack[nav.stack.length - 1]?.screen === screen ? nav : { stack: [...nav.stack, { screen, from }], dir: 1 }
/** Volta um nível; `null` quando já está na tela principal (Esc então fecha o painel). */
export const popNav = (nav: NavState): NavState | null => nav.stack.length > 1 ? { stack: nav.stack.slice(0, -1), dir: -1 } : null
export const currentScreen = (nav: NavState): SettingsScreen => nav.stack[nav.stack.length - 1]?.screen ?? 'main'

// ---------- Tipos de visualização ----------

/** Ordem da grade de Layout (como no Export Bundle: Tabela, Quadro, Linha do tempo / Calendário, Lista, Galeria / …). */
export const LAYOUT_TYPES: { type: ViewType; pt: string; en: string }[] = [
  { type: 'table', pt: 'Tabela', en: 'Table' },
  { type: 'board', pt: 'Quadro', en: 'Board' },
  { type: 'timeline', pt: 'Linha do tempo', en: 'Timeline' },
  { type: 'calendar', pt: 'Calendário', en: 'Calendar' },
  { type: 'list', pt: 'Lista', en: 'List' },
  { type: 'gallery', pt: 'Galeria', en: 'Gallery' },
  { type: 'chart', pt: 'Gráfico', en: 'Chart' },
  { type: 'feed', pt: 'Feed', en: 'Feed' },
  { type: 'map', pt: 'Mapa', en: 'Map' },
  { type: 'form', pt: 'Formulário', en: 'Form' },
  { type: 'dashboard', pt: 'Painel', en: 'Dashboard' },
]

/** Visualizações que agrupam por seleção/status (o quadro exige agrupamento). */
export const GROUPABLE_TYPES: ViewType[] = ['table', 'board', 'list', 'gallery', 'feed']
/** Subgrupo só existe fora do quadro (o quadro não tem subgrupos nesta versão). */
export const SUBGROUP_TYPES: ViewType[] = ['table', 'list', 'gallery', 'feed']
export const LIMITABLE_TYPES: ViewType[] = ['table', 'list', 'gallery', 'board', 'feed']

export type LayoutOption =
  | 'showSourceTitle' | 'showPageIcon' | 'wrapAll' | 'groupBy' | 'colorColumns' | 'openPagesIn' | 'loadLimit'
  | 'cardPreview' | 'cardSize' | 'cardLayout' | 'verticalLines' | 'rowNumbers' | 'frozenColumns'
  | 'calendarBy' | 'showWeekends' | 'showWeekNumbers' | 'timelineBy' | 'timelineScale' | 'timelineTable'
  | 'chart' | 'feedBy' | 'mapBy'

/** Quais linhas aparecem sob a grade de Layout para cada tipo (só opções com efeito real). */
export function layoutOptionsFor(type: ViewType): LayoutOption[] {
  const out: LayoutOption[] = ['showSourceTitle']
  if (['table', 'board', 'list', 'gallery', 'calendar', 'timeline'].includes(type)) out.push('showPageIcon')
  if (['table', 'board', 'list', 'gallery'].includes(type)) out.push('wrapAll')
  if (GROUPABLE_TYPES.includes(type)) out.push('groupBy')
  if (type === 'board') out.push('colorColumns')
  if (type === 'calendar') out.push('calendarBy', 'showWeekends', 'showWeekNumbers')
  if (type === 'timeline') out.push('timelineBy', 'timelineScale', 'timelineTable')
  if (type === 'feed') out.push('feedBy')
  if (type === 'map') out.push('mapBy')
  if (type === 'chart') out.push('chart')
  if (!['chart', 'dashboard', 'form'].includes(type)) out.push('openPagesIn')
  if (LIMITABLE_TYPES.includes(type)) out.push('loadLimit')
  if (type === 'table') out.push('verticalLines', 'rowNumbers', 'frozenColumns')
  if (type === 'board' || type === 'gallery') out.push('cardPreview', 'cardSize', 'cardLayout')
  return out
}

export const defaultOpenPagesIn = (view: Pick<View, 'type' | 'openPagesIn'>) => view.openPagesIn ?? (['calendar', 'gallery'].includes(view.type) ? 'center' : 'side')
export const defaultCardPreview = (view: Pick<View, 'type' | 'cardPreview'>) => view.cardPreview ?? (view.type === 'gallery' ? 'cover' : 'none')
export const LOAD_LIMITS = [10, 20, 30, 50, 100] as const

/** Tipos em que o agrupamento é opcional e escolhido pela pessoa (o quadro sempre agrupa). */
export const OPTIONAL_GROUP_TYPES: ViewType[] = ['table', 'list', 'gallery', 'feed']

/**
 * Converte uma visualização para outro tipo, no lugar (mesmo id). Preserva nome, filtros, ordenação,
 * propriedades ocultas, larguras, limite e opções de cartão. Só preenche o que o novo tipo exige:
 * quadro → `groupBy` (primeira seleção/status); calendário/linha do tempo → `dateProp`.
 * Nunca liga agrupamento sozinho em tabela/lista/galeria/feed: o `groupBy` herdado do quadro é
 * descartado; entre tipos de agrupamento opcional ele é mantido. Tipos sem grupos o descartam.
 * O nome acompanha a troca só se ainda for o nome padrão do tipo anterior.
 */
export function changeViewType(schema: DatabaseSchema, view: View, type: ViewType): Partial<View> {
  if (view.type === type) return {}
  const patch: Partial<View> = { type }
  const clearGroups = () => { if (view.groupBy !== undefined) patch.groupBy = undefined; if (view.subgroupBy !== undefined) patch.subgroupBy = undefined; if (view.hiddenGroups?.length) patch.hiddenGroups = [] }
  if (type === 'board') {
    if (!schema.properties.some((p) => p.id === view.groupBy && isGroupableType(p.type))) {
      patch.groupBy = schema.properties.find((p) => p.type === 'status' || p.type === 'select')?.id
      if (view.hiddenGroups?.length) patch.hiddenGroups = []
    }
    // Subgrupos não existem no quadro: descarta para não ficar uma configuração invisível.
    if (view.subgroupBy !== undefined) patch.subgroupBy = undefined
  } else if (OPTIONAL_GROUP_TYPES.includes(type)) {
    if (!OPTIONAL_GROUP_TYPES.includes(view.type)) clearGroups()
  } else clearGroups()
  if ((type === 'calendar' || type === 'timeline') && !schema.properties.some((p) => p.id === view.dateProp && p.type === 'date'))
    patch.dateProp = schema.properties.find((p) => p.type === 'date')?.id
  const old = LAYOUT_TYPES.find((item) => item.type === view.type)
  const next = LAYOUT_TYPES.find((item) => item.type === type)
  if (old && next && view.name === old.pt) patch.name = next.pt
  else if (old && next && view.name === old.en) patch.name = next.en
  return patch
}

// ---------- Propriedades ----------

/** Propriedades mostradas (em ordem; o título sempre) e ocultas, filtradas pela busca. */
export function splitVisibility(schema: DatabaseSchema, view: View, query = ''): { shown: Property[]; hidden: Property[] } {
  const q = query.trim().toLocaleLowerCase()
  const match = (p: Property) => !q || p.name.toLocaleLowerCase().includes(q)
  const hidden = new Set(view.hidden)
  return {
    shown: schema.properties.filter((p) => (p.type === 'title' || !hidden.has(p.id)) && match(p)),
    hidden: schema.properties.filter((p) => p.type !== 'title' && hidden.has(p.id) && match(p)),
  }
}

/** Move `id` para antes/depois de `targetId` numa lista de ids (reordenar ordenações, propriedades…). */
export function moveId(ids: string[], id: string, targetId: string, after: boolean): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids
  const rest = ids.filter((item) => item !== id)
  const at = rest.indexOf(targetId) + (after ? 1 : 0)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

// ---------- Classes de efeito ----------

/** Classes do corpo do banco que aplicam as opções visuais por CSS (sem tocar em cada componente). */
export function viewBodyClasses(view: View): string {
  const out: string[] = []
  if (view.showPageIcon === false) out.push('dbv-body--no-icons')
  if (view.wrapAll) out.push('dbv-body--wrap')
  if (view.verticalLines === false) out.push('dbv-body--no-vlines')
  if (view.colorColumns === false) out.push('dbv-body--plain-columns')
  if (view.cardSize) out.push(`dbv-body--card-${view.cardSize}`)
  if (view.cardLayout === 'compact') out.push('dbv-body--card-compact')
  if (view.showGroupCount === false) out.push('dbv-body--no-group-count')
  return out.join(' ')
}

// ---------- Compatibilidade de dados ----------

const BOOLEAN_FIELDS = ['showSourceTitle', 'wrapAll', 'verticalLines', 'rowNumbers', 'colorColumns', 'showWeekends', 'showWeekNumbers', 'timelineTable', 'hideEmptyGroups', 'showGroupCount'] as const
const ENUM_FIELDS: Record<string, readonly string[]> = {
  cardSize: ['small', 'medium', 'large'],
  cardLayout: ['compact', 'list'],
  groupSort: ['manual', 'alphabetical', 'reverse'],
  cardPreview: ['none', 'cover', 'content', 'property'],
}

/**
 * Remove (sem recusar o arquivo) valores inválidos dos campos opcionais de configuração.
 * Dados antigos, sem esses campos, passam intactos. Devolve quantos campos foram descartados.
 */
export function normalizeViewSettings(view: Record<string, unknown>): number {
  let dropped = 0
  const drop = (key: string) => { delete view[key]; dropped++ }
  for (const key of BOOLEAN_FIELDS) if (view[key] !== undefined && typeof view[key] !== 'boolean') drop(key)
  for (const [key, allowed] of Object.entries(ENUM_FIELDS)) if (view[key] !== undefined && !allowed.includes(String(view[key]))) drop(key)
  if (view.sourceViewId !== undefined && typeof view.sourceViewId !== 'string') drop('sourceViewId')
  if (view.cardPreviewPropertyId !== undefined && typeof view.cardPreviewPropertyId !== 'string') drop('cardPreviewPropertyId')
  if (view.loadLimit !== undefined && !(typeof view.loadLimit === 'number' && Number.isFinite(view.loadLimit) && view.loadLimit >= 0)) drop('loadLimit')
  if (view.frozenColumns !== undefined && !(typeof view.frozenColumns === 'number' && Number.isInteger(view.frozenColumns) && view.frozenColumns >= 0)) drop('frozenColumns')
  if (view.hiddenGroups !== undefined && !(Array.isArray(view.hiddenGroups) && view.hiddenGroups.every((item) => typeof item === 'string'))) drop('hiddenGroups')
  return dropped
}
