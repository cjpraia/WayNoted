import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutLockedPages, protectedTitle, isLockedPage } from '../src/security/pageLock.ts'
import { searchWorkspace, searchablePages, defaultSearchFilters } from '../src/components/modals/search.mts'
import type { Page } from '../src/types.ts'

const base = (id: string, title: string, parentId: string | null = null, extra: Partial<Page> = {}): Page => ({ id, parentId, title, icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra })
const pages = (): Record<string, Page> => ({
  pub: base('pub', 'Público', null, { text: 'conteudo comum' }),
  root: base('root', '', null, { passwordLock: { rootId: 'root', hideTitle: true, unlocked: false }, comments: [{ id: 'c', author: 'Eu', body: 'comentario secreto', createdAt: 1 } as never] }),
  child: base('child', 'Filha visível', 'root', { passwordLock: { rootId: 'root', hideTitle: false, unlocked: false }, props: { p: 'valor secreto' } as never }),
  under: base('under', 'Neta comum', 'child'),
  open: base('open', 'Diário aberto', null, { passwordLock: { rootId: 'open', hideTitle: true, unlocked: true }, comments: [{ id: 'd', author: 'Eu', body: 'nota secreta', createdAt: 1 } as never] }),
})

test('exports drop locked protected pages and everything below them', () => {
  const result = withoutLockedPages(pages())
  assert.deepEqual(Object.keys(result).sort(), ['open', 'pub'])
  assert.equal(isLockedPage(pages().open), false)
  const plain = { pub: pages().pub }
  assert.equal(withoutLockedPages(plain), plain, 'no copy when nothing is protected')
})

test('sidebar label hides only locked hidden titles', () => {
  const p = pages()
  assert.equal(protectedTitle(p.root, 'Página protegida'), 'Página protegida')
  assert.equal(protectedTitle(p.child, 'Página protegida'), null)
  assert.equal(protectedTitle(p.open, 'Página protegida'), null)
  assert.equal(protectedTitle(p.pub, 'Página protegida'), null)
})

test('search never matches protected properties or comments and skips hidden locked pages', () => {
  const p = pages()
  const searchable = searchablePages(p)
  assert.equal(searchable.root, undefined)
  assert.equal(searchablePages(p), searchable, 'memoized per pages object')
  const ids = (query: string) => searchWorkspace(p, query, { ...defaultSearchFilters }).map(hit => hit.page.id).sort()
  assert.deepEqual(ids('secreto'), [])
  assert.deepEqual(ids('secreta'), [])
  assert.deepEqual(ids('Filha'), ['child'])
  assert.deepEqual(ids('Diário'), ['open'])
  assert.deepEqual(ids('comum').includes('pub'), true)
})

test('password form validation (page dialog and workspace form share it) counts the whole value and never trims', async () => {
  const { passwordProblem } = await import('../src/security/validation.ts')
  assert.equal(passwordProblem('1234567', '1234567'), 'short')
  assert.equal(passwordProblem('twelve-chars', 'twelve-chars'), null)
  assert.equal(passwordProblem('        ', '        '), null, 'spaces count, like in the main process')
  assert.equal(passwordProblem('twelve-chars', 'twelve-char'), 'mismatch')
  assert.equal(passwordProblem('twelve-chars', 'twelve-chars', 'my TWELVE-chars!'), 'hintHasPassword')
  assert.equal(passwordProblem('twelve-chars', 'twelve-chars', 'x'.repeat(121)), 'hintLong')
  assert.equal(passwordProblem('twelve-chars', 'twelve-chars', '  pet name  '), null)
})
