import test from 'node:test'
import assert from 'node:assert/strict'
import { registerFlush, flushDoc, flushAllDocs } from '../src/components/page/util.ts'

test('old editor cleanup cannot unregister a newly opened editor for the same page', async () => {
  let saved = ''
  const oldCleanup = registerFlush('same-page', async () => { saved = 'old' })
  const newCleanup = registerFlush('same-page', async () => { saved = 'latest' })
  oldCleanup()
  await flushDoc('same-page')
  assert.equal(saved, 'latest')
  newCleanup()
})

test('failed flush remains retryable before close or backup', async () => {
  let attempts = 0
  const cleanup = registerFlush('retry-page', async () => { if (++attempts === 1) throw new Error('disk unavailable') })
  await assert.rejects(flushAllDocs(), /disk unavailable/)
  await flushAllDocs()
  assert.equal(attempts, 2)
  cleanup()
})
