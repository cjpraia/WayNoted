// Executor do layout: usa um Web Worker de módulo (arquivo local do app, sem blob:) e cai para a
// thread principal com requestAnimationFrame se o Worker não puder ser criado.
import { ForceLayout, type LayoutParams } from './layout.ts'

export type LayoutMessage =
  | { type: 'init'; generation: number; n: number; links: Uint32Array; params: LayoutParams; positions?: Float32Array; alpha?: number; paused?: boolean }
  | { type: 'params'; params: Partial<LayoutParams> }
  | { type: 'pin'; index: number; x: number; y: number }
  | { type: 'unpin'; index: number }
  | { type: 'reheat'; alpha: number; reset?: boolean }
  | { type: 'pause'; paused: boolean }

export type LayoutReply = { type: 'tick'; generation: number; positions: Float32Array; alpha: number }

export interface LayoutRunner {
  init(n: number, links: Uint32Array, params: LayoutParams, options?: { positions?: Float32Array; alpha?: number; paused?: boolean }): void
  send(message: Exclude<LayoutMessage, { type: 'init' }>): void
  dispose(): void
  readonly mode: 'worker' | 'main'
}

export function createLayoutRunner(onTick: (positions: Float32Array, alpha: number) => void): LayoutRunner {
  let generation = 0
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
  } catch { worker = null }
  if (worker) {
    const w = worker
    let fallback: LayoutRunner | null = null
    let lastInit: Parameters<LayoutRunner['init']> | null = null
    w.onmessage = (event: MessageEvent<LayoutReply>) => { if (event.data.generation === generation) onTick(event.data.positions, event.data.alpha) }
    w.onerror = () => {
      // Worker indisponível (ex.: política do ambiente): segue na thread principal.
      w.terminate()
      fallback = mainThreadRunner(onTick)
      if (lastInit) fallback.init(...lastInit)
    }
    return {
      mode: 'worker',
      init(n, links, params, options = {}) {
        lastInit = [n, links.slice(), params, { positions: options.positions?.slice(), alpha: options.alpha, paused: options.paused }]
        if (fallback) return fallback.init(n, links, params, options)
        generation++
        w.postMessage({ type: 'init', generation, n, links, params, ...options } satisfies LayoutMessage)
      },
      send(message) { if (fallback) fallback.send(message); else w.postMessage(message) },
      dispose() { fallback?.dispose(); w.terminate() },
    }
  }
  return mainThreadRunner(onTick)
}

function mainThreadRunner(onTick: (positions: Float32Array, alpha: number) => void): LayoutRunner {
  let layout: ForceLayout | null = null
  let frame = 0
  let paused = false
  const loop = () => {
    frame = 0
    if (!layout || paused) return
    const started = performance.now()
    let active = true
    do active = layout.tick(); while (active && performance.now() - started < 6 && layout.n < 1500)
    onTick(layout.positions(), layout.alpha)
    if (active) frame = requestAnimationFrame(loop)
  }
  const schedule = () => { if (!frame && layout && !paused) frame = requestAnimationFrame(loop) }
  return {
    mode: 'main',
    init(n, links, params, options = {}) {
      layout = new ForceLayout(n, links, params, options.positions)
      if (options.alpha !== undefined) layout.alpha = options.alpha
      paused = !!options.paused
      if (paused) onTick(layout.positions(), layout.alpha)
      schedule()
    },
    send(message) {
      if (!layout) return
      if (message.type === 'params') { layout.setParams(message.params); layout.reheat(0.3) }
      else if (message.type === 'pin') { layout.pin(message.index, message.x, message.y); layout.alphaTarget = 0.3; layout.reheat(0.3) }
      else if (message.type === 'unpin') { layout.unpin(message.index); layout.alphaTarget = 0 }
      else if (message.type === 'reheat') { if (message.reset) layout.place(); layout.alpha = message.alpha }
      else if (message.type === 'pause') { paused = message.paused; if (paused && frame) { cancelAnimationFrame(frame); frame = 0 } }
      schedule()
    },
    dispose() { if (frame) cancelAnimationFrame(frame); layout = null },
  }
}
