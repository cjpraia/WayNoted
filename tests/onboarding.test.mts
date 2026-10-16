// Primeiros passos, progresso do dia, retomada, fechamento e erros humanos (lógica pura; sem DOM).
import test from 'node:test'
import assert from 'node:assert/strict'
import { STEPS, markStep, onboardingProgress, checklistVisible, dismissChecklist, reopenChecklist, pickTip, seeTip, emptyHint, TIPS } from '../src/onboarding/model.ts'
import { dayProgress, wordGoal, daySummary, mondayOf, nextMonday, tomorrowOf, weekReviewDue, cleanPriorities, importSummary } from '../src/onboarding/day.ts'
import { pickResume, nextResume } from '../src/onboarding/resume.ts'
import { humanError } from '../src/onboarding/humanError.ts'
import { setStepTracker, trackStep } from '../src/onboarding/tracker.ts'

const tr = (pt: string, en: string, vars?: Record<string, string | number>) => en.replace(/\{(\w+)\}/g, (_m, k) => String(vars?.[k] ?? ''))
const task = (due: string | null, done: boolean) => ({ key: Math.random().toString(), kind: 'checklist', pageId: 'p', title: 't', due, sourceId: 'p', sourceTitle: 'P', done }) as never

test('checklist: marca sozinha, é idempotente e conta progresso', () => {
  let state = markStep(undefined, 'page', 10)
  assert.equal(state.done?.page, 10)
  assert.ok(markStep(state, 'page', 99) === state, 'marcar de novo não muda o estado')
  assert.equal(onboardingProgress(state).done, 1)
  assert.equal(onboardingProgress(state).total, STEPS.length)
  for (const step of STEPS) state = markStep(state, step.id)
  assert.equal(onboardingProgress(state).complete, true)
  assert.equal(checklistVisible(state), false, 'some ao concluir')
})

test('checklist: dispensar e reabrir', () => {
  const state = markStep(undefined, 'search')
  assert.equal(checklistVisible(state), true)
  assert.equal(checklistVisible(dismissChecklist(state)), false)
  assert.equal(checklistVisible(reopenChecklist(dismissChecklist(state))), true)
  assert.equal(checklistVisible(undefined), true)
})

test('tracker: chama o tratador e nunca lança', () => {
  const seen: string[] = []
  setStepTracker(id => { seen.push(id) })
  trackStep('slash')
  setStepTracker(() => { throw new Error('boom') })
  trackStep('daily')
  setStepTracker(null)
  trackStep('capture')
  assert.deepEqual(seen, ['slash'])
})

test('dicas: no máximo uma por sessão, desligáveis e sem repetir', () => {
  assert.ok(pickTip(undefined, false) !== null)
  assert.ok(pickTip(undefined, true) === null, 'já mostrou nesta sessão')
  assert.ok(pickTip({ tipsOff: true }, false) === null)
  const first = pickTip(undefined, false)!
  const next = pickTip(seeTip(undefined, first.id), false)
  assert.notEqual(next?.id, first.id)
  let state = undefined
  for (const tip of TIPS) state = seeTip(state, tip.id)
  assert.ok(pickTip(state, false) === null, 'todas vistas')
  assert.equal(emptyHint('database').keys, 'N')
  assert.equal(emptyHint('page').keys, '/')
})

test('progresso do dia: conta só tarefas de hoje, inclusive herdadas, sem alarme', () => {
  const items = [task('2026-10-08', true), task('2026-10-08', true), task('2026-10-08', false), task('2026-10-09', false), task(null, true)]
  const p = dayProgress(items, '2026-10-08')
  assert.equal(p.done, 2); assert.equal(p.total, 3); assert.equal(p.complete, false)
  assert.ok(Math.abs(p.fraction - 2 / 3) < 1e-9)
  assert.equal(dayProgress([task('2026-10-08', true)], '2026-10-08').complete, true)
  assert.equal(dayProgress([], '2026-10-08').fraction, 0)
})

test('meta de palavras só aparece se configurada', () => {
  assert.ok(wordGoal(100, undefined) === null)
  assert.ok(wordGoal(100, 0) === null)
  assert.equal(wordGoal(420, 500)?.reached, false)
  assert.equal(wordGoal(600, 500)?.fraction, 1)
  assert.equal(wordGoal(600, 500)?.reached, true)
})

test('fechamento: resumo, amanhã, segunda e revisão da semana', () => {
  assert.equal(daySummary(5, 420, tr), 'Today: 5 tasks, 420 words')
  assert.equal(daySummary(1, 0, tr), 'Today: 1 task')
  assert.equal(tomorrowOf('2026-10-31'), '2026-11-01')
  assert.equal(mondayOf('2026-10-08'), '2026-10-05')
  assert.equal(mondayOf('2026-10-11'), '2026-10-05')
  assert.equal(nextMonday('2026-10-09'), '2026-10-12')
  assert.equal(weekReviewDue('2026-10-09', undefined), true, 'sexta')
  assert.equal(weekReviewDue('2026-10-11', undefined), true, 'domingo')
  assert.equal(weekReviewDue('2026-10-08', undefined), false, 'quinta')
  assert.equal(weekReviewDue('2026-10-09', '2026-10-05'), false, 'já tratada')
  assert.deepEqual(cleanPriorities([' a  b ', '', 'c', 'd', 'e']), ['a b', 'c', 'd'])
  assert.equal(importSummary(12, 2, 3, tr), '12 pages, 2 databases, 3 warnings')
})

test('continuar: uma única retomada, ignora lixeira e protegidas', () => {
  const pages = {
    a: { id: 'a', title: 'A', icon: null, trashed: false, updatedAt: 1, text: '  Olá   mundo ' },
    b: { id: 'b', title: 'B', icon: null, trashed: true, updatedAt: 2, text: '' },
    c: { id: 'c', title: 'C', icon: null, trashed: false, updatedAt: 3, text: 'segredo' },
  }
  const withBlock = pickResume({ pageId: 'a', blockId: 'blk', at: 5 }, ['c', 'a'], pages as never)
  assert.equal(withBlock?.pageId, 'a'); assert.equal(withBlock?.blockId, 'blk'); assert.equal(withBlock?.excerpt, 'Olá mundo')
  assert.equal(pickResume({ pageId: 'b', at: 5 }, ['b', 'a'], pages as never)?.pageId, 'a', 'cai para a mais recente viva')
  assert.equal(pickResume(undefined, ['c', 'a'], pages as never, id => id === 'c')?.pageId, 'a', 'protegida fica de fora')
  assert.equal(pickResume(undefined, [], pages as never), null)
  const noBlock = pickResume(undefined, ['a'], pages as never)
  assert.equal(noBlock?.blockId, undefined, 'sem bloco abre no topo')
})

test('retomada: debounce de gravação', () => {
  const first = nextResume(undefined, 'a', 'x', 1000)!
  assert.ok(nextResume(first, 'a', 'x', 2000) === first, 'mesmo ponto em <60 s não regrava')
  assert.equal(nextResume(first, 'a', 'y', 2000)?.blockId, 'y')
  assert.equal(nextResume(first, 'b', undefined, 2000)?.pageId, 'b')
})

test('erros humanos: dizem o que houve e oferecem saída, sem códigos', () => {
  const full = humanError('save', new Error('ENOSPC: no space left on device'), tr)
  assert.ok(/disk is full/.test(full.text)); assert.equal(full.action, 'backup')
  assert.ok(!/ENOSPC/.test(full.text))
  const perm = humanError('export', new Error('EACCES: permission denied'), tr)
  assert.equal(perm.action, 'reveal')
  const pass = humanError('password', new Error('WRONG_PASSWORD: x'), tr)
  assert.ok(/password/.test(pass.text)); assert.equal(pass.action, 'forgot')
  assert.equal(humanError('password', new Error('TOO_MANY_ATTEMPTS'), tr).action, 'retry')
  const bad = humanError('import', new Error('Unexpected end of ZIP'), tr)
  assert.ok(/zip/i.test(bad.text)); assert.ok(bad.actionLabel.length > 0)
  assert.equal(humanError('import', new Error('BUNDLE_IMPORT_TOO_LARGE'), tr).action, 'smaller')
  assert.ok(humanError('save', 'qualquer coisa', tr).text.length > 10)
})

test('fiação: eventos locais marcam os passos e o Meu dia usa um único destaque', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = (file: string) => readFile(new URL(file, import.meta.url), 'utf8')
  const store = await read('../src/store.ts')
  for (const id of ['page', 'database', 'search', 'capture']) assert.ok(store.includes(`trackStep('${id}')`), `store marca ${id}`)
  assert.ok((await read('../src/daily/dailyNotes.ts')).includes("trackStep('daily')"))
  assert.ok((await read('../src/components/page/PageView.tsx')).includes("trackStep('slash')"))
  const home = await read('../src/components/home/HomeView.tsx')
  assert.ok(home.includes('<TodayCard primary={!resume} />'), 'Abrir nota de hoje só é primário sem "Continuar"')
  assert.ok(!/fetch\(|XMLHttpRequest/.test(await read('../src/onboarding/model.ts')), 'sem rede')
  const css = await read('../src/components/home/coach.css')
  assert.ok(css.includes('prefers-reduced-motion'), 'respeita movimento reduzido')
  assert.ok(!/var\(--danger\)/.test(css.split('.co-error')[0]), 'progresso nunca usa vermelho')
})
