// Subpáginas ↔ bancos de dados: planejamento, conversões com desfazer, exclusões seguras, seleção múltipla e
// mover para dentro/fora de bancos com mapeamento de propriedades. docs/USAGE.md
import test from 'node:test'
import assert from 'node:assert/strict'

const documents = new Map<string, unknown[]>()
const native = {
  async loadMeta() { return { pages: {}, settings: { locale: 'pt-BR' } } },
  async saveMeta() {},
  async loadDoc(id: string) { return structuredClone(documents.get(id) ?? null) },
  async saveDoc(id: string, doc: unknown[]) { documents.set(id, structuredClone(doc)) },
  async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc(id: string) { documents.delete(id) },
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState, selectors } = await import('../src/store.ts')
const model = await import('../src/objecttypes/model.ts')
const plan = await import('../src/subpages/plan.ts')
const ops = await import('../src/subpages/actions.ts')
const selection = await import('../src/subpages/selection.ts')
const { uncitedChildren } = plan

await actions.init()
const PERSON = 'type-person', BOOK = 'type-book'
actions.updateSettings({ objectTypes: model.normalizeObjectTypes([
  { id: PERSON, name: 'Pessoa', icon: '👤', color: 'blue', properties: [{ id: 'f-email', name: 'E-mail', type: 'email' }, { id: 'f-kind', name: 'Relação', type: 'select', options: [{ id: 'o-mae', name: 'Mãe', color: 'pink' }, { id: 'o-amiga', name: 'Amiga', color: 'green' }] }] },
  { id: BOOK, name: 'Livro', icon: '📚', color: 'brown', properties: [{ id: 'f-author', name: 'Autor', type: 'text' }] },
]) })
const page = (title: string, parent: string | null = null, init: Record<string, unknown> = {}) => actions.createPage(parent, { title, ...init })
const P = (id: string) => getState().pages[id]
const kids = (id: string) => selectors.children(id).map((p) => p.title)
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

function scenario() {
  const root = page('pessoas - testes')
  const elza = page('Elza - mãe', root, { types: [PERSON], typeProps: { 'f-email': 'elza@x.com', 'f-kind': 'o-mae' } })
  const eliane = page('Eliane - Amiga', root, { types: [PERSON], typeProps: { 'f-kind': 'o-amiga' } })
  return { root, elza, eliane }
}

test('planejamento: tipo comum só com 70 % ou mais; nome plural; esquema Nome + Tags', () => {
  const types = getState().settings.objectTypes!
  const mk = (n: number, typed: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, types: i < typed ? [PERSON] : undefined })) as never[]
  assert.equal(plan.commonType(mk(3, 2), types).typeId, null, '2 de 3 = 67 %')
  assert.equal(plan.commonType(mk(4, 3), types).typeId, PERSON, '3 de 4 = 75 %')
  assert.equal(plan.commonType(mk(10, 7), types).typeId, PERSON, '7 de 10 = exatamente 70 %')
  assert.equal(plan.commonType([], types).typeId, null)
  assert.equal(plan.pluralName('Pessoa', 'pt-BR'), 'Pessoas')
  assert.equal(plan.pluralName('Reunião', 'pt-BR'), 'Reuniões')
  assert.equal(plan.pluralName('Papel', 'pt-BR'), 'Papéis'.replace('é', 'e'))
  const schema = plan.planSchema([], types, {}, { title: 'Nome', tags: 'Tags' })
  assert.deepEqual(schema.properties.map((p) => p.type), ['title', 'multiSelect'])
})

test('exclusões: protegida, bloqueada, banco e lousa ficam de fora', () => {
  const root = page('Raiz')
  const ok = page('Comum', root)
  const prot = page('Protegida', root, { passwordLock: { rootId: 'x', hideTitle: true } })
  const lock = page('Trancada', root, { locked: true })
  const db = actions.createDatabase(root)
  const result = plan.classify(getState().pages, [ok, prot, lock, db])
  assert.deepEqual(result.eligible.map((p) => p.id), [ok])
  assert.deepEqual(result.excluded.map((e) => e.reason).sort(), ['database', 'locked', 'protected'])
})

test('subpáginas → tabela embutida: mesmos ids, ordem, tipo comum, propriedades e bloco no corpo', async () => {
  const { root, elza, eliane } = scenario()
  const other = page('Outra', root)
  actions.updatePage(other, { title: 'Outra', bodyOutboundPageIds: [elza], outboundPageIds: [elza] })
  const preview = ops.previewSubpages(root)
  assert.equal(preview.eligible.length, 3)
  assert.equal(preview.typeId, null, '2 de 3 = 67 %: sem tipo comum')
  const result = await ops.convertSubpagesToDatabase(root)
  const db = P(result.dbId)
  assert.ok(db.database, 'banco criado')
  assert.equal(db.parentId, root)
  assert.equal(db.blockOwnerId, root)
  assert.deepEqual(kids(result.dbId), ['Elza - mãe', 'Eliane - Amiga', 'Outra'], 'ordem preservada')
  assert.equal(P(elza).parentId, result.dbId, 'mesmo id, novo pai')
  assert.equal(P(eliane).parentId, result.dbId)
  assert.deepEqual(db.database!.properties.map((p) => p.name), ['Nome', 'Tags'])
  const blocks = documents.get(root) as { type: string; props: { pageId: string; display: string; ownership: string } }[]
  assert.ok(blocks.some((b) => b.type === 'page' && b.props.pageId === result.dbId && b.props.display === 'inline' && b.props.ownership === 'owned'), 'bloco de banco embutido no corpo')
  assert.ok(selectors.backlinks(elza).some((p) => p.id === other), 'backlinks por id continuam')
  assert.deepEqual(P(elza).types, [PERSON], 'tipo continua aplicado')
})

test('com tipo comum (≥ 70 %): campos do tipo viram propriedades e typeProps migra para props; ⌘Z e refazer', async () => {
  const { root, elza, eliane } = scenario()
  const result = await ops.convertSubpagesToDatabase(root)
  const db = P(result.dbId)
  assert.equal(db.title, 'Pessoas')
  assert.deepEqual(db.database!.properties.map((p) => p.name), ['Nome', 'Tags', 'E-mail', 'Relação'])
  assert.equal(P(elza).props?.['f-email'], 'elza@x.com')
  assert.equal(P(elza).props?.['f-kind'], 'o-mae')
  assert.equal(P(elza).typeProps, undefined, 'valores migrados saem de typeProps')
  assert.equal(P(eliane).props?.['f-kind'], 'o-amiga')
  assert.deepEqual(P(elza).types, [PERSON])
  // desfazer: transação única restaura pai, ordem, valores e remove o banco e o bloco
  assert.ok(actions.nextUndoIsStructural())
  assert.ok(actions.undoDatabase())
  await settle()
  assert.equal(P(elza).parentId, root)
  assert.equal(P(eliane).parentId, root)
  assert.deepEqual(P(elza).typeProps, { 'f-email': 'elza@x.com', 'f-kind': 'o-mae' })
  assert.equal(P(elza).props, undefined)
  assert.ok(P(result.dbId).trashed, 'banco criado vai para a lixeira')
  assert.ok(!(documents.get(root) as { props?: { pageId?: string } }[] ?? []).some((b) => b.props?.pageId === result.dbId), 'bloco removido do corpo')
  assert.deepEqual(kids(root), ['Elza - mãe', 'Eliane - Amiga'])
  assert.ok(actions.redoDatabase())
  await settle()
  assert.equal(P(elza).parentId, result.dbId)
  assert.equal(P(elza).props?.['f-email'], 'elza@x.com')
  assert.ok((documents.get(root) as { props?: { pageId?: string } }[]).some((b) => b.props?.pageId === result.dbId), 'bloco volta ao refazer')
})

test('filhas protegidas, bloqueadas e bancos são excluídas sem perder nada', async () => {
  const root = page('Misto')
  const a = page('A', root), b = page('B', root)
  const prot = page('Secreta', root, { passwordLock: { rootId: 'z', hideTitle: false } })
  const lock = page('Fixa', root, { locked: true })
  const inner = actions.createDatabase(root)
  const result = await ops.convertSubpagesToDatabase(root)
  assert.equal(result.moved, 2)
  assert.deepEqual(result.excluded.map((e) => e.reason).sort(), ['database', 'locked', 'protected'])
  for (const id of [prot, lock, inner]) assert.equal(P(id).parentId, root)
  assert.equal(P(a).parentId, result.dbId); assert.equal(P(b).parentId, result.dbId)
})

test('recusas seguras: página protegida/bloqueada, sem filhas elegíveis', async () => {
  const locked = page('Fixa'); page('filha', locked); actions.updatePage(locked, { locked: true })
  assert.ok(ops.subpageConversionBlocker(locked))
  await assert.rejects(() => ops.convertSubpagesToDatabase(locked))
  const protectedRoot = page('Cofre', null, { passwordLock: { rootId: 'r', hideTitle: false, unlocked: true } }); page('x', protectedRoot)
  assert.ok(ops.subpageConversionBlocker(protectedRoot), 'protegida não recebe banco novo')
  const empty = page('Vazia')
  await assert.rejects(() => ops.convertSubpagesToDatabase(empty))
  assert.equal(ops.convertibleSubpageCount(empty), 0)
})

test('propriedades de outras origens entram quando a definição ainda existe', async () => {
  const src = actions.createDatabase(null, 'table', { title: 'Origem' })
  const status = { id: 'prop-nota', name: 'Nota', type: 'number' as const }
  actions.updateSchema(src, (s) => ({ ...s, properties: [...s.properties, status] }))
  const row = actions.createRow(src, { 'prop-nota': 9 }, { title: 'Linha' })
  const root = page('Casa'); const other = page('Sem props', root)
  actions.movePage(row, root)
  const result = await ops.convertSubpagesToDatabase(root)
  const names = P(result.dbId).database!.properties.map((p) => p.name)
  assert.ok(names.includes('Nota'), 'carrega Nota')
  assert.equal(P(row).props?.['prop-nota'], 9)
  assert.equal(P(other).parentId, result.dbId)
})

test('página → banco → página sem perda: corpo vira descrição, subpáginas viram linhas, tipo volta a typeProps', async () => {
  const { root, elza, eliane } = scenario()
  documents.set(root, [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Minha lista', styles: {} }], children: [] }])
  actions.updatePage(root, { icon: '👥', cover: 'linear-gradient(red, blue)' })
  const before = JSON.stringify(documents.get(root))
  const result = await ops.convertPageToDatabase(root)
  assert.equal(result.moved, 2)
  assert.ok(P(root).database, 'página virou banco')
  assert.equal(P(root).database!.bodyDescription, true, 'corpo preservado como descrição')
  assert.equal(JSON.stringify(documents.get(root)), before, 'corpo intacto')
  assert.equal(P(root).icon, '👥'); assert.equal(P(root).cover, 'linear-gradient(red, blue)')
  assert.deepEqual(P(root).database!.properties.map((p) => p.name), ['Nome', 'Tags', 'E-mail', 'Relação'])
  assert.equal(P(elza).props?.['f-email'], 'elza@x.com')
  assert.equal(P(elza).parentId, root, 'linhas continuam filhas da própria página')
  assert.equal(selectors.rows(root).length, 2)
  const back = ops.convertDatabaseToPages(root)
  assert.equal(back.rows, 2)
  assert.equal(P(root).database, undefined)
  assert.deepEqual(P(elza).typeProps, { 'f-email': 'elza@x.com', 'f-kind': 'o-mae' }, 'campos do tipo voltam visíveis')
  assert.equal(P(elza).props, undefined)
  assert.equal(P(eliane).title, 'Eliane - Amiga')
  assert.equal(JSON.stringify(documents.get(root)), before, 'corpo continua intacto')
  assert.ok(actions.undoDatabase())
  assert.ok(P(root).database, 'desfazer a conversão para páginas restaura o banco')
  assert.equal(P(elza).props?.['f-email'], 'elza@x.com')
})

test('página → banco: ⌘Z restaura página, linhas e valores', async () => {
  const { root, elza } = scenario()
  await ops.convertPageToDatabase(root)
  assert.ok(P(root).database)
  assert.ok(actions.undoDatabase())
  assert.equal(P(root).database, undefined)
  assert.deepEqual(P(elza).typeProps, { 'f-email': 'elza@x.com', 'f-kind': 'o-mae' })
  assert.equal(P(elza).props, undefined)
})

test('recusas da conversão da própria página e do banco', () => {
  const db = actions.createDatabase(null)
  assert.ok(ops.pageConversionBlocker(db), 'já é banco')
  const row = actions.createRow(db, {}, { title: 'L' })
  assert.ok(ops.pageConversionBlocker(row), 'linhas não viram bancos')
  const locked = page('T', null, { locked: true })
  assert.ok(ops.pageConversionBlocker(locked))
  assert.equal(ops.databaseConversionBlocker(db), null)
  const linked = actions.createPage(null, { database: { properties: [], views: [{ id: 'v', name: 'T', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v', linkedSourceId: db } })
  assert.ok(ops.databaseConversionBlocker(linked), 'visualização vinculada')
})

test('seleção múltipla: ⌘ alterna, ⇧ faz intervalo entre irmãos, níveis diferentes são recusados', () => {
  const root = page('Seleção')
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => page(n, root))
  const child = page('x', a)
  selection.clearSelection()
  assert.equal(selection.toggleSelected(a), 'ok')
  assert.equal(selection.selectRange(c), 'ok')
  assert.deepEqual([...selection.selectedIds()], [a, b, c])
  assert.equal(selection.toggleSelected(child), 'level', 'outro nível')
  assert.equal(selection.toggleSelected(b), 'ok')
  assert.deepEqual([...selection.selectedIds()], [a, c])
  assert.equal(selection.selectRange(d), 'ok')
  selection.clearSelection()
  assert.deepEqual([...selection.selectedIds()], [])
})

test('selecionar páginas → criar banco no lugar da primeira, com tipo e ⌘Z', () => {
  const root = page('Contatos')
  const first = page('Antes', root)
  const x = page('Ana', root, { types: [PERSON], typeProps: { 'f-email': 'ana@x.com' } })
  const mid = page('Meio', root)
  const y = page('Bia', root, { types: [PERSON], typeProps: { 'f-kind': 'o-amiga' } })
  const z = page('Cris', root, { types: [PERSON] })
  assert.equal(ops.selectionConversionBlocker([x, y, z]), null)
  const result = ops.createDatabaseFromPages([y, x, z])
  assert.equal(result.moved, 3)
  const db = P(result.dbId)
  assert.equal(db.parentId, root)
  assert.deepEqual(selectors.children(root).map((p) => p.title), ['Antes', 'Pessoas', 'Meio'], 'banco no lugar da primeira selecionada')
  assert.equal(P(x).props?.['f-email'], 'ana@x.com')
  assert.deepEqual(kids(result.dbId), ['Ana', 'Bia', 'Cris'])
  assert.ok(actions.undoDatabase())
  assert.deepEqual(selectors.children(root).map((p) => p.title), ['Antes', 'Ana', 'Meio', 'Bia', 'Cris'])
  assert.deepEqual(P(x).typeProps, { 'f-email': 'ana@x.com' })
  assert.ok(first && mid)
})

test('seleção: recusa níveis diferentes e páginas que já são linhas', () => {
  const root = page('R'); const a = page('A', root); const b = page('B', a)
  assert.ok(ops.selectionConversionBlocker([a, b]))
  const db = actions.createDatabase(root); const row = actions.createRow(db, {}, { title: 'L' })
  assert.ok(ops.selectionConversionBlocker([row]))
  assert.ok(ops.selectionConversionBlocker([]))
})

test('mover para banco: mapeia por nome e tipo; sair do banco devolve campos do tipo e conta valores guardados', () => {
  const db = actions.createDatabase(null, 'table', { title: 'Contatos' })
  actions.updateSchema(db, (s) => ({ ...s, properties: [...s.properties,
    { id: 'db-mail', name: 'E-mail', type: 'email' },
    { id: 'db-rel', name: 'Relação', type: 'select', options: [{ id: 'db-amiga', name: 'Amiga', color: 'green' }, { id: 'db-mae', name: 'Mãe', color: 'pink' }] },
  ] }))
  const a = page('Ana', null, { types: [PERSON], typeProps: { 'f-email': 'ana@x.com', 'f-kind': 'o-amiga' } })
  const b = page('Bia')
  const result = ops.movePagesToDatabase([a, b], db)
  assert.equal(result.into, 'database'); assert.equal(result.moved, 2)
  assert.equal(P(a).parentId, db)
  assert.equal(P(a).props?.['db-mail'], 'ana@x.com', 'mesmo nome e tipo')
  assert.equal(P(a).props?.['db-rel'], 'db-amiga', 'opção mapeada pelo nome')
  assert.equal(P(a).typeProps, undefined)
  assert.equal(P(b).props, undefined, 'sem tipo: nada a copiar')
  actions.setProp(a, 'db-mail', 'novo@x.com')
  const out = ops.movePagesTo([a], null)
  assert.equal(out.into, 'out')
  assert.equal(P(a).parentId, null)
  assert.equal(P(a).typeProps?.['f-email'], 'novo@x.com', 'campos do tipo voltam')
  assert.equal(P(a).typeProps?.['f-kind'], 'o-amiga')
  assert.ok(out.hidden >= 0)
  // volta para o banco: valores guardados reaparecem pelos mesmos ids
  const again = ops.movePagesToDatabase([a], db)
  assert.equal(again.moved, 1)
  assert.equal(P(a).props?.['db-mail'], 'novo@x.com')
})

test('mover para banco ignora protegidas, bloqueadas e bancos; valores guardados reaparecem', () => {
  const db = actions.createDatabase(null)
  const ok = page('ok'), prot = page('prot', null, { passwordLock: { rootId: 'q', hideTitle: false } }), lock = page('lock', null, { locked: true }), inner = actions.createDatabase(null)
  const result = ops.movePagesToDatabase([ok, prot, lock, inner], db)
  assert.equal(result.moved, 1)
  assert.equal(result.excluded.length, 3)
  assert.equal(P(prot).parentId, null); assert.equal(P(lock).parentId, null); assert.equal(P(inner).parentId, null)
})

test('bancos de destino: sem vinculados, bloqueados nem a própria seleção', () => {
  const db = actions.createDatabase(null, 'table', { title: 'Alvo ÚNICO' })
  const locked = actions.createDatabase(null, 'table', { title: 'Alvo ÚNICO trancado' }); actions.updatePage(locked, { locked: true })
  const names = ops.databaseTargets([], 'alvo único').map((p) => p.id)
  assert.ok(names.includes(db)); assert.ok(!names.includes(locked))
  assert.ok(!ops.databaseTargets([db], 'alvo único').some((p) => p.id === db))
})

test('seção Subpáginas: só mostra subpáginas ainda não citadas no corpo, na ordem da árvore', () => {
  assert.equal(typeof uncitedChildren, 'function')
  const kidsList = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(uncitedChildren(kidsList, ['b']), ['a', 'c'])
  assert.deepEqual(uncitedChildren(kidsList, undefined, new Set(['a'])), ['b', 'c'])
  assert.deepEqual(uncitedChildren([], ['x']), [])
})
