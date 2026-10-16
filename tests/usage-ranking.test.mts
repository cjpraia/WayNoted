import test from 'node:test'
import assert from 'node:assert/strict'
import { USAGE_HALF_LIFE_MS, USAGE_KEY, clearUsage, decayedScore, recentIds, recordUse, serialOrder, setUsageEnabled, setUsageStorage, usageCount, usageEnabled, usageScores } from '../src/usage/usage.ts'
import { SLASH_CATALOG } from '../src/components/page/slashMenu/catalog.ts'
import { DEFAULT_SUGGESTED, SLASH_GROUP_LIMIT, SLASH_SEARCH_LIMIT, planSlashMenu, relevance } from '../src/components/page/slashMenu/ranking.ts'

const memoryStorage = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } }
const fresh = () => { const storage = memoryStorage(); setUsageStorage(storage); return storage }

test('uso: contagem com decaimento exponencial pela meia-vida', () => {
  fresh()
  const t0 = 1_000_000
  recordUse('cmd', 'cmd:new', t0); recordUse('cmd', 'cmd:new', t0)
  assert.equal(usageScores('cmd', t0)['cmd:new'], 2)
  assert.ok(Math.abs(usageScores('cmd', t0 + USAGE_HALF_LIFE_MS)['cmd:new'] - 1) < 1e-9)
  assert.ok(Math.abs(usageScores('cmd', t0 + 2 * USAGE_HALF_LIFE_MS)['cmd:new'] - 0.5) < 1e-9)
  assert.equal(decayedScore(undefined), 0)
  // um uso recente supera vários usos antigos
  recordUse('cmd', 'cmd:old', t0); recordUse('cmd', 'cmd:old', t0); recordUse('cmd', 'cmd:old', t0)
  const later = t0 + 6 * USAGE_HALF_LIFE_MS
  recordUse('cmd', 'cmd:fresh', later)
  const scores = usageScores('cmd', later)
  assert.ok(scores['cmd:fresh'] > scores['cmd:old'])
})

test('uso: recentes na ordem do último uso e escopos separados', () => {
  fresh()
  recordUse('slash', 'text', 10); recordUse('slash', 'code', 20); recordUse('slash', 'table', 30); recordUse('slash', 'text', 40)
  assert.deepEqual(recentIds('slash', 2), ['text', 'table'])
  assert.deepEqual(recentIds('cmd', 5), [])
})

test('privacidade: só ids e números no disco; desligar para de contar; apagar zera', () => {
  const storage = fresh()
  recordUse('slash', 'heading-1', 5)
  recordUse('slash', 'texto com espaços e conteúdo da página', 5)
  recordUse('cmd', '<script>', 5)
  const raw = storage.data.get(USAGE_KEY)!
  assert.ok(!raw.includes('conteúdo') && !raw.includes('script'), 'ids inválidos nunca são gravados')
  assert.equal(usageCount(), 1)
  assert.equal(usageEnabled(), true)
  setUsageEnabled(false)
  recordUse('slash', 'code', 6)
  assert.deepEqual(usageScores('slash', 6), {}, 'desligado: sem ranking')
  assert.deepEqual(recentIds('slash', 5), [])
  setUsageEnabled(true)
  assert.ok(!('code' in usageScores('slash', 6)), 'nada foi gravado enquanto estava desligado')
  assert.ok('heading-1' in usageScores('slash', 6))
  clearUsage()
  assert.equal(usageCount(), 0)
  setUsageEnabled(false); clearUsage()
  assert.equal(usageEnabled(), false, 'apagar mantém a preferência')
  setUsageEnabled(true)
})

test('uso: armazenamento corrompido ou ausente não quebra', () => {
  const storage = memoryStorage(); storage.data.set(USAGE_KEY, '{nope'); setUsageStorage(storage)
  assert.deepEqual(usageScores('slash'), {})
  setUsageStorage(null)
  recordUse('slash', 'text'); assert.ok('text' in usageScores('slash'))
  setUsageStorage(undefined)
})

test('posição serial: 1º no início, 2º no fim', () => {
  assert.deepEqual(serialOrder([1, 2, 3, 4, 5]), [1, 3, 4, 5, 2])
  assert.deepEqual(serialOrder([1, 2]), [1, 2])
})

const labels = (plan: ReturnType<typeof planSlashMenu>, group: string) => plan.filter((e) => e.group === group)
const ids = (plan: ReturnType<typeof planSlashMenu>) => plan.flatMap((e) => e.kind === 'item' ? [e.command.id] : [])

test('menu "/": sem texto mostra Recentes, Sugeridos e "Mais blocos" recolhido', () => {
  const none = planSlashMenu(SLASH_CATALOG, { query: '', locale: 'pt-BR' })
  assert.equal(labels(none, 'Recentes').length, 0)
  const sug = labels(none, 'Sugeridos').filter((e) => e.kind === 'item')
  assert.equal(sug.length, 8)
  assert.equal(sug[0].kind === 'item' && sug[0].command.id, DEFAULT_SUGGESTED[0], 'mais importante no início')
  assert.equal(sug.at(-1)!.kind === 'item' && (sug.at(-1) as { command: { id: string } }).command.id, DEFAULT_SUGGESTED[1], 'segundo no fim')
  const last = none.at(-1)!
  assert.equal(last.kind, 'more')
  assert.equal(none.length, 9)
  assert.ok(none.length <= 1 + 5 + 8)
})

test('menu "/": recentes (5) e sugeridos pelo uso, sem repetir', () => {
  const usage = { recent: ['callout', 'quote', 'divider', 'image', 'video', 'audio'], scores: { divider: 5, callout: 4, 'toggle-list': 3 } }
  const plan = planSlashMenu(SLASH_CATALOG, { query: '', locale: 'pt-BR', usage })
  assert.equal(labels(plan, 'Recentes').length, 5)
  const all = ids(plan)
  assert.equal(new Set(all).size, all.length, 'sem itens repetidos')
  const sugIds = labels(plan, 'Sugeridos').map((e) => e.kind === 'item' ? e.command.id : '')
  assert.ok(sugIds.includes('toggle-list'), 'mais usados entram nos sugeridos')
  assert.ok(!sugIds.includes('divider'), 'já aparece em Recentes')
})

test('menu "/": expandido, cada categoria mostra no máximo 7 itens antes de "Ver mais"', () => {
  const plan = planSlashMenu(SLASH_CATALOG, { query: '', locale: 'en-US', expanded: new Set(['all']) })
  const groups = new Map<string, number>()
  for (const e of plan) if (e.kind === 'item' && !['Suggested', 'Recent'].includes(e.group)) groups.set(e.group, (groups.get(e.group) ?? 0) + 1)
  for (const [group, count] of groups) if (!['Suggested'].includes(group)) assert.ok(count <= SLASH_GROUP_LIMIT || group === 'Suggested', `${group}: ${count}`)
  assert.ok(plan.some((e) => e.kind === 'more' && e.key === 'cat:Embeds'))
  const open = planSlashMenu(SLASH_CATALOG, { query: '', locale: 'en-US', expanded: new Set(['all', 'cat:Embeds']) })
  assert.ok(open.filter((e) => e.kind === 'item' && e.group === 'Embeds').length > SLASH_GROUP_LIMIT)
  assert.ok(!open.some((e) => e.kind === 'more' && e.key === 'cat:Embeds'))
})

test('menu "/": busca por alias PT/EN, tolerante a erros e ordenada por relevância + uso', () => {
  const pick = (query: string, locale: 'pt-BR' | 'en-US' = 'pt-BR', scores = {}) => ids(planSlashMenu(SLASH_CATALOG, { query, locale, usage: { recent: [], scores } }))
  assert.equal(pick('texto')[0], 'text')
  assert.ok(pick('plain', 'en-US').includes('text'))
  assert.ok(pick('tarefa').includes('to-do-list'))
  assert.ok(pick('todo', 'en-US').includes('to-do-list'))
  assert.ok(pick('tabela')[0] === 'table' || pick('tabela').includes('table'))
  assert.ok(pick('titlo').some((id) => id.startsWith('heading')), 'erro de digitação: titlo → título')
  assert.ok(pick('checlist').includes('to-do-list'), 'letra faltando')
  assert.ok(pick('lista').length <= SLASH_SEARCH_LIMIT, 'busca mostra só os mais relevantes')
  const base = pick('lista'), boosted = pick('lista', 'pt-BR', { 'numbered-list': 6 })
  assert.ok(boosted.indexOf('numbered-list') <= base.indexOf('numbered-list'))
  assert.equal(pick('zzzzqq').length, 0)
  assert.ok(planSlashMenu(SLASH_CATALOG, { query: 'a', locale: 'pt-BR' }).length <= SLASH_SEARCH_LIMIT)
  assert.ok(relevance(SLASH_CATALOG.find((c) => c.id === 'text')!, 'tex', 'pt-BR') >= 90)
})
