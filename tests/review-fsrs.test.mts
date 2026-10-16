// Revisão espaçada (A6): FSRS-lite determinístico, fila, notas com desfazer, estatísticas e cartões de alternância.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PARAMS, intervalDays, intervalLabel, isDue, LEARN_STEP_MS, newCard, normalizeParams, retrievability, reviewCard, scheduleAll, startOfDay } from '../src/review/fsrs.ts'
import { addCards, applyRating, buildQueue, extractToggleCards, forecast, localDayOf, queueOrder, removeCards, reviewStats, undoRating, type ReviewSettings } from '../src/review/reviewCore.ts'

const NOW = new Date(2026, 9, 9, 10, 0, 0).getTime()
const DAY = 86_400_000
const dayAt = (offset: number, hour = 10) => new Date(2026, 9, 9 + offset, hour).getTime()

test('curva de esquecimento: 90 % no dia da estabilidade e intervalo igual à estabilidade', () => {
  assert.equal(retrievability(0, 5), 1)
  assert.ok(Math.abs(retrievability(5, 5) - 0.9) < 1e-12)
  assert.ok(Math.abs(intervalDays(7, 0.9) - 7) < 1e-9)
  assert.ok(intervalDays(7, 0.95) < 7 && intervalDays(7, 0.8) > 7, 'mais retenção = intervalo menor')
  assert.equal(retrievability(3, 0), 0)
})

test('cartão novo: quatro notas dão De novo em minutos e intervalos crescentes em dias', () => {
  const all = scheduleAll(newCard(NOW), NOW)
  assert.equal(all[1].days, 0)
  assert.equal(all[1].card.due, NOW + LEARN_STEP_MS)
  assert.equal(all[1].card.phase, 'learning')
  assert.deepEqual([all[2].days, all[3].days, all[4].days], [1, 4, 14])
  assert.equal(all[3].card.due, startOfDay(NOW, 4))
  assert.equal(all[3].card.reps, 1)
  assert.equal(all[3].card.phase, 'review')
  assert.ok(all[1].card.difficulty > all[3].card.difficulty && all[3].card.difficulty > all[4].card.difficulty)
})

test('determinismo: o mesmo estado e o mesmo instante dão o mesmo resultado, sem aleatoriedade', () => {
  const first = scheduleAll(reviewCard(newCard(NOW), 3, NOW), dayAt(4), { retention: 0.9 })
  const second = scheduleAll(reviewCard(newCard(NOW), 3, NOW), dayAt(4), { retention: 0.9 })
  assert.deepEqual(first, second)
})

test('acertos seguidos aumentam o intervalo; errar derruba a estabilidade e conta o lapso', () => {
  let card = newCard(NOW)
  let when = NOW
  const gaps: number[] = []
  for (let i = 0; i < 5; i++) {
    const plan = scheduleAll(card, when)
    gaps.push(plan[3].days)
    card = plan[3].card
    when = card.due + 3_600_000
  }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `intervalo cresce: ${gaps.join(',')}`)
  const lapsed = reviewCard(card, 1, when)
  assert.equal(lapsed.lapses, 1)
  assert.equal(lapsed.phase, 'relearning')
  assert.ok(lapsed.stability < card.stability)
  assert.ok(lapsed.difficulty >= card.difficulty)
  assert.equal(lapsed.due, when + LEARN_STEP_MS)
})

test('Difícil nunca passa de Bom e Fácil é sempre maior que Bom; o teto de intervalo vale', () => {
  const base = reviewCard(newCard(NOW), 3, NOW)
  const plan = scheduleAll(base, dayAt(4))
  assert.ok(plan[2].days <= plan[3].days && plan[3].days < plan[4].days)
  const capped = scheduleAll(base, dayAt(4), { maxInterval: 5 })
  assert.ok(capped[4].days <= 5 && capped[3].days <= 5)
  assert.equal(normalizeParams({ retention: 5, maxInterval: -2 }).retention, 0.97)
  assert.equal(normalizeParams({ retention: 5, maxInterval: -2 }).maxInterval, 1)
  assert.deepEqual(normalizeParams(null), DEFAULT_PARAMS)
})

test('revisar antes do prazo cresce menos do que revisar no prazo', () => {
  const card = reviewCard(newCard(NOW), 3, NOW)
  const early = reviewCard(card, 3, NOW + DAY)
  const onTime = reviewCard(card, 3, NOW + 4 * DAY)
  assert.ok(early.stability < onTime.stability)
})

test('isDue: novo sempre; devido até o fim do dia local; amanhã não', () => {
  const card = reviewCard(newCard(NOW), 3, NOW)
  assert.equal(isDue(newCard(NOW), NOW), true)
  assert.equal(isDue({ ...card, due: dayAt(0, 23) }, NOW), true)
  assert.equal(isDue({ ...card, due: dayAt(1, 0) }, NOW), false)
  assert.equal(intervalLabel(0, 'pt-BR'), '10 min')
  assert.equal(intervalLabel(1, 'pt-BR'), '1 dia')
  assert.equal(intervalLabel(14, 'en-US'), '14 days')
  assert.equal(intervalLabel(60, 'pt-BR'), '2 meses')
})

const settingsWith = (keys: string[], extra: ReviewSettings = {}): ReviewSettings => ({ ...addCards(extra, keys, NOW) })

test('fila: devidos por data, novos até o limite diário, páginas indisponíveis ignoradas', () => {
  let settings = settingsWith(['a', 'b', 'c', 'd', 'gone', 'trash#blk'], { newPerDay: 2 })
  // a: devido ontem, b: devido hoje, c: devido amanhã.
  const cards = { ...settings.cards! }
  cards.a = { ...reviewCard(newCard(NOW), 3, NOW - 9 * DAY), due: dayAt(-1) }
  cards.b = { ...reviewCard(newCard(NOW), 3, NOW - 9 * DAY), due: dayAt(0, 20) }
  cards.c = { ...reviewCard(newCard(NOW), 3, NOW - 9 * DAY), due: dayAt(1) }
  settings = { ...settings, cards }
  const ok = (id: string) => id !== 'gone' && id !== 'trash'
  const queue = buildQueue({ settings, now: NOW, pageOk: ok })
  assert.deepEqual(queue.due, ['a', 'b'])
  assert.deepEqual(queue.fresh, ['d'])
  assert.equal(queue.waiting, 0)
  assert.deepEqual(queueOrder(queue), ['a', 'b', 'd'])
  assert.equal(queue.total, 3)
  // Limite de novos considera os já apresentados hoje.
  const more = buildQueue({ settings: { ...settings, cards: { ...settings.cards, e: newCard(NOW), f: newCard(NOW), d: newCard(NOW) }, log: { [localDayOf(NOW)]: [1, 1, 1] } }, now: NOW, pageOk: ok })
  assert.equal(more.fresh.length, 1)
  assert.equal(more.waiting, 2)
})

test('nota grava cartão e contagem do dia; desfazer restaura os dois', () => {
  const start = settingsWith(['p'])
  const first = applyRating(start, 'p', 3, NOW)!
  assert.equal(first.settings.cards!.p.reps, 1)
  assert.deepEqual(first.settings.log![localDayOf(NOW)], [1, 1, 1])
  const second = applyRating(first.settings, 'p', 1, dayAt(4))!
  assert.deepEqual(second.settings.log![localDayOf(dayAt(4))], [1, 0, 0])
  assert.equal(second.settings.cards!.p.lapses, 1)
  const back = undoRating(second.settings, second.undo)
  assert.deepEqual(back.cards!.p, first.settings.cards!.p)
  assert.equal(back.log![localDayOf(dayAt(4))], undefined)
  const reset = undoRating(first.settings, first.undo)
  assert.equal(reset.cards!.p.phase, 'new')
  assert.equal(reset.log![localDayOf(NOW)], undefined)
  assert.equal(applyRating(start, 'inexistente', 3, NOW), null)
})

test('estatísticas: retenção em 30 dias, sequência e previsão', () => {
  const log: ReviewSettings['log'] = {}
  for (let i = 0; i < 3; i++) log[localDayOf(dayAt(-i))] = [10, 9, 0]
  log[localDayOf(dayAt(-5))] = [10, 5, 0]
  const stats = reviewStats({ log }, NOW)
  assert.equal(stats.streak, 3)
  assert.equal(stats.today, 10)
  assert.equal(stats.retention, Math.round((27 + 5) / 40 * 100))
  // Sem revisão hoje a sequência conta até ontem.
  const quiet = reviewStats({ log: { [localDayOf(dayAt(-1))]: [4, 4, 0], [localDayOf(dayAt(-2))]: [2, 1, 0] } }, NOW)
  assert.equal(quiet.streak, 2)
  assert.equal(reviewStats(undefined, NOW).retention, null)
  const cards = { x: { ...reviewCard(newCard(NOW), 3, NOW), due: dayAt(0, 18) }, y: { ...reviewCard(newCard(NOW), 3, NOW), due: dayAt(2, 3) }, z: newCard(NOW) }
  assert.deepEqual(forecast({ cards }, NOW, 4), [1, 0, 1, 0])
})

test('marcar e remover cartões; blocos de alternância viram pergunta/resposta', () => {
  const marked = addCards(undefined, ['p1', 'p2#b1'], NOW)
  assert.deepEqual(Object.keys(marked.cards!).sort(), ['p1', 'p2#b1'])
  assert.equal(addCards(marked, ['p1'], dayAt(3)).cards!.p1.due, NOW, 'não recria cartão existente')
  assert.deepEqual(Object.keys(removeCards(marked, key => key.startsWith('p2')).cards!), ['p1'])
  const blocks = [
    { id: 't1', type: 'toggleListItem', content: [{ type: 'text', text: 'Capital da França?' }], children: [{ id: 'c1', type: 'paragraph', content: [{ type: 'text', text: 'Paris' }], children: [] }] },
    { id: 't2', type: 'toggleListItem', content: [{ type: 'text', text: 'Sem filhos' }], children: [] },
    { id: 'h', type: 'heading', content: [], children: [{ id: 't3', type: 'toggleListItem', content: [{ type: 'text', text: 'Aninhado' }], children: [{ id: 'c3', type: 'paragraph', content: [{ type: 'text', text: 'Resposta ' }, { type: 'text', text: 'dois' }], children: [] }] }] },
  ]
  assert.deepEqual(extractToggleCards(blocks), [
    { blockId: 't1', front: 'Capital da França?', back: 'Paris' },
    { blockId: 't3', front: 'Aninhado', back: 'Resposta dois' },
  ])
  assert.deepEqual(extractToggleCards(null), [])
})
