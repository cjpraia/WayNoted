// A1 — diálogo "Aprovar alteração de agente", menu "Privado para IA" e CSS (escala de espaçamento).
// Só renderToStaticMarkup (sem DOM): os asserts comparam strings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transformWithOxc as baseTransformWithOxc } from 'vite'
import { inlineProductSource } from './fixtures/product-source.mjs'
const transformWithOxc = (source, ...args) => baseTransformWithOxc(inlineProductSource(source), ...args)
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const I18N_STUB = 'data:text/javascript;base64,' + Buffer.from("export const t=(pt,en,vars)=>Object.entries(vars??{}).reduce((s,[k,v])=>s.split('{'+k+'}').join(String(v)),pt);export const useI18n=()=>({locale:'pt-BR',t})").toString('base64')
const cache = new Map()
async function load(rel) {
  const url = new URL(rel, import.meta.url)
  if (cache.has(url.href)) return cache.get(url.href)
  let source = (await readFile(url, 'utf8')).replace(/\r\n/g, '\n').replace(/^import type [^\n]*\n/gm, '').replace(/^import ['"][^'"]+\.css['"]\n/gm, '')
  for (const dep of [...source.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g)].map(m => m[1])) {
    if (/\/i18n$/.test(dep)) { source = source.split(`'${dep}'`).join(`'${I18N_STUB}'`); continue }
    if (/\.css$/.test(dep)) { source = source.split(`'${dep}'`).join(`'data:text/javascript,'`); continue }
    const file = /\.tsx?$/.test(dep) ? dep : (await readFile(new URL(dep + '.tsx', url)).then(() => dep + '.tsx', () => dep + '.ts'))
    source = source.split(`'${dep}'`).join(`'${await load(new URL(file, url).href)}'`)
  }
  const out = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' }, lang: url.pathname.endsWith('x') ? 'tsx' : 'ts' }).catch(error => { throw new Error(url.pathname + ': ' + error.message) })
  const code = out.code.replace(/from ["'](react(?:\/jsx-runtime)?|react-dom\/server|lucide-react)["']/g, (_m, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  cache.set(url.href, dataUrl)
  return dataUrl
}
const { AgentApprovalDialog, DiffView, changeKindLabel } = await import(await load('../src/agent/AgentApprovalDialog.tsx'))
const { aiPrivateSource, isAiPrivate } = await import(await load('../src/agent/privacy.ts'))

const approval = {
  id: 'a1', clientId: 'c1', clientName: 'Claude Desktop', createdAt: 0, expiresAt: Date.now() + 60000, timeoutSec: 60,
  change: { kind: 'blocks.replace', pageId: 'p', title: 'Plano da semana', diff: { added: 1, removed: 1, truncated: false, ops: [{ t: 'same', text: 'Segunda' }, { t: 'del', text: 'Terça: dentista' }, { t: 'add', text: 'Terça: reunião' }, { t: 'gap', count: 7 }] } },
}

test('diálogo de aprovação: cliente, página, diff antes/depois, prazo e as três saídas', () => {
  const markup = renderToStaticMarkup(React.createElement(AgentApprovalDialog, { approval, queued: 2, onDecide() {} }))
  assert.match(markup, /role="alertdialog"/); assert.match(markup, /aria-modal="true"/)
  assert.match(markup, /Aprovar alteração de agente/)
  assert.match(markup, /Claude Desktop/); assert.match(markup, /Plano da semana/)
  assert.match(markup, /is-add[^>]*>.*Terça: reunião/); assert.match(markup, /is-del[^>]*>.*Terça: dentista/)
  assert.match(markup, /7 linhas sem mudança/)
  assert.match(markup, />Rejeitar</); assert.match(markup, />Aprovar tudo deste cliente por 1 h</); assert.match(markup, />Aprovar</)
  assert.match(markup, /\+2 na fila/); assert.match(markup, /Rejeita sozinho em/)
  assert.ok(markup.indexOf('>Rejeitar<') < markup.indexOf('>Aprovar<'), 'o gesto seguro vem antes')
})

test('diff vazio e rótulos de ação conhecidos', () => {
  assert.match(renderToStaticMarkup(React.createElement(DiffView, { change: { kind: 'x', diff: { added: 0, removed: 0, ops: [], truncated: false } } })), /Sem diferenças/)
  assert.equal(changeKindLabel('daily.create'), 'Criar a nota diária'); assert.equal(changeKindLabel('desconhecida'), 'desconhecida')
})

test('Privado para IA: a marca vale para a página e todas as subpáginas (menu mostra a origem herdada)', () => {
  const pages = { a: { id: 'a', parentId: null, aiPrivate: true }, b: { id: 'b', parentId: 'a' }, c: { id: 'c', parentId: 'b' }, d: { id: 'd', parentId: null }, loop1: { id: 'loop1', parentId: 'loop2' }, loop2: { id: 'loop2', parentId: 'loop1' } }
  assert.equal(aiPrivateSource(pages, 'a'), 'a'); assert.equal(aiPrivateSource(pages, 'c'), 'a'); assert.equal(aiPrivateSource(pages, 'd'), null)
  assert.equal(isAiPrivate(pages, 'b'), true); assert.equal(isAiPrivate(pages, 'loop1'), false, 'ciclo não trava')
})

test('CSS dos agentes usa só tokens de espaçamento e a página tem o item de menu', async () => {
  const css = await readFile(new URL('../src/agent/agent.css', import.meta.url), 'utf8')
  const bad = [...css.matchAll(/(?:padding|margin|gap)[^:;{}]*:\s*([^;}]+)/g)].filter(m => /\b\d+px\b/.test(m[1].replace(/var\([^)]*\)/g, '')) && !/\b(0|1|2|4|8|12|16|24|32|40|48|64)px\b/.test(m[1])).map(m => m[0])
  assert.deepEqual(bad, [])
  const menu = await readFile(new URL('../src/components/page/PageMenu.tsx', import.meta.url), 'utf8')
  assert.match(menu, /Privado para IA/); assert.match(menu, /aiPrivate/)
  const settings = await readFile(new URL('../src/components/modals/SettingsModal.tsx', import.meta.url), 'utf8')
  assert.match(settings, /AgentSettingsCards/)
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /<AgentApprovalHost \/>/)
})
