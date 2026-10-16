import test from 'node:test'
import assert from 'node:assert/strict'
import { autoFixPane } from '../src/components/dictation/autoPermission.ts'

class Win extends EventTarget { addEventListener(t: string, l: any, o?: any) { super.addEventListener(t, l, o) } removeEventListener(t: string, l: any) { super.removeEventListener(t, l) } }

test('erro de permissão abre o painel sozinho e tenta de novo quando o app volta ao foco', async () => {
  const win = new Win()
  ;(globalThis as any).window = win
  const opened: string[] = []; let retries = 0
  autoFixPane('dictation', () => { retries++ }, { open: p => { opened.push(p) } })
  assert.deepEqual(opened, ['dictation'])
  win.dispatchEvent(new Event('focus'))
  await new Promise(r => setTimeout(r, 450))
  assert.equal(retries, 0, 'foco antes de sair do app não repete')
  win.dispatchEvent(new Event('blur'))
  win.dispatchEvent(new Event('focus'))
  await new Promise(r => setTimeout(r, 450))
  assert.equal(retries, 1)
  delete (globalThis as any).window
})

test('no máximo 3 tentativas automáticas e sem painel quando não há o que abrir', () => {
  ;(globalThis as any).window = new Win()
  const attempts = { count: 0 }; const opened: string[] = []
  for (let i = 0; i < 5; i++) autoFixPane('microphone', () => {}, { open: p => { opened.push(p) }, attempts })
  assert.equal(opened.length, 3)
  autoFixPane(null, () => {}, { open: p => { opened.push(p) } })
  assert.equal(opened.length, 3)
  delete (globalThis as any).window
})
