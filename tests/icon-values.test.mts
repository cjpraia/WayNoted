// Formato `lucide:nome:cor` de page.icon: parse/serialização, validação tolerante no meta e exportação/importação.
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatGlyphIcon, iconText, normalizePageIcon, parseIconValue } from '../src/components/ui/icons/iconValue.ts'
import { GLYPHS, glyphComponent, searchGlyphs } from '../src/components/ui/icons/catalog.ts'
import { glyphSvg } from '../src/components/ui/icons/svg.ts'
import { validateMeta } from '../src/workspace.ts'
import { buildExportPackage } from '../src/export/package.ts'
import { packageToBackup } from '../src/export/importPackage.ts'
import type { ExportSource } from '../src/export/model.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const page = (pid: string, title: string, icon: unknown) => ({ id: pid, parentId: null, title, icon, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null,
  createdAt: 1, updatedAt: 2, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '' })

test('parse e serialização do formato de ícone', () => {
  assert.equal(formatGlyphIcon('book-open', 'blue'), 'lucide:book-open:blue')
  assert.equal(formatGlyphIcon('book-open'), 'lucide:book-open')
  assert.throws(() => formatGlyphIcon('Book Open'))
  assert.deepEqual(parseIconValue('lucide:book-open:blue'), { kind: 'glyph', name: 'book-open', color: 'blue' })
  assert.deepEqual(parseIconValue('lucide:star:neon'), { kind: 'glyph', name: 'star', color: 'default' })
  assert.equal(parseIconValue('lucide:../x'), null)
  assert.deepEqual(parseIconValue('📌'), { kind: 'text', text: '📌' })
  assert.equal(parseIconValue('data:image/png;base64,AAAA')?.kind, 'image')
  assert.equal(parseIconValue(null), null)
  assert.equal(parseIconValue(42), null)
})

test('normalização tolerante e texto do ícone (links, Markdown, busca)', () => {
  assert.equal(normalizePageIcon('📌'), '📌')
  assert.equal(normalizePageIcon('lucide:star:neon'), 'lucide:star')
  assert.equal(normalizePageIcon('lucide:tag:red'), 'lucide:tag:red')
  assert.equal(normalizePageIcon('lucide:'), null)
  assert.equal(normalizePageIcon(7), null)
  assert.equal(normalizePageIcon(''), null)
  assert.equal(iconText('🚀'), '🚀')
  assert.equal(iconText('lucide:rocket:purple'), '')
  assert.equal(iconText('data:image/png;base64,AAAA'), '')
  assert.equal(iconText('https://x.test/a.png'), '')
})

test('validateMeta aceita dados antigos e normaliza o formato novo sem recusar o meta', () => {
  const [a, b, c, d] = [id(1), id(2), id(3), id(4)]
  const meta = validateMeta({ settings: {}, pages: { [a]: page(a, 'Emoji', '📚'), [b]: page(b, 'Linha', 'lucide:book-open:brown'), [c]: page(c, 'Ruim', { x: 1 }), [d]: page(d, 'Cor', 'lucide:star:neon') } })
  assert.equal(meta.pages[a].icon, '📚')
  assert.equal(meta.pages[b].icon, 'lucide:book-open:brown')
  assert.equal(meta.pages[c].icon, null)
  assert.equal(meta.pages[d].icon, 'lucide:star')
})

test('catálogo curado: ~150+ ícones únicos, todos resolvíveis, busca PT/EN sem acento', () => {
  assert.ok(GLYPHS.length >= 150, `catálogo pequeno: ${GLYPHS.length}`)
  assert.equal(new Set(GLYPHS.map((g) => g.name)).size, GLYPHS.length, 'nomes duplicados no catálogo')
  for (const g of GLYPHS) assert.ok(glyphComponent(g.name), g.name)
  assert.ok(searchGlyphs('livro').some((g) => g.name === 'book'))
  assert.ok(searchGlyphs('book').some((g) => g.name === 'book'))
  assert.ok(searchGlyphs('reuniao').some((g) => g.name === 'calendar-check'))
  assert.equal(searchGlyphs('zzzz-nada').length, 0)
  assert.equal(glyphComponent('nao-existe'), null)
})

test('glyphSvg desenha SVG com a cor do tom; emoji não vira SVG', () => {
  const svg = glyphSvg('lucide:book-open:blue', 48) ?? ''
  assert.match(svg, /^<svg[^>]*width="48"/)
  assert.match(svg, /stroke="#337ea9"/)
  assert.match(glyphSvg('lucide:desconhecido') ?? '', /<svg/)
  assert.equal(glyphSvg('📚'), null)
})

test('exportação preserva `lucide:` no front matter, desenha SVG no HTML e reimporta sem perda', async () => {
  const P = id(10)
  const source = { pages: { [P]: page(P, 'Leituras', 'lucide:book-open:brown') }, documents: { [P]: [] }, workspaceName: 'Espaço', locale: 'pt-BR' } as unknown as ExportSource
  const md = await buildExportPackage(source, { format: 'markdown', scope: 'workspace', includeFiles: false })
  const mdText = Object.entries(md.files).filter(([path]) => path.endsWith('.md')).map(([, v]) => typeof v === 'string' ? v : new TextDecoder().decode(v)).join('\n')
  assert.match(mdText, /lucide:book-open:brown/)
  assert.ok(!/# lucide:/.test(mdText), 'o ícone de linha não deve virar texto do título')
  const input = Object.fromEntries(Object.entries(md.files).map(([path, v]) => [path, typeof v === 'string' ? new TextEncoder().encode(v) : v]))
  const backup = packageToBackup(input)
  assert.equal(Object.values(backup.meta.pages).find((p) => p.title === 'Leituras')?.icon, 'lucide:book-open:brown')
  const html = await buildExportPackage(source, { format: 'html', scope: 'workspace', includeFiles: false })
  const htmlText = Object.entries(html.files).filter(([path]) => path.endsWith('.html')).map(([, v]) => typeof v === 'string' ? v : new TextDecoder().decode(v)).join('\n')
  assert.match(htmlText, /<div class="page-icon"><svg/)
  assert.ok(!htmlText.includes('>lucide:book-open'), 'HTML não deve mostrar o valor bruto')
})
