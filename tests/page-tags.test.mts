import test from 'node:test'
import assert from 'node:assert/strict'
import type { Page } from '../src/types.ts'
import { linkedTagPages, pagesTaggedWith } from '../src/objecttypes/pageTags.ts'
import { remapReferences, validateMeta } from '../src/workspace.ts'

test('a tag links pages across types without exposing protected pages', () => {
  const [design, youtube, video, book, locked, child] = Array.from({ length: 6 }, () => crypto.randomUUID())
  const page = (id: string, extra: Partial<Page> = {}) => ({ id, title: id, parentId: null, ...extra })
  const { pages } = validateMeta({ settings: {}, pages: {
    [design]: page(design),
    [youtube]: page(youtube),
    [video]: page(video, { types: ['resource'], tagPageIds: [design, youtube, design, video, 'invalid'], updatedAt: 2 }),
    [book]: page(book, { types: ['book'], tagPageIds: [design], updatedAt: 1 }),
    [locked]: page(locked, { passwordLock: { rootId: locked, hideTitle: true } }),
    [child]: page(child, { parentId: locked, tagPageIds: [design] }),
  } })
  assert.deepEqual(linkedTagPages(pages[video], pages).map(page => page.id), [design, youtube])
  assert.deepEqual(pagesTaggedWith(design, pages).map(page => page.id), [video, book])
  assert.deepEqual(pagesTaggedWith(youtube, pages).map(page => page.id), [video])
  const imported = remapReferences(pages[video], { [design]: 'new-tag-id' })
  assert.deepEqual(imported.tagPageIds, ['new-tag-id', youtube])
})
