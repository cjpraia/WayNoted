// Colunas próprias (src/components/page/columns): modelo puro, editor real em jsdom, documento antigo.
// Regra do jsdom: nunca passe nós do DOM para assert.* (use strings/números/booleans).
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'SVGElement', 'CSSStyleSheet', 'HTMLDivElement', 'DocumentFragment', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot', 'KeyboardEvent', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })

const { closeHistory } = await import('prosemirror-history')
const { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } = await import('@blocknote/core')
const model = await import('../src/components/page/columns/model.ts')
const { columnBlockSpecs } = await import('../src/components/page/columns/nodes.ts')
const actions = await import('../src/components/page/columns/actions.ts')
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs() } })

const P = (id, text) => ({ id, type: 'paragraph', content: text, children: [] })
const col = (id, width, ...children) => ({ id, type: 'column', props: { width }, children })
// Documento no formato gravado por versões anteriores (tipos e props idênticos).
const legacy = () => [
  P('intro', 'Antes'),
  { id: 'cols', type: 'columnList', props: {}, children: [col('c1', 2, P('a', 'Esquerda'), { id: 'b', type: 'heading', props: { level: 2 }, content: 'Título', children: [] }), col('c2', 1, P('c', 'Direita'))] },
  P('outro', 'Depois'),
]

function boot(initialContent) {
  const editor = BlockNoteEditor.create({ schema, initialContent })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  return { editor, host, done() { editor.unmount(); host.remove() } }
}
const shape = (blocks) => blocks.map((block) => block.children?.length ? `${block.id}[${shape(block.children)}]` : block.id).join(',')
const widths = (editor, id = 'cols') => editor.getBlock(id).children.map((column) => column.props.width)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('modelo: pesos legados, normalização e frações', () => {
  assert.equal(model.columnWeight(undefined), 1)
  assert.equal(model.columnWeight('2'), 2)
  assert.equal(model.columnWeight(0), 1)
  assert.equal(model.columnWeight(-3), 1)
  assert.equal(model.columnWeight(Number.NaN), 1)
  assert.deepEqual(model.normalizeWidths([1, 1, 1]), [1, 1, 1])
  assert.deepEqual(model.normalizeWidths([2, 1]), [1.333, 0.667])
  assert.deepEqual(model.normalizeWidths([]), [])
  assert.deepEqual(model.toFractions([1, 3]), [0.25, 0.75])
  assert.equal(model.percentOf([1, 3], 1), 75)
})

test('modelo: redimensionar respeita mínimo, soma e limites', () => {
  assert.deepEqual(model.resizeBoundary([1, 1], 0, 0.05), [1.1, 0.9])
  assert.deepEqual(model.resizeBoundary([1, 1], 0, -0.05), [0.9, 1.1])
  // Mínimo de 10% do total (2 → 0,2) por coluna.
  assert.deepEqual(model.resizeBoundary([1, 1], 0, 0.9), [1.8, 0.2])
  assert.deepEqual(model.snapBoundary([1, 1], 0, 'start'), [0.2, 1.8])
  assert.deepEqual(model.snapBoundary([1, 1], 0, 'end'), [1.8, 0.2])
  assert.equal(model.resizeBoundary([1, 1], 1, 0.05), null, 'não há divisória depois da última coluna')
  assert.equal(model.snapBoundary([1.8, 0.2], 0, 'end'), null, 'já está no limite')
  // Só o par vizinho muda; a soma é preservada.
  const three = model.resizeBoundary([1, 1, 1], 1, 0.05)
  assert.equal(three[0], 1)
  assert.ok(Math.abs(three[1] + three[2] - 2) < 1e-9)
  assert.deepEqual(model.equalWidths(3), [1, 1, 1])
  assert.equal(model.newColumnWeight([2, 1]), 1.5)
  assert.throws(() => model.buildColumnList(1), /2–5/)
  assert.throws(() => model.buildColumnList(6), /2–5/)
  assert.equal(model.buildColumnList(3).children.length, 3)
})

test('modelo: plano de arrastar para a lateral', () => {
  const doc = [P('x', 'x'), P('y', 'y'), { id: 'L', type: 'columnList', children: [col('A', 1, P('a1', '1')), col('B', 1, P('b1', '2'), { id: 'nest', type: 'bulletListItem', children: [P('deep', 'd')] })] }, { id: 'L2', type: 'columnList', children: [col('c1', 1, P('p1', '1')), col('c2', 1, P('p2', '2')), col('c3', 1, P('p3', '3')), col('c4', 1, P('p4', '4')), col('c5', 1, P('p5', '5'))] }]
  assert.deepEqual(model.planColumnDrop(doc, ['x'], 'y', 'left'), { kind: 'new-list', targetId: 'y', edge: 'left' })
  assert.deepEqual(model.planColumnDrop(doc, ['x'], 'a1', 'right'), { kind: 'new-column', columnId: 'A', edge: 'right' })
  assert.equal(model.planColumnDrop(doc, ['x'], 'x', 'left'), null, 'em si mesmo')
  assert.equal(model.planColumnDrop(doc, ['x'], 'missing', 'left'), null)
  assert.equal(model.planColumnDrop(doc, [], 'y', 'left'), null)
  assert.equal(model.planColumnDrop(doc, ['L'], 'a1', 'left'), null, 'colunas em colunas')
  assert.equal(model.planColumnDrop(doc, ['x'], 'deep', 'left'), null, 'neto de coluna não cria coluna')
  assert.equal(model.planColumnDrop(doc, ['x'], 'p1', 'left'), null, 'máximo de 5 colunas')
  assert.equal(model.planColumnDrop(doc, ['A'], 'y', 'left'), null, 'uma coluna sozinha não é arrastada')
  // Esvaziar uma coluna da própria lista libera espaço para a nova.
  assert.deepEqual(model.planColumnDrop(doc, ['p5'], 'p1', 'left'), { kind: 'new-column', columnId: 'c1', edge: 'left' })
  assert.deepEqual(model.dissolveColumns(doc[2]).map((b) => b.id), ['a1', 'b1', 'nest'])
  assert.equal(model.enclosingColumnList(doc, 'deep').id, 'L')
  assert.equal(model.enclosingColumnList(doc, 'a1').id, 'L')
  assert.equal(model.enclosingColumnList(doc, 'x'), null)
})

test('documento antigo (columnList/column com width) abre idêntico e volta idêntico', () => {
  const { editor, done } = boot(legacy())
  try {
    assert.equal(shape(editor.document), 'intro,cols[c1[a,b],c2[c]],outro')
    assert.deepEqual(widths(editor), [2, 1])
    assert.equal(editor.getBlock('cols').type, 'columnList')
    assert.deepEqual(editor.getBlock('cols').props, {})
    assert.equal(editor.getBlock('c1').type, 'column')
    assert.equal(editor.getBlock('b').props.level, 2)
    // Serializa e reabre: mesmo documento (como salvar e abrir a página).
    const saved = JSON.parse(JSON.stringify(editor.document))
    const again = boot(saved)
    try { assert.equal(JSON.stringify(again.editor.document), JSON.stringify(saved)) } finally { again.done() }
    // Largura ausente (dado muito antigo) vira 1.
    const bare = boot([{ id: 'l', type: 'columnList', children: [{ id: 'k1', type: 'column', children: [P('q', '1')] }, { id: 'k2', type: 'column', children: [P('r', '2')] }] }])
    try { assert.deepEqual(widths(bare.editor, 'l'), [1, 1]) } finally { bare.done() }
  } finally { done() }
})

test('renderização: grupos, rótulos de acessibilidade, largura proporcional e alças', async () => {
  const { editor, host, done } = boot(legacy())
  try {
    await tick()
    const lists = host.querySelectorAll('[data-node-type="columnList"]')
    assert.equal(lists.length, 1)
    assert.equal(lists[0].getAttribute('role'), 'group')
    assert.equal(lists[0].getAttribute('aria-label'), 'Colunas')
    const columns = [...host.querySelectorAll('.pg-column')]
    assert.equal(columns.length, 2)
    assert.deepEqual(columns.map((c) => c.getAttribute('role')), ['group', 'group'])
    assert.deepEqual(columns.map((c) => c.getAttribute('aria-label')), ['Coluna 1 de 2', 'Coluna 2 de 2'])
    assert.deepEqual(columns.map((c) => c.style.flex), ['2 1 0%', '1 1 0%'])
    const handles = [...host.querySelectorAll('.pg-column-handle')]
    assert.equal(handles.length, 1, 'uma alça entre duas colunas')
    assert.equal(handles[0].getAttribute('role'), 'separator')
    assert.equal(handles[0].getAttribute('aria-orientation'), 'vertical')
    assert.equal(handles[0].getAttribute('aria-valuenow'), '67')
    assert.equal(handles[0].getAttribute('tabindex'), '0')
    assert.equal(editor.document.length, 3)
  } finally { done() }
})

test('redimensionar pelo teclado grava width e desfaz com ⌘Z', async () => {
  const { editor, host, done } = boot([{ id: 'cols', type: 'columnList', children: [col('c1', 1, P('a', 'a')), col('c2', 1, P('b', 'b')), col('c3', 1, P('c', 'c'))] }])
  try {
    await tick()
    const handles = () => [...host.querySelectorAll('.pg-column-handle')]
    assert.equal(handles().length, 2)
    const press = (index, key) => handles()[index].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    press(0, 'ArrowRight')
    assert.deepEqual(widths(editor), [1.15, 0.85, 1])
    press(0, 'ArrowLeft')
    press(0, 'ArrowLeft')
    assert.deepEqual(widths(editor), [0.85, 1.15, 1])
    press(1, 'End')
    assert.deepEqual(widths(editor), [0.85, 1.85, 0.3])
    editor._tiptapEditor.view.dispatch(closeHistory(editor._tiptapEditor.view.state.tr)) // toques em menos de 0,5 s formam um passo só
    press(1, 'Home')
    assert.deepEqual(widths(editor), [0.85, 0.3, 1.85])
    press(0, 'Tab') // tecla sem efeito
    assert.deepEqual(widths(editor), [0.85, 0.3, 1.85])
    assert.equal(editor.undo(), true)
    assert.deepEqual(widths(editor), [0.85, 1.85, 0.3])
    // O mínimo vale mesmo com muitos toques.
    for (let i = 0; i < 40; i++) press(0, 'ArrowLeft')
    assert.ok(widths(editor)[0] >= 0.29 && widths(editor)[0] <= 0.31, `mínimo de 10%: ${widths(editor)[0]}`)
    assert.equal(widths(editor).reduce((sum, v) => sum + v, 0).toFixed(2), '3.00')
    // Duplo clique equaliza.
    handles()[0].dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    assert.deepEqual(widths(editor), [1, 1, 1])
    // Em modo leitura o teclado não altera nada.
    editor.isEditable = false
    press(0, 'ArrowRight')
    assert.deepEqual(widths(editor), [1, 1, 1])
    editor.isEditable = true
    // O DOM reflete o valor gravado.
    await tick()
    assert.deepEqual([...host.querySelectorAll('.pg-column')].map((c) => c.style.flex), ['1 1 0%', '1 1 0%', '1 1 0%'])
  } finally { done() }
})

test('slash menu: inserir 2, 3 e 4 colunas (parágrafo vazio vira colunas; bloco com texto recebe depois) e desfazer', () => {
  for (const count of [2, 3, 4]) {
    const { editor, done } = boot([P('empty', ''), P('text', 'Olá')])
    try {
      editor.setTextCursorPosition('empty', 'start')
      const firstId = actions.insertColumns(editor, count)
      assert.equal(editor.document[0].type, 'columnList')
      assert.equal(editor.document[0].children.length, count)
      assert.ok(editor.document[0].children.every((c) => c.type === 'column' && c.props.width === 1 && c.children.length === 1 && c.children[0].type === 'paragraph'))
      assert.equal(editor.document.length, 2, 'o parágrafo vazio foi substituído')
      assert.equal(editor.getTextCursorPosition().block.id, firstId)
      assert.equal(editor.document[0].children[0].children[0].id, firstId)
      assert.equal(editor.undo(), true)
      assert.equal(shape(editor.document), 'empty,text')
      editor.setTextCursorPosition('text', 'end')
      actions.insertColumns(editor, count)
      assert.equal(editor.document[1].id, 'text')
      assert.equal(editor.document[2].type, 'columnList')
      assert.equal(editor.undo(), true)
      assert.equal(shape(editor.document), 'empty,text')
    } finally { done() }
  }
  // Dentro de coluna: recusado com a mensagem recebida.
  const { editor, done } = boot(legacy())
  try {
    editor.setTextCursorPosition('c', 'start')
    assert.throws(() => actions.insertColumns(editor, 2, { nested: 'sem colunas aninhadas' }), /sem colunas aninhadas/)
    assert.throws(() => actions.insertColumns(editor, 7), /2–5/)
  } finally { done() }
})

test('arrastar para a lateral: cria colunas, adiciona coluna, recusa o inválido e desfaz tudo', () => {
  const { editor, done } = boot([P('a', 'A'), P('b', 'B'), P('c', 'C')])
  try {
    // Solto → lista nova: [arrastado | alvo].
    assert.equal(actions.applyColumnDrop(editor, ['a'], 'b', 'left'), true)
    assert.equal(editor.document[1].id, 'c')
    assert.equal(editor.document[0].type, 'columnList')
    assert.deepEqual(editor.document[0].children.map((column) => column.children.map((block) => block.id)), [['a'], ['b']])
    assert.deepEqual(widths(editor, editor.document[0].id), [1, 1])
    editor._tiptapEditor.view.dispatch(closeHistory(editor._tiptapEditor.view.state.tr))
    // Terceiro bloco à direita da coluna do 'b': nova coluna depois dela.
    assert.equal(actions.applyColumnDrop(editor, ['c'], 'b', 'right'), true)
    assert.equal(editor.document.length, 1)
    assert.deepEqual(editor.document[0].children.map((column) => column.children.map((block) => block.id)), [['a'], ['b'], ['c']])
    assert.equal(editor.undo(), true)
    assert.equal(editor.document.length, 2, 'desfazer o segundo drop devolve o bloco solto')
    assert.deepEqual(editor.document[0].children.map((column) => column.children.map((block) => block.id)), [['a'], ['b']])
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'a,b,c')
    assert.equal(editor.redo(), true)
    assert.equal(editor.document[0].type, 'columnList')
    assert.equal(editor.undo(), true)
    // Recusados: em si mesmo / inexistente / sem origem.
    assert.equal(actions.applyColumnDrop(editor, ['a'], 'a', 'left'), false)
    assert.equal(actions.applyColumnDrop(editor, ['zzz'], 'a', 'left'), false)
    assert.equal(shape(editor.document), 'a,b,c')
  } finally { done() }
})

test('arrastar para fora de uma coluna: esvaziar remove a coluna e a coluna sozinha se desfaz', () => {
  const { editor, done } = boot(legacy())
  try {
    // Move o único bloco da coluna 2 para a lateral esquerda do bloco 'intro': a coluna 2 some e a lista, com uma coluna só, se desfaz.
    assert.equal(actions.applyColumnDrop(editor, ['c'], 'intro', 'right'), true)
    assert.equal(editor.document.some((block) => block.id === 'cols'), false, 'lista antiga desfeita')
    const ids = []
    const visit = (blocks) => blocks.forEach((block) => { ids.push(block.id); visit(block.children) })
    visit(editor.document)
    assert.equal(ids.filter((id) => id === 'c').length, 1, 'sem duplicar o bloco movido')
    assert.deepEqual(['a', 'b', 'intro', 'outro'].filter((id) => !ids.includes(id)), [], 'nenhum bloco se perdeu')
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'intro,cols[c1[a,b],c2[c]],outro')
    assert.deepEqual(widths(editor), [2, 1])
  } finally { done() }
})

test('remover o último bloco de uma coluna remove a coluna; sobrou uma, a lista se desfaz', () => {
  const { editor, done } = boot([{ id: 'cols', type: 'columnList', children: [col('c1', 1, P('a', '1')), col('c2', 1, P('b', '2')), col('c3', 1, P('c', '3'))] }, P('end', 'fim')])
  try {
    editor.removeBlocks(['b'])
    assert.equal(shape(editor.document), 'cols[c1[a],c3[c]],end')
    editor.removeBlocks(['c'])
    assert.equal(shape(editor.document), 'a,end', 'coluna única restante vira bloco solto')
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'cols[c1[a],c3[c]],end')
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'cols[c1[a],c2[b],c3[c]],end')
  } finally { done() }
})

test('menu do bloco: desfazer colunas e excluir colunas (⌘Z desfaz)', () => {
  const { editor, done } = boot(legacy())
  try {
    assert.equal(actions.undoColumns(editor, 'c'), true, 'a partir de um bloco dentro da coluna')
    assert.equal(shape(editor.document), 'intro,a,b,c,outro')
    assert.equal(editor.getBlock('b').props.level, 2)
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'intro,cols[c1[a,b],c2[c]],outro')
    assert.equal(actions.deleteColumns(editor, 'a'), true)
    assert.equal(shape(editor.document), 'intro,outro')
    assert.equal(editor.undo(), true)
    assert.equal(shape(editor.document), 'intro,cols[c1[a,b],c2[c]],outro')
    assert.equal(actions.undoColumns(editor, 'intro'), false)
    assert.equal(actions.deleteColumns(editor, 'outro'), false)
  } finally { done() }
})

test('copiar e colar uma coluna inteira: HTML interno preserva estrutura, ids e largura', () => {
  const { editor, done } = boot(legacy())
  try {
    const html = editor.blocksToFullHTML(editor.document)
    assert.match(html, /data-node-type="columnList"/)
    assert.match(html, /data-node-type="column"/)
    assert.match(html, /data-width="2"/)
    const back = editor.tryParseHTMLToBlocks(html)
    const list = back.find((block) => block.type === 'columnList')
    assert.ok(list, 'a lista de colunas voltou')
    assert.equal(list.children.length, 2)
    assert.deepEqual(list.children.map((column) => column.props.width), [2, 1])
    assert.equal(list.children[0].children.length, 2)
    assert.equal(list.children[1].children[0].content[0].text, 'Direita')
    // HTML externo (para outros apps) mantém as colunas aninhadas e o texto.
    const external = editor.blocksToHTMLLossy(editor.document)
    assert.match(external, /Esquerda/)
    assert.match(external, /Direita/)
  } finally { done() }
})
