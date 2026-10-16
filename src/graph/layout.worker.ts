// Web Worker do layout: mantém a simulação fora da thread da interface e envia posições ~60×/s.
import { ForceLayout } from './layout.ts'
import type { LayoutMessage, LayoutReply } from './runner.ts'

let layout: ForceLayout | null = null
let paused = false
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

const post = (message: LayoutReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

let lastFrame = 0
function schedule() {
  if (timer || !layout || paused) return
  // ~60 posições/s: desconta o tempo já gasto no passo anterior.
  timer = setTimeout(loop, Math.max(0, 16 - (performance.now() - lastFrame)))
}

function loop() {
  timer = null
  if (!layout || paused) return
  const started = lastFrame = performance.now()
  let active = true
  // Vários passos por quadro quando sobra tempo (layouts pequenos estabilizam mais rápido).
  do active = layout.tick(); while (active && performance.now() - started < 8 && layout.n < 2000)
  const positions = layout.positions()
  post({ type: 'tick', generation, positions, alpha: layout.alpha }, [positions.buffer])
  if (active) schedule()
}

self.onmessage = (event: MessageEvent<LayoutMessage>) => {
  const message = event.data
  if (message.type === 'init') {
    generation = message.generation
    layout = new ForceLayout(message.n, message.links, message.params, message.positions)
    if (message.alpha !== undefined) layout.alpha = message.alpha
    paused = !!message.paused
    if (paused) { const positions = layout.positions(); post({ type: 'tick', generation, positions, alpha: layout.alpha }, [positions.buffer]) }
    schedule()
    return
  }
  if (!layout) return
  if (message.type === 'params') { layout.setParams(message.params); layout.reheat(0.3) }
  else if (message.type === 'pin') { layout.pin(message.index, message.x, message.y); layout.alphaTarget = 0.3; layout.reheat(0.3) }
  else if (message.type === 'unpin') { layout.unpin(message.index); layout.alphaTarget = 0 }
  else if (message.type === 'reheat') { if (message.reset) layout.place(); layout.alpha = message.alpha }
  else if (message.type === 'pause') { paused = message.paused; if (paused && timer) { clearTimeout(timer); timer = null } }
  schedule()
}
