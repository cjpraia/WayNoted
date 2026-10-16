// Simulação de forças própria (sem dependências): Barnes–Hut (quadtree) para repulsão,
// molas nas arestas e gravidade central. Arrays tipados; roda em Web Worker ou na thread principal.
// Convenções inspiradas no modelo clássico de "velocity Verlet" com alpha decrescente.

export interface LayoutParams {
  /** Repulsão entre nós (0–20, escala da interface). */
  repel: number
  /** Comprimento de repouso das arestas, em unidades do mundo. */
  linkDistance: number
  /** Força das molas (0–1). */
  linkStrength: number
  /** Gravidade para o centro (0–1). */
  center: number
}

export const defaultLayoutParams: LayoutParams = { repel: 10, linkDistance: 60, linkStrength: 1, center: 0.3 }

const THETA2 = 0.81 // θ = 0.9
const DISTANCE_MIN2 = 1
const DISTANCE_MAX2 = Infinity
const MAX_DEPTH = 24

export class ForceLayout {
  readonly n: number
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  /** 1 = posição fixada (arrastando). */
  fixed: Uint8Array
  fx: Float32Array
  fy: Float32Array
  private src: Uint32Array
  private dst: Uint32Array
  private bias: Float32Array
  private strength: Float32Array
  params: LayoutParams
  alpha = 1
  alphaMin = 0.002
  alphaDecay = 1 - Math.pow(0.002, 1 / 300)
  alphaTarget = 0
  velocityDecay = 0.6 // multiplicador (1 - 0.4)
  // Quadtree em arrays (reaproveitados entre ticks).
  private order: Uint32Array
  private scratch: Uint32Array
  private qx = new Float64Array(0); private qy = new Float64Array(0); private qq = new Float64Array(0)
  private qsize = new Float64Array(0); private qchild = new Int32Array(0); private qlo = new Int32Array(0); private qhi = new Int32Array(0)
  private qcount = 0
  private stack = new Int32Array(MAX_DEPTH * 4 + 8)
  private random = mulberry32(1)

  constructor(n: number, links: ArrayLike<number>, params: LayoutParams = defaultLayoutParams, positions?: ArrayLike<number>) {
    this.n = n
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.vx = new Float32Array(n); this.vy = new Float32Array(n)
    this.fixed = new Uint8Array(n); this.fx = new Float32Array(n); this.fy = new Float32Array(n)
    this.order = new Uint32Array(n); this.scratch = new Uint32Array(n)
    this.params = { ...params }
    const m = Math.floor(links.length / 2)
    this.src = new Uint32Array(m); this.dst = new Uint32Array(m)
    const count = new Uint32Array(n)
    for (let i = 0; i < m; i++) { const a = links[i * 2], b = links[i * 2 + 1]; this.src[i] = a; this.dst[i] = b; count[a]++; count[b]++ }
    this.bias = new Float32Array(m); this.strength = new Float32Array(m)
    for (let i = 0; i < m; i++) {
      const a = count[this.src[i]], b = count[this.dst[i]]
      this.bias[i] = a / (a + b)
      this.strength[i] = 1 / Math.min(a, b)
    }
    this.place(positions)
  }

  /** Posições iniciais: as recebidas (NaN = sem posição) ou filotaxia, como em layouts clássicos. */
  place(positions?: ArrayLike<number>) {
    const radius = 10, angle = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < this.n; i++) {
      const px = positions?.[i * 2], py = positions?.[i * 2 + 1]
      if (px !== undefined && py !== undefined && Number.isFinite(px) && Number.isFinite(py)) { this.x[i] = px; this.y[i] = py }
      else { const r = radius * Math.sqrt(0.5 + i), a = i * angle; this.x[i] = r * Math.cos(a); this.y[i] = r * Math.sin(a) }
      this.vx[i] = 0; this.vy[i] = 0
    }
  }

  setParams(params: Partial<LayoutParams>) { this.params = { ...this.params, ...params } }

  get active() { return this.alpha >= this.alphaMin || this.alphaTarget > 0 }

  /** Um passo da simulação. Devolve false quando esfriou. */
  tick(): boolean {
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay
    const alpha = this.alpha
    this.applyLinks(alpha)
    this.applyCharge(alpha)
    const c = this.params.center * 0.1 * alpha
    const { x, y, vx, vy, fixed, fx, fy } = this
    for (let i = 0; i < this.n; i++) {
      if (fixed[i]) { x[i] = fx[i]; y[i] = fy[i]; vx[i] = 0; vy[i] = 0; continue }
      vx[i] = (vx[i] - x[i] * c) * this.velocityDecay
      vy[i] = (vy[i] - y[i] * c) * this.velocityDecay
      x[i] += vx[i]; y[i] += vy[i]
    }
    return this.active
  }

  private jiggle() { return (this.random() - 0.5) * 1e-6 }

  private applyLinks(alpha: number) {
    const { x, y, vx, vy, src, dst, bias, strength } = this
    const distance = this.params.linkDistance, k = this.params.linkStrength
    for (let i = 0; i < src.length; i++) {
      const s = src[i], t = dst[i]
      let dx = x[t] + vx[t] - x[s] - vx[s] || this.jiggle()
      let dy = y[t] + vy[t] - y[s] - vy[s] || this.jiggle()
      let l = Math.sqrt(dx * dx + dy * dy)
      l = (l - distance) / l * alpha * strength[i] * k
      dx *= l; dy *= l
      const b = bias[i]
      vx[t] -= dx * b; vy[t] -= dy * b
      vx[s] += dx * (1 - b); vy[s] += dy * (1 - b)
    }
  }

  private ensureQuad(capacity: number) {
    if (this.qx.length >= capacity) return
    const size = Math.max(capacity, this.qx.length * 2, 64)
    const grow = <T extends Float64Array | Int32Array>(old: T, make: (s: number) => T, stride = 1) => { const next = make(size * stride); next.set(old); return next }
    this.qx = grow(this.qx, s => new Float64Array(s)); this.qy = grow(this.qy, s => new Float64Array(s)); this.qq = grow(this.qq, s => new Float64Array(s))
    this.qsize = grow(this.qsize, s => new Float64Array(s)); this.qlo = grow(this.qlo, s => new Int32Array(s)); this.qhi = grow(this.qhi, s => new Int32Array(s))
    this.qchild = grow(this.qchild, s => new Int32Array(s), 4)
  }

  /** Constrói a quadtree particionando `order` recursivamente; acumula centro de massa. */
  private build(lo: number, hi: number, x0: number, y0: number, size: number, depth: number): number {
    const id = this.qcount++
    this.ensureQuad(this.qcount)
    const { x, y, order } = this
    let sx = 0, sy = 0
    for (let k = lo; k < hi; k++) { sx += x[order[k]]; sy += y[order[k]] }
    const count = hi - lo
    this.qx[id] = sx / count; this.qy[id] = sy / count; this.qq[id] = count; this.qsize[id] = size
    this.qlo[id] = lo; this.qhi[id] = hi
    const base = id * 4
    this.qchild[base] = this.qchild[base + 1] = this.qchild[base + 2] = this.qchild[base + 3] = -1
    if (count <= 1 || depth >= MAX_DEPTH) return id
    const half = size / 2, mx = x0 + half, my = y0 + half
    // Contagem por quadrante e redistribuição estável em `scratch`.
    let c0 = 0, c1 = 0, c2 = 0
    for (let k = lo; k < hi; k++) { const i = order[k]; const q = (x[i] >= mx ? 1 : 0) + (y[i] >= my ? 2 : 0); if (q === 0) c0++; else if (q === 1) c1++; else if (q === 2) c2++ }
    const starts = [lo, lo + c0, lo + c0 + c1, lo + c0 + c1 + c2]
    const cursor = starts.slice()
    for (let k = lo; k < hi; k++) { const i = order[k]; const q = (x[i] >= mx ? 1 : 0) + (y[i] >= my ? 2 : 0); this.scratch[cursor[q]++] = i }
    order.set(this.scratch.subarray(lo, hi), lo)
    const ends = [starts[1], starts[2], starts[3], hi]
    for (let q = 0; q < 4; q++) {
      if (ends[q] > starts[q]) this.qchild[base + q] = this.build(starts[q], ends[q], q & 1 ? mx : x0, q & 2 ? my : y0, half, depth + 1)
    }
    return id
  }

  private applyCharge(alpha: number) {
    const n = this.n
    if (n < 2) return
    const { x, y, vx, vy, order } = this
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < n; i++) { order[i] = i; if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i]; if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i] }
    const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001
    this.qcount = 0
    this.build(0, n, x0, y0, size, 0)
    // Escala da interface (0–20) → intensidade semelhante a -30 por nó no valor padrão.
    const strength = -this.params.repel * 3 * alpha
    const stack = this.stack
    const { qx, qy, qq, qsize, qchild, qlo, qhi } = this
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i]
      let ax = 0, ay = 0, top = 0
      stack[top++] = 0
      while (top > 0) {
        const q = stack[--top]
        let dx = qx[q] - xi, dy = qy[q] - yi
        let l = dx * dx + dy * dy
        const w = qsize[q]
        const leaf = qchild[q * 4] < 0 && qchild[q * 4 + 1] < 0 && qchild[q * 4 + 2] < 0 && qchild[q * 4 + 3] < 0
        if (!leaf && (w * w) / THETA2 < l) {
          if (l < DISTANCE_MAX2) {
            if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l) || 1e-6
            const f = strength * qq[q] / l
            ax += dx * f; ay += dy * f
          }
          continue
        }
        if (leaf) {
          for (let k = qlo[q]; k < qhi[q]; k++) {
            const j = order[k]
            if (j === i) continue
            dx = x[j] - xi; dy = y[j] - yi
            if (dx === 0) dx = this.jiggle()
            if (dy === 0) dy = this.jiggle()
            l = dx * dx + dy * dy
            if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l) || 1e-6
            const f = strength / l
            ax += dx * f; ay += dy * f
          }
          continue
        }
        const base = q * 4
        for (let c = 0; c < 4; c++) if (qchild[base + c] >= 0) stack[top++] = qchild[base + c]
      }
      vx[i] += ax; vy[i] += ay
    }
  }

  /** Posições intercaladas [x0, y0, x1, y1, …]. */
  positions(out = new Float32Array(this.n * 2)): Float32Array {
    for (let i = 0; i < this.n; i++) { out[i * 2] = this.x[i]; out[i * 2 + 1] = this.y[i] }
    return out
  }

  pin(i: number, px: number, py: number) { if (i < 0 || i >= this.n) return; this.fixed[i] = 1; this.fx[i] = px; this.fy[i] = py; this.x[i] = px; this.y[i] = py }
  unpin(i: number) { if (i >= 0 && i < this.n) this.fixed[i] = 0 }
  reheat(alpha = 0.3) { this.alpha = Math.max(this.alpha, alpha) }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
