import test from 'node:test'
import assert from 'node:assert/strict'
import { findInBlocks, replaceBlockText } from '../src/components/page/findReplace.ts'

test('find and replace keeps styled text nodes and nested blocks', () => {
  const blocks = [
    { id: 'one', content: [{ type: 'text', text: 'Plano plano', styles: { bold: true } }], children: [
      { id: 'two', content: [{ type: 'text', text: 'PLANO', styles: {} }], children: [] },
    ] },
  ]
  assert.deepEqual(findInBlocks(blocks, 'plano'), [{ blockId: 'one', count: 2 }, { blockId: 'two', count: 1 }])
  const next = replaceBlockText(blocks[0].content, 'plano', '$1') as typeof blocks[0]['content']
  assert.deepEqual(next, [{ type: 'text', text: '$1 $1', styles: { bold: true } }])
  assert.equal(blocks[0].content[0].text, 'Plano plano')
  assert.deepEqual(findInBlocks(blocks, ''), [])
})
