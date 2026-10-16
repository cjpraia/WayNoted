// Visualizador de PDF do bloco `pdfPreview` com anotações (docs/USAGE.md).
// Rolagem contínua; cada página só é rasterizada perto da área visível (200 páginas não travam).
// Camadas por página: canvas < anotações (pintura) < camada de texto do pdf.js < alvos de clique < captura de caneta/nota/caixa.
import 'pdfjs-dist/web/pdf_viewer.css'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { formatDate, useI18n } from '../../i18n'
import { copyText } from '../../clipboard'
import { api, getState } from '../../store'
import { showToast } from '../ui/toastQueue'
import { loadPdfjs } from '../../pdfWorker'
import { IconButton } from '../ui/Button'
import {
  ANN_COLORS, PEN_SIZES, TEXT_SIZE, bounds, canRedo, canUndo, colorLabel, createHistory, highlightsToMarkdown, mergeLineRects, moveAnnotation, newId, normalizeRect, oneLine,
  parseAnnotations, pushHistory, rectFromView, rectToView, redoHistory, rotatePoint, serializeAnnotations, sha256Hex, simplifyPoints, textualAnnotations, undoHistory, unrotatePoint, annotationLabel,
  type AnnColor, type Annotation, type History, type PenSize, type Rect, type Rotation,
} from './annotations'
import { AnnotationPanel } from './AnnotationPanel'
import { PdfToolbar, toolLabel, type Tool } from './PdfToolbar'
import './pdf.css'

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy
interface BlockEditor {
  isEditable?: boolean
  updateBlock(id: string, update: { props: Record<string, unknown> }): unknown
  insertBlocks(blocks: unknown[], reference: string, placement: 'after'): unknown
}
const PAD = 24
const SAVE_MS = 500

/* ---------- Página ---------- */

interface PageProps {
  doc: PdfDocument
  n: number
  width: number
  aspect: number
  rotation: Rotation
  root: HTMLElement | null
  annotations: Annotation[]
  annotate: boolean
  tool: Tool
  color: AnnColor
  penSize: PenSize
  selectedId: string | null
  flashId: string | null
  t: ReturnType<typeof useI18n>['t']
  onCreate(a: Omit<Annotation, 'id' | 'created' | 'updated'>): void
  onUpdate(id: string, patch: Partial<Annotation>): void
  onSelect(id: string | null): void
  onErase(id: string): void
}
type Draft = { id: string; mode: 'move' | 'resize'; dx: number; dy: number }

const PageView = memo(function PageView(p: PageProps) {
  const { n, width, rotation, t } = p
  const height = Math.round(width * p.aspect)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [stroke, setStroke] = useState<[number, number][] | null>(null)
  const [box, setBox] = useState<Rect | null>(null)
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return }
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { root: p.root, rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [p.root])

  useEffect(() => {
    const canvas = canvasRef.current, layer = textRef.current
    if (!near) {
      if (canvas) { canvas.width = 0; canvas.height = 0 }
      layer?.replaceChildren()
      return
    }
    let alive = true
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null
    let textLayer: { cancel(): void } | null = null
    void (async () => {
      const [pdfjs, page] = await Promise.all([loadPdfjs(), p.doc.getPage(n)])
      if (!alive || !canvas || !layer) return
      const intrinsic = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 })
      const viewport = page.getViewport({ scale: width / intrinsic.width, rotation: (page.rotate + rotation) % 360 })
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
      canvas.width = Math.ceil(viewport.width * dpr); canvas.height = Math.ceil(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`
      const context = canvas.getContext('2d')
      if (!context) return
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] })
      layer.replaceChildren()
      layer.style.setProperty('--total-scale-factor', String(viewport.scale))
      layer.style.setProperty('--scale-factor', String(viewport.scale))
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
      textLayer = tl
      await Promise.all([renderTask.promise, tl.render()])
    })().catch(() => { /* render cancelado ao rolar/zoom: esperado */ })
    return () => { alive = false; try { renderTask?.cancel() } catch { /* já terminou */ } try { textLayer?.cancel() } catch { /* já terminou */ } }
  }, [near, p.doc, n, width, rotation])

  const interactive = p.annotate && (p.tool === 'select' || p.tool === 'eraser')
  const capture = p.annotate && (p.tool === 'pen' || p.tool === 'note' || p.tool === 'text')
  const view = (a: Annotation): Annotation => {
    if (!draft || draft.id !== a.id) return a
    if (draft.mode === 'move') return moveAnnotation(a, draft.dx, draft.dy)
    return { ...a, w: Math.min(1 - (a.x ?? 0), Math.max(0.04, (a.w ?? 0.2) + draft.dx)), h: Math.min(1 - (a.y ?? 0), Math.max(0.02, (a.h ?? 0.05) + draft.dy)) }
  }
  const pt = (event: { clientX: number; clientY: number }): [number, number] => {
    const r = wrapRef.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))]
  }
  const vector = (dx: number, dy: number): [number, number] => {
    const a = unrotatePoint(0, 0, rotation), b = unrotatePoint(dx, dy, rotation)
    return [b[0] - a[0], b[1] - a[1]]
  }

  const startDrag = (event: ReactPointerEvent, a: Annotation, mode: 'move' | 'resize') => {
    if (!p.annotate) return
    if (p.tool === 'eraser') { event.preventDefault(); p.onErase(a.id); return }
    if (p.tool !== 'select') return
    event.stopPropagation()
    p.onSelect(a.id)
    const movable = mode === 'resize' || !(a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike')
    if (!movable) return
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    const [x, y] = pt(event)
    drag.current = { id: a.id, mode, x, y }
  }
  const moveDrag = (event: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, y] = pt(event)
    const [dx, dy] = vector(x - d.x, y - d.y)
    setDraft({ id: d.id, mode: d.mode, dx, dy })
  }
  const endDrag = () => {
    const d = drag.current, current = draft
    drag.current = null
    setDraft(null)
    if (!d || !current || (Math.abs(current.dx) < 0.002 && Math.abs(current.dy) < 0.002)) return
    const a = p.annotations.find((item) => item.id === d.id)
    if (!a) return
    const next = view(a)
    p.onUpdate(a.id, a.points ? { points: next.points } : a.kind === 'text' && d.mode === 'resize' ? { w: next.w, h: next.h } : { x: next.x, y: next.y })
  }

  const captureDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault() // sem o mousedown "de compatibilidade" o foco não sai da caixa de comentário que acabou de abrir
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    const point = pt(event)
    if (p.tool === 'note') {
      const [x, y] = unrotatePoint(point[0], point[1], rotation)
      p.onCreate({ kind: 'note', page: n, color: p.color, x, y, text: '' })
    } else if (p.tool === 'pen') setStroke([point])
    else if (p.tool === 'text') setBox({ x: point[0], y: point[1], w: 0, h: 0 })
  }
  const captureMove = (event: ReactPointerEvent) => {
    if (stroke) setStroke((s) => (s ? [...s, pt(event)] : s))
    else if (box) { const [x, y] = pt(event); setBox({ ...box, w: x - box.x, h: y - box.y }) }
  }
  const captureUp = () => {
    if (stroke) {
      const points = simplifyPoints(stroke.map(([x, y]) => unrotatePoint(x, y, rotation)))
      if (points.length === 1) points.push([Math.min(1, points[0][0] + 0.001), points[0][1]])
      if (points.length >= 2) p.onCreate({ kind: 'pen', page: n, color: p.color, points, size: PEN_SIZES[p.penSize] })
      setStroke(null)
    } else if (box) {
      const big = Math.abs(box.w) > 0.03 && Math.abs(box.h) > 0.015
      const rect: Rect = big ? { x: Math.min(box.x, box.x + box.w), y: Math.min(box.y, box.y + box.h), w: Math.abs(box.w), h: Math.abs(box.h) } : { x: Math.min(box.x, 0.7), y: Math.min(box.y, 0.93), w: 0.3, h: 0.07 }
      const base = rectFromView(rect, rotation)
      p.onCreate({ kind: 'text', page: n, color: p.color, x: base.x, y: base.y, w: base.w, h: base.h, size: TEXT_SIZE, text: '' })
      setBox(null)
    }
  }

  const W = width, H = height
  const sx = (v: number) => v * W, sy = (v: number) => v * H
  const label = (a: Annotation) => `${annotationLabel(a, t)}${a.quote ? `: ${oneLine(a.quote).slice(0, 60)}` : a.text ? `: ${oneLine(a.text).slice(0, 60)}` : ''}`
  const items = p.annotations.map(view)
  const keyActivate = (a: Annotation) => (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (p.tool === 'eraser') p.onErase(a.id); else p.onSelect(a.id) }
  }
  const polyline = (a: Annotation) => (a.points ?? []).map(([x, y]) => { const [vx, vy] = rotatePoint(x, y, rotation); return `${sx(vx)},${sy(vy)}` }).join(' ')
  const rectsOf = (a: Annotation) => (a.rects ?? []).map((r) => rectToView(r, rotation))
  const hitProps = (a: Annotation) => ({
    tabIndex: p.annotate ? 0 : -1, role: 'button', 'aria-label': label(a), 'aria-pressed': p.selectedId === a.id,
    onPointerDown: (event: ReactPointerEvent) => startDrag(event, a, 'move'), onPointerMove: moveDrag, onPointerUp: endDrag, onKeyDown: keyActivate(a),
    onFocus: () => { if (p.annotate && p.tool !== 'eraser' && p.selectedId !== a.id) p.onSelect(a.id) },
  })
  const selected = items.find((a) => a.id === p.selectedId)
  const selBox = selected && selected.kind !== 'note' && selected.kind !== 'text' ? rectToView(bounds(selected), rotation) : null

  return (
    <div ref={wrapRef} className="pdf-page" data-page={n} style={{ width: W, height: H }} data-mode={interactive ? p.tool : capture ? 'capture' : 'none'}>
      <canvas ref={canvasRef} aria-label={`${t('Página', 'Page')} ${n}`} role="img" />
      <svg className="pdf-ann-paint" width={W} height={H} aria-hidden="true">
        {items.map((a) => {
          const cls = `pdf-ann${p.flashId === a.id ? ' pdf-flash' : ''}`
          if (a.kind === 'highlight') return <g key={a.id} className={cls} data-color={a.color} data-kind="highlight">{rectsOf(a).map((r, i) => <rect key={i} className="pdf-hl" x={sx(r.x)} y={sy(r.y)} width={sx(r.w)} height={sy(r.h)} rx="2" />)}</g>
          if (a.kind === 'underline' || a.kind === 'strike') return <g key={a.id} className={cls} data-color={a.color} data-kind={a.kind}>{rectsOf(a).map((r, i) => { const yy = sy(r.y + r.h * (a.kind === 'underline' ? 0.92 : 0.55)); return <line key={i} className="pdf-ln" x1={sx(r.x)} x2={sx(r.x + r.w)} y1={yy} y2={yy} /> })}</g>
          if (a.kind === 'pen') return <polyline key={a.id} className={`${cls} pdf-pen`} data-color={a.color} points={polyline(a)} strokeWidth={Math.max(1, (a.size ?? PEN_SIZES.medium) * W)} />
          return null
        })}
        {stroke && <polyline className="pdf-pen pdf-pen--live" data-color={p.color} points={stroke.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} strokeWidth={Math.max(1, PEN_SIZES[p.penSize] * W)} />}
      </svg>
      <div ref={textRef} className="textLayer pdf-text" />
      <svg className="pdf-ann-hit" width={W} height={H}>
        {items.map((a) => {
          if (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strike') return <g key={a.id} className="pdf-hit" {...hitProps(a)}>{rectsOf(a).map((r, i) => <rect key={i} x={sx(r.x)} y={sy(r.y)} width={sx(r.w)} height={sy(r.h)} />)}</g>
          if (a.kind === 'pen') return <polyline key={a.id} className="pdf-hit pdf-hit--line" points={polyline(a)} strokeWidth={Math.max(12, (a.size ?? 0.004) * W + 8)} {...hitProps(a)} />
          return null
        })}
        {selBox && <rect className="pdf-sel" x={sx(selBox.x) - 3} y={sy(selBox.y) - 3} width={sx(selBox.w) + 6} height={sy(selBox.h) + 6} />}
      </svg>
      <div className="pdf-ann-html">
        {items.map((a) => {
          if (a.kind === 'note') {
            const [vx, vy] = rotatePoint(a.x ?? 0, a.y ?? 0, rotation)
            return <button key={a.id} type="button" className={`pdf-pin${p.flashId === a.id ? ' pdf-flash' : ''}`} data-color={a.color} style={{ left: sx(vx), top: sy(vy) }} title={a.text || label(a)} {...hitProps(a)} />
          }
          if (a.kind === 'text') {
            const r = rectToView({ x: a.x ?? 0, y: a.y ?? 0, w: a.w ?? 0.2, h: a.h ?? 0.05 }, rotation)
            return (
              <div key={a.id} className={`pdf-textbox${p.selectedId === a.id ? ' is-selected' : ''}${p.flashId === a.id ? ' pdf-flash' : ''}`} data-color={a.color} style={{ left: sx(r.x), top: sy(r.y), width: sx(r.w), height: sy(r.h), fontSize: (a.size ?? TEXT_SIZE) * W }} {...hitProps(a)}>
                <span>{a.text || t('Texto', 'Text')}</span>
                {p.selectedId === a.id && p.tool === 'select' && <i className="pdf-resize" onPointerDown={(event) => startDrag(event, a, 'resize')} onPointerMove={moveDrag} onPointerUp={endDrag} aria-hidden="true" />}
              </div>
            )
          }
          return null
        })}
        {box && <div className="pdf-textbox pdf-textbox--live" data-color={p.color} style={{ left: sx(Math.min(box.x, box.x + box.w)), top: sy(Math.min(box.y, box.y + box.h)), width: sx(Math.abs(box.w)), height: sy(Math.abs(box.h)) }} />}
      </div>
      {capture && <div className="pdf-catch" data-tool={p.tool} onPointerDown={captureDown} onPointerMove={captureMove} onPointerUp={captureUp} onPointerCancel={captureUp} />}
    </div>
  )
})

/* ---------- Visualizador ---------- */

function decode(data: string): Uint8Array | null {
  if (!/^data:application\/pdf;base64,/i.test(data)) return null
  const raw = atob(data.slice(data.indexOf(',') + 1))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function PdfViewer({ blockId, data, name, stored, editor }: { blockId: string; data: string; name: string; stored: string; editor?: BlockEditor }) {
  const { t } = useI18n()
  const readOnly = editor ? editor.isEditable === false : true
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bytesRef = useRef<Uint8Array | null>(null)
  const [pdf, setPdf] = useState<PdfDocument | null>(null)
  const [error, setError] = useState('')
  const [sizes, setSizes] = useState<Record<number, [number, number]>>({})
  const [total, setTotal] = useState(0)
  const [boxWidth, setBoxWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [page, setPage] = useState(1)
  const [annotate, setAnnotate] = useState(false)
  const [tool, setTool] = useState<Tool>('highlight')
  const [color, setColor] = useState<AnnColor>('yellow')
  const [penSize, setPenSize] = useState<PenSize>('medium')
  const [hist, setHist] = useState<History>(() => createHistory(parseAnnotations(stored).annotations))
  const [fileHash, setFileHash] = useState('')
  const [storedHash, setStoredHash] = useState(() => parseAnnotations(stored).hash)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [panel, setPanel] = useState(false)
  const [filterColor, setFilterColor] = useState<AnnColor | null>(null)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const [focusInspector, setFocusInspector] = useState(false)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const written = useRef(stored)
  const annotations = hist.present

  /* Carrega o PDF e calcula o hash do arquivo. */
  useEffect(() => {
    let alive = true
    let task: { destroy(): Promise<void> } | null = null
    setPdf(null); setError(''); setSizes({}); setTotal(0)
    void (async () => {
      const bytes = decode(data)
      if (!bytes) throw new Error(t('PDF inválido', 'Invalid PDF'))
      bytesRef.current = bytes
      const pdfjs = await loadPdfjs()
      const loading = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true })
      task = loading
      const document = await loading.promise
      if (!alive) return
      setPdf(document); setTotal(document.numPages)
      void sha256Hex(bytes).then((h) => { if (alive) setFileHash(h) }).catch(() => undefined)
      const first = await document.getPage(1)
      const v = first.getViewport({ scale: 1 })
      if (alive) setSizes({ 1: [v.width, v.height] })
      for (let from = 2; from <= document.numPages && alive; from += 12) {
        const chunk = await Promise.all(Array.from({ length: Math.min(12, document.numPages - from + 1) }, async (_, i) => {
          const pg = await document.getPage(from + i); const vp = pg.getViewport({ scale: 1 }); return [from + i, [vp.width, vp.height]] as const
        }))
        if (alive) setSizes((s) => ({ ...s, ...Object.fromEntries(chunk) }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })().catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : t('PDF inválido', 'Invalid PDF')) })
    return () => { alive = false; void task?.destroy() }
  }, [data])

  /* O editor seleciona o bloco inteiro ao clicar nele; só pinta a seleção quando é um trecho de texto do PDF. */
  useEffect(() => {
    const update = () => {
      const sel = globalThis.getSelection?.()
      const node = sel && !sel.isCollapsed ? sel.anchorNode : null
      const inside = !!node && !!(node instanceof Element ? node : node.parentElement)?.closest('.pdf-text')
      rootRef.current?.classList.toggle('is-text-selecting', inside)
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  /* Largura disponível. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setBoxWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* Persistência: propriedade do bloco, com atraso curto e descarga ao sair. */
  const latest = useRef({ annotations, fileHash, storedHash })
  latest.current = { annotations, fileHash, storedHash }
  const flush = useCallback(() => {
    const { annotations: list, fileHash: hash, storedHash: kept } = latest.current
    const value = serializeAnnotations({ v: 1, hash: kept || hash, annotations: list })
    if (value === written.current || !editor || editor.isEditable === false) return
    written.current = value
    editor.updateBlock(blockId, { props: { annotations: value } })
  }, [editor, blockId])
  useEffect(() => {
    if (serializeAnnotations({ v: 1, hash: storedHash || fileHash, annotations }) === written.current) return
    const timer = setTimeout(flush, SAVE_MS)
    return () => clearTimeout(timer)
  }, [annotations, fileHash, storedHash, flush])
  useEffect(() => () => flush(), [flush])
  /* Mudança externa da propriedade (desfazer do editor, restauração de versão, sincronização). */
  useEffect(() => {
    if (stored === written.current) return
    written.current = stored
    const parsed = parseAnnotations(stored)
    setHist(createHistory(parsed.annotations)); setStoredHash(parsed.hash); setSelectedId(null)
  }, [stored])

  const mismatch = !!storedHash && !!fileHash && storedHash !== fileHash && annotations.length > 0

  /* Geometria. */
  const base = sizes[1]
  const odd = rotation === 90 || rotation === 270
  const pageWidth = Math.max(160, boxWidth - PAD) * zoom
  const aspectOf = (n: number) => { const s = sizes[n] ?? base ?? [612, 792]; return odd ? s[0] / s[1] : s[1] / s[0] }

  const rememberAnchor = () => {
    const el = scrollRef.current
    if (el && el.scrollHeight > 0) anchor.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight }
  }
  useLayoutEffect(() => {
    const el = scrollRef.current, a = anchor.current
    if (!el || !a) return
    anchor.current = null
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2
  }, [pageWidth, rotation])
  const changeZoom = (value: number) => { rememberAnchor(); setZoom(value) }
  const rotate = () => { rememberAnchor(); setRotation((r) => ((r + 90) % 360) as Rotation) }

  const pageEl = (n: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null
  const goTo = (n: number) => {
    const target = Math.min(Math.max(1, n), Math.max(1, total))
    const el = pageEl(target)
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 8 })
    setPage(target)
  }
  const onScroll = useMemo(() => {
    let raf = 0
    return () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = scrollRef.current
        if (!el) return
        const line = el.scrollTop + el.clientHeight * 0.35
        let current = 1
        for (const child of Array.from(el.querySelectorAll<HTMLElement>('[data-page]'))) { if (child.offsetTop <= line) current = Number(child.dataset.page); else break }
        setPage(current)
      })
    }
  }, [])

  /* Edição das anotações (um único passo de desfazer por gesto). */
  const commit = useCallback((fn: (list: Annotation[]) => Annotation[], key?: string) => setHist((h) => pushHistory(h, fn(h.present), key)), [])
  const create = useCallback((a: Omit<Annotation, 'id' | 'created' | 'updated'>) => {
    const now = Date.now()
    const full: Annotation = { ...a, id: newId(), created: now, updated: now }
    commit((list) => [...list, full])
    setSelectedId(full.id)
    setFocusInspector(full.kind === 'note' || full.kind === 'text')
    if (full.kind === 'note' || full.kind === 'text') setTool('select')
  }, [commit])
  const update = useCallback((id: string, patch: Partial<Annotation>, key?: string) => commit((list) => list.map((a) => (a.id === id ? { ...a, ...patch, updated: Date.now() } : a)), key), [commit])
  const remove = useCallback((id: string) => { commit((list) => list.filter((a) => a.id !== id)); setSelectedId((s) => (s === id ? null : s)) }, [commit])
  const undo = () => { setHist(undoHistory); setSelectedId(null) }
  const redo = () => { setHist(redoHistory); setSelectedId(null) }

  /* Destaque a partir da seleção de texto. */
  const highlightSelection = useCallback((kind: 'highlight' | 'underline' | 'strike') => {
    const sel = globalThis.getSelection?.()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false
    const anchorEl = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement) ?? null
    const pageNode = anchorEl?.closest<HTMLElement>('[data-page]')
    if (!pageNode || !scrollRef.current?.contains(pageNode)) return false
    const frame = pageNode.getBoundingClientRect()
    const rects: Rect[] = Array.from(sel.getRangeAt(0).getClientRects())
      .filter((r) => r.width > 1 && r.height > 1 && r.bottom > frame.top && r.top < frame.bottom)
      .map((r) => normalizeRect(r, frame))
    const merged = mergeLineRects(rects.map((r) => rectFromView(r, rotation)))
    if (!merged.length) return false
    create({ kind, page: Number(pageNode.dataset.page), color, rects: merged, quote: oneLine(sel.toString()).slice(0, 4000) })
    sel.removeAllRanges()
    return true
  }, [color, rotation, create])
  const onPointerUp = () => {
    if (!annotate || readOnly || (tool !== 'highlight' && tool !== 'underline' && tool !== 'strike')) return
    setTimeout(() => highlightSelection(tool), 0)
  }

  useEffect(() => {
    if (!focusInspector || !selectedId) return
    const timer = setTimeout(() => { commentRef.current?.focus(); setFocusInspector(false) }, 0)
    return () => clearTimeout(timer)
  }, [focusInspector, selectedId])

  /* Teclado. */
  const selected = annotations.find((a) => a.id === selectedId) ?? null
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const target = event.target as HTMLElement
    const typing = target.matches('input, textarea, select, [contenteditable="true"]')
    const mod = event.metaKey || event.ctrlKey
    if (mod && !typing && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) redo(); else undo(); return }
    if (mod && !typing && event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); redo(); return }
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (selectedId) { setSelectedId(null); scrollRef.current?.focus() } else if (annotate && tool !== 'select') setTool('select')
      else if (annotate) setAnnotate(false)
      return
    }
    if (typing) return
    if (annotate && !readOnly && (tool === 'highlight' || tool === 'underline' || tool === 'strike') && event.key === 'Enter' && highlightSelection(tool)) { event.preventDefault(); event.stopPropagation(); return }
    if (!selected || !annotate || readOnly) return
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(selected.id); scrollRef.current?.focus(); return }
    const step = event.shiftKey ? 0.02 : 0.004
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const delta = arrows[event.key]
    if (delta) {
      event.preventDefault(); event.stopPropagation()
      const [dx, dy] = (() => { const a = unrotatePoint(0, 0, rotation), b = unrotatePoint(delta[0], delta[1], rotation); return [b[0] - a[0], b[1] - a[1]] })()
      const moved = moveAnnotation(selected, dx, dy)
      if (moved !== selected) update(selected.id, moved.points ? { points: moved.points } : { x: moved.x, y: moved.y }, `move:${selected.id}`)
    }
  }

  /* Painel. */
  const jump = (a: Annotation) => {
    setSelectedId(a.id); setFlashId(a.id)
    const el = pageEl(a.page), scroller = scrollRef.current
    if (el && scroller) {
      const b = rectToView(bounds(a), rotation)
      scroller.scrollTo({ top: el.offsetTop + b.y * el.offsetHeight - scroller.clientHeight * 0.3, behavior: 'smooth' })
    }
    setTimeout(() => setFlashId((id) => (id === a.id ? null : id)), 1600)
  }
  const markdown = () => highlightsToMarkdown(annotations, name, t)
  const copyMarkdown = async () => {
    try { await copyText(markdown()); showToast({ message: t('Destaques copiados como Markdown.', 'Highlights copied as Markdown.') }) } catch (cause) { showToast({ tone: 'error', message: cause instanceof Error ? cause.message : t('Não foi possível copiar.', 'Could not copy.') }) }
  }
  const insertHighlights = () => {
    if (!editor || readOnly) return
    const route = getState().route
    const href = route.type === 'page' && /^[0-9a-f-]{36}$/i.test(route.id) ? `workspace://page/${route.id}#block=${blockId}` : ''
    const blocks = textualAnnotations(annotations).map((a) => {
      const where = `${t('p.', 'p.')} ${a.page}`
      const link = href ? { type: 'link', href, content: [{ type: 'text', text: where, styles: {} }] } : { type: 'text', text: where, styles: {} }
      if (a.kind === 'note' || a.kind === 'text') return { type: 'paragraph', content: [{ type: 'text', text: `${a.kind === 'note' ? t('Nota', 'Note') : t('Texto', 'Text')}: ${oneLine(a.text ?? '')} `, styles: {} }, link] }
      const comment = a.text?.trim() ? ` — ${oneLine(a.text)}` : ''
      return { type: 'quote', content: [{ type: 'text', text: `${oneLine(a.quote ?? '')}${comment} `, styles: {} }, link] }
    })
    if (!blocks.length) return
    editor.insertBlocks(blocks, blockId, 'after')
    showToast({ message: t('{count} destaques inseridos na página.', '{count} highlights inserted into the page.', { count: blocks.length }) })
  }

  const exportPdf = async () => {
    const bytes = bytesRef.current
    if (!bytes || exporting) return
    setExporting(true)
    try {
      const { exportAnnotatedPdf } = await import('./exportAnnotated')
      const result = await exportAnnotatedPdf(bytes, annotations)
      const file = `${name.replace(/\.pdf$/i, '')} ${t('anotado', 'annotated')}.pdf`
      const saved = await api.exportBinaryFile?.(file, result.bytes)
      if (saved) showToast({ message: t('PDF anotado salvo. O original não foi alterado.', 'Annotated PDF saved. The original was not changed.') })
    } catch (cause) {
      showToast({ tone: 'error', message: cause instanceof Error ? cause.message : t('Não foi possível exportar o PDF.', 'Could not export the PDF.') })
    } finally { setExporting(false) }
  }

  const pages = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total])
  const mode = annotate ? tool : 'off'

  return (
    <div ref={rootRef} className={`pdf-viewer${panel ? ' has-panel' : ''}`} contentEditable={false} data-mode={mode} onKeyDown={onKeyDown}>
      <PdfToolbar
        t={t} name={name} page={page} total={total} onPage={goTo} zoom={zoom} onZoom={changeZoom} onRotate={rotate}
        annotate={annotate} onAnnotate={(on) => { setAnnotate(on); if (!on) setSelectedId(null) }} tool={tool} onTool={(next) => { setTool(next); if (next !== 'select') setSelectedId(null) }}
        color={color} onColor={(c) => { setColor(c); if (selected) update(selected.id, { color: c }) }} penSize={penSize} onPenSize={setPenSize}
        canUndo={canUndo(hist)} canRedo={canRedo(hist)} onUndo={undo} onRedo={redo}
        panelOpen={panel} onPanel={setPanel} count={annotations.length} onExport={() => void exportPdf()} exporting={exporting} readOnly={readOnly}
      />
      {mismatch && (
        <div className="pdf-notice" role="status">
          {t('Estas anotações foram feitas em outra versão do arquivo. ', 'These annotations were made on a different version of the file. ')}
          <button type="button" onClick={() => setStoredHash(fileHash)}>{t('Manter neste arquivo', 'Keep on this file')}</button>
        </div>
      )}
      <div className="pdf-main">
        <div className="pdf-stage">
          {error ? <div role="alert" className="pdf-error">{error}</div> : (
            <div ref={scrollRef} className="pdf-scroll" tabIndex={0} role="region" aria-label={`${name}: ${t('páginas do PDF', 'PDF pages')}`} onScroll={onScroll} onPointerUp={onPointerUp}>
              {pdf ? (
                <div className="pdf-pages" style={{ width: pageWidth }}>
                  {pages.map((n) => (
                    <PageView
                      key={n} doc={pdf} n={n} width={pageWidth} aspect={aspectOf(n)} rotation={rotation} root={scrollRef.current}
                      annotations={annotations.filter((a) => a.page === n)} annotate={annotate && !readOnly} tool={tool} color={color} penSize={penSize}
                      selectedId={selectedId} flashId={flashId} t={t} onCreate={create} onUpdate={update} onSelect={(id) => { setSelectedId(id); setFocusInspector(false) }} onErase={remove}
                    />
                  ))}
                </div>
              ) : <div className="pdf-loading" role="status">{t('Carregando PDF…', 'Loading PDF…')}</div>}
            </div>
          )}
          {annotate && selected && (
            <div className="pdf-inspector" role="group" aria-label={`${annotationLabel(selected, t)} · ${t('Página', 'Page')} ${selected.page}`}>
              <div className="pdf-inspector-row">
                <strong>{annotationLabel(selected, t)}</strong>
                <span className="pdf-group" role="group" aria-label={t('Cor', 'Color')}>
                  {ANN_COLORS.map((c) => <button key={c} type="button" className="pdf-swatch" data-color={c} aria-pressed={selected.color === c} aria-label={colorLabel(c, t)} title={colorLabel(c, t)} onClick={() => update(selected.id, { color: c })} />)}
                </span>
                <IconButton label={t('Excluir anotação', 'Delete annotation')} onClick={() => { remove(selected.id); scrollRef.current?.focus() }}><Trash2 size={16} strokeWidth={1.75} /></IconButton>
              </div>
              {selected.kind !== 'pen' && (
                <textarea
                  key={selected.id} ref={commentRef} rows={2} value={selected.text ?? ''} maxLength={5000}
                  placeholder={selected.kind === 'text' ? t('Texto da caixa', 'Text box content') : t('Comentário', 'Comment')}
                  aria-label={selected.kind === 'text' ? t('Texto da caixa', 'Text box content') : t('Comentário', 'Comment')}
                  onChange={(event) => update(selected.id, { text: event.target.value }, `text:${selected.id}`)}
                />
              )}
              {selected.quote && <blockquote className="pdf-inspector-quote">{oneLine(selected.quote)}</blockquote>}
              <span className="pdf-hint">{toolLabel('select', t)}: {t('setas movem, Delete exclui, Esc sai.', 'arrows move, Delete removes, Esc exits.')}</span>
            </div>
          )}
        </div>
        {panel && (
          <AnnotationPanel
            t={t} annotations={annotations} selectedId={selectedId} color={filterColor} onColor={setFilterColor} query={query} onQuery={setQuery}
            onJump={jump} onCopy={() => void copyMarkdown()} onInsert={insertHighlights} canInsert={!!editor && !readOnly}
            formatDate={(value) => formatDate(value, { dateStyle: 'short' })}
          />
        )}
      </div>
    </div>
  )
}
