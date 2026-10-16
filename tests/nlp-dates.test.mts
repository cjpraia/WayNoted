import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNaturalDate, findMarkedDate, toDateValue, parsedInstant, describeNaturalDate, mentionRepeatOf, civilToday } from '../src/nlp/dates.ts'
import { advanceDateValue } from '../src/recurrence.ts'

// Quarta-feira, 7 de outubro de 2026, 10:00 em São Paulo (13:00 UTC).
const now = Date.parse('2026-10-07T13:00:00Z')
const sp = { now, timeZone: 'America/Sao_Paulo' }
const brief = (text: string, options: Parameters<typeof parseNaturalDate>[1] = sp) => {
  const parsed = parseNaturalDate(text, options)
  return parsed ? [parsed.start, parsed.time ?? '', parsed.repeat ?? '', JSON.stringify(parsed.recurrence ?? {})].join(' ').trim() : null
}

test('expressões pedidas no fluxo diário (PT-BR)', () => {
  assert.equal(brief('amanhã às 9h'), '2026-10-08 09:00  {}')
  assert.equal(brief('segunda que vem'), '2026-10-12   {}')
  assert.equal(brief('dia 5'), '2026-11-05   {}')
  assert.equal(brief('dia 7'), '2026-10-07   {}', 'hoje ainda vale')
  assert.equal(brief('todo dia 5 às 9h'), '2026-11-05 09:00 monthly {}')
  assert.equal(brief('daqui a 2 semanas'), '2026-10-21   {}')
  assert.equal(brief('5/11'), '2026-11-05   {}')
  assert.equal(brief('fim do mês'), '2026-10-31   {}')
  assert.equal(brief('em 3 dias úteis'), '2026-10-12   {}', 'pula sábado e domingo')
})

test('variações: dias relativos, dias da semana, números, períodos', () => {
  assert.equal(brief('hoje'), '2026-10-07   {}')
  assert.equal(brief('Amanha'), '2026-10-08   {}')
  assert.equal(brief('depois de amanhã'), '2026-10-09   {}')
  assert.equal(brief('ontem'), '2026-10-06   {}')
  assert.equal(brief('quarta'), '2026-10-07   {}', 'dia da semana sozinho inclui hoje')
  assert.equal(brief('quarta que vem'), '2026-10-14   {}')
  assert.equal(brief('próxima sexta'), '2026-10-09   {}')
  assert.equal(brief('sexta da semana que vem'), '2026-10-16   {}')
  assert.equal(brief('segunda passada'), '2026-10-05   {}')
  assert.equal(brief('sexta 15h'), '2026-10-09 15:00  {}')
  assert.equal(brief('5 de novembro de 2027'), '2027-11-05   {}')
  assert.equal(brief('5 de setembro'), '2027-09-05   {}', 'data já passada vai para o próximo ano')
  assert.equal(brief('05/11/26'), '2026-11-05   {}')
  assert.equal(brief('2026-12-25'), '2026-12-25   {}')
  assert.equal(brief('31/02'), null)
  assert.equal(brief('daqui a um mês'), '2026-11-07   {}')
  assert.equal(brief('em 30 minutos'), '2026-10-07 10:30  {}')
  assert.equal(brief('próxima semana'), '2026-10-12   {}')
  assert.equal(brief('mês que vem'), '2026-11-01   {}')
  assert.equal(brief('fim do ano'), '2026-12-31   {}')
  assert.equal(brief('fim de semana'), '2026-10-10   {}')
  assert.equal(brief('amanhã de manhã'), '2026-10-08 09:00  {}')
  assert.equal(brief('às 3 da tarde'), '2026-10-07 15:00  {}')
  assert.equal(brief('meio-dia'), '2026-10-07 12:00  {}')
  assert.equal(brief('às 9h'), '2026-10-08 09:00  {}', 'hora que já passou vai para amanhã')
  assert.equal(brief('comprar pão'), null)
  assert.equal(brief('segunda e quarta'), null, 'duas datas sem "toda" não formam uma data')
  assert.equal(brief(''), null)
})

test('inglês e ordem mês/dia por idioma', () => {
  assert.equal(brief('tomorrow at 5pm'), '2026-10-08 17:00  {}')
  assert.equal(brief('next friday 3pm'), '2026-10-09 15:00  {}')
  assert.equal(brief('in 2 weeks'), '2026-10-21   {}')
  assert.equal(brief('in 3 business days'), '2026-10-12   {}')
  assert.equal(brief('end of month'), '2026-10-31   {}')
  assert.equal(brief('Nov 5th'), '2026-11-05   {}')
  assert.equal(brief('5/11', { ...sp, locale: 'en-US' }), '2027-05-11   {}')
  assert.equal(brief('12am tomorrow'), '2026-10-08 00:00  {}')
  assert.equal(brief('3 days ago'), '2026-10-04   {}')
})

test('recorrência vira repeat/recurrence compatível com src/recurrence.ts', () => {
  assert.equal(brief('todos os dias às 7h30'), '2026-10-08 07:30 daily {}')
  assert.equal(brief('toda segunda'), '2026-10-12  weekly {}')
  assert.equal(brief('toda segunda e quarta'), '2026-10-07  weekly {"weekdays":[1,3]}')
  assert.equal(brief('toda segunda e quarta até 31/12'), '2026-10-07  weekly {"weekdays":[1,3],"until":"2026-12-31"}')
  assert.equal(brief('dias úteis'), '2026-10-07  weekly {"weekdays":[1,2,3,4,5]}')
  assert.equal(brief('a cada 2 semanas'), '2026-10-07  weekly {"interval":2}')
  assert.equal(brief('todo dia 5 de março'), '2027-03-05  yearly {}')
  assert.equal(brief('every 15th'), '2026-10-15  monthly {}')
  assert.equal(brief('every monday and wednesday'), '2026-10-07  weekly {"weekdays":[1,3]}')
  assert.equal(brief('toda segunda a partir de 19/10'), '2026-10-19  weekly {}')
  const parsed = parseNaturalDate('todo dia 5 às 9h', sp)!
  const value = toDateValue(parsed)
  assert.deepEqual(value, { start: '2026-11-05', startTime: '09:00', repeat: 'monthly' })
  assert.equal(advanceDateValue(value, '2026-11-05')!.start, '2026-12-05')
  assert.equal(mentionRepeatOf(parsed), 'monthly')
  assert.equal(mentionRepeatOf(parseNaturalDate('dias úteis', sp)!), 'weekdays')
  assert.equal(mentionRepeatOf(parseNaturalDate('toda segunda e quarta', sp)!), null)
  assert.equal(mentionRepeatOf(parseNaturalDate('amanhã', sp)!), '')
})

test('toDateValue preserva lembrete e repetição existentes quando o texto não tem regra', () => {
  const value = toDateValue(parseNaturalDate('amanhã', sp)!, { start: '2026-01-01', startTime: '08:00', reminder: 15, repeat: 'weekly', recurrence: { anchor: '2026-01-01' }, end: '2026-01-02' })
  assert.deepEqual(value, { start: '2026-10-08', reminder: 15, repeat: 'weekly' })
})

test('descrição legível ("Entendi: …")', () => {
  assert.equal(describeNaturalDate(parseNaturalDate('amanhã às 9h', sp)!), '8 de outubro de 2026 09:00')
  assert.equal(describeNaturalDate(parseNaturalDate('todo dia 5 às 9h', sp)!), '5 de novembro de 2026 09:00 · Todo mês no dia 5')
  assert.equal(describeNaturalDate(parseNaturalDate('tomorrow at 9am', sp)!, 'en-US'), 'October 8, 2026 9:00 AM')
})

test('"@" dentro de texto livre (nota rápida)', () => {
  const found = findMarkedDate('Ligar pro João @amanhã às 9h sobre o contrato #trabalho', sp)!
  assert.equal(found.start, '2026-10-08'); assert.equal(found.time, '09:00')
  assert.equal('Ligar pro João @amanhã às 9h sobre o contrato'.slice(found.index, found.index + found.length), '@amanhã às 9h')
  const quoted = findMarkedDate('Pagar @"todo dia 5" a conta', sp)!
  assert.equal(quoted.repeat, 'monthly'); assert.equal(quoted.text, '"todo dia 5"')
  assert.equal(findMarkedDate('email para fulano@exemplo.com amanhã', sp), null, '@ no meio de palavra não é marcador')
  assert.equal(findMarkedDate('sem data aqui @nada', sp), null)
})

test('fuso: "hoje/amanhã" seguem o dia civil do fuso pedido', () => {
  // 02:30 UTC de 8/out: ainda 7/out em São Paulo e Nova York, já 8/out em Tóquio e Londres.
  const late = Date.parse('2026-10-08T02:30:00Z')
  assert.equal(parseNaturalDate('amanhã', { now: late, timeZone: 'America/Sao_Paulo' })!.start, '2026-10-08')
  assert.equal(parseNaturalDate('amanhã', { now: late, timeZone: 'America/New_York' })!.start, '2026-10-08')
  assert.equal(parseNaturalDate('amanhã', { now: late, timeZone: 'Asia/Tokyo' })!.start, '2026-10-09')
  assert.equal(parseNaturalDate('amanhã', { now: late, timeZone: 'Europe/London' })!.start, '2026-10-09')
  assert.equal(parseNaturalDate('em 2 horas', { now: late, timeZone: 'America/Sao_Paulo' })!.start, '2026-10-08', 'virada de dia ao somar horas')
})

test('fuso do processo (TZ) é o padrão quando nenhum é informado', () => {
  const previous = process.env.TZ
  try {
    for (const [zone, expected] of [['America/Sao_Paulo', '2026-10-07'], ['Asia/Tokyo', '2026-10-08'], ['Pacific/Kiritimati', '2026-10-08'], ['Pacific/Pago_Pago', '2026-10-07'], ['UTC', '2026-10-08']] as const) {
      process.env.TZ = zone
      assert.equal(civilToday(Date.parse('2026-10-08T02:30:00Z')), expected, zone)
      assert.equal(parseNaturalDate('hoje', { now: Date.parse('2026-10-08T02:30:00Z') })!.start, expected, zone)
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('horário de verão: instante correto em saltos e recuos', () => {
  // Nova York: 8/mar/2026 02:30 não existe (vira 03:30 EDT); 1/nov/2026 01:30 acontece duas vezes (usa a primeira, EDT).
  const ny = 'America/New_York'
  const spring = parseNaturalDate('8/3/2026 às 2h30', { now, timeZone: ny })!
  assert.equal(new Date(parsedInstant(spring, ny)!).toISOString(), '2026-03-08T07:30:00.000Z')
  const fall = parseNaturalDate('amanhã à 1h30', { now: Date.parse('2026-10-31T16:00:00Z'), timeZone: ny })!
  assert.equal(fall.start, '2026-11-01')
  assert.equal(new Date(parsedInstant(fall, ny)!).toISOString(), '2026-11-01T05:30:00.000Z')
  const after = parseNaturalDate('2/11/2026 às 9h', { now, timeZone: ny })!
  assert.equal(new Date(parsedInstant(after, ny)!).toISOString(), '2026-11-02T14:00:00.000Z', 'EST depois do recuo')
  // São Paulo sem horário de verão: UTC−3 o ano todo.
  assert.equal(new Date(parsedInstant(parseNaturalDate('15/1/2027 às 9h', sp)!, 'America/Sao_Paulo')!).toISOString(), '2027-01-15T12:00:00.000Z')
  // Sem hora: meio-dia local (estável em qualquer fuso).
  assert.equal(new Date(parsedInstant(parseNaturalDate('amanhã', sp)!, 'Asia/Tokyo')!).toISOString(), '2026-10-08T03:00:00.000Z')
})
