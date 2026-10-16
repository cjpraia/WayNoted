// Coleção de um tipo: todas as páginas com o tipo nas visualizações dos bancos (tabela virtualizada, quadro,
// galeria, lista, calendário, linha do tempo), sem mover as páginas. É uma visão virtual (`np-type:<id>`) com o MESMO motor de
// filtros, ordenação e agrupamento do DatabaseView: barra de filtros (FilterBar), ordenação (SortPopover),
// "Configurações da visualização" (ViewSettingsPanel) e agrupamento. A visão fica salva no próprio tipo
// (persiste por tipo) e as mudanças entram no ⌘Z dos tipos.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { actions, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { Page, View, ViewType } from '../../types'
import type { ViewProps } from '../database/lib'
import { applyView, visibleProperties, valueToText, getValue } from '../database/lib'
import { TableView } from '../database/TableView'
import { BoardView } from '../database/views/BoardView'
import { GalleryView } from '../database/views/GalleryView'
import { ListView } from '../database/views/ListView'
import { CalendarView } from '../database/views/CalendarView'
import { TimelineView } from '../database/views/TimelineView'
import { ViewTypeIcon } from '../database/icons'
import { FilterBar, PropertyPicker } from '../database/ViewControls'
import { SortPopover } from '../database/ViewControls'
import { ViewSettingsPanel } from '../database/settings/ViewSettingsPanel'
import { changeViewType as viewTypePatch, type SettingsScreen } from '../database/settings/model'
import { newFilterFor } from '../database/PropertyMenu'
import { appendFilterRule } from '../database/filterTree'
import { groupableProperty, groupsFor, type ViewGroup } from '../database/grouping'
import { dbEvents } from '../database/ui/events'
import { Button, IconButton } from '../ui/Button'
import { Icon } from '../ui/icons'
import { normalizeSearch } from '../modals/search.mts'
import { buildTypeCollection, collectionLayouts } from '../../objecttypes/collection'
import type { ObjectType } from '../../objecttypes/model'
import { createObject, ensureCollection, objectTypes } from '../../objecttypes/actions'
import '../database/dbview.css'
import './objecttypes.css'

const VIEWS: Partial<Record<ViewType, (props: ViewProps) => ReactNode>> = { table: TableView, board: BoardView, gallery: GalleryView, list: ListView, calendar: CalendarView, timeline: TimelineView }
const GROUPED: ViewType[] = ['table', 'list', 'gallery']

/** Coleção do tipo nas visualizações dos bancos. `empty` substitui o corpo quando não há páginas. */
export function TypeCollection({ type, onOpen, empty }: { type: ObjectType; onOpen: (pageId: string, ids: string[]) => void; empty?: ReactNode }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [query, setQuery] = useState('')
  const [pop, setPop] = useState<{ kind: 'filter' | 'sort'; el: Element } | null>(null)
  const [settings, setSettings] = useState<SettingsScreen | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { ensureCollection(type.id) }, [type.id])
  const types = objectTypes()
  const collection = useMemo(() => buildTypeCollection(pages, types, type, { title: t('Nome', 'Name') }), [pages, types, type, t])
  const { db, schema, view } = collection
  const viewRows = useMemo(() => applyView(collection.rows, schema, view), [collection.rows, schema, view])
  const q = normalizeSearch(query.trim())
  const rows = useMemo(() => q ? viewRows.filter((row) => normalizeSearch(row.title).includes(q) || visibleProperties(schema, view).some((prop) => prop.type !== 'title' && normalizeSearch(valueToText(getValue(row, prop), prop)).includes(q))) : viewRows, [viewRows, q, schema, view])
  const Comp = VIEWS[view.type] ?? TableView
  const ids = rows.map((row) => row.id)
  const visibleProps = visibleProperties(schema, view)
  // Calendário e Linha do tempo só quando o tipo tem um campo de data (Carga cognitiva: nada de aba que não funciona).
  const kinds = collectionLayouts(schema)
  const changeLayout = (kind: ViewType) => {
    if (kind === view.type) return
    const patch = viewTypePatch(schema, view, kind)
    if (kind === 'board' && !patch.groupBy && !groupableProperty(schema, view.groupBy)) return
    actions.updateView(db.id, view.id, patch)
  }
  const boardOk = !!schema.properties.find((prop) => prop.type === 'select' || prop.type === 'status')
  const labelOf = (kind: ViewType) => ({ table: t('Tabela', 'Table'), board: t('Quadro', 'Board'), gallery: t('Galeria', 'Gallery'), list: t('Lista', 'List'), calendar: t('Calendário', 'Calendar'), timeline: t('Linha do tempo', 'Timeline') } as Record<string, string>)[kind] ?? kind
  const primaryGroup = GROUPED.includes(view.type) ? groupableProperty(schema, view.groupBy) : undefined
  const secondaryGroup = primaryGroup && view.type !== 'gallery' ? groupableProperty(schema, view.subgroupBy) : undefined
  const showBar = view.filters.length > 0 || view.sorts.length > 0
  const create = (props: Record<string, string | null> = {}) => { const id = Object.keys(props).length ? actions.createRow(db.id, props) : createObject(type.id); onOpen(id, [id, ...ids]) }
  const close = () => setPop(null)
  const bodyProps = { db, schema, view, visibleProps, readOnly: false, schemaLocked: false, onOpenRow: (id: string) => onOpen(id, ids) }
  const renderGroup = (group: ViewGroup, parent?: ViewGroup): ReactNode => {
    const emptyLabel = (name: string) => t('Sem {name}', 'No {name}', { name })
    const defaults = { [primaryGroup!.id]: (parent ?? group).option?.id ?? null, ...(parent && secondaryGroup ? { [secondaryGroup.id]: group.option?.id ?? null } : {}) }
    return <section key={group.key} className={`dbv-group-section${parent ? ' dbv-subgroup' : ''}`}>
      <header><span>{group.label}</span><small>{group.rows.length}</small>
        <IconButton label={t('Nova página em {group}', 'New page in {group}', { group: group.label })} onClick={() => create(defaults)}><Plus size={14} /></IconButton></header>
      {secondaryGroup && !parent ? groupsFor(group.rows, secondaryGroup, view, emptyLabel(secondaryGroup.name)).map((child) => renderGroup(child, group)) : <Comp {...bodyProps} rows={group.rows as Page[]} creationDefaults={defaults} />}
    </section>
  }
  const patchFilter = (id: string) => dbEvents.emit('openFilter', { dbId: db.id, filterId: id })
  return <div className="ot-collection" data-ot="collection">
    <div className="ot-collection-bar" role="toolbar" aria-label={t('Visualizações da coleção', 'Collection views')}>
      {kinds.map((kind) => <Button key={kind} variant="ghost" className="ot-viewtab" aria-pressed={view.type === kind} aria-label={labelOf(kind)} title={labelOf(kind)} disabled={kind === 'board' && !boardOk && view.type !== 'board'} onClick={() => changeLayout(kind)}><ViewTypeIcon type={kind} size={14} /><span className="ot-viewtab-label" aria-hidden>{labelOf(kind)}</span></Button>)}
      <span className="ot-spacer" />
      <input type="search" placeholder={t('Buscar…', 'Search…')} aria-label={t('Buscar nas páginas do tipo', 'Search pages of this type')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="ot-tools" ref={toolsRef}>
        <IconButton label={t('Filtrar', 'Filter')} className={view.filters.length ? 'ot-tool--on' : ''} aria-haspopup="menu" aria-expanded={pop?.kind === 'filter'} onClick={(e) => setPop(pop?.kind === 'filter' ? null : { kind: 'filter', el: e.currentTarget })}><Icon name="filter" size={16} /></IconButton>
        <IconButton ref={settingsBtnRef} label={t('Configurações da visualização', 'View settings')} className={settings ? 'ot-tool--on' : ''} aria-haspopup="dialog" aria-expanded={!!settings} onClick={() => setSettings(settings ? null : 'main')}><Icon name="view-settings" size={16} /></IconButton>
      </div>
      {/* Von Restorff: com a coleção vazia, a ação principal é a do estado vazio. */}
      {(collection.rows.length > 0 || !empty) && <Button variant="primary" onClick={() => create()}><Plus size={14} /> {t('Novo', 'New')}</Button>}
    </div>
    {showBar && <FilterBar dbId={db.id} schema={schema} view={view} readOnly={false} onOpenSort={(el) => setPop({ kind: 'sort', el })} />}
    {collection.hiddenCount > 0 && <div className="ot-collection-note">{t('{n} página(s) protegida(s) oculta(s)', '{n} protected page(s) hidden', { n: collection.hiddenCount })}</div>}
    <div className="ot-collection-body">
      {!collection.rows.length && empty ? empty
        : primaryGroup ? groupsFor(rows as Page[], primaryGroup, view, t('Sem {name}', 'No {name}', { name: primaryGroup.name })).map((group) => renderGroup(group))
        : <Comp {...bodyProps} rows={rows as Page[]} />}
      {collection.rows.length > 0 && !rows.length && <p className="ot-collection-note">{t('Nenhuma página com esses filtros.', 'No pages match these filters.')}</p>}
    </div>
    {pop?.kind === 'filter' && <PropertyPicker schema={schema} anchor={pop.el} title={t('Filtrar por…', 'Filter by…')} onClose={close} onPick={(prop) => {
      const filter = newFilterFor(prop)
      actions.updateView(db.id, view.id, { filters: [...view.filters, filter], ...(view.filterTree ? { filterTree: appendFilterRule(view.filterTree, view.filters.map((f) => f.id), filter.id) } : {}) })
      close()
      setTimeout(() => patchFilter(filter.id), 0)
    }} />}
    {pop?.kind === 'sort' && <SortPopover dbId={db.id} schema={schema} view={view} anchor={pop.el} onClose={close} />}
    {settings && toolsRef.current && <ViewSettingsPanel key={`${view.id}:${settings}`} anchor={toolsRef.current} ignore={settingsBtnRef.current} initial={settings} onClose={() => setSettings(null)}
      ctx={{ db, schema, view, readOnly: false, schemaLocked: false, dataReadOnly: false, rowCount: collection.rows.length, canDeleteView: false,
        onImportCsv: () => {}, onExportCsv: () => {}, onCreateLinked: () => {}, onDuplicateView: () => {}, onDeleteView: () => {},
        virtual: true, layouts: kinds, onChangeLayout: changeLayout }} />}
  </div>
}
