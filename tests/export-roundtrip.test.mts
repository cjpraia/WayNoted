import COMPAT from '../shared/compatibility.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExportPackage } from '../src/export/package.ts'
import { packageToBackup, findPackageRoot } from '../src/export/importPackage.ts'
import { normalizeBlocks, normalizePage } from '../src/export/normalize.ts'
import { blocksToMarkdown } from '../src/export/markdown.ts'
import { markdownToBlocks } from '../src/export/parseMarkdown.ts'
import { parseFrontMatter, stringifyFrontMatter, yamlMap } from '../src/export/frontMatter.ts'
import { validateBackup } from '../src/workspace.ts'
import type { ExportSource } from '../src/export/model.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=='
const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCg=='
const A = id(1), B = id(2), D = id(3), R1 = id(4), R2 = id(5), D2 = id(6), T1 = id(7), RS = id(8), TRASH = id(9), LINKED = id(10)
const P = { title: 'p-title', status: 'p-status', tags: 'p-tags', due: 'p-due', points: 'p-points', done: 'p-done', rel: 'p-rel', formula: 'p-formula', rollup: 'p-rollup', files: 'p-files', rich: 'p-rich', created: 'p-created' }

function page(pid: string, parentId: string | null, title: string, extra: Record<string, unknown> = {}) {
  return { id: pid, parentId, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000,
    order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', createdBy: 'Ana', updatedBy: 'Bia', ...extra }
}
const txt = (text: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text, styles })

function richSource(): ExportSource {
  const view = { id: 'v1', name: 'Tabela', type: 'table', filters: [{ id: 'f1', propertyId: P.points, op: 'gt', value: 1 }], sorts: [{ propertyId: P.due, direction: 'desc' }], hidden: [P.files], widths: { [P.title]: 240 }, filterTree: { kind: 'group', operator: 'and', children: [{ kind: 'rule', filterId: 'f1' }] } }
  const board = { id: 'v2', name: 'Quadro', type: 'board', filters: [], sorts: [], hidden: [], widths: {}, groupBy: P.status }
  const database = {
    properties: [
      { id: P.title, name: 'Nome', type: 'title' },
      { id: P.status, name: 'Status', type: 'status', options: [{ id: 'o1', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'o2', name: 'Feito', color: 'green', group: 'complete' }] },
      { id: P.tags, name: 'Tags: área', type: 'multiSelect', options: [{ id: 't1', name: 'Casa', color: 'blue' }, { id: 't2', name: 'Trabalho', color: 'red', customColor: '#aa0000' }] },
      { id: P.due, name: 'Prazo', type: 'date', dateFormat: 'short' },
      { id: P.points, name: 'Pontos', type: 'number', numberFormat: 'currency', currency: 'BRL' },
      { id: P.done, name: 'Ok', type: 'checkbox' },
      { id: P.rel, name: 'Tarefas', type: 'relation', relationDatabaseId: D2 },
      { id: P.formula, name: 'Dobro', type: 'formula', formula: 'prop("Pontos") * 2' },
      { id: P.rollup, name: 'Qtd', type: 'rollup', rollup: { relationPropertyId: P.rel, targetPropertyId: 'q-title', aggregation: 'count' } },
      { id: P.files, name: 'Anexos', type: 'files' },
      { id: P.rich, name: 'Notas', type: 'text' },
      { id: P.created, name: 'Criado', type: 'createdTime' },
    ],
    views: [view, board], activeViewId: 'v1', recurrenceOnComplete: 'copy', recurrenceDoneProperty: P.status,
    templates: [{ id: 'tpl', name: 'Modelo', title: 'Nova', props: { [P.done]: true }, bodyBlocks: [{ id: 'tb', type: 'paragraph', content: [txt('corpo do modelo')], children: [] }] }],
  }
  const pages: Record<string, unknown> = {
    [A]: page(A, null, 'Projeto: Alfa/Beta', { icon: '🚀', cover: PNG, coverPosition: 30, favorite: true, fullWidth: true, font: 'serif', order: 0 }),
    [B]: page(B, A, 'Notas da reunião', { icon: PNG, order: 0, blockOwnerId: A, comments: [{ id: 'c1', body: 'Revisar', createdAt: 1, updatedAt: 2, author: 'Ana', resolved: false, blockId: 'b-anchor' }] }),
    [T1]: page(T1, A, 'Notas da reunião', { order: 1 }),
    [D]: page(D, null, 'Tarefas', { order: 1, database }),
    [R1]: page(R1, D, 'Comprar pão', { order: 0, sequence: 1, props: { [P.status]: 'o2', [P.tags]: ['t1', 't2'], [P.due]: { start: '2026-10-08', startTime: '09:00', repeat: 'weekly', recurrence: { interval: 2, weekdays: [1, 3], until: '2027-01-01' }, reminder: 30, completions: [1_700_000_000_000], completedCount: 1 }, [P.points]: 3.5, [P.done]: true, [P.rel]: [id(20)], [P.files]: [{ id: 'f1', name: 'nota.pdf', mimeType: 'application/pdf', data: PDF, size: 15 }], [P.rich]: { type: 'richText', runs: [{ text: 'olá ', bold: true }, { text: 'mundo' }] } } }),
    [R2]: page(R2, D, 'Ligar', { order: 1, sequence: 2, props: { [P.status]: 'o1', [P.points]: 1 }, subitemParentId: R1, dependencyIds: [R1] }),
    [RS]: page(RS, R1, 'Subpágina da linha', { order: 0 }),
    [D2]: page(D2, null, 'Lista', { order: 2, database: { properties: [{ id: 'q-title', name: 'Nome', type: 'title' }], views: [{ id: 'w1', name: 'T', type: 'list', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'w1' } }),
    [id(20)]: page(id(20), D2, 'Item relacionado', { order: 0 }),
    [LINKED]: page(LINKED, A, 'Visão vinculada', { order: 2, database: { properties: [], views: [{ id: 'lv', name: 'Board', type: 'board', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'lv', linkedSourceId: D } }),
    [TRASH]: page(TRASH, null, 'Lixo', { trashed: true, trashedAt: 5, order: 9 }),
  }
  const docA = [
    { id: 'h1', type: 'heading', props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [txt('Título # um')], children: [] },
    { id: 'h3', type: 'heading', props: { level: 3, isToggleable: true }, content: [txt('Seção dobrável')], children: [{ id: 'h3c', type: 'paragraph', props: {}, content: [txt('dentro')], children: [] }] },
    { id: 'p1', type: 'paragraph', props: { textAlignment: 'center', backgroundColor: 'yellow' }, content: [txt('  Negrito', { bold: true }), txt(' itálico', { italic: true }), txt(' sub', { underline: true }), txt(' risco', { strike: true }), txt(' code`x', { code: true }), txt(' vermelho', { textColor: 'red', backgroundColor: 'blue' }), txt(' *literal* _x_ [a] | $5 <tag> &amp; 2\nlinha nova  ')], children: [] },
    { id: 'p2', type: 'paragraph', props: {}, content: [txt('Veja '), { type: 'link', href: `workspace://page/${B}#block=b-anchor`, content: [txt('a reunião', { bold: true })] }, txt(', '), { type: 'link', href: 'https://example.com/a b?(x)', content: [txt('site')] }, txt(' e '), { type: 'inlineEquation', props: { id: 'eq1', latex: 'e^{i\\pi}+1=0' } }, txt(' em '), { type: 'dateMention', props: { id: 'dm1', date: '2026-10-10', pageId: '' } }], children: [] },
    { id: 'p3', type: 'paragraph', props: {}, content: [txt('# não é título')], children: [] },
    { id: 'p4', type: 'paragraph', props: {}, content: [txt('1. não é lista')], children: [] },
    { id: 'empty', type: 'paragraph', props: {}, content: [], children: [] },
    { id: 'l1', type: 'bulletListItem', props: {}, content: [txt('um')], children: [{ id: 'l1a', type: 'bulletListItem', props: {}, content: [txt('um.a')], children: [{ id: 'l1b', type: 'numberedListItem', props: {}, content: [txt('fundo')], children: [] }] }] },
    { id: 'l2', type: 'bulletListItem', props: {}, content: [txt('dois')], children: [{ id: 'l2p', type: 'paragraph', props: {}, content: [txt('parágrafo filho')], children: [] }] },
    { id: 'n1', type: 'numberedListItem', props: { start: 3 }, content: [txt('três')], children: [] },
    { id: 'n2', type: 'numberedListItem', props: {}, content: [txt('quatro')], children: [] },
    { id: 'c1', type: 'checkListItem', props: { checked: true }, content: [txt('feito')], children: [] },
    { id: 'c2', type: 'checkListItem', props: { checked: false }, content: [txt('pendente')], children: [] },
    { id: 't1', type: 'toggleListItem', props: {}, content: [txt('Mais')], children: [{ id: 't1a', type: 'paragraph', props: {}, content: [txt('escondido')], children: [] }, { id: 't1b', type: 'toggleListItem', props: {}, content: [txt('aninhado')], children: [{ id: 't1c', type: 'checkListItem', props: { checked: false }, content: [txt('x')], children: [] }] }] },
    { id: 'q1', type: 'quote', props: {}, content: [txt('citação\nduas linhas')], children: [] },
    { id: 'co', type: 'callout', props: { icon: '⚠️', backgroundColor: 'red' }, content: [txt('Atenção')], children: [{ id: 'coc', type: 'bulletListItem', props: {}, content: [txt('detalhe')], children: [] }] },
    { id: 'code', type: 'codeBlock', props: { language: 'typescript' }, content: [txt('const a = 1\n```\n  indent')], children: [] },
    { id: 'code2', type: 'codeBlock', props: { language: 'text' }, content: [txt('plain')], children: [] },
    { id: 'div', type: 'divider', props: {}, children: [] },
    { id: 'tab', type: 'table', props: { textColor: 'default' }, content: { type: 'tableContent', columnWidths: [120, undefined], headerRows: 1, rows: [{ cells: [{ type: 'tableCell', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1 }, content: [txt('Col | A')] }, { type: 'tableCell', props: { backgroundColor: 'green' }, content: [txt('B', { bold: true })] }] }, { cells: [{ type: 'tableCell', props: {}, content: [] }, { type: 'tableCell', props: {}, content: [txt('2')] }] }] }, children: [] },
    { id: 'img', type: 'image', props: { url: PNG, name: 'foto [1].png', caption: 'Legenda', previewWidth: 320, showPreview: true }, children: [] },
    { id: 'img2', type: 'image', props: { url: 'https://example.com/x.png', name: '' }, children: [] },
    { id: 'file', type: 'file', props: { url: PDF, name: 'doc.pdf', caption: '' }, children: [] },
    { id: 'att', type: 'localAttachment', props: { data: PDF, name: 'anexo.pdf', size: 15 }, children: [] },
    { id: 'eq', type: 'equation', props: { latex: '\\int_0^1 x\\,dx\n= \\frac12' }, children: [] },
    { id: 'cols', type: 'columnList', props: {}, children: [
      { id: 'col1', type: 'column', props: { width: 1.5 }, children: [{ id: 'cp1', type: 'paragraph', props: {}, content: [txt('esquerda')], children: [] }] },
      { id: 'col2', type: 'column', props: { width: 0.5 }, children: [{ id: 'cp2', type: 'heading', props: { level: 2 }, content: [txt('direita')], children: [] }, { id: 'cp3', type: 'columnList', props: {}, children: [{ id: 'cc1', type: 'column', props: {}, children: [{ id: 'cc1p', type: 'paragraph', props: {}, content: [txt('interna')], children: [] }] }] }] },
    ] },
    { id: 'pg', type: 'page', props: { pageId: B, ownership: 'auto', display: 'inline' }, children: [] },
    { id: 'pgl', type: 'page', props: { pageId: LINKED, ownership: 'auto', display: 'inline' }, children: [] },
    { id: 'sy', type: 'syncedBlock', props: { syncedId: 'sync-1' }, children: [] },
    { id: 'bm', type: 'bookmark', props: { url: 'https://example.com', title: 'Exemplo', description: 'Desc', image: '' }, children: [] },
    { id: 'btn', type: 'localButton', props: { label: 'Abrir', targetPageId: B, actionsJson: JSON.stringify([{ kind: 'openPage', targetPageId: B }]) }, children: [] },
    { id: 'tabs', type: 'tabs', props: { tabsJson: JSON.stringify([{ title: 'Um', body: '# texto' }, { title: 'Dois', body: 'b' }]) }, children: [] },
    { id: 'toc', type: 'tableOfContents', props: {}, children: [] },
    { id: 'mm', type: 'mermaid', props: { source: 'flowchart LR\nA-->B' }, children: [] },
  ]
  const docB = [{ id: 'b-anchor', type: 'paragraph', props: {}, content: [txt('Âncora'), { type: 'link', href: `workspace://page/${A}`, content: [txt('voltar')] }, txt(' fora '), { type: 'link', href: `workspace://page/${TRASH}`, content: [txt('lixo')] }], children: [] }]
  return {
    pages: pages as never,
    documents: { [A]: docA, [B]: docB, [T1]: [], [D]: [{ id: 'dd', type: 'paragraph', props: {}, content: [txt('Descrição do banco')], children: [] }], [R1]: [{ id: 'r1', type: 'checkListItem', props: { checked: false }, content: [txt('trigo')], children: [] }], [R2]: [], [RS]: [{ id: 'rs', type: 'paragraph', props: {}, content: [txt('sub')], children: [] }], [D2]: [], [id(20)]: [], [LINKED]: [], [TRASH]: [] },
    syncedBlocks: { 'sync-1': { id: 'sync-1', sourcePageId: A, updatedAt: 42, blocks: [{ id: 's1', type: 'paragraph', props: {}, content: [txt('sincronizado '), { type: 'link', href: `workspace://page/${R1}`, content: [txt('linha')] }], children: [] }] } },
    workspaceName: 'Meu espaço', locale: 'pt-BR',
  }
}

const bytes = (files: Record<string, string | Uint8Array>) => Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? new TextEncoder().encode(value) : value]))
const read = (files: Record<string, string | Uint8Array>, path: string) => { const value = files[path]; assert.ok(value !== undefined, `missing ${path}`); return typeof value === 'string' ? value : new TextDecoder().decode(value) }

test('front-matter round-trips scalars, quoted keys and nested maps', () => {
  const text = stringifyFrontMatter([['id', 'abc'], ['title', 'Projeto: "x"'], ['date', '2026-10-08'], ['n', 3], ['ok', true], ['nil', null], ['properties', yamlMap({ 'Tags: área': ['a', 'b'], Status: 'Feito', yes: 'no' })], ['props', { a: [1, { b: 'c' }] }]])
  const { data, body } = parseFrontMatter(text + '\n\n# Corpo')
  assert.equal(body.trim(), '# Corpo')
  assert.deepEqual(data, { id: 'abc', title: 'Projeto: "x"', date: '2026-10-08', n: 3, ok: true, nil: null, properties: { 'Tags: área': ['a', 'b'], Status: 'Feito', yes: 'no' }, props: { a: [1, { b: 'c' }] } })
})

test('markdown writer/reader is lossless for every block shape in a rich page', () => {
  const source = richSource()
  const ctx = { href: (h: string) => h, media: (u: string) => u, json: <T,>(v: T) => v, pageLink: (pid: string) => ({ label: 'x', destination: `workspace://page/${pid}` }), synced: () => undefined, keepIds: new Set(['b-anchor']) }
  const markdown = blocksToMarkdown(source.documents[A], ctx)
  const back = markdownToBlocks(markdown, { href: (h) => h, media: (u) => u, json: (v) => v })
  const got = normalizeBlocks(back), want = normalizeBlocks(source.documents[A])
  assert.equal(got.length, want.length)
  want.forEach((block, index) => assert.equal(JSON.stringify(got[index]), JSON.stringify(block)))
  assert.match(markdown, /^> \[!note\] ⚠️$/m)
  assert.match(markdown, /^<details>$/m)
  assert.match(markdown, /^- \[x\] feito$/m)
  assert.match(markdown, /^\$\$$/m)
  assert.match(markdown, /^`{3,}typescript$/m)
  assert.match(markdown, /^\| Col \\\| A \| \*\*B\*\* \|$/m)
  assert.match(markdown, /^3\. três$/m)
  assert.match(markdown, /\$e\^\{i\\pi\}\+1=0\$/)
})

test('workspace export → import into an empty space is structurally equivalent', async () => {
  const source = richSource()
  const progress: number[] = []
  const { files, manifest } = await buildExportPackage(source, { format: 'markdown', scope: 'workspace', includeFiles: true, onProgress: (done) => progress.push(done) })
  const paths = Object.keys(files).sort()
  // Hierarquia de pastas espelhando a árvore, bancos em pasta com index/CSV/schema.
  for (const expected of ['Projeto- Alfa-Beta.md', 'Projeto- Alfa-Beta/Notas da reunião.md', 'Projeto- Alfa-Beta/Notas da reunião (2).md', 'Projeto- Alfa-Beta/Visão vinculada/index.md', 'Tarefas/index.md', 'Tarefas/Tarefas.csv', 'Tarefas/schema.json', 'Tarefas/Comprar pão.md', 'Tarefas/Comprar pão/Subpágina da linha.md', 'Lista/index.md', "workspace-export.json"]) assert.ok(paths.includes(expected), `missing ${expected}`)
  assert.ok(!paths.some((path) => path.includes('Lixo')), 'trashed pages are not exported')
  assert.ok(paths.filter((path) => path.startsWith('assets/')).length >= 2, 'assets copied')
  assert.equal(progress.at(-1), manifest.pages.length)

  const pageA = read(files, 'Projeto- Alfa-Beta.md')
  assert.match(pageA, /^---\nid: "00000000-0000-4000-8000-000000000001"\n/)
  assert.match(pageA, /^favorite: true$/m)
  assert.match(pageA, /^cover: "asset:assets\/[0-9a-f]{8}-capa|^cover: "asset:assets\//m)
  assert.match(pageA, /\[\*\*a reunião\*\*\]\(Projeto-%20Alfa-Beta\/Notas%20da%20reuni%C3%A3o\.md#block=b-anchor\)|\[\*\*a reunião\*\*\]\(Projeto-%20Alfa-Beta\/Notas%20da%20reunião\.md#block=b-anchor\)/)
  assert.match(pageA, /!\[foto \\\[1\\\]\.png\]\(assets\//)
  const pageB = read(files, 'Projeto- Alfa-Beta/Notas da reunião.md')
  assert.match(pageB, /\]\(\.\.\/Projeto-%20Alfa-Beta\.md\)/)
  assert.match(pageB, new RegExp(`workspace:\\/\\/page\\/00000000-0000-4000-8000-000000000009`, ""))
  assert.match(pageB, /<!-- np:attrs \{"id":"b-anchor"\} -->/)
  assert.match(pageB, /^icon: "asset:\.\.\/assets\//m)

  const row = read(files, 'Tarefas/Comprar pão.md')
  assert.match(row, /^properties:$/m)
  assert.match(row, /^ {2}Status: Feito$/m)
  assert.match(row, /^ {2}"Tags: área": \["Casa","Trabalho"\]$/m)
  assert.match(row, /^ {2}Dobro: 7$/m)
  assert.match(row, /^ {2}Qtd: 1$/m)
  assert.match(row, /^ {2}Tarefas: \["Item relacionado"\]$/m)
  assert.match(row, /"recurrence":\{"interval":2,"weekdays":\[1,3\],"until":"2027-01-01"\}/)
  assert.match(row, /"data":"asset:\.\.\/assets\//)

  const csv = read(files, 'Tarefas/Tarefas.csv')
  assert.match(csv, new RegExp(`^﻿Nome,Status,Tags: área,Prazo,Pontos,Ok,Tarefas,Dobro,Qtd,Anexos,Notas,Criado,workspace_id\\r\\n`, ""))
  assert.match(csv, /Comprar pão,Feito,"Casa, Trabalho",2026-10-08 09:00,3.5,Sim,Item relacionado,7,1,nota.pdf,olá mundo,/)
  const schema = JSON.parse(read(files, 'Tarefas/schema.json'))
  assert.equal(schema.schema.properties.length, 12)
  assert.equal(schema.schema.recurrenceOnComplete, 'copy')
  assert.deepEqual(schema.formulas, [{ propertyId: P.formula, name: 'Dobro', formula: 'prop("Pontos") * 2' }])
  assert.equal(schema.relations[0].database.path, '../Lista/index.md')
  assert.equal(schema.rollups[0].aggregation, 'count')
  assert.deepEqual(schema.schema.views[0].filterTree, source.pages[D].database!.views[0].filterTree)
  const index = read(files, 'Tarefas/index.md')
  assert.match(index, /Descrição do banco/)
  assert.match(index, /\| \[Comprar pão\]\(Comprar%20p/)

  // Ida e volta: importar num espaço vazio.
  const backup = validateBackup(packageToBackup(bytes(files)))
  const liveIds = Object.keys(source.pages).filter((pid) => pid !== TRASH).sort()
  assert.deepEqual(Object.keys(backup.meta.pages).sort(), liveIds)
  for (const pid of liveIds) {
    assert.deepEqual(normalizePage(backup.meta.pages[pid]), normalizePage(source.pages[pid]), `page ${source.pages[pid].title}`)
    assert.deepEqual(normalizeBlocks(backup.documents[pid]), normalizeBlocks(source.documents[pid]), `document ${source.pages[pid].title}`)
  }
  assert.deepEqual(normalizeBlocks(backup.meta.syncedBlocks!['sync-1'].blocks), normalizeBlocks(source.syncedBlocks!['sync-1'].blocks))
  assert.equal(backup.meta.settings.workspaceName, 'Meu espaço')
})

test('import accepts a zipped folder with a root directory and hand-edited front-matter', async () => {
  const source = richSource()
  const { files } = await buildExportPackage(source, { format: 'markdown', scope: 'tree', pageId: D, includeFiles: false })
  assert.ok(Object.keys(files).every((path) => !path.startsWith('assets/')), 'files omitted when disabled')
  const wrapped = Object.fromEntries(Object.entries(bytes(files)).map(([path, value]) => [`Export/${path}`, value]))
  // Linha nova escrita à mão, sem id nem props: usa os nomes legíveis e o schema.json.
  wrapped['Export/Tarefas/Nova.md'] = new TextEncoder().encode('---\ntitle: Nova tarefa\nproperties:\n  Status: A fazer\n  Pontos: 4\n  Prazo: "2026-11-01"\n---\n\n# Nova tarefa\n\n- [ ] item\n')
  assert.equal(findPackageRoot(Object.keys(wrapped)), 'Export')
  const backup = validateBackup(packageToBackup(wrapped))
  const added = Object.values(backup.meta.pages).find((p) => p.title === 'Nova tarefa')!
  assert.equal(added.parentId, D)
  assert.deepEqual(added.props, { [P.status]: 'o1', [P.points]: 4, [P.due]: { start: '2026-11-01' } })
  assert.equal(backup.meta.pages[D].parentId, null)
  assert.deepEqual(backup.meta.pages[R1].props?.[P.files], [])
})

test('HTML export is self-contained, navigable and has no remote resources besides user links', async () => {
  const source = richSource()
  const { files } = await buildExportPackage(source, { format: 'html', scope: 'workspace', includeFiles: true })
  const html = read(files, 'Projeto- Alfa-Beta.html')
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<style>[\s\S]*prefers-color-scheme:dark/)
  assert.match(html, /href="Projeto-%20Alfa-Beta\/Notas%20da%20reuni[^"]*\.html#block=b-anchor"/)
  assert.match(html, /<math/)
  assert.match(html, /<details open><summary><h4>Seção dobrável<\/h4><\/summary>/)
  assert.match(html, /<img src="assets\//)
  assert.ok(!/<script/i.test(html), 'no scripts')
  assert.ok(!/<link /i.test(html), 'no external stylesheets')
  const index = read(files, 'index.html')
  assert.match(index, /href="Tarefas\/index\.html"/)
  const db = read(files, 'Tarefas/index.html')
  assert.match(db, /<span class="chip bg-green">Feito<\/span>/)
  assert.match(db, /href="\.\.\/index\.html"/)
})

test('single page scope exports only that page and keeps links to other pages as app links', async () => {
  const source = richSource()
  const { files } = await buildExportPackage(source, { format: 'markdown', scope: 'page', pageId: B, includeFiles: true })
  const pages = Object.keys(files).filter((path) => path.endsWith('.md'))
  assert.deepEqual(pages, ['Notas da reunião.md'])
  assert.match(read(files, 'Notas da reunião.md'), new RegExp(`\\]\\(workspace:\\/\\/page\\/00000000-0000-4000-8000-000000000001\\)`, ""))
})

test('object types: front-matter tipos/campos, types.json and lossless re-import; locked values never exported', async () => {
  const BOOK = 'type-book', MEDIA = 'type-media'
  const objectTypes = [
    { id: MEDIA, name: 'Mídia', icon: '🎞️', color: 'gray', description: '', properties: [{ id: 'f-year', name: 'Ano', type: 'number' }], template: {}, createdAt: 1, updatedAt: 1 },
    { id: BOOK, name: 'Livro', icon: '📚', color: 'brown', description: 'Leituras', parentTypes: [MEDIA], titleTemplate: 'Livro {n}',
      properties: [{ id: 'f-author', name: 'Autor', type: 'text' }, { id: 'f-status', name: 'Status de leitura', type: 'status', options: [{ id: 's1', name: 'Lendo', color: 'blue', group: 'progress' }, { id: 's2', name: 'Lido', color: 'green', group: 'complete' }] }, { id: 'f-genre', name: 'Gênero', type: 'multiSelect', options: [{ id: 'g1', name: 'Ficção', color: 'purple' }] }, { id: 'f-done', name: 'Terminado', type: 'date' }],
      template: { blocks: [{ type: 'heading', props: { level: 2 }, content: [txt('Resumo')] }], values: { 'f-status': 's1' } }, createdAt: 1, updatedAt: 2 },
  ]
  const P1 = id(31), P2 = id(32), P3 = id(33)
  const source: ExportSource = {
    pages: {
      [P1]: page(P1, null, 'Duna', { order: 0, types: [BOOK], typeProps: { 'f-author': 'Frank Herbert', 'f-status': 's2', 'f-genre': ['g1'], 'f-done': { start: '2026-01-05' }, 'f-year': 1965 } }) as never,
      [P2]: page(P2, null, 'Notas soltas', { order: 1 }) as never,
      [P3]: page(P3, null, 'Diário secreto', { order: 2, types: [BOOK], typeProps: { 'f-author': 'segredo' }, passwordLock: { rootId: P3, hideTitle: false } }) as never,
    },
    documents: { [P1]: [{ id: 'p1', type: 'paragraph', props: {}, content: [txt('Clássico')], children: [] }], [P2]: [], [P3]: [] },
    objectTypes: objectTypes as never, workspaceName: 'Tipos', locale: 'pt-BR',
  }
  const { withoutLockedPages } = await import('../src/security/pageLock.ts')
  const { files } = await buildExportPackage({ ...source, pages: withoutLockedPages(source.pages) }, { format: 'markdown', scope: 'workspace', includeFiles: true })
  const duna = read(files, 'Duna.md')
  assert.match(duna, /^tipos: \["Livro"\]$/m)
  assert.match(duna, /^campos:$/m)
  assert.match(duna, /^ {2}Autor: Frank Herbert$/m)
  assert.match(duna, /^ {2}"Status de leitura": Lido$/m)
  assert.match(duna, /^ {2}Ano: 1965$/m)
  assert.match(duna, /^type_ids: \["type-book"\]$/m)
  assert.ok(!Object.values(files).some((value) => typeof value === 'string' && value.includes('segredo')), 'locked page values are not exported')
  const types = JSON.parse(read(files, 'types.json'))
  assert.equal(types.format, COMPAT.record047)
  assert.deepEqual(types.types.map((type: { id: string }) => type.id).sort(), [BOOK, MEDIA].sort())

  const backup = validateBackup(packageToBackup(bytes(files)))
  assert.deepEqual(backup.meta.settings.objectTypes, objectTypes)
  assert.deepEqual(backup.meta.pages[P1].types, [BOOK])
  assert.deepEqual(backup.meta.pages[P1].typeProps, source.pages[P1].typeProps)
  assert.equal(backup.meta.pages[P2].types, undefined)
  assert.deepEqual(normalizePage(backup.meta.pages[P1]), normalizePage(source.pages[P1]))

  // Markdown escrito à mão: só `tipos` e `campos` legíveis.
  const hand = { ...bytes(files), 'Hamlet.md': new TextEncoder().encode('---\ntitle: Hamlet\ntipos: ["Livro"]\ncampos:\n  Autor: Shakespeare\n  "Status de leitura": Lendo\n  Ano: 1603\n---\n\n# Hamlet\n') }
  const fromHand = Object.values(validateBackup(packageToBackup(hand)).meta.pages).find((p) => p.title === 'Hamlet')!
  assert.deepEqual(fromHand.types, [BOOK])
  assert.deepEqual(fromHand.typeProps, { 'f-author': 'Shakespeare', 'f-status': 's1', 'f-year': 1603 })
})

test('canvas boards: lossless Markdown package round-trip, readable list and static SVG in HTML', async () => {
  const { readCanvasDocument, canvasDocument } = await import('../src/canvas/model.ts')
  const source = richSource()
  const CV = id(30)
  source.pages[CV] = page(CV, null, 'Quadro de ideias', { order: 5, canvas: { version: 1 }, text: 'Ideia principal' }) as never
  const data = { version: 1, grid: true, snap: false, objects: [
    { id: 'n1', type: 'note', x: 0, y: 0, w: 200, h: 200, text: 'Ideia principal\n<b>sem html</b>', color: 'pink', rotation: 4 },
    { id: 'c1', type: 'page', x: 300, y: 0, w: 340, h: 260, pageId: A },
    { id: 'c2', type: 'database', x: 700, y: 0, w: 600, h: 380, pageId: D, locked: true },
    { id: 'k1', type: 'connector', from: { id: 'n1', x: 200, y: 100 }, to: { id: 'c1', x: 300, y: 130 }, route: 'orthogonal', color: 'blue', dashed: true, label: 'leva a', endArrow: true, startArrow: true },
    { id: 'img', type: 'image', x: 0, y: 400, w: 64, h: 64, src: PNG, name: 'foto.png', groupId: 'g1' },
    { id: 'f1', type: 'file', x: 100, y: 400, w: 240, h: 64, data: PDF, name: 'anexo.pdf', size: 15, mime: 'application/pdf', groupId: 'g1' },
    { id: 'd1', type: 'draw', x: 10, y: 600, w: 40, h: 20, points: [0, 0, 0.5, 40, 20, 0.7], color: 'red', size: 4 },
    { id: 's1', type: 'section', x: -40, y: -40, w: 1400, h: 760, title: 'Seção A', color: 'blue' },
    { id: 'sh', type: 'shape', shape: 'diamond', x: 400, y: 400, w: 160, h: 100, text: 'Decidir?', color: 'green', fill: 'solid' },
    { id: 't1', type: 'text', x: 0, y: 700, w: 300, h: 40, text: 'Título grande', color: 'default', fontSize: 32, align: 'center' },
  ] }
  source.documents[CV] = canvasDocument(data as never, 'blk-canvas')
  const { files } = await buildExportPackage(source, { format: 'markdown', scope: 'workspace', includeFiles: true })
  const md = read(files, 'Quadro de ideias.md')
  assert.match(md, /<!-- np:block \{"type":"canvas"/)
  assert.match(md, /^- \[🚀 Projeto: Alfa\/Beta\]\(Projeto-%20Alfa-Beta\.md\)$/m, 'cards are readable links')
  assert.match(md, /^- Ideia principal/m)
  assert.match(md, /"src":"asset:assets\//, 'images go to assets/')
  assert.match(md, /canvas: \{"version":1\}|"canvas":\{"version":1\}/)
  const backup = validateBackup(packageToBackup(bytes(files)))
  assert.deepEqual(backup.meta.pages[CV].canvas, { version: 1 })
  assert.deepEqual(normalizePage(backup.meta.pages[CV]), normalizePage(source.pages[CV]))
  const back = readCanvasDocument(backup.documents[CV])
  assert.deepEqual(back.data, readCanvasDocument(source.documents[CV]).data, 'every object, style and setting survives')
  assert.equal(back.repaired, 0)

  const html = await buildExportPackage(source, { format: 'html', scope: 'workspace', includeFiles: true })
  const htmlPage = read(html.files, 'Quadro de ideias.html')
  assert.match(htmlPage, /<figure class="canvas"[^>]*><svg/)
  assert.match(htmlPage, /<a href="Projeto-%20Alfa-Beta\.html">/, 'cards link to exported pages')
  assert.ok(!htmlPage.includes('<b>sem html</b>'), 'note text is escaped')
  assert.ok(!/href="data:image/.test(htmlPage), 'images reference assets, not inline data')
})
