import test from 'node:test'
import assert from 'node:assert/strict'
import { moveCell, keyToAction, parseTsv, planPaste, seedFor, MAX_PASTE_CELLS } from '../src/components/database/tableNav.ts'
import { moveInGrid, moveInColumns } from '../src/components/database/views/shared/cardNav.ts'
import { cellText, emptyValueFor, pasteValue, pasteable } from '../src/components/database/tableClipboard.ts'
import { toggleSelection } from '../src/components/database/rowSelection.ts'

test('setas respeitam as bordas e sinalizam a saída para o grupo vizinho', () => {
  assert.deepEqual(moveCell({ row: 0, col: 0 }, 'left', 3, 4), { pos: { row: 0, col: 0 } })
  assert.deepEqual(moveCell({ row: 1, col: 3 }, 'right', 3, 4), { pos: { row: 1, col: 3 } })
  assert.deepEqual(moveCell({ row: 1, col: 1 }, 'down', 3, 4), { pos: { row: 2, col: 1 } })
  assert.deepEqual(moveCell({ row: 2, col: 2 }, 'down', 3, 4), { pos: { row: 2, col: 2 }, overflow: { to: 'next', row: 'first', col: 2 } })
  assert.deepEqual(moveCell({ row: 0, col: 2 }, 'up', 3, 4), { pos: { row: 0, col: 2 }, overflow: { to: 'prev', row: 'last', col: 2 } })
  assert.equal(moveCell({ row: 0, col: 0 }, 'down', 0, 4), null)
})

test('Tab percorre a linha, muda de linha e só sai nas pontas da tabela', () => {
  assert.deepEqual(moveCell({ row: 0, col: 3 }, 'next', 2, 4)!.pos, { row: 1, col: 0 })
  assert.deepEqual(moveCell({ row: 1, col: 0 }, 'prev', 2, 4)!.pos, { row: 0, col: 3 })
  assert.equal(moveCell({ row: 1, col: 3 }, 'next', 2, 4)!.overflow?.to, 'next')
  assert.equal(moveCell({ row: 0, col: 0 }, 'prev', 2, 4)!.overflow?.col, 'last')
})

test('Home/End, ⌘↑/⌘↓ e PageUp/PageDown', () => {
  assert.equal(moveCell({ row: 5, col: 2 }, 'home', 10, 4)!.pos.col, 0)
  assert.equal(moveCell({ row: 5, col: 2 }, 'end', 10, 4)!.pos.col, 3)
  const top = moveCell({ row: 5, col: 2 }, 'top', 10, 4)!
  assert.equal(top.pos.row, 0)
  assert.equal(top.overflow?.absolute, true)
  assert.equal(moveCell({ row: 5, col: 2 }, 'bottom', 10, 4)!.pos.row, 9)
  assert.equal(moveCell({ row: 5, col: 2 }, 'pageDown', 50, 4, 10)!.pos.row, 15)
  assert.equal(moveCell({ row: 5, col: 2 }, 'pageUp', 50, 4, 10)!.pos.row, 0)
  // 50 mil linhas: aritmética de índices, sem montar a grade.
  assert.equal(moveCell({ row: 49998, col: 1 }, 'down', 50000, 12)!.pos.row, 49999)
})

test('tecla → ação: edição, substituição, limpeza e atalhos', () => {
  const text = { type: 'text' as const, canEdit: true }
  assert.deepEqual(keyToAction({ key: 'Enter' }, text), { type: 'edit' })
  assert.deepEqual(keyToAction({ key: 'F2' }, text), { type: 'edit' })
  assert.deepEqual(keyToAction({ key: 'a' }, text), { type: 'seed', text: 'a' })
  assert.deepEqual(keyToAction({ key: 'é' }, text), { type: 'seed', text: 'é' })
  assert.deepEqual(keyToAction({ key: ' ' }, text), { type: 'seed', text: ' ' })
  assert.equal(keyToAction({ key: 'a', metaKey: true }, text), null)
  assert.equal(keyToAction({ key: 'a', altKey: true }, text), null)
  assert.equal(keyToAction({ key: 'Process', isComposing: true }, text), null)
  assert.deepEqual(keyToAction({ key: 'Backspace' }, text), { type: 'clear' })
  assert.deepEqual(keyToAction({ key: 'Delete' }, text), { type: 'clear' })
  assert.deepEqual(keyToAction({ key: 'ArrowDown', shiftKey: true }, text), { type: 'move', dir: 'down', extend: true })
  assert.deepEqual(keyToAction({ key: 'ArrowUp', metaKey: true }, text), { type: 'move', dir: 'top', extend: false })
  assert.deepEqual(keyToAction({ key: 'Tab', shiftKey: true }, text), { type: 'move', dir: 'prev', extend: false })
  assert.deepEqual(keyToAction({ key: 'Enter', metaKey: true }, text), { type: 'open' })
  // Número só aceita caracteres numéricos; select abre o popover no Enter mas não aceita digitação.
  assert.deepEqual(keyToAction({ key: '7' }, { type: 'number', canEdit: true }), { type: 'seed', text: '7' })
  assert.equal(keyToAction({ key: 'x' }, { type: 'number', canEdit: true }), null)
  assert.equal(keyToAction({ key: 'x' }, { type: 'select', canEdit: true }), null)
  assert.deepEqual(keyToAction({ key: 'Enter' }, { type: 'select', canEdit: true }), { type: 'edit' })
  assert.deepEqual(keyToAction({ key: ' ' }, { type: 'checkbox', canEdit: true }), { type: 'toggle' })
  assert.deepEqual(keyToAction({ key: 'Enter' }, { type: 'checkbox', canEdit: true }), { type: 'toggle' })
  assert.equal(seedFor('url', 'h'), 'h')
  assert.equal(seedFor('date', '1'), null)
})

test('somente leitura: setas sim, edição não', () => {
  const locked = { type: 'text' as const, canEdit: false }
  assert.equal(keyToAction({ key: 'Enter' }, locked), null)
  assert.equal(keyToAction({ key: 'a' }, locked), null)
  assert.equal(keyToAction({ key: 'Backspace' }, locked), null)
  assert.equal(keyToAction({ key: ' ' }, { type: 'checkbox', canEdit: false }), null)
  assert.deepEqual(keyToAction({ key: 'ArrowRight' }, locked), { type: 'move', dir: 'right', extend: false })
  assert.deepEqual(keyToAction({ key: 'Enter' }, { type: 'title', canEdit: false }), { type: 'open' })
})

test('TSV: linhas, aspas com tabulação/quebra e linha final vazia', () => {
  assert.deepEqual(parseTsv('a'), [['a']])
  assert.deepEqual(parseTsv('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']])
  assert.deepEqual(parseTsv('a\tb\r\nc\td'), [['a', 'b'], ['c', 'd']])
  assert.deepEqual(parseTsv('"x\ty"\t"linha1\nlinha2"\n"diz ""oi"""'), [['x\ty', 'linha1\nlinha2'], ['diz "oi"']])
  assert.deepEqual(parseTsv('5" tela\tok'), [['5" tela', 'ok']])
  assert.deepEqual(parseTsv('a\t\tc'), [['a', '', 'c']])
  assert.deepEqual(parseTsv(''), [])
})

test('colar preenche só células existentes, com teto de células', () => {
  const grid = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]
  const plan = planPaste(grid, { row: 1, col: 2 }, 3, 4)
  assert.equal(plan.cells.length, 4) // 2 linhas × 2 colunas
  assert.equal(plan.truncated, true)
  assert.deepEqual(plan.cells[0], { row: 1, col: 2, text: '1' })
  assert.equal(planPaste([['x']], { row: 0, col: 0 }, 1, 1).truncated, false)
  const big = Array.from({ length: 3000 }, (_, i) => [String(i)])
  const capped = planPaste(big, { row: 0, col: 0 }, 50000, 3)
  assert.equal(capped.cells.length, MAX_PASTE_CELLS)
  assert.equal(capped.truncated, true)
})

const select = { id: 's', name: 'Estado', type: 'select', options: [{ id: 'a', name: 'Aberto', color: 'blue' }] } as never
test('valor colado por tipo: converte, ignora inválidos e não apaga por engano', () => {
  const prop = (type: string) => ({ id: type, name: type, type }) as never
  assert.equal(pasteValue('12,5', prop('number')), 12.5)
  assert.equal(pasteValue('abc', prop('number')), undefined)
  assert.equal(pasteValue('Aberto', select), 'a')
  assert.equal(pasteValue('Inexistente', select), undefined)
  assert.equal(pasteValue('sim', prop('checkbox')), true)
  assert.deepEqual(pasteValue('2026-10-08', prop('date')), { start: '2026-10-08' })
  assert.equal(pasteValue('08/10/2026', prop('date')), undefined)
  assert.equal(pasteValue('', prop('text')), null)
  assert.equal(pasteValue('  ', prop('title')), '')
  assert.equal(pasteValue('a\nb', prop('title')), 'a b')
  assert.equal(pasteValue('x', prop('relation')), undefined)
  assert.equal(pasteValue('x', prop('formula')), undefined)
  assert.equal(pasteable(prop('rollup')), false)
  assert.deepEqual(emptyValueFor(prop('multiSelect')), [])
  assert.equal(emptyValueFor(prop('checkbox')), false)
  assert.equal(emptyValueFor(prop('date')), null)
  assert.equal(cellText('Olá', prop('title'), {}), 'Olá')
  assert.equal(cellText('a', select, {}), 'Aberto')
})

test('Shift+setas estendem a seleção de linhas na ordem exibida (reaproveita o modelo da seleção)', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual([...toggleSelection(new Set(), order, 'c', 'a', true)].sort(), ['a', 'b', 'c'])
})

test('cartões: grade, lista e colunas do quadro', () => {
  // Galeria com 3 por linha, 8 cartões.
  assert.equal(moveInGrid(8, 3, 0, 'ArrowDown'), 3)
  assert.equal(moveInGrid(8, 3, 6, 'ArrowDown'), 6)
  assert.equal(moveInGrid(8, 3, 7, 'ArrowRight'), 7)
  assert.equal(moveInGrid(8, 3, 4, 'ArrowLeft'), 3)
  assert.equal(moveInGrid(8, 3, 4, 'ArrowUp'), 1)
  assert.equal(moveInGrid(8, 3, 4, 'End'), 7)
  // Lista (1 por linha): esquerda/direita não fazem nada.
  assert.equal(moveInGrid(5, 1, 2, 'ArrowRight'), 2)
  assert.equal(moveInGrid(5, 1, 2, 'ArrowDown'), 3)
  assert.equal(moveInGrid(0, 1, 0, 'ArrowDown'), -1)
  // Quadro: [3, 0, 2] — a coluna vazia é pulada e o índice é limitado.
  assert.deepEqual(moveInColumns([3, 0, 2], { col: 0, index: 2 }, 'ArrowRight'), { col: 2, index: 1 })
  assert.deepEqual(moveInColumns([3, 0, 2], { col: 2, index: 0 }, 'ArrowLeft'), { col: 0, index: 0 })
  assert.deepEqual(moveInColumns([3, 0, 2], { col: 2, index: 1 }, 'ArrowRight'), { col: 2, index: 1 })
  assert.deepEqual(moveInColumns([3, 0, 2], { col: 0, index: 2 }, 'ArrowDown'), { col: 0, index: 2 })
  assert.deepEqual(moveInColumns([3, 0, 2], { col: 0, index: 0 }, 'ArrowUp'), { col: 0, index: 0 })
})
