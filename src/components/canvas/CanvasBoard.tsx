import COMPAT from '../../../shared/compatibility.ts'
// Superfície interativa do quadro: canvas da cena + canvas de sobreposição + camada DOM dos cartões.
// Estado quente (objetos, visão, gesto) vive em refs; o React só re-renderiza cartões, painéis e seleção.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { actions, getState, subscribe } from '../../store'
import { useI18n, t as tNow } from '../../i18n'
import { foldSearch } from '../../workspace'
import { fontOf, BOX_TYPES, DEFAULT_SIZE, GRID_SIZE, isBox, isCard, isConnector, MAX_FILE_BYTES, objectText, rotatable, type BoxObject, type CanvasColor, type CanvasData, type CanvasObject, type ConnectorEnd, type ConnectorObject, type ShapeKind } from '../../canvas/model'
import { lassoSelect, nearestDistances, alignOffsets, boxBounds, center, connectorGeometry, distributeOffsets, distToPolyline, geometryPolyline, handleAt, hitObject, hitTest, midpointOf, normRect, objectBounds, rectsIntersect, containsRect, resizeRect, rotatePoint, rotationFor, sectionMembers, snapRect, snapToGrid, transformObject, translateObject, unionRects, type Align, type Guide, type Handle, type Lookup, type Point, type Rect } from '../../canvas/geometry'
import { SpatialIndex } from '../../canvas/spatial'
import { samplePressure, wheelIntent } from '../../canvas/gestures'
import { CanvasHistory } from '../../canvas/history'
import { collectForCopy, createBox, createConnector, deleteObjects, duplicateObjects, freezeConnectorEnds, groupObjects, lookupOf, parseClipboard, pasteObjects, patchObjects, reorder, serializeClipboard, simplifySamples, strokeFromSamples, strokesAt, ungroupObjects, withGroups, type Reorder } from '../../canvas/ops'
import { DEAD_LABEL, drawOverlay, drawScene, toScreen, toWorld, viewRect, NOTE_FONT, SHAPE_FONT, SECTION_FONT, type Overlay, type View } from '../../canvas/render'
import { BoardCard } from './Cards'
import { cardFor, cardInfo, exportCanvas, paletteFor, registerBoard } from './canvasActions'
import { BoardMenu, FindBar, Minimap, PagePicker, ZoomControls, type MinimapHandle } from './Chrome'
import { BoardToolbar } from './Toolbar'
import { BoardInspector } from './Inspector'
import { BoardLayers } from './Layers'
import { moveLayer } from '../../canvas/layers'
import { CANVAS_TEMPLATES, type TemplateId } from '../../canvas/templates'
import { libraryItem, type CanvasLibraryItem } from '../../canvas/library'
import { sceneFromPng, sceneFromSvg } from '../../canvas/scene'
import { TOOL_KEYS, type Tool } from './tools'

const PAGE_DND = COMPAT.record027
export const MIN_ZOOM = 0.05, MAX_ZOOM = 4
/** Zoom below which cards are painted by the canvas instead of DOM. */
export const CARD_DOM_MIN = 0.22
/** Live editors: zoom, on-screen width and count limits. */
export const LIVE_MIN_ZOOM = 0.45, LIVE_MIN_WIDTH = 160, MAX_LIVE = 6
/** DOM cards: minimum on-screen width and maximum count (others are painted on the canvas). */
export const DOM_CARD_MIN_WIDTH = 110, MAX_DOM_CARDS = 60

type Gesture =
  | { kind: 'pan'; start: Point; tx: number; ty: number }
  | { kind: 'move'; start: Point; ids: Set<string>; base: CanvasObject[]; moved: boolean; clicked: string; additive: boolean }
  | { kind: 'marquee'; start: Point; additive: boolean; base: Set<string> }
  | { kind: 'lasso'; points: Point[]; additive: boolean; base: Set<string> }
  | { kind: 'resize'; handle: Exclude<Handle, 'rotate'>; start: Point; bounds: Rect; ids: Set<string>; base: CanvasObject[]; single: BoxObject | null }
  | { kind: 'rotate'; id: string; base: CanvasObject[] }
  | { kind: 'create'; type: 'note' | 'text' | 'shape' | 'section'; shape?: ShapeKind; start: Point; dragged: boolean; base: CanvasObject[]; id: string }
  | { kind: 'line'; start: Point; from: ConnectorEnd; arrow: boolean; current: Point }
  | { kind: 'endpoint'; id: string; which: 'from' | 'to'; base: CanvasObject[] }
  | { kind: 'pen'; samples: number[] }
  | { kind: 'erase'; base: CanvasObject[]; removed: Set<string> }

interface Props {
  pageId: string
  title: string
  data: CanvasData
  readOnly: boolean
  theme: 'light' | 'dark'
  focusId?: string
  onChange(data: CanvasData): void
}

const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !!target.closest('[contenteditable="true"]'))
const viewKey = (pageId: string) => `${COMPAT.record028}${pageId}`
function readSavedView(pageId: string): { cx: number; cy: number; k: number } | null {
  try { const v = JSON.parse(localStorage.getItem(viewKey(pageId)) ?? 'null'); return v && [v.cx, v.cy, v.k].every(Number.isFinite) ? v : null } catch { return null }
}

function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) { reject(new Error(tNow('O arquivo excede 8 MB.', 'The file exceeds 8 MB.'))); return }
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        let w = img.naturalWidth || 320, h = img.naturalHeight || 240
        // Imagens grandes são reduzidas (≤ 2048 px) para manter o documento do quadro leve.
        const max = 2048
        if (Math.max(w, h) > max && typeof document !== 'undefined') {
          const scale = max / Math.max(w, h), canvas = document.createElement('canvas')
          canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale)
          const ctx = canvas.getContext('2d')
          if (ctx) { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve({ src: canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9), w: canvas.width, h: canvas.height }); return }
        }
        resolve({ src, w, h })
      }
      img.onerror = () => resolve({ src, w: 320, h: 240 })
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}
function readDataFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) { reject(new Error(tNow('O arquivo excede 8 MB.', 'The file exceeds 8 MB.'))); return }
    const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file)
  })
}

export const CanvasBoard = memo(function CanvasBoard({ pageId, title, data, readOnly, theme, focusId, onChange }: Props) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<MinimapHandle | null>(null)
  const objectsRef = useRef<CanvasObject[]>(data.objects)
  const settingsRef = useRef({ grid: data.grid !== false, snap: data.snap !== false })
  const draftRef = useRef<CanvasObject[] | null>(null)
  const indexRef = useRef(new SpatialIndex())
  const indexDirty = useRef(true)
  const lookupRef = useRef<Lookup>(lookupOf(data.objects))
  const viewRef = useRef<View>({ k: 1, tx: 0, ty: 0, w: 0, h: 0 })
  const historyRef = useRef(new CanvasHistory())
  const gestureRef = useRef<Gesture | null>(null)
  const overlayExtra = useRef<Partial<Overlay>>({})
  const frame = useRef(0)
  const spaceRef = useRef(false)
  const pointerWorld = useRef<Point>({ x: 0, y: 0 })
  const createdRef = useRef(new Set<string>())
  const images = useRef(new Map<string, HTMLImageElement | null>())
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly
  const themeRef = useRef(theme); themeRef.current = theme

  const [selection, setSelectionState] = useState<Set<string>>(() => new Set())
  const selectionRef = useRef(selection)
  const [tool, setToolState] = useState<Tool>('select')
  const toolRef = useRef<Tool>('select')
  const [editing, setEditingState] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const activeCardRef = useRef<string | null>(null); activeCardRef.current = activeCard
  const [domCards, setDomCards] = useState<string>('')
  const [liveCards, setLiveCards] = useState<string>('')
  const [revision, setRevision] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState(() => { try { return localStorage.getItem(COMPAT.record029) !== 'off' } catch { return true } })
  const [layersOpen, setLayersOpen] = useState(() => { try { return localStorage.getItem(COMPAT.record030) === 'on' } catch { return false } })
  const [noteColor, setNoteColor] = useState<CanvasColor>('yellow')
  const [notice, setNotice] = useState('')
  const [settings, setSettingsState] = useState(settingsRef.current)
  const [cursor, setCursor] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)

  const current = () => draftRef.current ?? objectsRef.current
  const ensureIndex = () => {
    if (!indexDirty.current) return
    const objects = current()
    lookupRef.current = lookupOf(objects)
    indexRef.current.build(objects, lookupRef.current)
    indexDirty.current = false
  }
  const invalidate = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(render) }, [])
  const markDirty = () => { indexDirty.current = true; invalidate() }

  const setSelection = (ids: Iterable<string>) => {
    const next = new Set(ids)
    const same = next.size === selectionRef.current.size && [...next].every(id => selectionRef.current.has(id))
    if (same) return
    selectionRef.current = next
    setSelectionState(next)
    historyRef.current.seal()
    invalidate()
  }
  const setTool = (next: Tool) => { toolRef.current = next; setToolState(next); setCursor(''); invalidate() }
  const setEditing = (id: string | null) => { editingRef.current = id; setEditingState(id); invalidate() }

  /** Single entry point for changes: history, connector freeze, save. */
  const commit = (next: CanvasObject[], options: { key?: string; select?: string[] } = {}) => {
    draftRef.current = null
    if (readOnlyRef.current) { markDirty(); return }
    if (next === objectsRef.current) { markDirty(); return }
    historyRef.current.record(objectsRef.current, options.key)
    objectsRef.current = freezeConnectorEnds(next)
    onChangeRef.current({ version: 1, objects: objectsRef.current, grid: settingsRef.current.grid, snap: settingsRef.current.snap })
    if (options.select) setSelection(options.select)
    else { const alive = new Set(objectsRef.current.map(o => o.id)); if ([...selectionRef.current].some(id => !alive.has(id))) setSelection([...selectionRef.current].filter(id => alive.has(id))) }
    setRevision(r => r + 1)
    markDirty()
  }
  const updateSettings = (patch: Partial<{ grid: boolean; snap: boolean }>) => {
    settingsRef.current = { ...settingsRef.current, ...patch }
    setSettingsState(settingsRef.current)
    if (!readOnlyRef.current) onChangeRef.current({ version: 1, objects: objectsRef.current, ...settingsRef.current })
    invalidate()
  }

  // ---------- visão ----------
  const persistView = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewChanged = () => {
    invalidate()
    setZoom(viewRef.current.k)
    if (persistView.current) clearTimeout(persistView.current)
    persistView.current = setTimeout(() => {
      const v = viewRef.current
      const c = toWorld(v, { x: v.w / 2, y: v.h / 2 })
      try { localStorage.setItem(viewKey(pageId), JSON.stringify({ cx: c.x, cy: c.y, k: v.k })) } catch { /* Visão é só conveniência. */ }
    }, 300)
  }
  const zoomAt = (screen: Point, factor: number) => {
    const v = viewRef.current
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor))
    const world = toWorld(v, screen)
    v.tx = screen.x - world.x * k; v.ty = screen.y - world.y * k; v.k = k
    viewChanged()
  }
  const animation = useRef(0)
  const animateTo = (target: { k: number; cx: number; cy: number }, duration = 320) => {
    cancelAnimationFrame(animation.current)
    const v = viewRef.current
    const from = { k: v.k, cx: (v.w / 2 - v.tx) / v.k, cy: (v.h / 2 - v.ty) / v.k }
    const start = performance.now()
    const step = (now: number) => {
      const e = Math.min(1, (now - start) / duration), s = 1 - Math.pow(1 - e, 3)
      const k = from.k * Math.pow(target.k / from.k, s)
      const cx = from.cx + (target.cx - from.cx) * s, cy = from.cy + (target.cy - from.cy) * s
      v.k = k; v.tx = v.w / 2 - cx * k; v.ty = v.h / 2 - cy * k
      viewChanged()
      if (e < 1) animation.current = requestAnimationFrame(step)
    }
    animation.current = requestAnimationFrame(step)
  }
  const fitRect = (r: Rect | null, maxK = 1, animate = true) => {
    const v = viewRef.current
    if (!r || !v.w) return
    const pad = 64
    const k = Math.max(MIN_ZOOM, Math.min(maxK, (v.w - pad * 2) / Math.max(1, r.w), (v.h - pad * 2) / Math.max(1, r.h)))
    const target = { k, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }
    if (animate) animateTo(target)
    else { v.k = k; v.tx = v.w / 2 - target.cx * k; v.ty = v.h / 2 - target.cy * k; viewChanged() }
  }
  const fitAll = (animate = true) => { ensureIndex(); fitRect(indexRef.current.extent(), 1, animate) }
  const focusObject = (id: string) => {
    ensureIndex()
    const r = indexRef.current.bounds(id)
    if (!r) return
    setSelection([id])
    fitRect(r, 1)
  }
  /** Apresentação simples: ⌥→ / ⌥← percorre as seções (ordem de leitura) e enquadra cada uma. */
  const sectionCursor = useRef(-1)
  const stepSection = (dir: number) => {
    const sections = objectsRef.current.filter((o): o is BoxObject => o.type === 'section').sort((a, b) => a.y - b.y || a.x - b.x)
    if (!sections.length) { setNotice(tNow('Crie seções para apresentar a lousa.', 'Create sections to present the whiteboard.')); return }
    sectionCursor.current = (sectionCursor.current + dir + sections.length) % sections.length
    const s = sections[sectionCursor.current]
    setSelection([]); fitRect({ x: s.x, y: s.y, w: s.w, h: s.h }, 2)
  }
  const viewCenter = () => { const v = viewRef.current; return toWorld(v, { x: v.w / 2, y: v.h / 2 }) }

  // ---------- desenho ----------
  const cardInfoCache = useRef<{ pages: unknown; map: Map<string, ReturnType<typeof cardInfo>> }>({ pages: null, map: new Map() })
  const infoFor = (pageIdOfCard: string) => {
    const pages = getState().pages
    if (cardInfoCache.current.pages !== pages) cardInfoCache.current = { pages, map: new Map() }
    let info = cardInfoCache.current.map.get(pageIdOfCard)
    if (!info) { info = cardInfo(pages, pageIdOfCard); cardInfoCache.current.map.set(pageIdOfCard, info) }
    return info
  }
  const imageFor = (src: string) => {
    if (images.current.has(src)) return images.current.get(src) ?? null
    images.current.set(src, null)
    const img = new Image()
    img.onload = () => { images.current.set(src, img); invalidate() }
    img.src = src
    return null
  }

  function render() {
    frame.current = 0
    const root = rootRef.current, scene = sceneRef.current, over = overlayRef.current
    if (!root || !scene) return
    ensureIndex()
    const v = viewRef.current
    const lookup = lookupRef.current
    const palette = paletteFor(themeRef.current)
    DEAD_LABEL.value = tNow('página na lixeira', 'page in trash')
    const visibleIds = indexRef.current.visible(viewRect(v, 80))
    const visible = visibleIds.map(id => lookup(id)!).filter(Boolean)
    const dpr = window.devicePixelRatio || 1
    // Cartões DOM só quando legíveis (≥ 110 px na tela) e no máximo MAX_DOM_CARDS (os mais centrais); o resto é pintado no canvas.
    let cardIds: string[] = []
    if (v.k >= CARD_DOM_MIN) {
      const mid = toWorld(v, { x: v.w / 2, y: v.h / 2 })
      const cards = visible.filter(o => isCard(o) && (o as BoxObject).w * v.k >= DOM_CARD_MIN_WIDTH) as BoxObject[]
      cardIds = (cards.length > MAX_DOM_CARDS ? cards.map(o => ({ o, d: Math.hypot(o.x + o.w / 2 - mid.x, o.y + o.h / 2 - mid.y) })).sort((a, b) => a.d - b.d).slice(0, MAX_DOM_CARDS).map(i => i.o) : cards).map(o => o.id)
      if (cards.length > MAX_DOM_CARDS) { const keep = new Set(cardIds); cardIds = visible.filter(o => keep.has(o.id)).map(o => o.id) }
    }
    const skip = new Set(cardIds)
    const hideText = editingRef.current ? new Set([editingRef.current]) : undefined
    const ctx = scene.getContext('2d')
    if (ctx) drawScene(ctx, v, visible, { palette, lookup, grid: settingsRef.current.grid, skip, hideText, card: infoFor, image: imageFor }, dpr, GRID_SIZE)
    const octx = over?.getContext('2d')
    if (octx) {
      const selected = [...selectionRef.current].map(id => lookup(id)).filter((o): o is CanvasObject => !!o)
      const single = selected.length === 1 ? selected[0] : null
      const bounds = single && isBox(single) ? { x: single.x, y: single.y, w: single.w, h: single.h } : unionRects(selected.map(o => objectBounds(o, lookup)))
      // Editando dentro de um cartão: o cartão já mostra a seleção e as alças ficariam por cima dos menus do editor.
      const active = document.activeElement
      const typing = !!active && !!(active as HTMLElement).closest?.('.cv-card.is-live') && root.contains(active)
      if (typing) selected.splice(0, selected.length, ...selected.filter(o => !isCard(o)))
      const editable = !readOnlyRef.current && selected.length > 0 && selected.every(o => !o.locked) && !(single && isConnector(single))
      const showHandles = editable && toolRef.current === 'select' && !editingRef.current
      const quick = showHandles && !gestureRef.current && single && (single.type === 'note' || single.type === 'shape') && v.k >= 0.3 ? quickAddPoints(single, v.k) : undefined
      drawOverlay(octx, v, { selected, bounds, rotation: single && isBox(single) ? single.rotation ?? 0 : 0, canRotate: editable && !!single && rotatable(single), showHandles, sizeBadge: showHandles && !single?.rotation, quickAdd: quick, ...overlayExtra.current }, { palette, lookup }, dpr)
    }
    if (worldRef.current) worldRef.current.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.k})`
    const cardKey = cardIds.join(',')
    setDomCards(prev => prev === cardKey ? prev : cardKey)
    // Editores ao vivo: zoom legível, largura mínima na tela e no máximo MAX_LIVE (ativo/selecionado primeiro, depois os mais centrais).
    let live: string[] = []
    if (v.k >= LIVE_MIN_ZOOM) {
      const mid = toWorld(v, { x: v.w / 2, y: v.h / 2 })
      const domSet = new Set(cardIds), seenPages = new Set<string>()
      live = visible.filter(o => isCard(o) && domSet.has(o.id) && o.w * v.k >= LIVE_MIN_WIDTH && rectsIntersect(objectBounds(o, lookup), viewRect(v))).map(o => {
        const c = center(o as BoxObject)
        const rank = o.id === activeCardRef.current ? -2 : selectionRef.current.has(o.id) ? -1 : 0
        return { id: o.id, rank, d: Math.hypot(c.x - mid.x, c.y - mid.y) }
      }).sort((a, b) => a.rank - b.rank || a.d - b.d).filter(item => {
        // Um único editor ao vivo por página (duas instâncias do mesmo documento gerariam conflito de gravação).
        const pid = (lookup(item.id) as { pageId: string }).pageId
        if (seenPages.has(pid)) return false
        seenPages.add(pid); return true
      }).slice(0, MAX_LIVE).map(i => i.id).sort()
    }
    const liveKey = live.join(',')
    setLiveCards(prev => prev === liveKey ? prev : liveKey)
    minimapRef.current?.draw()
  }

  // ---------- montagem ----------
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const resize = () => {
      const rect = root.getBoundingClientRect()
      const v = viewRef.current
      const first = v.w === 0
      v.w = rect.width; v.h = rect.height
      const dpr = window.devicePixelRatio || 1
      for (const canvas of [sceneRef.current, overlayRef.current]) if (canvas) { canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px` }
      if (first && rect.width) {
        const saved = readSavedView(pageId)
        if (focusId) { ensureIndex(); const r = indexRef.current.bounds(focusId); if (r) { fitRect(r, 1, false); setSelection([focusId]) } else fitAll(false) }
        else if (saved) { v.k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, saved.k)); v.tx = v.w / 2 - saved.cx * v.k; v.ty = v.h / 2 - saved.cy * v.k; viewChanged() }
        else if (objectsRef.current.length) fitAll(false)
        else { v.k = 1; v.tx = v.w / 2; v.ty = v.h / 2; viewChanged() }
      }
      invalidate()
    }
    resize()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    observer?.observe(root)
    const unsubscribe = subscribe(() => invalidate())
    const onFocus = () => invalidate()
    root.addEventListener('focusin', onFocus); root.addEventListener('focusout', onFocus)
    return () => { observer?.disconnect(); unsubscribe(); root.removeEventListener('focusin', onFocus); root.removeEventListener('focusout', onFocus); cancelAnimationFrame(frame.current); frame.current = 0; cancelAnimationFrame(animation.current) }
  }, [])
  useEffect(() => { invalidate() }, [theme])
  useEffect(() => { if (focusId && viewRef.current.w) focusObject(focusId) }, [focusId])

  // Recarga externa (restaurar versão): substitui o estado sem perder a visão.
  useEffect(() => {
    if (data.objects === objectsRef.current) return
    objectsRef.current = data.objects
    settingsRef.current = { grid: data.grid !== false, snap: data.snap !== false }
    setSettingsState(settingsRef.current)
    historyRef.current.clear()
    markDirty()
  }, [data])

  // ---------- adicionar páginas (ponte para ações fora do quadro) ----------
  const addPages = (ids: string[], at?: Point): string[] => {
    if (readOnlyRef.current) return []
    const origin = at ?? viewCenter()
    const added: CanvasObject[] = []
    let x = origin.x
    for (const id of ids) {
      if (id === pageId) continue
      const card = cardFor(id, { x: 0, y: 0 }) as BoxObject
      card.x = Math.round(x - (ids.length === 1 ? card.w / 2 : 0)); card.y = Math.round(origin.y - card.h / 2)
      x += card.w + 40
      added.push(card)
    }
    if (!added.length) return []
    commit([...objectsRef.current, ...added], { select: added.map(o => o.id) })
    return added.map(o => o.id)
  }
  const bridge = useRef({ addPages, focusObject })
  bridge.current = { addPages, focusObject }
  // Inspeção em desenvolvimento (verificação no navegador); ausente no build de produção.
  useEffect(() => { if (import.meta.env?.DEV) (window as unknown as Record<string, unknown>).__canvasDebug = { gesture: () => gestureRef.current?.kind ?? null, tool: () => toolRef.current, selection: () => [...selectionRef.current], view: () => ({ ...viewRef.current }), objects: () => objectsRef.current, load: (objects: CanvasObject[]) => commit(objects), toolSet: (tool: Tool) => setTool(tool), view2: (k: number, cx: number, cy: number) => { const v = viewRef.current; v.k = k; v.tx = v.w / 2 - cx * k; v.ty = v.h / 2 - cy * k; viewChanged() } } }, [])
  useEffect(() => registerBoard(pageId, { addPages: (ids, at) => bridge.current.addPages(ids, at), focusObject: id => bridge.current.focusObject(id) }), [pageId])

  // ---------- conversões ----------
  const screenOf = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const worldOf = (e: { clientX: number; clientY: number }) => toWorld(viewRef.current, screenOf(e))
  const tol = () => 4 / viewRef.current.k
  const candidatesAround = (p: Point, r = 24) => { ensureIndex(); return indexRef.current.query({ x: p.x - r / viewRef.current.k, y: p.y - r / viewRef.current.k, w: (r * 2) / viewRef.current.k, h: (r * 2) / viewRef.current.k }) }
  const hitAt = (p: Point) => { const cand = candidatesAround(p); return hitTest(current(), p, tol(), lookupRef.current, cand) }
  const boxAt = (p: Point, exclude?: string) => {
    const cand = candidatesAround(p)
    const objects = current()
    for (const pass of [true, false]) for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if (!cand.has(o.id) || !isBox(o) || o.id === exclude || o.type === 'draw' || isCard(o) !== pass) continue
      if (hitObject(o.type === 'section' ? { ...o, type: 'note' } as unknown as BoxObject : o, p, tol(), lookupRef.current)) return o
    }
    return null
  }

  /** Ids moved together: selection + group mates + objects inside moved sections (locked ones stay). */
  const movingSet = (ids: Set<string>) => {
    const objects = objectsRef.current, lookup = lookupOf(objects)
    const out = withGroups(objects, ids)
    for (const id of [...out]) { const o = lookup(id); if (o?.type === 'section') for (const m of sectionMembers(o, objects, lookup)) out.add(m) }
    for (const id of [...out]) if (lookup(id)?.locked) out.delete(id)
    return out
  }

  // ---------- ponteiro ----------
  const capture = (e: ReactPointerEvent) => { try { rootRef.current?.setPointerCapture(e.pointerId) } catch { /* Synthetic events. */ } rootRef.current?.focus({ preventScroll: true }) }

  const spawnNeighbor = (source: BoxObject, side: 'top' | 'right' | 'bottom' | 'left') => {
    const gap = 80
    const copy = { ...structuredClone(source), id: crypto.randomUUID(), rotation: undefined, locked: undefined, groupId: undefined } as BoxObject
    if ('text' in copy) (copy as { text: string }).text = ''
    copy.x = source.x + (side === 'right' ? source.w + gap : side === 'left' ? -(source.w + gap) : 0)
    copy.y = source.y + (side === 'bottom' ? source.h + gap : side === 'top' ? -(source.h + gap) : 0)
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
    const conn = createConnector({ id: source.id, side, x: 0, y: 0 }, { id: copy.id, side: opposite[side], x: 0, y: 0 }, true, 'curve')
    createdRef.current.add(copy.id)
    commit([...objectsRef.current, copy, conn], { select: [copy.id] })
    setEditing(copy.id)
  }

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || readOnlyRef.current || toolRef.current !== 'select' || spaceRef.current || editingRef.current) return
    const ids = selectionRef.current
    if (!ids.size) return
    const p = worldOf(e)
    const lookup = lookupRef.current
    const selected = [...ids].map(id => lookup(id)).filter((o): o is CanvasObject => !!o && !o.locked)
    if (!selected.length || selected.length !== ids.size) return
    // Ponta de conector selecionado: reancorar.
    if (selected.length === 1 && isConnector(selected[0])) {
      const g = connectorGeometry(selected[0], lookup)
      for (const [which, point] of [['from', g.ends.a], ['to', g.ends.b]] as const) {
        if (Math.hypot(point.x - p.x, point.y - p.y) <= 8 / viewRef.current.k) {
          e.stopPropagation(); e.preventDefault(); capture(e)
          gestureRef.current = { kind: 'endpoint', id: selected[0].id, which, base: objectsRef.current }
          return
        }
      }
      return
    }
    const single = selected.length === 1 && isBox(selected[0]) ? selected[0] : null
    // Miro: "+" nas bordas de uma nota/forma cria a vizinha já conectada.
    if (single && (single.type === 'note' || single.type === 'shape') && viewRef.current.k >= 0.3) {
      const points = quickAddPoints(single, viewRef.current.k)
      const hit = points.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) <= 11 / viewRef.current.k)
      if (hit >= 0) { e.stopPropagation(); e.preventDefault(); rootRef.current?.focus({ preventScroll: true }); spawnNeighbor(single, (['top', 'right', 'bottom', 'left'] as const)[hit]); return }
    }
    const bounds = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : unionRects(selected.map(o => objectBounds(o, lookup)))
    if (!bounds) return
    const handle = handleAt(bounds, p, viewRef.current.k, single?.rotation ?? 0, !!single && rotatable(single))
    if (!handle) return
    e.stopPropagation(); e.preventDefault(); capture(e)
    if (handle === 'rotate' && single) gestureRef.current = { kind: 'rotate', id: single.id, base: objectsRef.current }
    else if (handle !== 'rotate') gestureRef.current = { kind: 'resize', handle, start: p, bounds, ids: new Set(selected.map(o => o.id)), base: objectsRef.current, single }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current) return
    rootRef.current?.focus({ preventScroll: true })
    const p = worldOf(e)
    pointerWorld.current = p
    const toolNow = toolRef.current
    if (e.button === 1 || (e.button === 0 && (spaceRef.current || toolNow === 'hand'))) {
      e.preventDefault(); capture(e)
      const v = viewRef.current
      gestureRef.current = { kind: 'pan', start: screenOf(e), tx: v.tx, ty: v.ty }
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return
    if (editingRef.current) { setEditing(null); return }
    const ro = readOnlyRef.current
    if (toolNow === 'lasso') {
      capture(e)
      gestureRef.current = { kind: 'lasso', points: [p], additive: e.shiftKey, base: e.shiftKey ? new Set(selectionRef.current) : new Set() }
      if (!e.shiftKey) setSelection([])
      setActiveCard(null)
      return
    }
    if (toolNow === 'select' || ro) {
      const hit = hitAt(p)
      if (hit) {
        if (isCard(hit)) setActiveCard(hit.id)
        let ids = selectionRef.current
        if (e.shiftKey) {
          const group = withGroups(objectsRef.current, [hit.id])
          const next = new Set(ids)
          const on = !ids.has(hit.id)
          for (const id of group) on ? next.add(id) : next.delete(id)
          setSelection(next); ids = next
          if (!on) return
        } else if (!ids.has(hit.id)) { ids = withGroups(objectsRef.current, [hit.id]); setSelection(ids) }
        if (ro) return
        let base = objectsRef.current
        let moving = movingSet(ids)
        if (e.altKey && moving.size) {
          // ⌥-arrastar duplica e move a cópia.
          const dup = duplicateObjects(objectsRef.current, withGroups(objectsRef.current, ids), 0)
          base = dup.objects
          moving = new Set(dup.added)
          draftRef.current = base
          setSelection(dup.added.filter(id => { const o = base.find(x => x.id === id); return o && (!isConnector(o)) }))
        }
        capture(e)
        gestureRef.current = { kind: 'move', start: p, ids: moving, base, moved: false, clicked: hit.id, additive: e.shiftKey }
        return
      }
      capture(e)
      gestureRef.current = { kind: 'marquee', start: p, additive: e.shiftKey, base: e.shiftKey ? new Set(selectionRef.current) : new Set() }
      if (!e.shiftKey) setSelection([])
      setActiveCard(null)
      return
    }
    capture(e)
    if (toolNow === 'note' || toolNow === 'text' || toolNow === 'section' || toolNow === 'rect' || toolNow === 'ellipse' || toolNow === 'diamond') {
      const type = toolNow === 'rect' || toolNow === 'ellipse' || toolNow === 'diamond' ? 'shape' : toolNow
      gestureRef.current = { kind: 'create', type, shape: type === 'shape' ? toolNow as ShapeKind : undefined, start: p, dragged: false, base: objectsRef.current, id: '' }
      return
    }
    if (toolNow === 'line' || toolNow === 'arrow') {
      const target = boxAt(p)
      gestureRef.current = { kind: 'line', start: p, from: target ? { id: target.id, x: p.x, y: p.y } : { x: p.x, y: p.y }, arrow: toolNow === 'arrow', current: p }
      return
    }
    if (toolNow === 'pen') {
      gestureRef.current = { kind: 'pen', samples: [p.x, p.y, samplePressure(e)] }
      return
    }
    if (toolNow === 'eraser') {
      gestureRef.current = { kind: 'erase', base: objectsRef.current, removed: new Set() }
      eraseAt(p)
    }
  }

  const eraseAt = (p: Point) => {
    const g = gestureRef.current
    if (g?.kind !== 'erase') return
    const radius = 10 / viewRef.current.k
    const hit = strokesAt(g.base, p, radius, candidatesAround(p, 16))
    overlayExtra.current.eraser = { at: p, radius }
    if (hit.some(id => !g.removed.has(id))) { hit.forEach(id => g.removed.add(id)); draftRef.current = g.base.filter(o => !g.removed.has(o.id)); markDirty() } else invalidate()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = worldOf(e)
    pointerWorld.current = p
    const g = gestureRef.current
    const v = viewRef.current
    if (!g) {
      // Hover: realce e cursor (sem re-render do React salvo mudança de cursor).
      if (toolRef.current === 'select' && !readOnlyRef.current && selectionRef.current.size) {
        const lookup = lookupRef.current
        const selected = [...selectionRef.current].map(id => lookup(id)).filter((o): o is CanvasObject => !!o)
        const single = selected.length === 1 && isBox(selected[0]) ? selected[0] : null
        const bounds = single ? single : unionRects(selected.map(o => objectBounds(o, lookup)))
        const handle = bounds && selected.every(o => !o.locked) && !(selected.length === 1 && isConnector(selected[0])) ? handleAt(bounds, p, v.k, single?.rotation ?? 0, !!single && rotatable(single)) : null
        const next = handle === 'rotate' ? 'grab' : handle ? `${handle}-resize`.replace(/^(n|s)-/, 'ns-').replace(/^(e|w)-/, 'ew-').replace(/^(ne|sw)-/, 'nesw-').replace(/^(nw|se)-/, 'nwse-') : ''
        if (next !== cursor) setCursor(next)
      }
      if (toolRef.current === 'eraser') { overlayExtra.current.eraser = { at: p, radius: 10 / v.k }; invalidate() }
      else if (toolRef.current === 'select' && e.pointerType !== 'touch') {
        const hover = hitAt(p)
        if ((overlayExtra.current.hover?.id ?? null) !== (hover?.id ?? null)) { overlayExtra.current.hover = hover; invalidate() }
      }
      return
    }
    switch (g.kind) {
      case 'pan': {
        const s = screenOf(e)
        v.tx = g.tx + s.x - g.start.x; v.ty = g.ty + s.y - g.start.y
        viewChanged(); return
      }
      case 'move': {
        let dx = p.x - g.start.x, dy = p.y - g.start.y
        if (!g.moved && Math.hypot(dx, dy) * v.k < 3) return
        g.moved = true
        overlayExtra.current.hover = null
        const lookup = lookupOf(g.base)
        const moving = g.base.filter(o => g.ids.has(o.id))
        const bounds = unionRects(moving.map(o => objectBounds(o, lookup)))
        let guides: Guide[] = []
        if (bounds && settingsRef.current.snap && !e.metaKey && !e.ctrlKey) {
          const moved = { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
          ensureIndex()
          const others: Rect[] = []
          for (const id of indexRef.current.query(viewRect(v))) { if (g.ids.has(id)) continue; const o = lookup(id); if (o && isBox(o) && o.type !== 'draw') { const r = objectBounds(o, lookup); others.push(r) } if (others.length > 400) break }
          const snapped = snapRect(moved, others, 6 / v.k)
          dx += snapped.dx; dy += snapped.dy; guides = snapped.guides
          overlayExtra.current.distances = nearestDistances({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, 800 / v.k)
          if (settingsRef.current.grid && !snapped.dx) dx = snapToGrid(bounds.x + dx, GRID_SIZE) - bounds.x
          if (settingsRef.current.grid && !snapped.dy) dy = snapToGrid(bounds.y + dy, GRID_SIZE) - bounds.y
        }
        overlayExtra.current.guides = guides
        draftRef.current = g.base.map(o => g.ids.has(o.id) ? translateObject(o, dx, dy) : o)
        markDirty(); setRevision(r => r + 1)
        return
      }
      case 'marquee': {
        const rect = normRect(g.start, p)
        overlayExtra.current.marquee = rect
        ensureIndex()
        const lookup = lookupRef.current
        const hits = [...indexRef.current.query(rect)].filter(id => { const o = lookup(id)!; return o.type === 'section' ? containsRect(rect, objectBounds(o, lookup)) : true })
        setSelection(withGroups(objectsRef.current, [...g.base, ...hits]))
        invalidate(); return
      }
      case 'lasso': {
        const last = g.points.at(-1)!
        if (Math.hypot(p.x - last.x, p.y - last.y) * v.k < 2) return
        g.points.push(p)
        overlayExtra.current.lasso = g.points
        if (g.points.length >= 3) {
          ensureIndex()
          const xs = g.points.map(q => q.x), ys = g.points.map(q => q.y)
          const candidates = indexRef.current.query({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
          setSelection(withGroups(objectsRef.current, [...g.base, ...lassoSelect(objectsRef.current, g.points, lookupRef.current, candidates)]))
        }
        invalidate(); return
      }
      case 'resize': {
        let dx = p.x - g.start.x, dy = p.y - g.start.y
        if (g.single?.rotation) { const r = rotatePoint({ x: dx, y: dy }, { x: 0, y: 0 }, -g.single.rotation); dx = r.x; dy = r.y }
        const minW = g.single && isCard(g.single) ? 200 : 8, minH = g.single && isCard(g.single) ? 120 : 8
        let next = resizeRect(g.bounds, g.handle, dx, dy, e.shiftKey !== (g.single?.type === 'image'), 8, e.altKey)
        next = { ...next, w: Math.max(minW, next.w), h: Math.max(minH, next.h) }
        if (g.single?.rotation) {
          // Mantém fixo, no mundo, o canto oposto à alça.
          const opposite = (r: Rect) => ({ x: g.handle.includes('w') ? r.x + r.w : g.handle.includes('e') ? r.x : r.x + r.w / 2, y: g.handle.startsWith('n') ? r.y + r.h : g.handle.startsWith('s') ? r.y : r.y + r.h / 2 })
          const before = rotatePoint(opposite(g.bounds), center(g.bounds), g.single.rotation)
          const after = rotatePoint(opposite(next), center(next), g.single.rotation)
          next = { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y }
        }
        draftRef.current = g.base.map(o => g.ids.has(o.id) ? transformObject(o, g.bounds, next) : o)
        markDirty(); setRevision(r => r + 1)
        return
      }
      case 'rotate': {
        const o = g.base.find(x => x.id === g.id)
        if (!o || !isBox(o)) return
        const rotation = rotationFor(center(o), p, e.shiftKey)
        draftRef.current = g.base.map(x => x.id === g.id ? { ...x, rotation } as CanvasObject : x)
        markDirty(); return
      }
      case 'create': {
        if (!g.dragged && Math.hypot(p.x - g.start.x, p.y - g.start.y) * v.k < 4) return
        g.dragged = true
        const r = normRect(g.start, p)
        const obj = createBox(g.type, center(r), { shape: g.shape, color: g.type === 'note' ? noteColor : undefined, w: Math.max(16, r.w), h: Math.max(16, r.h) })
        obj.x = r.x; obj.y = r.y
        if (g.id) obj.id = g.id; else g.id = obj.id
        draftRef.current = [...g.base, obj]
        markDirty(); return
      }
      case 'line': {
        g.current = p
        const target = boxAt(p, g.from.id)
        overlayExtra.current.pendingLine = [g.from.id ? center(lookupRef.current(g.from.id) as BoxObject) : g.start, p]
        overlayExtra.current.highlight = new Set([g.from.id, target?.id].filter((x): x is string => !!x))
        invalidate(); return
      }
      case 'endpoint': {
        const c = g.base.find(o => o.id === g.id) as ConnectorObject | undefined
        if (!c) return
        const other = g.which === 'from' ? c.to.id : c.from.id
        const target = boxAt(p, other)
        overlayExtra.current.highlight = new Set(target ? [target.id] : [])
        draftRef.current = g.base.map(o => o.id === g.id ? { ...c, [g.which]: { x: p.x, y: p.y } } : o)
        markDirty(); return
      }
      case 'pen': {
        const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const q = worldOf(ev)
          g.samples.push(q.x, q.y, samplePressure({ pointerType: e.pointerType, pressure: ev.pressure }))
        }
        const palette = paletteFor(themeRef.current)
        overlayExtra.current.stroke = { samples: g.samples, color: inkFor(penColor.current, palette.dark), size: penSize.current }
        invalidate(); return
      }
      case 'erase': eraseAt(p); return
    }
  }

  const finishGesture = (e: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    overlayExtra.current = { eraser: overlayExtra.current.eraser }
    invalidate()
    try { rootRef.current?.releasePointerCapture(e.pointerId) } catch { /* Not captured. */ }
    if (cancelled) { draftRef.current = null; markDirty(); setCursor(''); return }
    const p = worldOf(e)
    switch (g.kind) {
      case 'pan': setCursor(toolRef.current === 'hand' ? 'grab' : ''); invalidate(); return
      case 'move':
        if (g.moved && draftRef.current) commit(draftRef.current)
        else if (draftRef.current) { draftRef.current = null; markDirty() }
        else if (!g.additive && selectionRef.current.size > 1) setSelection(withGroups(objectsRef.current, [g.clicked]))
        return
      case 'marquee': invalidate(); return
      case 'lasso': if (selectionRef.current.size) setTool('select'); invalidate(); return
      case 'resize': case 'rotate':
        if (draftRef.current) commit(draftRef.current); return
      case 'create': {
        let objects = draftRef.current
        let id = g.id
        if (!g.dragged) {
          const obj = createBox(g.type, g.start, { shape: g.shape, color: g.type === 'note' ? noteColor : undefined })
          objects = [...g.base, obj]; id = obj.id
        }
        if (!objects) return
        // Seções novas ficam no fundo (atrás do que já está dentro delas).
        if (g.type === 'section') { const created = objects.find(o => o.id === id)!; objects = [created, ...objects.filter(o => o.id !== id)] }
        createdRef.current.add(id)
        commit(objects, { select: [id] })
        setTool('select')
        if (g.type !== 'section' || !g.dragged) setEditing(id)
        return
      }
      case 'line': {
        const v = viewRef.current
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) * v.k < 6) { invalidate(); return }
        const target = boxAt(p, g.from.id)
        const to: ConnectorEnd = target ? { id: target.id, x: p.x, y: p.y } : { x: p.x, y: p.y }
        const conn = createConnector(g.from, to, g.arrow, g.from.id || to.id ? (g.arrow ? 'curve' : 'straight') : 'straight')
        commit([...objectsRef.current, conn], { select: [conn.id] })
        setTool('select')
        return
      }
      case 'endpoint': {
        const c = g.base.find(o => o.id === g.id) as ConnectorObject | undefined
        if (!c) return
        const other = g.which === 'from' ? c.to.id : c.from.id
        const target = boxAt(p, other)
        const end: ConnectorEnd = target ? { id: target.id, x: p.x, y: p.y } : { x: p.x, y: p.y }
        commit(g.base.map(o => o.id === g.id ? { ...c, [g.which]: end } : o))
        return
      }
      case 'pen': {
        const simplified = simplifySamples(g.samples, 0.4 / viewRef.current.k)
        const stroke = strokeFromSamples(simplified, penColor.current, penSize.current)
        if (stroke) commit([...objectsRef.current, stroke])
        else invalidate()
        return
      }
      case 'erase':
        if (g.removed.size && draftRef.current) commit(draftRef.current)
        else { draftRef.current = null; invalidate() }
        return
    }
  }

  const penColor = useRef<CanvasColor>('default')
  const penSize = useRef(3)
  const inkFor = (c: CanvasColor, dark: boolean) => c === 'default' ? (dark ? '#e8e7e4' : '#37352f') : paletteSwatch(c, dark)

  // ---------- roda / pinça ----------
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      const s = screenOf(e)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // Pinça do trackpad chega como ctrl+roda com deltas pequenos; ⌘+roda do mouse com deltas maiores.
        const intent = wheelIntent(e, viewRef.current.h)
        if (intent.kind === 'zoom') zoomAt(s, intent.factor)
        return
      }
      // Dentro de um cartão ao vivo, a roda rola o conteúdo enquanto houver para onde rolar.
      const card = (e.target as HTMLElement | null)?.closest?.('.cv-card.is-live')
      if (card) {
        for (let el = e.target as HTMLElement | null; el && el !== card; el = el.parentElement) {
          const style = getComputedStyle(el)
          const canY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
          const canX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1
          if (canY && ((e.deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (e.deltaY < 0 && el.scrollTop > 0))) return
          if (canX && ((e.deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) || (e.deltaX < 0 && el.scrollLeft > 0))) return
        }
      }
      e.preventDefault()
      const v = viewRef.current
      const pan = wheelIntent(e, v.h)
      if (pan.kind === 'pan') { v.tx += pan.dx; v.ty += pan.dy }
      viewChanged()
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    // Gestos do Safari/WebKit (pinça sem ctrlKey).
    let gestureScale = 1
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureScale = 1 }
    const onGestureChange = (e: Event) => { e.preventDefault(); const scale = (e as unknown as { scale: number }).scale; zoomAt(screenOf(e as unknown as MouseEvent), scale / gestureScale); gestureScale = scale }
    root.addEventListener('gesturestart', onGestureStart)
    root.addEventListener('gesturechange', onGestureChange)
    return () => { root.removeEventListener('wheel', onWheel); root.removeEventListener('gesturestart', onGestureStart); root.removeEventListener('gesturechange', onGestureChange) }
  }, [])

  // ---------- duplo clique ----------
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (gestureRef.current) return
    const p = worldOf(e)
    const hit = hitAt(p)
    if (hit && isCard(hit)) { setActiveCard(hit.id); setSelection([hit.id]); invalidate(); setTimeout(() => (rootRef.current?.querySelector(`.cv-card[data-id="${CSS.escape(hit.id)}"] .bn-editor`) as HTMLElement | null)?.focus(), 60); return }
    if (readOnlyRef.current) return
    if (hit && !hit.locked && (hit.type === 'note' || hit.type === 'text' || hit.type === 'shape' || hit.type === 'section' || hit.type === 'connector')) { setSelection([hit.id]); setEditing(hit.id); return }
    if (!hit && toolRef.current === 'select') {
      const note = createBox('note', p, { color: noteColor })
      createdRef.current.add(note.id)
      commit([...objectsRef.current, note], { select: [note.id] })
      setEditing(note.id)
    }
  }

  // ---------- teclado ----------
  const nudge = (dx: number, dy: number) => {
    const ids = movingSet(selectionRef.current)
    if (!ids.size) return
    commit(objectsRef.current.map(o => ids.has(o.id) ? translateObject(o, dx, dy) : o), { key: 'nudge' })
  }
  const deleteSelection = () => {
    const ids = selectionRef.current
    if (!ids.size) return
    const next = deleteObjects(objectsRef.current, ids)
    if (next.length !== objectsRef.current.length) commit(next)
    else setNotice(t('Objetos travados não são apagados.', 'Locked objects are not deleted.'))
  }
  const duplicateSelection = () => {
    const ids = withGroups(objectsRef.current, selectionRef.current)
    if (!ids.size) return
    const dup = duplicateObjects(objectsRef.current, ids, 24)
    commit(dup.objects, { select: dup.added })
  }
  const undo = () => { const prev = historyRef.current.undo(objectsRef.current); if (prev) { objectsRef.current = prev as CanvasObject[]; onChangeRef.current({ version: 1, objects: objectsRef.current, ...settingsRef.current }); setRevision(r => r + 1); setSelection([...selectionRef.current].filter(id => prev.some(o => o.id === id))); markDirty() } }
  const redo = () => { const next = historyRef.current.redo(objectsRef.current); if (next) { objectsRef.current = next as CanvasObject[]; onChangeRef.current({ version: 1, objects: objectsRef.current, ...settingsRef.current }); setRevision(r => r + 1); markDirty() } }
  const doReorder = (mode: Reorder) => commit(reorder(objectsRef.current, withGroups(objectsRef.current, selectionRef.current), mode))
  const toggleLock = () => {
    const ids = selectionRef.current
    const lock = [...ids].some(id => !lookupRef.current(id)?.locked)
    commit(patchObjects(objectsRef.current, ids, o => lock ? { ...o, locked: true } : (({ locked: _l, ...rest }) => rest as CanvasObject)(o)))
  }
  const doAlign = (mode: Align | 'distributeH' | 'distributeV') => {
    const lookup = lookupRef.current
    const items = [...selectionRef.current].map(id => lookup(id)).filter((o): o is CanvasObject => !!o && isBox(o) && !o.locked).map(o => ({ id: o.id, r: objectBounds(o, lookup) }))
    const offsets = mode === 'distributeH' ? distributeOffsets(items, 'x') : mode === 'distributeV' ? distributeOffsets(items, 'y') : alignOffsets(items, mode)
    if (offsets.size) commit(objectsRef.current.map(o => { const d = offsets.get(o.id); return d && (d.x || d.y) ? translateObject(o, d.x, d.y) : o }))
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editableTarget(e.target) || e.defaultPrevented) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const ro = readOnlyRef.current
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    if (key === ' ' && !mod) { handled(); if (!spaceRef.current) { spaceRef.current = true; setCursor('grab') }; return }
    if (mod && key === 'z') { handled(); if (!ro) { e.shiftKey ? redo() : undo() } return }
    if (mod && key === 'y') { handled(); if (!ro) redo(); return }
    if (mod && key === 'a') { handled(); setSelection(objectsRef.current.filter(o => !o.hidden).map(o => o.id)); return }
    if (mod && key === 'f') { handled(); setFindOpen(true); return }
    if (mod && key === 'd') { handled(); if (!ro) duplicateSelection(); return }
    if (mod && key === 'g' && selectionRef.current.size >= 1) {
      if (e.shiftKey) { handled(); if (!ro) commit(ungroupObjects(objectsRef.current, withGroups(objectsRef.current, selectionRef.current))); return }
      if (selectionRef.current.size >= 2) { handled(); if (!ro) commit(groupObjects(objectsRef.current, selectionRef.current)); return }
    }
    if (mod && e.shiftKey && key === 'l') { handled(); if (!ro) toggleLock(); return }
    if (mod && (key === '=' || key === '+')) { handled(); zoomAt({ x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, 1.25); return }
    if (mod && key === '-') { handled(); zoomAt({ x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, 0.8); return }
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { handled(); if (!ro) doReorder(e.code === 'BracketRight' ? (e.shiftKey || e.altKey ? 'front' : 'forward') : (e.shiftKey || e.altKey ? 'back' : 'backward')); return }
    if (mod && key === 'l' && !e.shiftKey) { handled(); if (!ro) toggleLock(); return }
    if (mod) return
    if (e.altKey && (key === 'arrowright' || key === 'arrowleft')) { handled(); stepSection(key === 'arrowright' ? 1 : -1); return }
    if (e.shiftKey && e.code === 'Digit0') { handled(); const c = viewCenter(); animateTo({ k: 1, cx: c.x, cy: c.y }); return }
    if (e.shiftKey && e.code === 'Digit1') { handled(); fitAll(); return }
    if (e.shiftKey && (e.code === 'Digit2')) { handled(); ensureIndex(); fitRect(unionRects([...selectionRef.current].map(id => indexRef.current.bounds(id)).filter((r): r is Rect => !!r)), 2); return }
    if (key === '=' || key === '+') { handled(); zoomAt({ x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, 1.25); return }
    if (key === '-' || key === '_') { handled(); zoomAt({ x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, 0.8); return }
    if (key === 'escape') { handled(); if (toolRef.current !== 'select') setTool('select'); else { setSelection([]); setActiveCard(null) } return }
    if (key === 'enter' && selectionRef.current.size === 1) {
      const found = lookupRef.current([...selectionRef.current][0])
      if (!found) return
      const o = found as CanvasObject
      if (isCard(o)) { handled(); setActiveCard(o.id); setTimeout(() => (rootRef.current?.querySelector(`.cv-card[data-id="${CSS.escape(o.id)}"] .bn-editor`) as HTMLElement | null)?.focus(), 60); return }
      if (!ro && !o.locked && (o.type === 'note' || o.type === 'text' || o.type === 'shape' || o.type === 'section' || o.type === 'connector')) { handled(); setEditing(o.id); return }
    }
    if (ro) { if (key === 'v') setTool('select'); else if (key === 'h') setTool('hand'); return }
    if ((key === 'backspace' || key === 'delete') && selectionRef.current.size) { handled(); deleteSelection(); return }
    const step = e.shiftKey ? 10 : 1
    if (key === 'arrowleft') { handled(); nudge(-step, 0); return }
    if (key === 'arrowright') { handled(); nudge(step, 0); return }
    if (key === 'arrowup') { handled(); nudge(0, -step); return }
    if (key === 'arrowdown') { handled(); nudge(0, step); return }
    if (e.code === 'BracketRight') { handled(); doReorder(e.shiftKey ? 'front' : 'forward'); return }
    if (e.code === 'BracketLeft') { handled(); doReorder(e.shiftKey ? 'back' : 'backward'); return }
    const toolKey = TOOL_KEYS[key] ?? (/^Digit\d$/.test(e.code) ? TOOL_KEYS[e.code.slice(5)] : undefined)
    if (toolKey && !e.shiftKey && !e.altKey) { handled(); if (toolKey === 'image') imageInput.current?.click(); else setTool(toolKey as Tool) }
  }
  const onKeyUp = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' && spaceRef.current) { spaceRef.current = false; setCursor(toolRef.current === 'hand' ? 'grab' : '') }
  }

  // ---------- área de transferência (eventos do documento quando o quadro tem o foco) ----------
  useEffect(() => {
    const focused = () => { const root = rootRef.current, active = document.activeElement; return !!root && !!active && (active === root || (root.contains(active) && !editableTarget(active))) }
    const onCopy = (e: ClipboardEvent) => {
      if (!focused() || !selectionRef.current.size) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', serializeClipboard(objectsRef.current, withGroups(objectsRef.current, selectionRef.current)))
      if (e.type === 'cut' && !readOnlyRef.current) deleteSelection()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!focused() || readOnlyRef.current) return
      const files = [...(e.clipboardData?.files ?? [])]
      const text = e.clipboardData?.getData('text/plain') ?? ''
      e.preventDefault()
      const at = rectsIntersect({ ...pointerWorld.current, w: 0, h: 0 }, viewRect(viewRef.current)) ? pointerWorld.current : viewCenter()
      if (files.length) { void insertFiles(files, at); return }
      const clip = parseClipboard(text)
      if (clip?.length) { const pasted = pasteObjects(clip, at); commit([...objectsRef.current, ...pasted], { select: pasted.filter(o => !isConnector(o)).map(o => o.id) }); return }
      const link = /workspace:\/\/page\/([0-9a-f-]{36})/i.exec(text)
      if (link && getState().pages[link[1].toLowerCase()]) { addPages([link[1].toLowerCase()], at); return }
      if (text.trim()) { const note = createBox('note', at, { color: noteColor, text: text.slice(0, 10000) }); commit([...objectsRef.current, note], { select: [note.id] }) }
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCopy); document.removeEventListener('paste', onPaste) }
  }, [noteColor])

  // ---------- arrastar e soltar ----------
  const insertFiles = async (files: File[], at: Point) => {
    const added: CanvasObject[] = []
    let x = at.x
    for (const file of files.slice(0, 24)) {
      try {
        // PNG/SVG exportados pelo aplicativo trazem a cena: voltam como objetos editáveis.
        if (file.type === 'image/png' || file.type === 'image/svg+xml' || /\.(png|svg)$/i.test(file.name)) {
          const bytes = new Uint8Array(await file.arrayBuffer())
          const scene = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name) ? sceneFromSvg(new TextDecoder().decode(bytes)) : sceneFromPng(bytes)
          if (scene?.length) { const pasted = pasteObjects(scene, { x, y: at.y }); added.push(...pasted); const r = unionRects(pasted.map(o => objectBounds(o, lookupOf(pasted)))); x += (r?.w ?? 0) + 40; continue }
        }
        if (file.type.startsWith('image/')) {
          const img = await readImageFile(file)
          const scale = Math.min(1, 480 / Math.max(img.w, img.h))
          const w = Math.max(24, Math.round(img.w * scale)), h = Math.max(24, Math.round(img.h * scale))
          added.push({ id: crypto.randomUUID(), type: 'image', x: Math.round(x), y: Math.round(at.y - h / 2), w, h, src: img.src, name: file.name })
          x += w + 24
        } else {
          const data = await readDataFile(file)
          const [w, h] = DEFAULT_SIZE.file
          added.push({ id: crypto.randomUUID(), type: 'file', x: Math.round(x), y: Math.round(at.y - h / 2), w, h, data, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' })
          x += w + 24
        }
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    }
    if (added.length) commit([...objectsRef.current, ...added], { select: added.map(o => o.id) })
  }
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (readOnlyRef.current) return
    const types = [...e.dataTransfer.types]
    if (types.includes(PAGE_DND) || types.includes('Files') || types.includes('text/uri-list')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  }
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    if (readOnlyRef.current) return
    const at = worldOf(e)
    const pageDrop = e.dataTransfer.getData(PAGE_DND)
    if (pageDrop) { e.preventDefault(); addPages([pageDrop], at); rootRef.current?.focus(); return }
    if (e.dataTransfer.files.length) { e.preventDefault(); void insertFiles([...e.dataTransfer.files], at); return }
    const link = /workspace:\/\/page\/([0-9a-f-]{36})/i.exec(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'))
    if (link) { e.preventDefault(); addPages([link[1].toLowerCase()], at) }
  }

  // ---------- edição de texto ----------
  const editingObject = editing ? lookupOf(objectsRef.current)(editing) : undefined
  const editText = (value: string, height?: number) => {
    const id = editingRef.current
    if (!id) return
    commit(patchObjects(objectsRef.current, new Set([id]), o => {
      if (o.type === 'section') return { ...o, title: value }
      if (o.type === 'connector') return { ...o, label: value || undefined }
      if (o.type === 'note') return { ...o, text: value, h: Math.max(o.h, height ?? 0) }
      if (o.type === 'shape') return { ...o, text: value }
      if (o.type === 'text') return { ...o, text: value, h: Math.max(o.fontSize * 1.4, height ?? o.h) }
      return o
    }), { key: `text:${id}` })
  }
  const finishEditing = () => {
    const id = editingRef.current
    setEditing(null)
    if (!id) return
    const o = lookupOf(objectsRef.current)(id)
    if (o?.type === 'text' && !o.text.trim()) commit(objectsRef.current.filter(x => x.id !== id), { key: `text:${id}` })
    rootRef.current?.focus({ preventScroll: true })
  }

  // ---------- lista de camadas ----------
  const toggleLayers = () => setLayersOpen(open => { try { localStorage.setItem(COMPAT.record030, open ? 'off' : 'on') } catch { /* conveniência */ } return !open })
  const layersSelect = (ids: string[], additive: boolean) => {
    const group = withGroups(objectsRef.current, ids)
    if (!additive) { setSelection(group); return }
    const next = new Set(selectionRef.current)
    const on = ![...group].every(id => next.has(id))
    for (const id of group) on ? next.add(id) : next.delete(id)
    setSelection(next)
  }
  const layersPatch = (ids: string[], patch: { layerName?: string | null; hidden?: boolean; locked?: boolean }) => {
    commit(patchObjects(objectsRef.current, new Set(ids), o => {
      const next = { ...o } as Record<string, unknown>
      if ('layerName' in patch) { if (patch.layerName) next.layerName = patch.layerName; else delete next.layerName }
      if ('hidden' in patch) { if (patch.hidden) next.hidden = true; else delete next.hidden }
      if ('locked' in patch) { if (patch.locked) next.locked = true; else delete next.locked }
      return next as unknown as CanvasObject
    }))
    if (patch.hidden) { const gone = new Set(ids); setSelection([...selectionRef.current].filter(id => !gone.has(id))) }
  }
  const layersMove = (id: string, target: string, position: 'above' | 'below') => commit(moveLayer(objectsRef.current, id, target, position))

  // ---------- painel de propriedades ----------
  const selectedObjects = useMemo(() => { const lookup = lookupOf(objectsRef.current); return [...selection].map(id => lookup(id)).filter((o): o is CanvasObject => !!o) }, [selection, revision])
  const patchSelection = (patch: (o: CanvasObject) => CanvasObject, key?: string) => commit(patchObjects(objectsRef.current, withGroups(objectsRef.current, selectionRef.current), o => o.locked ? o : patch(o)), { key })

  // ---------- busca no quadro ----------
  const searchObjects = (query: string): string[] => {
    const q = foldSearch(query.trim())
    if (!q) return []
    const pages = getState().pages
    return objectsRef.current.filter(o => !o.hidden).filter(o => {
      const text = isCard(o) ? cardInfo(pages, o.pageId).title : objectText(o)
      return foldSearch(text).includes(q)
    }).map(o => o.id)
  }

  // ---------- exportação ----------
  const runExport = (format: 'png' | 'svg' | 'pdf', onlySelection: boolean) => {
    void exportCanvas(format, title, objectsRef.current, themeRef.current, onlySelection ? withGroups(objectsRef.current, selectionRef.current) : undefined).catch(error => setNotice(error instanceof Error ? error.message : String(error)))
  }

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer) }, [notice])

  // ---------- modelos e biblioteca ----------
  const library = useSyncExternalStore(subscribe, () => getState().settings.canvasLibrary ?? EMPTY_LIBRARY)
  const insertObjects = (source: CanvasObject[]) => {
    if (readOnlyRef.current || !source.length) return
    const pasted = pasteObjects(source, viewCenter())
    commit([...objectsRef.current, ...pasted], { select: pasted.filter(o => !isConnector(o)).map(o => o.id) })
    const r = unionRects(pasted.map(o => objectBounds(o, lookupOf(pasted))))
    const v = viewRef.current
    if (r && (r.w * v.k > v.w * 0.9 || r.h * v.k > v.h * 0.9)) fitRect(r, v.k)
  }
  const insertTemplate = (id: TemplateId) => { const template = CANVAS_TEMPLATES.find(item => item.id === id); if (template) insertObjects(template.build(getState().settings.locale === 'en-US' ? 'en-US' : 'pt-BR')) }
  const insertLibrary = (item: CanvasLibraryItem) => insertObjects(item.objects)
  const saveLibrary = (name: string) => {
    const ids = withGroups(objectsRef.current, selectionRef.current)
    if (!ids.size) return
    try {
      const item = libraryItem(name, freezeConnectorEnds(collectForCopy(objectsRef.current, ids)))
      actions.updateSettings({ canvasLibrary: [item, ...(getState().settings.canvasLibrary ?? [])].slice(0, 100) })
      setNotice(tNow('Salvo na biblioteca do espaço.', 'Saved to the workspace library.'))
    } catch { setNotice(tNow('Seleção grande demais para a biblioteca (máx. 512 KB).', 'Selection too large for the library (max 512 KB).')) }
  }

  // ---------- render ----------
  const lookupNow = lookupOf(current())
  const cardObjects = domCards ? domCards.split(',').map(id => lookupNow(id)).filter((o): o is Extract<CanvasObject, { type: 'page' | 'database' }> => !!o && isCard(o)) : []
  const liveSet = new Set(liveCards ? liveCards.split(',') : [])
  const toolCursor = cursor || (tool === 'hand' ? 'grab' : tool === 'select' ? '' : tool === 'eraser' ? 'none' : 'crosshair')

  return (
    <div className={`cv-board${readOnly ? ' is-readonly' : ''}`} data-tool={tool}>
      <div ref={rootRef} className="cv-surface" tabIndex={0} role="application"
        aria-label={t('Lousa: {title}. Use V, H, N, T, R, O, D, L, A, P, E e S para trocar de ferramenta.', 'Whiteboard: {title}. Use V, H, N, T, R, O, D, L, A, P, E and S to switch tools.', { title: title || t('Sem título', 'Untitled') })}
        style={{ cursor: toolCursor } as CSSProperties}
        onPointerDownCapture={onPointerDownCapture} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={e => finishGesture(e)} onPointerCancel={e => finishGesture(e, true)} onLostPointerCapture={e => { if (gestureRef.current && gestureRef.current.kind !== 'pan') finishGesture(e) }}
        onPointerLeave={() => { if (overlayExtra.current.eraser || overlayExtra.current.hover) { overlayExtra.current.eraser = null; overlayExtra.current.hover = null; invalidate() } }}
        onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => { spaceRef.current = false }}
        onDragOver={onDragOver} onDrop={onDrop}
        onContextMenu={e => { if (!editableTarget(e.target)) e.preventDefault() }}>
        <canvas ref={sceneRef} className="cv-scene" aria-hidden />
        <div ref={worldRef} className="cv-world">
          {cardObjects.map(o => <BoardCard key={o.id} object={o} live={liveSet.has(o.id)} selected={selection.has(o.id)} readOnly={readOnly} theme={theme} onActivate={id => { setActiveCard(id); if (!selectionRef.current.has(id)) setSelection([id]) }} />)}
          {editingObject && <TextEditor object={editingObject} lookup={lookupNow} theme={theme} onChange={editText} onDone={finishEditing} />}
        </div>
        <canvas ref={overlayRef} className="cv-overlay" aria-hidden />
      </div>
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={e => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (files.length) void insertFiles(files, viewCenter()) }} />
      <BoardToolbar tool={tool} readOnly={readOnly} noteColor={noteColor} onTool={setTool} onNoteColor={setNoteColor}
        onImage={() => imageInput.current?.click()} onPage={() => setPickerOpen(true)} onUndo={undo} onRedo={redo}
        penColor={penColor.current} onPenColor={c => { penColor.current = c; setRevision(r => r + 1) }} penSize={penSize.current} onPenSize={s => { penSize.current = s; setRevision(r => r + 1) }}
        library={library} canSaveLibrary={selection.size > 0} onTemplate={insertTemplate} onLibraryInsert={insertLibrary} onLibrarySave={saveLibrary} onLibraryDelete={id => actions.updateSettings({ canvasLibrary: library.filter(item => item.id !== id) })} />
      <ZoomControls zoom={zoom} onZoom={f => zoomAt({ x: viewRef.current.w / 2, y: viewRef.current.h / 2 }, f)} onReset={() => { const c = viewCenter(); animateTo({ k: 1, cx: c.x, cy: c.y }) }} onFit={() => fitAll()}
        minimap={minimapOpen} onMinimap={() => setMinimapOpen(open => { try { localStorage.setItem(COMPAT.record029, open ? 'off' : 'on') } catch { /* conveniência */ } return !open })} />
      {minimapOpen && <Minimap handleRef={minimapRef} getObjects={current} getIndex={() => { ensureIndex(); return indexRef.current }} getView={() => viewRef.current} theme={theme}
        onCenter={(p, animate) => { if (animate) animateTo({ k: viewRef.current.k, cx: p.x, cy: p.y }, 220); else { const v = viewRef.current; v.tx = v.w / 2 - p.x * v.k; v.ty = v.h / 2 - p.y * v.k; viewChanged() } }} />}
      <BoardMenu settings={settings} hasSelection={selection.size > 0} onGrid={() => updateSettings({ grid: !settingsRef.current.grid })} onSnap={() => updateSettings({ snap: !settingsRef.current.snap })}
        onFind={() => setFindOpen(true)} onExport={runExport} readOnly={readOnly} layers={layersOpen} onLayers={toggleLayers} />
      {findOpen && <FindBar search={searchObjects} onGo={focusObject} onClose={() => { setFindOpen(false); rootRef.current?.focus() }} />}
      {pickerOpen && <PagePicker excludeId={pageId} onPick={ids => { setPickerOpen(false); addPages(ids); rootRef.current?.focus() }} onClose={() => setPickerOpen(false)} />}
      {(layersOpen || (!readOnly && selectedObjects.length > 0 && !editing)) && <div className="cv-side">
      {layersOpen && <BoardLayers objects={objectsRef.current} selection={selection} readOnly={readOnly} cardTitle={id => infoFor(id).title} onSelect={layersSelect} onPatch={layersPatch} onMove={layersMove} onClose={toggleLayers} />}
      {!readOnly && selectedObjects.length > 0 && !editing && <BoardInspector objects={selectedObjects} onPatch={patchSelection} onAlign={doAlign} onReorder={doReorder} onLock={toggleLock}
        onGroup={() => commit(groupObjects(objectsRef.current, selectionRef.current))} onUngroup={() => commit(ungroupObjects(objectsRef.current, withGroups(objectsRef.current, selectionRef.current)))}
        onDelete={deleteSelection} onDuplicate={duplicateSelection} onEdit={() => { const o = selectedObjects[0]; if (o) setEditing(o.id) }} onSaveLibrary={() => saveLibrary(t('Item', 'Item'))} />}
      </div>}
      {readOnly && <div className="cv-readonly" role="status">{t('Somente leitura — desbloqueie a página para editar a lousa.', 'Read-only — unlock the page to edit the whiteboard.')}</div>}
      {notice && <div className="cv-notice" role="status">{notice}</div>}
      {objectsRef.current.length > 5000 && <div className="cv-notice" role="status">{t('Esta lousa passou de 5.000 objetos; o desempenho pode cair.', 'This whiteboard has more than 5,000 objects; performance may drop.')}</div>}
    </div>
  )
})

/** World positions of the four quick-add handles (fixed 28 px outside the box on screen). */
export function quickAddPoints(o: BoxObject, k: number): Point[] {
  const off = 28 / k, c = center(o)
  return [{ x: c.x, y: o.y - off }, { x: o.x + o.w + off, y: c.y }, { x: c.x, y: o.y + o.h + off }, { x: o.x - off, y: c.y }]
}

const EMPTY_LIBRARY: CanvasLibraryItem[] = []

const paletteSwatch = (c: CanvasColor, dark: boolean) => (dark ? INK_DARK : INK_LIGHT)[c] ?? '#37352f'
const INK_LIGHT: Record<string, string> = { gray: '#9b9a97', brown: '#a27763', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' }
const INK_DARK: Record<string, string> = { gray: '#8c8b88', brown: '#a27763', orange: '#d9730d', yellow: '#cb912f', green: '#4f9a72', blue: '#3d8fc4', purple: '#a07cc4', pink: '#d0609c', red: '#e0625d' }

/** Text editing overlay placed in world coordinates (scales with the board). */
function TextEditor({ object, lookup, theme, onChange, onDone }: { object: CanvasObject; lookup: Lookup; theme: 'light' | 'dark'; onChange(value: string, height?: number): void; onDone(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select() } }, [object.id])
  const dark = theme === 'dark'
  let style: CSSProperties = {}
  let value = ''
  let className = 'cv-text-editor'
  if (object.type === 'connector') {
    const m = midpointOf(geometryPolyline(connectorGeometry(object, lookup)))
    style = { left: m.x - 110, top: m.y - 14, width: 220, height: 28, fontSize: 13, textAlign: 'center' }
    value = object.label ?? ''
    className += ' is-label'
  } else if (isBox(object)) {
    const rotation = object.rotation ? `rotate(${object.rotation}deg)` : undefined
    if (object.type === 'section') { style = { left: object.x + 12, top: object.y + 8, width: object.w - 24, height: SECTION_FONT * 1.8, fontSize: SECTION_FONT, fontWeight: 600 }; value = object.title }
    else if (object.type === 'note') { style = { left: object.x, top: object.y, width: object.w, height: object.h, fontSize: NOTE_FONT, padding: '12px 14px', transform: rotation }; value = object.text; className += ' is-note' }
    else if (object.type === 'shape') { style = { left: object.x, top: object.y, width: object.w, height: object.h, fontSize: SHAPE_FONT, fontWeight: 500, textAlign: 'center', padding: `${Math.max(8, object.h / 2 - 12)}px 14px 8px`, transform: rotation }; value = object.text }
    else if (object.type === 'text') { style = { left: object.x, top: object.y, width: object.w, minHeight: object.h, fontSize: object.fontSize, textAlign: object.align ?? 'left', transform: rotation }; value = object.text }
  }
  if (object.font) style = { ...style, fontFamily: fontOf(object) }
  return <textarea ref={ref} className={className} data-theme-dark={dark || undefined} style={style} value={value}
    aria-label={tNow('Texto do objeto', 'Object text')}
    onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
    onChange={e => { const el = e.target; if (object.type === 'text' || object.type === 'note') { el.style.height = 'auto'; const height = el.scrollHeight; el.style.height = ''; onChange(el.value, height) } else onChange(el.value) }} onBlur={onDone}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onDone() } }} />
}

export { BOX_TYPES, distToPolyline, boxBounds }
