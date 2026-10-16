import test from 'node:test'
import assert from 'node:assert/strict'
import { applySuggestionToBlocks } from '../src/components/page/suggestions.ts'

test('applies a suggestion only in its block while keeping styles and source immutable', () => {
  const blocks = [
    { id: 'one', content: [{ type: 'text', text: 'olá mundo', styles: { bold: true } }], children: [] },
    { id: 'two', content: [{ type: 'text', text: 'olá mundo', styles: {} }], children: [] },
  ]
  const next = applySuggestionToBlocks(blocks, 'mundo', 'pessoa', 'one') as typeof blocks
  assert.equal(next[0].content[0].text, 'olá pessoa')
  assert.deepEqual(next[0].content[0].styles, { bold: true })
  assert.equal(next[1].content[0].text, 'olá mundo')
  assert.equal(blocks[0].content[0].text, 'olá mundo')
  assert.throws(() => applySuggestionToBlocks(blocks, 'mundo', 'pessoa'), /várias vezes/)
  assert.throws(() => applySuggestionToBlocks(blocks, 'texto ausente', 'x', 'one'), /não foi encontrado/)
})

test('suggestions span rich runs and hyperlinks while preserving surrounding formatting', () => {
  const blocks = [{ id: 'rich', content: [{ type: 'text', text: 'Before hello ', styles: { bold: true } }, { type: 'link', href: 'https://example.org', content: [{ type: 'text', text: 'world after', styles: { italic: true } }] }] }]
  const next = applySuggestionToBlocks(blocks, 'hello world', 'everyone', 'rich') as typeof blocks
  assert.equal(next[0].content[0].text, 'Before everyone')
  assert.equal(next[0].content[1].content![0].text, ' after')
  assert.equal(next[0].content[1].content![0].styles.italic, true)
  assert.equal(next[0].content[1].href, 'https://example.org')
  const deleted = applySuggestionToBlocks([{ id: 'plain', content: 'Before remove after' }], 'remove ', '', 'plain') as any[]
  assert.equal(deleted[0].content, 'Before after')
})

test('multi-block selected revisions preserve unselected text and reject changed sources', () => {
  const blocks = [{ id: 'a', content: 'Keep first' }, { id: 'b', content: 'second keep' }]
  const anchor = { segments: [{ blockId: 'a', from: 5, to: 10, quote: 'first', prefix: 'Keep ', suffix: '' }, { blockId: 'b', from: 0, to: 6, quote: 'second', prefix: '', suffix: ' keep' }] }
  const next = applySuggestionToBlocks(blocks, 'first\nsecond', 'replacement', 'a', anchor) as typeof blocks
  assert.equal(next[0].content, 'Keep replacement'); assert.equal(next[1].content, ' keep')
  assert.throws(() => applySuggestionToBlocks([{ ...blocks[0], content: 'Changed' }, blocks[1]], 'first\nsecond', 'replacement', 'a', anchor), /mudou/)
})
