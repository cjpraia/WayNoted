import { t, getLocale } from '../../i18n'
// Barra superior: navegação, breadcrumbs e ações da página.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, PanelLeft, Lock, MoreHorizontal, Star, Plus, X, FolderInput } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import type { Page } from '../../types'
import { TabMenu } from './TabMenu'
import { PageMenu } from './PageMenu'
import { Popover } from './Popover'
import { relativeTime } from './util'
import { PageIcon as LocalPageIcon } from './PageIcon'
import { PageComments } from './PageComments'
import { MovePageDialog } from '../sidebar/MovePageDialog'
import { BlockIcon } from '../ui/BlockIcon'
import { Icon } from '../ui/icons/Icon'
import { copyText } from '../../clipboard'
import './page.css'
import './topbar.css'
import { toggleLocalGraph, useGraphSettings } from '../../graph/settings'
import { dailyDateOf } from '../../daily/dailyNotes'
import { localDay } from '../../daily/dailyCore'
import { toggleCalendarPanel } from '../../daily/CalendarPanel'
import { CalendarDays } from 'lucide-react'
import { ProductivityIcon } from '../productivity/ProductivityIcon'
import { shortcutHint } from '../../shortcuts'

function useNow(interval = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval])
  return now
}

/** Ícone de um tipo (aba e trilha da coleção do tipo). */
function TypeIcon({ value }: { value: string | null }) {
  return <LocalPageIcon value={value || 'lucide:tag:gray'} className="pg-crumb-emoji" style={{ width: 14, height: 14 }} />
}

function PageIcon({ page, size = 14 }: { page: Page; size?: number }) {
  return page.icon ? (
    <LocalPageIcon value={page.icon} className="pg-crumb-emoji" style={{ width: size, height: size }} />
  ) : (
    <BlockIcon name={page.database ? 'database-full-page' : 'page'} size={size} className="pg-crumb-svg" />
  )
}

function Crumb({ page, current }: { page: Page; current?: boolean }) {
  return (
    <button className={`pg-crumb${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => actions.openPage(page.id)} title={page.title || (page.database ? t("Sem título", "Untitled") : t("Nova página", "New page"))}>
      <PageIcon page={page} />
      <span className="pg-crumb-title">{page.title || (page.database ? t("Sem título", "Untitled") : t("Nova página", "New page"))}</span>
      {current && dailyDateOf(page.id) === localDay() && <span className="pg-crumb-today">{t("Hoje", "Today")}</span>}
    </button>
  )
}

function Breadcrumbs({ page }: { page: Page }) {
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const chain = [...selectors.ancestors(page.id), page]
  const collapse = chain.length > 4
  const hidden = collapse ? chain.slice(1, chain.length - 2) : []
  const visible = collapse ? [chain[0], null, ...chain.slice(-2)] : chain

  return (
    <nav className="pg-crumbs" aria-label={t("Caminho da página", "Page path")}>
      {visible.map((p, i) => (
        <span className="pg-crumb-item" key={p ? p.id : 'more'}>
          {i > 0 && <span className="pg-crumb-sep">/</span>}
          {p ? (
            <Crumb page={p} current={p.id === page.id} />
          ) : (
            <button ref={moreRef} className="pg-crumb pg-crumb-more" aria-label={t("Mostrar caminho completo", "Show full path")} aria-expanded={hiddenOpen} aria-haspopup="menu" onClick={() => setHiddenOpen((v) => !v)}>
              …
            </button>
          )}
        </span>
      ))}
      {hiddenOpen && (
        <Popover anchor={moreRef.current} onClose={() => setHiddenOpen(false)} className="pg-menu" width={240}>
          <div className="pg-menu-section">
            {hidden.map((p) => (
              <button
                key={p.id}
                className="pg-menu-item"
                onClick={() => {
                  setHiddenOpen(false)
                  actions.openPage(p.id)
                }}
              >
                <span className="pg-menu-icon">
                  <PageIcon page={p} size={16} />
                </span>
                <span className="pg-menu-label">{p.title || t("Sem título", "Untitled")}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </nav>
  )
}

/** Ícone de link próprio, traço fino (dois elos inclinados). */
function LinkIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.25 11.75a3.9 3.9 0 0 0 5.5 0l3.25-3.25a3.9 3.9 0 0 0-5.5-5.5l-1.25 1.25" />
      <path d="M11.75 8.25a3.9 3.9 0 0 0-5.5 0L3 11.5a3.9 3.9 0 0 0 5.5 5.5l1.25-1.25" />
    </svg>
  )
}

/** Copia o link interno da página e mostra um retorno discreto sob o botão. */
function CopyLinkButton({ pageId }: { pageId: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { setStatus('idle') }, [pageId])
  const copy = async () => {
    if (timer.current) clearTimeout(timer.current)
    try {
      await copyText(`workspace://page/${pageId}`)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    timer.current = setTimeout(() => setStatus('idle'), 1800)
  }
  return (
    <span className="pg-tb-copy">
      <button className="pg-tb-btn" title={t("Copiar link", "Copy link")} aria-label={t("Copiar link da página", "Copy page link")} onClick={() => void copy()}>
        <LinkIcon />
      </button>
      <span className={`pg-tb-copy-note${status !== 'idle' ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {status === 'copied' ? t("Link copiado", "Link copied") : status === 'failed' ? t("Não foi possível copiar", "Could not copy") : ''}
      </span>
    </span>
  )
}

export function Topbar() {
  const state = useStore()
  const localGraphOpen = useGraphSettings().local.open
  const now = useNow()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [moving, setMoving] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const { route, settings } = state
  const page = route.type === 'page' ? selectors.page(route.id) : undefined
  const routeType = route.type === 'objectType' ? settings.objectTypes?.find(type => type.id === route.id) : undefined

  useEffect(() => { setMenuOpen(false); setMoving(false) }, [route])

  const tabs = settings.openTabs ?? []
  // Painel de calendário (src/daily): desligado por padrão; ⌘⇧C alterna.
  const calendarOpen = !!settings.dailyFlow?.panelOpen
  const calendarToggle = <button className={`pg-tb-btn${calendarOpen ? ' is-active' : ''}`} title={`${t("Painel de calendário", "Calendar panel")} (${shortcutHint('calendar-panel')})`} aria-label={t("Painel de calendário", "Calendar panel")} aria-pressed={calendarOpen} onClick={() => toggleCalendarPanel()}><CalendarDays size={18} strokeWidth={1.7} /></button>
  return (
    <>
    <div className={`shell-tabs${settings.sidebarCollapsed ? ' is-collapsed' : ''}`}>
      <div className="shell-tabs-nav">
        {settings.sidebarCollapsed && (
          <button
            className="shell-nav-btn shell-nav-sidebar"
            title={`${t("Abrir barra lateral", "Show sidebar")} (${shortcutHint('sidebar')})`}
            aria-label={t("Abrir barra lateral", "Show sidebar")}
            onClick={() => actions.updateSettings({ sidebarCollapsed: false })}
          >
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
        )}
        <button className="shell-nav-btn" title={`${t("Voltar", "Back")} (${shortcutHint('back-forward', 0)})`} aria-label={t("Voltar", "Back")} disabled={!selectors.canGoBack()} onClick={actions.goBack}>
          <ChevronLeft size={18} strokeWidth={1.6} />
        </button>
        <button className="shell-nav-btn" title={`${t("Avançar", "Forward")} (${shortcutHint('back-forward', 1)})`} aria-label={t("Avançar", "Forward")} disabled={!selectors.canGoForward()} onClick={actions.goForward}>
          <ChevronRight size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className="shell-tabs-list" role="tablist" aria-label={t("Abas abertas", "Open tabs")}>
        {tabs.map(tab => {
          const tabPage = tab.route.type === 'page' ? selectors.page(tab.route.id) : undefined
          const tabType = tab.route.type === 'objectType' ? settings.objectTypes?.find(type => type.id === (tab.route as { id: string }).id) : undefined
          const title = tabType ? tabType.name : tab.route.type === 'home' ? t("Meu dia", "My day") : tab.route.type === 'graph' ? t("Grafo", "Graph") : tab.route.type === 'productivity' ? t("Produtividade", "Productivity") : tab.route.type === 'tasks' ? t("Tarefas", "Tasks") : tab.route.type === 'review' ? t("Revisão", "Review") : tabPage?.title || (tabPage?.database ? t("Sem título", "Untitled") : t("Nova página", "New page"))
          const active = settings.activeTabId === tab.id
          return <div className={`shell-tab${active ? ' is-active' : ''}${tab.pinned ? ' is-pinned' : ''}${tab.pinned && !tabs[tabs.indexOf(tab) + 1]?.pinned ? ' is-pin-end' : ''}${tab.group ? ' is-grouped' : ''}`} key={tab.id} onContextMenu={event => { event.preventDefault(); setTabMenu({ id: tab.id, anchor: event.currentTarget }) }}>
            {tab.group && tabs.find(item => item.group?.id === tab.group?.id)?.id === tab.id && <span className="shell-tab-group">{tab.group.name}</span>}
            <button className="shell-tab-select" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => actions.activateTab(tab.id)} onKeyDown={event => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setTabMenu({ id: tab.id, anchor: event.currentTarget }); return }
              const index = tabs.findIndex(item => item.id === tab.id)
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
              if (next >= 0) { event.preventDefault(); actions.activateTab(tabs[next].id); event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus() }
            }} title={tab.pinned ? `${title} · ${t("Fixada", "Pinned")}` : title} aria-label={tab.pinned ? `${title}, ${t("Fixada", "Pinned")}` : undefined}>{tabPage ? <PageIcon page={tabPage} /> : tabType ? <TypeIcon value={tabType.icon} /> : tab.route.type === 'graph' ? <Icon name="graph" size={14} /> : tab.route.type === 'productivity' ? <ProductivityIcon size={14} /> : tab.route.type === 'tasks' ? <Icon name="tasks" size={14} /> : tab.route.type === 'review' ? <Icon name="review" size={14} /> : <Icon name="home" size={14} />}<span>{title}</span></button>
            {tab.pinned && <button className="shell-tab-pin" onClick={() => actions.pinTab(tab.id)} title={t("Fixada · clique para desafixar", "Pinned · click to unpin")} aria-label={t("Desafixar aba {title}", "Unpin tab {title}", {title})}>
              <svg className="pin-on" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2.5h4l-.6 3.2 2.1 2.3H4.5l2.1-2.3L6 2.5Z" /><path d="M8 8v5.5" /></svg>
              <svg className="pin-off" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2.5h4l-.6 3.2 2.1 2.3H4.5l2.1-2.3L6 2.5Z" /><path d="M8 8v5.5" /><path d="M2.5 2.5l11 11" /></svg>
            </button>}
            {!tab.pinned && <button className="shell-tab-close" onClick={() => actions.closeTab(tab.id)} title={t("Fechar {title}", "Close {title}", {title})} aria-label={t("Fechar aba {title}", "Close tab {title}", {title})}><X size={14} strokeWidth={1.6} /></button>}
          </div>
        })}
      </div>
      <button className="shell-tab-add" aria-label={t("Nova aba", "New tab")} title={`${t("Nova aba", "New tab")} (${shortcutHint('new-tab')})`} onClick={() => actions.openInNewTab({ type: 'home' })}><Plus size={18} strokeWidth={1.6} /></button>
    </div>
    {tabMenu && tabs.some(tab => tab.id === tabMenu.id) && <TabMenu tab={tabs.find(tab => tab.id === tabMenu.id)!} anchor={tabMenu.anchor} onClose={() => setTabMenu(null)} />}
    <header className={`pg-topbar${settings.sidebarCollapsed ? ' is-collapsed' : ''}`}>
      <div className="pg-tb-left">
        {page ? (
          <Breadcrumbs page={page} />
        ) : (
          <nav className="pg-crumbs" aria-label={t("Caminho da página", "Page path")}>
            <span className="pg-crumb is-current is-static">
              {routeType ? <TypeIcon value={routeType.icon} /> : route.type === 'graph' ? <Icon name="graph" size={14} className="pg-crumb-svg" /> : route.type === 'productivity' ? <ProductivityIcon size={14} className="pg-crumb-svg" /> : route.type === 'tasks' ? <Icon name="tasks" size={14} className="pg-crumb-svg" /> : route.type === 'review' ? <Icon name="review" size={14} className="pg-crumb-svg" /> : <Icon name="home" size={14} className="pg-crumb-svg" />}
              <span className="pg-crumb-title">{routeType ? `${t('Tipos', 'Types')} › ${routeType.name}` : route.type === 'graph' ? t("Grafo", "Graph") : route.type === 'productivity' ? t("Produtividade", "Productivity") : route.type === 'tasks' ? t("Tarefas", "Tasks") : route.type === 'review' ? t("Revisão", "Review") : t("Meu dia", "My day")}</span>
            </span>
          </nav>
        )}
        {page?.locked && (
          <button className="pg-locked-badge" title={t("Clique para desbloquear", "Click to unlock")} onClick={() => actions.updatePage(page.id, { locked: false }, false)}>
            <Lock size={12} strokeWidth={2.2} /> {page.database ? t("Visualizações bloqueadas", "Views locked") : t("Bloqueada", "Locked")}
          </button>
        )}
      </div>

      {!page && <div className="pg-tb-right">{calendarToggle}</div>}
      {page && (
        <div className="pg-tb-right">
          <span className="pg-tb-edited" title={new Date(page.updatedAt).toLocaleString(getLocale())}>
            {t("Editado", "Edited")} {relativeTime(page.updatedAt, now, getLocale())}
          </span>
          {!selectors.parentDatabase(page.id) && <PageComments key={page.id} page={page} />}
          <button className={`pg-tb-btn${localGraphOpen ? ' is-active' : ''}`} title={t("Grafo local", "Local graph")} aria-label={t("Grafo local", "Local graph")} aria-pressed={localGraphOpen} onClick={() => toggleLocalGraph()}><Icon name="graph" size={18} /></button>
          {calendarToggle}
          <CopyLinkButton pageId={page.id} />
          <button className="pg-tb-btn" title={t("Mover página para…", "Move page to…")} aria-label={t("Mover página para", "Move page to")} onClick={() => setMoving(true)}><FolderInput size={18} strokeWidth={1.7} /></button>
          <button
            className={`pg-tb-btn${page.favorite ? ' is-fav' : ''}`}
            title={page.favorite ? t("Remover dos favoritos", "Remove from favorites") : t("Adicionar aos favoritos", "Add to favorites")}
            onClick={() => actions.toggleFavorite(page.id)}
          >
            <Star size={18} strokeWidth={1.7} fill={page.favorite ? 'currentColor' : 'none'} />
          </button>
          <button ref={menuRef} className={`pg-tb-btn${menuOpen ? ' is-active' : ''}`} title={t("Estilo, exportar e mais", "Style, export, and more")} onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && <PageMenu page={page} anchor={menuRef.current} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </header>
    {page && moving && <MovePageDialog pageId={page.id} onClose={() => setMoving(false)} />}
    </>
  )
}
