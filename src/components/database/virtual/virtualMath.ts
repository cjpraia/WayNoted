// Matemática pura da virtualização (sem React/DOM) — testada em tests/virtualization.test.mts.

/** Prefixos de altura: offsets[i] = topo do item i; offsets[count] = altura total. */
export function buildOffsets(count: number, sizeOf: (index: number) => number): Float64Array {
  const offsets = new Float64Array(count + 1)
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + sizeOf(i)
  return offsets
}

/** Primeiro índice cujo fim passa de `y` (busca binária). */
function indexAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1
  let lo = 0, hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid + 1] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Faixa [start, end) de itens que intersectam [top, bottom] (em px relativos ao topo da lista). */
export function findRange(offsets: Float64Array, top: number, bottom: number): { start: number; end: number } {
  const count = offsets.length - 1
  if (count <= 0 || bottom <= 0 || top >= offsets[count]) {
    // Fora da tela: mantém um item para a lista não "sumir" (âncora para foco e medições).
    const at = count <= 0 ? 0 : top >= offsets[count] ? count - 1 : 0
    return { start: at, end: Math.min(count, at + 1) }
  }
  const start = indexAt(offsets, Math.max(0, top))
  const end = Math.min(count, indexAt(offsets, bottom) + 1)
  return { start, end: Math.max(end, start + 1) }
}

/** Posição de rolagem mínima que deixa o item `index` visível (ou null se já estiver). */
export function scrollDeltaFor(offsets: Float64Array, index: number, viewTop: number, viewBottom: number): number | null {
  const top = offsets[index], bottom = offsets[index + 1]
  if (top >= viewTop && bottom <= viewBottom) return null
  return top < viewTop ? top - viewTop : Math.min(top - viewTop, bottom - viewBottom)
}
