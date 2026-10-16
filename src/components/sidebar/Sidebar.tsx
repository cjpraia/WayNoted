import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
import { t } from '../../i18n'
import { protectedTitle } from '../../security/pageLock'
// Barra lateral do aplicativo.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, LayoutGrid, PanelLeft, Plus, SquarePen } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import type { Page, LocalWorkspace } from '../../types'
import { MenuItem, Popover, menuKeyNav, type Anchor } from './Popover'
import { PageMenu, RenamePopover } from './PageMenu'
import { PageIcon as TreePageIcon, PageNode, PageTree, TreeContext, applyDrop, type DropTarget, type TreeCtx } from './PageTree'
import { TooltipLayer } from './Tooltip'
import { TrashPopover } from './TrashPopover'
import { DailyFlowNav } from '../../daily/DailyFlowNav'
import { BlockIcon } from '../ui/BlockIcon'
import { Icon } from '../ui/icons/Icon'
import { CanvasIcon } from '../canvas/icons'
import { createCanvas } from '../canvas/canvasActions'
import './sidebar.css'
import { ProductivityIcon } from '../productivity/ProductivityIcon'
import { MessageCircleQuestion } from 'lucide-react'
import { toggleAskPanel, useAskPanel } from '../../ai/panel'
import { SidebarTypes } from '../objecttypes/SidebarTypes'
import { openTypesGallery } from '../../objecttypes/ui'
import { sidebarTypes } from '../../objecttypes/visibility'
import { SelectionBar, SelectionMenu } from '../../subpages/SelectionBar'
import { clearSelection, selectedIds } from '../../subpages/selection'
import { shortcutHint } from '../../shortcuts'

const MIN_W = 200
const MAX_W = 480
const LS_SECTIONS = COMPAT.record042

function loadSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_SECTIONS) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

type MenuState = { pageId: string; anchor: Anchor; rowEl: HTMLElement; trigger: Element | null }

export function Sidebar() {
  const state = useStore()
  const askOpen = useAskPanel().open
  const { settings, route } = state
  const collapsed = settings.sidebarCollapsed

  // Largura local durante o arraste; persiste no mouseup.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const width = dragWidth ?? Math.min(MAX_W, Math.max(MIN_W, settings.sidebarWidth || 240))

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [rename, setRename] = useState<{ pageId: string; anchor: DOMRect } | null>(null)
  const [selMenu, setSelMenu] = useState<Anchor | null>(null)
  const [wsMenu, setWsMenu] = useState<{ anchor: DOMRect; trigger: Element } | null>(null)
  const [trash, setTrash] = useState<{ anchor: DOMRect; trigger: Element } | null>(null)
  const [dragId, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [sections, setSections] = useState(loadSections)

  const toggleSection = (key: string) => {
    setSections((s) => {
      const next = { ...s, [key]: !s[key] }
      try {
        localStorage.setItem(LS_SECTIONS, JSON.stringify(next))
      } catch {
        /* ignora */
      }
      return next
    })
  }

  const openMenu = useCallback((page: Page, anchor: Anchor, rowEl: HTMLElement, trigger: Element | null) => {
    setMenu({ pageId: page.id, anchor, rowEl, trigger })
  }, [])

  const tree: TreeCtx = useMemo(
    () => ({ dragId, drop, setDrag, setDrop, menuFor: menu?.pageId ?? null, openMenu, openSelectionMenu: setSelMenu }),
    [dragId, drop, menu?.pageId, openMenu],
  )

  // Garante a limpeza do estado de arraste mesmo se a linha de origem desmontar.
  useEffect(() => {
    if (!dragId) return
    const reset = () => {
      setDrag(null)
      setDrop(null)
    }
    document.addEventListener('dragend', reset)
    document.addEventListener('drop', reset)
    return () => {
      document.removeEventListener('dragend', reset)
      document.removeEventListener('drop', reset)
    }
  }, [dragId])

  // Fecha menus quando a sidebar é recolhida.
  useEffect(() => {
    if (collapsed) {
      setMenu(null)
      setRename(null)
      setWsMenu(null)
      setTrash(null)
      setSelMenu(null)
    }
  }, [collapsed])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    let latest = startW
    document.body.classList.add('sb-resizing-body')
    const onMove = (ev: MouseEvent) => {
      latest = Math.round(Math.min(MAX_W, Math.max(MIN_W, startW + ev.clientX - startX)))
      setDragWidth(latest)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('sb-resizing-body')
      if (latest !== settings.sidebarWidth) actions.updateSettings({ sidebarWidth: latest })
      setDragWidth(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const newRootPage = (init?: Partial<Page>) => actions.openPage(actions.createPage(null, init))

  // Soltar sobre a área vazia de "Particular" move para o fim da raiz.
  const onRootDragOver = (e: DragEvent) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!drop || drop.pos !== 'root') setDrop({ id: null, pos: 'root' })
  }
  const onRootDrop = (e: DragEvent) => {
    e.preventDefault()
    if (dragId) applyDrop(dragId, { id: null, pos: 'root' })
    setDrag(null)
    setDrop(null)
  }

  const favorites = selectors.favorites()
  // Recentes enxutos como no Export Bundle: 5 por padrão, "Mostrar mais" amplia até 15.
  const RECENT_COLLAPSED = 5, RECENT_EXPANDED = 15
  const recentAll = selectors.recent(RECENT_EXPANDED)
  const recentExpanded = !!settings.recentExpanded && recentAll.length > RECENT_COLLAPSED
  // Recolhido, a página ativa nunca "some": se ela está além das 5 primeiras, passa a ser a primeira linha.
  const activeId = route.type === 'page' ? route.id : null
  const activeBeyond = !recentExpanded && activeId ? recentAll.findIndex(page => page.id === activeId) >= RECENT_COLLAPSED : false
  const recent = recentExpanded ? recentAll : activeBeyond ? [recentAll.find(page => page.id === activeId)!, ...recentAll.filter(page => page.id !== activeId).slice(0, RECENT_COLLAPSED - 1)] : recentAll.slice(0, RECENT_COLLAPSED)
  const rootPages = selectors.children(null)
  const wsName = settings.workspaceName.trim() || `${PRODUCT.name}`
  const isHome = route.type === 'home'
  const menuPage = menu ? selectors.page(menu.pageId) : undefined

  return (
    <aside
      className={`sb${collapsed ? ' sb--collapsed' : ''}${dragWidth !== null ? ' sb--resizing' : ''}`}
      style={{ width: collapsed ? 0 : width }}
      aria-label={t("Barra lateral", "Sidebar")}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
      onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented && selectedIds().length && !(e.target as HTMLElement).closest('input,textarea,[role="dialog"],[role="menu"]')) { e.preventDefault(); clearSelection() } }}
    >
      <div className="sb-inner" style={{ width }}>
        <div className="sb-titlebar">
          <button
            type="button"
            className="sb-icon-btn sb-collapse-btn"
            aria-label={t("Fechar barra lateral", "Hide sidebar")}
            data-tip={t("Fechar barra lateral", "Hide sidebar")}
            data-tip-kbd={shortcutHint('sidebar')}
            onClick={() => actions.updateSettings({ sidebarCollapsed: true })}
          >
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="sb-icon-btn sb-compose-btn"
            aria-label={t("Nova página", "New page")}
            data-tip={t("Criar uma nova página", "Create a new page")}
            data-tip-kbd={shortcutHint('new-page')}
            onClick={() => newRootPage()}
          >
            <SquarePen size={18} strokeWidth={1.6} />
          </button>
        </div>

        <nav className="sb-fixed" aria-label={t("Navegação", "Navigation")}>
          <button className="sb-search" type="button" onClick={() => actions.setSearchOpen(true)} aria-label={t('Buscar ou perguntar', 'Search or ask')}>
            <span>{t('Buscar ou perguntar', 'Search or ask')}</span>
            <kbd>{shortcutHint('search')}</kbd>
          </button>
          <div className="sb-quick-nav">
            <button type="button" className={`sb-quick-home${isHome ? ' sb-quick-home--active' : ''}`} aria-current={isHome ? 'page' : undefined} onClick={() => actions.navigate({ type: 'home' })}>
              <Icon name="home" size={18} /> <span>{t('Meu dia', 'My day')}</span>
            </button>
            <button type="button" className="sb-quick-icon" aria-label={t('Notificações', 'Inbox')} data-tip={t('Notificações', 'Inbox')} onClick={() => actions.setInboxOpen(true)}>
              <Icon name="inbox" size={18} />
              {Object.values(state.notifications).some(item => item.readAt === null && item.dueAt <= Date.now()) && <span className="sb-unread-dot" />}
            </button>
            <button type="button" className={`sb-quick-icon${route.type === 'graph' ? ' sb-quick-home--active' : ''}`} aria-label={t('Grafo', 'Graph')} aria-current={route.type === 'graph' ? 'page' : undefined} data-tip={t('Grafo', 'Graph')} data-tip-kbd={shortcutHint('graph')} onClick={() => actions.navigate({ type: 'graph' })}>
              <Icon name="graph" size={18} />
            </button>
            <button type="button" className={`sb-quick-icon${route.type === 'productivity' ? ' sb-quick-home--active' : ''}`} aria-label={t('Produtividade', 'Productivity')} aria-current={route.type === 'productivity' ? 'page' : undefined} data-tip={t('Produtividade', 'Productivity')} data-tip-kbd={shortcutHint('productivity')} onClick={() => actions.navigate({ type: 'productivity' })}>
              <ProductivityIcon size={18} strokeWidth={1.75} />
            </button>
            <button type="button" className={`sb-quick-icon${askOpen ? ' sb-quick-home--active' : ''}`} aria-label={t('Perguntar às suas notas', 'Ask your notes')} aria-pressed={askOpen} data-tip={t('Perguntar às suas notas', 'Ask your notes')} data-tip-kbd={shortcutHint('ask')} onClick={toggleAskPanel}>
              <MessageCircleQuestion size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          <DailyFlowNav route={route} />
        </nav>

        <TreeContext.Provider value={tree}>
          <div className="sb-scroll">
            {recent.length > 0 && <section className="sb-section sb-recents" aria-label={t('Recentes', 'Recents')}>
              <div className="sb-section-head sb-section-head--static"><span className="sb-section-title">{t('Recentes', 'Recents')}</span></div>
              {recent.map(page => <button key={page.id} type="button" className={`sb-row sb-nav${route.type === 'page' && route.id === page.id ? ' sb-row--active' : ''}`} onClick={() => actions.openPage(page.id)}>
                <span className="sb-row-icon"><TreePageIcon page={page} size={18} /></span><span className="sb-row-title">{protectedTitle(page, t('Página protegida', 'Protected page')) ?? (page.title || (page.database ? t('Sem título', 'Untitled') : t('Nova página', 'New page')))}</span>
              </button>)}
              {recentAll.length > RECENT_COLLAPSED && (
                <button type="button" className="sb-row sb-nav sb-recents-more" aria-expanded={recentExpanded} onClick={() => actions.updateSettings({ recentExpanded: !recentExpanded })}>
                  <span className="sb-row-icon"><Icon name={recentExpanded ? 'chevron-up' : 'chevron-down'} size={16} /></span>
                  <span className="sb-row-title">{recentExpanded ? t('Mostrar menos', 'Show less') : t('Mostrar mais {n}', 'Show {n} more', { n: recentAll.length - RECENT_COLLAPSED })}</span>
                </button>
              )}
            </section>}
            {favorites.length > 0 && (
              <Section
                title={t("Favoritos", "Favorites")}
                closed={!!sections.favorites}
                onToggle={() => toggleSection('favorites')}
                addLabel={t("Adicionar uma página aos favoritos", "Add a page to favorites")}
                onAdd={() => newRootPage({ favorite: true })}
              >
                {favorites.map((p) => (
                  <PageNode key={p.id} page={p} depth={0} draggable={false} />
                ))}
              </Section>
            )}
            {/* Só aparece com ao menos um tipo em uso ou escolhido (docs/USAGE.md). */}
            {settings.objectTypesSidebar !== false && sidebarTypes(state.pages, settings.objectTypes ?? []).length > 0 && (
              <Section title={t('Tipos', 'Types')} closed={!!sections.types} onToggle={() => toggleSection('types')} addLabel={t('Explorar tipos', 'Explore types')} onAdd={() => openTypesGallery()}>
                <SidebarTypes />
              </Section>
            )}
            <Section
              title={t("Particular", "Private")}
              closed={!!sections.private}
              onToggle={() => toggleSection('private')}
              addLabel={t("Adicionar uma página", "Add a page")}
              onAdd={() => newRootPage()}
            >
              <div
                role="tree"
                aria-multiselectable="true"
                aria-label={t("Páginas", "Pages")}
                className={`sb-tree${drop?.pos === 'root' ? ' sb-tree--drop-root' : ''}`}
                onDragOver={onRootDragOver}
                onDrop={onRootDrop}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
                }}
              >
                <PageTree parentId={null} depth={0} draggable />
                <button type="button" className="sb-row sb-add-row" onClick={() => newRootPage()}>
                  <span className="sb-row-icon">
                    <Plus size={16} strokeWidth={1.7} />
                  </span>
                  <span className="sb-row-title">{rootPages.length ? t("Adicionar página", "Add page") : t("Adicionar uma página", "Add a page")}</span>
                </button>
              </div>
            </Section>
          </div>
        </TreeContext.Provider>

        <SelectionBar />
        <div className="sb-footer">
          <button
            type="button"
            className={`sb-row sb-ws-btn${wsMenu ? ' sb-row--menu' : ''}`}
            aria-haspopup="menu"
            aria-expanded={!!wsMenu}
            onClick={(e) => {
              if (wsMenu) return setWsMenu(null)
              setWsMenu({ anchor: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget })
            }}
          >
            <span className="sb-ws-avatar" aria-hidden>{wsName.charAt(0).toUpperCase()}</span>
            <span className="sb-ws-name">{wsName}</span>
            <ChevronDown size={14} strokeWidth={1.8} className="sb-ws-chevron" aria-hidden />
          </button>
        </div>
      </div>

      {!collapsed && <div className="sb-resizer" role="separator" aria-orientation="vertical" aria-label={t("Redimensionar barra lateral", "Resize sidebar")} aria-valuemin={MIN_W} aria-valuemax={MAX_W} aria-valuenow={width} tabIndex={0} onMouseDown={startResize} onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width - 16 : event.key === 'ArrowRight' ? width + 16 : event.key === 'Home' ? MIN_W : event.key === 'End' ? MAX_W : null
        if (next !== null) { event.preventDefault(); actions.updateSettings({ sidebarWidth: Math.min(MAX_W, Math.max(MIN_W, next)) }) }
      }} />}

      <TooltipLayer />

      {menu && menuPage && (
        <PageMenu
          pageId={menu.pageId}
          anchor={menu.anchor}
          trigger={menu.trigger}
          onClose={() => setMenu(null)}
          onRename={() => {
            const rect = menu.rowEl.getBoundingClientRect()
            setMenu(null)
            setRename({ pageId: menu.pageId, anchor: rect })
          }}
        />
      )}
      {selMenu && <SelectionMenu anchor={selMenu} onClose={() => setSelMenu(null)} />}
      {rename && <RenamePopover pageId={rename.pageId} anchor={rename.anchor} onClose={() => setRename(null)} />}
      {wsMenu && (
        <Popover anchor={wsMenu.anchor} onClose={() => setWsMenu(null)} ignore={wsMenu.trigger} className="sb-menu sb-ws-menu" label={t("Espaço de trabalho", "Workspace")}>
          <WorkspaceMenu name={wsName} userName={settings.userName} onClose={() => setWsMenu(null)} onTrash={() => { const source = wsMenu; setWsMenu(null); if (source) setTrash(source) }} />
        </Popover>
      )}
      {trash && <TrashPopover anchor={trash.anchor} trigger={trash.trigger} onClose={() => setTrash(null)} />}
    </aside>
  )
}

function WorkspaceMenu(props: { name: string; userName: string; onClose: () => void; onTrash: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([])
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [switching, setSwitching] = useState(false)
  useEffect(() => {
    ref.current?.focus()
    let alive = true
    if (api.listWorkspaces) void api.listWorkspaces().then(items => { if (alive) setWorkspaces(items) }).catch(error => { if (alive) setWorkspaceError(error instanceof Error ? error.message : t('Não foi possível listar os espaços.', 'Could not list workspaces.')) })
    return () => { alive = false }
  }, [])
  const switchWorkspace = async (id: string) => {
    if (switching || !api.openWorkspace) return
    setSwitching(true); setWorkspaceError('')
    try { await actions.flushAll(); await api.openWorkspace(id); props.onClose() }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : t('Não foi possível abrir o espaço.', 'Could not open the workspace.')) }
    finally { setSwitching(false) }
  }
  const createWorkspace = async () => {
    if (!api.createWorkspace || !workspaceName?.trim()) return
    try { const workspace = await api.createWorkspace(workspaceName.trim()); await switchWorkspace(workspace.id) }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : t('Não foi possível criar o espaço.', 'Could not create the workspace.')) }
  }
  return (
    <div ref={ref} role="menu" tabIndex={-1} className="sb-menu-body" onKeyDown={menuKeyNav}>
      <div className="sb-ws-card">
        <span className="sb-ws-avatar sb-ws-avatar--lg" aria-hidden>
          {props.name.charAt(0).toUpperCase()}
        </span>
        <span className="sb-ws-card-text">
          <span className="sb-ws-card-name">{props.name}</span>
          <span className="sb-ws-card-sub">{props.userName ? `${props.userName} · Local` : t("Particular · Local", "Private · Local")}</span>
        </span>
      </div>
      {workspaces.length > 0 && <div className="sb-menu-group">{workspaces.map(workspace => <MenuItem key={workspace.id} label={workspace.name} hint={workspace.current ? t('Atual', 'Current') : undefined} disabled={workspace.current || switching} onClick={() => void switchWorkspace(workspace.id)} />)}</div>}
      {api.createWorkspace && <div className="sb-menu-group">{workspaceName === null ? <MenuItem icon={<Plus size={18} />} label={t('Novo espaço local', 'New local workspace')} onClick={() => setWorkspaceName('')} /> : <form className="sb-workspace-form" onSubmit={event => { event.preventDefault(); void createWorkspace() }}><input autoFocus value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} aria-label={t('Nome do espaço', 'Workspace name')} placeholder={t('Nome do espaço', 'Workspace name')} /><button disabled={switching || !workspaceName.trim()}>{t('Criar', 'Create')}</button></form>}</div>}
      {workspaceError && <p className="sb-action-error" role="alert">{workspaceError}</p>}
      <div className="sb-menu-sep" />
      <div className="sb-menu-group">
        <MenuItem
          icon={<SquarePen size={18} />}
          label={t("Nova página", "New page")}
          hint={shortcutHint('new-page')}
          onClick={() => {
            props.onClose()
            actions.openPage(actions.createPage(null))
          }}
        />
        <MenuItem
          icon={<BlockIcon name="database-full-page" size={18} />}
          label={t("Novo banco de dados", "New database")}
          onClick={() => {
            props.onClose()
            actions.openPage(actions.createDatabase(null))
          }}
        />
        <MenuItem
          icon={<CanvasIcon name="canvas" size={18} />}
          label={t("Nova lousa", "New whiteboard")}
          onClick={() => {
            props.onClose()
            actions.openPage(createCanvas(null))
          }}
        />
        <MenuItem
          icon={<LayoutGrid size={18} />}
          label={t("Explorar tipos", "Explore types")}
          onClick={() => {
            props.onClose()
            openTypesGallery()
          }}
        />
      </div>
      <div className="sb-menu-sep" />
      <div className="sb-menu-group">
        <MenuItem
          icon={<Icon name="settings" size={18} />}
          label={t("Configurações", "Settings")}
          hint={shortcutHint('settings')}
          onClick={() => {
            props.onClose()
            actions.setSettingsOpen(true)
          }}
        />
        <MenuItem icon={<Icon name="trash" size={18} />} label={t('Lixeira', 'Trash')} onClick={props.onTrash} />
      </div>
    </div>
  )
}

function Section(props: {
  title: string
  closed: boolean
  onToggle: () => void
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <section className="sb-section">
      <div className="sb-section-head">
        <button type="button" className="sb-section-title" aria-expanded={!props.closed} onClick={props.onToggle}>
          <span>{props.title}</span>
          <ChevronRight size={12} strokeWidth={2.25} className={`sb-section-chevron${props.closed ? '' : ' sb-chevron--open'}`} aria-hidden />
        </button>
        <button
          type="button"
          className="sb-mini-btn sb-section-add"
          aria-label={props.addLabel}
          data-tip={props.addLabel}
          onClick={props.onAdd}
        >
          <Plus size={16} strokeWidth={1.7} />
        </button>
      </div>
      {!props.closed && <div className="sb-section-body">{props.children}</div>}
    </section>
  )
}
