// Motor de modelos com {{variáveis}} — parte pura (sem store, sem React, sem executar código).
// Usado pela nota diária, modelos de página, modelos pessoais, modelos de linha de banco e modelos de tipo.
// Regras: nomes em pt-BR e en-US (alias); variável desconhecida fica literal e é devolvida em `unknown`;
// estilos do texto são preservados; sempre devolve blocos novos com ids novos. docs/USAGE.md
import { addDays, addMonths, formatLongDate, formatMonthName, formatShortDate, formatWeekday, isoWeek, localDay, localTime, type DailyLocale } from './dates.ts'
import { queryBlockProps, queryTemplate, templateByName } from '../query/templates.ts'

export type TemplateLocale = DailyLocale
export type TemplateInline = { type: string; text?: string; href?: string; styles?: Record<string, unknown>; content?: TemplateInline[] }
export type TemplateBlock = { id?: string; type?: string; props?: Record<string, unknown>; content?: unknown; children?: TemplateBlock[] }

export interface TemplateTaskLine { title: string; pageTitle: string; href: string; time?: string }
export interface TemplateContext {
  /** Dia civil AAAA-MM-DD ("hoje" da aplicação). */
  date: string
  /** HH:mm local. */
  time?: string
  locale: TemplateLocale
  /** Título da página que recebe o modelo. */
  title?: string
  userName?: string
  /** Valores legíveis das propriedades da linha (chave: nome em minúsculas, sem acento). Só em modelos de banco. */
  props?: Record<string, string>
  /** Respostas de {{pergunta:Texto}} (chave: o texto da pergunta). Sem resposta: usa o padrão, ou vazio. */
  answers?: Record<string, string>
  /** Links de {{ontem}}/{{amanha}} (nota diária). Sem link, viram a data por extenso. */
  yesterdayHref?: string
  tomorrowHref?: string
  /** Tarefas de {{tarefas_do_dia}} (só na nota diária; sem isto a variável fica literal). */
  tasks?: TemplateTaskLine[]
}
export interface TemplateCursor { path: number[]; atEnd: boolean }
export interface ExpandResult { blocks: TemplateBlock[]; unknown: string[]; cursor: TemplateCursor | null }
export interface TemplateQuestion { label: string; default: string }

/** Contexto "agora" (fuso do sistema). */
export function nowContext(locale: TemplateLocale, extra: Partial<TemplateContext> = {}, epoch = Date.now()): TemplateContext {
  return { date: localDay(epoch), time: localTime(epoch), locale, ...extra }
}

const strip = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** Chave estável de nome de propriedade para {{prop:Nome}}. */
export const propKey = strip

type Kind = 'date' | 'time' | 'title' | 'weekday' | 'yesterday' | 'tomorrow' | 'week' | 'month' | 'year' | 'user' | 'cursor' | 'ask' | 'prop' | 'agenda' | 'tasks' | 'query'
const NAMES: Record<string, Kind> = {
  data: 'date', date: 'date', hora: 'time', time: 'time', titulo: 'title', title: 'title',
  dia_da_semana: 'weekday', dia_semana: 'weekday', weekday: 'weekday', ontem: 'yesterday', yesterday: 'yesterday',
  amanha: 'tomorrow', tomorrow: 'tomorrow', semana: 'week', week: 'week', mes: 'month', month: 'month', ano: 'year', year: 'year',
  usuario: 'user', user: 'user', cursor: 'cursor', pergunta: 'ask', ask: 'ask', question: 'ask',
  prop: 'prop', propriedade: 'prop', property: 'prop', agenda: 'agenda', tarefas_do_dia: 'tasks', tasks: 'tasks', consulta: 'query', query: 'query',
}
const SHIFTABLE = new Set<Kind>(['date', 'weekday', 'week', 'month', 'year'])
const UNITS: Record<string, 'd' | 'w' | 'm' | 'y'> = {
  d: 'd', dia: 'd', dias: 'd', day: 'd', days: 'd', w: 'w', week: 'w', weeks: 'w', m: 'm', mes: 'm', meses: 'm', month: 'm', months: 'm',
  y: 'y', a: 'y', ano: 'y', anos: 'y', year: 'y', years: 'y',
}
const own = <T,>(object: Record<string, T> | undefined, key: string): T | undefined => object && Object.hasOwn(object, key) ? object[key] : undefined
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function shift(iso: string, sign: number, amount: number, unit: 'd' | 'w' | 'm' | 'y'): string {
  const n = sign * amount
  if (unit === 'd') return addDays(iso, n)
  if (unit === 'w') return addDays(iso, n * 7)
  return addMonths(iso, unit === 'm' ? n : n * 12)
}

/** Formata a data com AAAA/YYYY, AA/YY, MM e DD (ex.: "DD/MM/AAAA"). */
export function formatDateTokens(iso: string, format: string): string {
  const [y, m, d] = iso.split('-')
  return format.replace(/AAAA|YYYY|AA|YY|MM|DD/gi, token => {
    switch (token.toUpperCase()) {
      case 'AAAA': case 'YYYY': return y
      case 'AA': case 'YY': return y.slice(2)
      case 'MM': return m
      default: return d
    }
  })
}

export type Resolved =
  | { ok: true; kind: 'text'; value: string }
  | { ok: true; kind: 'link'; href: string; value: string }
  | { ok: true; kind: 'cursor' }
  | { ok: true; kind: 'block'; name: Kind; arg: string }
  | { ok: false }

/** Separa "Pergunta|padrão". */
export function parseQuestion(arg: string): TemplateQuestion {
  const bar = arg.indexOf('|')
  return bar < 0 ? { label: arg.trim(), default: '' } : { label: arg.slice(0, bar).trim(), default: arg.slice(bar + 1).trim() }
}

function parseToken(raw: string): { kind: Kind; name: string; arg: string; shift?: { sign: number; amount: number; unit: 'd' | 'w' | 'm' | 'y' }; format?: string } | null {
  const m = /^([\p{L}_]+)([\s\S]*)$/u.exec(raw.trim())
  if (!m) return null
  const name = strip(m[1])
  const kind = own(NAMES, name)
  if (!kind) return null
  const rest = m[2]
  if (kind === 'ask' || kind === 'prop' || kind === 'query') {
    const arg = /^\s*:\s*([\s\S]+)$/.exec(rest)?.[1]?.trim() ?? ''
    return arg ? { kind, name, arg } : null
  }
  const r = /^(?:\s*([+-])\s*(\d{1,5})\s*([\p{L}]+))?(?:\s*:\s*([\s\S]+))?$/u.exec(rest)
  if (!r) return null
  const out: { kind: Kind; name: string; arg: string; shift?: { sign: number; amount: number; unit: 'd' | 'w' | 'm' | 'y' }; format?: string } = { kind, name, arg: '' }
  if (r[1]) {
    const unit = own(UNITS, strip(r[3]))
    if (!unit || !SHIFTABLE.has(kind)) return null
    out.shift = { sign: r[1] === '-' ? -1 : 1, amount: Math.min(Number(r[2]), 36500), unit }
  }
  if (r[4]) { if (kind !== 'date') return null; out.format = r[4].trim() }
  return out
}

/** Resolve o conteúdo de um {{...}}. `ok: false` = desconhecida ou sem dados (fica literal). */
export function resolveToken(raw: string, ctx: TemplateContext): Resolved {
  const token = parseToken(raw)
  if (!token) return { ok: false }
  const { kind } = token
  const day = token.shift ? shift(ctx.date, token.shift.sign, token.shift.amount, token.shift.unit) : ctx.date
  const text = (value: string): Resolved => ({ ok: true, kind: 'text', value })
  switch (kind) {
    case 'date': return text(token.format ? formatDateTokens(day, token.format) : formatLongDate(day, ctx.locale))
    case 'time': return text(ctx.time ?? localTime())
    case 'title': return text(ctx.title ?? '')
    case 'weekday': return text(capitalize(formatWeekday(day, ctx.locale)))
    case 'week': return text(String(isoWeek(day)))
    case 'month': return text(formatMonthName(day, ctx.locale))
    case 'year': return text(day.slice(0, 4))
    case 'user': return ctx.userName?.trim() ? text(ctx.userName.trim()) : { ok: false }
    case 'cursor': return { ok: true, kind: 'cursor' }
    case 'yesterday': case 'tomorrow': {
      const en = ctx.locale === 'en-US'
      const target = addDays(ctx.date, kind === 'yesterday' ? -1 : 1)
      const href = kind === 'yesterday' ? ctx.yesterdayHref : ctx.tomorrowHref
      if (!href) return text(formatLongDate(target, ctx.locale))
      const short = formatShortDate(target, ctx.locale)
      return { ok: true, kind: 'link', href, value: kind === 'yesterday' ? `‹ ${en ? 'Yesterday' : 'Ontem'} (${short})` : `${en ? 'Tomorrow' : 'Amanhã'} (${short}) ›` }
    }
    case 'ask': { const q = parseQuestion(token.arg); return q.label ? text(own(ctx.answers, q.label) ?? q.default) : { ok: false } }
    case 'prop': {
      if (!ctx.props) return { ok: false }
      const value = own(ctx.props, propKey(token.arg))
      return value === undefined ? { ok: false } : text(value)
    }
    default: return { ok: true, kind: 'block', name: kind, arg: token.arg }
  }
}

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Texto simples (títulos): variáveis resolvidas, desconhecidas literais; links viram texto e {{cursor}} some. */
export function expandTemplateText(source: string, ctx: TemplateContext): { text: string; unknown: string[] } {
  const unknown = new Set<string>()
  const text = source.replace(TOKEN, (whole, raw: string) => {
    const r = resolveToken(raw, ctx)
    if (!r.ok) { unknown.add(whole); return whole }
    if (r.kind === 'text' || r.kind === 'link') return r.value
    if (r.kind === 'cursor') return ''
    return whole
  })
  return { text, unknown: [...unknown] }
}

/** Perguntas {{pergunta:Texto|padrão}} do texto/blocos (únicas por texto, na ordem em que aparecem). */
export function collectQuestions(blocks: readonly unknown[], extraTexts: readonly string[] = []): TemplateQuestion[] {
  const found = new Map<string, TemplateQuestion>()
  const scan = (source: string) => {
    for (const match of source.matchAll(TOKEN)) {
      const token = parseToken(match[1])
      if (token?.kind !== 'ask') continue
      const q = parseQuestion(token.arg)
      if (q.label && !found.has(q.label)) found.set(q.label, q)
    }
  }
  extraTexts.forEach(scan)
  const walkInline = (content: unknown) => {
    if (!Array.isArray(content)) return
    for (const item of content as TemplateInline[]) { if (typeof item?.text === 'string') scan(item.text); walkInline(item?.content) }
  }
  const walk = (list: readonly unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as TemplateBlock
      forEachContent(block.content, walkInline)
      walk(block.children ?? [])
    }
  }
  walk(blocks)
  return [...found.values()]
}

/** Conteúdo em linha de um bloco: lista de inline ou células de tabela. */
function forEachContent(content: unknown, visit: (inline: unknown) => void) {
  if (Array.isArray(content)) { visit(content); return }
  const rows = (content as { type?: string; rows?: { cells?: unknown[] }[] } | null)?.rows
  if ((content as { type?: string } | null)?.type === 'tableContent' && Array.isArray(rows)) {
    for (const row of rows) for (const cell of row.cells ?? []) visit(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content)
  }
}

export const plainText = (content: unknown): string => Array.isArray(content) ? content.map(item => typeof item?.text === 'string' ? item.text : Array.isArray(item?.content) ? plainText(item.content) : '').join('') : ''

const text = (value: string, styles: Record<string, unknown> = {}): TemplateInline => ({ type: 'text', text: value, styles })
const BASE_PROPS = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }
const newBlock = (type: string, content: TemplateInline[] | undefined, props: Record<string, unknown>, uid: () => string): TemplateBlock => ({ id: uid(), type, props: { ...BASE_PROPS, ...props }, ...(content ? { content } : {}), children: [] })

function taskBlocks(ctx: TemplateContext, uid: () => string): TemplateBlock[] {
  const en = ctx.locale === 'en-US'
  const tasks = ctx.tasks ?? []
  if (!tasks.length) return [newBlock('paragraph', [text(en ? 'No tasks due on this day.' : 'Nenhuma tarefa para este dia.', { italic: true })], { textColor: 'gray' }, uid)]
  return tasks.slice(0, 50).map(task => newBlock('bulletListItem', [
    ...(task.time ? [text(task.time + ' ', { bold: true })] : []),
    { type: 'link', href: task.href, content: [text(task.title || (en ? 'Untitled' : 'Sem título'))] },
    ...(task.pageTitle ? [text(` — ${task.pageTitle}`, { italic: true })] : []),
  ], {}, uid))
}

interface State { merge: boolean; ctx: TemplateContext; unknown: Set<string>; cursor: TemplateCursor | null; cursorOffset: number }

function expandInline(content: TemplateInline[], state: State, emitted: { length: number }): TemplateInline[] {
  const out: TemplateInline[] = []
  const add = (item: TemplateInline) => { out.push(item); if (typeof item.text === 'string') emitted.length += item.text.length }
  for (const item of content) {
    if (item.type === 'link' && Array.isArray(item.content)) { out.push({ ...item, content: expandInline(item.content, state, emitted) }); continue }
    if (item.type !== 'text' || typeof item.text !== 'string' || !item.text.includes('{{')) { out.push(item); if (typeof item.text === 'string') emitted.length += item.text.length; continue }
    let index = 0
    const styles = item.styles ?? {}
    for (const match of item.text.matchAll(TOKEN)) {
      if (match.index! > index) add({ ...item, text: item.text.slice(index, match.index) })
      index = match.index! + match[0].length
      const r = resolveToken(match[1], state.ctx)
      if (!r.ok) { state.unknown.add(match[0]); add({ ...item, text: match[0] }) }
      else if (r.kind === 'text') { if (r.value) add({ type: 'text', text: r.value, styles: { ...styles } }) }
      else if (r.kind === 'link') { out.push({ type: 'link', href: r.href, content: [text(r.value)] }); emitted.length += r.value.length }
      else if (r.kind === 'cursor') { if (!state.cursor) { state.cursorOffset = emitted.length; state.cursor = { path: [], atEnd: true } } }
      else add({ ...item, text: match[0] }) // agenda/tarefas/consulta fora de um parágrafo próprio: literal
    }
    if (index < item.text.length) add({ ...item, text: item.text.slice(index) })
  }
  return state.merge ? mergeText(out) : out
}

/** Junta textos vizinhos com o mesmo estilo (o resultado de uma variável não vira um pedaço separado). */
function mergeText(list: TemplateInline[]): TemplateInline[] {
  const out: TemplateInline[] = []
  for (const item of list) {
    const last = out[out.length - 1]
    if (last && last.type === 'text' && item.type === 'text' && typeof last.text === 'string' && typeof item.text === 'string' && JSON.stringify(last.styles ?? {}) === JSON.stringify(item.styles ?? {})) out[out.length - 1] = { ...last, text: last.text + item.text }
    else out.push(item)
  }
  return out
}

/**
 * Aplica o modelo (`baseProps`: completa as props padrão de texto, como na nota diária; `mergeText`: junta textos vizinhos de mesmo estilo; `keepIds`: preserva os ids do modelo
 * — quem insere deve clonar o documento). Parágrafo só com {{agenda}} vira o bloco "Agenda de hoje"; só com {{tarefas_do_dia}} (se `ctx.tasks`),
 * a lista de tarefas; só com {{consulta:nome}}, um bloco de consulta viva. O resto é texto com variáveis substituídas.
 */
export function expandTemplate(blocks: readonly unknown[], ctx: TemplateContext, uid: () => string = () => crypto.randomUUID(), options: { baseProps?: boolean; keepIds?: boolean; mergeText?: boolean } = {}): ExpandResult {
  // Pergunta repetida: a 1ª ocorrência define o padrão das demais.
  const defaults = Object.fromEntries(collectQuestions(blocks).map(q => [q.label, q.default]))
  ctx = { ...ctx, answers: { ...defaults, ...ctx.answers } }
  const state: State = { merge: !!options.mergeText, ctx, unknown: new Set(), cursor: null, cursorOffset: 0 }
  const walk = (list: readonly unknown[], prefix: number[]): TemplateBlock[] => {
    const out: TemplateBlock[] = []
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as TemplateBlock
      const only = plainText(block.content).trim().toLowerCase()
      if (/^\{\{\s*agenda\s*\}\}$/.test(only)) { out.push({ id: uid(), type: 'calendarAgenda', props: {}, children: [] }); continue }
      if (ctx.tasks && /^\{\{\s*(tarefas_do_dia|tasks)\s*\}\}$/.test(only)) { out.push(...taskBlocks(ctx, uid)); continue }
      // {{consulta:tarefas_do_dia}} / {{query:open_tasks}} sozinho no parágrafo vira um bloco de consulta viva (docs/QUERIES.md).
      const named = /^\{\{\s*(?:consulta|query)\s*:\s*([\wÀ-ſ-]+)\s*\}\}$/.exec(only)
      const template = named ? templateByName(named[1]) : null
      if (template) { out.push({ id: uid(), type: 'query', props: queryBlockProps(queryTemplate(template, { date: ctx.date }), { locale: ctx.locale }), children: [] }); continue }
      const index = out.length
      const path = [...prefix, index]
      const hadCursor = state.cursor !== null
      const next: TemplateBlock = { ...block, id: options.keepIds && block.id ? block.id : uid(), type: block.type ?? 'paragraph', props: { ...(options.baseProps && block.type !== 'calendarAgenda' && block.type !== 'divider' ? BASE_PROPS : {}), ...(block.props ?? {}) }, children: [] }
      const emitted = { length: 0 }
      if (Array.isArray(block.content)) next.content = expandInline(block.content as TemplateInline[], state, emitted)
      else if ((block.content as { type?: string } | null)?.type === 'tableContent') {
        const table = structuredClone(block.content) as { rows: { cells: unknown[] }[] }
        for (const row of table.rows ?? []) row.cells = (row.cells ?? []).map(cell => Array.isArray(cell) ? expandInline(cell as TemplateInline[], state, { length: 0 }) : (cell && typeof (cell as { content?: unknown }).content !== 'undefined' && Array.isArray((cell as { content: unknown }).content)) ? { ...(cell as object), content: expandInline((cell as { content: TemplateInline[] }).content, state, { length: 0 }) } : cell)
        next.content = table
      }
      if (!hadCursor && state.cursor) { state.cursor = { path, atEnd: state.cursorOffset >= emitted.length } }
      next.children = walk(block.children ?? [], path)
      out.push(next)
    }
    return out
  }
  const result = walk(blocks, [])
  return { blocks: result, unknown: [...state.unknown], cursor: state.cursor }
}

/** Bloco (da lista inserida) apontado pelo cursor, por caminho de índices. */
export function blockAtPath<T extends { children?: T[] }>(inserted: readonly T[], path: readonly number[]): T | null {
  let list: readonly T[] | undefined = inserted
  let block: T | null = null
  for (const index of path) { block = list?.[index] ?? null; if (!block) return null; list = block.children }
  return block
}

// ---------- Catálogo para a interface (lista descritiva, prévia, menu "/") ----------

export interface VariableInfo {
  id: string
  pt: string
  en: string
  /** Texto a inserir por idioma da interface. */
  token: { 'pt-BR': string; 'en-US': string }
  desc: { 'pt-BR': string; 'en-US': string }
  /** 'row': só faz sentido em modelo de linha de banco. 'daily': nota diária. */
  scope: 'all' | 'row' | 'daily'
  /** Só insere o texto (não tem prévia calculada). */
  sample?: { 'pt-BR': string; 'en-US': string }
}
const v = (id: string, pt: string, en: string, ptTok: string, enTok: string, ptDesc: string, enDesc: string, scope: VariableInfo['scope'] = 'all', sample?: [string, string]): VariableInfo =>
  ({ id, pt, en, token: { 'pt-BR': ptTok, 'en-US': enTok }, desc: { 'pt-BR': ptDesc, 'en-US': enDesc }, scope, ...(sample ? { sample: { 'pt-BR': sample[0], 'en-US': sample[1] } } : {}) })

export const TEMPLATE_VARIABLES: readonly VariableInfo[] = [
  v('date', 'Data', 'Date', '{{data}}', '{{date}}', 'Data de hoje por extenso.', 'Today’s date in full.'),
  v('time', 'Hora', 'Time', '{{hora}}', '{{time}}', 'Hora atual (HH:mm).', 'Current time (HH:mm).'),
  v('title', 'Título da página', 'Page title', '{{titulo}}', '{{title}}', 'Título da página que recebe o modelo.', 'Title of the page receiving the template.'),
  v('weekday', 'Dia da semana', 'Weekday', '{{dia_da_semana}}', '{{weekday}}', 'Nome do dia da semana.', 'Name of the weekday.'),
  v('yesterday', 'Ontem', 'Yesterday', '{{ontem}}', '{{yesterday}}', 'Data de ontem (link, na nota diária).', 'Yesterday’s date (a link in the daily note).'),
  v('tomorrow', 'Amanhã', 'Tomorrow', '{{amanha}}', '{{tomorrow}}', 'Data de amanhã (link, na nota diária).', 'Tomorrow’s date (a link in the daily note).'),
  v('week', 'Semana', 'Week', '{{semana}}', '{{week}}', 'Número da semana ISO.', 'ISO week number.'),
  v('month', 'Mês', 'Month', '{{mes}}', '{{month}}', 'Nome do mês.', 'Name of the month.'),
  v('year', 'Ano', 'Year', '{{ano}}', '{{year}}', 'Ano com quatro dígitos.', 'Four-digit year.'),
  v('user', 'Usuário', 'User', '{{usuario}}', '{{user}}', 'Seu nome, de Configurações → Geral (se definido).', 'Your name from Settings → General (if set).'),
  v('date-plus', 'Data daqui a 7 dias', 'Date in 7 days', '{{data+7d}}', '{{date+7d}}', 'Data relativa: d = dias, w = semanas, m = meses, y = anos (ex.: -1m).', 'Relative date: d = days, w = weeks, m = months, y = years (e.g. -1m).'),
  v('date-format', 'Data com formato', 'Formatted date', '{{data:DD/MM/AAAA}}', '{{date:YYYY-MM-DD}}', 'Formato livre com AAAA, MM e DD.', 'Free format using YYYY, MM and DD.'),
  v('cursor', 'Posição do cursor', 'Cursor position', '{{cursor}}', '{{cursor}}', 'Onde o cursor fica depois de inserir o modelo.', 'Where the cursor lands after the template is inserted.', 'all', ['(cursor aqui)', '(cursor here)']),
  v('ask', 'Pergunta', 'Question', '{{pergunta:Nome do cliente|Fulano}}', '{{ask:Client name|John}}', 'Pergunta ao aplicar o modelo; depois de | vai o valor padrão.', 'Asks when the template is applied; the value after | is the default.', 'all', ['Fulano', 'John']),
  v('prop', 'Propriedade da linha', 'Row property', '{{prop:Nome}}', '{{prop:Name}}', 'Valor de uma propriedade da linha (modelos de banco).', 'Value of a row property (database templates).', 'row', ['(valor da propriedade)', '(property value)']),
  v('agenda', 'Agenda de hoje', 'Today’s agenda', '{{agenda}}', '{{agenda}}', 'Sozinha num parágrafo: bloco com os eventos do dia.', 'Alone in a paragraph: a block with the day’s events.', 'daily', ['(bloco da agenda)', '(agenda block)']),
  v('tasks', 'Tarefas do dia', 'Tasks for the day', '{{tarefas_do_dia}}', '{{tasks}}', 'Sozinha num parágrafo: lista das tarefas com prazo no dia.', 'Alone in a paragraph: list of tasks due that day.', 'daily', ['(tarefas do dia)', '(tasks for the day)']),
]

export const variableToken = (info: VariableInfo, locale: TemplateLocale) => info.token[locale]
export const variableName = (info: VariableInfo, locale: TemplateLocale) => locale === 'en-US' ? info.en : info.pt

/** Prévia do resultado de uma variável com a data/hora de agora. */
export function previewVariable(info: VariableInfo, locale: TemplateLocale, ctx: Partial<TemplateContext> = {}): string {
  const full = nowContext(locale, { title: locale === 'en-US' ? 'My page' : 'Minha página', userName: 'Marcelo', ...ctx })
  const r = resolveToken(variableToken(info, locale).slice(2, -2), full)
  if (info.sample && (!r.ok || r.kind === 'cursor' || r.kind === 'block' || info.id === 'prop')) return info.sample[locale]
  if (!r.ok) return info.sample?.[locale] ?? variableToken(info, locale)
  if (r.kind === 'text' || r.kind === 'link') return r.value
  return info.sample?.[locale] ?? ''
}
