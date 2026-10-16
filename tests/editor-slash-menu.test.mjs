import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { SLASH_CATALOG, catalogForQuery } from '../src/components/page/slashMenu/catalog.ts'
import { columnsFromBlock, copyBlockForNewPage, persistOwnedBlockBeforeNavigation } from '../src/components/page/slashMenu/lifecycle.ts'
import { localHtmlDocument } from '../src/components/page/slashMenu/htmlSandbox.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'SVGElement', 'CSSStyleSheet', 'HTMLDivElement', 'DocumentFragment', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 120, height: 30 })
dom.window.SVGElement.prototype.getComputedTextLength = () => 120
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
const { BlockNoteEditor, BlockNoteSchema } = await import('@blocknote/core')
const { columnBlockSpecs } = await import('../src/components/page/columns/nodes.ts')
const { defaultBlockSpecs } = await import('@blocknote/core')
const withMultiColumn = () => BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, ...columnBlockSpecs() } })
const { nestBlocksInList, ListDropNestingExtension } = await import('../src/components/page/slashMenu/listNesting.ts')
const { captureBlockTextAnchor } = await import('../src/components/page/commentAnchors.ts')
const { loadLocalMermaid, renderLocalMermaid, isolatedMermaidDocument, checkLocalMermaidSource } = await import('../src/components/page/slashMenu/mermaidRuntime.ts')
const { Fragment, Slice } = await import('prosemirror-model')

test('catálogo do menu possui IDs únicos, opções das capturas e busca pt/en', () => {
  assert.equal(new Set(SLASH_CATALOG.map((item) => item.id)).size, SLASH_CATALOG.length)
  const find = (id) => SLASH_CATALOG.find((item) => item.id === id)
  for (const id of ['heading-4', 'toggle-heading-4', 'database-inline', 'database-full-page', 'feed-view', 'dashboard-view', 'map-view', 'chart-number', 'form', 'linked-data-source', 'html', 'tabs', 'code-mermaid', 'ai-block', 'embed-pagerduty', 'import-word', 'import-zip', 'import-pdf', 'turn-page', 'turn-page-in', 'ask-ai', 'text-color-red', 'background-color-red']) assert.ok(find(id), id)
  assert.equal(find('database-full-page').operation, 'database:table:page')
  assert.equal(find('embed-pdf').operation, 'file:pdf')
  assert.deepEqual(catalogForQuery('datafullpage', 'en-US').map((item) => item.id), ['database-full-page'])
  assert.ok(catalogForQuery('página', 'pt-BR').some((item) => item.id === 'page'))
  assert.ok(catalogForQuery('page', 'en-US').some((item) => item.id === 'turn-page'))
  assert.equal(catalogForQuery('page', 'en-US').filter((item) => item.en === 'HTML').length, 1)
  for (const [query, id] of [['plain', 'text'], ['num', 'numbered-list'], ['div', 'divider'], ['book', 'web-bookmark'], ['moveto', 'move-to'], ['toc', 'table-of-contents'], ['bread', 'breadcrumb'], ['template', 'button'], ['math', 'block-equation'], ['latex', 'block-equation'], ['reminder', 'date-reminder'], ['comment', 'comment'], ['database full page', 'database-full-page'], ['banco página inteira', 'database-full-page']]) assert.ok(catalogForQuery(query, 'en-US').some((item) => item.id === id), query)
  assert.equal(SLASH_CATALOG.filter((item) => item.category === 'Text color').length, 10)
  assert.equal(SLASH_CATALOG.filter((item) => item.category === 'Background color').length, 10)
  assert.equal(SLASH_CATALOG.filter((item) => item.operation.startsWith('external:')).every((item) => item.status === 'offline-reference'), true)
})

test('navegação de subpágina espera gravação do bloco pai e metadados; falha impede abrir', async () => {
  const sequence = []
  let completeSave
  const delayed = new Promise((resolve) => { completeSave = resolve })
  const pending = persistOwnedBlockBeforeNavigation('child', async () => { sequence.push('save-start'); await delayed; sequence.push('save-end') }, async () => { sequence.push('meta') }, (id) => sequence.push(`open:${id}`))
  await Promise.resolve()
  assert.deepEqual(sequence, ['save-start'])
  completeSave()
  await pending
  assert.deepEqual(sequence, ['save-start', 'save-end', 'meta', 'open:child'])
  const failed = []
  await assert.rejects(persistOwnedBlockBeforeNavigation('child', async () => { throw new Error('disk failure') }, async () => { failed.push('meta') }, () => failed.push('open')), /disk failure/)
  assert.deepEqual(failed, [])
})

test('comando de comentário ancora texto do bloco com cursor colapsado', () => {
  const editor = BlockNoteEditor.create({ initialContent: [{ id: 'note', type: 'paragraph', content: 'A commentable paragraph' }] })
  const anchor = captureBlockTextAnchor(editor.prosemirrorState.doc, 'note')
  assert.equal(anchor?.segments[0]?.blockId, 'note')
  assert.equal(anchor?.segments[0]?.quote, 'A commentable paragraph')
})

test('converter bloco em página copia texto rico, filhos e referências sem mutar origem', () => {
  const source = { id: 'parent', type: 'bulletListItem', content: [{ type: 'text', text: 'Important', styles: { bold: true } }], children: [{ id: 'nested', type: 'page', props: { pageId: 'child', ownership: 'owned' }, children: [] }] }
  const copy = copyBlockForNewPage(source)
  assert.deepEqual(copy, source)
  assert.notEqual(copy, source)
  copy.children[0].props.pageId = 'changed'
  assert.equal(source.children[0].props.pageId, 'child')
})

test('converter lista em colunas preserva filhos e referências owned na primeira coluna', () => {
  const source = { id: 'list', type: 'bulletListItem', content: [{ type: 'text', text: 'Parent', styles: { bold: true } }], children: [{ id: 'nested', type: 'page', props: { pageId: 'child', ownership: 'owned' }, children: [] }] }
  const columns = columnsFromBlock(source, 4)
  assert.equal(columns.length, 4)
  assert.deepEqual(columns[0].children[0].children, source.children)
  assert.notEqual(columns[0].children[0].children, source.children)
  assert.deepEqual(columns[0].children[0].content, source.content)
  assert.equal(columns[0].children[0].type, 'bulletListItem')
  assert.notEqual(columns[0].children[0].id, source.id)
  const heading = { id: 'colored-heading', type: 'heading', props: { level: 3, textColor: 'red' }, content: [{ type: 'text', text: 'Heading', styles: { italic: true } }], children: [] }
  const headingColumn = columnsFromBlock(heading, 2)[0].children[0]
  assert.equal(headingColumn.type, 'heading')
  assert.deepEqual(headingColumn.props, heading.props)
  assert.deepEqual(headingColumn.content, heading.content)
  assert.equal(columns[1].children[0].type, 'paragraph')
  assert.throws(() => columnsFromBlock(source, 6), /2–5/)
  const editor = BlockNoteEditor.create({ schema: withMultiColumn(), initialContent: [{ id: 'list', type: 'bulletListItem', content: 'Parent', children: [{ id: 'nested', type: 'paragraph', content: 'Child' }] }] })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  try {
    editor.updateBlock('list', { type: 'columnList', children: columnsFromBlock(editor.getBlock('list'), 3) })
    assert.equal(editor.getBlock('nested').content[0].text, 'Child')
    assert.equal(editor.document[0].type, 'columnList')
    assert.equal(editor.document[0].children.length, 3)
    assert.equal(editor.undo(), true)
    assert.equal(editor.getBlock('list').type, 'bulletListItem')
    assert.equal(editor.getBlock('nested').content[0].text, 'Child')
    assert.equal(editor.redo(), true)
    assert.equal(editor.getBlock('nested').content[0].text, 'Child')
  } finally { editor.unmount(); host.remove() }
})

test('soltar bloco na área interna da lista preserva IDs, filhos e conteúdo na transação final', () => {
  const initial = [{ id: 'loose', type: 'paragraph', content: 'Move me', children: [{ id: 'owned-child', type: 'paragraph', content: 'Nested', children: [] }] }, { id: 'list', type: 'bulletListItem', content: 'Parent', children: [{ id: 'existing', type: 'paragraph', content: 'Keep', children: [] }] }]
  const next = nestBlocksInList(initial, ['loose'], 'list')
  assert.equal(next.length, 1)
  assert.deepEqual(next[0].children.map((block) => block.id), ['existing', 'loose'])
  assert.equal(next[0].children[1].children[0].id, 'owned-child')
  assert.equal(initial.length, 2)
  assert.equal(nestBlocksInList(next, ['list'], 'loose'), null)
  assert.equal(nestBlocksInList(initial, ['loose'], 'missing'), null)
  const editor = BlockNoteEditor.create({ schema: BlockNoteSchema.create(), initialContent: initial })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  try {
    editor.replaceBlocks(editor.document, next)
    assert.equal(editor.getBlock('loose').content[0].text, 'Move me')
    assert.equal(editor.getBlock('owned-child').content[0].text, 'Nested')
    assert.equal(editor.document[0].children[1].id, 'loose')
    assert.equal(editor.undo(), true)
    assert.deepEqual(editor.document.map((block) => block.id), ['loose', 'list'])
    assert.equal(editor.redo(), true)
    assert.equal(editor.document[0].children[1].id, 'loose')
  } finally { editor.unmount(); host.remove() }
})

test('handler real de drop aninha em listas sem consumir bordas ou duplicar IDs', () => {
  for (const listType of ['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']) {
    // Geometria injetada: uma linha (o item de lista) de 0..200 x 0..40.
    const geometry = () => [{ id: 'target', placeholder: false, top: 0, bottom: 40, left: 0, right: 200, blockLeft: 0, blockRight: 200, childrenVisible: false, open: false }]
    const editor = BlockNoteEditor.create({ schema: withMultiColumn(), extensions: [ListDropNestingExtension({ geometry })], initialContent: [{ id: 'loose', type: 'paragraph', content: 'Move me', children: [{ id: 'nested', type: 'paragraph', content: 'Child' }] }, { id: 'target', type: listType, content: 'List' }] })
    const host = document.createElement('div'); document.body.append(host); editor.mount(host)
    try {
      const view = editor._tiptapEditor.view
      view.posAtCoords = () => null // jsdom não tem layout; a geometria vem de `geometry`.
      let sourceNode
      view.state.doc.descendants((node) => { if (node.type.name === 'blockContainer' && node.attrs.id === 'loose') sourceNode = node })
      assert.ok(sourceNode)
      const slice = new Slice(Fragment.from(sourceNode), 0, 0)
      const drop = (clientX, moved = true) => view.someProp('handleDrop', (handler) => handler(view, { clientX, clientY: 30, dataTransfer: { types: ['application/x-prosemirror'], getData: () => '' } }, slice, moved) ? true : undefined)
      assert.equal(drop(5), true, `${listType}: borda esquerda cria colunas`)
      assert.equal(editor.document[0].type, 'columnList')
      assert.deepEqual(editor.document[0].children.map((column) => column.children[0].id), ['loose', 'target'])
      assert.equal(editor.undo(), true)
      assert.deepEqual(editor.document.map((block) => block.id), ['loose', 'target'])
      assert.equal(drop(195), true, `${listType}: borda direita cria colunas`)
      assert.deepEqual(editor.document[0].children.map((column) => column.children[0].id), ['target', 'loose'])
      assert.equal(editor.undo(), true)
      assert.deepEqual(editor.document.map((block) => block.id), ['loose', 'target'])
      assert.equal(drop(80, false), undefined, `${listType}: drop externo intocado`)
      assert.equal(drop(80), true, `${listType}: área interna aninha`)
      const ids = []
      const visit = (blocks) => blocks.forEach((block) => { ids.push(block.id); visit(block.children) })
      visit(editor.document)
      assert.equal(ids.filter((id) => id === 'loose').length, 1)
      assert.equal(ids.filter((id) => id === 'nested').length, 1)
      assert.equal(editor.getBlock('target').children[0].id, 'loose')
      assert.equal(editor.undo(), true)
      assert.deepEqual(editor.document.map((block) => block.id), ['loose', 'target'])
      assert.equal(editor.redo(), true)
      assert.equal(editor.getBlock('target').children[0].id, 'loose')
    } finally { editor.unmount(); host.remove() }
  }
})

test('runtime Mermaid empacotado valida flowchart, sequence e Gantt com segurança estrita', async () => {
  const mermaid = await loadLocalMermaid()
  for (const source of ['flowchart LR\nA[Start] --> B[Done]', 'sequenceDiagram\nAlice->>Bob: Hello', 'gantt\n    title Local schedule\n    dateFormat YYYY-MM-DD\n    section Work\n    Draft :a1, 2026-10-06, 1d']) {
    const result = await mermaid.parse(source)
    assert.ok(result?.diagramType, source)
  }
  assert.throws(() => checkLocalMermaidSource('flowchart LR\nA[https://example.com]'), /External resources/)
  assert.match(isolatedMermaidDocument('<svg></svg>'), /connect-src 'none'/)
  assert.match(isolatedMermaidDocument('<svg></svg>'), /script-src 'none'/)
  for (const [kind, source] of [['flowchart', 'flowchart LR\nA[Start] --> B[Done]'], ['sequence', 'sequenceDiagram\nAlice->>Bob: Hello'], ['gantt', 'gantt\n    title Local schedule\n    dateFormat YYYY-MM-DD\n    section Work\n    Draft :a1, 2026-10-06, 1d']]) {
    const diagram = await renderLocalMermaid(source, `test-${kind}`)
    assert.ok(diagram.diagramType.startsWith(kind), kind)
    assert.match(diagram.svg, /<svg/)
  }
})

test('HTML isolado injeta CSP sem rede antes do conteúdo e limita o tamanho', () => {
  const html = localHtmlDocument('<script>fetch("https://example.com")</script>')
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'))
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /default-src 'none'/)
  assert.equal(localHtmlDocument('x'.repeat(100_000)).length - localHtmlDocument('').length, 80_000)
})

test('"/pdf": Enter e clique usam o mesmo callback, e o seletor de PDF é pedido antes de qualquer await (mantém o gesto do usuário)', async () => {
  const { readFileSync } = await import('node:fs')
  const { planSlashMenu } = await import('../src/components/page/slashMenu/ranking.ts')
  for (const locale of ['pt-BR', 'en-US']) {
    const first = planSlashMenu(SLASH_CATALOG, { query: 'pdf', locale })[0]
    assert.ok(first.kind !== 'more' && first.command.operation === 'file:pdf', `${locale}: primeiro resultado de "/pdf" insere o PDF`)
  }
  // BlockNote: Enter → onItemClick(items[selectedIndex]); clique → Menu.tsx onItemClick(item). Os dois chegam em item.onItemClick.
  const menu = readFileSync('src/components/page/slashMenu/Menu.tsx', 'utf8')
  assert.ok(menu.includes('onClick={() => props.onItemClick?.(item)}'), 'clique usa o onItemClick do menu')
  const handler = readFileSync('node_modules/@blocknote/react/src/components/SuggestionMenu/hooks/useSuggestionMenuKeyboardHandler.ts', 'utf8')
  assert.ok(/event\.key === "Enter"[\s\S]*onItemClick\?\.\(items\[selectedIndex\]\)/.test(handler), 'Enter chama o mesmo onItemClick')
  const build = readFileSync('src/components/page/slashMenu/build.tsx', 'utf8')
  const body = build.slice(build.indexOf('export async function executeSlashCommand'))
  const pdfAt = body.indexOf("context.onFile('pdf')"), firstAwait = body.indexOf('await ')
  assert.ok(pdfAt > 0 && pdfAt < firstAwait, 'file:pdf chama o seletor de forma síncrona, antes do primeiro await')
  assert.ok(build.includes('onItemClick: () => { recordSlashUse(item.id); void executeSlashCommand('), 'item único para Enter e clique')
})
