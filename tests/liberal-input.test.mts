// Postel: entradas liberais (URL, número, data) com saída canônica; Flow: fila de toasts; atenção seletiva: atenuação.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLooseUrl, parseLooseNumber, looseNumberValue } from '../src/input/liberal.ts'
import { parseNaturalDate } from '../src/nlp/dates.ts'
import { normalizeText } from '../src/search/normalize.ts'
import { TypingTracker, DIM_AFTER_MS, TYPING_GAP_MS } from '../src/focus/dimChrome.ts'
import { showToast, showUndoToast, dismissToast, clearToasts, visibleToasts, toastCount, TOAST_MS, TOAST_VISIBLE } from '../src/components/ui/toastQueue.ts'
import { getViewState, patchViewState, routeStateKey, clearViewStates } from '../src/navigation/viewState.ts'

test('URL: com/sem https, www., espaços, <url>, Markdown e aspas dão a mesma saída', () => {
  const same = ['https://exemplo.com/a', 'exemplo.com/a', '  https://exemplo.com/a  ', '<https://exemplo.com/a>', '"exemplo.com/a"', '[ver](https://exemplo.com/a)', '[ver](<exemplo.com/a>)', '//exemplo.com/a']
  for (const input of same) assert.equal(parseLooseUrl(input)?.url, 'https://exemplo.com/a', input)
  assert.equal(parseLooseUrl('www.exemplo.com')?.url, 'https://www.exemplo.com')
  assert.equal(parseLooseUrl('[ver](https://exemplo.com)')?.label, 'ver')
  assert.equal(parseLooseUrl('localhost:3000/x')?.url, 'http://localhost:3000/x')
  assert.equal(parseLooseUrl('mailto:ana@exemplo.com')?.url, 'mailto:ana@exemplo.com')
  assert.equal(parseLooseUrl('HTTP://Exemplo.com/Caminho?q=1#t')?.url, 'http://exemplo.com/Caminho?q=1#t')
})

test('URL: rejeita o que não é link e esquemas perigosos', () => {
  for (const input of ['', 'olá mundo', 'javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'https://u:p@exemplo.com', 'palavra', 'a.b', 'https://um.com https://dois.com', 'exemplo .com']) assert.equal(parseLooseUrl(input), null, input)
})

test('números: 1.234,56, 1,234.56, R$ 12, 12%, (40), sinal Unicode, espaços', () => {
  const v = (s: string) => parseLooseNumber(s)?.value
  assert.equal(v('1.234,56'), 1234.56); assert.equal(v('1,234.56'), 1234.56)
  assert.equal(v('R$ 12'), 12); assert.equal(v('R$ 1.234,50'), 1234.5); assert.equal(v('US$ 9.99'), 9.99); assert.equal(v('12 reais'), 12)
  assert.equal(v('12%'), 12); assert.equal(v('12,5 %'), 12.5)
  assert.equal(v('(40)'), -40); assert.equal(v('−3,5'), -3.5); assert.equal(v('1 234,5'), 1234.5)
  assert.equal(v('12,'), 12); assert.equal(v(',5'), 0.5); assert.equal(v('1.234.567'), 1234567); assert.equal(v('1,234,567'), 1234567)
  assert.equal(v('3.14'), 3.14); assert.equal(v('007'), 7)
  assert.equal(parseLooseNumber('R$ 12')?.currency, 'BRL'); assert.equal(parseLooseNumber('12%')?.percent, true)
  for (const bad of ['', 'abc', '12abc', '1.2.3,4', '1,2,3', '--1', '12%%']) assert.equal(parseLooseNumber(bad), null, bad)
  assert.equal(looseNumberValue('12%', true), 0.12); assert.equal(looseNumberValue('12%', false), 12)
})

test('datas em linguagem natural (PT-BR): amanhã, seg, 5/11, dia 5', () => {
  const now = Date.parse('2026-10-07T13:00:00Z') // quarta
  const o = { now, timeZone: 'America/Sao_Paulo' }
  assert.equal(parseNaturalDate('amanhã', o)?.start, '2026-10-08')
  assert.equal(parseNaturalDate('AMANHA', o)?.start, '2026-10-08', 'sem acento e maiúsculas')
  assert.equal(parseNaturalDate('seg', o)?.start, '2026-10-12')
  assert.equal(parseNaturalDate('5/11', o)?.start, '2026-11-05')
  assert.equal(parseNaturalDate('dia 5', o)?.start, '2026-11-05')
  assert.equal(parseNaturalDate('hoje', o)?.start, '2026-10-07')
})

test('busca tolera acento e caixa (⌘K)', () => {
  assert.equal(normalizeText('Ação'), normalizeText('acao')); assert.equal(normalizeText('ÉPICO'), normalizeText('epico'))
})

test('atenuação: só após 3 s de digitação contínua; pausa ou mouse soltam', () => {
  const changes: boolean[] = []
  const tracker = new TypingTracker(value => changes.push(value))
  let now = 1000
  for (let i = 0; i < 20; i++) { tracker.key(now); now += 200 } // 4 s digitando
  assert.equal(tracker.isDimmed, true); assert.deepEqual(changes, [true])
  tracker.release(); assert.equal(tracker.isDimmed, false)
  // Pausa maior que o intervalo reinicia a contagem.
  const t2 = new TypingTracker(() => {})
  t2.key(0); t2.key(1000); t2.key(1000 + TYPING_GAP_MS + 1); t2.key(1000 + TYPING_GAP_MS + 2500)
  assert.equal(t2.isDimmed, false)
  const t3 = new TypingTracker(() => {})
  for (let t = 0; t <= DIM_AFTER_MS; t += 500) t3.key(t)
  assert.equal(t3.isDimmed, true)
  t3.tick(DIM_AFTER_MS + TYPING_GAP_MS + 10); assert.equal(t3.isDimmed, false, 'parou de digitar')
})

test('toasts: fila única, ≤ 4 s, desfazer, máximo visível e deduplicação', () => {
  clearToasts()
  assert.ok(TOAST_MS <= 4000)
  let undone = 0
  const id = showUndoToast('Movida', () => { undone++ })
  assert.equal(visibleToasts()[0].actionLabel, 'Desfazer')
  visibleToasts()[0].onAction?.(); assert.equal(undone, 1)
  dismissToast(id); assert.equal(toastCount(), 0)
  for (let i = 0; i < 6; i++) showToast({ message: `m${i}` })
  assert.equal(toastCount(), 6); assert.equal(visibleToasts().length, TOAST_VISIBLE)
  dismissToast(visibleToasts()[0].id); assert.equal(visibleToasts()[0].message, 'm1'); assert.equal(visibleToasts().length, TOAST_VISIBLE, 'a fila avança')
  clearToasts()
  showToast({ message: 'igual' }); showToast({ message: 'igual' }); assert.equal(toastCount(), 1)
  assert.equal(showToast({ message: 'longo', duration: 60000 }) > 0, true); assert.ok(visibleToasts().at(-1)!.duration <= 10000)
  clearToasts()
})

test('Flow: rolagem e seleção por aba+rota ficam em memória e o mais antigo sai no teto', () => {
  clearViewStates()
  const a = routeStateKey({ type: 'page', id: 'p1' }, 'tab1'), b = routeStateKey({ type: 'page', id: 'p1' }, 'tab2')
  assert.notEqual(a, b)
  patchViewState(a, { scrollTop: 420 }); patchViewState(a, { selection: { from: 3, to: 9, focused: true } })
  assert.equal(getViewState(a)?.scrollTop, 420); assert.deepEqual(getViewState(a)?.selection, { from: 3, to: 9, focused: true })
  assert.equal(getViewState(b), undefined)
  for (let i = 0; i < 260; i++) patchViewState(`k${i}`, { scrollTop: i })
  assert.equal(getViewState(a), undefined, 'excedeu o teto')
  assert.equal(getViewState('k259')?.scrollTop, 259)
  assert.equal(routeStateKey({ type: 'tasks' }, null), '-|tasks|')
})
