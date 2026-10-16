import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsRight, Expand, Link2, MoreHorizontal, PanelRight, Square, Star } from 'lucide-react'
import { actions, getState, selectors, useStore } from '../store'
import { copyText } from '../clipboard'
import { PageView } from './page/PageView'
import { CanvasView } from './canvas/CanvasView'
import { DatabaseView } from './database/DatabaseView'
import { PageMenu } from './page/PageMenu'
import { useI18n } from '../i18n'
import { flushDoc } from './page/util'
import { assertCanClose } from '../close-guards'
import { clampPeekWidth } from './peekSizing'
import './PagePeek.css'
import { shortcutHint } from '../shortcuts'

export function PagePeek({ theme }: { theme: 'light' | 'dark' }) {
  const { peekPageId, peekMode, peekWidth, peekRowIds, settings } = useStore()
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLButtonElement>(null)
  const [modeOpen, setModeOpen] = useState(false), [menuOpen, setMenuOpen] = useState(false), [busy, setBusy] = useState(false)
  const alive = useRef(true), pending = useRef(false)
  const resizeCleanup = useRef<(() => void) | null>(null)
  const change = useCallback(async (next: () => void) => {
    if (pending.current) return
    pending.current = true; setBusy(true)
    const id = getState().peekPageId
    try { if (id) await flushDoc(id); await actions.flushMeta(); assertCanClose(); if (alive.current && getState().peekPageId === id) next() }
    catch (error) { actions.reportSaveError(error) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }, [])
  const bounds = useCallback((width: number) => clampPeekWidth(width, window.innerWidth, document.querySelector('.sb')?.getBoundingClientRect().width ?? document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0), [])
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null
    return () => { alive.current = false; resizeCleanup.current?.(); previous?.isConnected && previous.focus() }
  }, [])
  useEffect(() => {
    const resize = () => actions.setPeekWidth(bounds(getState().peekWidth))
    resize(); window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [bounds, settings?.sidebarWidth, settings?.sidebarCollapsed])
  useEffect(() => {
    if (peekMode === 'center' && !ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (modeOpen || menuOpen) { setModeOpen(false); setMenuOpen(false); e.preventDefault(); return }
        e.preventDefault(); void change(actions.closePeek)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); void change(actions.closePeek) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); const id = getState().peekPageId; if (id) void change(() => actions.openPage(id)) }
      else if (e.key === 'Tab' && peekMode === 'center') {
        const focusable = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea,[contenteditable="true"],[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0)
        const first = focusable[0], last = focusable.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [change, peekMode, modeOpen, menuOpen])
  const page = peekPageId ? selectors.page(peekPageId) : undefined
  if (!page) return null
  const siblings = peekRowIds ? peekRowIds.flatMap(id => { const row = selectors.page(id); return row && selectors.isLive(id) ? [row] : [] }) : selectors.children(page.parentId)
  const index = siblings.findIndex(p => p.id === page.id)
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    resizeCleanup.current?.()
    const target = e.currentTarget, pointerId = e.pointerId
    try { target.setPointerCapture?.(pointerId) } catch { /* Pointer capture may be unavailable. */ }
    const start = e.clientX, width = peekWidth
    let moved = false
    const move = (event: PointerEvent) => { if (Math.abs(event.clientX - start) > 3) moved = true; if (moved) actions.setPeekWidth(bounds(width + start - event.clientX)) }
    const finish = (event: PointerEvent) => { move(event); cleanup(); if (!moved) void change(actions.closePeek) }
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cleanup); window.removeEventListener('blur', cleanup); try { if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId) } catch { /* Already released. */ } document.body.classList.remove('peek-resizing'); resizeCleanup.current = null }
    resizeCleanup.current = cleanup; document.body.classList.add('peek-resizing')
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cleanup); window.addEventListener('blur', cleanup)
  }
  return <div className={`peek-backdrop peek-${peekMode}`} onMouseDown={e => peekMode === 'center' && e.target === e.currentTarget && void change(actions.closePeek)}>
    <div ref={ref} className="peek-panel" role="dialog" aria-modal={peekMode === 'center'} aria-label={page.title || t('Nova página', 'New page')}>
      {peekMode === 'side' && <div className="peek-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('Redimensionar prévia', 'Resize preview')} aria-valuenow={peekWidth} aria-valuemin={bounds(0)} aria-valuemax={bounds(Infinity)} title={t('Clique para fechar · Arraste para redimensionar', 'Click to close · Drag to resize')} onPointerDown={resize} onKeyDown={e => {
        if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); actions.setPeekWidth(bounds(e.key === 'Home' ? 0 : e.key === 'End' ? Infinity : peekWidth + (e.key === 'ArrowLeft' ? 32 : -32))) }
        if (e.key === 'Enter') { e.preventDefault(); void change(actions.closePeek) }
      }} />}
      <div className="peek-toolbar">
        <button disabled={busy} aria-label={t('Fechar prévia', 'Close preview')} title={`${t('Fechar', 'Close')} (${shortcutHint('sidebar')})`} onClick={() => void change(actions.closePeek)}><ChevronsRight size={18} /></button>
        <button disabled={busy} aria-label={t('Abrir em página inteira', 'Open full page')} title={t('Abrir em página inteira (⌘↵)', 'Open full page (⌘↵)')} onClick={() => void change(() => actions.openPage(page.id))}><Expand size={16} /></button>
        <div className="peek-mode-wrap"><button aria-label={t('Modo de abertura', 'Open mode')} aria-expanded={modeOpen} onClick={() => setModeOpen(!modeOpen)}>{peekMode === 'side' ? <PanelRight size={18} /> : <Square size={18} />}</button>
          {modeOpen && <div className="peek-mode-menu" role="menu">{(['side','center','full'] as const).map(mode => <button key={mode} role="menuitemradio" aria-checked={peekMode === mode} onClick={() => { setModeOpen(false); if (mode === 'full') void change(() => actions.openPage(page.id)); else actions.openPeek(page.id, mode) }}>{mode === 'side' ? t('Prévia lateral', 'Side peek') : mode === 'center' ? t('Prévia central', 'Center peek') : t('Página inteira', 'Full page')}</button>)}</div>}
        </div>
        <button disabled={busy || index <= 0} aria-label={t('Página anterior','Previous page')} onClick={() => void change(() => actions.openPeek(siblings[index - 1].id, peekMode))}><ChevronUp size={18} /></button>
        <button disabled={busy || index < 0 || index >= siblings.length - 1} aria-label={t('Próxima página','Next page')} onClick={() => void change(() => actions.openPeek(siblings[index + 1].id, peekMode))}><ChevronDown size={18} /></button>
        <span className="peek-toolbar-space" />
        <button aria-label={t('Copiar link da página', 'Copy page link')} onClick={() => void copyText(`workspace://page/${page.id}`).catch(actions.reportSaveError)}><Link2 size={18} /></button>
        <button aria-label={t('Favorito', 'Favorite')} aria-pressed={page.favorite} onClick={() => actions.toggleFavorite(page.id)}><Star size={18} fill={page.favorite ? 'currentColor' : 'none'} /></button>
        <button ref={menuRef} aria-label={t('Menu da página', 'Page menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={18} /></button>
        {menuOpen && <PageMenu page={page} anchor={menuRef.current} onClose={() => setMenuOpen(false)} />}
      </div>
      <div className="peek-content">{page.database ? <DatabaseView key={page.id} pageId={page.id} /> : page.canvas ? <CanvasView key={page.id} pageId={page.id} theme={theme} embedded /> : <PageView key={page.id} pageId={page.id} theme={theme} />}</div>
    </div>
  </div>
}
