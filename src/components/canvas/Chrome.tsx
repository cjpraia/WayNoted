// Interface ao redor do quadro: barra de ferramentas inferior, zoom, minimapa, menu, busca, seletor de páginas e painel de propriedades.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { foldSearch } from '../../workspace'
import { lockedAncestor } from '../../security/pageLock'
import { CANVAS_COLORS, NOTE_COLORS, isBox, isCard, swatch, inkColor, type CanvasColor, type CanvasObject, type ShapeKind } from '../../canvas/model'
import { objectBounds, type Align, type Point } from '../../canvas/geometry'
import type { SpatialIndex } from '../../canvas/spatial'
import type { View } from '../../canvas/render'
import { viewRect } from '../../canvas/render'
import { lookupOf, type Reorder } from '../../canvas/ops'
import { PageIcon } from '../page/PageIcon'
import { IconButton as UiIconButton } from '../ui/Button'
import { CanvasIcon, type CanvasIconName } from './icons'
import { TOOL_KEY_OF, type Tool } from './tools'

export function IconButton({ icon, label, active, onClick, disabled, kbd, size = 18, danger }: { icon: CanvasIconName; label: string; active?: boolean; onClick(): void; disabled?: boolean; kbd?: string; size?: number; danger?: boolean }) {
  return <UiIconButton label={label} className={danger ? 'is-danger' : undefined} aria-pressed={active ?? undefined} title={kbd ? `${label} (${kbd})` : label} disabled={disabled} onClick={onClick}><CanvasIcon name={icon} size={size} /></UiIconButton>
}

export const COLOR_NAMES: Record<CanvasColor, [string, string]> = { default: ['Padrão', 'Default'], gray: ['Cinza', 'Gray'], brown: ['Marrom', 'Brown'], orange: ['Laranja', 'Orange'], yellow: ['Amarelo', 'Yellow'], green: ['Verde', 'Green'], blue: ['Azul', 'Blue'], purple: ['Roxo', 'Purple'], pink: ['Rosa', 'Pink'], red: ['Vermelho', 'Red'] }

export function Swatches({ colors, value, onPick, ink }: { colors: readonly CanvasColor[]; value?: CanvasColor; onPick(c: CanvasColor): void; ink?: boolean }) {
  const { t } = useI18n()
  const { settings } = useStore()
  const dark = document.documentElement.dataset.theme === 'dark' || (settings.theme === 'dark')
  return <div className="cv-swatches" role="radiogroup" aria-label={t('Cor', 'Colour')}>
    {colors.map(c => <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t(...COLOR_NAMES[c])} title={t(...COLOR_NAMES[c])}
      className={`cv-swatch${value === c ? ' is-active' : ''}`} style={{ background: ink ? inkColor(c, dark) : swatch(c, dark)[0], borderColor: swatch(c, dark)[2] }} onClick={() => onPick(c)} />)}
  </div>
}

export function ZoomControls({ zoom, onZoom, onReset, onFit, minimap, onMinimap }: { zoom: number; onZoom(f: number): void; onReset(): void; onFit(): void; minimap: boolean; onMinimap(): void }) {
  const { t } = useI18n()
  return <div className="cv-zoom" role="group" aria-label={t('Zoom', 'Zoom')}>
    <IconButton icon="zoomOut" label={t('Diminuir zoom', 'Zoom out')} kbd="−" onClick={() => onZoom(0.8)} size={16} />
    <button type="button" className="cv-zoom-value" title={t('Zoom 100% (0)', 'Zoom to 100% (0)')} onClick={onReset}>{Math.round(zoom * 100)}%</button>
    <IconButton icon="zoomIn" label={t('Aumentar zoom', 'Zoom in')} kbd="+" onClick={() => onZoom(1.25)} size={16} />
    <IconButton icon="fit" label={t('Ajustar à tela', 'Zoom to fit')} kbd="⇧1" onClick={onFit} size={16} />
    <IconButton icon="minimap" label={t('Minimapa', 'Minimap')} active={minimap} onClick={onMinimap} size={16} />
  </div>
}

// ---------- minimapa ----------

export interface MinimapHandle { draw(): void }
const MM_W = 200, MM_H = 132

export function Minimap({ handleRef, getObjects, getIndex, getView, onCenter, theme }: { handleRef: MutableRefObject<MinimapHandle | null>; getObjects(): readonly CanvasObject[]; getIndex(): SpatialIndex; getView(): View; onCenter(p: Point, animate: boolean): void; theme: 'light' | 'dark' }) {
  const { t } = useI18n()
  const ref = useRef<HTMLCanvasElement>(null)
  const mapping = useRef({ s: 1, ox: 0, oy: 0 })
  useEffect(() => {
    let scheduled = 0
    const draw = () => {
      scheduled = 0
      const canvas = ref.current, ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== MM_W * dpr) { canvas.width = MM_W * dpr; canvas.height = MM_H * dpr }
      const index = getIndex(), view = getView(), vr = viewRect(view)
      const extent = index.extent()
      const area = extent ? { x: Math.min(extent.x, vr.x), y: Math.min(extent.y, vr.y), w: 0, h: 0 } : { ...vr }
      if (extent) { area.w = Math.max(extent.x + extent.w, vr.x + vr.w) - area.x; area.h = Math.max(extent.y + extent.h, vr.y + vr.h) - area.y }
      const pad = 8
      const s = Math.min((MM_W - pad * 2) / Math.max(1, area.w), (MM_H - pad * 2) / Math.max(1, area.h))
      const ox = pad + ((MM_W - pad * 2) - area.w * s) / 2 - area.x * s, oy = pad + ((MM_H - pad * 2) - area.h * s) / 2 - area.y * s
      mapping.current = { s, ox, oy }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, MM_W, MM_H)
      const dark = theme === 'dark'
      for (const o of getObjects()) {
        const r = index.bounds(o.id)
        if (!r || o.type === 'connector') continue
        ctx.fillStyle = isCard(o) ? (dark ? 'rgba(255,255,255,0.5)' : 'rgba(55,53,47,0.45)') : o.type === 'section' ? (dark ? 'rgba(255,255,255,0.08)' : 'rgba(55,53,47,0.07)') : 'note' === o.type || o.type === 'shape' ? swatch((o as { color: CanvasColor }).color, dark)[2] : (dark ? 'rgba(255,255,255,0.3)' : 'rgba(55,53,47,0.25)')
        ctx.fillRect(ox + r.x * s, oy + r.y * s, Math.max(1.5, r.w * s), Math.max(1.5, r.h * s))
      }
      const tokens = getComputedStyle(canvas)
      ctx.strokeStyle = tokens.getPropertyValue('--accent').trim() || (dark ? '#4fc1b1' : '#0f766e'); ctx.lineWidth = 1.5
      ctx.fillStyle = tokens.getPropertyValue('--accent-bg').trim() || 'rgba(15,118,110,0.1)'
      ctx.fillRect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s)
      ctx.strokeRect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s)
    }
    handleRef.current = { draw: () => { if (!scheduled) scheduled = requestAnimationFrame(draw) } }
    draw()
    return () => { handleRef.current = null; cancelAnimationFrame(scheduled) }
  }, [theme])
  const toWorld = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect(), m = mapping.current
    return { x: (e.clientX - rect.left - m.ox) / m.s, y: (e.clientY - rect.top - m.oy) / m.s }
  }
  return <canvas ref={ref} className="cv-minimap" style={{ width: MM_W, height: MM_H }} role="img" aria-label={t('Minimapa: clique para mover a visão', 'Minimap: click to move the view')}
    onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onCenter(toWorld(e), true) }}
    onPointerMove={e => { if (e.buttons & 1) onCenter(toWorld(e), false) }} />
}

// ---------- menu superior ----------

export function BoardMenu({ settings, hasSelection, onGrid, onSnap, onFind, onExport, readOnly, layers, onLayers }: { layers?: boolean; onLayers?(): void; settings: { grid: boolean; snap: boolean }; hasSelection: boolean; onGrid(): void; onSnap(): void; onFind(): void; onExport(format: 'png' | 'svg' | 'pdf', selection: boolean): void; readOnly: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'all' | 'selection'>('all')
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div className="cv-menu" ref={wrap}>
    <IconButton icon="find" label={t('Buscar na lousa', 'Find on whiteboard')} kbd="⌘F" onClick={onFind} />
    {onLayers && <IconButton icon="layers" label={t('Camadas', 'Layers')} active={!!layers} onClick={onLayers} />}
    {!readOnly && <IconButton icon="grid" label={t('Grade', 'Grid')} active={settings.grid} onClick={onGrid} />}
    {!readOnly && <IconButton icon="snap" label={t('Alinhar a objetos (snap)', 'Snap to objects')} active={settings.snap} onClick={onSnap} />}
    <IconButton icon="export" label={t('Exportar lousa', 'Export whiteboard')} active={open} onClick={() => setOpen(!open)} />
    {open && <div className="cv-pop cv-export" role="menu" aria-label={t('Exportar lousa', 'Export whiteboard')}>
      <div className="cv-seg" role="radiogroup">
        <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>{t('Lousa inteira', 'Whole whiteboard')}</button>
        <button type="button" role="radio" aria-checked={scope === 'selection'} className={scope === 'selection' ? 'is-active' : ''} disabled={!hasSelection} onClick={() => setScope('selection')}>{t('Seleção', 'Selection')}</button>
      </div>
      {(['png', 'svg', 'pdf'] as const).map(format => <button key={format} type="button" role="menuitem" className="cv-pop-item" onClick={() => { setOpen(false); onExport(format, scope === 'selection' && hasSelection) }}>{format.toUpperCase()}<span>{format === 'png' ? t('Imagem 2×', 'Image 2×') : format === 'svg' ? t('Vetorial', 'Vector') : t('Documento (app desktop)', 'Document (desktop app)')}</span></button>)}
    </div>}
  </div>
}

// ---------- busca no quadro ----------

export function FindBar({ search, onGo, onClose }: { search(q: string): string[]; onGo(id: string): void; onClose(): void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => search(query), [query])
  useEffect(() => setIndex(0), [query])
  const go = (step: number) => { if (!results.length) return; const next = (index + step + results.length) % results.length; setIndex(next); onGo(results[next]) }
  return <div className="cv-find" role="search">
    <CanvasIcon name="find" size={16} />
    <input autoFocus value={query} placeholder={t('Buscar na lousa', 'Find on whiteboard')} aria-label={t('Buscar na lousa', 'Find on whiteboard')}
      onChange={e => setQuery(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : results.length && index === 0 && !e.repeat ? 0 : 1) } if (e.key === 'Escape') { e.preventDefault(); onClose() } }} />
    <span className="cv-find-count" aria-live="polite">{query ? results.length ? `${index + 1}/${results.length}` : t('Nada', 'None') : ''}</span>
    <UiIconButton label={t('Anterior', 'Previous')} onClick={() => go(-1)} disabled={!results.length}>‹</UiIconButton>
    <UiIconButton label={t('Próximo', 'Next')} onClick={() => go(1)} disabled={!results.length}>›</UiIconButton>
    <UiIconButton label={t('Fechar', 'Close')} onClick={onClose}>×</UiIconButton>
  </div>
}

// ---------- seletor de páginas ----------

export function PagePicker({ excludeId, onPick, onClose }: { excludeId: string; onPick(ids: string[]): void; onClose(): void }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    const q = foldSearch(query.trim())
    return Object.values(pages).filter(p => p.id !== excludeId && selectors.isLive(p.id) && !lockedAncestor(pages, p.id) && (!q || foldSearch(p.title).includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60)
  }, [pages, query])
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [query])
  return <div className="cv-picker-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="cv-picker" role="dialog" aria-label={t('Adicionar página à lousa', 'Add page to whiteboard')}>
      <input autoFocus value={query} placeholder={t('Buscar página ou banco…', 'Search page or database…')} aria-label={t('Buscar página', 'Search page')}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(list.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' && list[active]) onPick([list[active].id])
        }} />
      <div className="cv-picker-list" role="listbox">
        {list.map((page, i) => <button key={page.id} type="button" role="option" aria-selected={i === active} className={`cv-picker-item${i === active ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => onPick([page.id])}>
          <span className="cv-picker-icon">{page.icon ? <PageIcon value={page.icon} /> : <CanvasIcon name={page.database ? 'database' : page.canvas ? 'canvas' : 'page'} size={16} />}</span>
          <span className="cv-picker-title">{page.passwordLock?.hideTitle && !page.passwordLock.unlocked ? t('Página protegida', 'Protected page') : page.title || t('Sem título', 'Untitled')}</span>
          <span className="cv-picker-kind">{page.database ? t('Banco', 'Database') : page.canvas ? t('Lousa', 'Whiteboard') : ''}</span>
        </button>)}
        {!list.length && <div className="cv-picker-empty">{t('Nenhuma página encontrada', 'No pages found')}</div>}
      </div>
    </div>
  </div>
}

