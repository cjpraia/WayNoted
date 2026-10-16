// D3b — Apple Notes: parser da saída do osascript (fixtures), HTML do Notas → blocos, árvore de páginas,
// notas protegidas ignoradas, cancelamento e execução com um executor simulado. ⚠ O que só o app real valida:
// o formato exato do HTML do Notas (listas de tarefas) e os ids de pasta (ver docs/LOCAL-INTEGRATIONS.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { appleErrorCode, parseBatch, parseListing, AppleNotesParseError } from '../src/importers/appleNotes/parse.ts'
import { appleHtmlToBlocks, parseHtml } from '../src/importers/appleNotes/html.ts'
import { buildAppleNotesImport, defaultSelection, planAppleImport, previewAppleImport } from '../src/importers/appleNotes/importer.ts'
import type { Block } from '../src/importers/bundle/blocks.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/apple-notes/${name}`, import.meta.url), 'utf8')
const flat = (blocks: Block[]): Block[] => blocks.flatMap(item => [item, ...flat(item.children ?? [])])
const plainOf = (block: Block) => Array.isArray(block.content) ? block.content.map(node => node.type === 'text' ? node.text : node.type === 'link' ? node.content.map(part => part.text).join('') : '').join('') : ''
const P10 = 'x-coredata://AAAA/ICFolder/p10', P11 = 'x-coredata://AAAA/ICFolder/p11', P12 = 'x-coredata://AAAA/ICFolder/p12', P20 = 'x-coredata://AAAA/ICFolder/p20'
const executor = (calls: string[] = []) => async (folderId: string, offset: number) => {
  calls.push(`${folderId.split('/').pop()}@${offset}`)
  const file = { [P10]: 'notes-p10.json', [P11]: 'notes-p11.json', [P20]: 'notes-p20.json' }[folderId]
  if (!file) throw new Error('pasta inesperada ' + folderId)
  return fixture(file)
}

test('parseListing: contas/pastas válidas; entrada hostil ou quebrada é saneada', () => {
  const listing = parseListing(fixture('folders.json'))
  assert.equal(listing.accounts.length, 2); assert.equal(listing.folders.length, 4)
  assert.equal(listing.folders.find(f => f.name === 'Receitas')!.parentId, P10)
  assert.deepEqual(defaultSelection(listing).sort(), [P10, P11, P20].sort(), 'a lixeira não vem marcada')
  // JSON duplamente codificado (osascript devolve a string entre aspas)
  assert.equal(parseListing(JSON.stringify(fixture('folders.json'))).folders.length, 4)
  const hostile = parseListing(JSON.stringify({
    accounts: [{ id: 'a', name: 'X'.repeat(1000) }, { id: '' }, 5, null],
    folders: [{ id: 'f1', name: 'Pai', accountId: 'a', parentId: 'f2', notes: 1, locked: 0 }, { id: 'f2', name: 'Filho', accountId: 'a', parentId: 'f1', notes: -4, locked: 'x' }, { id: 'f3', name: 'Órfã', accountId: 'inexistente', parentId: null }, { id: 'f4', name: 'Sem pai', accountId: 'a', parentId: 'nada', notes: 2 }, { id: 'f1', name: 'dup', accountId: 'a' }],
  }))
  assert.equal(hostile.accounts.length, 1); assert.ok(hostile.accounts[0].name.length <= 300)
  assert.deepEqual(hostile.folders.map(f => f.id).sort(), ['f1', 'f2', 'f4'])
  assert.ok(hostile.folders.some(f => f.parentId === null), 'ciclo quebrado')
  assert.equal(hostile.folders.find(f => f.id === 'f2')!.notes, 0); assert.equal(hostile.folders.find(f => f.id === 'f4')!.parentId, null)
  for (const bad of ['', 'não é json', '[]', '{"accounts":1,"folders":[]}']) assert.throws(() => parseListing(bad), AppleNotesParseError, bad)
})

test('parseBatch: datas, protegida, corpo gigante separado, campos inválidos ignorados', () => {
  const batch = parseBatch(fixture('notes-p10.json'), P10)
  assert.equal(batch.total, 3); assert.equal(batch.notes.length, 3)
  assert.equal(batch.notes[0].created, Date.parse('2024-03-01T10:00:00.000Z')); assert.equal(batch.notes[1].locked, true); assert.equal(batch.notes[1].body, '')
  const odd = parseBatch(JSON.stringify({ total: 'x', notes: [{ id: 'n1', name: 'A\nB', body: 'z'.repeat(26 * 1024 * 1024), created: 'ontem', modified: '1969-01-01' }, { id: 5 }, { id: 'n2', name: 'ok', body: '<p>x</p>', created: '2030-01-01T00:00:00Z' }] }), P10)
  assert.equal(odd.total, 0); assert.deepEqual(odd.oversized, ['A B']); assert.equal(odd.notes.length, 1); assert.equal(odd.notes[0].created, Date.parse('2030-01-01T00:00:00Z'))
  assert.throws(() => parseBatch('{"x":1}', P10), AppleNotesParseError)
})

test('HTML do Notas → blocos: título duplicado sai; estilos, listas, tarefas, tabela em <object>, imagem data: e aviso de mídia externa', () => {
  const warns: string[] = []
  const note = parseBatch(fixture('notes-p10.json'), P10).notes[0]
  const { blocks, images } = appleHtmlToBlocks(note.body, { title: note.name, warn: (code, detail) => warns.push(`${code}:${detail ?? ''}`), imageName: (i, ext) => `img-${i}.${ext}` })
  const all = flat(blocks), types = blocks.map(b => b.type)
  assert.notEqual(plainOf(blocks[0]), 'Lista de compras', 'o título repetido no corpo é removido')
  assert.ok(plainOf(blocks[0]).startsWith('Comprar pão e leite'))
  const first = blocks[0].content as { type: string; text?: string; styles?: Record<string, unknown>; href?: string }[]
  assert.ok(first.some(n => n.type === 'text' && n.styles?.bold && n.text === 'pão')); assert.ok(first.some(n => n.type === 'text' && n.styles?.italic))
  assert.ok(first.some(n => n.type === 'link' && n.href === 'https://exemplo.com/loja'))
  assert.ok(types.includes('bulletListItem') && types.includes('table') && types.includes('image'), types.join())
  assert.equal(all.find(b => plainOf(b) === 'Feijão')!.children[0].type, 'bulletListItem', 'sub-lista aninhada')
  const todo = all.filter(b => b.type === 'checkListItem')
  assert.deepEqual(todo.map(b => [plainOf(b), (b.props as { checked: boolean }).checked]), [['Ligar para Ana', false], ['Pagar conta', true]])
  const image = all.find(b => b.type === 'image')!
  assert.match(String((image.props as { url: string }).url), /^data:image\/png;base64,/); assert.equal(images, 1)
  assert.deepEqual(warns, ['remote-media:https://tracker.example/pixel.gif'], 'imagem externa não é baixada')
  assert.ok(!JSON.stringify(blocks).includes('alert(1)'), 'script descartado')
})

test('leitor tolerante: tags não fechadas, entidades, aninhamento profundo e limites', () => {
  const tree = parseHtml('<ul><li>um<li>dois</ul><p>a<br>b &amp; c &lt;x&gt; &#233;</p><!-- c --><DIV Class="X" data-a=1>t</DIV>')
  const names = (n: { children: unknown[] }): string[] => n.children.flatMap(c => typeof c === 'string' ? [] : [(c as { name: string }).name, ...names(c as { children: unknown[] })])
  assert.deepEqual(names(tree), ['ul', 'li', 'li', 'p', 'br', 'div'])
  const { blocks } = appleHtmlToBlocks('<p>a<br>b &amp; c &lt;x&gt; &#233;</p>', { warn: () => {}, imageName: () => 'x' })
  assert.equal(plainOf(blocks[0]), 'a\nb & c <x> é')
  const deep = appleHtmlToBlocks('<div>'.repeat(5000) + 'fundo' + '</div>'.repeat(5000), { warn: () => {}, imageName: () => 'x' })
  assert.ok(JSON.stringify(deep.blocks).includes('fundo'))
  assert.doesNotThrow(() => parseHtml('<a href="x'), 'tag aberta no fim')
  assert.doesNotThrow(() => parseHtml('<'.repeat(1000)))
})

test('plano e prévia: contagem, ancestrais incluídos, protegidas contadas como aviso', () => {
  const listing = parseListing(fixture('folders.json'))
  const plan = planAppleImport(listing, defaultSelection(listing))
  assert.equal(plan.notes, 2 + 1 + 1, 'p10 (3 - 1 protegida) + p11 + p20')
  assert.equal(plan.locked, 1)
  const preview = previewAppleImport(plan, 'pt-BR')
  assert.equal(preview.pages, 4 + 3 + 2, 'notas + pastas + 2 contas')
  assert.ok(preview.warnings.some(w => w.code === ('apple-locked' as never) && w.count === 1))
  const only = planAppleImport(listing, [P11])
  assert.deepEqual(only.folders.map(f => f.id), [P10, P11], 'ancestrais entram só como contêiner'); assert.equal(only.notes, 1)
  assert.equal(planAppleImport(listing, []).notes, 0)
})

test('importação: árvore de páginas, ignora protegida, datas e ordem; executor chamado por lote', async () => {
  const listing = parseListing(fixture('folders.json'))
  const plan = planAppleImport(listing, defaultSelection(listing))
  const calls: string[] = [], progress: number[] = []
  const result = await buildAppleNotesImport(plan, { locale: 'pt-BR', now: Date.UTC(2026, 9, 9, 15), fetchBatch: executor(calls), onProgress: (_p, done) => progress.push(done) })
  assert.deepEqual(calls.sort(), ['p10@0', 'p11@0', 'p20@0'])
  const byTitle = (title: string) => result.pages.find(p => p.title === title)!
  const root = result.pages.find(p => p.id === result.rootId)!
  assert.match(root.title, /^Importado do Apple Notes 2026-10-/); assert.equal(root.parentId, null)
  const icloud = byTitle('iCloud'), notas = byTitle('Notas'), receitas = byTitle('Receitas'), bolo = byTitle('Bolo'), compras = byTitle('Lista de compras')
  assert.equal(icloud.parentId, root.id); assert.equal(notas.parentId, icloud.id); assert.equal(receitas.parentId, notas.id); assert.equal(bolo.parentId, receitas.id); assert.equal(compras.parentId, notas.id)
  assert.equal(byTitle('Local').parentId, byTitle('No meu Mac').id)
  assert.ok(!result.pages.some(p => p.title === 'Secreta'), 'protegida não é importada')
  assert.ok(!result.pages.some(p => p.title === 'Apagadas recentemente'))
  assert.equal(compras.createdAt, Date.parse('2024-03-01T10:00:00.000Z')); assert.equal(compras.updatedAt, Date.parse('2024-03-05T12:30:00.000Z'))
  const locked = result.warnings.find(w => (w.code as string) === 'apple-locked')!
  assert.equal(locked.count, 1); assert.deepEqual(locked.examples, ['Secreta'])
  assert.equal(result.stats.pages, 4 + 3 + 2); assert.equal(result.stats.files, 1)
  const folderDoc = result.documents[notas.id] as Block[]
  assert.ok(folderDoc.every(b => b.type === 'page') && folderDoc.length >= 3, 'a pasta lista as subpáginas')
  assert.equal(new Set(result.pages.map(p => p.id)).size, result.pages.length)
  assert.ok(Object.keys(result.documents).every(id => result.pages.some(p => p.id === id)))
  assert.equal(progress.at(-1), 4)
})

test('uma conta só: sem página de conta; cancelar interrompe e não devolve nada; erro de permissão sobe com código', async () => {
  const listing = parseListing(fixture('folders.json'))
  const single = planAppleImport(listing, [P11, P10])
  const result = await buildAppleNotesImport(single, { locale: 'en-US', now: 0, fetchBatch: executor() })
  assert.ok(!result.pages.some(p => p.title === 'iCloud'), 'conta única não vira página')
  assert.equal(result.pages.find(p => p.title === 'Notas')!.parentId, result.rootId)
  assert.match(result.pages[0].title, /^Imported from Apple Notes/)
  const controller = new AbortController()
  const slow = async (folderId: string, offset: number) => { controller.abort(); return executor()(folderId, offset) }
  await assert.rejects(() => buildAppleNotesImport(planAppleImport(listing, defaultSelection(listing)), { locale: 'pt-BR', fetchBatch: slow, signal: controller.signal }), { name: 'AbortError' })
  const denied = async () => { throw new Error("Error invoking remote method 'np:appleNotesBatch': Error: APPLE_NOTES_DENIED: O macOS negou o acesso") }
  await assert.rejects(() => buildAppleNotesImport(single, { locale: 'pt-BR', fetchBatch: denied }), /APPLE_NOTES_DENIED/)
  assert.equal(appleErrorCode(new Error('x APPLE_NOTES_DENIED: y')), 'denied'); assert.equal(appleErrorCode(new Error('APPLE_NOTES_TIMEOUT')), 'timeout')
  assert.equal(appleErrorCode(Object.assign(new Error('c'), { name: 'AbortError' })), 'aborted'); assert.equal(appleErrorCode(new Error('boom')), 'failed')
  // lote ilegível: pula com aviso e segue
  const flaky = async (folderId: string, offset: number) => folderId === P11 ? 'lixo' : executor()(folderId, offset)
  const partial = await buildAppleNotesImport(single, { locale: 'pt-BR', fetchBatch: flaky })
  assert.ok(partial.warnings.some(w => (w.code as string) === 'apple-batch-failed')); assert.ok(partial.pages.some(p => p.title === 'Lista de compras'))
})
