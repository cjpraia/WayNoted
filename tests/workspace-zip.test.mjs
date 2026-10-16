import COMPAT from '../shared/compatibility.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'Text', 'Element', 'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'DOMParser', 'MutationObserver', 'DOMRect', 'Range', 'ShadowRoot', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

import { unzipSync, strFromU8 } from 'fflate'

test('workspace ZIP includes a complete backup and reimports hierarchy, files and action links', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
  try {
    const { actions, api, getState, selectors } = await server.ssrLoadModule('/src/store.ts')
    const { exportWorkspaceAsZip, importPageFile } = await server.ssrLoadModule('/src/components/page/exportMarkdown.ts')
    await actions.init()
    const root = actions.createPage(null, { title: 'ZIP parent' }), child = actions.createPage(root, { title: 'ZIP child' })
    const content = [{ id: 'zip-button', type: 'localButton', props: { label: 'Open child', targetPageId: child, actionsJson: JSON.stringify([{ kind: 'openPage', targetPageId: child }]) } }, { id: 'zip-image', type: 'image', props: { url: 'data:image/png;base64,aGVsbG8=', name: 'local.png' } }]
    await api.saveDoc(root, content); await api.saveDoc(child, [{ type: 'paragraph', content: 'Nested content' }])
    let bytes
    api.exportBinaryFile = async (_name, value) => { bytes = value; return true }
    assert.equal(await exportWorkspaceAsZip(), true)
    const archive = unzipSync(bytes), backup = JSON.parse(strFromU8(archive[COMPAT.record039]))
    assert.deepEqual(backup.documents[root], content)
    assert.equal(backup.meta.pages[child].parentId, root)
    assert.equal(JSON.parse(strFromU8(archive['manifest.json'])).backup, COMPAT.record039)
    const destination = actions.createPage(null, { title: 'Import here' }), before = new Set(Object.keys(getState().pages))
    await importPageFile(new File([bytes], 'workspace.zip'), destination)
    const added = Object.values(getState().pages).filter(page => !before.has(page.id))
    const parentCopy = added.find(page => page.title === 'ZIP parent'), childCopy = added.find(page => page.title === 'ZIP child')
    assert.equal(parentCopy.parentId, destination); assert.equal(childCopy.parentId, parentCopy.id)
    const body = await api.loadDoc(parentCopy.id)
    assert.equal(body[0].props.targetPageId, childCopy.id)
    assert.equal(JSON.parse(body[0].props.actionsJson)[0].targetPageId, childCopy.id)
    assert.equal(body[1].props.url, content[1].props.url)
    assert.ok(selectors.page(root)); assert.equal((await api.loadDoc(root))[0].props.targetPageId, child)
    await actions.flushAll()
  } finally { await server.close() }
})
