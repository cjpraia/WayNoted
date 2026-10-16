import test from 'node:test'
import assert from 'node:assert/strict'
import { markdownToBlocks, parseInline, blocksPlainText } from '../src/quick/markdown.ts'
import { acceleratorLabel, eventToAccelerator } from '../src/quick/accelerator.ts'
import { countWords } from '../src/focus/focusMode.ts'

test('light Markdown becomes BlockNote blocks with ids', () => {
  const blocks = markdownToBlocks('# Título\nTexto **forte** e *leve*\n- item\n  - filho\n- [x] feito\n1. um\n> citação\n---\n```js\nconst a = 1\n```')
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'paragraph', 'bulletListItem', 'checkListItem', 'numberedListItem', 'quote', 'divider', 'codeBlock'])
  assert.equal(blocks[0].props.level, 1)
  assert.equal(blocks[2].children[0].type, 'bulletListItem')
  assert.equal(blocks[3].props.checked, true)
  assert.equal(blocks[7].props.language, 'js')
  assert.equal(JSON.stringify(blocks[7].content), JSON.stringify([{ type: 'text', text: 'const a = 1', styles: {} }]))
  assert.ok(blocks.every(block => /^[0-9a-f-]{36}$/.test(block.id)))
  assert.equal(blocksPlainText(blocks).split('\n')[0], 'Título')
})

test('inline styles, safe links and bare URLs', () => {
  const inline = parseInline('a **b** _c_ `d` ~~e~~ [site](https://x.dev) https://y.dev/p. [mal](javascript:alert(1))')
  assert.equal(JSON.stringify(inline.filter(part => part.type === 'text' && Object.keys(part.styles).length).map(part => part.type === 'text' ? [part.text, Object.keys(part.styles)[0]] : null)), JSON.stringify([['b', 'bold'], ['c', 'italic'], ['d', 'code'], ['e', 'strike']]))
  const links = inline.filter(part => part.type === 'link').map(part => part.type === 'link' ? part.href : '')
  assert.deepEqual(links, ['https://x.dev', 'https://y.dev/p'])
  assert.ok(inline.some(part => part.type === 'text' && part.text.includes('[mal](javascript:alert(1))')))
})

test('accelerator labels and recording', () => {
  assert.equal(acceleratorLabel('Alt+Command+N'), '⌥⌘N')
  assert.equal(acceleratorLabel('Command+Shift+Alt+Control+K'), '⌃⌥⇧⌘K')
  assert.equal(eventToAccelerator({ key: 'n', code: 'KeyN', metaKey: true, altKey: true, ctrlKey: false, shiftKey: false }), 'Alt+Command+N')
  assert.equal(eventToAccelerator({ key: 'Meta', code: 'MetaLeft', metaKey: true, altKey: false, ctrlKey: false, shiftKey: false }), null)
  assert.equal(eventToAccelerator({ key: 'N', code: 'KeyN', metaKey: false, altKey: false, ctrlKey: false, shiftKey: true }), null)
})

test('focus mode word count ignores punctuation', () => {
  assert.equal(countWords('Olá, mundo — é 2026! d’água'), 5)
  assert.equal(countWords('  '), 0)
})


test('Windows shortcut labels use Ctrl/Alt and distinguish the Windows key', () => {
  assert.equal(acceleratorLabel('Alt+Control+N', 'Space', 'win32'), 'Ctrl+Alt+N')
  assert.equal(acceleratorLabel('Shift+CmdOrCtrl+Return', 'Space', 'win32'), 'Ctrl+Shift+Enter')
  assert.equal(acceleratorLabel('Super+Space', 'Space', 'win32'), 'Win+Space')
})
