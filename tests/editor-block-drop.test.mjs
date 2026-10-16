// Arrastar/soltar e colar blocos dentro de contêineres (toggle vazio/com filhos,
// título recolhível, coluna, callout, citação, item de lista) e para fora.
// Regra: nunca passar nós do DOM/objetos do jsdom para assert (só strings/números).
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { Fragment, Slice } from 'prosemirror-model'
import { closeHistory } from 'prosemirror-history'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLCanvasElement', 'SVGElement', 'DocumentFragment', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const drop = await import('../src/components/page/slashMenu/listNesting.ts')
const { copiedPageBlocks } = await import('../src/components/page/pastedPageBlocks.ts')
const { ownedPageBlockChanges } = await import('../electron/page-block-ownership.mjs')

const P = (id, text, children = []) => ({ id, type: 'paragraph', content: text, children })
const row = (id, extra = {}) => ({ id, placeholder: false, top: 0, bottom: 40, left: 24, right: 700, blockLeft: 0, blockRight: 800, childrenVisible: false, open: false, ...extra })

test('regra de destino: placeholder do toggle, calha, metades, recuo, colunas e ciclos', () => {
  const doc = [
    { id: 'T0', type: 'toggleListItem', children: [] },
    { id: 'T1', type: 'toggleListItem', children: [P('T1c', 'filho')] },
    { id: 'CL', type: 'callout', children: [] },
    { id: 'Q', type: 'quote', children: [] },
    { id: 'H', type: 'heading', props: { isToggleable: true }, children: [] },
    { id: 'Hplain', type: 'heading', props: { isToggleable: false }, children: [] },
    P('R1', 'raiz'),
    P('SRC', 'mover', [P('SRCc', 'neto')]),
  ]
  const kind = (decision) => decision.action === 'move' ? `${decision.placement.kind}:${decision.placement.targetId}` : decision.action
  // Placeholder "Toggle vazio": sempre dentro, inclusive com o ponteiro na calha (x negativo) ou na borda.
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('T0', { placeholder: true }), -30, 20)), 'child:T0')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('T0', { placeholder: true }), 790, 20)), 'child:T0')
  // Cabeçalho de toggle aberto: metade inferior entra; superior fica antes.
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('T0', { open: true }), -30, 30)), 'child:T0')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('T0', { open: true }), -30, 10)), 'before:T0')
  // Bloco com filhos visíveis: metade inferior vira primeiro filho.
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('T1', { childrenVisible: true }), 100, 30)), 'child:T1')
  // Callout/citação/título recolhível: dentro só com recuo; na calha, depois.
  for (const id of ['CL', 'Q', 'H']) {
    assert.equal(kind(drop.decideDrop(doc, ['SRC'], row(id), 24 + drop.DROP_INDENT + 5, 30)), `child:${id}`)
    assert.equal(kind(drop.decideDrop(doc, ['SRC'], row(id), -30, 30)), `after:${id}`)
  }
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('Hplain'), 300, 30)), 'after:Hplain')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('R1'), 300, 30)), 'after:R1')
  // Colunas: faixa estreita na borda esquerda e 10% à direita; o evento sintético da calha não cria colunas.
  assert.deepEqual(drop.decideDrop(doc, ['SRC'], row('R1'), 5, 30), { action: 'columns', edge: 'left', x: 0, targetId: 'R1' })
  assert.equal(drop.decideDrop(doc, ['SRC'], row('R1'), 790, 30).action, 'columns')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('R1'), 0, 30, true)), 'after:R1')
  // Nunca dentro de si mesmo ou de um descendente.
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('SRCc'), 300, 30)), 'reject')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], row('SRC'), 300, 30)), 'reject')
  assert.equal(kind(drop.decideDrop(doc, ['SRC'], null, 300, 30)), 'default')
  // Linha mais específica: placeholder vence o conteúdo do toggle que o contém.
  const picked = drop.pickDropRow([row('T0', { top: 0, bottom: 60 }), row('T0', { placeholder: true, top: 34, bottom: 58 })], -30, 40)
  assert.equal(picked.placeholder, true)
  assert.equal(drop.pickDropRow([row('a', { top: 0, bottom: 20 }), row('b', { top: 100, bottom: 120 })], 0, 60), null)
})

test('movimento puro preserva IDs, filhos e vínculos; aninhar em colunas/si mesmo é recusado', () => {
  const page = { id: 'DB', type: 'page', props: { pageId: 'db-1', ownership: 'owned', display: 'inline' }, children: [] }
  const doc = [{ id: 'T0', type: 'toggleListItem', children: [] }, { id: 'COLS', type: 'columnList', children: [{ id: 'C1', type: 'column', children: [P('C1p', 'x')] }] }, page]
  const moved = drop.moveBlocksInTree(doc, ['DB'], { kind: 'child', targetId: 'T0' })
  assert.deepEqual(moved.map((block) => block.id), ['T0', 'COLS'])
  assert.equal(moved[0].children[0].props.pageId, 'db-1')
  assert.equal(drop.moveBlocksInTree(doc, ['DB'], { kind: 'after', targetId: 'C1p' })[1].children[0].children.map((b) => b.id).join(','), 'C1p,DB')
  assert.equal(drop.moveBlocksInTree(doc, ['DB'], { kind: 'child', targetId: 'C1' }), null)
  assert.equal(drop.moveBlocksInTree(doc, ['T0'], { kind: 'child', targetId: 'T0' }), null)
  assert.equal(drop.moveBlocksInTree(doc, ['missing'], { kind: 'child', targetId: 'T0' }), null)
  assert.equal(doc.length, 3, 'entrada imutável')
})

test('mover bloco de banco/subpágina para dentro de contêiner não muda o dono nem manda para a lixeira', () => {
  const owner = 'owner'
  const pages = {
    owner: { id: owner, parentId: null },
    'db-1': { id: 'db-1', parentId: owner, blockOwnerId: owner, database: { properties: [], views: [] } },
    'sub-1': { id: 'sub-1', parentId: owner, blockOwnerId: owner },
  }
  const dbBlock = { id: 'B1', type: 'page', props: { pageId: 'db-1', ownership: 'owned', display: 'inline' }, children: [] }
  const subBlock = { id: 'B2', type: 'page', props: { pageId: 'sub-1', ownership: 'owned', display: 'page' }, children: [] }
  const before = [{ id: 'T', type: 'toggleListItem', children: [] }, { id: 'Q', type: 'quote', children: [] }, dbBlock, subBlock]
  for (const target of ['T', 'Q']) {
    const after = drop.moveBlocksInTree(before, ['B1', 'B2'], { kind: 'child', targetId: target })
    assert.deepEqual(ownedPageBlockChanges(owner, before, after, pages, 1), {}, target)
    assert.deepEqual(ownedPageBlockChanges(owner, after, before, pages, 1), {}, `${target} desfazer`)
  }
  // Recortar (some do documento) e colar (volta): a página é restaurada, mantendo o dono.
  const cut = [before[0], before[1]]
  const trashed = ownedPageBlockChanges(owner, before, cut, pages, 1)
  assert.equal(trashed['db-1'].trashed, true)
  const pasted = [{ ...before[0], children: [{ ...dbBlock, id: 'B1-pasted' }] }, before[1]]
  const restored = ownedPageBlockChanges(owner, cut, pasted, { ...pages, 'db-1': { ...pages['db-1'], ...trashed['db-1'] } }, 2)
  assert.equal(restored['db-1'].trashed, false)
  assert.equal(restored['db-1'].parentId, undefined, 'parentId não muda')
})

test('colar: copiar duplica bancos/subpáginas possuídos; recortar e vínculos mantêm a mesma página', () => {
  const block = (id, pageId, ownership = 'owned') => ({ id, type: 'page', props: { pageId, ownership }, children: [] })
  const before = [block('A', 'db-1'), block('L', 'db-2', 'linked'), P('x', 'texto')]
  // Copiar+colar dentro de um toggle: o original continua → cópia.
  const copied = [...before, { id: 'T', type: 'toggleListItem', children: [block('A2', 'db-1'), block('L2', 'db-2', 'linked')] }]
  assert.deepEqual(copiedPageBlocks(before, copied).map((b) => b.id), ['A2'])
  // Recortar+colar: o original saiu → move (mesmo banco).
  const cutPasted = [P('x', 'texto'), block('L', 'db-2', 'linked'), { id: 'T', type: 'toggleListItem', children: [block('A3', 'db-1')] }]
  assert.deepEqual(copiedPageBlocks(before, cutPasted), [])
})

// Matriz real no editor (schema de produção): cada tipo de bloco × cada contêiner, pelo handler de drop.
test('matriz: todo tipo de bloco entra em toggle (vazio/com filhos), título recolhível, coluna, callout, citação, lista e sai para a raiz', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { schema } = await server.ssrLoadModule('/src/components/page/schema.tsx')
    const { BlockDropExtension, blockDropCursor } = await server.ssrLoadModule('/src/components/page/slashMenu/listNesting.ts')
    const { BlockNoteEditor } = await import('@blocknote/core')
    const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const SOURCES = {
      paragraph: { type: 'paragraph', content: 'p' }, heading: { type: 'heading', props: { level: 2 }, content: 'h' },
      bulletListItem: { type: 'bulletListItem', content: 'b' }, numberedListItem: { type: 'numberedListItem', content: 'n' },
      checkListItem: { type: 'checkListItem', content: 'c' }, toggleListItem: { type: 'toggleListItem', content: 't', children: [P('srcchild', 'filho')] },
      codeBlock: { type: 'codeBlock', content: 'x = 1' }, image: { type: 'image', props: { url: IMG } },
      table: { type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a', 'b'] }] } }, divider: { type: 'divider' },
      equation: { type: 'equation', props: { latex: 'x' } },
      pageDb: { type: 'page', props: { pageId: 'db-1', ownership: 'owned', display: 'inline' } },
      pageSub: { type: 'page', props: { pageId: 'sub-1', ownership: 'owned', display: 'page' } },
      syncedBlock: { type: 'syncedBlock', props: { syncedId: 'sync-1' } }, localButton: { type: 'localButton', props: { label: 'Ir' } },
      columnList: { type: 'columnList', children: [{ type: 'column', children: [P('sc1', 'a')] }, { type: 'column', children: [P('sc2', 'b')] }] },
      tableOfContents: { type: 'tableOfContents' }, breadcrumb: { type: 'breadcrumb', props: { pageId: 'owner' } }, calendarAgenda: { type: 'calendarAgenda' },
      pdfPreview: { type: 'pdfPreview', props: { name: 'a.pdf' } }, file: { type: 'file', props: { name: 'a.txt', url: 'https://example.org/a.txt' } },
      localAttachment: { type: 'localAttachment', props: { name: 'a.bin' } }, video: { type: 'video' }, audio: { type: 'audio' },
      bookmark: { type: 'bookmark', props: { url: 'https://example.org', title: 'Ex' } }, quote: { type: 'quote', content: 'q' }, callout: { type: 'callout', content: 'c' },
    }
    const baseline = (source, nested) => {
      const containers = [
        { id: 'T0', type: 'toggleListItem', content: 'vazio' },
        { id: 'T1', type: 'toggleListItem', content: 'com filho', children: [P('T1c', 'filho')] },
        { id: 'H', type: 'heading', props: { level: 3, isToggleable: true }, content: 'h', children: [P('Hc', 'filho')] },
        { id: 'COLS', type: 'columnList', children: [{ id: 'COL1', type: 'column', children: [P('C1p', '1')] }, { id: 'COL2', type: 'column', children: [P('C2p', '2')] }] },
        { id: 'CL', type: 'callout', content: 'callout' }, { id: 'Q', type: 'quote', content: 'citação' },
        { id: 'L', type: 'bulletListItem', content: 'lista', children: [{ id: 'L1', type: 'bulletListItem', content: 'sub' }] },
        P('R1', 'raiz 1'), P('R2', 'raiz 2'),
      ]
      const src = { id: 'SRC', ...structuredClone(source) }
      if (nested) containers[1].children.push(src)
      return [...containers, ...(nested ? [] : [src])]
    }
    // Geometria de cada destino como o usuário solta: ponteiro na calha (x = -30) ou recuado (x = 200) num contêiner sem filhos.
    const DESTS = {
      T0: { rows: [row('T0', { placeholder: true })], x: -30, expect: 'T0' },
      T1: { rows: [row('T1c')], x: -30, expect: 'T1' },
      H: { rows: [row('H', { childrenVisible: true, open: true })], x: -30, expect: 'H' },
      COL2: { rows: [row('C2p', { blockLeft: 400 })], x: 500, expect: 'COL2' },
      CL: { rows: [row('CL')], x: 200, expect: 'CL' },
      Q: { rows: [row('Q')], x: 200, expect: 'Q' },
      L: { rows: [row('L1')], x: -30, expect: 'L' },
      ROOT: { rows: [row('R1')], x: -30, expect: null },
      OUT: { rows: [row('R1')], x: -30, expect: null, nested: true },
    }
    let rows = []
    const editor = BlockNoteEditor.create({ schema, extensions: [BlockDropExtension({ geometry: () => rows })], initialContent: [P('start', '')] })
    const host = document.createElement('div'); document.body.append(host); editor.mount(host)
    const view = editor._tiptapEditor.view
    view.posAtCoords = () => null // jsdom não tem layout; a geometria vem de `rows`.
    const failures = []
    const where = () => { let parent; let prev; let count = 0; const walk = (blocks, owner) => blocks.forEach((block, index) => { if (block.id === 'SRC') { count++; parent = owner; prev = index ? blocks[index - 1].id : null } walk(block.children, block.id) }); walk(editor.document, null); return { parent, prev, count } }
    try {
      for (const [name, source] of Object.entries(SOURCES)) {
        for (const [destName, dest] of Object.entries(DESTS)) {
          editor.replaceBlocks(editor.document, baseline(source, dest.nested))
          view.dispatch(closeHistory(view.state.tr))
          const before = JSON.stringify(editor.getBlock('SRC'))
          let node
          view.state.doc.descendants((candidate) => { if (candidate.attrs.id === 'SRC' && !node) node = candidate })
          rows = dest.rows
          const handled = view.someProp('handleDrop', (handler) => handler(view, { clientX: dest.x, clientY: 30, dataTransfer: { types: ['blocknote/html'] } }, new Slice(Fragment.from(node), 0, 0), true) ? true : undefined)
          const at = where()
          const sameBlock = JSON.stringify(editor.getBlock('SRC')) === before
          // Colunas dentro de colunas não existem (Export Bundle/multi-column): o drop é consumido sem mudar nada.
          if (name === 'columnList' && destName === 'COL2') { if (!(handled === true && at.parent === null && at.prev === 'R2')) failures.push(`columnList -> COL2 deveria ser recusado: parent=${at.parent}`); continue }
          const ok = handled === true && at.count === 1 && at.parent === dest.expect && sameBlock && (destName !== 'ROOT' && destName !== 'OUT' || at.prev === 'R1')
          if (!ok) failures.push(`${name} -> ${destName}: handled=${handled} parent=${at.parent} prev=${at.prev} n=${at.count} same=${sameBlock}`)
          else {
            assert.equal(editor.undo(), true)
            const undone = where()
            if (undone.parent !== (dest.nested ? 'T1' : null)) failures.push(`${name} -> ${destName}: desfazer deixou parent=${undone.parent}`)
          }
        }
      }
      assert.equal(failures.join('\n'), '')
      // Linha azul: mesma decisão; toggle vazio aponta para logo após o cabeçalho (dentro do bloco).
      editor.replaceBlocks(editor.document, baseline(SOURCES.pageDb, false))
      let node
      view.state.doc.descendants((candidate) => { if (candidate.type.name === 'blockContainer' && candidate.attrs.id === 'SRC') node = candidate })
      view.dragging = { slice: new Slice(Fragment.from(node), 0, 0), move: true }
      rows = DESTS.T0.rows
      const cursor = blockDropCursor.hooks.computeDropPosition({ editor, view, event: { clientX: -30, clientY: 30 }, defaultPosition: null })
      const $pos = view.state.doc.resolve(cursor.pos)
      assert.equal(cursor.orientation, 'block-horizontal')
      assert.equal($pos.parent.attrs.id, 'T0')
      assert.equal($pos.nodeBefore.type.name, 'toggleListItem')
      rows = [row('SRC')]
      assert.equal(blockDropCursor.hooks.computeDropPosition({ editor, view, event: { clientX: 300, clientY: 30 }, defaultPosition: null }), null, 'soltar sobre si mesmo não mostra linha')
      view.dragging = null
    } finally { editor.unmount(); host.remove() }
  } finally { await server.close() }
})
