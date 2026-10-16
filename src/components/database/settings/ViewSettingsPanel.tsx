// Painel "Configurações da visualização" (docs/DEVELOPMENT.md): um único popover ancorado à
// direita da barra do banco, com telas em pilha (← voltar, Esc volta um nível, ↑/↓ + Enter).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { actions } from '../../../store'
import { t } from '../../../i18n'
import type { View, ViewType } from '../../../types'
import { Icon } from '../../ui/icons'
import { DbPopover, type DbAnchor } from '../ui/Popover'
import { PropTypeIcon, ViewTypeIcon } from '../icons'
import { currentScreen, defaultCardPreview, defaultOpenPagesIn, layoutOptionsFor, LAYOUT_TYPES, LOAD_LIMITS, openNav, popNav, pushNav, SUBGROUP_TYPES, GROUPABLE_TYPES, splitVisibility, type NavState, type SettingsScreen } from './model'
import { ChoiceRow, keyNav, NavRow, PanelHeader, SectionLabel, Sep, ToggleRow } from './ui'
import type { ScreenProps, SettingsCtx } from './types'
import { FilterScreen, SortScreen, VisibilityScreen } from './screens'
import { AutomationsScreen, ColorScreen, GroupScreen, MoreScreen, PropertiesScreen, RowLayoutScreen, SourceScreen, SourcesScreen, SubgroupScreen, TemplatesScreen } from './screens2'
import './viewSettings.css'
import { isGroupableType } from '../grouping'

export type { SettingsCtx } from './types'

const TITLES: Record<SettingsScreen, [string, string]> = {
  main: ['Configurações da visualização', 'View settings'],
  layout: ['Layout', 'Layout'],
  visibility: ['Visibilidade das propriedades', 'Property visibility'],
  filter: ['Filtro', 'Filter'],
  sort: ['Ordenar', 'Sort'],
  group: ['Agrupar', 'Group'],
  subgroup: ['Subgrupo', 'Sub-group'],
  color: ['Cor condicional', 'Conditional color'],
  source: ['Fonte', 'Source'],
  properties: ['Editar propriedades', 'Edit properties'],
  automations: ['Automações', 'Automations'],
  more: ['Mais configurações', 'More settings'],
  sources: ['Gerenciar fontes de dados', 'Manage data sources'],
  templates: ['Templates', 'Templates'],
  rowLayout: ['Layout da página', 'Page layout'],
}
/** Telas com formulários largos herdados (templates, automações…). */
const WIDE: SettingsScreen[] = ['automations', 'templates', 'rowLayout', 'sources', 'filter', 'color']

export const layoutLabel = (type: ViewType) => { const item = LAYOUT_TYPES.find((entry) => entry.type === type); return item ? t(item.pt, item.en) : type }

export function ViewSettingsPanel({ ctx, anchor, ignore, initial = 'main', onClose }: { ctx: SettingsCtx; anchor: DbAnchor; ignore?: Element | null; initial?: SettingsScreen; onClose: () => void }) {
  const [nav, setNav] = useState<NavState>(() => openNav(initial))
  const [focusBack, setFocusBack] = useState<string | undefined>()
  const bodyRef = useRef<HTMLDivElement>(null)
  const screen = currentScreen(nav)
  const push = (next: SettingsScreen, from?: string) => setNav((cur) => pushNav(cur, next, from))
  const back = () => {
    const popped = nav.stack[nav.stack.length - 1]
    const prev = popNav(nav)
    if (!prev) return onClose()
    setFocusBack(popped?.from)
    setNav(prev)
  }

  // Foco: ao abrir, o painel; ao avançar, o primeiro campo/linha; ao voltar, a linha de origem.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const target = nav.dir === -1 && focusBack ? body.querySelector<HTMLElement>(`[data-vs-id="${focusBack}"]`)
      : nav.dir === 1 ? body.querySelector<HTMLElement>('[data-autofocus]') ?? body.querySelector<HTMLElement>('.vs-screen [data-vs-nav]:not(.vs-header-btn):not(:disabled)') : null
    ;(target ?? body).focus({ preventScroll: true })
  }, [nav]) // eslint-disable-line react-hooks/exhaustive-deps

  const props: ScreenProps = { ctx, push, close: onClose }
  const content = (() => {
    switch (screen) {
      case 'main': return <MainScreen {...props} />
      case 'layout': return <LayoutScreen {...props} />
      case 'visibility': return <VisibilityScreen {...props} />
      case 'filter': return <FilterScreen {...props} />
      case 'sort': return <SortScreen {...props} />
      case 'group': return <GroupScreen {...props} />
      case 'subgroup': return <SubgroupScreen {...props} />
      case 'color': return <ColorScreen {...props} />
      case 'source': return <SourceScreen {...props} />
      case 'properties': return <PropertiesScreen {...props} />
      case 'automations': return <AutomationsScreen {...props} />
      case 'more': return <MoreScreen {...props} />
      case 'sources': return <SourcesScreen {...props} />
      case 'templates': return <TemplatesScreen {...props} />
      case 'rowLayout': return <RowLayoutScreen {...props} />
    }
  })()
  const [pt, en] = TITLES[screen]
  return (
    <DbPopover anchor={anchor} ignore={ignore} placement="bottom-end" offset={6} onClose={onClose} onEscape={back} className={`vs-panel${WIDE.includes(screen) ? ' vs-panel--wide' : ''}`} label={t(...TITLES.main)}>
      <div className="vs-body" ref={bodyRef} tabIndex={-1} onKeyDown={keyNav} data-screen={screen}>
        <PanelHeader title={t(pt, en)} main={screen === 'main'} onBack={nav.stack.length > 1 ? back : undefined} onClose={onClose} />
        <div key={`${nav.stack.length}:${screen}`} className={`vs-screen${nav.dir === 1 ? ' vs-enter-forward' : nav.dir === -1 ? ' vs-enter-back' : ''}`}>
          {content}
        </div>
      </div>
    </DbPopover>
  )
}

// ---------- Tela principal ----------

function MainScreen({ ctx, push }: ScreenProps) {
  const { db, schema, view, readOnly } = ctx
  const [name, setName] = useState(view.name)
  const nameRef = useRef(name)
  nameRef.current = name
  const commit = () => { const next = nameRef.current.trim(); if (next && next !== view.name && !db.locked) actions.updateView(db.id, view.id, { name: next }) }
  useEffect(() => commit, []) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = splitVisibility(schema, view).shown.length
  const groupProp = schema.properties.find((p) => p.id === view.groupBy)
  const subgroupProp = schema.properties.find((p) => p.id === view.subgroupBy)
  const linkedSource = db.database?.linkedSourceId
  const multi = (schema.sourceDatabaseIds?.length ?? 0) > 0
  const go = (screen: SettingsScreen) => () => push(screen, screen)
  const viewDisabled = readOnly
  return (
    <>
      <div className="vs-name">
        <button type="button" className="vs-name-type" data-vs-nav data-vs-id="layout-icon" disabled={viewDisabled} title={t('Layout', 'Layout')} aria-label={t('Layout', 'Layout')} onClick={() => push('layout', 'layout-icon')}><ViewTypeIcon type={view.type} size={16} /></button>
        <label className="vs-name-field">
          <input
            className="vs-input"
            data-vs-nav
            value={name}
            readOnly={viewDisabled}
            aria-label={t('Nome da visualização', 'View name')}
            onChange={(e) => setName(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() } }}
          />
          <span className="vs-name-info" title={t('Nome mostrado na aba desta visualização. Cada visualização guarda seu próprio layout, filtros, ordenação e agrupamento.', 'Name shown on this view’s tab. Each view keeps its own layout, filters, sort and grouping.')}><Icon name="info" size={14} /></span>
        </label>
      </div>
      <NavRow id="layout" icon={<ViewTypeIcon type={view.type} size={16} />} label={t('Layout', 'Layout')} value={layoutLabel(view.type)} disabled={viewDisabled} onClick={go('layout')} />
      <NavRow id="visibility" icon={<Icon name="eye" size={16} />} label={t('Visibilidade das propriedades', 'Property visibility')} value={String(shown)} disabled={viewDisabled} onClick={go('visibility')} />
      <NavRow id="filter" icon={<Icon name="filter" size={16} />} label={t('Filtro', 'Filter')} value={view.filters.length ? String(view.filters.length) : ''} disabled={viewDisabled} onClick={go('filter')} />
      <NavRow id="sort" icon={<Icon name="sort" size={16} />} label={t('Ordenar', 'Sort')} value={view.sorts.length ? String(view.sorts.length) : ''} disabled={viewDisabled} onClick={go('sort')} />
      {GROUPABLE_TYPES.includes(view.type) && <NavRow id="group" icon={<Icon name="group" size={16} />} label={t('Agrupar', 'Group')} value={groupProp?.name ?? ''} disabled={viewDisabled} onClick={go('group')} />}
      {SUBGROUP_TYPES.includes(view.type) && <NavRow id="subgroup" icon={<Icon name="subgroup" size={16} />} label={t('Subgrupo', 'Sub-group')} value={groupProp ? subgroupProp?.name ?? '' : ''} disabled={viewDisabled} onClick={go('subgroup')} />}
      <NavRow id="color" icon={<Icon name="conditional-color" size={16} />} label={t('Cor condicional', 'Conditional color')} value={view.colorRules?.length ? String(view.colorRules.length) : ''} disabled={viewDisabled} onClick={go('color')} />
      {!ctx.virtual && <>
      <Sep />
      <SectionLabel>{t('Configurações da fonte de dados', 'Data source settings')}</SectionLabel>
      <NavRow id="source" icon={<Icon name="data-source" size={16} />} label={t('Fonte', 'Source')} value={linkedSource ? '' : multi ? t('{n} fontes', '{n} sources', { n: (schema.sourceDatabaseIds?.length ?? 0) + (schema.properties.length ? 1 : 0) }) : db.title || t('Sem título', 'Untitled')} onClick={go('source')} />
      <NavRow id="properties" icon={<Icon name="edit-properties" size={16} />} label={t('Editar propriedades', 'Edit properties')} value={String(schema.properties.length)} disabled={readOnly} onClick={go('properties')} />
      {!linkedSource && <NavRow id="automations" icon={<Icon name="automation" size={16} />} label={t('Automações', 'Automations')} value={schema.automations?.length ? String(schema.automations.filter((a) => a.enabled).length) : ''} disabled={readOnly} onClick={go('automations')} />}
      <NavRow id="more" icon={<Icon name="more" size={16} />} label={t('Mais configurações', 'More settings')} onClick={go('more')} />
      <Sep />
      {!linkedSource && <NavRow id="sources" icon={<Icon name="database-source" size={16} />} label={t('Gerenciar fontes de dados', 'Manage data sources')} value={schema.sourceDatabaseIds?.length ? String(schema.sourceDatabaseIds.length) : ''} disabled={readOnly} onClick={go('sources')} />}
      <NavRow id="lock" icon={<Icon name={db.locked ? 'unlock' : 'lock'} size={16} />} label={db.locked ? t('Desbloquear banco de dados', 'Unlock database') : t('Bloquear banco de dados', 'Lock database')} chevron={false} onClick={() => actions.updatePage(db.id, { locked: !db.locked })} />
      </>}
    </>
  )
}

// ---------- Layout ----------

function LayoutScreen({ ctx, push }: ScreenProps) {
  const { db, schema, view } = ctx
  const update = (patch: Partial<View>) => actions.updateView(db.id, view.id, patch)
  const options = layoutOptionsFor(view.type)
  const has = (option: ReturnType<typeof layoutOptionsFor>[number]) => options.includes(option)
  const dates = schema.properties.filter((p) => p.type === 'date')
  const files = schema.properties.filter((p) => p.type === 'files')
  const places = schema.properties.filter((p) => p.type === 'place')
  const groupProp = schema.properties.find((p) => p.id === view.groupBy && isGroupableType(p.type))
  const chartGroups = schema.properties.filter((p) => ['select', 'status', 'date', 'checkbox'].includes(p.type))
  const numeric = schema.properties.filter((p) => ['number', 'formula', 'rollup'].includes(p.type))
  const preview = defaultCardPreview(view)
  const previewProp = files.find((p) => p.id === view.cardPreviewPropertyId)
  const propChoice = (p: { id: string; name: string; type: import('../../../types').PropType }) => ({ value: p.id, label: p.name, icon: <PropTypeIcon type={p.type} size={16} /> })
  return (
    <>
      <div className="vs-layouts" role="radiogroup" aria-label={t('Layout', 'Layout')}>
        {LAYOUT_TYPES.filter((item) => !ctx.layouts || ctx.layouts.includes(item.type)).map((item) => (
          <button key={item.type} type="button" role="radio" aria-checked={view.type === item.type} data-vs-nav className={`vs-layout${view.type === item.type ? ' is-current' : ''}`} onClick={() => ctx.onChangeLayout ? ctx.onChangeLayout(item.type) : actions.changeViewType(db.id, view.id, item.type)}>
            <ViewTypeIcon type={item.type} size={16} />
            <span>{t(item.pt, item.en)}</span>
          </button>
        ))}
      </div>
      {has('showSourceTitle') && <ToggleRow label={t('Mostrar título da fonte de dados', 'Show data source titles')} checked={view.showSourceTitle !== false} onChange={(on) => update({ showSourceTitle: on })} />}
      {has('showPageIcon') && <ToggleRow label={t('Mostrar ícone da página', 'Show page icon')} checked={view.showPageIcon !== false} onChange={(on) => update({ showPageIcon: on })} />}
      {has('wrapAll') && <ToggleRow label={t('Quebrar todo o conteúdo', 'Wrap all content')} checked={!!view.wrapAll} onChange={(on) => update({ wrapAll: on })} />}
      {has('verticalLines') && <ToggleRow label={t('Mostrar linhas verticais', 'Show vertical lines')} checked={view.verticalLines !== false} onChange={(on) => update({ verticalLines: on })} />}
      {has('rowNumbers') && <ToggleRow label={t('Mostrar numeração de linhas', 'Show row numbers')} checked={!!view.rowNumbers} onChange={(on) => update({ rowNumbers: on })} />}
      {has('groupBy') && <NavRow id="layout-group" label={t('Agrupar por', 'Group by')} value={groupProp?.name ?? t('Nenhum', 'None')} onClick={() => push('group', 'layout-group')} />}
      {has('colorColumns') && <ToggleRow label={t('Colorir colunas', 'Color columns')} checked={view.colorColumns !== false} onChange={(on) => update({ colorColumns: on })} />}
      {has('calendarBy') && <ChoiceRow label={t('Mostrar calendário por', 'Show calendar by')} value={schema.properties.find((p) => p.id === view.dateProp && p.type === 'date')?.id ?? dates[0]?.id ?? ''} display={dates.length ? undefined : t('Sem data', 'No date')} disabled={!dates.length} choices={dates.map(propChoice)} onChange={(dateProp) => update({ dateProp })} />}
      {has('showWeekends') && <ToggleRow label={t('Mostrar fins de semana', 'Show weekends')} checked={view.showWeekends !== false} onChange={(on) => update({ showWeekends: on })} />}
      {has('showWeekNumbers') && <ToggleRow label={t('Mostrar números de semana', 'Show week numbers')} checked={!!view.showWeekNumbers} onChange={(on) => update({ showWeekNumbers: on })} />}
      {has('timelineBy') && <ChoiceRow label={t('Mostrar linha do tempo por', 'Show timeline by')} value={schema.properties.find((p) => p.id === view.dateProp && p.type === 'date')?.id ?? dates[0]?.id ?? ''} display={dates.length ? undefined : t('Sem data', 'No date')} disabled={!dates.length} choices={dates.map(propChoice)} onChange={(dateProp) => update({ dateProp })} />}
      {has('timelineScale') && <ChoiceRow label={t('Escala', 'Zoom')} value={view.timelineScale ?? 'month'} choices={[{ value: 'week', label: t('Semana', 'Week') }, { value: 'month', label: t('Mês', 'Month') }, { value: 'quarter', label: t('Trimestre', 'Quarter') }]} onChange={(timelineScale) => update({ timelineScale })} />}
      {has('timelineTable') && <ToggleRow label={t('Mostrar tabela', 'Show table')} checked={view.timelineTable !== false} onChange={(on) => update({ timelineTable: on })} />}
      {has('feedBy') && <ChoiceRow label={t('Ordenar feed por', 'Feed date')} value={view.feedDateProp ?? ''} choices={[{ value: '', label: t('Última edição', 'Last edited') }, ...dates.map(propChoice)]} onChange={(feedDateProp) => update({ feedDateProp: feedDateProp || undefined })} />}
      {has('mapBy') && <ChoiceRow label={t('Mostrar mapa por', 'Show map by')} value={places.find((p) => p.id === view.mapPlacePropertyId)?.id ?? places[0]?.id ?? ''} display={places.length ? undefined : t('Sem local', 'No place')} disabled={!places.length} choices={places.map(propChoice)} onChange={(mapPlacePropertyId) => update({ mapPlacePropertyId })} />}
      {has('chart') && <>
        <ChoiceRow label={t('Tipo de gráfico', 'Chart type')} value={view.chartType ?? 'horizontalBar'} choices={[{ value: 'horizontalBar', label: t('Barras horizontais', 'Horizontal bars') }, { value: 'verticalBar', label: t('Barras verticais', 'Vertical bars') }, { value: 'line', label: t('Linha', 'Line') }, { value: 'donut', label: t('Rosca', 'Donut') }, { value: 'number', label: t('Número', 'Number') }, { value: 'stackedBar', label: t('Barras empilhadas', 'Stacked bars') }, { value: 'cumulativeLine', label: t('Linha acumulada', 'Cumulative line') }, { value: 'sankey', label: t('Sankey (fluxo)', 'Sankey (flow)') }, { value: 'treemap', label: t('Árvore (treemap)', 'Treemap') }]} onChange={(chartType) => update({ chartType })} />
        <ChoiceRow label={t('Eixo / grupos', 'Group by')} value={view.chartGroupBy ?? chartGroups[0]?.id ?? ''} disabled={!chartGroups.length} choices={chartGroups.map(propChoice)} onChange={(chartGroupBy) => update({ chartGroupBy })} />
        <ChoiceRow label={t('Calcular', 'Calculate')} value={view.chartAggregation ?? 'count'} choices={[{ value: 'count', label: t('Contagem', 'Count') }, { value: 'sum', label: t('Soma', 'Sum'), disabled: !numeric.length }, { value: 'average', label: t('Média', 'Average'), disabled: !numeric.length }]} onChange={(chartAggregation) => update({ chartAggregation })} />
        {view.chartAggregation && view.chartAggregation !== 'count' && <ChoiceRow label={t('Propriedade numérica', 'Numeric property')} value={view.chartValueId ?? numeric[0]?.id ?? ''} choices={numeric.map(propChoice)} onChange={(chartValueId) => update({ chartValueId })} />}
      </>}
      {has('openPagesIn') && <ChoiceRow label={t('Abrir páginas em', 'Open pages in')} value={defaultOpenPagesIn(view)} choices={[{ value: 'side', label: t('Prévia lateral', 'Side peek') }, { value: 'center', label: t('Prévia central', 'Center peek') }, { value: 'full', label: t('Página inteira', 'Full page') }]} onChange={(openPagesIn) => update({ openPagesIn })} />}
      {has('loadLimit') && <ChoiceRow label={t('Limite de carregamento', 'Load limit')} value={String(view.loadLimit ?? 0)} choices={[...LOAD_LIMITS.map((n) => ({ value: String(n), label: String(n) })), { value: '0', label: t('Tudo', 'All') }]} onChange={(value) => update({ loadLimit: Number(value) || undefined })} />}
      {has('frozenColumns') && <ChoiceRow label={t('Colunas congeladas', 'Frozen columns')} value={String(view.frozenColumns ?? 0)} choices={Array.from({ length: Math.min(6, schema.properties.length + 1) }, (_, index) => ({ value: String(index), label: index === 0 ? t('Nenhuma', 'None') : String(index) }))} onChange={(count) => update({ frozenColumns: Number(count) })} />}
      {has('cardPreview') && <>
        <Sep />
        <ChoiceRow label={t('Prévia do cartão', 'Card preview')} value={preview} display={preview === 'property' ? previewProp?.name ?? t('Propriedades da página', 'Page properties') : undefined}
          choices={[{ value: 'none', label: t('Nenhuma', 'None') }, { value: 'cover', label: t('Capa da página', 'Page cover') }, { value: 'property', label: t('Propriedades da página', 'Page properties'), sub: files.map(propChoice) }, { value: 'content', label: t('Conteúdo da página', 'Page content'), description: t('Usa o primeiro bloco da página', 'Uses first block on the page') }]}
          onChange={(cardPreview, sub) => update({ cardPreview, ...(sub ? { cardPreviewPropertyId: sub } : {}) })} />
        <ChoiceRow label={t('Tamanho do cartão', 'Card size')} value={view.cardSize ?? 'medium'} choices={[{ value: 'small', label: t('Pequeno', 'Small') }, { value: 'medium', label: t('Médio', 'Medium') }, { value: 'large', label: t('Grande', 'Large') }]} onChange={(cardSize) => update({ cardSize })} />
        <div className="vs-cardlayout">
          <div className="vs-cardlayout-title">{t('Layout do cartão', 'Card layout')}</div>
          <div className="vs-cardlayout-options" role="radiogroup" aria-label={t('Layout do cartão', 'Card layout')}>
            {(['compact', 'list'] as const).map((mode) => (
              <button key={mode} type="button" role="radio" data-vs-nav aria-checked={(view.cardLayout ?? 'list') === mode} className={`vs-cardlayout-option${(view.cardLayout ?? 'list') === mode ? ' is-current' : ''}`} onClick={() => update({ cardLayout: mode })}>
                <span className={`vs-mini vs-mini--${mode}`} aria-hidden="true"><i /><b /><b /><b /></span>
                <span>{mode === 'compact' ? t('Compacto', 'Compact') : t('Lista', 'List')}</span>
              </button>
            ))}
          </div>
        </div>
      </>}
    </>
  )
}
