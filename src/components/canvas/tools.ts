// Ferramentas da barra do quadro e seus atalhos de uma tecla.
export type Tool = 'select' | 'lasso' | 'hand' | 'note' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'pen' | 'eraser' | 'section'

export const TOOL_KEYS: Record<string, Tool | 'image'> = {
  v: 'select', q: 'lasso', h: 'hand', n: 'note', t: 'text', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'pen', e: 'eraser', s: 'section', f: 'section', i: 'image',
  // Atalhos numéricos (como no Excalidraw).
  1: 'select', 2: 'rect', 3: 'diamond', 4: 'ellipse', 5: 'arrow', 6: 'line', 7: 'pen', 8: 'text', 9: 'image', 0: 'eraser',
}
export const TOOL_KEY_OF: Record<string, string> = Object.fromEntries(Object.entries(TOOL_KEYS).filter(([key]) => !/\d/.test(key) && key !== 's').map(([key, tool]) => [tool, key.toUpperCase()]))
export const TOOL_DIGIT_OF: Record<string, string> = Object.fromEntries(Object.entries(TOOL_KEYS).filter(([key]) => /\d/.test(key)).map(([key, tool]) => [tool, key]))
