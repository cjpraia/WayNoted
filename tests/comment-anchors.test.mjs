import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { captureTextAnchor, resolveTextAnchor } from '../src/components/page/commentAnchors.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
const { BlockNoteEditor } = await import('@blocknote/core')
function textPosition(doc, needle) { let found; doc.descendants((node, position) => { if (found === undefined && node.isText && node.text.includes(needle)) found = position + node.text.indexOf(needle) }); assert.ok(found !== undefined); return found }

test('comment ranges retain an exact styled selection and relocate after preceding edits', () => {
  const editor = BlockNoteEditor.create({ initialContent: [{ id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'Hello ', styles: {} }, { type: 'text', text: 'world', styles: { bold: true } }, { type: 'text', text: ', goodbye', styles: {} }] }] })
  const doc = editor.prosemirrorState.doc, from = textPosition(doc, 'world')
  const anchor = captureTextAnchor(doc, from, from + 5)
  assert.deepEqual(anchor.segments.map(segment => segment.quote), ['world'])
  assert.equal(anchor.segments[0].blockId, 'a')
  assert.deepEqual(resolveTextAnchor(doc, anchor), { from, to: from + 5 })
  editor.updateBlock('a', { content: 'New beginning. Hello world, goodbye' })
  const moved = resolveTextAnchor(editor.prosemirrorState.doc, anchor)
  assert.equal(editor.prosemirrorState.doc.textBetween(moved.from, moved.to), 'world')
  assert.ok(moved.from > from)
  editor.updateBlock('a', { content: 'The passage was removed.' })
  assert.equal(resolveTextAnchor(editor.prosemirrorState.doc, anchor), null)
})

test('selection anchors cover multiple blocks, nested text and reject ambiguous missing context', () => {
  const editor = BlockNoteEditor.create({ initialContent: [{ id: 'a', type: 'paragraph', content: 'Start here' }, { id: 'b', type: 'bulletListItem', content: 'Finish there' }] })
  const doc = editor.prosemirrorState.doc
  const from = textPosition(doc, 'here'), to = textPosition(doc, 'there') + 5
  const anchor = captureTextAnchor(doc, from, to)
  assert.deepEqual(anchor.segments.map(segment => segment.quote), ['here', 'Finish there'])
  assert.deepEqual(resolveTextAnchor(doc, anchor), { from, to })
  editor.removeBlocks(['b'])
  assert.equal(resolveTextAnchor(editor.prosemirrorState.doc, anchor), null)
  const duplicate = BlockNoteEditor.create({ initialContent: [{ id: 'a', type: 'paragraph', content: 'same same' }] })
  assert.equal(resolveTextAnchor(duplicate.prosemirrorState.doc, { segments: [{ blockId: 'a', from: 2, to: 6, quote: 'same', prefix: 'missing', suffix: '' }] }), null)
})
