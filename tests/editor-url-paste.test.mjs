import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'DocumentFragment', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.ClipboardEvent = class ClipboardEvent extends dom.window.Event { constructor(type, init = {}) { super(type, init) } }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } = await import('@blocknote/core')
const { createReactBlockSpec } = await import('@blocknote/react')
const { singlePastedUrl, pastedUrlIsVideo, pasteUrlAndCapture, applyPastedUrlChoice } = await import('../src/components/page/pasteUrl.ts')
const { blocksToText } = await import('../src/components/page/util.ts')
const { blockMenuText, blockMenuWordCount, blockMenuCharacterCount } = await import('../src/components/page/blockMenuStats.ts')

const card = (type) => createReactBlockSpec({ type, propSchema: { url: { default: '' }, title: { default: '' }, ...(type === 'externalReference' ? { provider: { default: '' } } : {}) }, content: 'none' }, { render: () => React.createElement('div') })
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, bookmark: card('bookmark')(), onlineVideo: card('onlineVideo')(), externalReference: card('externalReference')() } })

test('rodapé mede só bloco selecionado e reproduz 8 palavras/43 caracteres da URL de referência', () => {
  const url = 'https://www.youtube.com/watch?v=O4ZRCC-LIU4'
  const text = blockMenuText({ type: 'paragraph', content: [{ type: 'text', text: url, styles: {} }], children: [{ type: 'paragraph', content: 'another block' }] })
  assert.equal(text, url)
  assert.equal(blockMenuWordCount(text), 8)
  assert.equal(blockMenuCharacterCount(text), 43)
})
const kindOf = (choice) => choice === 'bookmark' ? 'bookmark' : choice === 'video' ? 'onlineVideo' : 'externalReference'
function editorWithPaste(text = '') {
  let capture
  const editor = BlockNoteEditor.create({ schema, initialContent: [{ id: 'note', type: 'paragraph', content: text }], pasteHandler: ({ event, editor, defaultPasteHandler }) => {
    const url = singlePastedUrl(event)
    if (!url) return defaultPasteHandler()
    capture = pasteUrlAndCapture(editor, url)
    return true
  } })
  const host = document.createElement('div'); document.body.append(host); editor.mount(host)
  return { editor, host, get capture() { return capture } }
}
function dispatchPaste(editor, value, types = ['text/plain'], html = '') {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { types, files: [], getData: (type) => type === 'text/plain' ? value : type === 'text/html' ? html : '' } })
  editor._tiptapEditor.view.dom.dispatchEvent(event)
}

test('handler de colagem real mantém URL em Escape e não abre menu para HTML rico ou esquemas inseguros', () => {
  const fixture = editorWithPaste()
  try {
    fixture.editor.setTextCursorPosition('note', 'end')
    dispatchPaste(fixture.editor, 'https://www.youtube.com/watch?v=O4ZRCC-LIU4')
    assert.equal(fixture.capture?.url, 'https://www.youtube.com/watch?v=O4ZRCC-LIU4')
    assert.equal(blocksToText(fixture.editor.document), fixture.capture.url)
    assert.equal(pastedUrlIsVideo(fixture.capture.url), true)
    // Dismissing the menu does not run any mutation; undo reverts the paste.
    assert.equal(fixture.editor.undo(), true)
    assert.equal(blocksToText(fixture.editor.document), '')
    dispatchPaste(fixture.editor, 'javascript:alert(1)')
    assert.equal(blocksToText(fixture.editor.document), 'javascript:alert(1)')
    assert.equal(singlePastedUrl({ clipboardData: { types: ['text/plain', 'text/html'], files: [], getData: (type) => type === 'text/html' ? '<strong>https://example.com</strong>' : 'https://example.com' } }), null)
    assert.equal(singlePastedUrl({ clipboardData: { types: ['text/plain', 'text/html'], files: [], getData: (type) => type === 'text/html' ? '<a href="https://example.com">https://example.com</a>' : 'https://example.com' } }), 'https://example.com')
    assert.equal(singlePastedUrl({ clipboardData: { types: ['text/plain'], files: [], getData: () => 'https://one.test\nhttps://two.test' } }), null)
  } finally { fixture.editor.unmount(); fixture.host.remove() }
})

test('link copiado do navegador com HTML de âncora simples abre o mesmo menu de URL', () => {
  const fixture = editorWithPaste()
  try {
    fixture.editor.setTextCursorPosition('note', 'end')
    const url = 'https://www.youtube.com/watch?v=O4ZRCC-LIU4'
    dispatchPaste(fixture.editor, url, ['text/plain', 'text/html'], `<a href="${url}">${url}</a>`)
    assert.equal(fixture.capture?.url, url)
    assert.equal(blocksToText(fixture.editor.document), url)
  } finally { fixture.editor.unmount(); fixture.host.remove() }
})

test('menção e URL usam o intervalo colado, mesmo depois de mover o cursor', () => {
  for (const choice of ['mention', 'url']) {
    const fixture = editorWithPaste('prefix ')
    try {
      fixture.editor.setTextCursorPosition('note', 'end')
      dispatchPaste(fixture.editor, 'https://example.com/path')
      assert.ok(fixture.capture)
      fixture.editor.setTextCursorPosition('note', 'start')
      assert.equal(applyPastedUrlChoice(fixture.editor, fixture.capture, choice), true)
      const text = blocksToText(fixture.editor.document)
      assert.ok(text.startsWith('prefix '))
      assert.match(text, choice === 'mention' ? /example\.com/ : /https:\/\/example\.com\/path/)
      assert.equal(fixture.editor.undo(), true)
      assert.equal(blocksToText(fixture.editor.document), 'prefix ')
      assert.equal(fixture.editor.redo(), true)
      assert.equal(blocksToText(fixture.editor.document), text)
    } finally { fixture.editor.unmount(); fixture.host.remove() }
  }
})

test('bookmark, incorporação e vídeo substituem só URL colada; texto rico adjacente e Undo sobrevivem', () => {
  for (const choice of ['bookmark', 'embed', 'video']) {
    const fixture = editorWithPaste('prefix  suffix')
    try {
      const doc = fixture.editor.prosemirrorState.doc
      let start
      doc.descendants((node, pos) => { if (node.type.name === 'blockContainer' && node.attrs.id === 'note') { start = pos + 2; return false } })
      fixture.editor._tiptapEditor.commands.setTextSelection(start + 7)
      dispatchPaste(fixture.editor, 'https://www.youtube.com/watch?v=O4ZRCC-LIU4')
      assert.ok(fixture.capture)
      assert.equal(applyPastedUrlChoice(fixture.editor, fixture.capture, choice), true)
      assert.equal(fixture.editor.document.length, 2)
      assert.equal(blocksToText([fixture.editor.document[0]]), 'prefix  suffix')
      assert.equal(fixture.editor.document[1].type, kindOf(choice))
      assert.equal(fixture.editor.document[1].props.url, 'https://www.youtube.com/watch?v=O4ZRCC-LIU4')
      if (choice === 'embed') assert.equal(fixture.editor.document[1].props.provider, 'Embed')
      assert.equal(fixture.editor.undo(), true)
      assert.equal(fixture.editor.document.length, 1)
      assert.match(blocksToText(fixture.editor.document), /prefix https:\/\/www.youtube.com\/watch\?v=O4ZRCC-LIU4 suffix/)
    } finally { fixture.editor.unmount(); fixture.host.remove() }
  }
})

test('URL sozinha vira um único bloco de bookmark, embed ou vídeo e Undo restaura o link', () => {
  for (const choice of ['bookmark', 'embed', 'video']) {
    const fixture = editorWithPaste()
    try {
      fixture.editor.setTextCursorPosition('note', 'end')
      dispatchPaste(fixture.editor, 'https://www.youtube.com/watch?v=O4ZRCC-LIU4')
      assert.equal(applyPastedUrlChoice(fixture.editor, fixture.capture, choice), true)
      assert.equal(fixture.editor.document.length, 1)
      assert.equal(fixture.editor.document[0].type, kindOf(choice))
      assert.equal(fixture.editor.undo(), true)
      assert.equal(blocksToText(fixture.editor.document), '')
      assert.equal(fixture.editor.redo(), true)
      assert.equal(fixture.editor.document[0].type, kindOf(choice))
    } finally { fixture.editor.unmount(); fixture.host.remove() }
  }
})
