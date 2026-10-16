// Gestos de roda, pinça de trackpad e caneta, como funções puras (testáveis com eventos sintéticos).
export interface WheelLike { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaX: number; deltaY: number; deltaMode: number }
export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

/**
 * Pinça do trackpad chega como roda com `ctrlKey` e deltas pequenos (sensibilidade 0,01); ⌘+roda do mouse usa deltas
 * maiores (0,002). Sem modificador a roda é panorâmica (⇧ com roda vertical vira horizontal); `deltaMode` 1/2 = linhas/páginas.
 */
export function wheelIntent(e: WheelLike, viewHeight: number): WheelIntent {
  if (e.ctrlKey || e.metaKey) return { kind: 'zoom', factor: Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)) }
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewHeight : 1
  const horizontal = e.shiftKey && !e.deltaX
  return { kind: 'pan', dx: -(horizontal ? e.deltaY : e.deltaX) * scale, dy: horizontal ? 0 : -e.deltaY * scale }
}

/** Pressão da amostra: só caneta/Apple Pencil informa pressão real (0 vira 0,5); mouse e toque contam 0,5 (traço uniforme). */
export function samplePressure(e: { pointerType: string; pressure: number }): number {
  return e.pointerType === 'pen' ? (e.pressure > 0 ? Math.min(1, e.pressure) : 0.5) : 0.5
}
