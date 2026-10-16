import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstLinkingBlock } from '../src/components/page/backlinkAnchor.ts'

const target = '11111111-1111-4111-8111-111111111111'

test('backlink opens the nested block containing a page link', () => {
  const blocks = [
    { id: 'unrelated', type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
    { id: 'parent', type: 'paragraph', children: [{ id: 'mention', type: 'paragraph', content: [{ type: 'link', href: `workspace://page/${target}`, content: [{ type: 'text', text: 'Target' }] }] }] },
  ]
  assert.equal(firstLinkingBlock(blocks, target), 'mention')
  assert.equal(firstLinkingBlock(blocks, '22222222-2222-4222-8222-222222222222'), undefined)
})

test('backlink also resolves embedded subpage blocks', () => {
  assert.equal(firstLinkingBlock([{ id: 'pageblock', type: 'page', props: { pageId: target } }], target), 'pageblock')
})
