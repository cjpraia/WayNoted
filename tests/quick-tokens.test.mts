import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { extractQuickTokens, findTags } from '../src/quick/tokens.ts'

const require = createRequire(import.meta.url)
const core = require('../electron/quick-capture-core.cjs')
const now = Date.parse('2026-10-07T13:00:00Z')
const options = { now, timeZone: 'America/Sao_Paulo' }

test('@data e #tag saem do texto e viram data/etiquetas', () => {
  const tokens = extractQuickTokens('Ligar pro João @amanhã às 9h', 'Sobre o contrato #trabalho #Urgente\n  - item recuado', options)
  assert.equal(tokens.title, 'Ligar pro João')
  assert.equal(tokens.body, 'Sobre o contrato\n  - item recuado', 'recuo de lista preservado')
  assert.deepEqual(tokens.tags, ['trabalho', 'Urgente'])
  assert.deepEqual(tokens.date, { start: '2026-10-08', startTime: '09:00' })
  assert.equal(tokens.dateLabel, '8 de outubro de 2026 09:00')
})

test('recorrência, aspas e destinos sem data/etiquetas', () => {
  const tokens = extractQuickTokens('Pagar luz', 'vence @"todo dia 5 às 9h"', options)
  assert.deepEqual(tokens.date, { start: '2026-11-05', startTime: '09:00', repeat: 'monthly' })
  assert.equal(tokens.body, 'vence')
  const untouched = extractQuickTokens('Reunião @amanhã #time', '', { ...options, dates: false, tags: false })
  assert.equal(untouched.title, 'Reunião @amanhã #time')
  assert.equal(untouched.date, null)
  assert.deepEqual(untouched.tags, [])
})

test('#tag ignora títulos Markdown, números, e-mails e blocos de código', () => {
  assert.deepEqual(findTags('# Título\n#123 não\nemail a#b.com\n```\n#codigo\n```\nfim #ok'), ['ok'])
  assert.equal(extractQuickTokens('', 'fulano@exemplo.com amanhã', options).date, null, '@ em e-mail não é data')
})

test('captura (processo principal) grava data com hora e repetição validadas', () => {
  const meta = { pages: {}, settings: { locale: 'pt-BR' } }
  const plan = core.applyQuickNote(meta, { title: 'Pagar luz', blocks: [], tags: ['casa'], date: '2026-11-05', dateValue: { start: '2026-11-05', startTime: '09:00', repeat: 'monthly', recurrence: { interval: 1, hack: true } } }, { pageId: '00000000-0000-4000-8000-000000000001' })
  const inbox = plan.meta.pages[plan.parentId]
  const dateProp = inbox.database.properties.find((p: any) => p.type === 'date')
  assert.deepEqual(plan.meta.pages[plan.pageId].props[dateProp.id], { start: '2026-11-05', startTime: '09:00', repeat: 'monthly', recurrence: { interval: 1 } })
  const mismatch = core.validateInput({ title: 'x', blocks: [], date: '2026-11-05', dateValue: { start: '2026-11-06', startTime: '25:00' } })
  assert.equal(mismatch.dateValue, null, 'data completa precisa coincidir com a data validada')
})
