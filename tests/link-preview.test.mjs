import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)

const require = createRequire(import.meta.url)
const { destination, pageMetadata, fetchLinkPreview } = require('../electron/link-preview.cjs')
const publicDNS = async () => [{ address: '8.8.8.8', family: 4 }]

test('external preview rejects local targets and redirects before contacting them', async () => {
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://user:pass@example.org/', 'file:///etc/passwd'])
    await assert.rejects(destination(url, publicDNS), /inválido/)
  await assert.rejects(destination('https://example.org/', async () => [{ address: '10.0.0.1', family: 4 }]), /indisponível/)
  let requested = 0
  const requester = (_url, _options, callback) => {
    requested++
    const req = new EventEmitter()
    req.end = () => queueMicrotask(() => {
      const response = new EventEmitter()
      response.statusCode = 302; response.headers = { location: 'http://127.0.0.1/admin' }
      response.resume = () => {}
      callback(response)
    })
    return req
  }
  await assert.rejects(fetchLinkPreview('https://example.org/', { resolver: publicDNS, requester }), /inválido/)
  assert.equal(requested, 1)
})

test('metadata extraction handles attribute order and resolves image URLs', () => {
  const html = `<html><head><meta content="Hermelo | Saiba hoje quanto seu salão fatura amanhã" property="og:title">
    <meta name="description" content="Cada cliente sai da cadeira com o próximo horário combinado.">
    <meta property="og:image" content="/hero.webp"><link href="/icon.png" rel="icon"></head><body>Ignore</body></html>`
  assert.deepEqual(pageMetadata(html, 'https://www.hermelo.com.br/'), {
    title: 'Hermelo | Saiba hoje quanto seu salão fatura amanhã',
    description: 'Cada cliente sai da cadeira com o próximo horário combinado.',
    imageURL: 'https://www.hermelo.com.br/hero.webp', iconURL: 'https://www.hermelo.com.br/icon.png',
  })
})

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const icon = () => React.createElement('span')
const preview = { url: 'https://www.hermelo.com.br/', title: 'Hermelo | Saiba hoje quanto seu salão fatura amanhã', description: 'Cada cliente sai da cadeira com o próximo horário combinado.', image: 'data:image/webp;base64,aGVsbG8=', icon: 'data:image/png;base64,aWNvbg==' }
let reads = 0, opened = []
const api = { fetchLinkPreview: async url => { reads++; assert.equal(url, preview.url); return preview }, openExternalPage: async url => { opened.push(url) } }
globalThis.__externalCard = { useI18n: () => ({ t: (_pt, en) => en }), api, ArrowUpRight: icon, Pencil: icon, RotateCw: icon, createReactBlockSpec: () => () => ({}) }
const source = await readFile(new URL('../src/components/page/ExternalReferenceBlock.tsx', import.meta.url), 'utf8')
const patched = source.replace(/import .* from '[^']+'\s*/g, '')
const transformed = await transformWithOxc(`import { useEffect, useState } from 'react'; const { useI18n, api, ArrowUpRight, Pencil, RotateCw, createReactBlockSpec } = globalThis.__externalCard;\n${patched}`, 'ExternalReferenceBlock.tsx', { jsx: { runtime: 'automatic' } })
const code = transformed.code.replace(/from ["'](react(?:\/jsx-runtime)?)["']/g, (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
const { ExternalReferenceCard } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('embed renders a rich card, persists preview, opens the full site and keeps editing behind a control', async () => {
  reads = 0; opened = []
  const root = createRoot(document.getElementById('app'))
  function Harness() {
    const [value, setValue] = React.useState({ provider: 'Embed', url: preview.url, title: '', description: '', image: '', icon: '' })
    return React.createElement(ExternalReferenceCard, { value, editable: true, update: patch => setValue(current => ({ ...current, ...patch })) })
  }
  try {
    await act(async () => root.render(React.createElement(Harness)))
    assert.equal(reads, 1)
    assert.match(document.querySelector('.pg-external-card-title').textContent, /Hermelo/)
    assert.match(document.querySelector('.pg-external-card-description').textContent, /próximo horário/)
    assert.match(document.querySelector('.pg-external-card-image').getAttribute('src'), /^data:image\/webp;base64,/)
    assert.equal(document.querySelectorAll('.pg-external-card-edit input').length, 0)
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Open full website').click())
    assert.deepEqual(opened, [preview.url])
    await act(async () => document.querySelector('button[aria-label="Edit embed"]').click())
    assert.equal(document.querySelectorAll('.pg-external-card-edit input').length, 2)
  } finally { await act(async () => root.unmount()) }
})
