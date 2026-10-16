import PRODUCT from '../shared/product.json' with { type: 'json' }
import COMPAT from '../shared/compatibility.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, stat, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mirrorablePages, planMirror, buildMirrorFiles, keepIdsOf, MIRROR_VERSION } from '../src/mirror/build.ts'
import { mirrorSkipSource } from '../src/mirror/skip.ts'
import { parseFrontMatter } from '../src/export/frontMatter.ts'

const require = createRequire(import.meta.url)
const mirror = require('../electron/mirror.cjs')

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=='
const txt = (text: string) => ({ type: 'text', text, styles: {} })
const para = (text: string) => ({ id: `b${Math.random().toString(36).slice(2, 8)}`, type: 'paragraph', props: {}, content: [txt(text)], children: [] })
function page(pid: string, parentId: string | null, title: string, extra: Record<string, unknown> = {}) {
  return { id: pid, parentId, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000,
    order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra } as never
}
const base = { locale: 'pt-BR' as const, workspaceName: 'Meu espaço', objectTypes: [] as never[] }
async function build(pages: Record<string, never>, documents: Record<string, unknown[]>, prev = null as never, force = false) {
  const plan = planMirror({ pages, ...base, prev, force })
  const files = await buildMirrorFiles({ plan, documents, ...base })
  return { plan, files }
}
const payloadOf = (plan: ReturnType<typeof planMirror>, files: Record<string, string | Uint8Array>, extra: Record<string, unknown> = {}) => ({
  workspaceName: 'Meu espaço', locale: 'pt-BR', files, version: MIRROR_VERSION, globalSig: plan.globalSig, complete: plan.complete, force: false,
  pages: Object.fromEntries(Object.entries(plan.pages).map(([k, v]) => [k, { sig: v.sig, files: v.files }])), ...extra,
})
const A = id(1), B = id(2), C = id(3), P = id(4), PC = id(5), S = id(6), T = id(7), DB = id(8), R1 = id(9), W = id(10)
function sample() {
  const pages: Record<string, never> = {
    [A]: page(A, null, 'Projeto: Alfa/Beta?', { icon: '🚀' }),
    [B]: page(B, A, 'Notas', { order: 0 }),
    [C]: page(C, A, 'Notas', { order: 1 }), // título colidente
    [P]: page(P, null, 'Segredo de senha', { order: 1, passwordLock: { rootId: P, unlocked: true } }),
    [PC]: page(PC, P, 'Filha do segredo', { order: 0 }),
    [S]: page(S, null, 'Não espelhar', { order: 2, mirrorSkip: true }),
    [T]: page(T, null, 'Lixo', { order: 3, trashed: true }),
    [DB]: page(DB, null, 'Tarefas', { order: 4, database: { properties: [{ id: 'pt', name: 'Nome', type: 'title' }, { id: 'ps', name: 'Status', type: 'text' }], views: [{ id: 'v', name: 'T', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v' } }),
    [R1]: page(R1, DB, 'Comprar pão', { props: { ps: 'ok' } }),
    [W]: page(W, null, 'Lousa', { order: 5, canvas: { v: 1 } }),
  }
  const documents: Record<string, unknown[]> = {
    [A]: [para('Texto de Alfa'), { id: 'img', type: 'image', props: { url: PNG, name: 'foto.png' }, content: [], children: [] }, { id: 'img2', type: 'image', props: { url: PNG, name: 'foto.png' }, content: [], children: [] }, { id: 'lk', type: 'paragraph', props: {}, content: [txt('ver '), { type: 'link', href: `workspace://page/${B}`, content: [txt('Notas')] }, txt(' e '), { type: 'link', href: `workspace://page/${P}`, content: [txt('segredo')] }], children: [] }],
    [B]: [para('Conteúdo B')], [C]: [para('Conteúdo C')], [P]: [para('SEGREDO-ABSOLUTO')], [PC]: [para('SEGREDO-FILHA')], [S]: [para('NAO-ESPELHAR')], [T]: [para('LIXO-CONTEUDO')],
    [DB]: [], [R1]: [para('linha')], [W]: [{ id: 'cv', type: 'canvas', props: { objects: [{ id: 'n1', type: 'note', x: 0, y: 0, w: 120, h: 80, text: 'nota da lousa', color: 'yellow' }] }, content: [], children: [] }],
  }
  return { pages, documents }
}
const walk = async (dir: string, rel = ''): Promise<string[]> => {
  const out: string[] = []
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...await walk(dir, r)); else out.push(r)
  }
  return out.sort()
}
const textOf = (files: Record<string, string | Uint8Array>) => Object.entries(files).filter(([, v]) => typeof v === 'string').map(([, v]) => v).join('\n')

test('conversão fiel: front-matter, links relativos, mídia deduplicada, banco com tabela + CSV, lousa com SVG', async () => {
  const { pages, documents } = sample()
  const { plan, files } = await build(pages, documents)
  const nodeA = plan.layout.nodes.get(A)!
  assert.match(nodeA.file, /^Projeto- Alfa-Beta-?--00000000\.md$/)
  const fm = parseFrontMatter(files[nodeA.file] as string).data as Record<string, unknown>
  assert.equal(fm.id, A); assert.equal(fm.title, 'Projeto: Alfa/Beta?')
  const body = files[nodeA.file] as string
  const nodeB = plan.layout.nodes.get(B)!
  assert.ok(body.includes(`(${encodeURI(nodeB.file.replace(/^[^/]+\//, ''))}`) || body.includes('Notas--'), 'link relativo para a subpágina')
  assert.ok(!body.includes('workspace://page/' + B), 'link interno resolvido')
  const assets = Object.keys(files).filter(f => f.startsWith('assets/'))
  assert.equal(assets.length, 1, 'mesma imagem em dois blocos = um arquivo')
  const db = plan.layout.nodes.get(DB)!
  assert.ok(files[db.file] && (files[db.file] as string).includes('Comprar pão'), 'tabela no .md do banco')
  assert.ok(Object.keys(files).some(f => f.endsWith('.csv')), 'CSV ao lado')
  const w = plan.layout.nodes.get(W)!
  assert.ok(files[w.file.replace(/\.md$/, '.svg')], 'lousa exportada como SVG')
  assert.ok(!("workspace-export.json" in files), 'sem manifesto com data')
})

test('nomes colidentes e caracteres inválidos ficam estáveis e únicos (título + id curto)', async () => {
  const { pages, documents } = sample()
  const a = planMirror({ pages, ...base, prev: null }), b = planMirror({ pages: Object.fromEntries(Object.entries(pages).reverse()) as never, ...base, prev: null })
  assert.notEqual(a.pages[B].file, a.pages[C].file)
  assert.equal(a.pages[B].file, b.pages[B].file, 'não depende da ordem de entrada')
  for (const p of Object.values(a.pages)) assert.ok(!/[:*?"<>|\\]/.test(p.file.replace(/\//g, '')), p.file)
  void documents
})

test('páginas protegidas, "Não espelhar", lixeira e blocos sincronizados delas nunca aparecem', async () => {
  const { pages, documents } = sample()
  const m = mirrorablePages(pages)
  assert.equal(m.excluded.get(P), 'protected'); assert.equal(m.excluded.get(PC), 'protected'); assert.equal(m.excluded.get(S), 'skipped')
  assert.ok(!m.pages[T]); assert.ok(m.pages[A])
  const syncedBlocks = { sb: { id: 'sb', sourcePageId: P, blocks: [para('SYNC-SEGREDO')], updatedAt: 1 } }
  const docs = { ...documents, [A]: [...documents[A], { id: 'sync', type: 'syncedBlock', props: { syncedId: 'sb', id: 'sb' }, content: [], children: [] }] }
  const plan = planMirror({ pages, ...base, prev: null, syncedBlocks: syncedBlocks as never })
  const files = await buildMirrorFiles({ plan, documents: docs, ...base, syncedBlocks: syncedBlocks as never })
  const all = textOf(files) + Object.keys(files).join('\n')
  for (const secret of ['SEGREDO-ABSOLUTO', 'SEGREDO-FILHA', 'NAO-ESPELHAR', 'LIXO-CONTEUDO', 'SYNC-SEGREDO', 'Segredo de senha', 'Filha do segredo']) assert.ok(!all.includes(secret), secret)
  assert.equal(mirrorSkipSource(pages as never, S), S)
  assert.equal(mirrorSkipSource({ ...pages, [A]: { ...pages[A], mirrorSkip: true } } as never, B), A, 'herdado pelas subpáginas')
})

test('incremental: só reescreve o que mudou; renomear regera tudo; excluir remove', async () => {
  const { pages, documents } = sample()
  const first = await build(pages, documents)
  assert.equal(first.plan.dirty.size, Object.keys(first.plan.pages).length)
  const prev = { version: MIRROR_VERSION, globalSig: first.plan.globalSig, pages: Object.fromEntries(Object.entries(first.plan.pages).map(([k, v]) => [k, { sig: v.sig, files: v.files }])) }
  const same = planMirror({ pages, ...base, prev })
  assert.equal(same.dirty.size, 0)
  const edited = { ...pages, [B]: { ...pages[B], title: 'Notas', text: 'novo', updatedAt: 1_800_000_000_000 } } as never
  const inc = planMirror({ pages: edited, ...base, prev })
  assert.deepEqual([...inc.dirty], [B])
  const row = { ...pages, [R1]: { ...pages[R1], props: { ps: 'feito' }, updatedAt: 9 } } as never
  const rowPlan = planMirror({ pages: row, ...base, prev })
  assert.deepEqual([...rowPlan.dirty].sort(), [DB, R1].sort(), 'o banco entra junto com a linha')
  const renamed = planMirror({ pages: { ...pages, [B]: { ...pages[B], title: 'Outro nome' } } as never, ...base, prev })
  assert.equal(renamed.dirty.size, Object.keys(renamed.pages).length, 'links podem apontar para o novo nome')
  const { [C]: _gone, ...rest } = pages
  const removed = planMirror({ pages: rest as never, ...base, prev })
  assert.deepEqual(removed.removed, [C])
  const forced = planMirror({ pages, ...base, prev, force: true })
  assert.equal(forced.dirty.size, Object.keys(forced.pages).length)
})

test('gravação nativa: incremental, remoção para _removidas, LEIA-ME, estado fora da pasta, atomicidade', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const userData = path.join(work, 'userData'), root = path.join(work, 'Espelho')
    const { pages, documents } = sample()
    const first = await build(pages, documents)
    const r1 = await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'Meu espaço', payload: payloadOf(first.plan, first.files) })
    assert.ok(r1.written > 5)
    const tree = await walk(root)
    assert.ok(tree.includes('LEIA-ME.md') && tree.includes(COMPAT.record012))
    assert.ok(tree.every(f => !f.includes('userData')))
    assert.ok(!(await walk(userData)).some(f => f.endsWith('.md')), 'estado fica fora da pasta espelhada, sem Markdown')
    assert.match(await readFile(path.join(root, 'LEIA-ME.md'), 'utf8'), /somente leitura/)
    // mesma entrada: nada é regravado
    const r2 = await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'Meu espaço', payload: payloadOf(first.plan, first.files) })
    assert.equal(r2.written, 0)
    // página removida: o arquivo sai da árvore e vai para _removidas/
    const { [C]: _c, ...rest } = pages
    const prev = { version: MIRROR_VERSION, globalSig: first.plan.globalSig, pages: payloadOf(first.plan, {}).pages }
    const second = planMirror({ pages: rest as never, ...base, prev })
    const files2 = await buildMirrorFiles({ plan: second, documents, ...base })
    const old = first.plan.pages[C].file
    const r3 = await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'Meu espaço', payload: payloadOf(second, files2, { complete: second.complete }) })
    assert.equal(r3.removed, 1)
    const after = await walk(root)
    const ws = (await readdir(root)).find(n => n.includes('--default'))!
    assert.ok(!after.includes(`${ws}/${old}`)); assert.ok(after.some(f => f.includes('_removidas/') && f.endsWith(path.basename(old))))
    // edição do usuário num arquivo gerado não é lida de volta
    const target = path.join(root, ws, second.pages[A].file)
    await writeFile(target, 'EDITADO')
    const state = await mirror.syncState(userData, 'default', root)
    assert.ok(state.pages[A])
    // falha no meio: arquivos já gravados continuam íntegros e não sobram temporários
    const edited = { ...rest, [A]: { ...rest[A], title: 'Alfa', updatedAt: 5 } } as never
    const third = planMirror({ pages: edited, ...base, prev: { version: MIRROR_VERSION, globalSig: second.globalSig, pages: payloadOf(second, {}).pages } })
    const files3 = await buildMirrorFiles({ plan: third, documents, ...base })
    await assert.rejects(mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'x', payload: payloadOf(third, files3, { force: true }), failAt: (_s: string, n: number) => { if (n >= 2) throw new Error('disco cheio') } }), /disco cheio/)
    assert.ok(!(await walk(root)).some(f => f.endsWith('.tmp')), 'sem temporários')
    assert.equal((await mirror.readState(userData, 'default')).pages[A].sig, second.pages[A].sig, 'estado antigo preservado após falha')
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('lotes inválidos: caminhos fora da pasta, reservados e conteúdo inesperado são recusados antes de gravar', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const userData = path.join(work, 'u'), root = path.join(work, 'E')
    for (const bad of ['../x.md', '/abs.md', '_removidas/x.md', 'LEIA-ME.md', 'a/../../x.md', 'a\\b.md']) {
      await assert.rejects(mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'n', payload: { files: { [bad]: 'x' }, pages: {} } }), /MIRROR_BAD_PATH/, bad)
    }
    await assert.rejects(mirror.applyBatch({ root, userData, workspaceId: '../evil', workspaceName: 'n', payload: { files: {}, pages: {} } }), /MIRROR_BAD_WORKSPACE/)
    await assert.rejects(stat(root), /ENOENT/, 'nada foi criado')
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('configurações: desligado por padrão, exige confirmação, recusa pastas proibidas e links simbólicos para dentro dos dados', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const userData = path.join(work, 'userData'), backups = path.join(work, 'Backups'), docs = path.join(work, 'Documents')
    await mkdir(path.join(userData, 'data'), { recursive: true }); await mkdir(docs, { recursive: true })
    const opts = { documents: docs, backupDirectory: backups }
    const initial = await mirror.readSettings(userData, docs)
    assert.equal(initial.enabled, false); assert.equal(initial.directory, path.join(docs, `${PRODUCT.name} Espelho`))
    await assert.rejects(mirror.writeSettings(userData, { enabled: true }, opts), /MIRROR_NEEDS_ACK/)
    assert.equal((await mirror.readSettings(userData, docs)).enabled, false)
    for (const bad of [path.join(userData, 'data'), path.join(userData, 'data', 'sub'), path.join(userData, 'workspaces', 'x'), userData, backups, path.join(backups, 'x'), path.dirname(userData), '/', 'relativo']) {
      await assert.rejects(mirror.writeSettings(userData, { directory: bad }, opts), /MIRROR_/, bad)
    }
    const link = path.join(work, 'atalho'); await symlink(path.join(userData, 'data'), link)
    await assert.rejects(mirror.writeSettings(userData, { directory: path.join(link, 'esp') }, opts), /MIRROR_DIR_FORBIDDEN/)
    const ok = await mirror.writeSettings(userData, { directory: path.join(docs, 'Meu Espelho') }, opts)
    assert.equal(ok.enabled, false)
    const on = await mirror.writeSettings(userData, { enabled: true, acknowledged: true }, opts)
    assert.equal(on.enabled, true)
    const off = await mirror.writeSettings(userData, { enabled: false }, opts)
    assert.equal(off.enabled, false)
    // pasta escolhida com outros arquivos → vai para a subpasta "the application Espelho"
    await writeFile(path.join(docs, 'outro.txt'), 'x')
    assert.equal(await mirror.resolveRoot(docs), path.join(docs, `${PRODUCT.name} Espelho`))
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('desligar e remover: apaga só o que o espelho gerou', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const userData = path.join(work, 'u'), root = path.join(work, 'E')
    const { pages, documents } = sample()
    const first = await build(pages, documents)
    await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'n', payload: payloadOf(first.plan, first.files) })
    const ws = (await readdir(root)).find(n => n.includes('--default'))!
    await writeFile(path.join(root, ws, 'meu-arquivo.txt'), 'meu')
    const { removed } = await mirror.removeMirrorFiles({ root, userData, workspaceId: 'default' })
    assert.ok(removed > 5)
    assert.equal(await readFile(path.join(root, ws, 'meu-arquivo.txt'), 'utf8'), 'meu')
    assert.deepEqual((await walk(root)).filter(f => !f.endsWith('meu-arquivo.txt')), [COMPAT.record012, 'LEIA-ME.md'].filter(f => f !== 'x'))
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('desempenho: 2000 páginas (< 15 s) e atualização incremental de uma página (< 200 ms)', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const pages: Record<string, never> = {}, documents: Record<string, unknown[]> = {}
    for (let i = 0; i < 2000; i++) {
      const pid = id(1000 + i), parent = i < 40 ? null : id(1000 + (i % 40))
      pages[pid] = page(pid, parent, `Página ${i}`, { order: i, text: `texto ${i}` })
      documents[pid] = [para(`Parágrafo de ${i} `.repeat(20)), para('segundo'), { id: `l${i}`, type: 'bulletListItem', props: {}, content: [txt('item')], children: [] }]
    }
    const userData = path.join(work, 'u'), root = path.join(work, 'E')
    const t0 = performance.now()
    const plan = planMirror({ pages, ...base, prev: null })
    const files = await buildMirrorFiles({ plan, documents, ...base })
    await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'n', payload: payloadOf(plan, files) })
    const initial = performance.now() - t0
    assert.ok(initial < 15000, `inicial ${Math.round(initial)} ms`)
    const prev = { version: MIRROR_VERSION, globalSig: plan.globalSig, pages: payloadOf(plan, {}).pages }
    const target = id(1500)
    const edited = { ...pages, [target]: { ...pages[target], text: 'mudou', updatedAt: Date.now() } } as never
    const keep = keepIdsOf(edited, documents)
    const t1 = performance.now()
    const inc = planMirror({ pages: edited, ...base, prev })
    assert.deepEqual([...inc.dirty], [target])
    const only = await buildMirrorFiles({ plan: inc, documents: { [target]: [...documents[target], para('novo')] }, ...base, keepIds: keep })
    const res = await mirror.applyBatch({ root, userData, workspaceId: 'default', workspaceName: 'n', payload: payloadOf(inc, only) })
    const incremental = performance.now() - t1
    assert.equal(res.written, 1)
    assert.ok(incremental < (process.env.CI ? 1000 : 200), `incremental ${Math.round(incremental)} ms`)
    console.log(`mirror perf: inicial ${Math.round(initial)} ms, incremental ${Math.round(incremental)} ms`)
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('IPC: recusa gravar com o espelho desligado, com o cofre bloqueado ou sem a confirmação do cofre', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'np-mirror-'))
  try {
    const { registerMirrorIpc } = require('../electron/mirror-ipc.cjs')
    const vault = require('../electron/vault.cjs')
    const userData = path.join(work, 'u'), docs = path.join(work, 'Documents'), handlers = new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>()
    await mkdir(docs, { recursive: true })
    registerMirrorIpc({ trustedHandler: (n: string, f: never) => handlers.set(n, f), context: () => ({ workspaceId: 'default', win: {} }), dataDir: () => path.join(userData, 'data'), userData: () => userData, dialog: {}, shell: {}, app: { getPath: () => docs } })
    const call = (name: string, ...args: unknown[]) => handlers.get(name)!({}, ...args)
    const payload = { files: { 'a.md': 'x' }, pages: {}, workspaceName: 'n' }
    await assert.rejects(call('np:mirrorApply', payload), /MIRROR_OFF/)
    assert.ok(!(await readdir(docs)).length, 'nada gravado com o toggle desligado')
    await assert.rejects(call('np:mirrorSettingsSet', { enabled: true }), /MIRROR_NEEDS_ACK/)
    await call('np:mirrorSettingsSet', { enabled: true, acknowledged: true })
    const original = [vault.isEnabled, vault.isLocked]
    try {
      vault.isEnabled = () => true; vault.isLocked = () => true
      await assert.rejects(call('np:mirrorApply', payload), /MIRROR_LOCKED/)
      vault.isLocked = () => false
      await assert.rejects(call('np:mirrorApply', payload), /MIRROR_NEEDS_VAULT_ACK/)
      await call('np:mirrorSettingsSet', { vaultAcknowledged: true })
      const result = await call('np:mirrorApply', payload) as { written: number }
      assert.equal(result.written, 1)
    } finally { [vault.isEnabled, vault.isLocked] = original }
    await call('np:mirrorSettingsSet', { enabled: false })
    await assert.rejects(call('np:mirrorApply', payload), /MIRROR_OFF/)
    await assert.rejects(call('np:mirrorSettingsSet', { directory: path.join(userData, 'data', 'x') }), /MIRROR_DIR_FORBIDDEN/)
  } finally { await rm(work, { recursive: true, force: true }) }
})
