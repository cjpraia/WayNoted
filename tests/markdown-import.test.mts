import COMPAT from '../shared/compatibility.ts'
// Importação de vaults do Markdown Vault: pastas → páginas, [[wikilinks]], anexos, front-matter e saída consistente.
import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { buildVirtualFS } from "../src/importers/bundle/vfs.ts"
import { analyzeVault, buildVaultImport, previewVault, isVault } from "../src/importers/markdown/vault.ts"
import { fmDate, fmList, parseFrontmatter } from "../src/importers/markdown/frontmatter.ts"
import { convertMarkdownSyntax } from "../src/importers/markdown/syntax.ts"
import type { Block } from "../src/importers/bundle/blocks.ts"

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const files: Record<string, string | Uint8Array> = {
  [COMPAT.record068]: '{}',
  [COMPAT.record069]: '{}',
  'Início.md': '---\ntags: [meta, "vault"]\naliases:\n  - Home\n  - Casa\nicon: 🏠\ncreated: 2026-01-15\nstatus: ativo\ndone: true\n---\n# Início\nVeja [[Projetos/Plano]], [[plano|o plano]] e [[Home]].\n\n![[foto.png]]\n\n![[Plano]]\n\n%%comentário oculto%%\n> [!tip] Dica\n> texto\n\n[[Inexistente]]\n',
  'Projetos/Projetos.md': 'Nota de pasta.\n',
  'Projetos/Plano.md': '# Plano\nVoltar para [[Início#Metas|início]] e [md](../Início.md). `[[no código]]`\n\n```\n[[em bloco]]\n```\n',
  'Projetos/Sub/Detalhe.md': 'Detalhe com ![alt](../../Anexos/foto.png)\n',
  'Diário/2026-10-08.md': '---\ntitle: x\ntags:\n  - dia\n---\ncorpo\n',
  'Anexos/foto.png': png,
  'Mapa.canvas': '{}',
}
const sources = () => Object.entries(files).map(([path, data]) => ({ path, data: typeof data === 'string' ? strToU8(data) : data }))
const flat = (blocks: unknown[]): Block[] => (blocks as Block[]).flatMap(block => [block, ...flat(block.children ?? [])])
const json = (value: unknown) => JSON.stringify(value)

async function run() {
  const vfs = buildVirtualFS(sources())
  const plan = analyzeVault(vfs)
  const result = await buildVaultImport(plan, { locale: 'pt-BR', now: 1_700_000_000_000 })
  const page = (title: string) => { const found = result.pages.find(item => item.title === title); assert.ok(found, `página ${title}`); return found! }
  return { vfs, plan, result, page }
}

test(COMPAT.record070, async () => {
  const { vfs, plan } = await run()
  assert.equal(isVault(vfs), true)
  assert.ok(![...plan.byPath.keys()].some(path => path.startsWith(COMPAT.record071)))
  assert.equal(plan.notes, 5)
  const preview = previewVault(plan, 'pt-BR')
  assert.equal(preview.pages, plan.nodes.length)
  assert.equal(preview.files, 1)
})

test('pastas viram páginas hierárquicas; nota de pasta assume a pasta; pasta sem nota é sintética', async () => {
  const { result, page } = await run()
  const root = result.pages.find(item => item.id === result.rootId)!
  assert.equal(root.title, "Importado do Markdown Vault")
  assert.equal(page('Início').parentId, result.rootId)
  assert.equal(page('Projetos').parentId, result.rootId)
  assert.equal(page('Plano').parentId, page('Projetos').id)
  assert.equal(page('Sub').parentId, page('Projetos').id)
  assert.equal(page('Detalhe').parentId, page('Sub').id)
  assert.equal(page('Diário').parentId, result.rootId)
  assert.equal(page('2026-10-08').parentId, page('Diário').id)
  assert.equal(result.pages.filter(item => item.title === 'Projetos').length, 1, 'nota de pasta não duplica a pasta')
  assert.equal(new Set(result.pages.map(item => item.id)).size, result.pages.length)
})

test('[[wikilinks]] (caminho, apelido, minúsculas, alias de front-matter, heading) viram links de página', async () => {
  const { result, page } = await run()
  const body = json(result.documents[page('Início').id])
  const planId = page('Plano').id
  assert.ok(body.includes(`workspace://page/${planId}`))
  assert.ok(body.includes(`workspace://page/${page('Início').id}`), 'Home → Início por alias')
  assert.ok(body.includes('o plano'))
  const plano = json(result.documents[planId])
  assert.ok(plano.includes(`workspace://page/${page('Início').id}`), '[[Início#Metas|início]] e link Markdown relativo')
  assert.ok(plano.includes('[[no código]]') && plano.includes('[[em bloco]]'), 'código fica intacto')
  assert.ok(!plano.includes("markdown:"))
  assert.ok(result.warnings.some(item => item.code === 'broken-link' && item.examples.some(example => example.includes('Inexistente'))))
  assert.ok(result.stats.links >= 5)
})

test('anexos: ![[foto.png]] e ![](caminho) copiam a imagem; ![[Nota]] vira link; comentários e callouts', async () => {
  const { result, page } = await run()
  const inicio = flat(result.documents[page('Início').id])
  const image = inicio.find(block => block.type === 'image')
  assert.ok(image && String(image.props?.url).startsWith('data:image/png;base64,'))
  const detalhe = flat(result.documents[page('Detalhe').id])
  assert.ok(detalhe.some(block => block.type === 'image'))
  assert.equal(result.stats.files, 1, 'o mesmo anexo é contado uma vez')
  const text = json(result.documents[page('Início').id])
  assert.ok(!text.includes('comentário oculto'))
  assert.ok(text.includes('Dica') && !text.includes('[!tip]'))
})

test('front-matter vira tabela de propriedades, ícone e datas; H1 repetido é removido', async () => {
  const { result, page } = await run()
  const inicio = page('Início')
  assert.equal(inicio.icon, '🏠')
  assert.equal(inicio.createdAt, Date.parse('2026-01-15T12:00:00Z'))
  const blocks = result.documents[inicio.id] as Block[]
  assert.equal(blocks[0].type, 'table')
  const table = json(blocks[0])
  assert.ok(table.includes('tags') && table.includes('#meta #vault') && table.includes('ativo') && table.includes('Sim'))
  assert.ok(!flat(blocks).some(block => block.type === 'heading'), 'H1 igual ao título foi removido')
  const dia = flat(result.documents[page('2026-10-08').id])
  assert.equal(dia[0].type, 'table')
})

test('pastas filhas aparecem no corpo da página-pai', async () => {
  const { result, page } = await run()
  const projetos = json(result.documents[page('Projetos').id])
  assert.ok(projetos.includes(page('Plano').id) && projetos.includes(page('Sub').id))
})

test('vault em ZIP (com pasta-invólucro) dá o mesmo resultado', async () => {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, data] of Object.entries(files)) entries[`MeuVault/${path}`] = typeof data === 'string' ? strToU8(data) : data
  const vfs = buildVirtualFS([{ path: 'MeuVault.zip', data: zipSync(entries) }])
  const plan = analyzeVault(vfs)
  assert.equal(plan.notes, 5)
  const result = await buildVaultImport(plan, { locale: 'en-US' })
  assert.equal(result.pages.find(page => page.id === result.rootId)!.title, "Imported from Markdown Vault")
})

test('front-matter YAML: escalares, listas, blocos e tolerância a erro', () => {
  const fm = parseFrontmatter('---\ntitle: "A: b"\nn: 3\nflag: no\nlist: [a, "b, c"]\nitems:\n  - x\n  - y # nota\ntext: |\n  linha 1\n  linha 2\nnested:\n  a: 1\nempty:\n---\ncorpo')
  assert.equal(fm.found, true)
  assert.equal(fm.body, 'corpo')
  assert.deepEqual(fm.data.list, ['a', 'b, c'])
  assert.deepEqual(fm.data.items, ['x', 'y'])
  assert.equal(fm.data.title, 'A: b'); assert.equal(fm.data.n, 3); assert.equal(fm.data.flag, false)
  assert.equal(fm.data.text, 'linha 1\nlinha 2')
  assert.equal(fm.data.nested, 'a: 1'); assert.equal(fm.data.empty, null)
  assert.equal(parseFrontmatter('sem front-matter').found, false)
  assert.equal(parseFrontmatter('---\nsem fim').found, false)
  assert.deepEqual(fmList('a, b; c'), ['a', 'b', 'c'])
  assert.equal(fmDate('08/10/2026'), Date.parse('2026-10-08T12:00:00Z'))
  assert.equal(fmDate('lixo'), null)
})

test('sintaxe: alvos com heading/bloco, apelido numérico de imagem e código inline', () => {
  const out = convertMarkdownSyntax('[[A#B]] [[A^id]] [[#só]] ![[x y.png|200]] `[[c]]`', { asset: t => `/pasta/${t}`, note: () => true })
  assert.ok(out.includes("[A > B](markdown:A)"))
  assert.ok(out.includes("[A](markdown:A)"))
  assert.ok(out.includes('só'))
  assert.ok(out.includes('![](/pasta/x%20y.png)'))
  assert.ok(out.includes('`[[c]]`'))
})

test('vault grande (2 mil notas) importa em tempo razoável', async () => {
  const many: { path: string; data: Uint8Array }[] = []
  for (let i = 0; i < 2000; i++) many.push({ path: `Pasta ${i % 40}/Nota ${i}.md`, data: strToU8(`---\ntags: [t${i % 7}]\n---\nVeja [[Nota ${(i + 1) % 2000}]] e [[Nota ${(i * 7) % 2000}|alias]].\n`) })
  const started = performance.now()
  const result = await buildVaultImport(analyzeVault(buildVirtualFS(many)), { locale: 'pt-BR' })
  assert.equal(result.stats.pages, 2040)
  assert.ok(result.stats.links >= 3900)
  assert.ok(performance.now() - started < 8000, 'importa 2 mil notas em menos de 8 s')
})
