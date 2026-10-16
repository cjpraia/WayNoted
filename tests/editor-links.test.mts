import test from 'node:test'
import assert from 'node:assert/strict'
import { isEditorLink, localPageLink } from '../src/components/page/links.ts'

test('local page links and standard links survive editor conversion validation', () => {
  const link = 'workspace://page/01234567-1234-1234-1234-0123456789ab'
  assert.equal(isEditorLink(link), true)
  assert.equal(localPageLink.exec(link)?.[1], '01234567-1234-1234-1234-0123456789ab')
  assert.equal(localPageLink.exec(`${link}#block=12345678-1234-1234-1234-123456789abc`)?.[2], '12345678-1234-1234-1234-123456789abc')
  for (const href of ['https://example.com/path', 'http://example.com', 'mailto:me@example.com', 'tel:+5511', '#heading']) assert.equal(isEditorLink(href), true)
})
test('unsafe schemes and malformed local page links are rejected', () => {
  for (const href of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'workspace://page/not-an-id', 'workspace://settings']) assert.equal(isEditorLink(href), false, href)
})
