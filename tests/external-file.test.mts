// B5 — fila de arquivos abertos avulsos e mensagens de erro (src/openfile/externalFile.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileErrorMessage, nextQueue } from '../src/openfile/externalFile.ts'
import type { ExternalFile } from '../src/types.ts'

const file = (fileId: string, text = 'x'): ExternalFile => ({ fileId, name: fileId + '.md', path: '/tmp/' + fileId + '.md', text, size: text.length })

test('fila: arquivos novos entram no fim; o mesmo fileId atualiza no lugar; edição não salva do atual não é sobrescrita', () => {
  let queue = nextQueue([], file('a', '1'), false)
  queue = nextQueue(queue, file('b'), false)
  assert.deepEqual(queue.map(item => item.fileId), ['a', 'b'])
  assert.equal(nextQueue(queue, file('a', '2'), false)[0].text, '2')
  assert.equal(nextQueue(queue, file('a', '2'), true)[0].text, '1', 'atual com edições: mantém')
  assert.equal(nextQueue(queue, file('b', '3'), true)[1].text, '3', 'não atual: atualiza mesmo assim')
  let many: ExternalFile[] = []
  for (let i = 0; i < 50; i++) many = nextQueue(many, file('f' + i), false)
  assert.equal(many.length, 30)
})

const pt = (a: string, _en: string) => a
test('erros do main viram mensagens legíveis', () => {
  assert.match(fileErrorMessage(new Error("Error invoking remote method 'np:openMarkdownFile': Error: FILE_TOO_LARGE: O arquivo passa de 10 MB."), pt), /10 MB/)
  assert.match(fileErrorMessage(new Error('FILE_NOT_UTF8: x'), pt), /UTF-8/)
  assert.match(fileErrorMessage(new Error('FILE_BINARY: x'), pt), /texto/)
  assert.equal(fileErrorMessage(new Error("Error invoking remote method 'x': Error: algo"), pt), 'algo')
})
