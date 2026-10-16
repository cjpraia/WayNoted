// Registro central de ícones (src/components/ui/icons) e PageIcon (emoji, imagem, ícone de linha, padrão).
// Só renderToStaticMarkup — sem DOM; asserts comparam strings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const cache = new Map()
async function load(rel) {
  const url = new URL(rel, import.meta.url)
  if (cache.has(url.href)) return cache.get(url.href)
  let source = await readFile(url, 'utf8')
  const deps = [...source.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1])
  for (const dep of deps) {
    const file = /\.tsx?$/.test(dep) ? dep : (await readFile(new URL(dep + '.tsx', url)).then(() => dep + '.tsx', () => dep + '.ts'))
    const depUrl = await load(new URL(file, url).href)
    source = source.split(`'${dep}'`).join(`'${depUrl}'`)
  }
  const out = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' }, lang: url.pathname.endsWith('x') ? 'tsx' : 'ts' })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom\/server|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, dataUrl)
  return dataUrl
}
const { Icon, ICON_NAMES, hasIcon } = await import(await load('../src/components/ui/icons/Icon.tsx'))
const { PageIcon, iconLabel } = await import(await load('../src/components/page/PageIcon.tsx'))
const html = (type, props) => renderToStaticMarkup(React.createElement(type, props))

test('todo nome semântico do registro desenha um SVG próprio (sem cair no reserva)', () => {
  for (const name of ['home', 'today', 'tasks', 'graph', 'productivity', 'search', 'settings', 'trash', 'inbox', 'page', 'database', 'canvas', 'query', 'types', 'quick-capture']) {
    assert.ok(ICON_NAMES.includes(name), `falta ${name}`)
    const markup = html(Icon, { name })
    assert.match(markup, /^<svg/, name)
    assert.ok(!markup.includes('data-icon-fallback'), `${name} caiu no ícone reserva`)
  }
  assert.ok(hasIcon('book-open'))
  assert.ok(!hasIcon('nao-existe'))
  assert.match(html(Icon, { name: 'nao-existe' }), /data-icon-fallback="true"/)
})

test('Icon: tamanho, traço padrão 1.75, linha (não preenchido), tom por token e acessibilidade', () => {
  const home = html(Icon, { name: 'home', size: 18 })
  assert.match(home, /width="18"/)
  assert.match(home, /stroke-width="1.75"/)
  assert.ok(!/fill="currentColor"/.test(home), 'Início deve ser de linha')
  assert.match(home, /aria-hidden="true"/)
  assert.match(html(Icon, { name: 'graph', tone: 'blue' }), /color:var\(--icon-tint-blue\)/)
  assert.match(html(Icon, { name: 'trash', tone: 'danger' }), /color:var\(--danger\)/)
  const titled = html(Icon, { name: 'search', title: 'Buscar' })
  assert.match(titled, /aria-label="Buscar"/)
  assert.match(titled, /role="img"/)
})

test('PageIcon renderiza emoji, ícone de linha colorido, imagem local e padrão', () => {
  assert.equal(html(PageIcon, { value: '📚' }), '<span>📚</span>')
  const glyph = html(PageIcon, { value: 'lucide:book-open:brown', style: { width: 18, height: 18 } })
  assert.match(glyph, /data-page-icon="glyph"/)
  assert.match(glyph, /data-icon-color="brown"/)
  assert.match(glyph, /color:var\(--icon-tint-brown\)/)
  assert.match(glyph, /width="18"/)
  assert.match(html(PageIcon, { value: 'lucide:book-open' }), /width="1em"/)
  assert.match(html(PageIcon, { value: 'data:image/png;base64,iVBORw0KGgo=' }), /^<img/)
  assert.equal(html(PageIcon, { value: null }), '')
  assert.match(html(PageIcon, { value: null, fallback: 'database' }), /data-page-icon="default"/)
  assert.match(html(PageIcon, { value: 'lucide:%%' }), /data-page-icon="default"/)
  assert.equal(iconLabel('lucide:book-open:brown'), '')
  assert.equal(iconLabel('🚀'), '🚀')
})
