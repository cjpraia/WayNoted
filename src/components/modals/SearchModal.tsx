import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronRight } from 'lucide-react'
import { recordUse, subscribeUsage, usageScores, usageVersion } from '../../usage/usage'
import { COMMAND_GROUPS, COMMAND_GROUP_LIMIT, commandGroup } from './commandGroups'
import { ShortcutList } from '../shortcuts/ShortcutList'
import { shortcutHint } from '../../shortcuts'
import { ChevronDown, FilePlus, Sparkles, House, Search, Settings, Table2, X, Star, Moon, Sun, PanelLeft, Copy, FolderInput, Trash, Bell, Lock, ArrowLeft, ArrowRight, SquareArrowOutUpRight, Keyboard, FileDown, Type, Maximize2, FileUp, Mic } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import { copyText } from '../../clipboard'
import { PageIcon as LocalPageIcon, iconLabel } from '../page/PageIcon'
import { Icon as RegistryIcon } from '../ui/icons/Icon'
const GraphGlyph = (props: { size?: number; strokeWidth?: number; className?: string }) => <RegistryIcon name="graph" {...props} />
import { AudioRecorder } from './AudioRecorder'
import { exportVisiblePage } from './printPage'
import type { Page } from '../../types'
import { LocalAIModal } from './LocalAIModal'
import { useI18n } from '../../i18n'
import { exportPageAsMarkdown, exportPageAsHTML, importPageFile } from '../page/exportMarkdown'
import { ProductivityIcon } from '../productivity/ProductivityIcon'
import { CalendarDays, GraduationCap, ListChecks } from 'lucide-react'
import { openVoiceTasks } from '../../voice/VoiceTasksDialog'
import { MessageCircleQuestion } from 'lucide-react'
import { openAskPanel } from '../../ai/panel'
import { SlidersHorizontal } from 'lucide-react'
import { insertQueryIntoPage } from '../query/insert'
import { QUERY_TEMPLATES } from '../../query/templates'
import { openRelativeDay } from '../../daily/dailyNotes'
import { toggleCalendarPanel } from '../../daily/CalendarPanel'
import { exportCsv } from '../database/csv'
import { availableTemplates, createFromTemplate } from '../page/templates'
import { MovePageDialog } from '../sidebar/MovePageDialog'
import { defaultSearchFilters, normalizeSearch, parseTypeFilter, searchEngine, searchWorkspace, type SearchFilters, type SearchHit } from './search.mts'
import { highlightRanges } from '../../search/engine.ts'
import { locationLabel } from '../../search/present.ts'
import { indexStatus, indexVersion, ocrEnabled, setOcrEnabled, startSearchIndexer, subscribeIndex, visitCounts } from '../../search/indexer.ts'
import { ocrAvailable } from '../../search/attachments.ts'
import { toggleLocalGraph } from '../../graph/settings'
import { Tag, Database } from 'lucide-react'
import { requestSettingsSection } from '../../quick/QuickCaptureSettings'
import { openBundleImport } from "./ImportDialog"
import { openExportDialog } from '../../export/run'
import { openTypeCollection, openTypePicker, openTypesGallery, openTypesGuide, openTypesManager } from '../../objecttypes/ui'
import { sidebarTypes } from '../../objecttypes/visibility'
import { CanvasGlyph } from '../canvas/icons'
import { canvasPages, createCanvas, showOnCanvas } from '../canvas/canvasActions'
import './SearchModal.css'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/illustrations/Illustration'

// O índice começa a ser montado em segundo plano assim que o app carrega, não ao abrir a busca.
startSearchIndexer()
const RESULT_LIMIT = 100
const SCOPE_LIMIT = 300
function scopeChoices(pages: Record<string, Page>, selected: string, full: boolean): Page[] {
  if (!full) return selected && pages[selected] ? [pages[selected]] : []
  const parents = new Set<string>()
  for (const id in pages) { const parent = pages[id].parentId; if (parent) parents.add(parent) }
  const list: Page[] = []
  for (const id of parents) { const page = pages[id]; if (page && selectors.isLive(id)) list.push(page) }
  list.sort((a, b) => a.title.localeCompare(b.title)); list.length = Math.min(list.length, SCOPE_LIMIT)
  if (selected && pages[selected] && !list.some(page => page.id === selected)) list.push(pages[selected])
  return list
}

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start < cursor) return
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={i} className="sm-mark">{text.slice(start, end)}</mark>)
    cursor = end
  })
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

let pendingQuery = ''
/** workspace://search?q=… : a próxima abertura da busca já começa com este texto. */
export function requestSearchQuery(q: string) { pendingQuery = q }
const takePendingQuery = () => { const q = pendingQuery; pendingQuery = ''; return q }

export function SearchModal() {
  const { settings, pages, route } = useStore()
  const { t, locale } = useI18n()
  const currentPage = route.type === 'page' ? pages[route.id] : undefined
  const [recording, setRecording] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [shortcuts, setShortcuts] = useState(false)
  const [query, setQuery] = useState(takePendingQuery)
  const [moreOpen, setMoreOpen] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultSearchFilters })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trimmed = query.trim()
  const commandsOnly = trimmed.startsWith('>')
  const indexRevision = useSyncExternalStore(subscribeIndex, indexVersion)
  const [ocr, setOcr] = useState(ocrEnabled)
  const allHits = useMemo(() => commandsOnly ? [] : searchWorkspace(pages, query, filters, { recent: settings.recent, visits: visitCounts(), limit: RESULT_LIMIT + 1 }), [pages, query, filters, commandsOnly, settings.recent, indexRevision])
  // `tipo:Livro` filtra por tipo de objeto; o resto da consulta é o que se destaca nos resultados.
  // Doherty: com dezenas de milhares de páginas, o seletor "Buscar dentro de" não pode custar 120 ms à abertura.
  // Só páginas que contêm outras (até SCOPE_LIMIT) e só depois que o seletor é usado; a escolha atual sempre aparece.
  const [scopeOpen, setScopeOpen] = useState(false)
  const scopeOptions = useMemo(() => scopeChoices(pages, filters.scope, scopeOpen), [pages, filters.scope, scopeOpen])
  const textQuery = useMemo(() => parseTypeFilter(query).query, [query])
  const results = useMemo(() => textQuery.trim() ? allHits.slice(0, RESULT_LIMIT).map(hit => searchEngine.locate(hit, textQuery, { mode: filters.match, content: filters.content })) : allHits.slice(0, RESULT_LIMIT), [allHits, textQuery, filters.match, filters.content])
  const matched = useMemo(() => textQuery.trim() ? searchEngine.matchSet(textQuery, filters.match) : new Set<string>(), [textQuery, filters.match, indexRevision])
  const status = indexStatus()
  const close = () => actions.setSearchOpen(false)
  const create = () => { actions.openPage(actions.createPage(null, { title: commandsOnly ? '' : trimmed })); close() }
  const run = (operation: () => unknown | Promise<unknown>) => {
    setCommandError('')
    void Promise.resolve().then(operation).then(close).catch(error => setCommandError(error instanceof Error ? error.message : t('Não foi possível concluir a ação.', 'Could not complete the action.')))
  }
  const rawCommands = [
    { id: 'new', title: t('Nova página', 'New page'), hint: shortcutHint('new-page'), icon: FilePlus, run: create },
    { id: 'db', title: t('Novo banco de dados', 'New database'), hint: '', icon: Table2, run: () => { actions.openPage(actions.createDatabase(null)); close() } },
    { id: 'canvas-new', title: t('Nova lousa', 'New whiteboard'), hint: '', icon: CanvasGlyph, run: () => { actions.openPage(createCanvas(null)); close() } },
    { id: 'home', title: t('Meu dia', 'My day'), hint: '', icon: House, run: () => { actions.navigate({ type: 'home' }); close() } },
    { id: 'settings', title: t('Configurações', 'Settings'), hint: shortcutHint('settings'), icon: Settings, run: () => { close(); actions.setSettingsOpen(true) } },
    { id: 'trash-open', title: t('Abrir lixeira', 'Open trash'), hint: '', icon: Trash, run: () => { requestSettingsSection('data'); close(); actions.setSettingsOpen(true) } },
    { id: 'import', title: t("Importar (Export Bundle, Markdown Vault, ENEX Archive)…", "Import (Export Bundle, Markdown Vault, ENEX Archive)…"), hint: '', icon: FileUp, run: () => { close(); openBundleImport() } },
    { id: 'export', title: t('Exportar…', 'Export…'), hint: shortcutHint('export'), icon: FileDown, run: () => { close(); openExportDialog() } },
    { id: 'backup', title: t('Backup e restauração', 'Backup and restore'), hint: '', icon: Database, run: () => { requestSettingsSection('data'); close(); actions.setSettingsOpen(true) } },
    { id: 'inbox', title: t('Notificações e lembretes', 'Inbox and reminders'), hint: '', icon: Bell, run: () => { close(); actions.setInboxOpen(true) } },
    { id: 'graph', title: t('Abrir grafo de páginas', 'Open page graph'), hint: shortcutHint('graph'), icon: GraphGlyph, run: () => { actions.navigate({ type: 'graph' }); close() } },
    // Tipos de objeto (docs/USAGE.md)
    { id: 'object-types', title: t('Explorar tipos', 'Explore types'), hint: '', icon: Tag, run: () => { close(); openTypesGallery() } },
    { id: 'types-guide', title: t('Página, banco ou tipo?', 'Page, database or type?'), hint: '', icon: Tag, run: () => { close(); openTypesGuide() } },
    ...(settings.objectTypes?.length ? [{ id: 'types-manage', title: t('Gerenciar tipos', 'Manage types'), hint: '', icon: Tag, run: () => { close(); openTypesManager() } }] : []),
    ...sidebarTypes(pages, settings.objectTypes ?? []).map(({ type }) => ({ id: `type-collection-${type.id}`, title: t('Abrir coleção: {name}', 'Open collection: {name}', { name: `${iconLabel(type.icon)} ${type.name}`.trim() }), hint: `tipo:${type.name.includes(' ') ? `"${type.name}"` : type.name}`, icon: Tag, run: () => { close(); openTypeCollection(type.id) } })),
    // Fluxo diário (src/daily, src/tasks)
    { id: 'daily-today', title: t('Nota de hoje', 'Today’s note'), hint: shortcutHint('daily-today'), icon: CalendarDays, run: () => run(() => openRelativeDay(0)) },
    { id: 'daily-yesterday', title: t('Nota de ontem', 'Yesterday’s note'), hint: '', icon: CalendarDays, run: () => run(() => openRelativeDay(-1)) },
    { id: 'daily-tomorrow', title: t('Nota de amanhã', 'Tomorrow’s note'), hint: '', icon: CalendarDays, run: () => run(() => openRelativeDay(1)) },
    { id: 'tasks', title: t('Tarefas: hoje, próximas e atrasadas', 'Tasks: today, upcoming and overdue'), hint: '', icon: ListChecks, run: () => { actions.navigate({ type: 'tasks' }); close() } },
    { id: 'voice-tasks', title: t('Tarefas por voz: ditar e criar tarefas', 'Tasks by voice: dictate and create tasks'), hint: '', icon: Mic, run: () => { openVoiceTasks(); close() } },
    { id: 'review', title: t('Revisão: cartões para revisar hoje', 'Review: cards to review today'), hint: '', icon: GraduationCap, run: () => { actions.navigate({ type: 'review' }); close() } },
    { id: 'calendar-panel', title: settings.dailyFlow?.panelOpen ? t('Ocultar painel de calendário', 'Hide calendar panel') : t('Mostrar painel de calendário', 'Show calendar panel'), hint: shortcutHint('calendar-panel'), icon: CalendarDays, run: () => { toggleCalendarPanel(); close() } },
    { id: 'productivity', title: t('Abrir painel de produtividade', 'Open productivity dashboard'), hint: shortcutHint('productivity'), icon: ProductivityIcon, run: () => { actions.navigate({ type: 'productivity' }); close() } },
    // IA (docs/AI.md): painel lateral com busca local e respostas citadas.
    { id: 'ask-notes', title: t('Perguntar às suas notas', 'Ask your notes'), hint: shortcutHint('ask'), icon: MessageCircleQuestion, run: () => { close(); openAskPanel() } },
    ...(api.openWindow ? [{ id: 'window', title: t('Abrir nova janela', 'Open new window'), hint: shortcutHint('new-window'), icon: SquareArrowOutUpRight, run: () => run(async () => { await actions.flushAll(); await api.openWindow?.(route) }) }] : []),
    { id: 'tab', title: t('Nova aba', 'New tab'), hint: shortcutHint('new-tab'), icon: SquareArrowOutUpRight, run: () => { actions.openInNewTab({ type: 'home' }); close() } },
    { id: 'back', title: t('Voltar', 'Go back'), hint: shortcutHint('back-forward'), icon: ArrowLeft, run: () => { actions.goBack(); close() } },
    { id: 'forward', title: t('Avançar', 'Go forward'), hint: shortcutHint('back-forward').replace('[',']'), icon: ArrowRight, run: () => { actions.goForward(); close() } },
    { id: 'sidebar', title: settings.sidebarCollapsed ? t('Abrir barra lateral', 'Show sidebar') : t('Recolher barra lateral', 'Hide sidebar'), hint: shortcutHint('sidebar'), icon: PanelLeft, run: () => { actions.updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed }); close() } },
    { id: 'light', title: t('Usar tema claro', 'Use light theme'), hint: '', icon: Sun, run: () => { actions.updateSettings({ theme: 'light' }); close() } },
    { id: 'dark', title: t('Usar tema escuro', 'Use dark theme'), hint: '', icon: Moon, run: () => { actions.updateSettings({ theme: 'dark' }); close() } },
    { id: 'system', title: t('Usar tema do sistema', 'Use system theme'), hint: '', icon: Settings, run: () => { actions.updateSettings({ theme: 'system' }); close() } },
    { id: 'language', title: locale === 'pt-BR' ? 'Switch interface to English' : 'Mudar interface para português', hint: '', icon: Settings, run: () => { actions.updateSettings({ locale: locale === 'pt-BR' ? 'en-US' : 'pt-BR' }); close() } },
    { id: 'shortcuts', title: t('Atalhos de teclado', 'Keyboard shortcuts'), hint: '', icon: Keyboard, run: () => setShortcuts(true) },
    ...availableTemplates().map(template => ({ id: `template-${template.id}`, title: t('Criar modelo: {name}', 'Create from template: {name}', {name: template.title}), hint: '', icon: FilePlus, run: () => run(async () => { const created = await createFromTemplate(template.id, null); if (created) actions.openPage(created) }) })),
    ...(currentPage ? [
      { id: 'local-ai', title: t('Assistente de IA local', 'Local AI assistant'), hint: '', icon: Sparkles, run: () => setAssistantOpen(true) },
      { id: 'export-md', title: t('Exportar página Markdown', 'Export page as Markdown'), hint: '', icon: FileDown, run: () => run(() => exportPageAsMarkdown(currentPage.id)) },
      { id: 'export-html', title: t('Exportar página HTML', 'Export page as HTML'), hint: '', icon: FileDown, run: () => run(() => exportPageAsHTML(currentPage.id)) },
      ...(api.exportPDF ? [{ id: 'export-pdf', title: t('Exportar página PDF', 'Export page as PDF'), hint: '', icon: FileDown, run: () => run(() => exportVisiblePage(currentPage.id, `${currentPage.title || 'page'}.pdf`)) }] : []),
      ...(currentPage.database ? [{ id: 'export-csv', title: t('Exportar banco CSV', 'Export database as CSV'), hint: '', icon: FileDown, run: () => run(() => api.exportFile(`${currentPage.title || 'database'}.csv`, exportCsv(currentPage.database!, selectors.rows(currentPage.id), pages))) }] : []),
      ...(!currentPage.locked ? [
        { id: 'record', title: t('Gravar áudio na página', 'Record audio to page'), hint:'',icon:Mic,run:()=>setRecording(true) },
        { id: 'import-page', title: t('Importar arquivo como subpágina', 'Import file as subpage'), hint: '', icon: FileUp, run: () => importRef.current?.click() },
        // Consultas vivas (docs/QUERIES.md): inserem o bloco no cursor do editor desta página.
        ...(!currentPage.database ? [
          { id: 'query', title: t('Inserir consulta', 'Insert query'), hint: shortcutHint('query'), icon: SlidersHorizontal, run: () => run(() => insertQueryIntoPage(currentPage.id, 'blank')) },
          ...QUERY_TEMPLATES.filter(template => template.id !== 'tasks-of-day').map(template => ({ id: `query-${template.id}`, title: t('Inserir consulta: {name}', 'Insert query: {name}', { name: locale === 'en-US' ? template.en : template.pt }), hint: '', icon: SlidersHorizontal, run: () => run(() => insertQueryIntoPage(currentPage.id, template.id)) })),
        ] : []),
        { id: 'wide', title: currentPage.fullWidth ? t('Usar largura padrão', 'Use default page width') : t('Usar largura total', 'Use full page width'), hint: '', icon: Maximize2, run: () => { actions.updatePage(currentPage.id, {fullWidth: !currentPage.fullWidth}, false); close() } },
        { id: 'small', title: currentPage.smallText ? t('Usar texto padrão', 'Use default text size') : t('Usar texto pequeno', 'Use small text'), hint: '', icon: Type, run: () => { actions.updatePage(currentPage.id, {smallText: !currentPage.smallText}, false); close() } },
        ...(['default','serif','mono'] as const).map(font => ({id:`font-${font}`,title:font === 'default' ? t('Fonte padrão', 'Default font') : font === 'serif' ? t('Fonte serifada', 'Serif font') : t('Fonte monoespaçada', 'Monospace font'),hint:'',icon:Type,run:()=>{ actions.updatePage(currentPage.id,{font},false);close() }})),
      ] : []),
      ...(!currentPage.locked ? [{ id: 'apply-type', title: currentPage.database ? t('Aplicar tipo às linhas…', 'Apply type to rows…') : t('Aplicar tipo…', 'Apply type…'), hint: '/tipo', icon: Tag, run: () => { close(); openTypePicker([currentPage.id]) } }] : []),
      // Lousa (docs/USAGE.md): adicionar a página atual a um quadro existente ou novo.
      ...(!currentPage.canvas ? [
        ...canvasPages().slice(0, 5).map(board => ({ id: `canvas-add-${board.id}`, title: t('Adicionar à lousa: {name}', 'Add to whiteboard: {name}', { name: board.title || t('Sem título', 'Untitled') }), hint: '', icon: CanvasGlyph, run: () => run(() => showOnCanvas(currentPage.id, board.id)) })),
        { id: 'canvas-add-new', title: t('Mostrar numa nova lousa', 'Show on a new whiteboard'), hint: '', icon: CanvasGlyph, run: () => run(() => showOnCanvas(currentPage.id, 'new')) },
      ] : []),
      { id: 'favorite', title: currentPage.favorite ? t('Remover página dos favoritos', 'Remove page from favorites') : t('Adicionar página aos favoritos', 'Add page to favorites'), hint: '', icon: Star, run: () => { actions.toggleFavorite(currentPage.id); close() } },
      { id: 'local-graph', title: t('Mostrar grafo local da página', 'Show local page graph'), hint: '', icon: GraphGlyph, run: () => { toggleLocalGraph(true); close() } },
      { id: 'copy', title: t('Copiar link da página', 'Copy page link'), hint: '', icon: Copy, run: () => run(() => copyText(`workspace://page/${currentPage.id}`)) },
      { id: 'duplicate', title: t('Duplicar página atual', 'Duplicate current page'), hint: '', icon: Copy, run: () => run(async () => { const id = await actions.duplicatePage(currentPage.id); if (id) actions.openPage(id) }) },
      { id: 'move', title: t('Mover página atual', 'Move current page'), hint: '', icon: FolderInput, run: () => setMoving(true) },
      { id: 'lock', title: currentPage.locked ? t('Desbloquear página', 'Unlock page') : t('Bloquear página', 'Lock page'), hint: '', icon: Lock, run: () => { actions.updatePage(currentPage.id, { locked: !currentPage.locked }, false); close() } },
      { id: 'subpage', title: t('Criar subpágina', 'Create subpage'), hint: '', icon: FilePlus, run: () => run(() => actions.openPage(actions.createPage(currentPage.id))) },
      { id: 'trash', title: t('Mover página atual para a lixeira', 'Move current page to trash'), hint: '', icon: Trash, run: () => { actions.trashPage(currentPage.id); close() } },
    ] : []),
  ].filter(command => command.id === 'back' ? selectors.canGoBack() : command.id === 'forward' ? selectors.canGoForward() : command.id === 'subpage' ? !currentPage?.locked || !!currentPage?.database : true).filter(command => commandsOnly ? normalizeSearch(command.title).includes(normalizeSearch(trimmed.slice(1).trim())) : !trimmed || (trimmed.length >= 2 && normalizeSearch(command.title).includes(normalizeSearch(trimmed))))
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  useSyncExternalStore(subscribeUsage, usageVersion)
  const commands = (() => {
    const scores = usageScores('cmd')
    const order = new Map(rawCommands.map((command, index) => [command.id, index]))
    const entries: Array<(typeof rawCommands)[number] & { group: string; more?: number }> = []
    for (const group of COMMAND_GROUPS) {
      const inGroup = rawCommands.filter(command => commandGroup(command.id) === group.id)
        .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0) || order.get(a.id)! - order.get(b.id)!)
      const open = openGroups.has(group.id)
      const shown = open ? inGroup : inGroup.slice(0, COMMAND_GROUP_LIMIT)
      for (const command of shown) entries.push({ ...command, group: group.label(t), run: () => { recordUse('cmd', command.id); command.run() } })
      if (!open && inGroup.length > COMMAND_GROUP_LIMIT) entries.push({ id: `more-${group.id}`, group: group.label(t), title: t('Mais {n} ›', 'Show {n} more ›', { n: inGroup.length - COMMAND_GROUP_LIMIT }), hint: '', icon: ChevronRight, more: inGroup.length - COMMAND_GROUP_LIMIT, run: () => setOpenGroups(old => new Set(old).add(group.id)) })
    }
    return entries
  })()
  const count = results.length + commands.length
  const patch = (next: Partial<SearchFilters>) => setFilters(old => ({ ...old, ...next }))
  const open = (hit: SearchHit, newTab = false) => {
    const target = { ...(hit.segment?.blockId ? { blockId: hit.segment.blockId } : {}), ...(hit.segment?.commentId ? { commentId: hit.segment.commentId } : {}) }
    if (newTab) actions.openInNewTab({ type: 'page', id: hit.page.id, ...target })
    else actions.openPage(hit.page.id, target)
    close()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => setActive(0), [query, filters])
  useEffect(() => {
    if (active >= count) setActive(0)
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, count])
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || recording || assistantOpen || moving) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'Tab') {
      const elements = [...(boxRef.current?.querySelectorAll<HTMLElement>('input:not([hidden]),select,button,[tabindex="0"]') || [])].filter(el => !el.hasAttribute('disabled'))
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus() }
      return
    }
    if (event.target !== inputRef.current) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count) setActive(i => (i + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (results[active]) open(results[active], event.metaKey || event.ctrlKey)
      else if (commands[active - results.length]) commands[active - results.length].run()
      else if (trimmed && !commandsOnly) create()
    }
  }
  return <div className="sm-overlay" onMouseDown={e => e.target === e.currentTarget && close()} onKeyDown={onKeyDown}>
    <div ref={boxRef} className="sm-box" role="dialog" aria-modal="true" aria-label={t("Buscar no espaço de trabalho", "Search workspace")}>
      <input ref={importRef} type="file" hidden accept=".md,.markdown,.html,.htm,.txt,.docx,.pdf,.zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && currentPage) run(async () => actions.openPage(await importPageFile(file, currentPage.id))) }} />
      <div className="sm-input-row">
        <Search size={20} strokeWidth={1.7} className="sm-search-icon" aria-hidden />
        <input ref={inputRef} className="sm-input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Buscar em {name}…", "Search in {name}…", {name: settings.workspaceName || `${PRODUCT.name}`})} aria-label={t("Buscar páginas ou digite > para comandos", "Search pages or type > for commands")} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="sm-results" aria-activedescendant={count ? `sm-result-${active}` : undefined} spellCheck={false} autoComplete="off" />
        <button className="sm-close" onClick={close} aria-label={t("Fechar busca", "Close search")}><X size={18} /></button>
      </div>
      {!commandsOnly && <><div className="sm-filters" role="group" aria-label={t("Filtros de busca", "Search filters")}>
        <Select aria-label={t("Tipo de resultado", "Result type")} value={filters.kind} onChange={e => patch({ kind: e.target.value as SearchFilters['kind'] })}><option value="all">{t("Todos os tipos", "All types")}</option><option value="page">{t("Páginas", "Pages")}</option><option value="database">{t("Bancos de dados", "Databases")}</option><option value="row">{t("Registros de banco", "Database records")}</option></Select>
        <Select aria-label={t("Última edição", "Last edited")} value={filters.updated} onChange={e => patch({ updated: e.target.value as SearchFilters['updated'] })}><option value="all">{t("Qualquer data", "Any time")}</option><option value="day">{t("Últimas 24 horas", "Past 24 hours")}</option><option value="week">{t("Últimos 7 dias", "Past 7 days")}</option><option value="month">{t("Últimos 30 dias", "Past 30 days")}</option></Select>
        <Select aria-label={t("Buscar dentro de", "Search within")} value={filters.scope} onOpen={() => setScopeOpen(true)} onChange={e => patch({ scope: e.target.value })}><option value="">{t("Todo o espaço", "Entire workspace")}</option>{scopeOptions.map(p => <option key={p.id} value={p.id}>{p.title || t("Sem título", "Untitled")}</option>)}</Select>
        <button className={filters.favorites ? 'is-selected' : ''} aria-pressed={filters.favorites} onClick={() => patch({ favorites: !filters.favorites })}>{t("Favoritos", "Favorites")}</button>
        <button className={`sm-more${moreOpen ? ' is-open' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}>{t('Mais filtros', 'More filters')}<ChevronDown size={12} aria-hidden /></button>
      </div>
      {moreOpen && <div className="sm-advanced">
        <Select aria-label={t("Ordenar resultados", "Sort results")} value={filters.sort} onChange={e => patch({ sort: e.target.value as SearchFilters['sort'] })}><option value="relevance">{t("Relevância", "Relevance")}</option><option value="updated">{t("Última edição", "Last edited")}</option><option value="title">{t("Título", "Title")}</option></Select>
        <Select aria-label={t('Onde buscar o texto', 'Search content')} value={filters.content} onChange={e => patch({ content: e.target.value as SearchFilters['content'] })}><option value="all">{t('Todo o conteúdo', 'All content')}</option><option value="title">{t('Somente título', 'Title only')}</option><option value="body">{t('Corpo da página', 'Page body')}</option><option value="properties">{t('Propriedades', 'Properties')}</option><option value="comments">{t('Comentários', 'Comments')}</option></Select>
        <Select aria-label={t('Combinar termos', 'Match terms')} value={filters.match} onChange={e => patch({ match: e.target.value as SearchFilters['match'] })}><option value="all">{t('Todas as palavras', 'All words')}</option><option value="any">{t('Qualquer palavra', 'Any word')}</option><option value="exact">{t('Frase exata', 'Exact phrase')}</option></Select>
          <Select aria-label={t('Campo de data', 'Date field')} value={filters.dateField} onChange={e => patch({ dateField: e.target.value as SearchFilters['dateField'] })}><option value="updated">{t('Editado em', 'Last edited')}</option><option value="created">{t('Criado em', 'Created')}</option></Select>
          <label>{t('De', 'From')} <input type="date" value={filters.after} onChange={e => patch({ after: e.target.value })} /></label>
          <label>{t('Até', 'To')} <input type="date" value={filters.before} onChange={e => patch({ before: e.target.value })} /></label>
          <input aria-label={t('Nome da propriedade', 'Property name')} placeholder={t('Propriedade específica', 'Specific property')} value={filters.propertyName} onChange={e => patch({ propertyName: e.target.value, content: e.target.value ? 'properties' : 'all' })} />
          <input aria-label={t('Autor', 'Author')} placeholder={t('Autor', 'Author')} value={filters.author} onChange={e => patch({ author: e.target.value })} />
          <button className={filters.includeTrash ? 'is-selected' : ''} aria-pressed={!!filters.includeTrash} onClick={() => patch({ includeTrash: !filters.includeTrash })}>{t('Incluir lixeira', 'Include trash')}</button>
          {ocrAvailable() && <button className={ocr ? 'is-selected' : ''} aria-pressed={ocr} title={t('Reconhece texto em imagens anexadas com o macOS, localmente.', 'Recognizes text in attached images with macOS, locally.')} onClick={() => { setOcrEnabled(!ocr); setOcr(!ocr) }}>{t('Texto em imagens (OCR)', 'Text in images (OCR)')}</button>}
          <button onClick={() => setFilters({ ...defaultSearchFilters })}>{t('Limpar filtros', 'Clear filters')}</button>
        </div>}</>}
      {commandError && <p className="sm-command-error" role="alert">{commandError}</p>}
      {shortcuts && <div className="sm-shortcuts"><strong>{t('Atalhos de teclado', 'Keyboard shortcuts')}</strong><ShortcutList compact autoFocus /><button onClick={() => setShortcuts(false)}>{t('Voltar à busca', 'Back to search')}</button></div>}
      <div className="np-sr-only" role="status" aria-live="polite">{count ? (count === 1 ? t('1 resultado', '1 result') : t('{n} resultados', '{n} results', { n: count })) : (trimmed ? t('Nenhum resultado', 'No results') : '')}</div>
      <div className="sm-list" ref={listRef} role="listbox" id="sm-results" aria-label={t("Resultados e comandos", "Results and commands")}>
        {results.length > 0 && <div className="sm-group">{allHits.length > RESULT_LIMIT ? `${RESULT_LIMIT}+` : allHits.length} {allHits.length === 1 ? t("página", "page") : t("páginas", "pages")}</div>}
        {results.map((hit, index) => {
          const page = hit.page
          const path = selectors.ancestors(page.id).map(a => a.title || t("Sem título", "Untitled")).join(' / ')
          const title = page.title || t("Sem título", "Untitled")
          const where = locationLabel(hit.segment, t)
          const snip = hit.snippet && hit.tier !== 'titleExact' ? hit.snippet : null
          return <div key={page.id} id={`sm-result-${index}`} data-idx={index} role="option" aria-selected={index === active} className={`sm-item${index === active ? ' is-active' : ''}${hit.trashed ? ' is-trashed' : ''}`} onMouseMove={() => setActive(index)} onClick={e => open(hit, e.metaKey || e.ctrlKey)}>
            <span className="sm-item-icon">{page.icon ? <LocalPageIcon value={page.icon} style={{ width: 18, height: 18 }} /> : <LocalPageIcon value={null} fallback={page.canvas ? 'canvas' : page.database ? 'database' : 'page'} style={{ width: 18, height: 18 }} />}</span>
            <span className="sm-item-body"><span className="sm-item-line"><span className="sm-item-title"><Marked text={title} ranges={page.title ? highlightRanges(title, matched) : []} /></span>{hit.trashed && <span className="sm-item-badge">{t('Na lixeira', 'In trash')}</span>}{path && <span className="sm-item-path">{path}</span>}</span>{snip && <span className="sm-item-snippet"><Marked text={snip.text} ranges={snip.ranges} /></span>}{snip && where && <span className="sm-item-where">{where}</span>}</span>
          </div>
        })}
        {commands.map((command, i) => { const index = results.length + i; const Icon = command.icon; const heading = i === 0 || commands[i - 1].group !== command.group; return <Fragment key={command.id}>{heading && <div className="sm-group">{command.group}</div>}<div role="option" aria-selected={index === active} id={`sm-result-${index}`} data-idx={index} className={`sm-item${index === active ? ' is-active' : ''}${command.more ? ' sm-item--more' : ''}`} onMouseMove={() => setActive(index)} onClick={command.run}><span className="sm-item-icon"><Icon size={18} /></span><span className="sm-item-title">{command.title}</span><span className="sm-command-hint">{command.hint}</span></div></Fragment> })}
        {!count && <EmptyState className="sm-empty" illustration="search" size={72} title={t("Nenhum resultado", "No results")} action={trimmed && !commandsOnly ? <button className="sm-create" onClick={create}><FilePlus size={16} /> {t("Criar página “{title}”", "Create page “{title}”", {title:trimmed})}</button> : undefined}>{t("Tente outro termo ou ajuste os filtros.", "Try another term or adjust your filters.")}</EmptyState>}
      </div>
      <div className="sm-footer">{(status.queued > 0 || status.attachments > 0) && <span className="sm-indexing" role="status">{status.attachments > 0 ? t('Lendo anexos para a busca…', 'Reading attachments for search…') : t('Indexando páginas…', 'Indexing pages…')}</span>}<span><kbd>↑↓</kbd> {t("Navegar", "Navigate")}</span><span><kbd>↵</kbd> {t("Abrir", "Open")}</span><span><kbd>⌘↵</kbd> {t("Nova aba", "New tab")}</span><span><kbd>esc</kbd> {t("Fechar", "Close")}</span></div>
    </div>
    {recording && currentPage && <AudioRecorder pageId={currentPage.id} onClose={() => { setRecording(false); close() }} />}
    {assistantOpen && currentPage && <LocalAIModal pageId={currentPage.id} onClose={() => { setAssistantOpen(false); close() }} />}
    {moving && currentPage && <MovePageDialog pageId={currentPage.id} onClose={() => { setMoving(false); close() }} />}
  </div>
}
