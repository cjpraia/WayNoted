import test from 'node:test'
import assert from 'node:assert/strict'

// Migração única `autoGroupingCleaned`: remove o agrupamento automático antigo (primeiro Status/Seleção) de
// tabela/lista/galeria/feed; preserva quadros, subgrupos e bancos bloqueados.
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', L = '33333333-3333-4333-8333-333333333333'
const page = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, parentId: null, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', bodyText: '', outboundPageIds: [], bodyOutboundPageIds: [], syncedBlockIds: [], ...extra })
const props = [{ id: 'name', name: 'Nome', type: 'title' }, { id: 'st', name: 'Status', type: 'status', options: [{ id: 'o1', name: 'A', color: 'gray', group: 'todo' }] }, { id: 'tg', name: 'Tipo', type: 'select', options: [{ id: 'o2', name: 'X', color: 'blue' }] }]
const v = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type, filters: [], sorts: [], hidden: [], widths: {}, ...extra })
const db = (views: unknown[]) => ({ properties: props, views, activeViewId: (views[0] as { id: string }).id })
const meta = {
  pages: {
    [A]: page(A, 'A', { database: db([v('t', 'table', { groupBy: 'st', hiddenGroups: ['status:o1'] }), v('b', 'board', { groupBy: 'st' }), v('sub', 'table', { groupBy: 'st', subgroupBy: 'tg' }), v('own', 'list', { groupBy: 'tg' }), v('g', 'gallery', { groupBy: 'st' })]) }),
    [B]: page(B, 'B', { database: db([v('t2', 'table')]) }),
    [L]: page(L, 'Bloqueado', { locked: true, database: db([v('tl', 'table', { groupBy: 'st' })]) }),
  },
  settings: { locale: 'pt-BR', theme: 'system', workspaceName: '', userName: '', sidebarWidth: 240, sidebarCollapsed: false, expanded: {}, recent: [], historyLimit: 0 },
  notifications: {}, syncedBlocks: {},
}
const native = {
  async loadMeta() { return structuredClone(meta) }, async saveMeta() {},
  async loadDoc() { return [] }, async saveDoc() {}, async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {},
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const group = (id: string, viewId: string) => getState().pages[id].database!.views.find((x) => x.id === viewId)!.groupBy ?? null

test('migração limpa só o agrupamento automático de tabela/galeria e é idempotente', async () => {
  await actions.init()
  assert.equal(getState().settings.autoGroupingCleaned, true)
  assert.equal(group(A, 't'), null, 'tabela agrupada pelo primeiro Status perde o agrupamento')
  assert.equal(group(A, 'g'), null, 'galeria idem')
  assert.equal(getState().pages[A].database!.views[0].hiddenGroups?.length ?? 0, 0)
  assert.equal(group(A, 'b'), 'st', 'quadro mantém o agrupamento')
  assert.equal(group(A, 'sub'), 'st', 'visualização com subgrupo é intencional')
  assert.equal(group(A, 'own'), 'tg', 'agrupamento por outra propriedade é escolha do usuário')
  assert.equal(group(L, 'tl'), 'st', 'banco bloqueado não é alterado')
  // Idempotência: o usuário reagrupa depois da migração e nada volta a limpar.
  actions.updateView(A, 't', { groupBy: 'st' })
  assert.equal(getState().settings.autoGroupingCleaned, true)
  assert.equal(group(A, 't'), 'st')
})
