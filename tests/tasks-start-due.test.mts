import test from 'node:test'
import assert from 'node:assert/strict'
import { bucketTasks, collectTasks, dueNowTasks, extractChecklist, tasksOnDay, dateRange } from '../src/tasks/taskCore.ts'
import { shiftMentionStart, advanceMentionDate, advanceDateValue } from '../src/recurrence.ts'
import { normalizeDateRanges, validateMeta } from '../src/workspace.ts'
import { parseNaturalDate, findMarkedDate, toDateValue, describeNaturalDate } from '../src/nlp/dates.ts'
import { mentionFromText } from '../src/nlp/mention.ts'
import { reconcileDateReminders } from '../electron/recurrence.mjs'

const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00`).toISOString()
const mention = (date: string, extra: Record<string, string> = {}) => ({ type: 'dateMention', props: { id: 'm-' + date, date, pageId: '', repeat: '', reminderId: '', ...extra } })
const check = (id: string, text: string, extra: unknown[] = []) => ({ id, type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text, styles: {} }, ...extra], children: [] })
const TODAY = '2026-10-09' // sexta

function workspace() {
  const status = { id: 'st', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'A fazer', color: 'gray', group: 'todo' }, { id: 'done', name: 'Feito', color: 'green', group: 'complete' }] }
  const pages: Record<string, any> = {
    db: { id: 'db', parentId: null, title: 'Projetos', database: { properties: [{ id: 'ti', name: 'Nome', type: 'title' }, status, { id: 'dt', name: 'Prazo', type: 'date' }], views: [], activeViewId: '' } },
    old: { id: 'old', parentId: 'db', title: 'Só prazo (antiga)', props: { st: 'todo', dt: { start: '2026-10-09' } } },
    running: { id: 'running', parentId: 'db', title: 'Em andamento', props: { st: 'todo', dt: { start: '2026-10-07', end: '2026-10-14' } } },
    future: { id: 'future', parentId: 'db', title: 'Começa depois', props: { st: 'todo', dt: { start: '2026-10-12', end: '2026-10-12' } } },
    notStarted: { id: 'notStarted', parentId: 'db', title: 'Começa segunda', props: { st: 'todo', dt: { start: '2026-10-12', end: '2026-10-16' } } },
    late: { id: 'late', parentId: 'db', title: 'Prazo vencido', props: { st: 'todo', dt: { start: '2026-10-01', end: '2026-10-08' } } },
    endsToday: { id: 'endsToday', parentId: 'db', title: 'Termina hoje', props: { st: 'todo', dt: { start: '2026-10-05', end: '2026-10-09' } } },
    p1: { id: 'p1', parentId: null, title: 'Casa' },
  }
  const checklists = new Map([['p1', extractChecklist([
    check('a', 'Reformar sala', [mention(at('2026-10-16'), { startDate: '2026-10-12' })]),
    check('b', 'Mudança em curso', [mention(at('2026-10-15'), { startDate: '2026-10-08' })]),
    check('c', 'Início inválido', [mention(at('2026-10-15'), { startDate: '2026-10-20' })]),
    check('d', 'Só prazo', [mention(at('2026-10-09'))]),
    check('e', 'Início mal formado', [mention(at('2026-10-15'), { startDate: 'amanhã' })]),
  ])]])
  return { pages, checklists }
}

test('modelo tolerante: tarefa antiga continua com um só prazo; início inválido/posterior é ignorado', () => {
  const items = collectTasks({ ...workspace() })
  const by = (title: string) => items.find(item => item.title === title)!
  assert.equal(by('Só prazo (antiga)').due, '2026-10-09'); assert.equal(by('Só prazo (antiga)').startDate, undefined)
  assert.equal(by('Em andamento').due, '2026-10-14'); assert.equal(by('Em andamento').startDate, '2026-10-07', 'start = início, end = prazo')
  assert.equal(by('Reformar sala').startDate, '2026-10-12'); assert.equal(by('Reformar sala').due, '2026-10-16')
  assert.equal(by('Início inválido').startDate, undefined, 'início depois do prazo vira só prazo')
  assert.equal(by('Início mal formado').startDate, undefined)
  assert.equal(by('Só prazo').startDate, undefined)
  assert.deepEqual(dateRange({ start: '2026-10-10', end: '2026-10-09' }), { due: '2026-10-10' }, 'fim anterior ao início é ignorado')
  assert.deepEqual(dateRange({ start: '2026-10-10', end: '2026-10-10' }), { due: '2026-10-10' })
})

test('Hoje só mostra a tarefa a partir do início; Atrasadas usam o prazo', () => {
  const items = collectTasks({ ...workspace() })
  const buckets = bucketTasks(items, TODAY)
  const titles = (list: typeof items) => list.map(item => item.title).sort()
  assert.deepEqual(titles(buckets.today), ['Em andamento', 'Mudança em curso', 'Só prazo', 'Só prazo (antiga)', 'Termina hoje'].sort())
  assert.deepEqual(titles(buckets.overdue), ['Prazo vencido'], 'atrasada = prazo anterior a hoje, mesmo com início antigo')
  assert.deepEqual(titles(buckets.upcoming), ['Começa depois', 'Começa segunda', 'Início inválido', 'Início mal formado', 'Reformar sala'].sort())
  assert.ok(!titles(dueNowTasks(buckets, 20)).includes('Reformar sala'), 'o cartão Hoje não mostra tarefa que ainda não começou')
  // Depois do início passa a aparecer em Hoje; depois do prazo, em Atrasadas.
  assert.ok(titles(bucketTasks(items, '2026-10-12').today).includes('Reformar sala'))
  assert.ok(titles(bucketTasks(items, '2026-10-17').overdue).includes('Reformar sala'))
})

test('calendário: a tarefa ocupa todos os dias do intervalo', () => {
  const items = collectTasks({ ...workspace() })
  const on = (day: string) => tasksOnDay(items, day).map(item => item.title)
  assert.ok(on('2026-10-13').includes('Reformar sala'))
  assert.ok(on('2026-10-12').includes('Reformar sala') && on('2026-10-16').includes('Reformar sala'))
  assert.ok(!on('2026-10-11').includes('Reformar sala') && !on('2026-10-17').includes('Reformar sala'))
  assert.ok(on('2026-10-10').includes('Em andamento'))
  assert.ok(on('2026-10-09').includes('Só prazo (antiga)') && !on('2026-10-10').includes('Só prazo (antiga)'))
})

test('recorrência: início e prazo andam juntos e a duração é mantida', () => {
  assert.equal(shiftMentionStart('2026-10-12', at('2026-10-16'), at('2026-10-23')), '2026-10-19')
  assert.equal(shiftMentionStart('inválido', at('2026-10-16'), at('2026-10-23')), '')
  const next = advanceMentionDate(at('2026-10-16'), 'weekly', Date.parse('2026-10-17T12:00:00'))
  assert.ok(next)
  assert.equal(shiftMentionStart('2026-10-12', at('2026-10-16'), next!), '2026-10-19', 'prazo +7 dias → início +7 dias')
  const row = advanceDateValue({ start: '2026-10-05', end: '2026-10-09', repeat: 'weekly' } as never, '2026-10-09')
  assert.deepEqual([row.start, row.end], ['2026-10-12', '2026-10-16'], 'linha de banco mantém os 4 dias de duração')
})

test('migração: datas antigas ficam intactas; intervalo invertido é corrigido sem perder dias', () => {
  const props = { a: { start: '2026-10-09' }, b: { start: '2026-10-12', end: '2026-10-16', startTime: '09:00' }, c: { start: '2026-10-16', end: '2026-10-12' }, d: { start: '2026-10-12', end: 'lixo' }, e: 'texto' }
  const out = normalizeDateRanges(props) as Record<string, any>
  assert.deepEqual(out.a, { start: '2026-10-09' }); assert.deepEqual(out.b, props.b); assert.equal(out.e, 'texto')
  assert.deepEqual([out.c.start, out.c.end], ['2026-10-12', '2026-10-16'])
  assert.deepEqual(out.d, { start: '2026-10-12' }, 'fim inválido cai no modelo de um só prazo')
  assert.equal(normalizeDateRanges({ a: { start: '2026-10-09' } }) !== undefined, true)
  const same = { a: { start: '2026-10-09' } }
  assert.equal(normalizeDateRanges(same), same, 'sem mudanças devolve o mesmo objeto')
  const id = '11111111-1111-4111-8111-111111111111', row = '22222222-2222-4222-8222-222222222222'
  const page = (pid: string, extra: object) => ({ id: pid, parentId: null, title: pid.slice(0, 1), icon: null, cover: null, coverPosition: 50, favorite: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1, order: 0, fullWidth: false, smallText: false, font: 'default', locked: false, text: '', ...extra })
  const meta = validateMeta({ pages: { [id]: page(id, {}), [row]: page(row, { parentId: id, props: props }) }, settings: { locale: 'pt-BR' } })
  assert.deepEqual((meta.pages[row].props as any).c, { start: '2026-10-12', end: '2026-10-16' })
  assert.deepEqual((meta.pages[row].props as any).b, props.b)
})

test('linguagem natural: intervalos "de segunda a sexta" e "começa amanhã, entrega dia 20"', () => {
  const now = Date.parse('2026-10-07T13:00:00Z') // quarta
  const opt = { now, timeZone: 'America/Sao_Paulo' }
  const range = (text: string, locale: 'pt-BR' | 'en-US' = 'pt-BR') => { const p = parseNaturalDate(text, { ...opt, locale }); return p ? [p.start, p.end ?? null] : null }
  assert.deepEqual(range('de segunda a sexta'), ['2026-10-12', '2026-10-16'], 'o fim é resolvido a partir do início')
  assert.deepEqual(range('começa amanhã, entrega dia 20'), ['2026-10-08', '2026-10-20'])
  assert.deepEqual(range('de amanhã até sexta'), ['2026-10-08', '2026-10-09'])
  assert.deepEqual(range('de 10/10 a 15/10'), ['2026-10-10', '2026-10-15'])
  assert.deepEqual(range('from monday to friday', 'en-US'), ['2026-10-12', '2026-10-16'])
  assert.deepEqual(range('starts tomorrow, due 10/20', 'en-US'), ['2026-10-08', '2026-10-20'])
  assert.deepEqual(range('amanhã'), ['2026-10-08', null], 'uma data só continua igual')
  assert.equal(range('de segunda a coisa nenhuma'), null)
  assert.equal(range('de hoje a hoje'), null, 'início = fim não é intervalo (e sobra texto não reconhecido)')
  const marked = findMarkedDate('revisar contrato @de segunda a sexta com o time', { ...opt, locale: 'pt-BR' })
  assert.equal(marked?.start, '2026-10-12'); assert.equal(marked?.end, '2026-10-16')
  const value = toDateValue(parseNaturalDate('de segunda a sexta', opt)!)
  assert.deepEqual([value.start, value.end], ['2026-10-12', '2026-10-16'])
  assert.match(describeNaturalDate(parseNaturalDate('de segunda a sexta', opt)!, 'pt-BR'), /Início 12 de outubro de 2026 · Prazo 16 de outubro de 2026/)
  const m = mentionFromText('começa amanhã, entrega dia 20', 'pt-BR', now, 'America/Sao_Paulo')
  assert.equal(m?.startDate, '2026-10-08')
  assert.equal(new Date(m!.date).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), '2026-10-20', 'a menção guarda o prazo em date')
  assert.equal(mentionFromText('amanhã', 'pt-BR', now, 'America/Sao_Paulo')?.startDate, '')
})

test('lembrete de linha com intervalo dispara no início e informa o prazo', () => {
  const pages: Record<string, any> = {
    db: { id: 'db', parentId: null, title: 'P', database: { properties: [{ id: 'dt', name: 'Prazo', type: 'date' }], views: [], activeViewId: '' } },
    r: { id: 'r', parentId: 'db', title: 'Obra', props: { dt: { start: '2026-10-12', end: '2026-10-16', reminder: 0, startTime: '09:00' } } },
    s: { id: 's', parentId: 'db', title: 'Simples', props: { dt: { start: '2026-10-12', reminder: 0, startTime: '09:00' } } },
  }
  const { notifications } = reconcileDateReminders({}, pages, Date.parse('2026-10-01T00:00:00Z'), { timeZone: 'UTC', locale: 'pt-BR' })
  const body = (rowId: string) => Object.values(notifications as Record<string, any>).find(n => n.pageId === rowId)!.body as string
  assert.match(body('r'), /^Começa .*09:00 · prazo 16\/10/)
  assert.match(body('s'), /^Vence /)
  assert.equal(Object.values(notifications as Record<string, any>).find(n => n.pageId === 'r')!.source.occurrence, '2026-10-12')
})
