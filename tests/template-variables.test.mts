// Motor de {{variáveis}} de modelos (src/templates/variables.ts): datas, relativas, aliases, perguntas, cursor, desconhecidas.
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectQuestions, expandTemplate, expandTemplateText, nowContext, previewVariable, resolveToken, TEMPLATE_VARIABLES, blockAtPath, type TemplateContext } from '../src/templates/variables.ts'
import { rowPropValues, expandRowTemplate, rowTemplateQuestions } from '../src/templates/rowTemplate.ts'
import { placeCursor } from '../src/templates/cursor.ts'
import { askTemplateQuestions } from '../src/templates/promptBus.ts'

const pt: TemplateContext = { date: '2026-10-07', time: '09:05', locale: 'pt-BR', title: 'Reunião X', userName: 'Marcelo' }
const en: TemplateContext = { ...pt, locale: 'en-US' }
const para = (text: string, styles: Record<string, unknown> = {}) => ({ type: 'paragraph', content: [{ type: 'text', text, styles }] })
const textOf = (blocks: any[]): string => blocks.map(b => (Array.isArray(b.content) ? b.content.map((i: any) => i.text ?? (i.content ?? []).map((c: any) => c.text).join('')).join('') : '')).join('\n')
const run = (text: string, ctx = pt) => expandTemplateText(text, ctx).text

test('variáveis básicas em pt-BR e en-US', () => {
  assert.equal(run('{{data}}'), '7 de outubro de 2026')
  assert.equal(run('{{date}}', en), 'October 7, 2026')
  assert.equal(run('{{hora}} {{time}}'), '09:05 09:05')
  assert.equal(run('{{titulo}}/{{title}}'), 'Reunião X/Reunião X')
  assert.equal(run('{{dia_da_semana}}'), 'Quarta-feira')
  assert.equal(run('{{weekday}}', en), 'Wednesday')
  assert.equal(run('{{semana}} {{mes}} {{ano}}'), '41 outubro 2026')
  assert.equal(run('{{week}} {{month}} {{year}}', en), '41 October 2026')
  assert.equal(run('{{usuario}} {{user}}'), 'Marcelo Marcelo')
  assert.equal(run('{{ DATA }}'), '7 de outubro de 2026', 'espaços e caixa')
  assert.equal(run('{{ontem}} | {{amanha}} | {{amanhã}}'), '6 de outubro de 2026 | 8 de outubro de 2026 | 8 de outubro de 2026', 'sem link vira data')
})

test('datas relativas e formato', () => {
  assert.equal(run('{{data:AAAA-MM-DD}}'), '2026-10-07')
  assert.equal(run('{{date:DD/MM/YY}}', en), '07/10/26')
  assert.equal(run('{{data+7d:AAAA-MM-DD}}'), '2026-10-14')
  assert.equal(run('{{data-1m:AAAA-MM-DD}}'), '2026-09-07')
  assert.equal(run('{{data+2w:AAAA-MM-DD}}'), '2026-10-21')
  assert.equal(run('{{data+1y:AAAA-MM-DD}}'), '2027-10-07')
  assert.equal(run('{{date+1month:YYYY-MM-DD}}', en), '2026-11-07')
  assert.equal(run('{{data+5d}}'), '12 de outubro de 2026')
  assert.equal(run('{{mes+1m}}'), 'novembro')
  assert.equal(run('{{dia_da_semana+1d}}'), 'Quinta-feira')
  // fim de mês é limitado ao último dia
  assert.equal(run('{{data+1m:AAAA-MM-DD}}', { ...pt, date: '2026-01-31' }), '2026-02-28')
  assert.equal(run('{{data-1m:AAAA-MM-DD}}', { ...pt, date: '2026-03-31' }), '2026-02-28')
})

test('desconhecidas ficam literais e são avisadas; nunca avalia código', () => {
  const r = expandTemplateText('a {{foo}} b {{data*2}} c {{data+7x}} d {{prop:Nome}} e {{constructor}} {{ 1+1 }}', pt)
  assert.equal(r.text, 'a {{foo}} b {{data*2}} c {{data+7x}} d {{prop:Nome}} e {{constructor}} {{ 1+1 }}')
  assert.deepEqual([...r.unknown].sort(), ['{{ 1+1 }}', '{{constructor}}', '{{data*2}}', '{{data+7x}}', '{{foo}}', '{{prop:Nome}}'].sort())
  assert.equal(run('{{usuario}}', { ...pt, userName: '' }), '{{usuario}}', 'sem nome de usuário fica literal')
})

test('blocos: estilos preservados, ids novos, desconhecida avisada, agenda/tarefas/consulta como antes', () => {
  const blocks = [para('Dia {{data}}!', { bold: true }), para('{{agenda}}'), para('{{tarefas_do_dia}}'), para('{{consulta:tarefas_do_dia}}'), para('{{x}}')]
  const withTasks = expandTemplate(blocks, { ...pt, tasks: [{ title: 'Pagar', pageTitle: 'Casa', href: 'workspace://page/1', time: '10:00' }] }, undefined, {})
  const merged = expandTemplate([para('Dia {{data}}!', { bold: true })], pt, undefined, { mergeText: true })
  assert.deepEqual((merged.blocks[0].content as any[]).map(i => i.text), ['Dia 7 de outubro de 2026!'])
  assert.equal(withTasks.blocks[0].type, 'paragraph')
  assert.deepEqual((withTasks.blocks[0].content as any[]).map(i => [i.text, i.styles.bold]), [['Dia ', true], ['7 de outubro de 2026', true], ['!', true]])
  assert.equal(withTasks.blocks[1].type, 'calendarAgenda')
  assert.equal(withTasks.blocks[2].type, 'bulletListItem')
  assert.equal(withTasks.blocks[3].type, 'query')
  assert.deepEqual(withTasks.unknown, ['{{x}}'])
  assert.notEqual(withTasks.blocks[0].id, undefined)
  // fora da nota diária {{tarefas_do_dia}} sozinho não vira lista: fica literal e sem aviso
  const plain = expandTemplate([para('{{tarefas_do_dia}}')], pt)
  assert.equal(textOf(plain.blocks), '{{tarefas_do_dia}}'); assert.equal(plain.unknown.length, 0)
  // não destrutivo: a entrada não é alterada
  assert.equal(JSON.stringify(blocks[0]), JSON.stringify(para('Dia {{data}}!', { bold: true })))
})

test('keepIds preserva ids; sem baseProps não inventa props de texto', () => {
  const r = expandTemplate([{ id: 'a', type: 'codeBlock', props: { language: 'js' }, content: [{ type: 'text', text: '{{ano}}', styles: {} }] }], pt, undefined, { keepIds: true })
  assert.equal(r.blocks[0].id, 'a')
  assert.deepEqual(r.blocks[0].props, { language: 'js' })
  assert.equal(textOf(r.blocks), '2026')
})

test('ontem/amanhã viram link quando há href (nota diária)', () => {
  const r = expandTemplate([para('{{ontem}} · {{amanha}}')], { ...pt, yesterdayHref: 'workspace://daily/2026-10-06', tomorrowHref: 'workspace://daily/2026-10-08' })
  const links = (r.blocks[0].content as any[]).filter(i => i.type === 'link')
  assert.deepEqual(links.map(l => l.href), ['workspace://daily/2026-10-06', 'workspace://daily/2026-10-08'])
  assert.match(links[0].content[0].text, /^‹ Ontem \(6 de out/)
})

test('perguntas: coleta única, padrão, resposta e texto sem resposta', async () => {
  const blocks = [para('Cliente: {{pergunta:Nome do cliente|Acme}}'), para('{{ask:Nome do cliente}} e {{pergunta:Valor}}')]
  const questions = collectQuestions(blocks, ['Título {{pergunta:Projeto|Alfa}}'])
  assert.deepEqual(questions.map(q => [q.label, q.default]), [['Projeto', 'Alfa'], ['Nome do cliente', 'Acme'], ['Valor', '']])
  const answered = expandTemplate(blocks, { ...pt, answers: { 'Nome do cliente': 'Beta' } })
  assert.equal(textOf(answered.blocks), 'Cliente: Beta\nBeta e ')
  const defaults = expandTemplate(blocks, pt)
  assert.equal(textOf(defaults.blocks), 'Cliente: Acme\nAcme e ')
  // sem diálogo montado o barramento usa os padrões; sem perguntas resolve vazio
  assert.deepEqual(await askTemplateQuestions(questions), { Projeto: 'Alfa', 'Nome do cliente': 'Acme', Valor: '' })
  assert.deepEqual(await askTemplateQuestions([]), {})
})

test('{{cursor}}: some do texto e registra caminho e posição', () => {
  const blocks = [para('Título'), { type: 'bulletListItem', content: [{ type: 'text', text: 'Item ', styles: {} }, { type: 'text', text: '{{cursor}}', styles: {} }], children: [para('{{cursor}}'), para('filho')] }]
  const r = expandTemplate(blocks, pt)
  assert.equal(textOf(r.blocks), 'Título\nItem ')
  assert.equal(textOf(r.blocks[1].children as any[]), '\nfilho', 'cursor repetido some também')
  assert.deepEqual(r.cursor, { path: [1], atEnd: true })
  const mid = expandTemplate([para('antes {{cursor}} depois')], pt)
  assert.deepEqual(mid.cursor, { path: [0], atEnd: false })
  assert.equal(textOf(mid.blocks), 'antes  depois')
  const none = expandTemplate([para('x')], pt)
  assert.equal(none.cursor, null)
  // placeCursor coloca no bloco certo
  const calls: unknown[] = []
  const editor = { document: r.blocks as any, setTextCursorPosition: (id: string, where: string) => calls.push([id, where]), focus: () => calls.push('focus') }
  assert.equal(placeCursor(editor, r.cursor), true)
  assert.deepEqual(calls, [[r.blocks[1].id, 'end'], 'focus'])
  assert.equal(blockAtPath(r.blocks as any, [1, 0])?.id, r.blocks[1].children![0].id)
  assert.equal(placeCursor(editor, { path: [9], atEnd: false }), false)
})

test('{{prop:Nome}} só com propriedades de linha; modelo de linha expande título, texto e corpo', () => {
  const schema: any = { properties: [{ id: 't', name: 'Nome', type: 'title' }, { id: 's', name: 'Situação', type: 'select', options: [{ id: 'o1', name: 'Em andamento' }] }, { id: 'n', name: 'Notas', type: 'text' }], views: [] }
  const ctx = { ...pt, props: rowPropValues({ title: 'Casa', props: { s: 'o1' } }, schema) }
  assert.equal(run('{{prop:nome}}, {{prop:SITUAÇÃO}}', ctx), 'Casa, Em andamento')
  assert.equal(run('{{prop:Inexistente}}', ctx), '{{prop:Inexistente}}')
  const template = { title: 'Visita {{data:DD/MM}} — {{pergunta:Quem|Ana}}', bodyBlocks: [para('Para {{prop:Nome}}: {{pergunta:Quem}} em {{data}}')] }
  assert.deepEqual(rowTemplateQuestions(template, { n: 'Obs {{pergunta:Extra}}' }).map(q => q.label), ['Quem', 'Extra'])
  const done = expandRowTemplate(template, { n: 'Obs {{pergunta:Extra|z}} {{ano}}', s: 'o1' }, { schema, pages: {}, locale: 'pt-BR', answers: { Quem: 'Bia', Extra: 'k' }, epoch: new Date(2026, 9, 7, 9, 5).getTime() })
  assert.equal(done.title, 'Visita 07/10 — Bia')
  assert.equal(done.props.n, 'Obs k 2026')
  assert.equal(textOf(done.blocks as any[]), 'Para Visita 07/10 — Bia: Bia em 7 de outubro de 2026')
  assert.equal(done.props.s, 'o1', 'valores que não são texto ficam intactos')
  // sem respostas usa os padrões
  assert.equal(expandRowTemplate(template, {}, { schema, pages: {}, locale: 'pt-BR' }).title.endsWith('Ana'), true)
})

test('catálogo: toda variável tem prévia, descrição nos dois idiomas e resolve (exceto de bloco)', () => {
  for (const info of TEMPLATE_VARIABLES) {
    assert.ok(info.desc['pt-BR'] && info.desc['en-US'], info.id)
    for (const locale of ['pt-BR', 'en-US'] as const) assert.ok(previewVariable(info, locale).length > 0, `${info.id}/${locale}`)
  }
  assert.equal(resolveToken('data', pt).ok, true)
  assert.equal(nowContext('pt-BR', {}, new Date(2026, 9, 7, 9, 5).getTime()).date, '2026-10-07')
  assert.match(previewVariable(TEMPLATE_VARIABLES.find(i => i.id === 'time')!, 'pt-BR'), /^\d\d:\d\d$/)
})
