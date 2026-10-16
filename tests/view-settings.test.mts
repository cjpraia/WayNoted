// Painel "Configurações da visualização" e seleção de linhas: lógica pura, conversão de tipo
// (store + ⌘Z), compatibilidade de dados antigos e links profundos com viewId.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { changeViewType, currentScreen, layoutOptionsFor, LAYOUT_TYPES, moveId, normalizeViewSettings, openNav, popNav, pushNav, splitVisibility, viewBodyClasses, OPTIONAL_GROUP_TYPES } from '../src/components/database/settings/model.ts'
import { pruneSelection, selectionState, toggleSelection } from '../src/components/database/rowSelection.ts'
import { groupsFor } from '../src/components/database/grouping.ts'
import { validateMeta } from '../src/workspace.ts'
import type { DatabaseSchema, View, ViewType } from '../src/types.ts'

const require = createRequire(import.meta.url)
const { parseDeepLink } = require('../electron/deep-links.cjs')

const schema = (): DatabaseSchema => ({
  properties: [
    { id: 'title', name: 'Nome', type: 'title' },
    { id: 'status', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'Zeta', color: 'gray' }, { id: 'done', name: 'Alfa', color: 'green' }] },
    { id: 'tag', name: 'Tag', type: 'select', options: [{ id: 'a', name: 'A', color: 'blue' }] },
    { id: 'when', name: 'Quando', type: 'date' },
    { id: 'notes', name: 'Notas', type: 'text' },
  ],
  views: [], activeViewId: 'v',
})
const view = (patch: Partial<View> = {}): View => ({ id: 'v', name: 'Tabela', type: 'table', filters: [{ id: 'f', propertyId: 'notes', op: 'contains', value: 'x' }], sorts: [{ propertyId: 'when', direction: 'desc' }], hidden: ['notes'], widths: { title: 300 }, loadLimit: 20, ...patch })

test('navegação em pilha: avança, volta à linha de origem e Esc na principal fecha', () => {
  let nav = openNav()
  assert.equal(currentScreen(nav), 'main')
  nav = pushNav(nav, 'layout', 'layout')
  assert.equal(currentScreen(nav), 'layout'); assert.equal(nav.dir, 1)
  assert.equal(pushNav(nav, 'layout').stack.length, 2, 'não empilha a mesma tela duas vezes')
  nav = pushNav(nav, 'group', 'layout-group')
  assert.deepEqual(nav.stack.map((entry) => entry.screen), ['main', 'layout', 'group'])
  const back = popNav(nav)!
  assert.equal(currentScreen(back), 'layout'); assert.equal(back.dir, -1)
  assert.equal(popNav(popNav(back)!), null, 'na principal, voltar = fechar')
  assert.deepEqual(openNav('visibility').stack.map((entry) => entry.screen), ['main', 'visibility'], 'atalhos abrem já na subtela, com volta para a principal')
})

test('opções do Layout dependem do tipo e só incluem o que tem efeito', () => {
  assert.ok(layoutOptionsFor('table').includes('rowNumbers') && layoutOptionsFor('table').includes('verticalLines') && layoutOptionsFor('table').includes('frozenColumns'))
  assert.ok(!layoutOptionsFor('table').includes('cardPreview'))
  for (const type of ['board', 'gallery'] as ViewType[]) for (const option of ['cardPreview', 'cardSize', 'cardLayout'] as const) assert.ok(layoutOptionsFor(type).includes(option), `${type}:${option}`)
  assert.ok(layoutOptionsFor('board').includes('colorColumns') && !layoutOptionsFor('list').includes('colorColumns'))
  assert.ok(layoutOptionsFor('calendar').includes('showWeekends') && layoutOptionsFor('calendar').includes('showWeekNumbers'))
  assert.ok(layoutOptionsFor('timeline').includes('timelineTable'))
  assert.ok(!layoutOptionsFor('chart').includes('openPagesIn') && !layoutOptionsFor('calendar').includes('loadLimit'))
})

test('conversão de tipo: matriz completa preserva filtros/ordem/ocultas/larguras e nunca liga agrupamento sozinho', () => {
  const types = LAYOUT_TYPES.map((item) => item.type)
  for (const from of types) for (const to of types) {
    if (from === to) continue
    const groupBy = from === 'board' || OPTIONAL_GROUP_TYPES.includes(from) ? 'status' : undefined
    const source = view({ type: from, name: LAYOUT_TYPES.find((item) => item.type === from)!.pt, groupBy, hiddenGroups: groupBy ? ['status:todo'] : undefined })
    const patch = changeViewType(schema(), source, to)
    const next = { ...source, ...patch }
    assert.equal(next.type, to)
    assert.equal(next.id, 'v')
    assert.deepEqual(next.filters, source.filters, `${from}→${to} filtros`)
    assert.deepEqual(next.sorts, source.sorts, `${from}→${to} ordenação`)
    assert.deepEqual(next.hidden, source.hidden, `${from}→${to} ocultas`)
    assert.deepEqual(next.widths, source.widths, `${from}→${to} larguras`)
    assert.equal(next.loadLimit, 20)
    assert.equal(next.name, LAYOUT_TYPES.find((item) => item.type === to)!.pt, `${from}→${to}: nome padrão acompanha`)
    if (to === 'board') assert.equal(next.groupBy, 'status')
    else if (OPTIONAL_GROUP_TYPES.includes(to)) assert.equal(next.groupBy, OPTIONAL_GROUP_TYPES.includes(from) ? 'status' : undefined, `${from}→${to}: agrupamento só se já era escolha da pessoa`)
    else assert.equal(next.groupBy, undefined, `${from}→${to}: tipos sem grupos descartam groupBy`)
    if (to === 'calendar' || to === 'timeline') assert.equal(next.dateProp, 'when')
  }
  assert.equal(changeViewType(schema(), view({ name: 'Minha tabela' }), 'list').name, undefined, 'nome personalizado é mantido')
  assert.deepEqual(changeViewType(schema(), view(), 'table'), {})
})

test('visibilidade: título sempre mostrado, busca filtra as duas seções; moveId reordena', () => {
  const { shown, hidden } = splitVisibility(schema(), view())
  assert.deepEqual(shown.map((p) => p.id), ['title', 'status', 'tag', 'when'])
  assert.deepEqual(hidden.map((p) => p.id), ['notes'])
  assert.deepEqual(splitVisibility(schema(), view(), 'not').hidden.map((p) => p.id), ['notes'])
  assert.deepEqual(splitVisibility(schema(), view(), 'not').shown.length, 0)
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 'a', false), ['c', 'a', 'b'])
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'c', true), ['b', 'c', 'a'])
})

test('classes de efeito refletem as opções e grupos respeitam ordem/ocultação de vazios', () => {
  assert.equal(viewBodyClasses(view()), '')
  const classes = viewBodyClasses(view({ showPageIcon: false, wrapAll: true, verticalLines: false, colorColumns: false, cardSize: 'large', cardLayout: 'compact', showGroupCount: false }))
  for (const name of ['no-icons', 'wrap', 'no-vlines', 'plain-columns', 'card-large', 'card-compact', 'no-group-count']) assert.ok(classes.includes(`dbv-body--${name}`), name)
  const rows = [{ id: 'r1', props: { status: 'todo' } }, { id: 'r2', props: {} }] as never
  const property = schema().properties[1]
  assert.deepEqual(groupsFor(rows, property, view(), 'Sem').map((g) => g.label), ['Sem', 'Zeta'], 'manual: ordem das opções, vazios ocultos')
  assert.deepEqual(groupsFor(rows, property, view({ hideEmptyGroups: false }), 'Sem').map((g) => g.label), ['Sem', 'Zeta', 'Alfa'])
  assert.deepEqual(groupsFor(rows, property, view({ hideEmptyGroups: false, groupSort: 'alphabetical' }), 'Sem').map((g) => g.label), ['Alfa', 'Zeta', 'Sem'])
  assert.deepEqual(groupsFor(rows, property, view({ hideEmptyGroups: false, groupSort: 'reverse' }), 'Sem').map((g) => g.label), ['Zeta', 'Alfa', 'Sem'])
})

test('dados antigos passam intactos; valores inválidos dos campos novos são descartados sem recusar o arquivo', () => {
  const page = (database: unknown) => ({ pages: { '11111111-1111-4111-8111-111111111111': { id: '11111111-1111-4111-8111-111111111111', parentId: null, title: 'DB', database } }, settings: {} })
  const legacy = { properties: [{ id: 'title', name: 'Nome', type: 'title' }], views: [{ id: 'v', name: 'Tabela', type: 'table', filters: [], sorts: [], hidden: [], widths: {} }], activeViewId: 'v' }
  const loaded = validateMeta(page(structuredClone(legacy)))
  assert.deepEqual(Object.keys(loaded.pages['11111111-1111-4111-8111-111111111111'].database!.views[0]).sort(), Object.keys(legacy.views[0]).sort())
  const broken = structuredClone(legacy) as { views: Record<string, unknown>[] }
  Object.assign(broken.views[0], { wrapAll: 'yes', cardSize: 'huge', groupSort: 1, rowNumbers: true, cardLayout: 'compact', loadLimit: -5, cardPreview: 'property', cardPreviewPropertyId: 3 })
  const fixed = validateMeta(page(broken)).pages['11111111-1111-4111-8111-111111111111'].database!.views[0]
  assert.equal(fixed.wrapAll, undefined); assert.equal(fixed.cardSize, undefined); assert.equal(fixed.groupSort, undefined); assert.equal(fixed.loadLimit, undefined); assert.equal(fixed.cardPreviewPropertyId, undefined)
  assert.equal(fixed.rowNumbers, true); assert.equal(fixed.cardLayout, 'compact'); assert.equal(fixed.cardPreview, 'property')
  const raw: Record<string, unknown> = { showWeekends: 'no', timelineTable: false }
  assert.equal(normalizeViewSettings(raw), 1); assert.deepEqual(raw, { timelineTable: false })
})

test('seleção: alternar, Shift (intervalo), selecionar tudo com filtros/grupos e persistência por id', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  let selected: ReadonlySet<string> = toggleSelection(new Set(), order, 'b', null, false)
  selected = toggleSelection(selected, order, 'd', 'b', true)
  assert.deepEqual([...selected].sort(), ['b', 'c', 'd'])
  selected = toggleSelection(selected, order, 'c', 'd', false)
  assert.deepEqual([...selected].sort(), ['b', 'd'])
  assert.equal(selectionState(selected, order), 'some')
  assert.equal(selectionState(new Set(order), order), 'all')
  assert.equal(selectionState(new Set(), order), 'none')
  // Ordenação mudou: a seleção (por id) continua a mesma; o intervalo segue a nova ordem exibida.
  const resorted = ['e', 'd', 'c', 'b', 'a']
  assert.equal(pruneSelection(selected, resorted), selected)
  assert.deepEqual([...toggleSelection(new Set(['e']), resorted, 'c', 'e', true)].sort(), ['c', 'd', 'e'])
  // Filtro tirou linhas da lista: saem da seleção; "tudo" = lista filtrada inteira (inclui grupos).
  assert.deepEqual([...pruneSelection(new Set(['a', 'x']), order)], ['a'])
  const big = Array.from({ length: 50_000 }, (_, i) => `r${i}`)
  assert.equal(selectionState(new Set(big), big), 'all')
})

test('links profundos levam viewId (#view= e ?view=)', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000'
  assert.equal(parseDeepLink(`workspace://page/${id}#view=v-1`).viewId, 'v-1')
  assert.equal(parseDeepLink(`workspace://page/${id}?view=v_2`).viewId, 'v_2')
  assert.equal(parseDeepLink(`workspace://page/${id}?other=1`), null)
})

test('store: changeViewType converte no lugar, cria Data quando falta e ⌘Z desfaz', async () => {
  Object.assign(globalThis, { window: { api: { async loadMeta() { return null }, async saveMeta() {}, async loadDoc() { return null }, async saveDoc() {}, async listDocVersions() { return [] }, async saveDocVersions() {}, async deleteDoc() {} }, addEventListener() {} } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
  const { actions, selectors } = await import('../src/store.ts')
  await actions.init()
  const db = actions.createDatabase(null)
  const before = selectors.database(db)!
  const viewId = before.activeViewId
  const notes = before.properties.find((p) => p.type !== 'title')?.id
  actions.updateView(db, viewId, { filters: [], sorts: [{ propertyId: before.properties[0].id, direction: 'asc' }], hidden: notes ? [notes] : [] })
  const hadDate = selectors.database(db)!.properties.some((p) => p.type === 'date')
  assert.equal(actions.changeViewType(db, viewId, 'calendar'), true)
  const after = selectors.database(db)!
  const converted = after.views.find((v) => v.id === viewId)!
  assert.equal(converted.type, 'calendar'); assert.equal(after.views.length, before.views.length)
  assert.equal(converted.sorts.length, 1); assert.deepEqual(converted.hidden, notes ? [notes] : [])
  assert.ok(after.properties.some((p) => p.type === 'date' && p.id === converted.dateProp))
  assert.equal(actions.undoDatabase(), true)
  const undone = selectors.database(db)!
  assert.equal(undone.views.find((v) => v.id === viewId)!.type, 'table')
  assert.equal(undone.properties.some((p) => p.type === 'date'), hadDate)
})

test('store: excluir linhas selecionadas vai para a lixeira e ⌘Z restaura', async () => {
  const { actions, getState } = await import('../src/store.ts')
  const db = actions.createDatabase(null)
  const ids = [actions.createRow(db, {}, { title: 'A' }), actions.createRow(db, {}, { title: 'B' }), actions.createRow(db, {}, { title: 'C' })]
  actions.trackDbUndo('Excluir linhas', db, () => ids.slice(0, 2).forEach((id) => actions.trashPage(id)))
  assert.deepEqual(ids.map((id) => getState().pages[id].trashed), [true, true, false])
  assert.equal(actions.undoDatabase(), true)
  assert.deepEqual(ids.map((id) => getState().pages[id].trashed), [false, false, false])
})
