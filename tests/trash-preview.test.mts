import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { canReadTrashPreview, readTrashPreview, trashPreviewHtml } from '../src/components/trash/trashPreviewModel.ts'
import type { Page } from '../src/types.ts'

function page(id: string, patch: Partial<Page> = {}): Page {
  return {
    id, title: id, parentId: null, icon: null, cover: null, coverPosition: 0, favorite: false, trashed: true, trashedAt: 1,
    createdAt: 0, updatedAt: 0, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...patch,
  }
}

function render(blocks: unknown[], pages: Record<string, Page> = { trash: page('trash') }, synced: Parameters<typeof trashPreviewHtml>[4] = {}) {
  const dom = new JSDOM()
  const { document } = dom.window
  document.body.innerHTML = trashPreviewHtml(document, 'trash', blocks, pages, synced, 'en-US')
  return document.body
}

test('trash preview rechecks access after an asynchronous read and skips unavailable pages', async () => {
  const trash = page('trash', { parentId: 'parent' })
  const parent = page('parent', { trashed: false })
  const lock = { rootId: parent.id, hideTitle: true }
  let pages = { trash, parent: { ...parent, passwordLock: lock } }
  let reads = 0
  const read = async () => { reads++; return ['private text'] }
  assert.equal(await readTrashPreview(trash.id, () => pages, read), undefined)
  assert.equal(reads, 0)

  pages = { trash, parent: { ...parent, passwordLock: { ...lock, unlocked: true } } }
  const pending = readTrashPreview(trash.id, () => pages, async () => {
    pages = { trash, parent: { ...parent, passwordLock: lock } }
    return ['private text']
  })
  assert.equal(await pending, undefined)
  assert.equal(canReadTrashPreview(pages, trash.id), false)
  assert.equal(canReadTrashPreview({ trash: { ...trash, trashed: false } }, trash.id), false)
  assert.equal(canReadTrashPreview({}, trash.id), false)
})

test('trash preview renders static document markup, suppresses remote media and disables links', () => {
  const raster = 'data:image/png;base64,AAAA'
  const body = render([
    { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Readable', styles: { bold: true } }] },
    { type: 'bookmark', props: { title: 'Reference', url: 'https://example.test' } },
    { type: 'onlineVideo', props: { title: 'Recording', url: 'https://www.youtube.com/watch?v=abcdefghijk' } },
    { type: 'image', props: { url: 'https://example.test/remote.png', name: 'Remote image' } },
    { type: 'image', props: { url: 'data:image/svg+xml;base64,AAAA', name: 'SVG image' } },
    { type: 'image', props: { url: raster } },
    { type: 'pdfPreview', props: { url: 'data:application/pdf;base64,AAAA', name: 'Attached report.pdf' } },
    { type: 'htmlSandbox', props: { html: '<script>throw new Error("preview")</script>' } },
    { type: 'canvas', props: { objects: [
      { id: 'label', type: 'text', text: 'Canvas label', x: 0, y: 0, w: 200, h: 100 },
      { id: 'drawing-image', type: 'image', src: '//example.test/drawing.png', name: 'Remote canvas image', x: 0, y: 120, w: 200, h: 200 },
      { id: 'hidden', type: 'shape', hidden: true, text: 'Hidden layer' },
    ] } },
    { type: 'toggleListItem', content: 'Open details', children: [{ type: 'paragraph', content: 'Nested content' }] },
  ])
  assert.equal(body.querySelector('h2 strong')?.textContent, 'Readable')
  assert.equal(body.querySelectorAll('a[href], audio, video, iframe, script, svg image[href]').length, 0)
  assert.deepEqual([...body.querySelectorAll('img[src]')].map(img => img.getAttribute('src')), [raster])
  assert.match(body.textContent!, /Remote image.*SVG image.*Attached report\.pdf/s)
  assert.match(body.querySelector('pre')?.textContent ?? '', /<script>/)
  assert.match(body.querySelector('svg')?.textContent ?? '', /Canvas label/)
  assert.doesNotMatch(body.textContent!, /Hidden layer/)
  assert.ok(body.querySelector('details[open]'))
})

test('trash preview hides protected metadata, references and synced content', () => {
  const trash = page('trash', { database: { properties: [{ id: 'title', name: 'Title', type: 'title' }, { id: 'label', name: 'Label', type: 'text' }], views: [] } })
  const visible = page('visible', { parentId: trash.id, trashed: false, props: { label: 'visible value' } })
  const hidden = page('hidden', { parentId: trash.id, trashed: false, passwordLock: { rootId: 'hidden', hideTitle: true }, props: { label: 'hidden value' } })
  const trashed = page('trashed', { parentId: trash.id, props: { label: 'separately deleted value' } })
  const body = render([
    { type: 'page', props: { pageId: hidden.id } },
    { type: 'syncedBlock', props: { syncedId: 'synced' } },
  ], { trash, visible, hidden, trashed }, { synced: { id: 'synced', sourcePageId: hidden.id, updatedAt: 0, blocks: [{ type: 'paragraph', content: 'protected synced content' }] } })
  assert.equal(body.querySelectorAll('tbody tr').length, 1)
  assert.match(body.querySelector('tbody')?.textContent ?? '', /visible value/)
  assert.doesNotMatch(body.textContent!, /hidden|separately deleted value|protected synced content/)
  assert.match(body.textContent!, /Unavailable page/)
  assert.equal(render([{ type: 'paragraph', content: 'secret' }], { trash: { ...trash, passwordLock: { rootId: trash.id, hideTitle: true } } }).textContent, '')
})
