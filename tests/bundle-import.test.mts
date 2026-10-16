import COMPAT from '../shared/compatibility.ts'
// Importação do Export Bundle: fixtures próprias (Markdown & CSV e HTML), ZIP aninhado, links, relações, tipos e desempenho.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { zipSync, strToU8 } from 'fflate'
import { JSDOM } from 'jsdom'
import { buildVirtualFS, repairName } from "../src/importers/bundle/vfs.ts"
import { analyzeExport, buildImport, previewExport, type ImportResult } from "../src/importers/bundle/importer.ts"
import { parseBundleDate, parseNumber, parseRelationText } from "../src/importers/bundle/properties.ts"
import { parseMarkdownBlocks } from "../src/importers/bundle/markdown.ts"
import type { Block, ConvertContext } from "../src/importers/bundle/blocks.ts"
import { IDS, htmlExport, largeExport, markdownExport, nestedZip, toSources } from "./fixtures/bundle-export.mjs"

const require = createRequire(import.meta.url)
const { window } = new JSDOM('')
const parseHTML = (html: string) => new window.DOMParser().parseFromString(html, 'text/html')

type Page = ImportResult['pages'][number]
const byTitle = (result: ImportResult, title: string): Page => {
  const page = result.pages.find(item => item.title === title)
  assert.ok(page, `página "${title}" existe`)
  return page!
}
const flat = (blocks: unknown[]): Block[] => (blocks as Block[]).flatMap(block => [block, ...flat(block.children ?? [])])
const types = (blocks: unknown[]) => new Set(flat(blocks).map(block => block.type))
const links = (blocks: unknown[]): string[] => JSON.stringify(blocks).match(new RegExp(`workspace:\\/\\/page\\/[0-9a-f-]{36}`, "g")) ?? []
const propByName = (page: Page, name: string) => page.database!.properties.find(property => property.name === name)!

async function importMarkdown() {
  const vfs = buildVirtualFS([{ path: 'Export-1234.zip', data: nestedZip(markdownExport()) }])
  return { vfs, result: await buildImport(analyzeExport(vfs), { locale: 'pt-BR', now: 1_700_000_000_000 }) }
}

test('ZIP com ZIPs internos (Part-1/Part-2) recria a hierarquia com títulos sem id', async () => {
  const { vfs, result } = await importMarkdown()
  assert.equal(vfs.nestedArchives, 2)
  const root = result.pages.find(page => page.id === result.rootId)!
  assert.equal(root.title, "Importado do Export Bundle")
  assert.equal(root.parentId, null)
  const projects = byTitle(result, 'Projetos 🚀')
  assert.equal(projects.parentId, result.rootId)
  assert.equal(byTitle(result, 'Subpágina').parentId, projects.id)
  const tasks = byTitle(result, 'Tarefas')
  assert.equal(tasks.parentId, projects.id)
  assert.ok(tasks.database, 'Tarefas virou banco de dados')
  for (const row of ['Linha Alfa', 'Linha Beta', 'Linha Gama']) assert.equal(byTitle(result, row).parentId, tasks.id)
  const clients = byTitle(result, 'Clientes')
  assert.equal(clients.parentId, result.rootId)
  assert.ok(result.pages.every(page => !/[0-9a-f]{32}/.test(page.title)), "nenhum título mantém o id do Export Bundle")
  // Arquivo em NFD (macOS) com link em NFC continua resolvido.
  const notes = byTitle(result, 'Anotações')
  assert.ok(links(result.documents[projects.id]).includes(`workspace://page/${notes.id}`), JSON.stringify(links(result.documents[projects.id])))
  assert.equal(result.pages.filter(page => page.parentId === null).length, 1, 'tudo fica sob uma única raiz nova')
  const preview = previewExport(analyzeExport(vfs), 'pt-BR')
  assert.equal(preview.databases, 2)
  assert.equal(preview.rows, 5)
  assert.equal(preview.files, 1)
})

test('Markdown vira blocos BlockNote e links internos apontam para as páginas importadas', async () => {
  const { result } = await importMarkdown()
  const projects = byTitle(result, 'Projetos 🚀')
  const blocks = result.documents[projects.id]
  const kinds = types(blocks)
  for (const kind of ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'callout', 'toggleListItem', 'quote', 'codeBlock', 'equation', 'table', 'divider', 'image', 'page']) assert.ok(kinds.has(kind), `bloco ${kind}`)
  const all = flat(blocks)
  assert.equal(all.find(block => block.type === 'codeBlock')!.props!.language, 'python')
  assert.equal(all.find(block => block.type === 'equation')!.props!.latex, '\\int x\\,dx')
  assert.deepEqual(all.filter(block => block.type === 'checkListItem').map(block => block.props!.checked), [false, true])
  assert.equal(all.find(block => block.type === 'bulletListItem')!.children.length, 1, 'lista aninhada')
  assert.match(String(all.find(block => block.type === 'image')!.props!.url), /^data:image\/png;base64,/)
  assert.ok(JSON.stringify(blocks).includes('"inlineEquation"'))
  assert.ok(JSON.stringify(blocks).includes('"bold":true'))
  // Banco citado no corpo vira bloco de página; subpágina não citada é anexada no fim.
  const pageBlocks = all.filter(block => block.type === 'page').map(block => block.props!.pageId)
  assert.ok(pageBlocks.includes(byTitle(result, 'Tarefas').id))
  assert.ok(pageBlocks.includes(byTitle(result, 'Subpágina').id))
  // Menção a linha de banco.
  assert.ok(links(blocks).includes(`workspace://page/${byTitle(result, 'Linha Alfa').id}`), JSON.stringify(links(blocks)))
  assert.ok(JSON.stringify(blocks).includes('https://example.com'))
  // Link relativo de volta ao pai (../) também é reescrito.
  assert.ok(links(result.documents[byTitle(result, 'Subpágina').id]).includes(`workspace://page/${projects.id}`))
  // Corpo da linha sem o bloco de propriedades.
  const alpha = JSON.stringify(result.documents[byTitle(result, 'Linha Alfa').id])
  assert.ok(alpha.includes('Corpo da linha alfa'))
  assert.ok(!alpha.includes('Status:'))
  const broken = result.warnings.find(warning => warning.code === 'broken-link')
  assert.equal(broken?.count, 1)
})

test('bancos inferem tipos pelo CSV + Markdown das linhas e resolvem relações entre bancos', async () => {
  const { result } = await importMarkdown()
  const tasks = byTitle(result, 'Tarefas'), clients = byTitle(result, 'Clientes')
  const kinds = Object.fromEntries(tasks.database!.properties.map(property => [property.name, property.type]))
  assert.deepEqual(kinds, { Nome: 'title', Status: 'status', Tags: 'multiSelect', Prazo: 'date', Feito: 'checkbox', Pontos: 'number', Site: 'url', Email: 'email', Telefone: 'phone', Clientes: 'relation' })
  assert.equal(tasks.database!.views.length, 1)
  assert.equal(tasks.database!.views[0].type, 'table')
  const status = propByName(tasks, 'Status')
  assert.deepEqual(status.options!.map(option => [option.name, option.group]), [['Em andamento', 'progress'], ['Concluído', 'complete'], ['Não iniciado', 'todo']])
  const alpha = byTitle(result, 'Linha Alfa'), beta = byTitle(result, 'Linha Beta'), gama = byTitle(result, 'Linha Gama')
  const value = (row: Page, name: string) => row.props![propByName(tasks, name).id]
  assert.deepEqual(value(alpha, 'Prazo'), { start: '2026-10-07', end: '2026-10-09' })
  assert.deepEqual(value(beta, 'Prazo'), { start: '2026-10-01', startTime: '15:00' })
  assert.deepEqual(value(gama, 'Prazo'), { start: '2026-10-20' })
  assert.equal(value(alpha, 'Pontos'), 1250.5)
  assert.equal(value(beta, 'Feito'), true)
  assert.equal(value(alpha, 'Feito'), false)
  const tags = propByName(tasks, 'Tags').options!
  assert.deepEqual((value(gama, 'Tags') as string[]).map(id => tags.find(option => option.id === id)!.name), ['interno', 'cliente'])
  assert.equal(propByName(tasks, 'Clientes').relationDatabaseId, clients.id)
  const acme = byTitle(result, 'Acme'), globex = byTitle(result, 'Globex')
  assert.deepEqual(value(alpha, 'Clientes'), [acme.id])
  assert.deepEqual(value(gama, 'Clientes'), [acme.id, globex.id])
  // Relação inversa (Clientes → Tarefas) também resolvida e pareada como espelho.
  const back = propByName(clients, 'Tarefas')
  assert.equal(back.type, 'relation')
  assert.equal(back.relationDatabaseId, tasks.id)
  assert.deepEqual(acme.props![back.id], [alpha.id])
  assert.equal(back.relationMirrorPropertyId, propByName(tasks, 'Clientes').id)
  assert.equal(propByName(clients, 'Cidade').type, 'text', 'textos curtos e distintos não viram seleção')
  // Linha só presente no _all.csv (sem .md) também é criada.
  assert.ok(gama.props && Object.keys(gama.props).length > 3)
})

test('exportação HTML: ícone, capa local, opções coloridas, fórmula estática, pessoa como texto e blocos', async () => {
  const { files, ids } = htmlExport()
  const vfs = buildVirtualFS(toSources(files))
  const plan = analyzeExport(vfs)
  assert.equal(previewExport(plan, 'pt-BR').format, 'html')
  const result = await buildImport(plan, { locale: 'en-US', parseHTML })
  const root = result.pages.find(page => page.id === result.rootId)!
  assert.equal(root.title, "Imported from Export Bundle")
  const wiki = byTitle(result, 'Wiki')
  assert.equal(wiki.icon, '📚')
  assert.match(String(wiki.cover), /^data:image\/png;base64,/)
  assert.equal(wiki.coverPosition, 30)
  const books = byTitle(result, 'Livros')
  assert.equal(books.parentId, wiki.id)
  const kinds = Object.fromEntries(books.database!.properties.map(property => [property.name, property.type]))
  assert.deepEqual(kinds, { Nome: 'title', 'Gênero': 'select', Nota: 'number', Dobro: 'number', Autor: 'text', Relacionados: 'relation' })
  assert.deepEqual(propByName(books, 'Gênero').options!.map(option => [option.name, option.color]), [['Ficção', 'purple'], ['Clássico', 'blue']])
  const dune = byTitle(result, 'Duna'), foundation = byTitle(result, 'Fundação')
  assert.equal(dune.icon, '🏜️')
  assert.equal(dune.props![propByName(books, 'Autor').id], 'Frank')
  assert.deepEqual(dune.props![propByName(books, 'Relacionados').id], [foundation.id])
  assert.ok(result.warnings.some(warning => warning.code === 'formula-static'))
  assert.ok(result.warnings.some(warning => warning.code === 'person-text'))
  const blocks = result.documents[wiki.id]
  const kindsInBody = types(blocks)
  for (const kind of ['paragraph', 'heading', 'toggleListItem', 'callout', 'checkListItem', 'equation', 'codeBlock', 'table', 'page', 'columnList', 'column', 'image', 'quote', 'divider']) assert.ok(kindsInBody.has(kind), `bloco ${kind}`)
  const all = flat(blocks)
  assert.equal(all.find(block => block.type === 'callout')!.props!.icon, '⚠️')
  assert.equal(all.find(block => block.type === 'equation')!.props!.latex, 'a^2+b^2=c^2')
  assert.equal(all.find(block => block.type === 'codeBlock')!.props!.language, 'javascript')
  assert.equal(all.find(block => block.type === 'image')!.props!.caption, 'Legenda')
  assert.ok(links(blocks).includes(`workspace://page/${dune.id}`), JSON.stringify(links(blocks)))
  assert.ok(JSON.stringify(blocks).includes('"backgroundColor":"yellow"'))
  assert.ok(!result.pages.some(page => page.title === 'index'), 'index.html da raiz é ignorado')
  assert.ok(ids.F.length === 32)
})

test('pasta solta: invólucro removido, nomes Latin-1 recuperados, caminhos inseguros ignorados', async () => {
  const files = markdownExport()
  const sources = toSources(Object.fromEntries(Object.entries(files).map(([path, data]) => [`Minha exportação/${path}`, data])))
  sources.push({ path: '../fora.md', data: strToU8('# Fora') })
  const vfs = buildVirtualFS(sources)
  assert.ok(vfs.files.has(`Projetos 🚀 ${IDS.A}.md`), 'pasta invólucro removida')
  assert.equal(vfs.issues.filter(issue => issue.kind === 'unsafe-path').length, 1)
  const latin1 = String.fromCharCode(...new TextEncoder().encode('Página 🚀.md'))
  assert.equal(repairName(latin1), 'Página 🚀.md')
  assert.equal(repairName('Página.md'), 'Página.md')
  const result = await buildImport(analyzeExport(vfs), { locale: 'pt-BR' })
  assert.ok(result.pages.some(page => page.title === 'Projetos 🚀'))
  assert.ok(!result.pages.some(page => page.title === 'Fora'))
})

test('ZIP sem sinalizador UTF-8 e caminho longo continuam legíveis', async () => {
  const longTitle = 'Título muito longo '.repeat(12).trim()
  const zip = zipSync({ [`${longTitle} ${IDS.D}.md`]: strToU8(`# ${longTitle}\n\nOlá 👋`) })
  const result = await buildImport(analyzeExport(buildVirtualFS([{ path: 'a.zip', data: zip }])), { locale: 'pt-BR' })
  assert.ok(result.pages.some(page => page.title === longTitle))
})

test('conversões unitárias: datas, números, relações em texto e Markdown ambíguo', () => {
  assert.deepEqual(parseBundleDate('October 7, 2026 3:00 PM → 5:30 PM'), { start: '2026-10-07', startTime: '15:00', end: '2026-10-07', endTime: '17:30' })
  assert.deepEqual(parseBundleDate('7 de outubro de 2026 14:05'), { start: '2026-10-07', startTime: '14:05' })
  assert.deepEqual(parseBundleDate('@2026-10-07T08:30:00.000Z'), { start: '2026-10-07', startTime: '08:30' })
  assert.deepEqual(parseBundleDate('07/10/2026', true), { start: '2026-10-07' })
  assert.equal(parseBundleDate('não é data'), null)
  assert.deepEqual(parseNumber('R$ 1.234,50'), { value: 1234.5, format: 'currency', currency: 'BRL' })
  assert.deepEqual(parseNumber('45%'), { value: 0.45, format: 'percent' })
  assert.equal(parseNumber('12 maçãs'), null)
  assert.deepEqual(parseRelationText(COMPAT.record066).map(item => item.text), ['A', 'B'])
  assert.deepEqual(parseRelationText('apenas texto, com vírgula'), [])
  const ctx: ConvertContext = { file: 'a.md', resolvePage: () => null, isChild: () => false, resolveAsset: () => null, warn: () => {}, referenced: new Set() }
  const money = parseMarkdownBlocks('Custa $5 e $10 hoje.', ctx)
  assert.ok(!JSON.stringify(money).includes('inlineEquation'), 'cifrões não viram equação')
  const toggleHeading = parseMarkdownBlocks('<details>\n<summary><h2>Seção</h2></summary>\n\n- filho\n\n</details>', ctx)
  assert.equal(toggleHeading[0].type, 'heading')
  assert.equal(toggleHeading[0].props!.isToggleable, true)
  assert.equal(toggleHeading[0].children[0].type, 'bulletListItem')
  const aside = parseMarkdownBlocks('<aside>\n🔥 Quente\n\nSegundo parágrafo\n</aside>', ctx)
  assert.equal(aside[0].type, 'callout')
  assert.equal(aside[0].props!.icon, '🔥')
  assert.equal(aside[0].children[0].type, 'paragraph')
})

test('cancelamento interrompe a conversão com AbortError', async () => {
  const vfs = buildVirtualFS(toSources(largeExport(5, 30, 20)))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(buildImport(analyzeExport(vfs), { locale: 'pt-BR', signal: controller.signal }), (error: Error) => error.name === 'AbortError')
})

test('leitor nativo de pasta (Electron) lê recursivamente e ignora links simbólicos', async () => {
  const { readFolder } = require("../electron/bundle-import.cjs")
  const dir = mkdtempSync(join(tmpdir(), COMPAT.record067))
  try {
    mkdirSync(join(dir, `Página ${IDS.A}`))
    writeFileSync(join(dir, `Página ${IDS.A}.md`), '# Página')
    writeFileSync(join(dir, `Página ${IDS.A}`, 'img.png'), 'x')
    symlinkSync('/etc', join(dir, 'link'))
    const files: { path: string }[] = await readFolder(dir)
    assert.deepEqual(files.map(file => file.path).sort(), [`Página ${IDS.A}.md`, `Página ${IDS.A}/img.png`].sort())
    await assert.rejects(readFolder(dir, { files: 1, totalBytes: 1e9, depth: 8 }), /TOO_MANY_FILES/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('desempenho: ~5.000 páginas (ZIP) em tempo e memória limitados', async () => {
  const files = largeExport(50, 89, 500) // 50 + 4.450 páginas + banco com 500 linhas = 5.001 nós
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strToU8(data as string)])), { level: 1 })
  const started = performance.now()
  const vfs = buildVirtualFS([{ path: 'grande.zip', data: zip }])
  const plan = analyzeExport(vfs)
  const result = await buildImport(plan, { locale: 'pt-BR' })
  const elapsed = performance.now() - started
  assert.equal(result.pages.length, 5002)
  assert.equal(result.stats.databases, 1)
  assert.equal(result.stats.rows, 500)
  const db = result.pages.find(page => page.database)!
  assert.deepEqual(db.database!.properties.map(property => property.type), ['title', 'status', 'number', 'date'])
  const firstTop = byTitle(result, 'Página 0')
  assert.equal(result.pages.filter(page => page.parentId === firstTop.id).length, 89)
  assert.equal(links(result.documents[firstTop.id]).length, 0, 'filhas citadas viram blocos de página')
  assert.equal(flat(result.documents[firstTop.id]).filter(block => block.type === 'page').length, 89)
  assert.ok(elapsed < 60_000, `importação levou ${Math.round(elapsed)} ms`)
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024
  assert.ok(heapMb < 1500, `heap ${Math.round(heapMb)} MB`)
  console.log(`bundle-import perf: ${result.pages.length} páginas em ${Math.round(elapsed)} ms, heap ${Math.round(heapMb)} MB`)
})
