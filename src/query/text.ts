// Modo texto das consultas (avançado e opcional): sintaxe curta e legível em PT-BR e EN, sempre
// conversível nos dois sentidos com o modelo (`parseQueryText` ↔ `serializeQuery`).
//   tabela de "Projetos" onde Status = "Em andamento" e Prazo < hoje+7d ordenar Prazo limite 20
//   list from all pages where edited >= last 7 days sort edited desc
// Também fornece realce (trechos com papéis), autocompletar contextual e erros com posição.
import type { FilterOp } from '../types'
import { RELATIVE_DATE } from '../components/database/filterEngine.ts'
import { registeredTypes } from '../objecttypes/registry.ts'
import { MAX_DEPTH, MAX_RULES, defaultQuery, newNodeId, normalizeQuery, type Query, type QueryDisplay, type QueryGroup, type QueryNode, type QuerySort, type QuerySource, type QueryValue } from './model.ts'

export type Locale = 'pt-BR' | 'en-US'
export interface TextContext {
  locale?: Locale
  /** Bancos disponíveis (id + título) para resolver nomes e sugerir. */
  databases?: { id: string; title: string }[]
  /** Páginas por título (fonte "filhas de"/"backlinks de"). */
  pages?: { id: string; title: string }[]
  /** Nomes de propriedades conhecidas (realce/sugestões). */
  properties?: string[]
  /** Opções de seleção por nome de propriedade (sugestões de valor). */
  options?: Record<string, string[]>
  /** Tipos de objeto (id + nome): fonte `tipo "Pessoa"` e valores do campo `tipo`. */
  types?: { id: string; name: string }[]
}
export interface TextError { message: string; from: number; to: number }
export type SegmentKind = 'text' | 'keyword' | 'function' | 'property' | 'string' | 'number' | 'operator' | 'paren' | 'unknown'
export interface Segment { text: string; kind: SegmentKind; at: number; error?: boolean }
export interface Suggestion { label: string; insert: string; kind: 'keyword' | 'property' | 'function' | 'value' | 'database'; detail: string }

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** Tipos do contexto ou, sem contexto, os registrados pela store. */
const contextTypes = (context: TextContext) => context.types ?? registeredTypes().map((type) => ({ id: type.id, name: type.name }))
const defaultTypeName = (id: string) => registeredTypes().find((type) => type.id === id)?.name
const tr = (locale: Locale, pt: string, en: string) => locale === 'en-US' ? en : pt

// ---------- vocabulário ----------

const DISPLAY_WORDS: Record<string, QueryDisplay> = { tabela: 'table', table: 'table', lista: 'list', list: 'list', galeria: 'gallery', gallery: 'gallery', quadro: 'board', board: 'board', contagem: 'count', count: 'count', resumo: 'count', summary: 'count' }
const DISPLAY_TEXT: Record<QueryDisplay, [string, string]> = { table: ['tabela', 'table'], list: ['lista', 'list'], gallery: ['galeria', 'gallery'], board: ['quadro', 'board'], count: ['contagem', 'count'] }
const PAGE_FIELD_WORDS: Record<string, string> = {
  titulo: '@title', title: '@title', nome: '@title', name: '@title',
  criada: '@created', criado: '@created', criacao: '@created', created: '@created',
  editada: '@updated', editado: '@updated', modificada: '@updated', modificado: '@updated', edited: '@updated', updated: '@updated', modified: '@updated',
  pai: '@parent', parent: '@parent', icone: '@icon', icon: '@icon', capa: '@cover', cover: '@cover',
  palavras: '@words', words: '@words', favorita: '@favorite', favorito: '@favorite', favorite: '@favorite',
  conteudo: '@content', texto: '@content', content: '@content', text: '@content', banco: '@database', database: '@database',
  vencimento: '@due', due: '@due', concluida: '@done', concluido: '@done', done: '@done', origem: '@source', source: '@source',
  tipo: '@type', type: '@type',
}
const PAGE_FIELD_TEXT: Record<string, [string, string]> = {
  '@title': ['título', 'title'], '@created': ['criada', 'created'], '@updated': ['editada', 'edited'], '@parent': ['pai', 'parent'], '@icon': ['ícone', 'icon'],
  '@cover': ['capa', 'cover'], '@words': ['palavras', 'words'], '@favorite': ['favorita', 'favorite'], '@content': ['conteúdo', 'content'], '@database': ['banco', 'database'],
  '@due': ['vencimento', 'due'], '@done': ['concluída', 'done'], '@source': ['origem', 'source'], '@type': ['tipo', 'type'],
}
const OP_TEXT: Record<FilterOp, [string, string]> = {
  is: ['=', '='], isNot: ['!=', '!='], gt: ['>', '>'], lt: ['<', '<'], gte: ['>=', '>='], lte: ['<=', '<='],
  contains: ['contém', 'contains'], notContains: ['não contém', 'not contains'], before: ['antes de', 'before'], after: ['depois de', 'after'],
  isEmpty: ['vazio', 'is empty'], isNotEmpty: ['não vazio', 'is not empty'],
}
const RELATIVE_TEXT: Record<string, [string, string]> = {
  today: ['hoje', 'today'], yesterday: ['ontem', 'yesterday'], tomorrow: ['amanhã', 'tomorrow'],
  thisWeek: ['esta semana', 'this week'], lastWeek: ['semana passada', 'last week'], nextWeek: ['próxima semana', 'next week'],
  thisMonth: ['este mês', 'this month'], lastMonth: ['mês passado', 'last month'], nextMonth: ['próximo mês', 'next month'],
  thisYear: ['este ano', 'this year'], lastYear: ['ano passado', 'last year'], nextYear: ['próximo ano', 'next year'],
}
/** Frases de data relativa (palavras já sem acento) → chave. */
const RELATIVE_PHRASES: [string[], string][] = [
  [['hoje'], 'today'], [['today'], 'today'], [['ontem'], 'yesterday'], [['yesterday'], 'yesterday'], [['amanha'], 'tomorrow'], [['tomorrow'], 'tomorrow'],
  [['esta', 'semana'], 'thisWeek'], [['this', 'week'], 'thisWeek'], [['semana', 'passada'], 'lastWeek'], [['last', 'week'], 'lastWeek'], [['proxima', 'semana'], 'nextWeek'], [['next', 'week'], 'nextWeek'],
  [['este', 'mes'], 'thisMonth'], [['this', 'month'], 'thisMonth'], [['mes', 'passado'], 'lastMonth'], [['last', 'month'], 'lastMonth'], [['proximo', 'mes'], 'nextMonth'], [['next', 'month'], 'nextMonth'],
  [['este', 'ano'], 'thisYear'], [['this', 'year'], 'thisYear'], [['ano', 'passado'], 'lastYear'], [['last', 'year'], 'lastYear'], [['proximo', 'ano'], 'nextYear'], [['next', 'year'], 'nextYear'],
]
const KEYWORDS = new Set(['de', 'from', 'onde', 'where', 'ordenar', 'ordene', 'sort', 'order', 'por', 'by', 'agrupar', 'agrupe', 'group', 'limite', 'limit', 'colunas', 'columns', 'e', 'and', 'ou', 'or', 'nao', 'not', 'asc', 'desc', 'crescente', 'decrescente', 'contem', 'contains', 'vazio', 'empty', 'is', 'e', 'antes', 'depois', 'before', 'after', 'esta', 'this', 'pagina', 'page', 'sim', 'yes', 'true', 'false', 'verdadeiro', 'falso', ...Object.keys(DISPLAY_WORDS)])

// ---------- tokens ----------

type TokenKind = 'word' | 'string' | 'number' | 'date' | 'op' | 'punct' | 'hash' | 'offset' | 'eof'
interface Token { kind: TokenKind; text: string; value: string; from: number; to: number; folded: string }

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»' }

export function tokenize(source: string): { tokens: Token[]; error: TextError | null } {
  const tokens: Token[] = []
  let i = 0, error: TextError | null = null
  const push = (kind: TokenKind, from: number, to: number, value = source.slice(from, to)) => tokens.push({ kind, text: source.slice(from, to), value, from, to, folded: fold(value) })
  while (i < source.length && tokens.length < 4000) {
    const ch = source[i]
    if (/\s/.test(ch)) { i++; continue }
    const close = QUOTES[ch]
    if (close) {
      let j = i + 1, value = ''
      while (j < source.length && source[j] !== close && !(close === '”' && source[j] === '"')) { if (source[j] === '\\' && j + 1 < source.length) { value += source[j + 1]; j += 2 } else value += source[j++] }
      if (j >= source.length) { error ??= { message: 'unterminated', from: i, to: source.length }; push('string', i, source.length, value); i = source.length; break }
      push('string', i, j + 1, value); i = j + 1; continue
    }
    const rest = source.slice(i)
    const date = /^\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}])/u.exec(rest)
    if (date) { push('date', i, i + date[0].length); i += date[0].length; continue }
    const offset = /^[+-]\s?\d{1,4}\s?[dwmyDWMY](?![\p{L}\p{N}])/u.exec(rest)
    if (offset && tokens.length && tokens[tokens.length - 1].kind === 'word') { push('offset', i, i + offset[0].length, offset[0].replace(/\s/g, '').toLowerCase()); i += offset[0].length; continue }
    const number = /^-?\d+(?:[.,]\d+)?(?![\p{L}])/u.exec(rest)
    if (number) { push('number', i, i + number[0].length, number[0].replace(',', '.')); i += number[0].length; continue }
    const op = /^(?:!=|<>|>=|<=|=>|=<|==|=|<|>|≠|≥|≤)/.exec(rest)
    if (op) { push('op', i, i + op[0].length); i += op[0].length; continue }
    if (ch === '(' || ch === ')' || ch === ',') { push('punct', i, i + 1); i++; continue }
    const hash = /^#([\p{L}\p{N}_\-/]+)/u.exec(rest)
    if (hash) { push('hash', i, i + hash[0].length, hash[1]); i += hash[0].length; continue }
    const word = /^[\p{L}_@][\p{L}\p{N}_]*/u.exec(rest)
    if (word) { push('word', i, i + word[0].length); i += word[0].length; continue }
    error ??= { message: 'char', from: i, to: i + 1 }
    push('word', i, i + 1); i++
  }
  tokens.push({ kind: 'eof', text: '', value: '', from: source.length, to: source.length, folded: '' })
  return { tokens, error }
}

// ---------- parser ----------

type Expect = 'display' | 'clause' | 'source' | 'field' | 'op' | 'value' | 'connector' | 'direction' | 'number' | 'database' | 'page' | 'type'
class ParseFailure extends Error { info: TextError; constructor(info: TextError) { super(info.message); this.info = info } }

export interface ParseResult { query: Query | null; error: TextError | null; roles: Map<number, SegmentKind>; expected: { kinds: Set<Expect>; field?: string } }

export function parseQueryText(source: string, context: TextContext = {}): ParseResult {
  const locale = context.locale ?? 'pt-BR'
  const { tokens, error: lexError } = tokenize(source)
  const roles = new Map<number, SegmentKind>()
  const expected: ParseResult['expected'] = { kinds: new Set() }
  let pos = 0
  const peek = (offset = 0) => tokens[Math.min(pos + offset, tokens.length - 1)]
  const atEnd = () => peek().kind === 'eof'
  const expect = (kind: Expect, field?: string) => { if (atEnd()) { expected.kinds.add(kind); if (field !== undefined) expected.field = field } }
  const fail = (pt: string, en: string, token = peek()): never => { throw new ParseFailure({ message: tr(locale, pt, en), from: token.from, to: Math.max(token.to, token.from + 1) }) }
  const role = (kind: SegmentKind, at = pos) => roles.set(at, kind)
  const isWord = (folded: string, offset = 0) => peek(offset).kind === 'word' && peek(offset).folded === folded
  /** Consome uma sequência de palavras (sem acento) se presente. */
  const phrase = (...words: string[]): boolean => {
    for (let k = 0; k < words.length; k++) if (!isWord(words[k], k)) return false
    for (let k = 0; k < words.length; k++) role('keyword', pos++)
    return true
  }
  const anyPhrase = (...options: string[][]) => options.some((words) => phrase(...words))

  const query: Query = defaultQuery()
  let rules = 0

  const readName = (what: 'database' | 'page'): { text: string; token: Token } => {
    expect(what)
    const token = peek()
    if (token.kind === 'string') { role(what === 'database' ? 'function' : 'string'); pos++; return { text: token.value, token } }
    return fail(what === 'database' ? 'Esperava o nome de um banco entre aspas.' : 'Esperava “esta página” ou um título entre aspas.', what === 'database' ? 'Expected a database name in quotes.' : 'Expected “this page” or a title in quotes.')
  }
  const resolveDatabase = (name: string, token: Token): string => {
    const list = context.databases ?? []
    const hit = list.find((db) => db.id === name) ?? list.find((db) => fold(db.title.trim()) === fold(name.trim()))
    if (hit) return hit.id
    if (/^[0-9a-f-]{36}$/i.test(name)) return name
    return fail(`Banco “${name}” não encontrado.`, `Database “${name}” not found.`, token)
  }
  const readPageRef = (): string => {
    expect('page')
    if (anyPhrase(['esta', 'pagina'], ['this', 'page'])) return '@thisPage'
    const { text, token } = readName('page')
    const list = context.pages ?? []
    const hit = list.find((page) => page.id === text) ?? list.find((page) => fold(page.title.trim()) === fold(text.trim()))
    if (hit) return hit.id
    if (/^[0-9a-f-]{36}$/i.test(text)) return text
    return fail(`Página “${text}” não encontrada.`, `Page “${text}” not found.`, token)
  }
  const resolveType = (name: string): string | null => {
    const list = contextTypes(context)
    const wanted = fold(name.replace(/^#/, '').trim())
    return list.find((type) => type.id === name)?.id ?? list.find((type) => fold(type.name.trim()) === wanted)?.id ?? null
  }
  const readInt = (min: number, max: number): number => {
    expect('number')
    const token = peek()
    if (token.kind !== 'number' || !/^\d+$/.test(token.value)) return fail('Esperava um número inteiro.', 'Expected a whole number.')
    const n = Number(token.value)
    if (n < min || n > max) return fail(`Use um número entre ${min} e ${max}.`, `Use a number between ${min} and ${max}.`)
    role('number'); pos++
    return n
  }

  const readSource = (): QuerySource => {
    expect('source'); expect('database')
    const token = peek()
    if (token.kind === 'string') {
      const ids = [resolveDatabase(token.value, token)]; role('function'); pos++
      while (peek().kind === 'punct' && peek().text === ',') { role('paren', pos++); const next = readName('database'); ids.push(resolveDatabase(next.text, next.token)) }
      return ids.length > 1 ? { kind: 'databases', databaseIds: ids } : { kind: 'database', databaseIds: ids }
    }
    if (token.kind === 'hash') { role('string'); pos++; return { kind: 'tag', tag: token.value } }
    if (anyPhrase(['todas', 'as', 'paginas'], ['todas', 'paginas'], ['paginas'], ['all', 'pages'], ['pages'])) return { kind: 'pages' }
    if (anyPhrase(['filhas', 'de'], ['subpaginas', 'de'], ['children', 'of'])) return { kind: 'children', pageId: readPageRef() }
    if (anyPhrase(['descendentes', 'de'], ['descendants', 'of'])) return { kind: 'children', pageId: readPageRef(), deep: true }
    if (phrase('tag')) {
      expect('value')
      const t = peek()
      if (t.kind === 'string' || t.kind === 'word' || t.kind === 'hash') { role('string'); pos++; return { kind: 'tag', tag: t.value } }
      return fail('Esperava o nome da etiqueta.', 'Expected the tag name.')
    }
    if (anyPhrase(['modificadas'], ['editadas'], ['modified'], ['edited'])) {
      anyPhrase(['nos'], ['em'], ['in', 'the'], ['in'])
      if (!anyPhrase(['ultimos'], ['last'])) { return fail('Esperava “últimos N dias”.', 'Expected “last N days”.') }
      const days = readInt(1, 3650)
      if (!anyPhrase(['dias'], ['dia'], ['days'], ['day'])) return fail('Esperava “dias”.', 'Expected “days”.')
      return { kind: 'modified', days }
    }
    if (anyPhrase(['relacionadas', 'a', 'esta', 'pagina'], ['relacionadas', 'com', 'esta', 'pagina'], ['related', 'to', 'this', 'page'])) {
      const out: QuerySource = { kind: 'relatedToThis' }
      if (anyPhrase(['em'], ['in'])) { const { text, token: t } = readName('database'); out.databaseIds = [resolveDatabase(text, t)] }
      return out
    }
    if (anyPhrase(['backlinks'], ['mencoes'], ['mentions'])) {
      const out: QuerySource = { kind: 'backlinks' }
      if (anyPhrase(['de'], ['of'])) { const ref = readPageRef(); if (ref !== '@thisPage') out.pageId = ref }
      return out
    }
    if (anyPhrase(['tipo'], ['tipos'], ['type'], ['types'])) {
      const ids: string[] = []
      for (let k = 0; k < 32; k++) {
        expect('type')
        const t = peek()
        if (t.kind !== 'string' && t.kind !== 'word' && t.kind !== 'hash') return fail('Esperava o nome de um tipo entre aspas.', 'Expected a type name in quotes.')
        const id = resolveType(t.value)
        if (!id) return fail(`Tipo “${t.value}” não encontrado.`, `Type “${t.value}” not found.`, t)
        role('function'); pos++
        ids.push(id)
        if (peek().kind === 'punct' && peek().text === ',' && (peek(1).kind === 'string' || peek(1).kind === 'hash')) { role('paren', pos++); continue }
        break
      }
      return { kind: 'type', typeIds: ids }
    }
    if (anyPhrase(['tarefas'], ['tasks'])) {
      const out: QuerySource = { kind: 'tasks' }
      if (anyPhrase(['incluindo', 'concluidas'], ['com', 'concluidas'], ['including', 'done'], ['with', 'done'])) out.includeDone = true
      return out
    }
    return fail('Fonte desconhecida. Use um banco entre aspas, “todas as páginas”, “filhas de…”, “#tag”, “tarefas”…', 'Unknown source. Use a database in quotes, “all pages”, “children of…”, “#tag”, “tasks”…')
  }

  const readField = (): string => {
    expect('field')
    const token = peek()
    if (token.kind === 'string') { role('property'); pos++; return token.value }
    if (token.kind === 'word') {
      const mapped = PAGE_FIELD_WORDS[token.folded]
      if (mapped) { role('function'); pos++; return mapped }
      if (!KEYWORDS.has(token.folded)) { role('property'); pos++; return token.text }
    }
    return fail('Esperava um campo (propriedade entre aspas ou título, criada, editada…).', 'Expected a field (property in quotes or title, created, edited…).')
  }

  const readOp = (field: string): FilterOp => {
    expect('op', field)
    const token = peek()
    if (token.kind === 'op') {
      role('operator'); pos++
      switch (token.text) { case '=': case '==': return 'is'; case '!=': case '<>': case '≠': return 'isNot'; case '>': return 'gt'; case '<': return 'lt'; case '>=': case '=>': case '≥': return 'gte'; default: return 'lte' }
    }
    if (anyPhrase(['nao', 'esta', 'vazio'], ['nao', 'vazio'], ['is', 'not', 'empty'], ['not', 'empty'])) return 'isNotEmpty'
    if (anyPhrase(['esta', 'vazio'], ['vazio'], ['is', 'empty'], ['empty'])) return 'isEmpty'
    if (anyPhrase(['nao', 'contem'], ['not', 'contains'], ['does', 'not', 'contain'])) return 'notContains'
    if (anyPhrase(['contem'], ['contains'])) return 'contains'
    if (anyPhrase(['nao', 'e'], ['is', 'not'])) return 'isNot'
    if (anyPhrase(['antes', 'de'], ['before'])) return 'before'
    if (anyPhrase(['depois', 'de'], ['after'])) return 'after'
    if (anyPhrase(['e'], ['is'])) return 'is'
    return fail('Esperava um operador (=, !=, <, >, contém, vazio…).', 'Expected an operator (=, !=, <, >, contains, empty…).')
  }

  const typeValue = (text: string) => field0 === '@type' ? resolveType(text) ?? text : text
  let field0 = ''
  const readValue = (field: string): QueryValue => {
    expect('value', field)
    field0 = field
    const token = peek()
    if (token.kind === 'punct' && token.text === '(') {
      // Lista: tipo = ("Pessoa", "Projeto") — "qualquer um de" (ou "nenhum de" com !=).
      role('paren', pos++)
      const list: string[] = []
      for (let k = 0; k < 32; k++) {
        expect('value', field)
        const item = peek()
        if (item.kind !== 'string' && item.kind !== 'word' && item.kind !== 'hash') return fail('Esperava um valor entre aspas.', 'Expected a quoted value.')
        role('string'); pos++
        list.push(typeValue(item.value))
        if (peek().kind === 'punct' && peek().text === ',') { role('paren', pos++); continue }
        break
      }
      if (!(peek().kind === 'punct' && peek().text === ')')) return fail('Faltou fechar a lista.', 'Missing closing parenthesis.')
      role('paren', pos++)
      return list.length > 1 ? list : list[0] ?? null
    }
    if (token.kind === 'string') { role('string'); pos++; return typeValue(token.value) }
    if (token.kind === 'hash' && field === '@type') { role('string'); pos++; return typeValue(token.value) }
    if (token.kind === 'number') { role('number'); pos++; return Number(token.value) }
    if (token.kind === 'date') { role('number'); pos++; return token.value }
    if (token.kind === 'word') {
      if (anyPhrase(['esta', 'pagina'], ['this', 'page'])) return '@thisPage'
      const lastN = anyPhrase(['ultimos'], ['last']) ? 'past' : anyPhrase(['proximos'], ['next']) ? 'next' : null
      if (lastN) {
        const n = readInt(1, 3650)
        if (!anyPhrase(['dias'], ['dia'], ['days'], ['day'])) return fail('Esperava “dias”.', 'Expected “days”.')
        return `@${lastN}${n}d`
      }
      for (const [words, key] of RELATIVE_PHRASES) {
        if (!phrase(...words)) continue
        for (let k = 1; k <= words.length; k++) roles.set(pos - k, 'number')
        let value = `@${key}`
        if (peek().kind === 'offset') { role('number'); value += peek().value; pos++ }
        if (!RELATIVE_DATE.test(value)) return fail('Deslocamento de data inválido.', 'Invalid date offset.')
        return value
      }
      if (['sim', 'yes', 'true', 'verdadeiro', 'marcado', 'marcada', 'checked'].includes(token.folded)) { role('keyword'); pos++; return true }
      if (['nao', 'no', 'false', 'falso', 'desmarcado', 'desmarcada', 'unchecked'].includes(token.folded)) { role('keyword'); pos++; return false }
      if (!KEYWORDS.has(token.folded)) { role('string'); pos++; return typeValue(token.text) }
    }
    return fail('Esperava um valor (texto entre aspas, número, data, hoje+7d…).', 'Expected a value (quoted text, number, date, today+7d…).')
  }

  const readCondition = (depth: number): QueryNode => {
    if ((isWord('nao') || isWord('not')) && peek(1).kind === 'punct' && peek(1).text === '(') {
      role('keyword', pos++)
      const inner = readCondition(depth)
      const group: QueryGroup = inner.kind === 'group' ? { ...inner } : { kind: 'group', id: newNodeId(), operator: 'and', children: [inner] }
      group.negate = true
      return group
    }
    if (peek().kind === 'punct' && peek().text === '(') {
      if (depth >= MAX_DEPTH) fail('Grupos aninhados demais.', 'Too many nested groups.')
      role('paren', pos++)
      const inner = readOr(depth + 1)
      if (!(peek().kind === 'punct' && peek().text === ')')) { expect('connector'); fail('Faltou fechar o parêntese.', 'Missing closing parenthesis.') }
      role('paren', pos++)
      return inner.kind === 'group' ? inner : { kind: 'group', id: newNodeId(), operator: 'and', children: [inner] }
    }
    const fieldToken = peek()
    const field = readField()
    const op = readOp(field)
    const value = op === 'isEmpty' || op === 'isNotEmpty' ? null : readValue(field)
    if (++rules > MAX_RULES) fail(`Use no máximo ${MAX_RULES} condições.`, `Use at most ${MAX_RULES} conditions.`, fieldToken)
    return { kind: 'rule', id: newNodeId(), field, op, value }
  }
  const readAnd = (depth: number): QueryNode[] => {
    const items = [readCondition(depth)]
    for (let guard = 0; guard < MAX_RULES * 2; guard++) {
      expect('connector')
      if (isWord('e') || isWord('and')) { role('keyword', pos++); items.push(readCondition(depth)); continue }
      break
    }
    return items
  }
  const readOr = (depth: number): QueryNode => {
    const groups = [readAnd(depth)]
    for (let guard = 0; guard < MAX_RULES * 2; guard++) {
      if (isWord('ou') || isWord('or')) { role('keyword', pos++); groups.push(readAnd(depth)); continue }
      break
    }
    // Wrapper ids are stable ('g' + position) so repeated parses of the same text keep the same tree.
    if (groups.length === 1) return groups[0].length === 1 ? groups[0][0] : { kind: 'group', id: newNodeId(), operator: 'and', children: groups[0] }
    return { kind: 'group', id: newNodeId(), operator: 'or', children: groups.map((items) => items.length === 1 ? items[0] : { kind: 'group', id: newNodeId(), operator: 'and', children: items }) }
  }

  try {
    if (lexError) {
      const token = tokens.find((item) => item.from === lexError.from) ?? peek()
      throw new ParseFailure({ ...lexError, message: lexError.message === 'unterminated' ? tr(locale, 'Aspas sem fechamento.', 'Unterminated quote.') : tr(locale, `Caractere inesperado “${source[lexError.from]}”.`, `Unexpected character “${source[lexError.from]}”.`), to: Math.max(lexError.to, token.to) })
    }
    expect('display')
    const first = peek()
    if (first.kind === 'word' && DISPLAY_WORDS[first.folded]) { role('keyword'); pos++; query.display = DISPLAY_WORDS[first.folded] }
    expect('clause')
    const seen = new Set<string>()
    for (let guard = 0; guard < 16 && !atEnd(); guard++) {
      expect('clause')
      const token = peek()
      const clause = (name: string) => { if (seen.has(name)) fail('Cláusula repetida.', 'Repeated clause.', token); seen.add(name) }
      if (anyPhrase(['de'], ['from'], ['em'])) { clause('source'); query.source = readSource(); continue }
      if (anyPhrase(['onde'], ['where'], ['com'])) {
        clause('where')
        const node = readOr(0)
        query.filter = node.kind === 'group' && !node.negate ? { ...node, id: 'root' } : { kind: 'group', id: 'root', operator: 'and', children: [node] }
        continue
      }
      if (anyPhrase(['ordenar', 'por'], ['ordenar'], ['ordene', 'por'], ['sort', 'by'], ['sort'], ['order', 'by'])) {
        clause('sort')
        const sorts: QuerySort[] = []
        for (let k = 0; k < 8; k++) {
          const field = readField()
          expect('direction')
          let direction: 'asc' | 'desc' = 'asc'
          if (anyPhrase(['desc'], ['decrescente'], ['descending'])) direction = 'desc'
          else anyPhrase(['asc'], ['crescente'], ['ascending'])
          sorts.push({ field, direction })
          if (peek().kind === 'punct' && peek().text === ',') { role('paren', pos++); continue }
          break
        }
        query.sorts = sorts
        continue
      }
      if (anyPhrase(['agrupar', 'por'], ['agrupar'], ['agrupe', 'por'], ['group', 'by'], ['group'])) { clause('group'); query.groupBy = readField(); continue }
      if (anyPhrase(['limite'], ['limit'])) { clause('limit'); query.limit = readInt(1, 10_000); continue }
      if (anyPhrase(['colunas'], ['columns'], ['mostrar'], ['show'])) {
        clause('columns')
        const columns: string[] = []
        for (let k = 0; k < 40; k++) { columns.push(readField()); if (peek().kind === 'punct' && peek().text === ',') { role('paren', pos++); continue } break }
        query.columns = columns
        continue
      }
      if (token.kind === 'word' && DISPLAY_WORDS[token.folded]) fail('A forma de exibição vem no início.', 'The display type comes first.')
      fail('Esperava “de”, “onde”, “ordenar”, “agrupar”, “limite” ou “colunas”.', 'Expected “from”, “where”, “sort”, “group”, “limit” or “columns”.')
    }
    expect('clause')
    return { query: normalizeQuery(query), error: null, roles, expected }
  } catch (cause) {
    if (cause instanceof ParseFailure) return { query: null, error: cause.info, roles, expected }
    throw cause
  }
}

// ---------- serializador ----------

const SAFE_WORD = /^[\p{L}_][\p{L}\p{N}_]*$/u
const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function fieldText(field: string, locale: Locale): string {
  const page = PAGE_FIELD_TEXT[field]
  if (page) return page[locale === 'en-US' ? 1 : 0]
  return SAFE_WORD.test(field) && !KEYWORDS.has(fold(field)) && !PAGE_FIELD_WORDS[fold(field)] ? field : quote(field)
}

export function valueToQueryText(value: QueryValue, locale: Locale, name?: (value: string) => string | undefined): string {
  const en = locale === 'en-US' ? 1 : 0
  if (Array.isArray(value)) return value.length === 1 ? quote(name?.(value[0]) ?? value[0]) : `(${value.map((item) => quote(name?.(item) ?? item)).join(', ')})`
  if (value === null) return '""'
  if (name && typeof value === 'string') { const named = name(value); if (named !== undefined) return quote(named) }
  if (typeof value === 'boolean') return value ? (en ? 'true' : 'sim') : (en ? 'false' : 'não')
  if (typeof value === 'number') return String(value)
  if (value === '@thisPage') return en ? 'this page' : 'esta página'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = RELATIVE_DATE.exec(value)
  if (match) {
    const base = match[2] ? (en ? `last ${match[2]} days` : `últimos ${match[2]} dias`) : match[3] ? (en ? `next ${match[3]} days` : `próximos ${match[3]} dias`) : RELATIVE_TEXT[match[1]][en]
    return match[4] ? `${base}${match[4]}${match[5]}${match[6]}` : base
  }
  return quote(value)
}

function nodeText(node: QueryNode, locale: Locale, nested: boolean, ctx: SerializeContext = {}): string {
  if (node.kind === 'rule') {
    const op = OP_TEXT[node.op][locale === 'en-US' ? 1 : 0]
    const name = node.field === '@type' && ctx.typeName ? (id: string) => ctx.typeName!(id) : undefined
    return node.op === 'isEmpty' || node.op === 'isNotEmpty' ? `${fieldText(node.field, locale)} ${op}` : `${fieldText(node.field, locale)} ${op} ${valueToQueryText(node.value, locale, name)}`
  }
  const parts = node.children.filter((child) => child.kind === 'rule' || child.children.length).map((child) => nodeText(child, locale, true, ctx))
  if (!parts.length) return ''
  const joined = parts.join(node.operator === 'or' ? (locale === 'en-US' ? ' or ' : ' ou ') : (locale === 'en-US' ? ' and ' : ' e '))
  if (node.negate) return `${locale === 'en-US' ? 'not' : 'não'} (${joined})`
  return nested ? `(${joined})` : joined
}

export interface SerializeContext { locale?: Locale; databaseName?: (id: string) => string | undefined; pageTitle?: (id: string) => string | undefined; typeName?: (id: string) => string | undefined }

function sourceText(source: QuerySource, ctx: SerializeContext, locale: Locale): string {
  const en = locale === 'en-US'
  const dbName = (id: string) => quote(ctx.databaseName?.(id) ?? id)
  const pageRef = (id?: string) => !id || id === '@thisPage' ? (en ? 'this page' : 'esta página') : quote(ctx.pageTitle?.(id) ?? id)
  switch (source.kind) {
    case 'database': case 'databases': return (source.databaseIds ?? []).map(dbName).join(', ') || (en ? 'all pages' : 'todas as páginas')
    case 'children': return `${source.deep ? (en ? 'descendants of' : 'descendentes de') : (en ? 'children of' : 'filhas de')} ${pageRef(source.pageId)}`
    case 'tag': return source.tag && /^[\p{L}\p{N}_\-/]+$/u.test(source.tag) ? `#${source.tag}` : `tag ${quote(source.tag ?? '')}`
    case 'modified': return en ? `modified in the last ${source.days ?? 7} days` : `modificadas nos últimos ${source.days ?? 7} dias`
    case 'relatedToThis': return (en ? 'related to this page' : 'relacionadas a esta página') + (source.databaseIds?.length ? ` ${en ? 'in' : 'em'} ${dbName(source.databaseIds[0])}` : '')
    case 'backlinks': return 'backlinks' + (source.pageId && source.pageId !== '@thisPage' ? ` ${en ? 'of' : 'de'} ${pageRef(source.pageId)}` : '')
    case 'tasks': return (en ? 'tasks' : 'tarefas') + (source.includeDone ? (en ? ' including done' : ' incluindo concluídas') : '')
    case 'type': return source.typeIds?.length ? `${en ? 'type' : 'tipo'} ${source.typeIds.map((id) => quote(ctx.typeName?.(id) ?? id)).join(', ')}` : (en ? 'all pages' : 'todas as páginas')
    default: return en ? 'all pages' : 'todas as páginas'
  }
}

/** Modelo → texto canônico no idioma pedido. */
export function serializeQuery(query: Query, context: SerializeContext = {}): string {
  const ctx: SerializeContext = context.typeName ? context : { ...context, typeName: defaultTypeName }
  const locale = ctx.locale ?? 'pt-BR'
  const en = locale === 'en-US'
  const q = normalizeQuery(query)
  const parts = [DISPLAY_TEXT[q.display][en ? 1 : 0], en ? 'from' : 'de', sourceText(q.source, ctx, locale)]
  const where = nodeText(q.filter, locale, false, ctx)
  if (where) parts.push(en ? 'where' : 'onde', where)
  if (q.sorts.length) parts.push(en ? 'sort' : 'ordenar', q.sorts.map((sort) => `${fieldText(sort.field, locale)}${sort.direction === 'desc' ? (en ? ' desc' : ' decrescente') : ''}`).join(', '))
  if (q.groupBy) parts.push(en ? 'group by' : 'agrupar por', fieldText(q.groupBy, locale))
  if (q.limit) parts.push(en ? 'limit' : 'limite', String(q.limit))
  if (q.columns?.length) parts.push(en ? 'columns' : 'colunas', q.columns.map((field) => fieldText(field, locale)).join(', '))
  return parts.join(' ')
}

// ---------- realce ----------

export function highlightQuery(source: string, context: TextContext = {}, parsed = parseQueryText(source, context)): Segment[] {
  const { tokens } = tokenize(source)
  const out: Segment[] = []
  let cursor = 0
  tokens.forEach((token, index) => {
    if (token.kind === 'eof') return
    if (token.from > cursor) out.push({ text: source.slice(cursor, token.from), kind: 'text', at: cursor })
    const fallback: SegmentKind = token.kind === 'string' || token.kind === 'hash' ? 'string' : token.kind === 'number' || token.kind === 'date' || token.kind === 'offset' ? 'number' : token.kind === 'op' ? 'operator' : token.kind === 'punct' ? 'paren' : DISPLAY_WORDS[token.folded] || KEYWORDS.has(token.folded) ? 'keyword' : 'text'
    let kind = parsed.roles.get(index) ?? fallback
    if (kind === 'property' && context.properties?.length && !context.properties.some((name) => fold(name) === token.folded)) kind = 'unknown'
    out.push({ text: token.text, kind, at: token.from })
    cursor = token.to
  })
  if (cursor < source.length) out.push({ text: source.slice(cursor), kind: 'text', at: cursor })
  const error = parsed.error
  if (!error) return out
  const marked: Segment[] = []
  for (const segment of out) {
    const start = segment.at, end = start + segment.text.length
    if (end <= error.from || start >= error.to || segment.kind === 'text' && !segment.text.trim()) { marked.push(segment); continue }
    const a = Math.max(error.from, start) - start, b = Math.min(error.to, end) - start
    if (a > 0) marked.push({ ...segment, text: segment.text.slice(0, a) })
    marked.push({ ...segment, text: segment.text.slice(a, b), at: start + a, error: true })
    if (b < segment.text.length) marked.push({ ...segment, text: segment.text.slice(b), at: start + b })
  }
  if (error.from >= source.length) marked.push({ text: ' ', kind: 'text', at: source.length, error: true })
  return marked
}

// ---------- autocompletar ----------

const CLAUSES: [string, string][] = [['de', 'from'], ['onde', 'where'], ['ordenar por', 'sort by'], ['agrupar por', 'group by'], ['limite', 'limit'], ['colunas', 'columns']]
const SOURCES: [string, string][] = [['todas as páginas', 'all pages'], ['filhas de esta página', 'children of this page'], ['descendentes de esta página', 'descendants of this page'], ['tarefas', 'tasks'], ['backlinks', 'backlinks'], ['relacionadas a esta página', 'related to this page'], ['modificadas nos últimos 7 dias', 'modified in the last 7 days'], ['tag ', 'tag ']]
const OPS: [string, string][] = [['=', '='], ['!=', '!='], ['<', '<'], ['>', '>'], ['<=', '<='], ['>=', '>='], ['contém', 'contains'], ['não contém', 'not contains'], ['vazio', 'is empty'], ['não vazio', 'is not empty'], ['antes de', 'before'], ['depois de', 'after']]
const VALUES: [string, string][] = [['hoje', 'today'], ['hoje+7d', 'today+7d'], ['ontem', 'yesterday'], ['amanhã', 'tomorrow'], ['esta semana', 'this week'], ['semana passada', 'last week'], ['próxima semana', 'next week'], ['este mês', 'this month'], ['próximo mês', 'next month'], ['últimos 7 dias', 'last 7 days'], ['próximos 7 dias', 'next 7 days'], ['esta página', 'this page'], ['sim', 'true'], ['não', 'false']]

/** Sugestões para o cursor: o que a gramática espera naquele ponto + nomes do espaço. */
export function querySuggestions(source: string, caret: number, context: TextContext = {}, limit = 12): { suggestions: Suggestion[]; from: number; to: number } {
  const locale = context.locale ?? 'pt-BR'
  const en = locale === 'en-US' ? 1 : 0
  const before = source.slice(0, caret)
  const open = /(["“'])([^"”']*)$/.exec(before)
  const quoteCount = (before.match(/["“”]/g) ?? []).length
  const inQuote = !!open && quoteCount % 2 === 1
  const word = inQuote ? open![2] : /[\p{L}\p{N}_\-+]*$/u.exec(before)?.[0] ?? ''
  const from = inQuote ? caret - open![2].length - 1 : caret - word.length
  const parsed = parseQueryText(source.slice(0, from), context)
  const kinds = parsed.expected.kinds
  const query = fold(word)
  const out: Suggestion[] = []
  const add = (label: string, kind: Suggestion['kind'], detail: string, insert = label) => { if (!query || fold(label).includes(query)) out.push({ label, insert, kind, detail }) }
  const needsQuote = (name: string) => !SAFE_WORD.test(name) || KEYWORDS.has(fold(name)) || !!PAGE_FIELD_WORDS[fold(name)]
  if (kinds.has('display')) for (const [pt, enw] of Object.values(DISPLAY_TEXT)) add(en ? enw : pt, 'keyword', tr(locale, 'exibição', 'display'))
  if (kinds.has('source') || kinds.has('database')) {
    for (const db of context.databases ?? []) add(db.title || db.id, 'database', tr(locale, 'banco', 'database'), quote(db.title || db.id))
    if (kinds.has('source')) for (const pair of SOURCES) add(pair[en], 'keyword', tr(locale, 'fonte', 'source'))
    if (kinds.has('source')) for (const type of contextTypes(context).slice(0, 50)) add(`${en ? 'type' : 'tipo'} ${type.name}`, 'function', tr(locale, 'tipo', 'type'), `${en ? 'type' : 'tipo'} ${quote(type.name)}`)
  }
  if (kinds.has('type')) for (const type of contextTypes(context).slice(0, 50)) add(type.name, 'value', tr(locale, 'tipo', 'type'), quote(type.name))
  if (kinds.has('page')) { add(en ? 'this page' : 'esta página', 'keyword', tr(locale, 'página', 'page')); for (const page of (context.pages ?? []).slice(0, 200)) add(page.title, 'value', tr(locale, 'página', 'page'), quote(page.title)) }
  if (kinds.has('field')) {
    for (const name of context.properties ?? []) add(name, 'property', tr(locale, 'propriedade', 'property'), needsQuote(name) ? quote(name) : name)
    for (const [, words] of Object.entries(PAGE_FIELD_TEXT)) add(words[en], 'function', tr(locale, 'campo da página', 'page field'))
  }
  if (kinds.has('op')) for (const pair of OPS) add(pair[en], 'keyword', tr(locale, 'operador', 'operator'))
  if (kinds.has('value')) {
    const field = parsed.expected.field
    const options = field ? Object.entries(context.options ?? {}).find(([name]) => fold(name) === fold(field))?.[1] ?? [] : []
    for (const option of options) add(option, 'value', tr(locale, 'opção', 'option'), quote(option))
    if (field === '@type') for (const type of contextTypes(context).slice(0, 50)) add(type.name, 'value', tr(locale, 'tipo', 'type'), quote(type.name))
    for (const pair of VALUES) add(pair[en], 'value', tr(locale, 'valor', 'value'))
  }
  if (kinds.has('connector') || kinds.has('direction')) {
    if (kinds.has('connector')) { add(en ? 'and' : 'e', 'keyword', tr(locale, 'conector', 'connector')); add(en ? 'or' : 'ou', 'keyword', tr(locale, 'conector', 'connector')) }
    if (kinds.has('direction')) { add(en ? 'desc' : 'decrescente', 'keyword', tr(locale, 'direção', 'direction')); add(en ? 'asc' : 'crescente', 'keyword', tr(locale, 'direção', 'direction')) }
  }
  if (kinds.has('clause') || kinds.has('connector') || kinds.has('direction')) for (const pair of CLAUSES) add(pair[en], 'keyword', tr(locale, 'cláusula', 'clause'))
  const rank = (s: Suggestion) => fold(s.label).startsWith(query) ? 0 : 1
  const unique = [...new Map(out.map((s) => [`${s.kind}:${s.label}`, s])).values()].sort((a, b) => rank(a) - rank(b))
  return { suggestions: unique.slice(0, limit), from, to: inQuote && /^["”']/.test(source.slice(caret)) ? caret + 1 : caret }
}

export function applyQuerySuggestion(source: string, from: number, to: number, suggestion: Suggestion): { source: string; caret: number } {
  const insert = suggestion.insert + (/^\s/.test(source.slice(to)) || suggestion.insert.endsWith(' ') ? '' : ' ')
  return { source: source.slice(0, from) + insert + source.slice(to), caret: from + insert.length }
}

/** Grupo vazio do construtor não aparece no texto; útil para comparar. */
export function pruneEmptyGroups(group: QueryGroup): QueryGroup {
  const visit = (node: QueryNode, depth: number): QueryNode | null => node.kind === 'rule' ? node : depth > MAX_DEPTH ? null : (() => { const children = node.children.map((child) => visit(child, depth + 1)).filter((child): child is QueryNode => !!child); return children.length ? { ...node, children } : null })()
  return { ...group, children: group.children.map((child) => visit(child, 1)).filter((child): child is QueryNode => !!child) }
}
