// Navegação por teclado da tabela (célula ativa, como no Export Bundle/Airtable): modelo puro, sem React nem DOM.
// A tabela só sabe quantas linhas e colunas tem (grupos e virtualização ficam de fora): quando o movimento
// passa da borda, o resultado traz `overflow` e a tabela pede à vizinha (grupo seguinte/anterior) para entrar.
import type { PropType } from '../../types'

export type NavDir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'top' | 'bottom' | 'next' | 'prev' | 'pageUp' | 'pageDown'

export interface GridPos { row: number; col: number }

export interface Overflow {
  /** Em que direção sai desta tabela. */
  to: 'prev' | 'next'
  /** Linha de entrada na vizinha. */
  row: 'first' | 'last'
  /** Coluna de entrada na vizinha (índice ou ponta). */
  col: number | 'first' | 'last'
  /** ⌘↑/⌘↓: vai à primeira/última linha da visualização inteira (todos os grupos), não só desta tabela. */
  absolute?: boolean
}

export interface MoveResult {
  /** Destino dentro desta tabela (já limitado às bordas). */
  pos: GridPos
  overflow?: Overflow
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Move `pos` numa grade de `rows` × `cols`. Com a grade vazia devolve null. `page` = linhas por PageUp/PageDown. */
export function moveCell(pos: GridPos, dir: NavDir, rows: number, cols: number, page = 10): MoveResult | null {
  if (rows <= 0 || cols <= 0) return null
  const row = clamp(pos.row, 0, rows - 1), col = clamp(pos.col, 0, cols - 1)
  const at = (r: number, c: number): MoveResult => ({ pos: { row: r, col: c } })
  switch (dir) {
    case 'left': return at(row, Math.max(0, col - 1))
    case 'right': return at(row, Math.min(cols - 1, col + 1))
    case 'home': return at(row, 0)
    case 'end': return at(row, cols - 1)
    case 'up': return row > 0 ? at(row - 1, col) : { pos: { row, col }, overflow: { to: 'prev', row: 'last', col } }
    case 'down': return row < rows - 1 ? at(row + 1, col) : { pos: { row, col }, overflow: { to: 'next', row: 'first', col } }
    case 'top': return { pos: { row: 0, col }, overflow: { to: 'prev', row: 'first', col, absolute: true } }
    case 'bottom': return { pos: { row: rows - 1, col }, overflow: { to: 'next', row: 'last', col, absolute: true } }
    case 'pageUp': return at(Math.max(0, row - page), col)
    case 'pageDown': return at(Math.min(rows - 1, row + page), col)
    case 'next':
      if (col < cols - 1) return at(row, col + 1)
      return row < rows - 1 ? at(row + 1, 0) : { pos: { row, col }, overflow: { to: 'next', row: 'first', col: 'first' } }
    case 'prev':
      if (col > 0) return at(row, col - 1)
      return row > 0 ? at(row - 1, cols - 1) : { pos: { row, col }, overflow: { to: 'prev', row: 'last', col: 'last' } }
  }
}

// ---------- Tecla → ação ----------

export type GridAction =
  | { type: 'move'; dir: NavDir; extend: boolean }
  | { type: 'edit' }
  | { type: 'seed'; text: string }
  | { type: 'toggle' }
  | { type: 'press' }
  | { type: 'open' }
  | { type: 'clear' }
  | { type: 'escape' }

export interface KeyInfo { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean }

export interface KeyContext {
  /** Tipo da propriedade da célula ativa. */
  type: PropType
  /** A célula aceita edição (tabela e linha não bloqueadas, propriedade não calculada). */
  canEdit: boolean
  /** Há seleção de linhas a limpar com Esc (a célula ativa continua). */
  hasSelection?: boolean
}

/** Tipos cujo editor aceita começar “substituindo” o conteúdo pelo caractere digitado. */
export const SEEDABLE_TYPES: ReadonlySet<PropType> = new Set<PropType>(['title', 'text', 'number', 'url', 'email', 'phone', 'person'])

/** Valor inicial do editor ao digitar sobre a célula (número só aceita caracteres numéricos). */
export function seedFor(type: PropType, text: string): string | null {
  if (!SEEDABLE_TYPES.has(type)) return null
  if (type === 'number' && !/^[0-9.,+\-]$/.test(text)) return null
  return text
}

/** Interpreta uma tecla pressionada com o foco na grade (não na edição). Devolve null se não for da grade. */
export function keyToAction(ev: KeyInfo, ctx: KeyContext): GridAction | null {
  if (ev.isComposing) return null
  const mod = !!(ev.metaKey || ev.ctrlKey)
  if (ev.altKey) return null
  const shift = !!ev.shiftKey
  switch (ev.key) {
    case 'ArrowLeft': return { type: 'move', dir: mod ? 'home' : 'left', extend: false }
    case 'ArrowRight': return { type: 'move', dir: mod ? 'end' : 'right', extend: false }
    case 'ArrowUp': return { type: 'move', dir: mod ? 'top' : 'up', extend: shift }
    case 'ArrowDown': return { type: 'move', dir: mod ? 'bottom' : 'down', extend: shift }
    case 'Home': return { type: 'move', dir: mod ? 'top' : 'home', extend: false }
    case 'End': return { type: 'move', dir: mod ? 'bottom' : 'end', extend: false }
    case 'PageUp': return { type: 'move', dir: 'pageUp', extend: shift }
    case 'PageDown': return { type: 'move', dir: 'pageDown', extend: shift }
    case 'Tab': return mod ? null : { type: 'move', dir: shift ? 'prev' : 'next', extend: false }
    case 'Escape': return { type: 'escape' }
    case 'Enter':
      if (mod) return { type: 'open' }
      if (!ctx.canEdit) return ctx.type === 'title' ? { type: 'open' } : ctx.type === 'button' ? { type: 'press' } : null
      if (ctx.type === 'checkbox') return { type: 'toggle' }
      if (ctx.type === 'button') return { type: 'press' }
      return { type: 'edit' }
    case 'F2': return ctx.canEdit && ctx.type !== 'checkbox' && ctx.type !== 'button' ? { type: 'edit' } : null
    case 'Backspace':
    case 'Delete': return !mod && ctx.canEdit && ctx.type !== 'button' ? { type: 'clear' } : null
    case ' ':
      if (mod) return null
      if (ctx.type === 'checkbox') return ctx.canEdit ? { type: 'toggle' } : null
      break
  }
  if (mod || [...ev.key].length !== 1) return null
  if (!ctx.canEdit) return null
  const seed = seedFor(ctx.type, ev.key)
  return seed === null ? null : { type: 'seed', text: seed }
}

// ---------- Colar (TSV) ----------

/** TSV da área de transferência (Excel/Sheets/Export Bundle): células com aspas podem conter tabulação e quebras de linha. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', i = 0
  const n = text.length
  let quotedField = false
  while (i < n) {
    const ch = text[i]
    if (ch === '"' && field === '' && !quotedField) {
      // Campo entre aspas: vai até a aspa de fechamento ("" é uma aspa literal).
      let j = i + 1, out = '', closed = false
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { out += '"'; j += 2; continue }
          closed = true; j++
          break
        }
        out += text[j++]
      }
      if (closed && (j >= n || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) { field = out; quotedField = true; i = j; continue }
      field += ch; i++; continue // aspa solta no meio do texto: literal
    }
    if (ch === '\t') { row.push(field); field = ''; quotedField = false; i++; continue }
    if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; quotedField = false
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch; i++
  }
  if (field !== '' || row.length || quotedField) { row.push(field); rows.push(row) }
  return rows
}

export interface PastePlan {
  cells: { row: number; col: number; text: string }[]
  /** Havia mais células do que o limite ou do que cabe na tabela (o excedente foi ignorado). */
  truncated: boolean
}

export const MAX_PASTE_CELLS = 2000

/** Posiciona a grade colada a partir de `start`, sem criar linhas nem colunas e respeitando `max` células. */
export function planPaste(grid: string[][], start: GridPos, rows: number, cols: number, max = MAX_PASTE_CELLS): PastePlan {
  const cells: PastePlan['cells'] = []
  let truncated = false
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const row = start.row + r, col = start.col + c
      if (row >= rows || col >= cols) { truncated = true; continue }
      if (cells.length >= max) { truncated = true; continue }
      cells.push({ row, col, text: grid[r][c] })
    }
  }
  return { cells, truncated }
}
