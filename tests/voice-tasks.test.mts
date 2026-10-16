import PRODUCT from '../shared/product.json' with { type: 'json' }
// Captura por voz → tarefas (B3): heurística de separação, data/prioridade, controlador de ditado e criação com guardas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractVoiceTasks, itemsToVoiceTasks, splitTranscript } from '../src/voice/taskExtract.ts'
import { parseItems, splitPrompt } from '../src/voice/aiSplit.ts'
import { createVoiceCapture } from '../src/voice/voiceCapture.ts'

const NOW = new Date(2026, 9, 9, 10).getTime() // sexta, 9 de outubro de 2026
let seq = 0
const makeId = () => `t${++seq}`
const brief = (text: string, locale: 'pt-BR' | 'en-US' = 'pt-BR') => extractVoiceTasks(text, { now: NOW, locale, makeId }).map(task => [task.title, task.date, task.time, task.priority])

test('separa por conectores e extrai data, hora e prioridade (pt-BR)', () => {
  assert.deepEqual(brief('preciso ligar para o João amanhã às 10 e depois comprar pão e leite urgente além disso lembrar de pagar a conta de luz na sexta que vem'), [
    ['Ligar para o João', '2026-10-10', '10:00', 'normal'],
    ['Comprar pão e leite', null, null, 'high'],
    ['Pagar a conta de luz', '2026-10-16', null, 'normal'],
  ])
  assert.deepEqual(brief('Marcar dentista dia 20, prioridade baixa. Comprar presente da Ana'), [
    ['Marcar dentista', '2026-10-20', null, 'low'],
    ['Comprar presente da Ana', null, null, 'normal'],
  ])
})

test('"e depois de amanhã" é data, não conector; "e depois" sozinho separa', () => {
  assert.deepEqual(brief('uhm bom, hoje de tarde estudar inglês e depois de amanhã entregar o projeto'), [
    ['Estudar inglês', '2026-10-09', '15:00', 'normal'],
    ['Entregar o projeto', '2026-10-11', null, 'normal'],
  ])
  assert.deepEqual(splitTranscript('lavar o carro e depois, passar roupa'), ['lavar o carro', 'passar roupa'])
  assert.deepEqual(splitTranscript('ir ao mercado e depois do almoço descansar'), ['ir ao mercado e depois do almoço descansar'], 'depois do almoço não separa')
})

test('inglês: "and then", "remind me to", "urgent"', () => {
  assert.deepEqual(brief('I need to call the bank tomorrow at 3pm and then send the invoice, also remind me to book flights next monday. urgent: renew passport', 'en-US'), [
    ['Call the bank', '2026-10-10', '15:00', 'normal'],
    ['Send the invoice', null, null, 'normal'],
    ['Book flights', '2026-10-12', null, 'normal'],
    ['Renew passport', null, null, 'high'],
  ])
})

test('números soltos e listas com "e" não viram data nem separam; texto vazio não gera nada', () => {
  assert.deepEqual(brief('comprar 5 maçãs'), [['Comprar 5 maçãs', null, null, 'normal']])
  assert.deepEqual(brief('comprar pão e leite'), [['Comprar pão e leite', null, null, 'normal']])
  assert.deepEqual(brief('   '), [])
  assert.deepEqual(brief('ahn hum'), [])
  const many = extractVoiceTasks(Array.from({ length: 60 }, (_, i) => `tarefa número ${i}.`).join(' '), { now: NOW, makeId })
  assert.equal(many.length, 40, 'no máximo 40 tarefas')
})

test('itens vindos da IA passam pelo mesmo extrator de data e prioridade', () => {
  const tasks = itemsToVoiceTasks(['Ligar para a Ana amanhã às 9', 'Enviar relatório urgente', '  ', '1'], { now: NOW, makeId })
  assert.deepEqual(tasks.map(task => [task.title, task.date, task.time, task.priority, task.include]), [
    ['Ligar para a Ana', '2026-10-10', '09:00', 'normal', true],
    ['Enviar relatório', null, null, 'high', true],
  ])
})

test('resposta da IA: array JSON tolerante a texto e cercas; prompt pede só JSON', () => {
  assert.deepEqual(parseItems('Claro!\n```json\n["a b", " c d ", 3, ""]\n```'), ['a b', 'c d'])
  assert.equal(parseItems('sem lista'), null)
  assert.equal(parseItems('[]'), null)
  assert.equal(parseItems('[1,2]'), null)
  assert.match(splitPrompt('x y', 'en-US'), /ONLY a JSON array/)
  assert.match(splitPrompt('x y', 'pt-BR'), /Brazilian Portuguese/)
})

// ---------- Controlador do ditado ----------

function fakeNative() {
  const handlers = new Set<(event: any) => void>()
  const calls: string[] = []
  const native = {
    async dictationStart(input: { locale: string }) { calls.push('start:' + input.locale); return { sessionId: 7 } },
    async dictationStop() { calls.push('stop'); queueMicrotask(() => emit({ sessionId: 7, type: 'final', segment: 1, text: 'segunda frase' }), ); queueMicrotask(() => emit({ sessionId: 7, type: 'end' })) },
    async dictationCancel() { calls.push('cancel') },
    onDictationEvent(handler: (event: any) => void) { handlers.add(handler); return () => { handlers.delete(handler) } },
  }
  const emit = (event: any) => { for (const handler of [...handlers]) handler(event) }
  return { native: native as any, emit, calls, handlers }
}

test('captura: parciais viram texto ao vivo, parar devolve o texto final e libera o ouvinte', async () => {
  const { native, emit, calls, handlers } = fakeNative()
  const seen: string[] = []
  const capture = createVoiceCapture(native, 'pt-BR', snapshot => seen.push(`${snapshot.phase}:${snapshot.text}`))
  await capture.start()
  assert.deepEqual(calls, ['start:pt-BR'])
  emit({ sessionId: 7, type: 'ready' })
  emit({ sessionId: 99, type: 'partial', segment: 0, text: 'de outra sessão' })
  emit({ sessionId: 7, type: 'partial', segment: 0, text: 'primeira' })
  emit({ sessionId: 7, type: 'final', segment: 0, text: 'primeira frase' })
  assert.equal(capture.snapshot().text, 'primeira frase')
  assert.equal(capture.snapshot().phase, 'listening')
  const text = await capture.stop()
  assert.equal(text, 'primeira frase segunda frase')
  assert.equal(capture.snapshot().phase, 'idle')
  assert.equal(handlers.size, 0, 'ouvinte removido')
  assert.ok(calls.includes('stop'))
})

test('captura: erro de permissão vira mensagem com painel; sem ditado nativo e ditado do editor ativo são recusados', async () => {
  const denied = fakeNative()
  denied.native.dictationStart = async () => { throw new Error('Error invoking remote method \'np:dictationStart\': Error: MIC_DENIED: Microphone permission was denied.') }
  const capture = createVoiceCapture(denied.native, 'pt-BR', () => {})
  await capture.start()
  assert.equal(capture.snapshot().phase, 'error')
  assert.equal(capture.snapshot().pane, 'microphone')
  assert.equal(denied.handlers.size, 0)
  const none = createVoiceCapture(undefined, 'en-US', () => {})
  await none.start()
  assert.equal(none.snapshot().phase, 'error')
  assert.match(none.snapshot().error ?? '', new RegExp(`requires the ${PRODUCT.name} desktop app`, ""))
  const busy = fakeNative()
  const blocked = createVoiceCapture(busy.native, 'pt-BR', () => {}, { busy: () => true })
  await blocked.start()
  assert.equal(blocked.snapshot().phase, 'error')
  assert.deepEqual(busy.calls, [], 'não inicia sessão sobre o ditado do editor')
})

test('captura: falha do helper ao parar não trava (failsafe cancela)', async () => {
  const { native, calls } = fakeNative()
  native.dictationStop = async () => { calls.push('stop') } // nunca emite "end"
  const capture = createVoiceCapture(native, 'pt-BR', () => {}, { failsafeMs: 20 })
  await capture.start()
  const text = await capture.stop()
  assert.equal(text, '')
  assert.ok(calls.includes('cancel'))
  assert.equal(capture.snapshot().phase, 'idle')
})
