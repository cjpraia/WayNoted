import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultCardHidden, CARD_DEFAULT_PROPS } from '../src/components/database/cardDefaults.ts'
import { commandGroup } from '../src/components/modals/commandGroups.ts'
import type { Property } from '../src/types.ts'

const props = (...types: Property['type'][]): Property[] => types.map((type, i) => ({ id: `p${i}`, name: `P${i}`, type }) as Property)

test('visões de cartões novas mostram no máximo 3 propriedades além do título', () => {
  const list = props('title', 'text', 'number', 'select', 'date', 'url', 'email', 'checkbox', 'status', 'text')
  for (const type of ['calendar', 'gallery', 'board'] as const) {
    const hidden = defaultCardHidden(type, list)
    const visible = list.filter(p => p.type !== 'title' && !hidden.includes(p.id))
    assert.equal(visible.length, CARD_DEFAULT_PROPS)
    assert.ok(!hidden.includes('p0'), 'o título nunca é escondido')
  }
})

test('status e seleção têm prioridade nos cartões; agrupamento e data posicionais ficam fora da conta', () => {
  const list = props('title', 'text', 'text', 'text', 'status', 'date')
  const hidden = defaultCardHidden('board', list, ['p4'])
  assert.ok(!hidden.includes('p5'), 'a data entra entre as 3 visíveis quando o status é o agrupamento')
  assert.equal(list.filter(p => p.type !== 'title' && p.id !== 'p4' && !hidden.includes(p.id)).length, 3)
})

test('tabela, lista e bancos pequenos não escondem nada', () => {
  assert.deepEqual(defaultCardHidden('table', props('title', 'text', 'text', 'text', 'text', 'text')), [])
  assert.deepEqual(defaultCardHidden('gallery', props('title', 'text', 'number')), [])
})

test('comandos de navegação do ⌘K têm grupo', () => {
  for (const id of ['trash-open', 'import', 'export', 'backup', 'settings', 'home', 'tasks', 'graph', 'productivity']) assert.ok(commandGroup(id) !== 'page', id)
})
