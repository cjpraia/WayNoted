import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { transformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'

test('restart saves the latest quick note while the autosave timer is still pending', async () => {
  const dom = new JSDOM('<main id="app"></main>', { pretendToBeVisual: true, url: 'http://localhost' })
  for (const key of ['window', 'document', 'navigator']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  let beforeClose
  const writes = []
  let timer
  globalThis.quickUpdateTestTimer = fn => { timer = fn; return 0 }
  window.quickApi = {
    platform: 'darwin',
    init: async () => ({ locale: 'en-US', theme: 'light', draft: {}, prefill: null, workspaceId: 'default', types: [] }),
    onShow: () => () => {},
    onBeforeClose: fn => { beforeClose = fn; return () => { beforeClose = undefined } },
    saveDraft: async draft => { writes.push(draft); return { locked: false } },
  }

  async function moduleUrl(file, source, overrides) {
    const { code } = await transformWithOxc(source, file.pathname, { jsx: { runtime: 'automatic' } })
    const resolved = code.replace(/from ["']([^"']+)["']/g, (_match, specifier) => {
      const url = overrides[specifier] ?? (specifier.startsWith('.') ? new URL(specifier + '.ts', file).href : import.meta.resolve(specifier))
      return 'from ' + JSON.stringify(url)
    })
    return 'data:text/javascript;base64,' + Buffer.from(resolved).toString('base64')
  }

  const select = new URL('../src/components/ui/Select.tsx', import.meta.url)
  const selectUrl = await moduleUrl(select, await readFile(select, 'utf8'), {
    './icons/Icon': 'data:text/javascript,export const Icon=()=>null',
  })
  const file = new URL('../src/quick/QuickNote.tsx', import.meta.url)
  const source = inlineProductSource(await readFile(file, 'utf8'))
    .replace('const quick =', 'const setTimeout = globalThis.quickUpdateTestTimer\nconst quick =')
  const { QuickNote } = await import(await moduleUrl(file, source, { '../components/ui/Select': selectUrl }))
  const root = createRoot(document.querySelector('#app'))
  try {
    await act(async () => root.render(React.createElement(QuickNote)))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const input = document.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Rascunho ainda não gravado')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(typeof timer, 'function', 'debounced save scheduled')
    assert.deepEqual(writes, [], 'debounced save did not run')
    await beforeClose()
    assert.equal(writes.length, 1)
    assert.equal(writes[0].body, 'Rascunho ainda não gravado')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
