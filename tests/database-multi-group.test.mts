import test from 'node:test'
import assert from 'node:assert/strict'
import { groupsFor, groupTokens, groupValue, moveGroupValue, groupableProperty, isGroupableType } from '../src/components/database/grouping.ts'

const opt = (id: string, name: string) => ({ id, name, color: 'blue' as const })
const tags = { id: 'tg', name: 'Tags', type: 'multiSelect', options: [opt('a', 'Alpha'), opt('b', 'Beta'), opt('c', 'Gama')] } as any
const status = { id: 'st', name: 'Status', type: 'status', options: [opt('s1', 'A fazer'), opt('s2', 'Feito')] } as any
const rel = { id: 'rl', name: 'Projeto', type: 'relation', relationDatabaseId: 'db2' } as any
const who = { id: 'pe', name: 'Responsável', type: 'person' } as any
const row = (id: string, props: Record<string, unknown>) => ({ id, title: id, props } as any)
const view = (extra = {}) => ({ id: 'v', name: 'v', type: 'table', filters: [], sorts: [], hidden: [], widths: {}, ...extra } as any)
const names = (groups: { label: string; rows: { id: string }[] }[]) => groups.map(g => `${g.label}:${g.rows.map(r => r.id).join(',')}`)

test('multisseleção: a linha entra em TODOS os grupos e a vazia em "Sem valor"', () => {
  const rows = [row('r1', { tg: ['a', 'b'] }), row('r2', { tg: ['b'] }), row('r3', { tg: [] }), row('r4', {}), row('r5', { tg: ['a', 'a', 'zzz'] })]
  const groups = groupsFor(rows, tags, view(), 'Sem tag')
  assert.deepEqual(names(groups), ['Sem tag:r3,r4', 'Alpha:r1,r5', 'Beta:r1,r2'], 'sem repetição, id desconhecido ignorado, grupos vazios ocultos por padrão')
  assert.deepEqual(groups.map(g => g.rows.length), [2, 2, 2], 'contador = tamanho do grupo')
  assert.equal(new Set(groups.flatMap(g => g.rows.map(r => r.id))).size, 5, 'nenhuma linha some')
  // Uma linha com valores só desconhecidos cai em "Sem valor".
  assert.deepEqual(names(groupsFor([row('x', { tg: ['zzz'] })], tags, view(), 'Sem tag')), ['Sem tag:x'])
})

test('grupos vazios, ocultos e ordenação continuam valendo', () => {
  const rows = [row('r1', { tg: ['b', 'c'] })]
  assert.deepEqual(groupsFor(rows, tags, view({ hideEmptyGroups: false }), 'Sem').map(g => g.label), ['Sem', 'Alpha', 'Beta', 'Gama'])
  assert.deepEqual(groupsFor(rows, tags, view({ hiddenGroups: ['tg:b'] }), 'Sem').map(g => g.label), ['Gama'])
  assert.deepEqual(groupsFor([row('r1', { tg: ['c', 'a'] }), row('r2', {})], tags, view({ groupSort: 'reverse' }), 'Sem').map(g => g.label), ['Gama', 'Alpha', 'Sem'])
  // Select/status: comportamento antigo (um grupo por linha; valor inexistente vai para "Sem valor").
  const byStatus = groupsFor([row('r1', { st: 's2' }), row('r2', { st: 'fantasma' }), row('r3', {})], status, view(), 'Sem status')
  assert.deepEqual(names(byStatus), ['Sem status:r2,r3', 'Feito:r1'])
})

test('relação: um grupo por página relacionada (só páginas vivas); pessoa: nomes separados por vírgula', () => {
  const pages = { p1: { id: 'p1', title: 'Obra' }, p2: { id: 'p2', title: 'Livro' }, p3: { id: 'p3', title: 'Lixo', trashed: true } } as any
  const rows = [row('r1', { rl: ['p1', 'p2'] }), row('r2', { rl: ['p1', 'p3'] }), row('r3', { rl: ['p3'] }), row('r4', {})]
  const groups = groupsFor(rows, rel, view(), 'Sem projeto', pages)
  assert.deepEqual(names(groups), ['Livro:r1', 'Obra:r1,r2', 'Sem projeto:r3,r4'], 'alfabético, "Sem valor" no fim; página na lixeira não vira grupo')
  const people = groupsFor([row('r1', { pe: 'Ana, Bia' }), row('r2', { pe: 'ana' }), row('r3', { pe: '  ' }), row('r4', {})], who, view(), 'Sem resp.')
  assert.deepEqual(names(people), ['Ana:r1,r2', 'Bia:r1', 'Sem resp.:r3,r4'], 'nomes iguais sem diferença de caixa agrupam juntos')
})

test('tipos agrupáveis', () => {
  for (const type of ['select', 'status', 'multiSelect', 'relation', 'person']) assert.ok(isGroupableType(type))
  for (const type of ['text', 'number', 'date', 'checkbox', 'rollup']) assert.ok(!isGroupableType(type))
  const schema = { properties: [tags, rel, { id: 'x', name: 'X', type: 'text' }], views: [], activeViewId: '' } as any
  assert.equal(groupableProperty(schema, 'tg')?.id, 'tg'); assert.equal(groupableProperty(schema, 'rl')?.id, 'rl'); assert.equal(groupableProperty(schema, 'x'), undefined)
})

test('arrastar entre grupos adiciona/remove só o valor do grupo', () => {
  const r = row('r1', { tg: ['a', 'b'] })
  assert.deepEqual(moveGroupValue(r, tags, 'a', 'c'), ['b', 'c'], 'sai de Alpha, entra em Gama, mantém Beta')
  assert.deepEqual(moveGroupValue(r, tags, 'a', 'b'), ['b'], 'destino que já tinha não duplica')
  assert.deepEqual(moveGroupValue(r, tags, 'a', null), ['b'], 'soltar em "Sem valor" só remove o valor de origem')
  assert.deepEqual(moveGroupValue(r, tags, null, 'c'), ['a', 'b', 'c'], 'vindo de "Sem valor" só acrescenta')
  assert.deepEqual(moveGroupValue(row('r2', { tg: ['a'] }), tags, 'a', null), [], 'o último valor removido deixa a lista vazia')
  assert.equal(moveGroupValue(row('r3', { st: 's1' }), status, 's1', 's2'), 's2', 'select/status troca o valor')
  assert.equal(moveGroupValue(row('r3', { st: 's1' }), status, 's1', null), null)
  assert.deepEqual(moveGroupValue(row('r4', { rl: ['p1', 'p2'] }), rel, 'p1', 'p9'), ['p2', 'p9'])
  assert.equal(moveGroupValue(row('r5', { pe: 'Ana, Bia' }), who, 'ana', 'caio', undefined, 'Caio'), 'Bia, Caio')
  assert.equal(moveGroupValue(row('r5', { pe: 'Ana' }), who, 'ana', null), null)
  assert.equal(moveGroupValue(row('r6', { pe: 'Ana, Bia' }), who, 'ana', 'bia'), 'Bia', 'destino que já estava não duplica')
})

test('valor inicial de linha criada dentro de um grupo', () => {
  assert.deepEqual(groupValue(tags, 'b'), ['b']); assert.deepEqual(groupValue(tags, null), [])
  assert.equal(groupValue(status, 's1'), 's1'); assert.equal(groupValue(status, null), null)
  assert.deepEqual(groupValue(rel, 'p1'), ['p1']); assert.equal(groupValue(who, 'ana', 'Ana'), 'Ana')
  assert.deepEqual(groupTokens(row('r', { tg: ['a'] }), tags), ['a'])
})
