import test from 'node:test'
import assert from 'node:assert/strict'
import { dependentOptions } from '../src/components/database/dependentOptions.ts'
import { contrastRatio, customColorTokens, customColorStyle, normalizeHex } from '../src/components/database/customColors.ts'
import { crossTab, cumulative, sankeyLayout, squarify, cellKey } from '../src/components/database/views/chartData.ts'
import { highlightFormula, formulaSuggestions, applySuggestion, enclosingCall, completionContext } from '../src/components/database/editors/formulaEditing.ts'

const category = { id: 'cat', name: 'Categoria', type: 'select', options: [{ id: 'food', name: 'Comida', color: 'green' }, { id: 'tech', name: 'Tecnologia', color: 'blue' }] }
const sub = {
  id: 'sub', name: 'Subcategoria', type: 'multiSelect',
  options: [{ id: 'fruit', name: 'Fruta', color: 'green' }, { id: 'phone', name: 'Celular', color: 'blue' }, { id: 'pc', name: 'Computador', color: 'blue' }, { id: 'other', name: 'Outros', color: 'gray' }],
  dependsOn: { propertyId: 'cat', links: { fruit: ['food'], phone: ['tech'], pc: ['tech'] } },
}
const schema = { properties: [{ id: 'title', name: 'Nome', type: 'title' }, category, sub], views: [], activeViewId: '' }
const row = (props) => ({ id: 'r', parentId: 'db', title: 'x', props })

test('seleção dependente mostra só opções ligadas ao valor da propriedade-mãe', () => {
  assert.deepEqual(dependentOptions(sub, schema, row({ cat: 'tech' })).options.map((o) => o.id), ['phone', 'pc', 'other'])
  assert.deepEqual(dependentOptions(sub, schema, row({ cat: 'food' })).options.map((o) => o.id), ['fruit', 'other'])
  // Mãe vazia ou opção removida: sem filtro.
  assert.equal(dependentOptions(sub, schema, row({})).options.length, 4)
  assert.equal(dependentOptions(sub, schema, row({ cat: 'apagada' })).options.length, 4)
  assert.equal(dependentOptions(sub, schema, undefined).options.length, 4)
  // Mãe multisseleção: união das opções ligadas.
  const multiParent = { ...category, type: 'multiSelect' }
  const schemaMulti = { ...schema, properties: [multiParent, sub] }
  assert.deepEqual(dependentOptions(sub, schemaMulti, row({ cat: ['food', 'tech'] })).options.map((o) => o.id), ['fruit', 'phone', 'pc', 'other'])
  // Valores já escolhidos que deixaram de combinar são sinalizados.
  const result = dependentOptions(sub, schema, row({ cat: 'food' }), ['phone', 'fruit'])
  assert.deepEqual(result.mismatched, ['phone'])
  assert.equal(result.parent.id, 'cat')
  // Sem configuração ou com mãe de tipo inválido: todas as opções.
  assert.equal(dependentOptions({ ...sub, dependsOn: undefined }, schema, row({ cat: 'food' })).options.length, 4)
  assert.equal(dependentOptions({ ...sub, dependsOn: { propertyId: 'title', links: {} } }, schema, row({ cat: 'food' })).options.length, 4)
})

test('cores personalizadas têm contraste legível nos dois temas', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc')
  assert.equal(normalizeHex('12ab34'), '#12ab34')
  assert.equal(normalizeHex('azul'), null)
  for (const hex of ['#ffff00', '#00ff00', '#000080', '#ff0000', '#ffffff', '#000000', '#7f7f7f', '#22d3ee']) {
    const tokens = customColorTokens(hex)
    assert.ok(contrastRatio(tokens.lightText, tokens.lightBg) >= 4.5, `claro ${hex}: ${contrastRatio(tokens.lightText, tokens.lightBg)}`)
    assert.ok(contrastRatio(tokens.darkText, tokens.darkBg) >= 4.5, `escuro ${hex}: ${contrastRatio(tokens.darkText, tokens.darkBg)}`)
  }
  assert.equal(customColorStyle('#ff8800')['--cc-dot'], '#ff8800')
  assert.equal(customColorStyle('ruim'), undefined)
  assert.equal(customColorStyle(undefined), undefined)
})

test('gráficos: tabela cruzada, acumulado, treemap e Sankey', () => {
  const rows = [{ id: 'a', s: ['x'], t: ['p', 'q'], n: 2 }, { id: 'b', s: ['x'], t: ['p'], n: 3 }, { id: 'c', s: ['y'], t: ['q'], n: 5 }]
  const by = (field) => (row) => row[field].map((key) => ({ key, label: key.toUpperCase() }))
  const sum = (list) => list.reduce((total, row) => total + row.n, 0)
  const cross = crossTab(rows, by('s'), by('t'), sum, (a, b) => a.key.localeCompare(b.key))
  assert.deepEqual(cross.primary.map((b) => b.key), ['x', 'y'])
  assert.deepEqual(cross.secondary.map((b) => b.key).sort(), ['p', 'q'])
  assert.equal(cross.cells.get(cellKey('x', 'p')).value, 5)
  assert.deepEqual(cross.cells.get(cellKey('x', 'q')).rows.map((r) => r.id), ['a'])
  assert.equal(cross.totals.get('x').value, 5)
  assert.equal(cross.totals.get('x').rows.length, 2)
  assert.deepEqual(cumulative([1, 2, 3, -1]), [1, 3, 6, 5])

  const rects = squarify([{ key: 'a', value: 6 }, { key: 'b', value: 6 }, { key: 'c', value: 4 }, { key: 'd', value: 3 }, { key: 'e', value: 2 }, { key: 'f', value: 2 }, { key: 'g', value: 1 }, { key: 'z', value: 0 }], 0, 0, 600, 400)
  assert.equal(rects.length, 7)
  const area = rects.reduce((total, r) => total + r.w * r.h, 0)
  assert.ok(Math.abs(area - 240000) < 1, `área ${area}`)
  for (const r of rects) { assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6, r.key); assert.ok(Math.abs(r.w * r.h - r.value * 240000 / 24) < 1, r.key) }
  assert.deepEqual(squarify([], 0, 0, 10, 10), [])

  const layout = sankeyLayout([{ key: 'x', value: 0 }, { key: 'y', value: 0 }], [{ key: 'p', value: 0 }, { key: 'q', value: 0 }], [{ source: 'x', target: 'p', value: 5 }, { source: 'x', target: 'q', value: 2 }, { source: 'y', target: 'q', value: 5 }], 200, 10)
  const node = (side, key) => layout.nodes.find((n) => n.side === side && n.key === key)
  assert.equal(node('left', 'x').value, 7)
  assert.equal(node('right', 'q').value, 7)
  assert.ok(node('left', 'y').y >= node('left', 'x').y + node('left', 'x').h + 10 - 1e-9)
  // Faixas que saem do mesmo nó ficam empilhadas sem sobreposição.
  const fromX = layout.links.filter((l) => l.source === 'x').sort((a, b) => a.sy - b.sy)
  assert.ok(Math.abs(fromX[1].sy - (fromX[0].sy + fromX[0].h)) < 1e-9)
  const intoQ = layout.links.filter((l) => l.target === 'q').sort((a, b) => a.ty - b.ty)
  assert.ok(Math.abs(intoQ[1].ty - (intoQ[0].ty + intoQ[0].h)) < 1e-9)
  assert.ok(layout.nodes.every((n) => n.y + n.h <= 200 + 1e-9))
})

test('editor de fórmula: realce, sugestões, autocompletar e documentação sob o cursor', () => {
  const segments = highlightFormula('if(prop("Preço") > 10, upper(Nome), "x") // ok', ['Preço', 'Nome'])
  const kinds = Object.fromEntries(segments.filter((s) => s.kind !== 'text').map((s) => [s.text, s.kind]))
  assert.equal(kinds.if, 'function')
  assert.equal(kinds['"Preço"'], 'property')
  assert.equal(kinds.Nome, 'property')
  assert.equal(kinds['10'], 'number')
  assert.equal(kinds['"x"'], 'string')
  assert.equal(kinds['// ok'], 'comment')
  assert.equal(highlightFormula('foo(1)', []).find((s) => s.text === 'foo').kind, 'unknown')
  assert.equal(highlightFormula('"aberta', []).map((s) => s.text).join(''), '"aberta')
  const marked = highlightFormula('1 + bad(2)', [], { at: 4, end: 7 }).filter((s) => s.error).map((s) => s.text).join('')
  assert.equal(marked, 'bad')

  const names = ['Preço', 'Data de entrega', 'Status']
  const { suggestions, from } = formulaSuggestions('round(Pre', 9, names)
  assert.equal(suggestions[0].label, 'Preço')
  assert.equal(from, 6)
  assert.equal(formulaSuggestions('dateA', 5, names).suggestions[0].label, 'dateAdd')
  const spaced = formulaSuggestions('Data', 4, names).suggestions.find((s) => s.label === 'Data de entrega')
  assert.equal(spaced.insert, 'prop("Data de entrega")')
  assert.equal(formulaSuggestions('1 + ', 4, names).suggestions.length, 0)
  const inside = completionContext('prop("St', 8)
  assert.equal(inside.insidePropString, true)
  const applied = applySuggestion('prop("St', inside.from, 8, { kind: 'property', label: 'Status', insert: 'Status', detail: '' }, true)
  assert.equal(applied.source, 'prop("Status")')
  assert.equal(applied.caret, applied.source.length)
  const method = formulaSuggestions('[1].ma', 6, names)
  assert.ok(method.suggestions.every((s) => s.kind === 'function'))
  assert.equal(applySuggestion('[1].ma', method.from, 6, method.suggestions.find((s) => s.label === 'map')).source, '[1].map(')
  assert.equal(enclosingCall('dateAdd(now(), ', 15).name, 'dateAdd')
  assert.equal(enclosingCall('round(1, 2) + ', 14), undefined)
})
