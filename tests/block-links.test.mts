import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { copyText } from '../src/clipboard.ts'
import { revealLinkedBlock } from '../src/components/page/blockLinks.ts'
import { localPageLink } from '../src/components/page/links.ts'

test('desktop link copying uses native clipboard even if browser permission is denied', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const copied: string[] = []
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { api: { copyText: async (text: string) => { copied.push(text) } } } })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('Permission denied') } } } })
    const link = 'workspace://page/01234567-1234-1234-1234-0123456789ab#block=db'
    await copyText(link)
    assert.deepEqual(copied, [link])
    assert.equal(localPageLink.exec(link)?.[2], 'db')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    await assert.rejects(copyText(link), /Permission denied/)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as any).window
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete (globalThis as any).navigator
  }
})

test('database block links open enclosing toggles and scroll without an inline cursor', () => {
  const dom = new JSDOM('<div id="root"><div class="bn-block" data-id="outer"><div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button"></button></div><div class="bn-block" data-id="inner"><div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button"></button></div><div class="bn-block" data-id="db"></div></div><div class="bn-block" data-id="other"><div class="bn-toggle-wrapper" data-show-children="false"><button class="bn-toggle-button"></button></div></div></div></div>')
  const root = dom.window.document.getElementById('root')!
  const opened: string[] = []
  root.querySelectorAll<HTMLElement>('.bn-toggle-wrapper').forEach(toggle => {
    toggle.querySelector('button')!.addEventListener('click', () => { toggle.dataset.showChildren = 'true'; opened.push(toggle.parentElement!.dataset.id!) })
  })
  const target = root.querySelector<HTMLElement>('[data-id="db"]')!
  let scrolled = false
  target.scrollIntoView = () => { scrolled = true }
  assert.equal(revealLinkedBlock(root, 'db'), target)
  assert.deepEqual(opened, ['outer', 'inner'])
  assert.equal(scrolled, true)
  assert.equal(root.querySelector<HTMLElement>('[data-id="other"] .bn-toggle-wrapper')!.dataset.showChildren, 'false')
  assert.equal(revealLinkedBlock(root, 'deleted'), undefined)
  dom.window.close()
})
