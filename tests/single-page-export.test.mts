import test from 'node:test'
import assert from 'node:assert/strict'
import { singlePageHtml, singlePageMarkdown, splitSinglePageMarkdown } from '../src/export/singlePage.ts'

test('ida e volta com emoji', () => {
  const md = singlePageMarkdown({ title: 'Meu: plano', body: 'Olá **mundo**', icon: '🚀' })
  const { body, meta } = splitSinglePageMarkdown(md)
  assert.equal(meta.icon, '🚀'); assert.equal(meta.title, 'Meu: plano'); assert.equal(body, 'Olá **mundo**')
})
test('ida e volta com ícone de linha, capa e tipos', () => {
  const md = singlePageMarkdown({ title: 'T', body: 'x', icon: 'lucide:star:blue', cover: 'linear-gradient(135deg, #a6e3d6 0%, #5fa8d3 100%)', coverPosition: 30, typeNames: ['Projeto', 'Pessoa'] })
  assert.match(md, /icone: "lucide:star:blue"/)
  const { meta } = splitSinglePageMarkdown(md)
  assert.equal(meta.icon, 'lucide:star:blue'); assert.equal(meta.coverPosition, 30)
  assert.ok(meta.cover?.startsWith('linear-gradient')); assert.deepEqual(meta.types, ['Projeto', 'Pessoa'])
})
test('sem ícone', () => {
  const md = singlePageMarkdown({ title: 'Simples', body: 'corpo' })
  assert.ok(!md.includes('icone')); const { meta, body } = splitSinglePageMarkdown(md)
  assert.ok(meta.icon === undefined); assert.equal(body, 'corpo')
})
test('Markdown simples e de outros apps permanecem', () => {
  const plain = '# Título\n\ntexto'
  const r = splitSinglePageMarkdown(plain)
  assert.equal(r.body, plain); assert.equal(r.hadFrontMatter, false)
  const other = splitSinglePageMarkdown('---\ntags: [a, b]\ndate: 2024-01-01\n---\n# Nota\n\ncorpo')
  assert.equal(other.meta.title, 'Nota'); assert.equal(other.body, 'corpo'); assert.ok(other.meta.icon === undefined)
})
test('valores perigosos são descartados', () => {
  const r = splitSinglePageMarkdown('---\nicone: "https://x.com/a.png"\ncapa: "url(javascript:1)"\n---\ncorpo')
  assert.ok(r.meta.icon === undefined); assert.ok(r.meta.cover === undefined)
})
test('HTML renderiza SVG do ícone de linha e emoji', () => {
  assert.match(singlePageHtml({ title: 'A', body: '<p>b</p>', icon: 'lucide:star:blue', locale: 'pt-BR' }), /<div class="page-icon"><svg/)
  assert.match(singlePageHtml({ title: 'A', body: '', icon: '🚀', locale: 'pt-BR' }), /page-icon">🚀/)
  assert.ok(!singlePageHtml({ title: 'A', body: '', locale: 'pt-BR' }).includes('page-icon">'))
})
