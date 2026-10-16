import test from 'node:test'
import assert from 'node:assert/strict'
import { convertPlannedCell, countIssues, inferColumn, inferColumns, parseNumberCell, replanColumn, uniqueHeaders } from '../src/components/database/csvInfer.ts'

const infer = (cells: string[], locale = 'pt-BR') => inferColumn(0, 'c', cells, locale)
const num = (cell: string, decimal: '.' | ',' = ',') => parseNumberCell(cell, decimal)?.value

test('números brasileiros e americanos', () => {
  assert.equal(num('1.234,56'), 1234.56); assert.equal(num('1,234.56', '.'), 1234.56)
  assert.equal(num('12,5'), 12.5); assert.equal(num('12.5', '.'), 12.5)
  assert.equal(num('1.234.567'), 1234567); assert.equal(num('1 234,5'), 1234.5)
  assert.equal(num('-123'), -123); assert.equal(num('(123)'), -123)
  assert.equal(num('007'), undefined); assert.equal(num('12abc'), undefined)
  assert.equal(num('1.2.3,4'), undefined)
})
test('coluna numérica, moeda e percentual', () => {
  const a = infer(['10', '2,5', '1.234,56', '(40)', ''])
  assert.equal(a.type, 'number'); assert.equal(a.numberFormat, 'number')
  const brl = infer(['R$ 1.234,56', 'R$ 10,00']); assert.equal(brl.numberFormat, 'currency'); assert.equal(brl.currency, 'BRL')
  assert.equal(convertPlannedCell(brl, 'R$ 1.234,56').value, 1234.56)
  const usd = infer(['$12.50', '$1,000.25'], 'en-US'); assert.equal(usd.currency, 'USD'); assert.equal(convertPlannedCell(usd, '$1,000.25').value, 1000.25)
  const pct = infer(['45%', '12,5%', '100%']); assert.equal(pct.numberFormat, 'percent'); assert.equal(convertPlannedCell(pct, '45%').value, 0.45)
  assert.equal(infer(['45%', '12']).type, 'text')
  assert.equal(infer(['R$ 1,00', '€ 2,00']).type, 'text')
})
test('ambiguidade 1.234 segue o idioma, evidência da coluna vence', () => {
  assert.equal(convertPlannedCell(infer(['1.234', '2.000']), '1.234').value, 1234)
  assert.equal(convertPlannedCell(infer(['1,234', '2,000'], 'en-US'), '1,234').value, 1234)
  assert.equal(convertPlannedCell(infer(['1.5', '1.234']), '1.5').value, 1.5)
})
test('datas ISO, brasileiras, americanas e com hora', () => {
  const iso = infer(['2026-10-08', '2026-01-31']); assert.equal(iso.type, 'date'); assert.ok(!iso.ambiguousDate)
  const br = infer(['25/12/2026', '01/02/2026']); assert.equal(br.dateOrder, 'dmy'); assert.equal(convertPlannedCell(br, '01/02/2026').value && (convertPlannedCell(br, '01/02/2026').value as { start: string }).start, '2026-02-01')
  const us = infer(['12/25/2026', '02/01/2026']); assert.equal(us.dateOrder, 'mdy'); assert.equal((convertPlannedCell(us, '02/01/2026').value as { start: string }).start, '2026-02-01')
  const amb = infer(['01/02/2026', '03/04/2026']); assert.equal(amb.type, 'date'); assert.equal(amb.ambiguousDate, true); assert.equal(amb.dateOrder, 'dmy')
  assert.equal(infer(['01/02/2026', '03/04/2026'], 'en-US').dateOrder, 'mdy')
  const time = infer(['08/10/2026 14:30', '2026-10-09T09:05:00']); assert.deepEqual(convertPlannedCell(time, '08/10/2026 14:30').value, { start: '2026-10-08', startTime: '14:30' })
  assert.equal(infer(['25/12/2026', '12/25/2026']).type, 'text') // conflito dd/mm x mm/dd
  assert.equal(infer(['31/02/2026']).type, 'text')
})
test('checkbox, 1/0 só se a coluna inteira', () => {
  assert.equal(infer(['sim', 'não', 'Sim']).type, 'checkbox'); assert.equal(infer(['true', 'false']).type, 'checkbox')
  assert.equal(infer(['1', '0', '1']).type, 'checkbox'); assert.equal(infer(['1', '0', '2']).type, 'number')
  assert.equal(convertPlannedCell(infer(['sim', 'não']), 'não').value, false)
})
test('url, e-mail, telefone', () => {
  assert.equal(infer(['https://a.com/x', 'www.b.org']).type, 'url')
  assert.equal(infer(['a@b.com', 'x.y@z.com.br']).type, 'email')
  assert.equal(infer(['(11) 99999-8888', '+55 11 3333-4444']).type, 'phone')
  assert.equal(infer(['11999998888', '11888887777']).type, 'number')
  assert.equal(infer(['a@b.com', 'texto']).type, 'text')
})
test('seleção e multisseleção', () => {
  const sel = infer(['Alta', 'Baixa', 'Alta', 'Média', 'Baixa', 'Alta']); assert.equal(sel.type, 'select')
  const multi = infer(['a, b', 'b', 'a', 'a, c', 'c, b', 'b']); assert.equal(multi.type, 'multiSelect'); assert.equal(multi.multiSeparator, ',')
  assert.equal(infer(['x;y', 'y;z', 'x', 'z;x']).multiSeparator, ';')
  assert.equal(infer(['um', 'dois', 'três', 'quatro']).type, 'text') // sem repetição
  assert.equal(infer(['Rua A, 12', 'Av B, 300', 'Rua C, 5', 'Rua D, 9']).type, 'text')
})
test('colunas mistas, vazias e cabeçalhos duplicados', () => {
  assert.equal(infer(['1', 'dois', '3']).type, 'text'); assert.equal(infer(['', ' ', '']).type, 'text')
  assert.deepEqual(uniqueHeaders(['Nome', 'nome', '', 'Nome']), ['Nome', 'nome (2)', 'Coluna 3', 'Nome (3)'])
})
test('troca manual recalcula problemas', () => {
  const plan = infer(['1', 'x', '3']); const n = replanColumn(plan, 'number', ['1', 'x', '3'])
  assert.equal(n.type, 'number'); assert.equal(n.problems, 1); assert.equal(countIssues([n]), 1)
  assert.equal(countIssues([replanColumn(plan, 'ignore', ['1', 'x'])]), 0)
})
test('50 mil linhas em menos de 1 s', () => {
  const rows: string[][] = []
  for (let i = 0; i < 50_000; i++) rows.push([`Item ${i}`, String(i * 1.5).replace('.', ','), `${(i % 28) + 1}/${(i % 12) + 1}/2026`.replace(/^(\d)\//, '0$1/'), i % 2 ? 'sim' : 'não', ['A', 'B', 'C'][i % 3], `R$ ${i},50`])
  const t0 = performance.now()
  const plans = inferColumns(rows, ['t', 'n', 'd', 'c', 's', 'm'])
  const ms = performance.now() - t0
  assert.deepEqual(plans.map((p) => p.type), ['text', 'number', 'date', 'checkbox', 'select', 'number'])
  assert.ok(ms < 1000, `demorou ${ms}ms`)
})
