// Importação de ENEX Archive (.enex): parser seguro (XXE), ENML → blocos, anexos, limites e guardas do armazenamento.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { buildVirtualFS } from '../src/importers/bundle/vfs.ts'
import { analyzeEnex, buildEnexImport, enexDate, previewEnex, hasEnex } from '../src/importers/archive/enex.ts'
import { md5Hex } from '../src/importers/archive/md5.ts'
import { parseXml, XmlError } from '../src/importers/archive/xml.ts'
import { convertEnml } from '../src/importers/archive/enml.ts'
import type { Block } from '../src/importers/bundle/blocks.ts'

const require = createRequire(import.meta.url)
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const flat = (blocks: unknown[]): Block[] => (blocks as Block[]).flatMap(item => [item, ...flat(item.children ?? [])])
const ctx = (warns: string[] = []) => ({ cryptLabel: '[cripto]', warn: (code: string) => { warns.push(code) }, media: () => null })
const plainOf = (block: Block) => Array.isArray(block.content) ? block.content.map(node => node.type === 'text' ? node.text : node.type === 'link' ? node.content.map(part => part.text).join('') : '').join('') : ''

async function sample() {
  const vfs = buildVirtualFS([{ path: 'Viagens.enex', data: bytes('sample.enex') }])
  const plan = analyzeEnex(vfs)
  const result = await buildEnexImport(plan, { locale: 'pt-BR', now: Date.UTC(2026, 9, 9, 15) })
  return { vfs, plan, result }
}

test('prévia conta notas e anexos sem decodificar tudo', async () => {
  const { vfs, plan } = await sample()
  assert.equal(hasEnex(vfs), true)
  assert.equal(plan.notes, 2)
  assert.equal(plan.attachments, 1)
  const preview = previewEnex(plan, 'pt-BR')
  assert.equal(preview.pages, 2)
  assert.equal(preview.files, 1)
  assert.ok(preview.warnings.some(item => item.code === 'encrypted'), 'avisa sobre texto criptografado antes de importar')
})

test('uma nota = uma página sob "Importado do ENEX Archive <data>"; datas, tags e origem viram propriedades', async () => {
  const { result } = await sample()
  const root = result.pages.find(page => page.id === result.rootId)!
  assert.ok(root.title.startsWith('Importado do ENEX Archive 2026-10-'), root.title)
  const note = result.pages.find(page => page.title === 'Plano da viagem & lista')!
  assert.equal(note.parentId, result.rootId)
  assert.equal(note.createdAt, Date.UTC(2023, 0, 15, 10, 11, 12))
  assert.equal(note.updatedAt, Date.UTC(2023, 1, 20, 8, 30, 0))
  const blocks = result.documents[note.id] as Block[]
  assert.equal(blocks[0].type, 'table')
  const rows = (blocks[0].content as { rows: { cells: { type: string; text?: string }[][] }[] }).rows
  const keys = rows.map(row => (row.cells[0][0] as { text: string }).text)
  assert.deepEqual(keys, ['Etiquetas', 'Autor', 'Origem', 'Criada em', 'Atualizada em'])
  assert.ok(JSON.stringify(rows[0]).includes('#ideias-boas'))
  assert.ok(JSON.stringify(rows[2]).includes('https://example.com/artigo'))
  assert.equal(result.pages.filter(page => page.parentId === result.rootId).length, 2)
  assert.equal(new Set(result.pages.map(page => page.id)).size, result.pages.length)
})

test('ENML: títulos, listas aninhadas, tarefas, tabela, link, estilos e código', async () => {
  const { result } = await sample()
  const note = result.pages.find(page => page.title === 'Plano da viagem & lista')!
  const all = flat(result.documents[note.id])
  assert.equal(all.find(item => item.type === 'heading')?.props?.level, 1)
  assert.deepEqual(all.filter(item => item.type === 'bulletListItem').map(plainOf), ['Item um', 'Subitem', 'Item dois'])
  assert.equal(all.find(item => item.type === 'bulletListItem' && plainOf(item) === 'Item um')?.children[0]?.type, 'bulletListItem')
  assert.deepEqual(all.filter(item => item.type === 'numberedListItem').map(plainOf), ['Primeiro', 'Segundo'])
  const todos = all.filter(item => item.type === 'checkListItem')
  assert.deepEqual(todos.map(item => [plainOf(item), item.props?.checked]), [['Comprar passagens', true], ['Reservar hotel', false]])
  const table = all.filter(item => item.type === 'table')[1]
  const dataRows = (table.content as { headerRows?: number; rows: unknown[] }).rows
  assert.equal(dataRows.length, 2)
  assert.equal((table.content as { headerRows?: number }).headerRows, 1)
  const paragraph = all.find(item => item.type === 'paragraph' && plainOf(item).startsWith('Texto com'))!
  const content = paragraph.content as { type: string; styles?: Record<string, unknown>; text?: string; href?: string }[]
  assert.ok(content.some(node => node.styles?.bold && node.text === 'negrito'))
  assert.ok(content.some(node => node.styles?.italic))
  assert.ok(content.some(node => node.styles?.underline))
  assert.ok(content.some(node => node.type === 'link' && node.href === 'https://example.com'))
  assert.equal(all.find(item => item.type === 'codeBlock') && plainOf(all.find(item => item.type === 'codeBlock')!), 'linha 1\nlinha 2')
  assert.ok(all.some(item => plainOf(item).includes('[conteúdo criptografado')), 'en-crypt vira marcador')
})

test('anexo base64 vira imagem local pelo hash MD5, sem duplicar quando repetido', async () => {
  const { result } = await sample()
  const note = result.pages.find(page => page.title === 'Plano da viagem & lista')!
  const images = flat(result.documents[note.id]).filter(item => item.type === 'image')
  assert.equal(images.length, 1, 'referenciado no corpo, não repetido no fim')
  assert.ok(String(images[0].props?.url).startsWith('data:image/png;base64,'))
  assert.equal(images[0].props?.name, 'pixel.png')
  assert.equal(result.stats.files, 1)
})

test('md5 confere com node:crypto e data ENEX inválida é descartada', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 255)
    assert.equal(md5Hex(data), createHash('md5').update(data).digest('hex'), `md5 de ${size} bytes`)
  }
  assert.equal(enexDate('20230115T101112Z'), Date.UTC(2023, 0, 15, 10, 11, 12))
  assert.equal(enexDate('ontem'), null)
})

test('XXE e entidades declaradas não são expandidas nem leem arquivos', async () => {
  const vfs = buildVirtualFS([{ path: 'x.enex', data: bytes('xxe.enex') }])
  const result = await buildEnexImport(analyzeEnex(vfs), { locale: 'en-US' })
  const note = result.pages.find(page => page.title.startsWith('Nota'))!
  assert.ok(!/root:|localhost|\/bin\//.test(note.title), 'conteúdo de /etc/passwd não vaza para o título')
  assert.equal(note.title, 'Nota &xxe; &lol2;')
  const body = JSON.stringify(result.documents[note.id])
  assert.ok(!/localhost|127\.0\.0\.1/.test(body), 'conteúdo de /etc/hosts não vaza para o corpo')
  assert.ok(body.includes('&e; texto'))
})

test('ENML inválido cai para texto simples com aviso; XML inválido de nota é pulado', async () => {
  const warns: string[] = []
  const blocks = convertEnml('<en-note><div>Olá <b>mundo</div></en-note>', ctx(warns))
  assert.deepEqual(warns, ['enml-invalid'])
  assert.equal(plainOf(blocks[0]), 'Olá mundo')
  const broken = new TextEncoder().encode('<en-export><note><title>Ruim</title><content><![CDATA[<en-note><div>ok</div></en-note>]]></content><b></note><note><title>Boa</title><content><![CDATA[<en-note><div>ok</div></en-note>]]></content></note></en-export>')
  const plan = analyzeEnex(buildVirtualFS([{ path: 'a.enex', data: broken }]))
  const result = await buildEnexImport(plan, { locale: 'pt-BR' })
  assert.deepEqual(result.pages.filter(page => page.id !== result.rootId).map(page => page.title), ['Boa'])
  assert.ok(result.warnings.some(item => item.code === 'enex-note-invalid'))
})

test('arquivo truncado e sem notas geram avisos; vários .enex viram cadernos', async () => {
  const truncated = analyzeEnex(buildVirtualFS([{ path: 't.enex', data: new TextEncoder().encode('<en-export><note><title>x</title>') }]))
  assert.equal(truncated.notes, 0)
  const codes = previewEnex(truncated, 'pt-BR').warnings.map(item => item.code)
  assert.ok(codes.includes('enex-truncated') && codes.includes('enex-empty'))
  const two = await buildEnexImport(analyzeEnex(buildVirtualFS([{ path: 'A.enex', data: bytes('sample.enex') }, { path: 'B.enex', data: bytes('xxe.enex') }])), { locale: 'pt-BR' })
  const books = two.pages.filter(page => page.parentId === two.rootId)
  assert.deepEqual(books.map(page => page.title).sort(), ['A', 'B'])
})

test('anexo acima do limite é descartado com aviso e o texto da nota permanece', async () => {
  const note = (data: string) => `<en-export><note><title>Grande</title><content><![CDATA[<en-note><div>texto</div></en-note>]]></content><resource><data encoding="base64">${data}</data><mime>application/pdf</mime></resource></note></en-export>`
  const plan = analyzeEnex(buildVirtualFS([{ path: 'g.enex', data: new TextEncoder().encode(note('A'.repeat(4000))) }]))
  const result = await buildEnexImport(plan, { locale: 'pt-BR', maxAssetBytes: 1000 })
  assert.ok(result.warnings.some(item => item.code === 'asset-too-large'))
  const page = result.pages.find(item => item.title === 'Grande')!
  assert.ok(JSON.stringify(result.documents[page.id]).includes('texto'))
  assert.equal(result.stats.files, 0)
  const invalid = await buildEnexImport(analyzeEnex(buildVirtualFS([{ path: 'g.enex', data: new TextEncoder().encode(note('!!!não é base64')) }])), { locale: 'pt-BR' })
  assert.ok(invalid.warnings.some(item => item.code === 'resource-invalid'))
})

test('leitor XML: limites de profundidade e nós, DOCTYPE ignorado', () => {
  assert.throws(() => parseXml('<a>'.repeat(300)), XmlError)
  assert.throws(() => parseXml('<a><b></a>'), XmlError)
  assert.throws(() => parseXml('<a/><a/><a/>', { maxDepth: 5, maxNodes: 2 }), XmlError)
  const tree = parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a t="&x;">&x;&#65;&lt;</a>')
  const a = tree.children[0] as { attrs: Record<string, string>; children: string[] }
  assert.equal(a.attrs.t, '&x;')
  assert.equal(a.children.join(''), '&x;A<')
})

test('páginas importadas passam pelas guardas U1 do armazenamento (novo conteúdo, sem lousa)', async () => {
  const guard = require('../electron/canvas-guard.cjs')
  const { result } = await sample()
  for (const page of result.pages) assert.doesNotThrow(() => guard.assertProtectedPreserved([], result.documents[page.id]))
})
