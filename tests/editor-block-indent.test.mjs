import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] })
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect()

const { BlockNoteEditor, FormattingToolbarExtension } = await import('@blocknote/core')
const { TextSelection } = await import('@tiptap/pm/state')
const { editorExtensions } = await import('../src/components/page/editorExtensions.ts')
const { PreserveListChildrenOnEnter } = await import('../src/components/page/listEnter.ts')

function setup(t, initialContent, extensions = editorExtensions()) {
  const editor = BlockNoteEditor.create({ initialContent, extensions })
  const host = document.createElement('div')
  document.body.append(host)
  editor.mount(host)
  editor.focus()
  t.after(() => { editor.unmount(); host.remove() })
  const view = editor.prosemirrorView
  return { editor, press(key, options = {}, target = view.dom) {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event)
    return event.defaultPrevented
  } }
}

const block = (id, children = [], type = 'paragraph', content = id) => ({ id, type, content, children })
const ids = blocks => blocks.map(item => item.id)
const text = item => item.content.map(part => part.text ?? '').join('')

test('Tab nests the selected subtree, and Shift+Tab lifts it without adopting later siblings', t => {
  const { editor, press } = setup(t, [block('parent', [block('first')]), block('target', [block('inner')]), block('next')])
  editor.setTextCursorPosition('target', 'end')
  assert.equal(press('Tab'), true)
  assert.deepEqual(ids(editor.document), ['parent', 'next'])
  assert.deepEqual(ids(editor.getBlock('parent').children), ['first', 'target'])
  editor.insertBlocks([block('later')], 'target', 'after')
  assert.equal(press('Tab', { shiftKey: true }), true)
  assert.deepEqual(ids(editor.document), ['parent', 'target', 'next'])
  assert.deepEqual(ids(editor.getBlock('parent').children), ['first', 'later'])
  assert.deepEqual(ids(editor.getBlock('target').children), ['inner'])
  assert.equal(editor.getTextCursorPosition().block.id, 'target')
  assert.equal(editor.prosemirrorState.selection.$head.parentOffset, 'target'.length)
})

test('Shift+Tab retains a backwards selection across sibling blocks', t => {
  const { editor, press } = setup(t, [
    block('parent', [block('first'), block('target', [block('inner')]), block('sibling'), block('last')]),
  ])
  editor.setTextCursorPosition('sibling', 'start')
  const anchor = editor.prosemirrorState.selection.anchor + 2
  editor.setTextCursorPosition('target', 'start')
  const head = editor.prosemirrorState.selection.head + 1
  editor.transact(tr => { tr.setSelection(TextSelection.create(tr.doc, anchor, head)) })
  const formattingToolbar = editor.getExtension(FormattingToolbarExtension)
  assert.equal(formattingToolbar.store.state, true)
  assert.equal(press('Tab', { shiftKey: true }), false)
  assert.deepEqual(ids(editor.getBlock('parent').children), ['first', 'target', 'sibling', 'last'])
  formattingToolbar.store.setState(false)
  assert.equal(press('Tab', { shiftKey: true }), true)
  assert.deepEqual(ids(editor.document), ['parent', 'target', 'sibling'])
  assert.deepEqual(ids(editor.getBlock('parent').children), ['first', 'last'])
  assert.deepEqual(ids(editor.getBlock('target').children), ['inner'])
  const selection = editor.prosemirrorState.selection
  assert.ok(selection.anchor > selection.head)
  assert.equal(selection.$anchor.parentOffset, 2)
  assert.equal(selection.$head.parentOffset, 1)
})

test('lifting the sole child removes the empty group, keeping the subtree on the moved child', t => {
  const { editor, press } = setup(t, [block('parent', [block('target', [block('inner')])])])
  editor.setTextCursorPosition('target', 'end')
  assert.equal(press('Tab', { shiftKey: true }), true)
  assert.deepEqual(ids(editor.document), ['parent', 'target'])
  assert.deepEqual(editor.getBlock('parent').children, [])
  assert.deepEqual(ids(editor.getBlock('target').children), ['inner'])
  assert.equal(editor.undo(), true)
  assert.deepEqual(ids(editor.document), ['parent'])
  assert.deepEqual(ids(editor.getBlock('parent').children), ['target'])
  assert.equal(editor.redo(), true)
  assert.deepEqual(ids(editor.document), ['parent', 'target'])
})

test('Enter still splits a formatted checklist item without moving its existing child', t => {
  const { editor, press } = setup(t, [block('original', [block('child')], 'checkListItem', [
    { type: 'text', text: 'ABCD', styles: { bold: true } },
  ])])
  editor.setTextCursorPosition('original', 'start')
  editor.transact(tr => { tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 2)) })
  assert.equal(press('Enter'), true)
  const [original, sibling] = editor.document
  assert.equal(text(original), 'AB')
  assert.equal(text(sibling), 'CD')
  assert.equal(sibling.content[0].styles.bold, true)
  assert.deepEqual(ids(original.children), ['child'])
  assert.equal(editor.getTextCursorPosition().block.id, sibling.id)
})

test('code and table keyboard shortcuts match the editor without the new outdent extension', t => {
  const fixtures = [
    block('code', [], 'codeBlock', 'text'),
    { id: 'table', type: 'table', content: { type: 'tableContent', rows: [{ cells: ['A', 'B'] }] } },
  ]
  for (const fixture of fixtures) {
    for (const [key, options] of [['Tab', {}], ['Tab', { shiftKey: true }], ['Enter', {}]]) {
      const results = [[PreserveListChildrenOnEnter()], editorExtensions()].map(extensions => {
        const { editor, press } = setup(t, [block('parent', [block('before'), fixture])], extensions)
        editor.setTextCursorPosition(fixture.id, 'start')
        const prevented = press(key, options)
        return { prevented, fixture: editor.getBlock(fixture.id), position: editor.prosemirrorState.selection.from }
      })
      assert.deepEqual(results[1], results[0])
    }
  }
})

test('Tab is left to the browser while a child control or text composition has focus', t => {
  const { editor, press } = setup(t, [block('first'), block('parent', [block('target'), block('later')])])
  editor.setTextCursorPosition('target')
  const before = editor.document
  for (const name of ['input', 'textarea', 'button', 'select']) {
    const control = document.createElement(name)
    editor.prosemirrorView.dom.append(control)
    assert.equal(press('Tab', {}, control), false)
    assert.equal(press('Tab', { shiftKey: true }, control), false)
    control.remove()
  }
  press('Tab', { shiftKey: true, isComposing: true, keyCode: 229 })
  assert.deepEqual(editor.document, before)
})
