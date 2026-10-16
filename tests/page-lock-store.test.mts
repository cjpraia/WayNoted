import test from 'node:test'
import assert from 'node:assert/strict'

// Store-level guards for password-protected pages: nothing can be created or moved under a
// locked page (every creation path ends in createPage/movePage/duplicatePage), and new or
// moved subpages of an unlocked page take its protection.
const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', O = '44444444-4444-4444-8444-444444444444'
const page = (id: string, title: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({ id, parentId, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', bodyText: '', outboundPageIds: [], bodyOutboundPageIds: [], syncedBlockIds: [], ...extra })
const lock = (unlocked: boolean, inherit = true) => ({ rootId: P, hideTitle: false, inherit, unlocked })
const meta = {
  pages: {
    [P]: page(P, 'teste senha', null, { passwordLock: lock(false) }),
    [C]: page(C, 'teste 1', P, { passwordLock: lock(false) }),
    [O]: page(O, 'Solta', null),
  },
  settings: { locale: 'pt-BR', theme: 'system', workspaceName: '', userName: '', sidebarWidth: 240, sidebarCollapsed: false, expanded: {}, recent: [], historyLimit: 0 },
  notifications: {}, syncedBlocks: {},
}
const protectCalls: unknown[] = []
const native = {
  async loadMeta() { return structuredClone(meta) },
  async saveMeta(next: unknown) { return structuredClone(next) },
  async loadDoc() { return [] }, async saveDoc() {}, async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {},
  async exportFile() { return true }, async pickImage() { return null }, async revealDataFolder() {},
  async pageProtectChildren(pageId: string, ids: string[]) { protectCalls.push([pageId, ids]); return { meta: null, added: ids.length } },
}
Object.assign(globalThis, { window: { api: native, addEventListener() {} } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
const { actions, getState } = await import('../src/store.ts')
const { lockPrompts, lockedAncestor } = await import('../src/security/pageLock.ts')
const { moveDestinations } = await import('../src/components/modals/search.mts')
const prompts: string[] = []
let answer = true
lockPrompts.confirm = (text: string) => { prompts.push(text); return answer }
let db = ''
const count = () => Object.keys(getState().pages).length
const setLock = (unlocked: boolean, inherit = true) => { for (const id of [P, C, db]) actions.updatePage(id, { passwordLock: lock(unlocked, inherit) }, false) }

test('while the page is locked every creation path is rejected by the store', async () => {
  await actions.init()
  assert.equal(getState().initError, null)
  // An embedded database inside the locked page (placed there directly, as loaded from disk).
  db = actions.createDatabase(null)
  actions.updatePage(db, { parentId: P, passwordLock: lock(false) }, false)
  assert.equal(JSON.stringify(getState().pages[C]?.passwordLock), JSON.stringify(lock(false)))
  assert.ok(lockedAncestor(getState().pages, C)?.id === C, 'a protected child is itself locked')
  assert.ok(lockedAncestor(getState().pages, P)?.id === P)
  const before = count()
  assert.throws(() => actions.createPage(P), /Desbloqueie a página para adicionar subpáginas/, 'sidebar "+", ⌘N on the page, "/Página"')
  assert.throws(() => actions.createPage(C), /Desbloqueie/, 'children rows under a locked ancestor')
  assert.throws(() => actions.createDatabase(P), /Desbloqueie/, '/database inside it')
  assert.throws(() => actions.createRow(db), /Desbloqueie/, '"Nova página" in an embedded database')
  await assert.rejects(actions.duplicatePage(O, P), /Desbloqueie/, 'duplicate into it')
  actions.movePage(O, P)
  assert.equal(getState().pages[O].parentId, null, 'drag & drop / MovePageDialog cannot move into it')
  assert.match(getState().saveError ?? '', /Desbloqueie/)
  actions.movePage(O, C)
  assert.equal(getState().pages[O].parentId, null)
  assert.equal(count(), before, 'no page was created')
  assert.deepEqual(moveDestinations(getState().pages, O).map(p => p.id).filter(id => [P, C, db].includes(id)), [], 'locked pages are not move destinations')
})

test('after unlocking: inheriting locks adopt new subpages silently; moving in asks first', async () => {
  setLock(true, true)
  prompts.length = 0
  const id = actions.createPage(P)
  assert.equal(getState().pages[id].parentId, P)
  assert.equal(prompts.length, 0, 'inheritance needs no question (the main process adopts it on save)')
  answer = false
  actions.movePage(O, P)
  assert.equal(getState().pages[O].parentId, null, 'declining keeps the page outside')
  answer = true
  actions.movePage(O, P)
  assert.equal(getState().pages[O].parentId, P)
  assert.equal(prompts.length, 2)
  actions.movePage(C, null)
  assert.equal(getState().pages[C].parentId, null, 'a protected page can move out (it keeps its own lock)')
})

test('locks without inheritance ask once and protect the new subpage on yes', async () => {
  setLock(true, false)
  prompts.length = 0; protectCalls.length = 0; answer = true
  const id = actions.createPage(P)
  assert.equal(prompts.length, 1)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(protectCalls, [[P, [id]]])
  answer = false
  actions.createPage(P)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(protectCalls.length, 1, 'no protection when declined')
})
