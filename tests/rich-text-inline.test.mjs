import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'DOMParser', 'Element', 'Node']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: (el) => dom.window.getComputedStyle(el) })
Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => setTimeout(fn, 0) })
Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id) => clearTimeout(id) })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const R = await import('../src/components/database/richText.ts')

const html = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d }
const runsOf = (s, o) => R.domToRuns(html(s), o)

test('domToRuns: aninhamento, links, quebras e caracteres especiais', () => {
  assert.deepEqual(runsOf('a<b>b<i>c</i></b>d'), [{ text: 'a' }, { text: 'b', bold: true }, { text: 'c', bold: true, italic: true }, { text: 'd' }])
  assert.deepEqual(runsOf('<a href="https://x.com/a?b=1&amp;c=2">link</a>'), [{ text: 'link', href: 'https://x.com/a?b=1&c=2' }])
  assert.deepEqual(runsOf('<a href="javascript:alert(1)">x</a>'), [{ text: 'x' }])
  assert.equal(R.richTextPlain({ type: 'richText', runs: runsOf('a<br>b') }), 'a\nb')
  assert.equal(R.richTextPlain({ type: 'richText', runs: runsOf('a<br><br>') }), 'a\n')
  assert.equal(R.richTextPlain({ type: 'richText', runs: runsOf('<div>a</div><div><br></div><div>b</div>') }), 'a\n\nb')
  assert.equal(R.richTextPlain({ type: 'richText', runs: runsOf('x &lt;b&gt; &amp; &quot;q&quot; &nbsp;y') }), 'x <b> & "q"  y')
  assert.deepEqual(runsOf('<span style="font-weight: 700; text-decoration: underline line-through">z</span>'), [{ text: 'z', bold: true, underline: true, strike: true }])
  assert.deepEqual(runsOf('<script>alert(1)</script>ok'), [{ text: 'ok' }])
})

test('runs ↔ html: round-trip preserva texto e formatação', () => {
  const runs = [
    { text: 'oi ' }, { text: 'negrito', bold: true }, { text: '\n' }, { text: '<tag> & "aspas"', italic: true, underline: true },
    { text: ' ' }, { text: 'cod', code: true, strike: true }, { text: 'site', href: 'https://exemplo.com/?a=1&b=2', bold: true },
    { text: 'cor', color: 'red', background: 'yellow' },
  ]
  assert.deepEqual(R.domToRuns(html(R.runsToHtml(runs)), { trimTrailing: false }), R.normalizeRuns(runs))
  assert.equal(R.runsToHtml([{ text: 'a\nb' }]), 'a<br>b')
  assert.equal(R.runsToHtml([{ text: '<img src=x onerror=1>' }]).includes('<img'), false)
})

test('runsToStored: caminho rápido, vazio e valores antigos', () => {
  assert.equal(R.runsToStored([{ text: 'simples' }]), 'simples')
  assert.equal(R.runsToStored([{ text: 'a', bold: false }, { text: 'b' }]), 'ab')
  assert.equal(R.runsToStored([{ text: '  \n ' }]), null)
  assert.equal(R.runsToStored([]), null)
  assert.deepEqual(R.runsToStored([{ text: 'a', bold: true }]), { type: 'richText', runs: [{ text: 'a', bold: true }] })
  const old = { type: 'richText', runs: [{ text: 'Olá ' }, { text: 'mundo', bold: true, href: 'https://a.b/' }] }
  assert.deepEqual(R.runsToStored(R.valueToRuns(old)), old)
  assert.ok(R.sameStored(R.runsToStored(R.valueToRuns({ type: 'richText', runs: [{ text: 'x' }] })), 'x'))
  assert.deepEqual(R.valueToRuns(42), [{ text: '42' }])
  assert.deepEqual(R.valueToRuns(null), [])
})

test('formatação por trecho: alternar, link, limpar', () => {
  let runs = [{ text: 'abcdef' }]
  runs = R.toggleMarkInRange(runs, 1, 4, 'bold')
  assert.deepEqual(runs, [{ text: 'a' }, { text: 'bcd', bold: true }, { text: 'ef' }])
  assert.ok(R.marksInRange(runs, 1, 4).has('bold'))
  assert.ok(!R.marksInRange(runs, 0, 4).has('bold'))
  assert.deepEqual(R.toggleMarkInRange(runs, 0, 6, 'bold'), [{ text: 'abcdef', bold: true }])
  assert.deepEqual(R.toggleMarkInRange(runs, 1, 4, 'bold'), [{ text: 'abcdef' }])
  const linked = R.setLinkInRange(runs, 2, 5, 'https://x.io/')
  assert.equal(R.hrefInRange(linked, 2, 5), 'https://x.io/')
  assert.deepEqual(R.linkRangeAt(linked, 3), { start: 2, end: 5, href: 'https://x.io/' })
  assert.ok(R.linkRangeAt(linked, 0) === undefined)
  assert.deepEqual(R.clearFormatInRange(linked, 0, 6), [{ text: 'abcdef' }])
  assert.equal(R.normalizeLinkInput('exemplo.com'), 'https://exemplo.com/')
  assert.equal(R.normalizeLinkInput('a@b.co'), 'mailto:a@b.co')
  assert.ok(R.normalizeLinkInput('javascript:alert(1)') === undefined)
  assert.ok(R.normalizeLinkInput('') === undefined)
})

test('colagem: html vira runs suportados e markdown em linha é reconhecido', () => {
  const runs = R.htmlToRuns('<meta charset="utf-8"><h1 style="color:red">Título</h1><p>um <strong>forte</strong> e <em>enfático</em> <a href="https://a.b/">l</a><img src="x"></p><script>1</script>')
  assert.equal(R.richTextPlain({ type: 'richText', runs }), 'Título\num forte e enfático l')
  assert.ok(runs.some((r) => r.text === 'forte' && r.bold) && runs.some((r) => r.text === 'enfático' && r.italic) && runs.some((r) => r.href === 'https://a.b/'))
  assert.equal(R.hasInlineMarkdown('2 * 3 * 4'), false)
  assert.equal(R.hasInlineMarkdown('texto simples'), false)
  assert.deepEqual(R.markdownToRuns('a **b** `c` [d](https://e.f/) ~~g~~ *h*'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', code: true }, { text: ' ' }, { text: 'd', href: 'https://e.f/' }, { text: ' ' }, { text: 'g', strike: true }, { text: ' ' }, { text: 'h', italic: true },
  ])
  assert.deepEqual(R.markdownToRuns('[x](javascript:alert(1))'), [{ text: '[x](javascript:alert(1))' }])
})

test('seleção ↔ deslocamentos de texto', () => {
  const el = html('ab<b>cd</b><br>ef')
  document.body.appendChild(el)
  R.setSelectionOffsets(el, 1, 4)
  assert.deepEqual(R.selectionOffsets(el), { start: 1, end: 4 })
  R.setSelectionOffsets(el, 5, 6)
  assert.deepEqual(R.selectionOffsets(el), { start: 5, end: 6 })
  R.setSelectionOffsets(el, 4)
  assert.deepEqual(R.selectionOffsets(el), { start: 4, end: 4 })
  el.remove()
})

// ---- Componente: teclado ----
const mocks = { ...R, t: (_pt, en) => en, DbPopover: ({ children, onClose, onEscape }) => { globalThis.__popover = { onClose, onEscape }; return React.createElement('div', { 'data-pop': '' }, children) }, applyAnchorTypography: () => {} }
globalThis.__inline = mocks
async function load(file) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8')
  source = source.replace(/import\s+(\{[\s\S]*?\})\s+from\s+'([^']+)'/g, (match, bindings, module) => {
    if (module === 'react' || module === 'react-dom' || module === 'lucide-react') return match
    return `const ${bindings.replace(/\btype\s+\w+\s*,?/g, '').replace(/\s+as\s+/g, ': ')}=globalThis.__inline`
  }).replace(/^import type .*$/gm, '').replace(/^import '[^']+\.css'$/gm, '')
  const out = await transformWithOxc(source, file, { jsx: { runtime: 'automatic' } })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { RichTextEditor } = await load('../src/components/database/editors/RichTextEditor.tsx')

async function mount(value) {
  const calls = { changes: [], closes: [] }
  const root = createRoot(document.getElementById('app'))
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  await act(async () => root.render(React.createElement(RichTextEditor, { dbId: 'db', property: { id: 'p', name: 'Notas', type: 'text' }, value, anchor, onChange: (v) => calls.changes.push(v), onClose: (r) => calls.closes.push(r) })))
  const el = document.querySelector('.ed-inline')
  assert.ok(el, 'editor montado')
  const key = async (k, init = {}) => {
    const ev = new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
    await act(async () => { el.dispatchEvent(ev) })
    return ev
  }
  const type = async (text) => { await act(async () => { R.setSelectionOffsets(el, R.richTextPlain({ type: 'richText', runs: R.domToRuns(el, { trimTrailing: false }) }).length); document.execCommand?.('insertText', false, text); R.insertHtmlAtSelection(el, R.runsToHtml([{ text }])); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }) }
  return { calls, el, key, type, unmount: () => act(async () => { root.unmount(); anchor.remove() }) }
}

test('Enter confirma com o texto digitado e não cria quebra', async () => {
  const h = await mount('ola')
  await h.type(' mundo')
  const ev = await h.key('Enter')
  assert.ok(ev.defaultPrevented)
  assert.deepEqual(h.calls.changes, ['ola mundo'])
  assert.deepEqual(h.calls.closes, ['enter'])
  await h.unmount()
})

test('Shift+Enter quebra a linha dentro do texto', async () => {
  const h = await mount('a')
  await h.key('Enter', { shiftKey: true })
  await h.type('b')
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, ['a\nb'])
  assert.deepEqual(h.calls.closes, ['enter'])
  await h.unmount()
})

test('Esc cancela sem gravar e Tab/Shift+Tab confirmam indo à vizinha', async () => {
  let h = await mount('x')
  await h.type('yz')
  await act(async () => globalThis.__popover.onEscape())
  assert.equal(h.calls.changes.length, 0)
  assert.deepEqual(h.calls.closes, ['escape'])
  await h.unmount()
  h = await mount('x')
  await h.type('1')
  await h.key('Tab')
  assert.deepEqual(h.calls.changes, ['x1'])
  assert.deepEqual(h.calls.closes, ['tab'])
  await h.unmount()
  h = await mount(null)
  await h.key('Tab', { shiftKey: true })
  assert.equal(h.calls.changes.length, 0, 'vazio continua vazio')
  assert.deepEqual(h.calls.closes, ['shiftTab'])
  await h.unmount()
})

test('composição IME: Enter durante a composição não confirma', async () => {
  const h = await mount('')
  await act(async () => h.el.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true })))
  await h.key('Enter', { isComposing: true })
  await h.key('Enter', { keyCode: 229 })
  assert.equal(h.calls.closes.length, 0)
  await act(async () => globalThis.__popover.onEscape())
  assert.equal(h.calls.closes.length, 0, 'Esc na composição não fecha o editor')
  await act(async () => h.el.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true })))
  await h.type('日本語')
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, ['日本語'])
  await h.unmount()
})

test('atalhos de formatação gravam runs; valor antigo sem edição não é regravado', async () => {
  const old = { type: 'richText', runs: [{ text: 'Olá ' }, { text: 'mundo', bold: true }] }
  let h = await mount(old)
  await h.key('Enter')
  assert.equal(h.calls.changes.length, 0, 'sem edição, nada é gravado')
  await h.unmount()
  h = await mount('abcdef')
  await act(async () => R.setSelectionOffsets(h.el, 1, 4))
  const ev = await h.key('b', { metaKey: true })
  assert.ok(ev.defaultPrevented)
  await h.key('i', { ctrlKey: true })
  await h.key('e', { metaKey: true })
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, [{ type: 'richText', runs: [{ text: 'a' }, { text: 'bcd', bold: true, italic: true, code: true }, { text: 'ef' }] }])
  await h.unmount()
})

test('colar: texto simples por padrão, html vira runs, ⌘⇧V força texto puro', async () => {
  const paste = async (h, data) => {
    const ev = new dom.window.Event('paste', { bubbles: true, cancelable: true })
    ev.clipboardData = { getData: (type) => data[type] ?? '' }
    await act(async () => { h.el.dispatchEvent(ev) })
    return ev
  }
  let h = await mount('')
  const ev = await paste(h, { 'text/plain': 'linha1\nlinha2' })
  assert.ok(ev.defaultPrevented)
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, ['linha1\nlinha2'])
  await h.unmount()
  h = await mount('')
  await paste(h, { 'text/html': '<p>um <b>forte</b></p>', 'text/plain': 'um forte' })
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, [{ type: 'richText', runs: [{ text: 'um ' }, { text: 'forte', bold: true }] }])
  await h.unmount()
  h = await mount('')
  await h.key('v', { metaKey: true, shiftKey: true })
  await paste(h, { 'text/html': '<b>x</b>', 'text/plain': '**x**' })
  await h.key('Enter')
  assert.deepEqual(h.calls.changes, ['**x**'])
  await h.unmount()
})
