import { normalizeSearch } from '../modals/search.mts'
// Casca de um banco de dados: cabeçalho (ícone + título), abas de visualizações, barra de
// ferramentas (filtrar, ordenar, busca, opções, novo), filtros e a visualização ativa.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Copy, Link2, Plus, Search, SmilePlus, Trash2, X } from 'lucide-react'
import { actions, api, getState, selectors, useStore } from '../../store'
import type { View, ViewType } from '../../types'
import { applyView, defaultsForNewRow, defaultsFromFilters, getValue, valueToText, visibleProperties, type ViewProps } from './lib'
import { ViewTypeIcon } from './icons'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep, type DbAnchor } from './ui/Popover'
import { FilterBar, PropertyPicker, SortPopover } from './ViewControls'
import { newFilterFor } from './PropertyMenu'
import { dbEvents } from './ui/events'
import { TableView } from './TableView'
import { BoardView } from './views/BoardView'
import { CalendarView } from './views/CalendarView'
import { ListView } from './views/ListView'
import { GalleryView } from './views/GalleryView'
import { TimelineView } from './views/TimelineView'
import { ChartView } from './views/ChartView'
import { DashboardView, FeedView, FormView, MapView } from './views/ExtraViews'
import { CSV_ROW_ID, csvCompanionKind, exportCsv, fromCsvCell, parseCsv, parseCsvCompanion, resolveImportedRelationIds, type CsvCompanionKind } from './csv'
import { isComputedProperty } from './derived'
import { addProperty, createOption, renameProperty } from './schemaOps'
import { convertPlannedCell, inferColumn, replanColumn, uniqueHeaders, type ColumnPlan, type CsvColumnType } from './csvInfer'
import { CsvImportPreview, type CsvPreviewColumn } from './CsvImportPreview'
import { PageIcon } from '../page/PageIcon'
import { createRowOfType, objectTypes } from '../../objecttypes/actions'
import { askRowTemplate, rowTemplateHasQuestions } from '../../templates/apply'
import { typesAsTemplates } from '../../objecttypes/adjust'
import { sidebarTypes } from '../../objecttypes/visibility'
import { Icon, formatGlyphIcon } from '../ui/icons'
import { getLocale, t } from '../../i18n'
import { groupableProperty, groupsFor, groupValue, type ViewGroup } from './grouping'
import { appendFilterRule } from './filterTree'
import { ViewSettingsPanel } from './settings/ViewSettingsPanel'
import { ViewTabMenu } from './settings/ViewTabMenu'
import type { SettingsScreen } from './settings/model'
import { viewBodyClasses } from './settings/model'
import { useRowSelection } from './rowSelection'
import { BulkBar } from './BulkBar'
import { projectMultiSource } from './multiSource'
import { flushDoc } from '../page/util'
import { assertCanClose } from '../../close-guards'
import { DatabaseDescription } from './DatabaseDescription'
import { EmptyState } from '../ui/illustrations/Illustration'
import { Button } from '../ui/Button'
import { AddViewPanel, LinkedBadge, LinkedTitle, MissingSource, linkedSourceOf } from './LinkedViewChrome'
import { LINKED_SCHEMA_NOTICE_KEY, linkedTipSeen, markLinkedTipSeen } from './linkedSource'
import './dbview.css'
import './settings/viewEffects.css'

const VIEW_COMPONENTS: Record<ViewType, (p: ViewProps) => React.ReactNode> = {
  table: TableView,
  board: BoardView,
  calendar: CalendarView,
  list: ListView,
  gallery: GalleryView,
  timeline: TimelineView,
  chart: ChartView,
  dashboard: DashboardView,
  map: MapView,
  feed: FeedView,
  form: FormView,
}

// Ícones de linha oferecidos a um banco (formato `lucide:<nome>`; ver docs/DEVELOPMENT.md).
const DB_ICONS = ['clipboard-list', 'folder', 'chart-line', 'calendar-days', 'circle-check', 'map-pin', 'target', 'lightbulb', 'book-open', 'puzzle', 'rocket', 'star', 'notebook-pen', 'tag', 'briefcase', 'shopping-cart', 'clapperboard', 'music', 'sprout', 'bookmark', 'flask-conical', 'home', 'plane', 'wallet']

export function DatabaseView({ pageId, embedded, fixedViewId, relationFilter }: { pageId: string; embedded?: boolean; fixedViewId?: string; relationFilter?: { propertyId: string; rowId: string } }) {
  useStore()
  const db = selectors.page(pageId)
  const sourceIds = db?.database?.sourceDatabaseIds ?? []
  const sources = [...(sourceIds.length && db?.database?.properties.length ? [{ id: db.id, name: db.title, schema: db.database }] : []), ...sourceIds.flatMap((id) => { const linked = selectors.page(id), actualId = linked?.database?.linkedSourceId ?? id, source = selectors.page(actualId), sourceSchema = selectors.database(actualId); return source && sourceSchema ? [{ id: actualId, name: source.title, schema: sourceSchema }] : [] })]
  const rawRows = db ? selectors.rows(pageId) : []
  const projection = sources.length ? projectMultiSource(sources, rawRows) : undefined
  const baseSchema = db ? selectors.database(pageId) : undefined
  const schema = baseSchema && projection ? { ...baseSchema, properties: projection.properties } : baseSchema
  const view = schema ? schema.views.find((v) => v.id === (fixedViewId ?? schema.activeViewId)) ?? schema.views[0] : undefined
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [pop, setPop] = useState<{ kind: 'filter' | 'sort' | 'addView' | 'icon' | 'newMenu'; el: DbAnchor } | null>(null)
  // Painel "Configurações da visualização" (docs/DEVELOPMENT.md), ancorado à direita da barra.
  const [settings, setSettings] = useState<SettingsScreen | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const [notice, setNotice] = useState<{ text: string; undo?: boolean } | null>(null)
  const [tabMenu, setTabMenu] = useState<{ viewId: string; el: DbAnchor } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [csvStatus, setCsvStatus] = useState('')
  const openRequest = useRef(0)
  useEffect(() => () => { openRequest.current += 1 }, [])

  const allRows = (projection?.rows ?? rawRows).filter(row => !relationFilter || Array.isArray(row.props?.[relationFilter.propertyId]) && (row.props[relationFilter.propertyId] as string[]).includes(relationFilter.rowId))
  const q = normalizeSearch(search.trim())
  const viewRows = schema && view ? applyView(allRows, schema, view) : []
  const rows = q ? viewRows.filter((r) => normalizeSearch(r.title).includes(q) || (schema && view && visibleProperties(schema, view).some((prop) => normalizeSearch(valueToText(getValue(r, prop), prop)).includes(q)))) : viewRows

  // Seleção de linhas por id, na ordem exibida (grupos e subgrupos em sequência); inclui linhas
  // além do "Carregar mais" e fora da tela, sem renderizá-las.
  const selectionOrder = useMemo(() => {
    if (!schema || !view) return [] as string[]
    const groupedType = ['table', 'list', 'gallery', 'feed'].includes(view.type)
    const primary = groupedType ? groupableProperty(schema, view.groupBy) : undefined
    if (!primary) return rows.map((row) => row.id)
    const secondary = groupableProperty(schema, view.subgroupBy)
    const pages = getState().pages
    // Linhas em vários grupos (multisseleção/relação/pessoa) aparecem uma vez só na ordem de seleção.
    return [...new Set(groupsFor(rows, primary, view, '', pages).flatMap((group) => secondary ? groupsFor(group.rows, secondary, view, '', pages).flatMap((child) => child.rows) : group.rows).map((row) => row.id))]
  }, [rows, schema, view])
  const selection = useRowSelection(selectionOrder)
  const loadLimit = view?.loadLimit ?? 0
  const limitable = !!view && ['table', 'list', 'gallery', 'board', 'feed'].includes(view.type)
  const [loadedPages, setLoadedPages] = useState(1)
  const loadKey = `${view?.id}|${loadLimit}|${q}|${JSON.stringify(view?.filters)}|${JSON.stringify(view?.sorts)}`
  useEffect(() => { setLoadedPages(1) }, [loadKey])
  const shownRows = limitable && loadLimit > 0 ? rows.slice(0, loadLimit * loadedPages) : rows
  const hiddenRowCount = rows.length - shownRows.length

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  // "N" cria uma nova linha (dica do estado vazio); só no banco aberto em tela cheia e fora de campos de texto.
  const newRowRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.ProseMirror, .bn-editor, [role="dialog"], [role="menu"]'))) return
      e.preventDefault(); newRowRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [embedded])

  // ⌘Z / ⌘⇧Z desfazem e refazem ações de banco (célula, linha, propriedade) quando o foco não está num campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.ProseMirror, .bn-editor, [role="dialog"]'))) return
      if (e.shiftKey ? actions.redoDatabase() : actions.undoDatabase()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Visão vinculada: a primeira edição de propriedade avisa que ela é compartilhada com a fonte (com Desfazer).
  const linkedId = db?.database?.linkedSourceId
  useEffect(() => {
    if (!linkedId) return
    return actions.onLinkedSchemaEdit((event) => {
      if (event.dbId !== pageId || linkedTipSeen(LINKED_SCHEMA_NOTICE_KEY)) return
      markLinkedTipSeen(LINKED_SCHEMA_NOTICE_KEY)
      const name = selectors.page(event.sourceId)?.title || t('Sem título', 'Untitled')
      setNotice({ text: t('Alterado também em “{name}”: as propriedades são compartilhadas com a fonte e com as outras visualizações dela.', 'Also changed in “{name}”: properties are shared with the source and its other views.', { name }), undo: true })
    })
  }, [linkedId, pageId])

  if (!db || !schema || !view) return null
  const readOnly = db.locked
  const linkedSource = linkedSourceOf(db.id)
  // Visão vinculada edita as propriedades da fonte (compartilhadas); só bloqueia se a fonte estiver bloqueada.
  const sourceLocked = !!linkedSource && (!linkedSource.live || !!selectors.page(linkedSource.id)?.locked)
  const schemaLocked = readOnly || sourceLocked || !!sourceIds.length
  const dataReadOnly = sourceIds.length > 0
  const visibleProps = visibleProperties(schema, view)
  const showBar = view.filters.length > 0 || view.sorts.length > 0
  const Comp = VIEW_COMPONENTS[view.type] ?? TableView
  const primaryGroup = ['table', 'list', 'gallery', 'feed'].includes(view.type) ? groupableProperty(schema, view.groupBy) : undefined
  const secondaryGroup = primaryGroup ? groupableProperty(schema, view.subgroupBy) : undefined
  const close = () => setPop(null)
  const openSettingsFor = (screen: SettingsScreen) => { setPop(null); setSettings(screen) }
  const showTitle = view.showSourceTitle !== false
  const selectedRows = selection.size ? allRows.filter((row) => selection.has(row.id)) : []

  const creationDefaults = relationFilter ? { [relationFilter.propertyId]: [relationFilter.rowId] } : {}
  const openRow = (id: string) => {
    const request = ++openRequest.current
    const mode = view.openPagesIn ?? (['calendar', 'gallery'].includes(view.type) ? 'center' : 'side')
    void (async () => {
      const current = getState().peekPageId
      if (current && (current !== id || mode === 'full')) { await flushDoc(current); await actions.flushMeta() }
      assertCanClose()
      if (request !== openRequest.current) return
      if (mode === 'full') actions.openPage(id)
      else actions.openPeek(id, mode, [...new Set([...rows.map(row => row.id), id])])
    })().catch(actions.reportSaveError)
  }
  // Modelo de linha com {{pergunta:…}}: pergunta antes de criar (cancelar não cria nada). Sem perguntas, cria na hora.
  const newRow = (templateId?: string) => {
    if (dataReadOnly) return
    const make = (answers?: Record<string, string>) => openRow(actions.createRow(db.id, defaultsForNewRow(schema, view, {}, creationDefaults), {}, templateId, answers))
    if (!rowTemplateHasQuestions(db.id, templateId)) { make(); return }
    void askRowTemplate(db.id, templateId).then(answers => { if (answers !== null) make(answers) }).catch(actions.reportSaveError)
  }
  newRowRef.current = newRow
  const newRowInGroup = (primary: ViewGroup, secondary?: ViewGroup) => {
    if (dataReadOnly) return
    const initial = { ...defaultsFromFilters(schema, view), [primaryGroup!.id]: groupValue(primaryGroup!, primary.option?.id ?? null, primary.option?.name), ...(secondaryGroup && secondary ? { [secondaryGroup.id]: groupValue(secondaryGroup, secondary.option?.id ?? null, secondary.option?.name) } : {}) }
    openRow(actions.createRow(db.id, defaultsForNewRow(schema, view, initial, creationDefaults)))
  }
  const renderGroup = (group: ViewGroup, parent?: ViewGroup) => <section key={group.key} className={`dbv-group-section${parent ? ' dbv-subgroup' : ''}`}>
    <header><span>{group.label}</span><small>{group.rows.length}</small>{!dataReadOnly && <button type="button" onClick={() => parent ? newRowInGroup(parent, group) : newRowInGroup(group)} aria-label={t('Nova linha em {group}', 'New row in {group}', { group: group.label })}><Plus size={14} /></button>}</header>
    {secondaryGroup && !parent ? groupsFor(group.rows, secondaryGroup, view, t('Sem {name}', 'No {name}', { name: secondaryGroup.name }), getState().pages).map((child) => renderGroup(child, group)) : <Comp db={db} schema={schema} view={view} rows={group.rows} selection={selection} onOpenSettings={openSettingsFor} creationDefaults={{ ...creationDefaults, [primaryGroup!.id]: groupValue(primaryGroup!, (parent ?? group).option?.id ?? null, (parent ?? group).option?.name), ...(parent && secondaryGroup ? { [secondaryGroup.id]: groupValue(secondaryGroup, group.option?.id ?? null, group.option?.name) } : {}) }} visibleProps={visibleProps} readOnly={dataReadOnly} schemaLocked={schemaLocked} onOpenRow={openRow} />}
  </section>

  const createLinkedView = () => {
    const sourceId = db.database?.linkedSourceId ?? db.id
    const linkedView: View = { ...structuredClone(view), id: crypto.randomUUID(), name: view.name }
    const id = actions.createPage(db.parentId, {
      title: t('Visualização de {name}', 'View of {name}', { name: selectors.page(sourceId)?.title || db.title }),
      database: { properties: [], views: [linkedView], activeViewId: linkedView.id, linkedSourceId: sourceId },
    })
    actions.openPage(id)
  }

  const yieldUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  type CsvMapping = { kind: 'property'; id: string } | { kind: 'rowId' } | { kind: 'companion'; id: string; companionKind: CsvCompanionKind }
    | { kind: 'new'; plan: ColumnPlan } | { kind: 'title' }
  const [csvPreview, setCsvPreview] = useState<{ fileName: string; parsed: string[][]; columns: CsvPreviewColumn[]; mappings: (CsvMapping | null)[]; skipped: string[]; busy: boolean } | null>(null)

  /** Lê o CSV, descobre o destino de cada coluna e infere o tipo das colunas novas; nada é criado ainda. */
  const importFile = async (file: File) => {
    try {
      if (file.size > 50_000_000) throw new Error(t('Arquivo maior que 50 MB', 'File exceeds 50 MB'))
      setCsvStatus(t('Lendo CSV…', 'Reading CSV…'))
      await yieldUi()
      const parsed = parseCsv(await file.text())
      if (parsed.length < 2 || parsed[0].every((header) => !header.trim())) throw new Error(t('CSV sem cabeçalho e linhas', 'CSV needs a header and rows'))
      if (parsed.length > 10_001) throw new Error(t('Máximo de 10.000 linhas por importação', 'Maximum 10,000 rows per import'))
      const columns = parsed[0].map((header) => header.trim())
      const names = uniqueHeaders(columns, t('Coluna', 'Column'))
      const skipped = new Set<string>()
      const mappedPropertyIds = new Set<string>()
      const properties = selectors.database(db.id)?.properties ?? []
      const hasTitle = columns.some((header) => { const existing = properties.find((p) => p.name.toLowerCase() === header.toLowerCase()); return !!header && existing?.type === 'title' })
      const locale = getLocale()
      const rowsOnly = parsed.slice(1)
      const mappings: (CsvMapping | null)[] = []
      const preview: CsvPreviewColumn[] = []
      for (let index = 0; index < columns.length; index++) {
        const header = columns[index]
        const push = (mapping: CsvMapping | null, role: CsvPreviewColumn['role'], plan?: ColumnPlan) => { mappings.push(mapping); preview.push({ index, header: header || names[index], role, plan }) }
        if (!header) { push(null, 'meta'); continue }
        // Uma propriedade real pode ter nome __workspace_*; a primeira coluna com
        // esse nome pertence aos dados, e só a repetição é metadado do exportador.
        const existing = properties.find((p) => p.name.toLowerCase() === header.toLowerCase())
        if (existing && !mappedPropertyIds.has(existing.id)) { mappedPropertyIds.add(existing.id); push({ kind: 'property', id: existing.id }, existing.type === 'title' ? 'title' : 'existing'); continue }
        if (header === CSV_ROW_ID) { push({ kind: 'rowId' }, 'meta'); continue }
        const companion = csvCompanionKind(header)
        if (companion) {
          const property = properties.find((candidate) => candidate.id === companion.propertyId)
          if (!property || property.type !== companion.kind && !(companion.kind === 'rich' && property.type === 'text')) { skipped.add(header); push(null, 'meta'); continue }
          push({ kind: 'companion', id: property.id, companionKind: companion.kind }, 'meta'); continue
        }
        if (header.startsWith("__workspace_")) { skipped.add(header); push(null, 'meta'); continue }
        if (schemaLocked) { skipped.add(header); push(null, 'meta'); continue }
        if (index === 0 && !hasTitle) { push({ kind: 'title' }, 'title'); continue }
        const cells = new Array<string>(rowsOnly.length)
        for (let r = 0; r < rowsOnly.length; r++) cells[r] = rowsOnly[r][index] ?? ''
        const plan = inferColumn(index, names[index], cells, locale)
        push({ kind: 'new', plan }, 'new', plan)
        if (index % 4 === 3) await yieldUi()
      }
      // Os cabeçalhos de companheiros e a coluna de título do próprio banco também viram "título" na prévia.
      setCsvStatus('')
      setCsvPreview({ fileName: file.name, parsed, columns: preview, mappings, skipped: [...skipped], busy: false })
    } catch (error) { setCsvStatus(error instanceof Error ? error.message : t('Falha ao importar CSV', 'Could not import CSV')) }
  }

  const changeCsvType = (index: number, type: CsvColumnType) => setCsvPreview((current) => {
    if (!current) return current
    const column = current.columns.find((c) => c.index === index)
    if (!column?.plan) return current
    const cells = current.parsed.slice(1).map((row) => row[index] ?? '')
    const plan = replanColumn(column.plan, type, cells, getLocale())
    return { ...current, columns: current.columns.map((c) => c.index === index ? { ...c, plan } : c), mappings: current.mappings.map((m, i) => i === index ? { kind: 'new', plan } : m) }
  })

  /** Cria as propriedades novas e as linhas, em fatias para não travar a interface. */
  const runImport = async (preview: NonNullable<typeof csvPreview>) => {
    const { parsed } = preview
    const skipped = new Set(preview.skipped)
    setCsvPreview({ ...preview, busy: true })
    try {
      const columns = parsed[0].map((header) => header.trim())
      type Planned = { kind: 'planned'; id: string; plan: ColumnPlan; options: Map<string, string> }
      const mapped: (Exclude<CsvMapping, { kind: 'new' }> | Planned | null)[] = []
      for (const mapping of preview.mappings) {
        if (!mapping || mapping.kind !== 'new') { mapped.push(mapping); continue }
        const { plan } = mapping
        if (plan.type === 'ignore') { mapped.push(null); continue }
        const id = addProperty(db.id, plan.type)
        renameProperty(db.id, id, plan.header)
        if (plan.type === 'number' && plan.numberFormat && plan.numberFormat !== 'number') {
          actions.updateSchema(db.id, (s) => ({ ...s, properties: s.properties.map((p) => p.id === id ? { ...p, numberFormat: plan.numberFormat, ...(plan.currency ? { currency: plan.currency } : {}) } : p) }))
        }
        const options = new Map<string, string>()
        if (plan.type === 'select' || plan.type === 'multiSelect') {
          const distinct = new Set<string>()
          for (let r = 1; r < parsed.length && distinct.size <= 200; r++) {
            const cell = parsed[r][plan.index] ?? ''
            for (const part of plan.type === 'multiSelect' ? cell.split(plan.multiSeparator ?? ',') : [cell]) if (part.trim()) distinct.add(part.trim())
          }
          if (distinct.size > 200) skipped.add(`${plan.header}: >200`)
          for (const name of [...distinct].slice(0, 200)) { const option = createOption(db.id, id, name); if (option) options.set(name, option.id) }
        }
        mapped.push({ kind: 'planned', id, plan, options })
      }
      // Valida metadados antes de criar linhas, para que anexos/datas inválidos
      // não resultem numa importação parcial ou numa perda silenciosa.
      for (const cells of parsed.slice(1)) cells.forEach((cell, index) => {
        const entry = mapped[index]
        if (!cell || entry?.kind !== 'companion') return
        if (parseCsvCompanion(entry.companionKind, cell) === null) throw new Error(t('Metadado CSV inválido na coluna {column}', 'Invalid CSV metadata in column {column}', { column: columns[index] }))
      })
      const hasTitle = mapped.some((entry) => entry?.kind === 'property' && selectors.database(db.id)?.properties.some((p) => p.id === entry.id && p.type === 'title'))
      const titleColumn = mapped.findIndex((entry) => entry?.kind === 'title')
      const importedIds = new Map<string, string>()
      const pendingRelations: { rowId: string; propertyId: string; ids: string[] }[] = []
      let count = 0, badValues = 0
      const total = parsed.length - 1
      for (const cells of parsed.slice(1)) {
        if (cells.every((cell) => !cell.trim())) continue
        const current = selectors.database(db.id)
        if (!current) break
        const props: Record<string, import('../../types').PropValue> = {}
        let title = hasTitle ? '' : String(fromCsvCell(cells[titleColumn >= 0 ? titleColumn : 0] ?? '', { id: 'title', name: t('Título', 'Title'), type: 'title' }) ?? '')
        let oldId = ''
        const relations: { propertyId: string; ids: string[] }[] = []
        cells.forEach((cell, index) => {
          const entry = mapped[index]
          if (entry?.kind === 'rowId') { oldId = cell; return }
          if (entry?.kind === 'planned') {
            const { plan, options } = entry
            if (plan.type === 'select') props[entry.id] = cell.trim() ? options.get(cell.trim()) ?? null : null
            else if (plan.type === 'multiSelect') props[entry.id] = cell.split(plan.multiSeparator ?? ',').map((part) => options.get(part.trim())).filter((id): id is string => !!id)
            else if (plan.type !== 'text') { const result = convertPlannedCell(plan, cell); if (!result.ok) badValues++; props[entry.id] = result.value }
            else props[entry.id] = cell.trim() ? cell : null
            return
          }
          if (entry?.kind === 'companion') {
            const parsedValue = parseCsvCompanion(entry.companionKind, cell)
            if (entry.companionKind === 'relation') { if (Array.isArray(parsedValue)) relations.push({ propertyId: entry.id, ids: parsedValue as string[] }); return }
            if (parsedValue !== null) props[entry.id] = parsedValue
            return
          }
          if (entry?.kind !== 'property') return
          const prop = current.properties.find((p) => p.id === entry.id)
          if (!prop) return
          if (isComputedProperty(prop) || prop.type === 'relation') { skipped.add(prop.name); return }
          if (prop.type === 'title') { title = String(fromCsvCell(cell, prop) ?? ''); return }
          if ((prop.type === 'select' || prop.type === 'status') && cell.trim() && !prop.options?.some((o) => o.name === cell.trim())) {
            if (schemaLocked) skipped.add(`${prop.name}: ${cell.trim()}`)
            else createOption(db.id, prop.id, cell.trim())
          }
          if (prop.type === 'multiSelect') for (const name of cell.split(',').map((part) => part.trim()).filter(Boolean)) {
            const latest = selectors.database(db.id)?.properties.find((p) => p.id === prop.id)
            if (!latest?.options?.some((option) => option.name === name)) {
              if (schemaLocked) skipped.add(`${prop.name}: ${name}`)
              else createOption(db.id, prop.id, name)
            }
          }
          const fresh = selectors.database(db.id)?.properties.find((p) => p.id === prop.id) ?? prop
          props[prop.id] = fromCsvCell(cell, fresh)
        })
        const createdId = actions.createRow(db.id, defaultsForNewRow(schema, view, props, creationDefaults), { title })
        if (oldId) importedIds.set(oldId, createdId)
        for (const relation of relations) pendingRelations.push({ rowId: createdId, propertyId: relation.propertyId, ids: relation.ids })
        count++
        if (count % 100 === 0) { setCsvStatus(`${t('Importando…', 'Importing…')} ${count}/${total}`); await yieldUi() }
      }
      for (const relation of pendingRelations) {
        const property = selectors.database(db.id)?.properties.find((item) => item.id === relation.propertyId)
        if (!property?.relationDatabaseId) continue
        actions.setProp(relation.rowId, relation.propertyId, defaultsForNewRow(schema, view, { [relation.propertyId]: resolveImportedRelationIds(relation.ids, importedIds, getState().pages, property.relationDatabaseId) }, creationDefaults)[relation.propertyId])
      }
      await actions.flushMeta()
      setCsvPreview(null)
      setCsvStatus(`${count} ${count === 1 ? t('linha importada', 'row imported') : t('linhas importadas', 'rows imported')}${badValues ? ` · ${badValues} ${t('valores fora do tipo ficaram vazios', 'values outside their type were left empty')}` : ''}${skipped.size ? ` · ${t('colunas/valores não importados', 'columns/values skipped')}: ${[...skipped].join(', ')}` : ''}`)
    } catch (error) { setCsvPreview(null); setCsvStatus(error instanceof Error ? error.message : t('Falha ao importar CSV', 'Could not import CSV')) }
  }

  /** Reordena as abas: `after` coloca a aba depois do alvo. ⌘Z restaura a ordem. */
  const moveView = (id: string, targetId: string, after: boolean) => {
    if (id === targetId) return
    actions.trackDbUndo(t('Reordenar visualizações', 'Reorder views'), db.id, () => actions.updateSchema(db.id, (s) => {
      const from = s.views.find((x) => x.id === id)
      if (!from || !s.views.some((x) => x.id === targetId)) return s
      const rest = s.views.filter((x) => x.id !== id)
      rest.splice(rest.findIndex((x) => x.id === targetId) + (after ? 1 : 0), 0, from)
      return { ...s, views: rest }
    }))
  }

  const duplicateView = (v: View) => {
    const copy: View = { ...structuredClone(v), id: crypto.randomUUID(), name: `${v.name} (${t('cópia', 'copy')})` }
    actions.trackDbUndo(t('Duplicar visualização', 'Duplicate view'), db.id, () => actions.updateSchema(db.id, (s) => {
      const views = [...s.views]
      views.splice(views.findIndex((x) => x.id === v.id) + 1, 0, copy)
      return { ...s, views, activeViewId: copy.id }
    }))
  }

  const deleteView = (v: View) => {
    actions.trackDbUndo(t('Excluir visualização', 'Delete view'), db.id, () => actions.updateSchema(db.id, (s) => {
      if (s.views.length <= 1) return s
      const i = s.views.findIndex((x) => x.id === v.id)
      const views = s.views.filter((x) => x.id !== v.id)
      const activeViewId = s.activeViewId === v.id ? views[Math.max(0, i - 1)].id : s.activeViewId
      return { ...s, views, activeViewId }
    }))
  }

  const tabView = tabMenu ? schema.views.find((v) => v.id === tabMenu.viewId) : undefined

  return (
    <div className={`dbv${embedded ? ' dbv--embedded' : ''}`} data-page-id={pageId}>
      {!embedded && showTitle && (
        <header className="dbv-header">
          <div className="dbv-icon-row">
            {db.icon ? (
              <button
                type="button"
                className="dbv-page-icon"
                disabled={readOnly}
                title={t('Trocar ícone', 'Change icon')}
                onClick={(e) => setPop({ kind: 'icon', el: e.currentTarget })}
              >
                <PageIcon value={db.icon} />
              </button>
            ) : (
              !readOnly && (
                <button type="button" className="dbv-add-icon" onClick={(e) => setPop({ kind: 'icon', el: e.currentTarget })}>
                  <SmilePlus size={14} />
                  <span>{t('Adicionar ícone', 'Add icon')}</span>
                </button>
              )
            )}
          </div>
          {linkedSource && <div className="lvc-full-source"><Icon name="arrow-up-right" size={16} /><LinkedBadge dbId={db.id} readOnly={readOnly} /></div>}
          <input
            className="dbv-title"
            value={db.title}
            placeholder={linkedSource ? linkedSource.title : t('Novo banco de dados', 'New database')}
            title={linkedSource ? t('Este nome é só desta visualização; a fonte continua “{name}”.', 'This name belongs to this view only; the source stays “{name}”.', { name: linkedSource.title }) : undefined}
            readOnly={readOnly}
            spellCheck={false}
            aria-label={t('Título do banco de dados', 'Database title')}
            onChange={(e) => actions.updatePage(db.id, { title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </header>
      )}
      {!embedded && schema.bodyDescription && <DatabaseDescription pageId={pageId} />}
      {embedded && showTitle && linkedSource && <LinkedTitle dbId={db.id} readOnly={readOnly} />}
      {embedded && !showTitle && linkedSource && <div className="lvc-title-row"><LinkedBadge dbId={db.id} readOnly={readOnly} /></div>}
      {embedded && showTitle && !linkedSource && (
        <button type="button" className="dbv-embedded-title" onClick={() => actions.openPage(db.id)}>
          {db.icon && <PageIcon value={db.icon} />}
          <span className={db.title ? '' : 'dbv-muted'}>{db.title || t('Novo banco de dados', 'New database')}</span>
        </button>
      )}

      {/* Barra flutuante da seleção de linhas: acima das abas, acompanha a rolagem (sticky). */}
      <div className="dbv-bulk-dock">
        {selectedRows.length > 0 && <BulkBar dbId={db.id} title={db.title} schema={schema} rows={selectedRows} readOnly={readOnly || dataReadOnly} onClear={selection.clear} onDone={(text, undo) => setNotice({ text, undo })} />}
      </div>
      {/* Abas + barra de ferramentas */}
      <div className="dbv-bar">
        <ViewTabs
          views={schema.views.filter(v => !fixedViewId || v.id === view.id)}
          activeId={view.id}
          canAdd={!readOnly && !fixedViewId}
          onActivate={(id) => actions.activateView(db.id, id)}
          onMenu={(id, el) => { if (!readOnly) setTabMenu({ viewId: id, el }) }}
          onAdd={(el) => setPop({ kind: 'addView', el })}
          onReorder={readOnly || fixedViewId ? undefined : moveView}
        />

        <div className="dbv-tools" ref={toolsRef}>
          {(q || view.filters.length > 0) && (
            <span className="dbv-count" role="status" data-testid="view-result-count" title={t('Linhas que passam pelo filtro e pela busca, do total do banco', 'Rows passing the filter and search, out of the database total')}>
              {t('{n} de {total}', '{n} of {total}', { n: rows.length, total: allRows.length })}
            </span>
          )}
          <button
            type="button"
            className={`dbv-icon-btn dbv-tool-icon${view.filters.length ? ' dbv-tool--on' : ''}`}
            disabled={readOnly}
            aria-label={t('Filtrar', 'Filter')}
            title={t('Filtrar', 'Filter')}
            onClick={(e) => setPop({ kind: 'filter', el: e.currentTarget })}
          >
            <Icon name="filter" size={16} />
          </button>
          <button
            type="button"
            className={`dbv-icon-btn dbv-tool-icon${view.sorts.length ? ' dbv-tool--on' : ''}`}
            disabled={readOnly}
            aria-label={t('Ordenar', 'Sort')}
            title={t('Ordenar', 'Sort')}
            onClick={(e) => setPop({ kind: 'sort', el: e.currentTarget })}
          >
            <Icon name="sort" size={16} />
          </button>
          <div className={`dbv-search${searchOpen ? ' dbv-search--open' : ''}`}>
            <button
              type="button"
              className="dbv-icon-btn dbv-tool-icon"
              aria-label={t('Buscar', 'Search')}
              title={t('Buscar nesta visualização', 'Search in this view')}
              onClick={() => (searchOpen && !search ? setSearchOpen(false) : setSearchOpen(true))}
            >
              <Search size={16} />
            </button>
            {searchOpen && (
              <>
                <input
                  ref={searchRef}
                  className="dbv-search-input"
                  placeholder={t('Digite para buscar…', 'Type to search…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => !search && setSearchOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearch('')
                      setSearchOpen(false)
                    }
                  }}
                />
                {search && (
                  <button type="button" className="dbv-icon-btn dbv-search-clear" aria-label={t('Limpar busca', 'Clear search')} onClick={() => setSearch('')}>
                    <X size={12} />
                  </button>
                )}
              </>
            )}
          </div>
          {/* ⚡ só porque existem automações locais equivalentes (abre o painel nessa tela). */}
          {!db.database?.linkedSourceId && (
            <button
              type="button"
              className={`dbv-icon-btn dbv-tool-icon${schema.automations?.some((a) => a.enabled) ? ' dbv-tool--on' : ''}`}
              disabled={readOnly}
              aria-label={t('Automações', 'Automations')}
              title={t('Automações', 'Automations')}
              onClick={() => openSettingsFor('automations')}
            >
              <Icon name="automation" size={16} />
            </button>
          )}
          {(embedded || getState().peekPageId === db.id) && (
            <button
              type="button"
              className="dbv-icon-btn dbv-tool-icon"
              aria-label={t('Abrir como página inteira', 'Open as full page')}
              title={t('Abrir como página inteira', 'Open as full page')}
              onClick={() => actions.openPage(db.id, { viewId: view.id })}
            >
              <Icon name="expand" size={16} />
            </button>
          )}
          {/* Configurações da visualização (substitui o antigo ⋯): layout, propriedades, filtros, fonte… */}
          <button
            type="button"
            className={`dbv-icon-btn dbv-tool-icon${settings ? ' dbv-tool--open' : ''}`}
            aria-label={t('Configurações da visualização', 'View settings')}
            title={t('Configurações da visualização', 'View settings')}
            ref={settingsBtnRef}
            aria-haspopup="dialog"
            aria-expanded={!!settings}
            onClick={() => setSettings(settings ? null : 'main')}
          >
            <Icon name="view-settings" size={16} />
          </button>
          {!dataReadOnly && <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />}
          {!dataReadOnly && (
            <div className="dbv-new">
              <button type="button" className="dbv-new-main" title={t('Nova linha (N)', 'New row (N)')} onClick={() => newRow()}>{t('Novo', 'New')}</button>
              <button
                type="button"
                className="dbv-new-more"
                aria-label={t('Mais opções de nova página', 'More new page options')}
                title={t('Modelos', 'Templates')}
                onClick={(e) => setPop({ kind: 'newMenu', el: e.currentTarget })}
              >
                <ChevronDown size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {projection && <div className="dbv-linked-source"><Link2 size={14} /> {t('Fontes locais:', 'Local sources:')} {sources.map((source) => <button type="button" key={source.id} onClick={() => actions.openPage(source.id)}>{source.name || t('Banco de dados', 'Database')}</button>)}<span>{t('União por nome e tipo; edite a linha na fonte. Relações e fórmulas heterogêneas não são unidas.', 'Union by name and type; edit rows at their source. Mixed formulas and relations are excluded.')}</span></div>}

      {showBar && (
        <FilterBar dbId={db.id} schema={schema} view={view} readOnly={readOnly} onOpenSort={(el) => setPop({ kind: 'sort', el })} />
      )}
      {csvPreview && <CsvImportPreview fileName={csvPreview.fileName} rowCount={csvPreview.parsed.length - 1} columns={csvPreview.columns} sample={csvPreview.parsed.slice(1, 6)} busy={csvPreview.busy} onType={changeCsvType} onConfirm={() => void runImport(csvPreview)} onCancel={() => setCsvPreview(null)} />}
      {notice && <div className="dbv-csv-status" role="status">{notice.text}{notice.undo && <button type="button" className="dbv-notice-undo" onClick={() => { actions.undoDatabase(); setNotice(null) }}>{t('Desfazer', 'Undo')}</button>}<button type="button" aria-label={t('Fechar mensagem', 'Dismiss message')} onClick={() => setNotice(null)}><X size={14} /></button></div>}
      {csvStatus && <div className="dbv-csv-status" role="status">{csvStatus}<button type="button" aria-label={t('Fechar mensagem', 'Dismiss message')} onClick={() => setCsvStatus('')}><X size={14} /></button></div>}

      {linkedSource && !linkedSource.live ? <MissingSource dbId={db.id} readOnly={readOnly} /> : <>
      <div className={`dbv-body ${viewBodyClasses(view)}`} onKeyDown={(e) => {
        // Lista/galeria: Esc limpa a seleção e ⌘A seleciona tudo (a tabela trata os seus).
        if (e.defaultPrevented || view.type === 'table') return
        const target = e.target as HTMLElement
        if (target.isContentEditable || /^(TEXTAREA|SELECT)$/.test(target.tagName) || target.tagName === 'INPUT' && !target.classList.contains('vw-select')) return
        if (e.key === 'Escape' && selection.size) { e.stopPropagation(); selection.clear() }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && (view.type === 'list' || view.type === 'gallery') && !dataReadOnly) { e.preventDefault(); selection.selectAll() }
      }}>
        {primaryGroup ? groupsFor(shownRows, primaryGroup, view, t('Sem {name}', 'No {name}', { name: primaryGroup.name }), getState().pages).map((group) => renderGroup(group)) : <Comp db={db} schema={schema} view={view} rows={shownRows} selection={selection} onOpenSettings={openSettingsFor} creationDefaults={creationDefaults} visibleProps={visibleProps} readOnly={dataReadOnly} schemaLocked={schemaLocked} onOpenRow={openRow} />}
      </div>

      {allRows.length === 0 && !dataReadOnly && <EmptyState className="dbv-empty-hint" illustration="pages" size={72} title={t('Nenhuma linha ainda', 'No rows yet')} action={<Button variant="primary" onClick={() => newRow()}>{t('Nova linha', 'New row')} <kbd>N</kbd></Button>}>{t('Cada linha é uma página com as propriedades deste banco.', 'Each row is a page with this database’s properties.')}</EmptyState>}
      {hiddenRowCount > 0 && <div className="dbv-load-more"><button type="button" onClick={() => setLoadedPages((n) => n + 1)}>{t('Carregar mais {n}', 'Load {n} more', { n: Math.min(loadLimit, hiddenRowCount) })}</button><span>{t('{shown} de {total}', '{shown} of {total}', { shown: shownRows.length, total: rows.length })}</span></div>}
      </>}

      {/* Sem contador de linhas sob quadro/calendário/galeria etc.: o Export Bundle não mostra. */}

      {/* Popovers */}
      {pop?.kind === 'filter' && (
        <PropertyPicker
          schema={schema}
          anchor={pop.el}
          title={t('Filtrar por…', 'Filter by…')}
          onClose={close}
          onPick={(p) => {
            const f = newFilterFor(p)
            actions.updateView(db.id, view.id, { filters: [...view.filters, f], ...(view.filterTree ? { filterTree: appendFilterRule(view.filterTree, view.filters.map((filter) => filter.id), f.id) } : {}) })
            close()
            setTimeout(() => dbEvents.emit('openFilter', { dbId: db.id, filterId: f.id }), 0)
          }}
        />
      )}
      {pop?.kind === 'sort' && <SortPopover dbId={db.id} schema={schema} view={view} anchor={pop.el} onClose={close} />}
      {pop?.kind === 'newMenu' && (
        <DbPopover anchor={pop.el} onClose={close} placement="bottom-end" label={t('Nova página', 'New page')}>
          <Menu width={240}>
            <MenuItem icon={<Icon name="page" size={16} />} label={t('Nova página', 'New page')} onClick={() => { close(); newRow() }} />
            {!!schema.templates?.length && <MenuLabel>{t('Modelos', 'Templates')}</MenuLabel>}
            {schema.templates?.map((template) => (
              <MenuItem
                key={template.id}
                icon={<PageIcon value={template.icon} fallback="page" style={{ width: 16, height: 16 }} />}
                label={template.name || template.title || t('Sem título', 'Untitled')}
                hint={schema.defaultTemplateId === template.id ? t('Padrão', 'Default') : undefined}
                onClick={() => { close(); newRow(template.id) }}
              />
            ))}
            {!dataReadOnly && (() => {
              const typeEntries = typesAsTemplates(sidebarTypes(getState().pages, objectTypes()), schema.templates?.map((template) => template.name || template.title) ?? [])
              return typeEntries.length > 0 && <>
                <MenuLabel>{t('Tipos', 'Types')}</MenuLabel>
                {typeEntries.map(({ type }) => <MenuItem key={type.id} icon={<PageIcon value={type.icon} fallback="page" style={{ width: 16, height: 16 }} />} label={t('Tipo: {name}', 'Type: {name}', { name: type.name })}
                  onClick={() => { close(); openRow(createRowOfType(db.id, type.id, defaultsForNewRow(schema, view, {}, creationDefaults))) }} />)}
              </>
            })()}
            {!readOnly && !db.database?.linkedSourceId && <><MenuSep /><MenuItem icon={<Icon name="template" size={16} />} label={t('Gerenciar modelos…', 'Manage templates…')} onClick={() => openSettingsFor('templates')} /></>}
          </Menu>
        </DbPopover>
      )}
      {settings && toolsRef.current && (
        <ViewSettingsPanel
          key={`${view.id}:${settings}`}
          anchor={toolsRef.current}
          ignore={settingsBtnRef.current}
          initial={settings}
          onClose={() => setSettings(null)}
          ctx={{
            db, schema, view, readOnly, schemaLocked, dataReadOnly,
            rowCount: rows.length,
            canDeleteView: schema.views.length > 1,
            onImportCsv: () => importRef.current?.click(),
            onExportCsv: () => void api.exportFile(`${db.title || 'database'}.csv`, exportCsv(schema, rows, getState().pages)),
            onCreateLinked: createLinkedView,
            onDuplicateView: () => duplicateView(view),
            onDeleteView: () => deleteView(view),
            onOpenFull: embedded || getState().peekPageId === db.id ? () => actions.openPage(db.id, { viewId: view.id }) : undefined,
          }}
        />
      )}
      {pop?.kind === 'addView' && <AddViewPanel dbId={db.id} anchor={pop.el} views={schema.views} onClose={close} />}
      {pop?.kind === 'icon' && (
        <DbPopover anchor={pop.el} onClose={close} label={t('Ícone', 'Icon')}>
          <div className="dbv-emoji">
            <div className="dbv-emoji-grid">
              {DB_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="dbv-emoji-btn"
                  aria-label={name}
                  onClick={() => {
                    actions.updatePage(db.id, { icon: formatGlyphIcon(name) })
                    close()
                  }}
                >
                  <Icon name={name} size={20} />
                </button>
              ))}
            </div>
            {db.icon && (
              <>
                <MenuSep />
                <Menu>
                  <MenuItem
                    icon={<Trash2 size={16} />}
                    label={t('Remover ícone', 'Remove icon')}
                    onClick={() => {
                      actions.updatePage(db.id, { icon: null })
                      close()
                    }}
                  />
                </Menu>
              </>
            )}
          </div>
        </DbPopover>
      )}
      {tabMenu && tabView && (
        <ViewTabMenu
          key={tabView.id}
          db={db}
          view={tabView}
          anchor={tabMenu.el}
          canDelete={schema.views.length > 1}
          canOpenFull={!!embedded || getState().peekPageId === db.id}
          onOpenSettings={(screen) => { if (tabView.id !== view.id) actions.activateView(db.id, tabView.id); openSettingsFor(screen) }}
          onRename={(name) => actions.updateView(db.id, tabView.id, { name })}
          onDuplicate={() => duplicateView(tabView)}
          onDelete={() => deleteView(tabView)}
          onClose={() => setTabMenu(null)}
        />
      )}
    </div>
  )
}

const TAB_GAP = 2
const ADD_W = 30
const MORE_W = 92

/**
 * Abas das visualizações. Como no Export Bundle, as que não cabem vão para um botão "N mais ⌄"
 * (a aba ativa fica sempre visível). Larguras medidas no DOM e guardadas por visualização.
 */
function ViewTabs(props: { views: View[]; activeId: string; canAdd: boolean; onActivate: (id: string) => void; onMenu: (id: string, el: Element) => void; onAdd: (el: Element) => void; onReorder?: (id: string, targetId: string, after: boolean) => void }) {
  const { views, activeId } = props
  const [dragTab, setDragTab] = useState<string | null>(null)
  const [dropTab, setDropTab] = useState<{ id: string; after: boolean } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const widths = useRef(new Map<string, number>())
  const [avail, setAvail] = useState(0)
  const [, setMeasured] = useState(0)
  const [moreEl, setMoreEl] = useState<Element | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setAvail(el.clientWidth)
    update()
    // Sem ResizeObserver (ex.: jsdom), acompanha só o redimensionamento da janela.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const widthOf = (v: View) => widths.current.get(v.id + v.name) ?? 44 + v.name.length * 8
  let visible = views
  if (avail > 0) {
    const total = views.reduce((sum, v) => sum + widthOf(v) + TAB_GAP, 0) + (props.canAdd ? ADD_W : 0)
    if (total > avail) {
      let room = avail - MORE_W - (props.canAdd ? ADD_W : 0)
      const active = views.find((v) => v.id === activeId)
      if (active) room -= widthOf(active) + TAB_GAP
      const keep = new Set<string>(active ? [active.id] : [])
      for (const v of views) {
        if (v.id === activeId) continue
        const w = widthOf(v) + TAB_GAP
        if (w > room) break
        room -= w
        keep.add(v.id)
      }
      visible = views.filter((v) => keep.has(v.id))
    }
  }
  const hidden = views.filter((v) => !visible.includes(v))

  // Mede as abas renderizadas; se alguma largura mudou, recalcula.
  useLayoutEffect(() => {
    let changed = false
    ref.current?.querySelectorAll<HTMLElement>('[data-view-tab]').forEach((el) => {
      const key = el.dataset.viewTab!
      if (widths.current.get(key) !== el.offsetWidth) { widths.current.set(key, el.offsetWidth); changed = true }
    })
    if (changed) setMeasured((n) => n + 1)
  })

  return (
    <div className="dbv-tabs" role="tablist" ref={ref}>
      {visible.map((v) => {
        const active = v.id === activeId
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            data-view-tab={v.id + v.name}
            aria-selected={active}
            className={`dbv-tab${active ? ' dbv-tab--active' : ''}${dragTab === v.id ? ' dbv-tab--dragging' : ''}`}
            data-drop={dropTab?.id === v.id ? (dropTab.after ? 'after' : 'before') : undefined}
            draggable={!!props.onReorder}
            onDragStart={(e) => { setDragTab(v.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', v.id) }}
            onDragOver={(e) => {
              if (!dragTab || dragTab === v.id) return
              e.preventDefault(); e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              const after = e.clientX > rect.left + rect.width / 2
              if (dropTab?.id !== v.id || dropTab.after !== after) setDropTab({ id: v.id, after })
            }}
            onDrop={(e) => { if (!dragTab || !dropTab) return; e.preventDefault(); const move = { from: dragTab, ...dropTab }; setDragTab(null); setDropTab(null); props.onReorder?.(move.from, move.id, move.after) }}
            onDragEnd={() => { setDragTab(null); setDropTab(null) }}
            onKeyDown={(e) => {
              if (!props.onReorder || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
              e.preventDefault()
              const i = views.findIndex((x) => x.id === v.id)
              const target = views[i + (e.key === 'ArrowLeft' ? -1 : 1)]
              if (target) props.onReorder(v.id, target.id, e.key === 'ArrowRight')
            }}
            title={props.onReorder ? t('Arraste para reordenar · ⌥← ⌥→', 'Drag to reorder · ⌥← ⌥→') : undefined}
            onClick={(e) => (active ? props.onMenu(v.id, e.currentTarget) : props.onActivate(v.id))}
            onContextMenu={(e) => {
              e.preventDefault()
              props.onMenu(v.id, e.currentTarget)
            }}
          >
            <ViewTypeIcon type={v.type} size={14} />
            <span className="dbv-tab-name">{v.name}</span>
          </button>
        )
      })}
      {hidden.length > 0 && (
        <button type="button" className="dbv-tab dbv-tab-more" data-testid="view-tabs-more" aria-haspopup="menu" aria-expanded={!!moreEl} aria-label={t('{count} mais visualizações: {names}', '{count} more views: {names}', { count: hidden.length, names: hidden.map((v) => v.name).join(', ') })} title={hidden.map((v) => v.name).join(', ')} onClick={(e) => setMoreEl(moreEl ? null : e.currentTarget)}>
          <span>{t('{count} mais', '{count} more', { count: hidden.length })}</span>
          <ChevronDown size={14} className="dbv-tab-caret" />
        </button>
      )}
      {props.canAdd && (
        <button
          type="button"
          className="dbv-icon-btn dbv-tab-add"
          aria-label={t('Adicionar visualização', 'Add view')}
          title={t('Adicionar visualização', 'Add view')}
          onClick={(e) => props.onAdd(e.currentTarget)}
        >
          <Plus size={16} />
        </button>
      )}
      {moreEl && hidden.length > 0 && (
        <DbPopover anchor={moreEl} ignore={moreEl} onClose={() => setMoreEl(null)} label={t('Mais visualizações', 'More views')}>
          <Menu>
            {hidden.map((v) => (
              <MenuItem key={v.id} icon={<ViewTypeIcon type={v.type} size={16} />} label={v.name} onClick={() => { setMoreEl(null); props.onActivate(v.id) }} />
            ))}
          </Menu>
        </DbPopover>
      )}
    </div>
  )
}
