import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { transformWithOxc } from 'vite'
import { foldSearch } from '../src/workspace.ts'
import { useModalFocus } from '../src/a11y/useModalFocus.ts'
import { protectedTitle } from '../src/security/pageLock.ts'
import { shimUi } from './fixtures/ui-shim.mjs'

const dom = new JSDOM('<main id="app"></main>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')

const page = { id: 'note', title: 'Relatório', trashed: true }
const protectedParent = { id: 'private', title: 'Private parent title', passwordLock: { hideTitle: true } }
const protectedChild = { id: 'child', title: 'Private child title', trashed: true, parentId: protectedParent.id }
const state = { pages: Object.fromEntries([page, protectedParent, protectedChild].map(item => [item.id, item])) }
const events = []
const t = (_pt, en, vars) => en.replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ''))
const mocks = {
  t, foldSearch, protectedTitle, useModalFocus,
  useI18n: () => ({ t, locale: 'en-US' }),
  useStore: () => state,
  getState: () => state,
  actions: {
    restorePage: id => { events.push(['restore', id]); state.pages = { ...state.pages, [id]: { ...state.pages[id], trashed: false } } },
    deletePageForever: async id => { events.push(['delete', id]); state.pages = Object.fromEntries(Object.entries(state.pages).filter(([key]) => key !== id)) },
    reportSaveError: error => { throw error },
  },
  selectors: { trash: () => Object.values(state.pages).filter(item => item.trashed), ancestors: id => id === 'child' ? [protectedParent] : [] },
  PageIcon: () => null,
  TrashPreview: ({ page, onRestore, onDelete }) => React.createElement('div', { 'data-preview-id': page.id },
    React.createElement('button', { onClick: onRestore }, 'Restore'), React.createElement('button', { onClick: onDelete }, 'Delete')),
}
globalThis.__trashViewTest = mocks

async function componentUrl(name, imports, dependencies = {}) {
  let source = await readFile(new URL(`../src/components/trash/${name}`, import.meta.url), 'utf8')
  for (const names of imports) source = source.replace(`import { ${names} }`, `// import { ${names} }`) + `\nconst { ${names} } = globalThis.__trashViewTest\n`
  source = shimUi(source).replace(/^import '\.\/trash\.css'$/m, '')
  for (const [local, url] of Object.entries(dependencies)) source = source.replace(`from '${local}'`, `from ${JSON.stringify(url)}`)
  const output = await transformWithOxc(source, name, { jsx: { runtime: 'automatic' } })
  const code = output.code.replace(/from ["'](react(?:\/jsx-runtime|-dom)?|lucide-react)["']/g, (_match, dependency) => `from ${JSON.stringify(import.meta.resolve(dependency))}`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const labelsUrl = await componentUrl('trashLabels.ts', ['t', 'protectedTitle'])
const { TrashView } = await import(await componentUrl('TrashView.tsx', [
  'useI18n', 'foldSearch', 'useModalFocus', 'actions, getState, selectors, useStore', 'PageIcon', 'TrashPreview',
], { './trashLabels': labelsUrl }))

function button(label) { return [...document.querySelectorAll('button')].find(item => item.textContent === label) }
async function click(element) { assert.ok(element); await act(async () => element.click()) }
async function search(value) {
  const input = document.querySelector('input[type="search"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('Trash filters visible labels, clears the preview, restores an item and confirms permanent deletion', async () => {
  const root = createRoot(document.getElementById('app'))
  await act(async () => root.render(React.createElement(TrashView)))
  try {
    await click(button('Relatório'))
    assert.equal(document.querySelector('[data-preview-id]')?.dataset.previewId, 'note')
    await search('secret query')
    assert.equal(document.querySelectorAll('[data-preview-id]').length, 0)
    assert.match(document.body.textContent, /No results/)
    await search('Private')
    assert.match(document.body.textContent, /No results/)
    await search('relatorio')
    await click(button('Relatório'))
    await click(button('Restore'))
    assert.deepEqual(events, [['restore', 'note']])
    await search('')
    assert.ok(button('Protected pageProtected page'))
    assert.doesNotMatch(document.body.innerHTML, /Private (?:child|parent) title/)
    await click(button('Protected pageProtected page'))
    await click(button('Delete'))
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /Permanently delete “Protected page”/)
    await click(button('Cancelar'))
    assert.deepEqual(events, [['restore', 'note']])
    await click(button('Delete'))
    await click(button('Delete permanently'))
    assert.deepEqual(events, [['restore', 'note'], ['delete', 'child']])
    assert.match(document.body.textContent, /Trash is empty/)
  } finally { await act(async () => root.unmount()) }
})
