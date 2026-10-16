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
    if (/\/i18n$/.test(dep)) { source = source.split(`'${dep}'`).join(`'data:text/javascript,export const t=(pt)=>pt'`); continue }
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
const { Button, IconButton, buttonClass } = await import(await load('../src/components/ui/Button.tsx'))
const { Toggle } = await import(await load('../src/components/ui/Toggle.tsx'))
const { DialogActions } = await import(await load('../src/components/ui/DialogActions.tsx'))
const { PanelHeader } = await import(await load('../src/components/ui/PanelHeader.tsx'))
const html = (type, props) => renderToStaticMarkup(React.createElement(type, props))
const css = await readFile(new URL('../src/components/ui/controls.css', import.meta.url), 'utf8')

test('Button: variantes mapeiam para as classes compartilhadas e type padrão é button', () => {
  assert.equal(buttonClass('secondary'), 'np-btn')
  assert.equal(buttonClass('primary'), 'np-btn np-btn--primary')
  assert.match(html(Button, { variant: 'danger', children: 'Excluir 3 linhas' }), /^<button type="button" class="np-btn np-btn--danger">Excluir 3 linhas<\/button>$/)
  assert.match(html(Button, { children: 'x', type: 'submit' }), /type="submit"/)
})

test('IconButton: rótulo vira aria-label e dica; usa a classe de 28 px', () => {
  const markup = html(IconButton, { label: 'Fechar painel', children: 'x' })
  assert.match(markup, /aria-label="Fechar painel"/)
  assert.match(markup, /title="Fechar painel"/)
  assert.match(markup, /class="np-icon-btn"/)
  assert.match(css, /\.np-icon-btn \{[^}]*width: var\(--hit-min\)[^}]*height: var\(--hit-min\)/)
})

test('Toggle: interruptor com role switch, estado e dica', () => {
  const on = html(Toggle, { label: 'Órfãs', hint: 'Sem links', checked: true, onChange: () => {} })
  assert.match(on, /role="switch"/)
  assert.match(on, /class="np-switch"/)
  assert.match(on, /checked=""/)
  assert.match(on, /Sem links/)
  assert.ok(!/checked=""/.test(html(Toggle, { label: 'x', checked: false, onChange: () => {} })))
})

test('DialogActions: cancelar vem antes e a ação confirmadora por último, com rótulo específico', () => {
  const markup = html(DialogActions, { confirmLabel: 'Excluir 3 linhas', destructive: true, onConfirm: () => {}, onCancel: () => {} })
  assert.ok(markup.indexOf('Cancelar') < markup.indexOf('Excluir 3 linhas'), 'destrutivo à direita do Cancelar')
  assert.match(markup, /np-btn--danger[^>]*>Excluir 3 linhas/)
  assert.ok(!markup.includes('np-btn--primary'), 'destrutivo não usa o destaque primário')
  assert.match(css, /\.np-dialog-actions \{[^}]*gap: var\(--space-4\)/)
})

test('PanelHeader: Fechar sempre no canto direito, depois das ações', () => {
  const markup = html(PanelHeader, { title: 'Configurações do grafo', actions: React.createElement('span', null, 'ACAO'), onClose: () => {} })
  assert.ok(markup.indexOf('Configurações do grafo') < markup.indexOf('ACAO') && markup.indexOf('ACAO') < markup.indexOf('Fechar painel'))
})

test('uma só aparência para interruptores e botões de ícone: variantes antigas saíram do código', async () => {
  const { readdir, stat } = await import('node:fs/promises')
  const walk = async (dir, out = []) => { for (const name of await readdir(dir)) { const full = new URL(name, dir); const info = await stat(full); if (info.isDirectory()) await walk(new URL(name + '/', dir), out); else if (/\.(tsx|css)$/.test(name)) out.push(full) } return out }
  const legacy = /\b(ai-switch(?!-row)|exd-switch input|gr-switch|ed-switch|pg-switch|gr-icon-btn|ai-icon-btn|ot-icon-btn)\b/
  const offenders = []
  for (const file of await walk(new URL('../src/', import.meta.url))) if (legacy.test(await readFile(file, 'utf8'))) offenders.push(file.pathname.split('/src/')[1])
  assert.deepEqual(offenders, [])
})

test('barra de seleção em lote: lixeira por último, afastada e em vermelho só no hover', async () => {
  const tsx = await readFile(new URL('../src/components/database/BulkBar.tsx', import.meta.url), 'utf8')
  assert.ok(tsx.indexOf('aria-label={t(\'Mais ações\'') < tsx.indexOf('tb-bulk-btn--danger'), 'lixeira depois de "Mais ações"')
  assert.match(tsx, /Excluir \{n\} linhas/)
  const table = await readFile(new URL('../src/components/database/table.css', import.meta.url), 'utf8')
  assert.match(table, /\.tb-bulk-btn--danger \{[^}]*margin-left: var\(--space-4\)/)
})
