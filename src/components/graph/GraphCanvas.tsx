// Renderização do grafo em Canvas 2D com zoom/pan, arrastar nós, destaque de vizinhos e rótulos por zoom.
// Canvas 2D em lote (um path por cor) já sustenta 5.000+ nós a 60 fps; a física roda no Worker.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { EDGE_LINK, neighborLists, type BuiltGraph } from '../../graph/edges'
import type { LayoutParams } from '../../graph/layout'
import { createLayoutRunner, type LayoutRunner } from '../../graph/runner'
import { GROUP_PALETTE, matchesGroup, type GraphDisplay } from '../../graph/settings'
import { findType, TYPE_COLOR_HEX } from '../../objecttypes/model'
import { registeredTypes } from '../../objecttypes/registry'
import { t } from '../../i18n'

export interface GraphCanvasHandle { center(): void; animate(): void }

interface Props {
  graph: BuiltGraph
  display: GraphDisplay
  forces: LayoutParams
  frozen: boolean
  /** Página atual (anel de destaque; no grafo local é o centro). */
  focusId?: string
  /** Chave do cache de posições (mantém o desenho estável entre aberturas). */
  scope: string
  onOpen(id: string, newTab: boolean): void
  apiRef?: MutableRefObject<GraphCanvasHandle | null>
  label: string
}

const positionCache = new Map<string, Map<string, [number, number]>>()

interface Palette { page: string; database: string; row: string; orphan: string; line: string; lineHi: string; label: string; labelBg: string; focus: string; font: string }

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element)
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return { page: v('--gr-node-page', '#8a8a86'), database: v('--gr-node-database', '#337ea9'), row: v('--gr-node-row', '#30a46c'), orphan: v('--gr-node-orphan', '#c4c2bd'),
    line: v('--gr-line', 'rgba(55,53,47,.18)'), lineHi: v('--gr-line-hi', '#0f766e'), label: v('--gr-label', '#2c2c2b'), labelBg: v('--gr-bg', '#fff'), focus: v('--gr-focus', '#0f766e'),
    font: style.fontFamily || 'system-ui' }
}

function hash(text: string) { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return Math.abs(h) }

export function GraphCanvas({ graph, display, forces, frozen, focusId, scope, onOpen, apiRef, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runnerRef = useRef<LayoutRunner | null>(null)
  const pos = useRef<Float32Array>(new Float32Array(0))
  const view = useRef({ k: 1, tx: 0, ty: 0, w: 0, h: 0, userMoved: false, ticks: 0 })
  const hover = useRef(-1)
  const palette = useRef<Palette | null>(null)
  const frame = useRef(0)
  const graphRef = useRef(graph)
  const [announce, setAnnounce] = useState('')
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const neighbors = useMemo(() => neighborLists(graph), [graph])
  // Só reinicia a física quando a topologia muda (não a cada edição de título/texto).
  const topology = useMemo(() => graph.nodes.map(node => node.id).join(',') + '|' + graph.links.map(link => `${link.source}-${link.target}`).join(','), [graph])
  const radii = useMemo(() => Float32Array.from(graph.nodes, node => Math.min(28, 3.5 + Math.sqrt(node.degree) * 1.7) * display.nodeSize), [graph, display.nodeSize])
  const [paletteVersion, setPaletteVersion] = useState(0)
  const colors = useMemo(() => {
    const p = palette.current
    return graph.nodes.map(node => {
      const group = display.groups.find(g => matchesGroup(node, g.query))
      if (group) return group.color
      if (!p) return '#888'
      if (display.colorMode === 'root') return node.orphan ? p.orphan : GROUP_PALETTE[hash(node.rootId) % GROUP_PALETTE.length]
      // Tipos de objeto: cor do primeiro tipo da página; sem tipo, a cor neutra de página.
      if (display.colorMode === 'objectType') { const type = findType(registeredTypes(), node.typeId); return type ? TYPE_COLOR_HEX[type.color] : node.orphan ? p.orphan : p.page }
      return node.orphan ? p.orphan : p[node.kind]
    })
  }, [graph, display.groups, display.colorMode, paletteVersion])
  const byColor = useMemo(() => {
    const map = new Map<string, number[]>()
    colors.forEach((color, i) => (map.get(color) ?? map.set(color, []).get(color)!).push(i))
    return [...map.entries()]
  }, [colors])

  const live = useRef({ neighbors, radii, colors, byColor, display, focusId })
  live.current = { neighbors, radii, colors, byColor, display, focusId }
  graphRef.current = graph

  const invalidate = () => { if (!frame.current) frame.current = requestAnimationFrame(draw) }

  function fit(animate = false) {
    const p = pos.current, n = graphRef.current.nodes.length, v = view.current
    if (!n || !v.w) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < n; i++) { const x = p[i * 2], y = p[i * 2 + 1]; if (!Number.isFinite(x)) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (!Number.isFinite(x0)) return
    const pad = 40
    const k = Math.max(0.03, Math.min(2.5, Math.min((v.w - pad * 2) / Math.max(1, x1 - x0), (v.h - pad * 2) / Math.max(1, y1 - y0))))
    const tx = v.w / 2 - (x0 + x1) / 2 * k, ty = v.h / 2 - (y0 + y1) / 2 * k
    if (!animate) { Object.assign(v, { k, tx, ty }); invalidate(); return }
    const from = { k: v.k, tx: v.tx, ty: v.ty }, start = performance.now()
    const step = (now: number) => {
      const e = Math.min(1, (now - start) / 280), s = 1 - Math.pow(1 - e, 3)
      v.k = from.k + (k - from.k) * s; v.tx = from.tx + (tx - from.tx) * s; v.ty = from.ty + (ty - from.ty) * s
      invalidate()
      if (e < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function draw() {
    frame.current = 0
    const canvas = canvasRef.current, p = pos.current, v = view.current, g = graphRef.current
    if (!canvas || !palette.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { neighbors, radii, byColor, colors, display, focusId } = live.current
    const pal = palette.current
    const dpr = window.devicePixelRatio || 1
    const n = g.nodes.length
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, v.w, v.h)
    if (p.length < n * 2) return
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.tx, dpr * v.ty)
    const h = hover.current
    const lit = h >= 0 ? new Set([h, ...neighbors[h]]) : null
    // Arestas
    ctx.lineWidth = Math.max(display.lineWidth, 0.5 / v.k)
    ctx.strokeStyle = pal.line
    ctx.globalAlpha = lit ? 0.35 : 1
    ctx.beginPath()
    for (const link of g.links) {
      if (lit && (link.source === h || link.target === h)) continue
      ctx.moveTo(p[link.source * 2], p[link.source * 2 + 1]); ctx.lineTo(p[link.target * 2], p[link.target * 2 + 1])
    }
    ctx.stroke()
    if (display.arrows && v.k > 0.5) {
      ctx.fillStyle = pal.line
      ctx.beginPath()
      for (const link of g.links) {
        if (!(link.kinds & EDGE_LINK)) continue
        const sx = p[link.source * 2], sy = p[link.source * 2 + 1], tx = p[link.target * 2], ty = p[link.target * 2 + 1]
        const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len
        const r = radii[link.target] + 1, size = Math.max(3, display.lineWidth * 3)
        const ax = tx - ux * r, ay = ty - uy * r
        ctx.moveTo(ax, ay); ctx.lineTo(ax - ux * size - uy * size * 0.55, ay - uy * size + ux * size * 0.55); ctx.lineTo(ax - ux * size + uy * size * 0.55, ay - uy * size - ux * size * 0.55); ctx.closePath()
      }
      ctx.fill()
    }
    if (lit) {
      ctx.globalAlpha = 1
      ctx.strokeStyle = pal.lineHi
      ctx.lineWidth = Math.max(display.lineWidth * 1.6, 1 / v.k)
      ctx.beginPath()
      for (const link of g.links) if (link.source === h || link.target === h) { ctx.moveTo(p[link.source * 2], p[link.source * 2 + 1]); ctx.lineTo(p[link.target * 2], p[link.target * 2 + 1]) }
      ctx.stroke()
    }
    // Nós, um path por cor
    const minR = 1.2 / v.k
    for (const [color, indices] of byColor) {
      ctx.fillStyle = color
      ctx.globalAlpha = lit ? 0.18 : 1
      ctx.beginPath()
      for (const i of indices) { const r = Math.max(radii[i], minR); ctx.moveTo(p[i * 2] + r, p[i * 2 + 1]); ctx.arc(p[i * 2], p[i * 2 + 1], r, 0, Math.PI * 2) }
      ctx.fill()
    }
    ctx.globalAlpha = 1
    if (lit) for (const i of lit) {
      ctx.fillStyle = i === h ? pal.focus : colors[i]
      ctx.beginPath(); ctx.arc(p[i * 2], p[i * 2 + 1], Math.max(radii[i], minR) * (i === h ? 1.15 : 1), 0, Math.PI * 2); ctx.fill()
    }
    const focus = focusId ? g.index.get(focusId) : undefined
    if (focus !== undefined) {
      ctx.strokeStyle = pal.focus; ctx.lineWidth = 2 / v.k
      ctx.beginPath(); ctx.arc(p[focus * 2], p[focus * 2 + 1], radii[focus] + 3 / v.k, 0, Math.PI * 2); ctx.stroke()
    }
    // Rótulos: aparecem conforme o zoom; sempre para o nó destacado e seus vizinhos.
    const fade = Math.max(0, Math.min(1, (v.k - display.labelZoom) / (display.labelZoom * 0.4)))
    const fontSize = 12 / v.k
    ctx.font = `${fontSize}px ${pal.font}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillStyle = pal.label
    ctx.lineJoin = 'round'
    const x0 = -v.tx / v.k, y0 = -v.ty / v.k, x1 = (v.w - v.tx) / v.k, y1 = (v.h - v.ty) / v.k
    const text = (i: number) => { const title = g.nodes[i].title || t('Sem título', 'Untitled'); return title.length > 42 ? title.slice(0, 40) + '…' : title }
    const drawLabel = (i: number) => {
      const x = p[i * 2], y = p[i * 2 + 1] + radii[i] + 3 / v.k
      ctx.strokeStyle = pal.labelBg; ctx.lineWidth = 3 / v.k
      const label = text(i)
      ctx.strokeText(label, x, y); ctx.fillText(label, x, y)
    }
    if (fade > 0) {
      ctx.globalAlpha = lit ? fade * 0.25 : fade
      let drawn = 0
      for (let i = 0; i < n && drawn < 900; i++) {
        if (lit?.has(i)) continue
        const x = p[i * 2], y = p[i * 2 + 1]
        if (x < x0 - 80 / v.k || x > x1 + 80 / v.k || y < y0 - 20 / v.k || y > y1) continue
        drawLabel(i); drawn++
      }
    }
    if (lit) { ctx.globalAlpha = 1; for (const i of lit) drawLabel(i) }
    else if (focus !== undefined && fade < 1) { ctx.globalAlpha = 1; drawLabel(focus) }
    ctx.globalAlpha = 1
  }

  // Tema: relê os tokens quando data-theme ou o tema do sistema mudam.
  useEffect(() => {
    const refresh = () => { if (wrapRef.current) { palette.current = readPalette(wrapRef.current); setPaletteVersion(value => value + 1); invalidate() } }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refresh)
    return () => { observer.disconnect(); media.removeEventListener('change', refresh) }
  }, [])

  // Runner do layout
  useEffect(() => {
    const runner = createLayoutRunner((positions) => {
      pos.current = positions
      const v = view.current
      v.ticks++
      if (!v.userMoved && v.ticks < 160) fit()
      invalidate()
    })
    runnerRef.current = runner
    return () => {
      runner.dispose(); runnerRef.current = null
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [])

  // (Re)inicia a simulação quando o conjunto de nós/arestas muda, aproveitando posições conhecidas.
  useEffect(() => {
    const runner = runnerRef.current
    if (!runner) return
    const cache = positionCache.get(scope) ?? new Map<string, [number, number]>()
    positionCache.set(scope, cache)
    const n = graph.nodes.length
    const positions = new Float32Array(n * 2).fill(NaN)
    let known = 0
    graph.nodes.forEach((node, i) => { const at = cache.get(node.id); if (at) { positions[i * 2] = at[0]; positions[i * 2 + 1] = at[1]; known++ } })
    // Nós novos nascem perto de um vizinho já posicionado.
    graph.nodes.forEach((_, i) => {
      if (Number.isFinite(positions[i * 2])) return
      const anchor = neighbors[i].find(j => Number.isFinite(positions[j * 2]))
      if (anchor !== undefined) { positions[i * 2] = positions[anchor * 2] + (Math.random() - 0.5) * 30; positions[i * 2 + 1] = positions[anchor * 2 + 1] + (Math.random() - 0.5) * 30 }
    })
    const links = new Uint32Array(graph.links.length * 2)
    graph.links.forEach((link, i) => { links[i * 2] = link.source; links[i * 2 + 1] = link.target })
    const alpha = known === n && n ? 0.08 : known > n * 0.6 ? 0.4 : 1
    if (known < n * 0.6) { view.current.userMoved = false; view.current.ticks = 0 }
    pos.current = new Float32Array(0)
    runner.init(n, links, forces, { positions, alpha, paused: frozen })
    hover.current = -1
    return () => {
      // Guarda as posições atuais para a próxima montagem/atualização.
      const p = pos.current
      if (p.length >= n * 2) graph.nodes.forEach((node, i) => { if (Number.isFinite(p[i * 2])) cache.set(node.id, [p[i * 2], p[i * 2 + 1]]) })
    }
  }, [topology, scope])

  useEffect(() => { runnerRef.current?.send({ type: 'params', params: forces }) }, [forces.repel, forces.linkDistance, forces.linkStrength, forces.center])
  useEffect(() => { runnerRef.current?.send({ type: 'pause', paused: frozen }) }, [frozen])
  useEffect(() => { invalidate() }, [colors, radii, display.lineWidth, display.labelZoom, display.arrows, focusId])

  if (apiRef) apiRef.current = {
    center: () => { view.current.userMoved = true; fit(true) },
    animate: () => { view.current.userMoved = false; view.current.ticks = 0; runnerRef.current?.send({ type: 'reheat', alpha: 1, reset: true }) },
  }

  // Tamanho do canvas
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = view.current
      if (!v.w) { v.tx = rect.width / 2; v.ty = rect.height / 2 }
      else { v.tx += (rect.width - v.w) / 2; v.ty += (rect.height - v.h) / 2 }
      v.w = rect.width; v.h = rect.height
      canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`
      invalidate()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // Interação: arrastar nós, pan, zoom, hover e clique.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const toWorld = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect(), v = view.current
      return { x: (event.clientX - rect.left - v.tx) / v.k, y: (event.clientY - rect.top - v.ty) / v.k, sx: event.clientX - rect.left, sy: event.clientY - rect.top }
    }
    const nodeAt = (wx: number, wy: number) => {
      const p = pos.current, n = graphRef.current.nodes.length, { radii } = live.current, slack = 4 / view.current.k
      let best = -1, bestD = Infinity
      if (p.length < n * 2) return -1
      for (let i = 0; i < n; i++) {
        const dx = p[i * 2] - wx, dy = p[i * 2 + 1] - wy, d = dx * dx + dy * dy, r = Math.max(radii[i], 1.2 / view.current.k) + slack
        if (d <= r * r && d < bestD) { best = i; bestD = d }
      }
      return best
    }
    const setHover = (i: number) => {
      if (hover.current === i) return
      hover.current = i
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab'
      setAnnounce(i >= 0 ? graphRef.current.nodes[i]?.title || t('Sem título', 'Untitled') : '')
      invalidate()
    }
    let drag: { kind: 'node' | 'pan'; index: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean; pointerId: number } | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      const w = toWorld(event)
      const index = nodeAt(w.x, w.y)
      drag = { kind: index >= 0 ? 'node' : 'pan', index, startX: w.sx, startY: w.sy, lastX: w.sx, lastY: w.sy, moved: false, pointerId: event.pointerId }
      canvas.setPointerCapture(event.pointerId)
      if (index < 0) canvas.style.cursor = 'grabbing'
    }
    const move = (event: PointerEvent) => {
      const w = toWorld(event)
      if (!drag) { setHover(nodeAt(w.x, w.y)); return }
      if (Math.hypot(w.sx - drag.startX, w.sy - drag.startY) > 3) drag.moved = true
      if (drag.kind === 'pan') {
        const v = view.current
        v.tx += w.sx - drag.lastX; v.ty += w.sy - drag.lastY; v.userMoved = true
        invalidate()
      } else if (drag.moved) {
        view.current.userMoved = true
        runnerRef.current?.send({ type: 'pin', index: drag.index, x: w.x, y: w.y })
        const p = pos.current
        if (p.length > drag.index * 2 + 1) { p[drag.index * 2] = w.x; p[drag.index * 2 + 1] = w.y; invalidate() }
      }
      drag.lastX = w.sx; drag.lastY = w.sy
    }
    const up = (event: PointerEvent) => {
      if (!drag) return
      const current = drag
      drag = null
      try { canvas.releasePointerCapture(event.pointerId) } catch { /* já liberado */ }
      canvas.style.cursor = hover.current >= 0 ? 'pointer' : 'grab'
      if (current.kind === 'node') {
        if (current.moved) runnerRef.current?.send({ type: 'unpin', index: current.index })
        else { const node = graphRef.current.nodes[current.index]; if (node) onOpenRef.current(node.id, event.metaKey || event.ctrlKey) }
      }
    }
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const v = view.current
      const k = Math.max(0.02, Math.min(8, v.k * factor))
      v.tx = sx - (sx - v.tx) * (k / v.k); v.ty = sy - (sy - v.ty) * (k / v.k); v.k = k; v.userMoved = true
      invalidate()
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const w = toWorld(event)
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomAt(w.sx, w.sy, Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0022)))
    }
    const leave = () => { if (!drag) setHover(-1) }
    const key = (event: KeyboardEvent) => {
      const v = view.current
      if (event.key === '+' || event.key === '=') zoomAt(v.w / 2, v.h / 2, 1.25)
      else if (event.key === '-') zoomAt(v.w / 2, v.h / 2, 0.8)
      else if (event.key === '0') fit(true)
      else if (event.key.startsWith('Arrow')) { const d = 40; if (event.key === 'ArrowLeft') v.tx += d; if (event.key === 'ArrowRight') v.tx -= d; if (event.key === 'ArrowUp') v.ty += d; if (event.key === 'ArrowDown') v.ty -= d; v.userMoved = true; invalidate() }
      else return
      event.preventDefault()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('keydown', key)
    canvas.style.cursor = 'grab'
    return () => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key)
    }
  }, [])

  return <div ref={wrapRef} className="gr-canvas-wrap">
    <canvas ref={canvasRef} className="gr-canvas" tabIndex={0} role="img" aria-label={label} />
    <span className="gr-sr" aria-live="polite">{announce}</span>
  </div>
}
