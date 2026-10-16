import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { Fragment, Slice } from 'prosemirror-model'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

test('production page schema preserves custom blocks, inline nodes, and rich column children', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { schema } = await server.ssrLoadModule('/src/components/page/schema.tsx')
    const { BlockNoteEditor } = await import('@blocknote/core')
    const content = [
      { id: 'heading', type: 'heading', props: { level: 2, isToggleable: true }, content: 'Expandable', children: [{ id: 'heading-child', type: 'paragraph', content: 'Inside' }] },
      { id: 'callout', type: 'callout', props: { icon: '💡' }, content: 'Important' },
      { id: 'bookmark', type: 'bookmark', props: { title: 'Offline card', url: 'https://example.org/reference', description: 'Saved locally', image: 'data:image/png;base64,aGVsbG8=' } },
      { id: 'embed', type: 'externalReference', props: { provider: 'Embed', url: 'https://example.org/reference', title: 'Site title', description: 'Site description', image: 'data:image/png;base64,aGVsbG8=', icon: 'data:image/png;base64,aGVsbG8=' } },
      { id: 'equation', type: 'equation', props: { latex: 'x^2' } },
      { id: 'button', type: 'localButton', props: { label: 'Open', targetPageId: 'target' } },
      { id: 'breadcrumb', type: 'breadcrumb', props: { pageId: 'source' } },
      { id: 'synced', type: 'syncedBlock', props: { syncedId: 'sync-1' } },
      { id: 'inline', type: 'paragraph', content: [
        { type: 'inlineEquation', props: { id: 'math-1', latex: 'a+b' } },
        { type: 'dateMention', props: { id: 'date-1', date: '2026-10-06T15:00:00.000Z', pageId: 'source' } },
      ] },
      { id: 'columns', type: 'columnList', children: [
        { id: 'left', type: 'column', props: { width: 1 }, children: [{ id: 'left-text', type: 'paragraph', content: 'Left column' }] },
        { id: 'right', type: 'column', props: { width: 1 }, children: [{ id: 'right-text', type: 'bulletListItem', content: 'Right column' }] },
      ] },
    ]
    const first = BlockNoteEditor.create({ schema, initialContent: content })
    const serialized = JSON.parse(JSON.stringify(first.document))
    const reopened = BlockNoteEditor.create({ schema, initialContent: serialized })
    assert.deepEqual(JSON.parse(JSON.stringify(reopened.document)), serialized)
    assert.equal(reopened.getBlock('heading').props.isToggleable, true)
    assert.equal(reopened.getBlock('columns').children[0].children[0].content[0].text, 'Left column')
    assert.equal(reopened.getBlock('inline').content[1].props.date, '2026-10-06T15:00:00.000Z')
    assert.equal(reopened.getBlock('synced').props.syncedId, 'sync-1')
    assert.equal(reopened.getBlock('bookmark').props.description, 'Saved locally')
    assert.equal(reopened.getBlock('embed').props.title, 'Site title')
    assert.equal(reopened.getBlock('embed').props.description, 'Site description')
    assert.equal(reopened.getBlock('embed').props.image, 'data:image/png;base64,aGVsbG8=')
    const { bookmarkURL } = await server.ssrLoadModule('/src/components/page/BookmarkBlock.tsx')
    assert.equal(bookmarkURL('javascript:alert(1)'), null)
    assert.equal(bookmarkURL('https://secret@example.org'), null)
    assert.equal(bookmarkURL('https://example.org/reference'), 'https://example.org/reference')
    const html = reopened.blocksToHTMLLossy([reopened.getBlock('bookmark')])
    assert.match(html, /Offline card/); assert.match(html, /Saved locally/); assert.match(html, /data:image\/png;base64/)
  } finally { await server.close() }
})

test('dragged inline database page block nests in an empty toggle without losing ownership', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { schema } = await server.ssrLoadModule('/src/components/page/schema.tsx')
    const { BlockDropExtension } = await server.ssrLoadModule('/src/components/page/slashMenu/listNesting.ts')
    const { BlockNoteEditor } = await import('@blocknote/core')
    let rows = []
    const editor = BlockNoteEditor.create({ schema, extensions: [BlockDropExtension({ geometry: () => rows })], initialContent: [
      { id: 'database-block', type: 'page', props: { pageId: 'database-page', ownership: 'owned', display: 'inline' } },
      { id: 'target-toggle', type: 'toggleListItem', content: 'Tarefas' },
    ] })
    const host = document.createElement('div'); document.body.append(host); editor.mount(host)
    try {
      const view = editor._tiptapEditor.view
      view.posAtCoords = () => null
      let sourceNode
      view.state.doc.descendants((node) => { if (node.type.name === 'blockContainer' && node.attrs.id === 'database-block') sourceNode = node })
      assert.ok(sourceNode)
      const slice = new Slice(Fragment.from(sourceNode), 0, 0)
      const drop = (clientX, clientY) => view.someProp('handleDrop', handler => handler(view, { clientX, clientY, dataTransfer: { types: ['blocknote/html'] } }, slice, false) ? true : undefined)
      // O ponteiro na calha (alinhado com a alça, à esquerda do bloco) sobre o placeholder "Toggle vazio".
      rows = [
        { id: 'target-toggle', placeholder: false, top: 0, bottom: 30, left: 24, right: 800, blockLeft: 0, blockRight: 800, childrenVisible: false, open: true },
        { id: 'target-toggle', placeholder: true, top: 30, bottom: 54, left: 48, right: 400, blockLeft: 0, blockRight: 800, childrenVisible: false, open: true },
      ]
      assert.equal(drop(-20, 42), true)
      assert.equal(editor.getBlock('target-toggle').children[0].id, 'database-block')
      assert.equal(editor.getBlock('database-block').props.pageId, 'database-page')
      assert.equal(editor.getBlock('database-block').props.ownership, 'owned')
      assert.equal(editor.undo(), true)
      assert.deepEqual(editor.document.map(block => block.id), ['database-block', 'target-toggle'])
      editor.updateBlock('target-toggle', { children: [{ id: 'toggle-child', type: 'paragraph', content: 'Inside' }] })
      rows = [{ id: 'toggle-child', placeholder: false, top: 30, bottom: 60, left: 48, right: 800, blockLeft: 24, blockRight: 800, childrenVisible: false, open: false }]
      assert.equal(drop(-20, 55), true)
      assert.deepEqual(editor.getBlock('target-toggle').children.map(block => block.id), ['toggle-child', 'database-block'])
    } finally { editor.unmount(); host.remove() }
  } finally { await server.close() }
})
