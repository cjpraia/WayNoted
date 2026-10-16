// Ditado na nota rápida (⌥⌘N): texto entra no corpo, erros de permissão abrem o painel certo e repetem ao reabrir a nota.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuickVoice, joinDictation } from '../src/quick/voice.ts'

class Win extends EventTarget {}
function fakeApi(options: { failWith?: string } = {}) {
  let handler: ((event: any) => void) | null = null
  const calls: string[] = []
  const api = {
    async dictationStart(input: { locale: string }) {
      calls.push(`start ${input.locale}`)
      if (options.failWith) throw new Error(`Error invoking remote method 'npq:dictationStart': Error: ${options.failWith}: negado`)
      return { sessionId: 7 }
    },
    async dictationStop() { calls.push('stop'); queueMicrotask(() => handler?.({ sessionId: 7, type: 'final', segment: 0, text: 'comprar pão' })); queueMicrotask(() => handler?.({ sessionId: 7, type: 'end' })) },
    async dictationCancel() { calls.push('cancel') },
    onDictationEvent(h: (event: any) => void) { handler = h; return () => { handler = null } },
    async openPrivacySettings(pane: string) { calls.push(`pane ${pane}`) },
  }
  return { api, calls, emit: (event: any) => handler?.(event) }
}

test('joinDictation: junta ao corpo existente com linha em branco e ignora ditado vazio', () => {
  assert.equal(joinDictation('', ' olá '), 'olá')
  assert.equal(joinDictation('Linha 1', 'olá'), 'Linha 1\n\nolá')
  assert.equal(joinDictation('Linha 1\n', 'olá'), 'Linha 1\n\nolá')
  assert.equal(joinDictation('Linha 1', '   '), 'Linha 1')
})

test('ditado ao vivo: parcial aparece, parar devolve o texto final em pt-BR', async () => {
  const { api, calls, emit } = fakeApi()
  const texts: string[] = []
  const voice = createQuickVoice(api as never, 'pt-BR', (snapshot) => texts.push(`${snapshot.phase}:${snapshot.text}`))
  await voice.start()
  emit({ sessionId: 7, type: 'ready' })
  emit({ sessionId: 7, type: 'partial', segment: 0, text: 'comprar' })
  assert.equal(voice.snapshot().phase, 'listening')
  assert.equal(voice.snapshot().text, 'comprar')
  const final = await voice.stop()
  assert.equal(final, 'comprar pão')
  assert.equal(voice.snapshot().phase, 'idle')
  assert.deepEqual(calls, ['start pt-BR', 'stop'])
  assert.ok(texts.length > 2)
})

test('en-US é repassado ao helper', async () => {
  const { api, calls } = fakeApi()
  const voice = createQuickVoice(api as never, 'en-US', () => {})
  await voice.start()
  assert.equal(calls[0], 'start en-US')
  await voice.cancel()
})

test('permissão negada: abre o painel do microfone sozinho e tenta de novo ao voltar à janela', async () => {
  const win = new Win()
  ;(globalThis as any).window = win
  try {
    const { api, calls } = fakeApi({ failWith: 'MIC_DENIED' })
    const phases: string[] = []
    const voice = createQuickVoice(api as never, 'en-US', (snapshot) => phases.push(snapshot.phase))
    await voice.start()
    assert.equal(voice.snapshot().phase, 'error')
    assert.match(voice.snapshot().error ?? '', /Microphone access was denied/)
    assert.equal(voice.snapshot().pane, 'microphone')
    assert.ok(calls.includes('pane microphone'))
    win.dispatchEvent(new Event('blur'))
    win.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.equal(calls.filter((call) => call.startsWith('start')).length, 2, 'repetiu uma vez')
  } finally { delete (globalThis as any).window }
})
