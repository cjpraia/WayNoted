import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
// Linguagem de fórmulas local: parser próprio (Pratt) + interpretador sobre AST.
// Sem eval, sem acesso a globais, rede ou funções arbitrárias. Erros carregam posição (início/fim)
// para o editor sublinhar o trecho. Não há limite artificial de profundidade/tamanho: só um
// orçamento grande de passos para impedir travamentos e detecção de ciclos (em derived.ts).
import type { DateValue, PropValue, RichTextValue } from '../../types'
import type { RichTextRun } from '../../database-models'

// ---------- Valores internos ----------

export interface FormulaDate { kind: 'date'; start: Date; end?: Date; time: boolean }
export interface FormulaPage { kind: 'page'; id: string; title: string; get: (name: string) => FormulaValue | undefined }
export interface FormulaRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; color?: string; background?: string; href?: string }
export interface FormulaStyled { kind: 'styled'; runs: FormulaRun[] }
export type FormulaValue = null | string | number | boolean | FormulaDate | FormulaPage | FormulaStyled | FormulaValue[]

export interface FormulaOptions {
  /** Valor de uma propriedade pelo nome/id; `undefined` = propriedade inexistente. */
  resolve?: (name: string) => FormulaValue | undefined
  /** Página atual (para `id()`). */
  self?: FormulaPage
  now?: Date
  locale?: 'pt-BR' | 'en-US'
}

export const FORMULA_STEP_BUDGET = 1_000_000

export class FormulaError extends Error {
  pt: string
  en: string
  at: number
  end: number
  constructor(pt: string, en: string, at = -1, end = -1) {
    super(pt)
    this.pt = pt
    this.en = en
    this.at = at
    this.end = end < 0 ? at + 1 : end
  }
}

let defaultLocale: 'pt-BR' | 'en-US' = 'pt-BR'
/** Idioma usado por formatDate()/nomes de mês quando a avaliação não informa um. */
export function setFormulaLocale(locale: 'pt-BR' | 'en-US') { defaultLocale = locale }

// ---------- Léxico ----------

export type TokenKind = 'number' | 'string' | 'name' | 'symbol'
export interface FormulaToken { kind: TokenKind; text: string; at: number; end: number }

const UNICODE_OPS: Record<string, string> = { '≠': '!=', '≤': '<=', '≥': '>=', '×': '*', '÷': '/', '−': '-' }
const NAME = /^[\p{L}_][\p{L}\p{N}_]*/u

export function tokenizeFormula(source: string): FormulaToken[] {
  const result: FormulaToken[] = []
  for (let i = 0; i < source.length;) {
    const ch = source[i]
    if (/\s/.test(ch)) { i++; continue }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') i++; continue }
    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2)
      if (close < 0) throw new FormulaError(`Comentário sem fechamento em ${i + 1}`, `Unterminated comment at ${i + 1}`, i, source.length)
      i = close + 2
      continue
    }
    const pair = source.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(pair)) { result.push({ kind: 'symbol', text: pair, at: i, end: i + 2 }); i += 2; continue }
    if (UNICODE_OPS[ch]) { result.push({ kind: 'symbol', text: UNICODE_OPS[ch], at: i, end: i + 1 }); i++; continue }
    if (ch === '"' || ch === "'" || ch === '“' || ch === '”') {
      const start = i++
      const quote = ch === '“' ? '”' : ch
      let text = ''
      while (i < source.length && source[i] !== quote && !(quote === '”' && source[i] === '"')) {
        if (source[i] === '\\') {
          i++
          if (i >= source.length) throw new FormulaError(`String incompleta em ${start + 1}`, `Unterminated string at ${start + 1}`, start, source.length)
          const escape: Record<string, string> = { n: '\n', t: '\t', r: '\r' }
          text += escape[source[i]] ?? source[i]
        } else text += source[i]
        i++
      }
      if (i >= source.length) throw new FormulaError(`String incompleta em ${start + 1}`, `Unterminated string at ${start + 1}`, start, source.length)
      i++
      result.push({ kind: 'string', text, at: start, end: i })
      continue
    }
    const number = source.slice(i).match(/^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/)
    const previous = result.at(-1)
    const afterValue = previous && (previous.kind === 'name' || previous.kind === 'number' || previous.kind === 'string' || previous.text === ')' || previous.text === ']')
    if (number && !(ch === '.' && afterValue)) { result.push({ kind: 'number', text: number[0], at: i, end: i + number[0].length }); i += number[0].length; continue }
    if ('()[]+-*/,!<>%^?:.'.includes(ch)) { result.push({ kind: 'symbol', text: ch, at: i, end: i + 1 }); i++; continue }
    if (ch === '=') throw new FormulaError(`Use “==” para comparar, em ${i + 1}`, `Use “==” to compare, at ${i + 1}`, i)
    const name = source.slice(i).match(NAME)
    if (name) { result.push({ kind: 'name', text: name[0], at: i, end: i + name[0].length }); i += name[0].length; continue }
    throw new FormulaError(`Caractere inválido “${ch}” em ${i + 1}`, `Invalid character “${ch}” at ${i + 1}`, i)
  }
  return result
}

// ---------- Sintaxe ----------

type Span = { at: number; end: number }
export type FormulaNode = Span & (
  | { kind: 'literal'; value: FormulaValue }
  | { kind: 'name'; name: string }
  | { kind: 'list'; items: FormulaNode[] }
  | { kind: 'unary'; op: string; child: FormulaNode }
  | { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode }
  | { kind: 'ternary'; test: FormulaNode; yes: FormulaNode; no: FormulaNode }
  | { kind: 'call'; name: string; args: FormulaNode[]; method: boolean; nameAt: number; nameEnd: number }
  | { kind: 'member'; target: FormulaNode; name: string }
  | { kind: 'index'; target: FormulaNode; index: FormulaNode }
)

const BINARY: Record<string, number> = { or: 2, '||': 2, and: 3, '&&': 3, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7 }

export function parseFormula(source: string): FormulaNode | null {
  const tokens = tokenizeFormula(source)
  let at = 0
  const peek = () => tokens[at]
  const where = () => peek()?.at ?? source.length
  const take = (expected: string): FormulaToken => {
    const token = peek()
    if (token?.text !== expected || token.kind === 'string') throw new FormulaError(`Esperado “${expected}” em ${where() + 1}`, `Expected “${expected}” at ${where() + 1}`, where(), token?.end ?? source.length)
    at++
    return token
  }
  const args = (close: string): FormulaNode[] => {
    const list: FormulaNode[] = []
    if (peek()?.text === close && peek()?.kind === 'symbol') return list
    for (;;) {
      list.push(expression())
      if (peek()?.text === ',' && peek()?.kind === 'symbol') { at++; continue }
      return list
    }
  }
  const postfix = (node: FormulaNode): FormulaNode => {
    for (;;) {
      const token = peek()
      if (token?.kind !== 'symbol') return node
      if (token.text === '.') {
        at++
        const name = peek()
        if (name?.kind !== 'name') throw new FormulaError(`Esperado nome após “.” em ${where() + 1}`, `Expected a name after “.” at ${where() + 1}`, where())
        at++
        if (peek()?.text === '(' && peek()?.kind === 'symbol') {
          at++
          const rest = args(')')
          const close = take(')')
          node = { kind: 'call', name: name.text.toLowerCase(), args: [node, ...rest], method: true, at: node.at, end: close.end, nameAt: name.at, nameEnd: name.end }
        } else node = { kind: 'member', target: node, name: name.text, at: node.at, end: name.end }
        continue
      }
      if (token.text === '[') {
        at++
        const index = expression()
        const close = take(']')
        node = { kind: 'index', target: node, index, at: node.at, end: close.end }
        continue
      }
      return node
    }
  }
  const primary = (): FormulaNode => {
    const token = tokens[at++]
    if (!token) throw new FormulaError(`Expressão incompleta em ${source.length + 1}`, `Incomplete expression at ${source.length + 1}`, Math.max(0, source.length - 1), source.length)
    if (token.kind === 'string') return { kind: 'literal', value: token.text, at: token.at, end: token.end }
    if (token.kind === 'number') return { kind: 'literal', value: Number(token.text), at: token.at, end: token.end }
    if (token.kind === 'symbol' && token.text === '(') {
      const inner = expression()
      const close = take(')')
      return { ...inner, at: token.at, end: close.end }
    }
    if (token.kind === 'symbol' && token.text === '[') {
      const items = args(']')
      const close = take(']')
      return { kind: 'list', items, at: token.at, end: close.end }
    }
    if (token.kind === 'symbol' && ['-', '+', '!'].includes(token.text) || token.kind === 'name' && token.text.toLowerCase() === 'not') {
      const child = expression(7)
      return { kind: 'unary', op: token.text.toLowerCase() === 'not' ? '!' : token.text, child, at: token.at, end: child.end }
    }
    if (token.kind === 'name') {
      const lower = token.text.toLowerCase()
      if (lower === 'true' || lower === 'false') return { kind: 'literal', value: lower === 'true', at: token.at, end: token.end }
      if (lower === 'null') return { kind: 'literal', value: null, at: token.at, end: token.end }
      if (peek()?.text === '(' && peek()?.kind === 'symbol') {
        at++
        const list = args(')')
        const close = take(')')
        return { kind: 'call', name: lower, args: list, method: false, at: token.at, end: close.end, nameAt: token.at, nameEnd: token.end }
      }
      return { kind: 'name', name: token.text, at: token.at, end: token.end }
    }
    throw new FormulaError(`Expressão inválida em ${token.at + 1}`, `Invalid expression at ${token.at + 1}`, token.at, token.end)
  }
  const expression = (minimum = 1): FormulaNode => {
    let left = postfix(primary())
    for (;;) {
      const token = peek()
      if (!token || token.kind === 'string' || token.kind === 'number') break
      const op = token.kind === 'name' ? token.text.toLowerCase() : token.text
      if (token.kind === 'symbol' && op === '?') {
        if (minimum > 1) break
        at++
        const yes = expression(1)
        take(':')
        const no = expression(1)
        left = { kind: 'ternary', test: left, yes, no, at: left.at, end: no.end }
        continue
      }
      if (token.kind === 'name' && op !== 'and' && op !== 'or') break
      const precedence = BINARY[op]
      if (!precedence || precedence < minimum) break
      at++
      const right = expression(op === '^' ? precedence : precedence + 1)
      left = { kind: 'binary', op: op === '||' ? 'or' : op === '&&' ? 'and' : op, left, right, at: left.at, end: right.end }
    }
    return left
  }
  if (!tokens.length) return null
  const tree = expression()
  if (at !== tokens.length) {
    const token = tokens[at]
    throw new FormulaError(`Expressão inválida em ${token.at + 1}`, `Invalid expression at ${token.at + 1}`, token.at, token.end)
  }
  return tree
}

const parseCache = new Map<string, FormulaNode | null | FormulaError>()
function cachedParse(source: string): FormulaNode | null {
  let entry = parseCache.get(source)
  if (entry === undefined) {
    try { entry = parseFormula(source) } catch (error) {
      if (error instanceof FormulaError) entry = error
      else if (error instanceof RangeError) entry = new FormulaError('Fórmula aninhada demais para a pilha de execução', 'Formula is nested too deeply for the execution stack', 0, source.length)
      else throw error
    }
    if (parseCache.size > 1000) parseCache.clear()
    parseCache.set(source, entry)
  }
  if (entry instanceof FormulaError) throw entry
  return entry
}

// ---------- Conversões ----------

const pad = (value: number, size = 2) => String(value).padStart(size, '0')
export function isoDate(value: Date): string { return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` }
const isoTime = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`

export function isFormulaDate(value: FormulaValue | undefined): value is FormulaDate { return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'date' }
export function isFormulaPage(value: FormulaValue | undefined): value is FormulaPage { return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'page' }
function isStyled(value: FormulaValue | undefined): value is FormulaStyled { return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'styled' }

export function numberText(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(12)))
}

function dateText(value: FormulaDate): string {
  const one = (date: Date) => value.time ? `${isoDate(date)} ${isoTime(date)}` : isoDate(date)
  return value.end ? `${one(value.start)} → ${one(value.end)}` : one(value.start)
}

export function formulaText(value: FormulaValue): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return numberText(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.map(formulaText).join(', ')
  if (value.kind === 'date') return dateText(value)
  if (value.kind === 'page') return value.title
  return value.runs.map((run) => run.text).join('')
}

function parseDateText(text: string): FormulaDate | null {
  const match = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (match) {
    const [, y, m, d, h, min, s] = match
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(min ?? 0), Number(s ?? 0))
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null
    return { kind: 'date', start: date, time: h !== undefined }
  }
  const br = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (br) {
    const date = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]))
    return date.getMonth() === Number(br[2]) - 1 ? { kind: 'date', start: date, time: false } : null
  }
  return null
}

/** Converte um valor armazenado (PropValue) para o valor interno da fórmula. */
export function fromPropValue(value: PropValue | undefined): FormulaValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item.name)
  if ('type' in value && value.type === 'richText') return value.runs.map((run) => run.text).join('')
  if ('start' in value) return dateValueToFormula(value)
  if ('label' in value) return value.label
  return null
}

export function dateValueToFormula(value: DateValue): FormulaDate | null {
  const start = parseDateText(value.startTime ? `${value.start}T${value.startTime}` : value.start)
  if (!start) return null
  const end = value.end ? parseDateText(value.endTime ? `${value.end}T${value.endTime}` : value.end) : null
  return { kind: 'date', start: start.start, ...(end ? { end: end.start } : {}), time: !!(value.startTime || value.endTime) }
}

/** Converte o resultado da fórmula para um valor exibível/armazenável. */
export function toPropValue(value: FormulaValue): PropValue {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(formulaText)
  if (value.kind === 'date') {
    const out: DateValue = { start: isoDate(value.start) }
    if (value.time) out.startTime = isoTime(value.start)
    if (value.end) { out.end = isoDate(value.end); if (value.time) out.endTime = isoTime(value.end) }
    return out
  }
  if (value.kind === 'page') return value.title
  const runs: RichTextRun[] = value.runs.map((run) => ({ ...run }))
  return { type: 'richText', runs } satisfies RichTextValue
}

// ---------- Datas ----------

const MONTHS = {
  'pt-BR': ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  'en-US': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const WEEKDAYS = {
  'pt-BR': ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
  'en-US': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

export function formatDateTokens(date: Date, format: string, locale: 'pt-BR' | 'en-US'): string {
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a|Q|W/g, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal
    const hours12 = date.getHours() % 12 || 12
    switch (token) {
      case 'YYYY': return String(date.getFullYear())
      case 'YY': return String(date.getFullYear()).slice(-2)
      case 'MMMM': return MONTHS[locale][date.getMonth()]
      case 'MMM': return MONTHS[locale][date.getMonth()].slice(0, 3)
      case 'MM': return pad(date.getMonth() + 1)
      case 'M': return String(date.getMonth() + 1)
      case 'dddd': return WEEKDAYS[locale][date.getDay()]
      case 'ddd': return WEEKDAYS[locale][date.getDay()].slice(0, 3)
      case 'DD': return pad(date.getDate())
      case 'D': return String(date.getDate())
      case 'HH': return pad(date.getHours())
      case 'H': return String(date.getHours())
      case 'hh': return pad(hours12)
      case 'h': return String(hours12)
      case 'mm': return pad(date.getMinutes())
      case 'ss': return pad(date.getSeconds())
      case 'A': return date.getHours() < 12 ? 'AM' : 'PM'
      case 'a': return date.getHours() < 12 ? 'am' : 'pm'
      case 'Q': return String(Math.floor(date.getMonth() / 3) + 1)
      default: return String(isoWeek(date))
    }
  })
}

function isoWeek(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - day + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

type Unit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds'
const UNIT_ALIASES: Record<string, Unit> = {
  years: 'years', year: 'years', y: 'years', anos: 'years', ano: 'years',
  quarters: 'quarters', quarter: 'quarters', q: 'quarters', trimestres: 'quarters', trimestre: 'quarters',
  months: 'months', month: 'months', meses: 'months', mês: 'months', mes: 'months',
  weeks: 'weeks', week: 'weeks', w: 'weeks', semanas: 'weeks', semana: 'weeks',
  days: 'days', day: 'days', d: 'days', dias: 'days', dia: 'days',
  hours: 'hours', hour: 'hours', h: 'hours', horas: 'hours', hora: 'hours',
  minutes: 'minutes', minute: 'minutes', minutos: 'minutes', minuto: 'minutes',
  seconds: 'seconds', second: 'seconds', s: 'seconds', segundos: 'seconds', segundo: 'seconds',
  milliseconds: 'milliseconds', millisecond: 'milliseconds', ms: 'milliseconds', milissegundos: 'milliseconds',
}
function unitOf(text: string): Unit | null {
  if (text === 'M') return 'months'
  if (text === 'm') return 'minutes'
  return UNIT_ALIASES[text.toLowerCase()] ?? null
}

function addUnits(date: Date, amount: number, unit: Unit): Date {
  const out = new Date(date.getTime())
  if (unit === 'years' || unit === 'quarters' || unit === 'months') {
    const months = unit === 'years' ? amount * 12 : unit === 'quarters' ? amount * 3 : amount
    const day = out.getDate()
    out.setDate(1)
    out.setMonth(out.getMonth() + months)
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()
    out.setDate(Math.min(day, last))
    return out
  }
  if (unit === 'weeks' || unit === 'days') { out.setDate(out.getDate() + amount * (unit === 'weeks' ? 7 : 1)); return out }
  const ms = unit === 'hours' ? 3_600_000 : unit === 'minutes' ? 60_000 : unit === 'seconds' ? 1000 : 1
  return new Date(out.getTime() + amount * ms)
}

function monthsBetween(a: Date, b: Date): number {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
  const shifted = addUnits(a, months, 'months')
  if (months > 0 && shifted.getTime() > b.getTime()) months--
  else if (months < 0 && shifted.getTime() < b.getTime()) months++
  return months
}

function unitsBetween(a: FormulaDate, b: FormulaDate, unit: Unit): number {
  const start = a.start, end = b.start
  const diff = end.getTime() - start.getTime()
  const whole = (value: number) => Math.trunc(value)
  switch (unit) {
    case 'years': return whole(monthsBetween(start, end) / 12)
    case 'quarters': return whole(monthsBetween(start, end) / 3)
    case 'months': return monthsBetween(start, end)
    case 'weeks': return whole((a.time || b.time ? diff : Math.round(diff / 86_400_000) * 86_400_000) / (7 * 86_400_000))
    case 'days': return a.time || b.time ? whole(diff / 86_400_000) : Math.round(diff / 86_400_000)
    case 'hours': return whole(diff / 3_600_000)
    case 'minutes': return whole(diff / 60_000)
    case 'seconds': return whole(diff / 1000)
    default: return diff
  }
}

// ---------- Estilos ----------

export const STYLE_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:', ...[PRODUCT.protocol, COMPAT.previousProtocol, ...PRODUCT.protocolAliases].map(scheme => scheme + ":")].includes(parsed.protocol) ? parsed.href : undefined
  } catch { return undefined }
}

// ---------- Avaliação ----------

interface EvalContext {
  property: (name: string, node: FormulaNode) => FormulaValue
  direct: (name: string, node: FormulaNode) => FormulaValue
  self?: FormulaPage
  now: Date
  locale: 'pt-BR' | 'en-US'
}

function fail(node: Span | undefined, pt: string, en: string): never {
  throw new FormulaError(pt, en, node?.at ?? -1, node?.end ?? -1)
}

function num(value: FormulaValue): number {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === null || value === '') return 0
  if (isFormulaDate(value)) return value.start.getTime()
  if (Array.isArray(value)) return value.length === 1 ? num(value[0]) : 0
  const parsed = Number(formulaText(value).trim())
  return Number.isFinite(parsed) ? parsed : 0
}
function truth(value: FormulaValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object' && value !== null) return value.kind === 'styled' ? formulaText(value) !== '' : true
  return !!value
}
function isEmptyValue(value: FormulaValue): boolean {
  return value === null || value === '' || Array.isArray(value) && value.length === 0 || isStyled(value) && formulaText(value) === ''
}
function toList(value: FormulaValue): FormulaValue[] { return Array.isArray(value) ? value : value === null ? [] : [value] }
function flat(values: FormulaValue[]): FormulaValue[] { return values.flatMap((value) => Array.isArray(value) ? flat(value) : [value]) }
function numbersOf(values: FormulaValue[]): number[] {
  return flat(values).filter((value) => value !== null && value !== '').map(num).filter((value) => Number.isFinite(value))
}
function toDate(value: FormulaValue): FormulaDate | null {
  if (isFormulaDate(value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'date', start: new Date(value), time: true }
  if (typeof value === 'string' || isStyled(value)) return parseDateText(formulaText(value))
  if (Array.isArray(value) && value.length === 1) return toDate(value[0])
  return null
}
const isNumeric = (value: FormulaValue) => typeof value === 'number' || typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))

function equals(left: FormulaValue, right: FormulaValue): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right
  if (isFormulaDate(left) && isFormulaDate(right)) return left.start.getTime() === right.start.getTime() && (left.end?.getTime() ?? null) === (right.end?.getTime() ?? null)
  if (isFormulaPage(left) && isFormulaPage(right)) return left.id === right.id
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equals(item, right[index]))
  return formulaText(left) === formulaText(right)
}
function compare(left: FormulaValue, right: FormulaValue): number {
  if (isFormulaDate(left) && isFormulaDate(right)) return left.start.getTime() - right.start.getTime()
  if ((typeof left === 'number' || typeof right === 'number') && isNumeric(left) && isNumeric(right)) return num(left) - num(right)
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return formulaText(left).localeCompare(formulaText(right), 'pt-BR', { numeric: true })
}
function naturalCompare(left: FormulaValue, right: FormulaValue): number {
  if (left === null || left === '') return right === null || right === '' ? 0 : 1
  if (right === null || right === '') return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return compare(left, right)
}
function runsOf(value: FormulaValue): FormulaRun[] { return isStyled(value) ? value.runs.map((run) => ({ ...run })) : [{ text: formulaText(value) }] }
function mergeRuns(runs: FormulaRun[]): FormulaRun[] {
  const out: FormulaRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const previous = out.at(-1)
    const same = previous && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...run, text: '' })
    if (same) previous.text += run.text
    else out.push(run)
  }
  return out
}

const RESERVED = new Set(['current', 'index'])
const LAZY = new Set(['if', 'ifs', 'and', 'or', 'coalesce', 'let', 'lets', 'map', 'filter', 'find', 'findindex', 'some', 'every', 'count', 'sort', 'prop'])

function evaluateTree(tree: FormulaNode, ctx: EvalContext): FormulaValue {
  let budget = FORMULA_STEP_BUDGET
  const spend = (node: Span) => {
    if (--budget < 0) fail(node, 'Fórmula excedeu o limite de 1.000.000 passos', 'Formula exceeded the 1,000,000-step limit')
  }
  const bindingName = (node: FormulaNode | undefined): string => {
    const name = node?.kind === 'name' ? node.name : node?.kind === 'literal' && typeof node.value === 'string' ? node.value : ''
    if (!NAME.test(name) || name.match(NAME)?.[0] !== name || RESERVED.has(name)) fail(node, 'Nome de variável inválido', 'Invalid variable name')
    return name
  }
  const pageGet = (page: FormulaPage, name: string, node: FormulaNode): FormulaValue => {
    const value = page.get(name)
    if (value === undefined) fail(node, `Propriedade “${name}” não existe em “${page.title || 'Sem título'}”`, `Property “${name}” does not exist on “${page.title || 'Untitled'}”`)
    return value
  }
  const member = (target: FormulaValue, name: string, node: FormulaNode): FormulaValue => {
    if (target === null) return null
    if (isFormulaPage(target)) return pageGet(target, name, node)
    if (Array.isArray(target)) return target.map((item) => member(item, name, node))
    return fail(node, `“.${name}” só funciona em páginas de uma relação`, `“.${name}” only works on related pages`)
  }

  const run = (node: FormulaNode, scope: ReadonlyMap<string, FormulaValue>): FormulaValue => {
    spend(node)
    switch (node.kind) {
      case 'literal': return node.value
      case 'list': return node.items.map((item) => run(item, scope))
      case 'name': {
        if (scope.has(node.name)) return scope.get(node.name) ?? null
        if (RESERVED.has(node.name)) fail(node, `Variável fora do escopo: ${node.name}`, `Variable out of scope: ${node.name}`)
        return ctx.direct(node.name, node)
      }
      case 'member': return member(run(node.target, scope), node.name, node)
      case 'index': {
        const target = run(node.target, scope)
        const index = run(node.index, scope)
        if (typeof index === 'string' && isFormulaPage(target)) return pageGet(target, index, node)
        const list = Array.isArray(target) ? target : typeof target === 'string' ? [...target] : toList(target)
        const position = Math.trunc(num(index))
        return list.at(position) ?? null
      }
      case 'unary': {
        const value = run(node.child, scope)
        return node.op === '!' ? !truth(value) : node.op === '-' ? -num(value) : num(value)
      }
      case 'ternary': return truth(run(node.test, scope)) ? run(node.yes, scope) : run(node.no, scope)
      case 'binary': {
        const left = run(node.left, scope)
        if (node.op === 'and') return truth(left) ? truth(run(node.right, scope)) : false
        if (node.op === 'or') return truth(left) ? true : truth(run(node.right, scope))
        const right = run(node.right, scope)
        switch (node.op) {
          case '+':
            if (isStyled(left) || isStyled(right)) return { kind: 'styled', runs: mergeRuns([...runsOf(left), ...runsOf(right)]) }
            if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right]
            if (typeof left === 'string' || typeof right === 'string' || isFormulaDate(left) || isFormulaDate(right) || isFormulaPage(left) || isFormulaPage(right)) return formulaText(left) + formulaText(right)
            return num(left) + num(right)
          case '-': return num(left) - num(right)
          case '*': return num(left) * num(right)
          case '/': return num(right) === 0 ? null : num(left) / num(right)
          case '%': return num(right) === 0 ? null : num(left) % num(right)
          case '^': return num(left) ** num(right)
          case '==': return equals(left, right)
          case '!=': return !equals(left, right)
          default: {
            const comparison = compare(left, right)
            return node.op === '<' ? comparison < 0 : node.op === '<=' ? comparison <= 0 : node.op === '>' ? comparison > 0 : comparison >= 0
          }
        }
      }
      case 'call': return call(node, scope)
    }
  }

  const call = (node: Extract<FormulaNode, { kind: 'call' }>, scope: ReadonlyMap<string, FormulaValue>): FormulaValue => {
    const nameSpan = { at: node.nameAt, end: node.nameEnd }
    const arg = (index: number) => node.args[index] ? run(node.args[index], scope) : null
    const need = (count: number) => {
      if (node.args.length < count) fail(node, `${node.name}() precisa de ${count} argumento${count === 1 ? '' : 's'}`, `${node.name}() needs ${count} argument${count === 1 ? '' : 's'}`)
    }
    if (LAZY.has(node.name)) {
      switch (node.name) {
        case 'prop': {
          need(1)
          const first = arg(0)
          if (node.args.length >= 2 && (isFormulaPage(first) || first === null || Array.isArray(first))) return member(first, formulaText(arg(1)), node)
          return ctx.property(formulaText(first), node)
        }
        case 'if': need(2); return truth(arg(0)) ? arg(1) : arg(2)
        case 'ifs': {
          need(2)
          for (let i = 0; i + 1 < node.args.length; i += 2) if (truth(run(node.args[i], scope))) return run(node.args[i + 1], scope)
          return node.args.length % 2 ? run(node.args.at(-1)!, scope) : null
        }
        case 'and': return node.args.every((item) => truth(run(item, scope)))
        case 'or': return node.args.some((item) => truth(run(item, scope)))
        case 'coalesce':
          for (const item of node.args) { const value = run(item, scope); if (!isEmptyValue(value)) return value }
          return null
        case 'let': case 'lets': {
          if (node.args.length < 3 || node.args.length % 2 !== 1 || node.name === 'let' && node.args.length !== 3) fail(node, 'Argumentos de let inválidos', 'Invalid let arguments')
          const inner = new Map(scope)
          for (let index = 0; index < node.args.length - 1; index += 2) inner.set(bindingName(node.args[index]), run(node.args[index + 1], inner))
          return run(node.args.at(-1)!, inner)
        }
        default: {
          need(1)
          const source = toList(arg(0))
          const callback = node.args[1]
          if (!callback) {
            if (node.name === 'count') return source.length
            if (node.name === 'sort') return [...source].sort(naturalCompare)
            fail(node, 'Expressão de lista ausente', 'Missing list expression')
          }
          const legacy = callback.kind === 'literal' && typeof callback.value === 'string' ? callback.value : null
          const evaluateItem = (item: FormulaValue, index: number): FormulaValue => {
            spend(callback)
            if (legacy !== null && (node.name === 'filter' || node.name === 'count')) return formulaText(item) === legacy
            if (legacy !== null && node.name === 'map') {
              const text = formulaText(item)
              const operation = legacy.toLowerCase()
              if (!['upper', 'lower', 'trim', 'length', 'number'].includes(operation)) fail(callback, `Operação map desconhecida: ${operation}`, `Unknown map operation: ${operation}`)
              return operation === 'upper' ? text.toLocaleUpperCase('pt-BR') : operation === 'lower' ? text.toLocaleLowerCase('pt-BR') : operation === 'trim' ? text.trim() : operation === 'length' ? text.length : num(text)
            }
            const inner = new Map(scope)
            inner.set('current', item); inner.set('index', index)
            return run(callback, inner)
          }
          switch (node.name) {
            case 'map': return source.map(evaluateItem)
            case 'filter': return source.filter((item, index) => truth(evaluateItem(item, index)))
            case 'find': return source.find((item, index) => truth(evaluateItem(item, index))) ?? null
            case 'findindex': return source.findIndex((item, index) => truth(evaluateItem(item, index)))
            case 'some': return source.some((item, index) => truth(evaluateItem(item, index)))
            case 'every': return source.every((item, index) => truth(evaluateItem(item, index)))
            case 'count': return source.filter((item, index) => truth(evaluateItem(item, index))).length
            default: {
              const keyed = source.map((item, index) => ({ item, key: evaluateItem(item, index) }))
              return keyed.sort((a, b) => naturalCompare(a.key, b.key)).map((entry) => entry.item)
            }
          }
        }
      }
    }

    const args = node.args.map((item) => run(item, scope))
    const first = args[0] ?? null
    const second = args[1] ?? null
    const textArg = (index: number) => formulaText(args[index] ?? null)
    const dateArg = (index: number): FormulaDate | null => {
      const value = args[index] ?? null
      if (value === null || value === '') return null
      const date = toDate(value)
      if (!date) fail(node.args[index], `Data inválida: “${formulaText(value)}”`, `Invalid date: “${formulaText(value)}”`)
      return date
    }
    const unitArg = (index: number, fallback: Unit): Unit => {
      if (args[index] === undefined || args[index] === null) return fallback
      const unit = unitOf(textArg(index))
      if (!unit) fail(node.args[index], 'Unidade de data desconhecida', 'Unknown date unit')
      return unit
    }
    const regex = (index: number, flags = ''): RegExp => {
      try { return new RegExp(textArg(index), flags) } catch { return fail(node.args[index], 'Expressão regular inválida', 'Invalid regular expression') }
    }
    switch (node.name) {
      // Lógica
      case 'not': return !truth(first)
      case 'empty': return isEmptyValue(first)
      case 'equal': return equals(first, second)
      case 'unequal': return !equals(first, second)
      // Números
      case 'add': return isStyled(first) || isStyled(second) || typeof first === 'string' || typeof second === 'string' ? formulaText(first) + formulaText(second) : num(first) + num(second)
      case 'subtract': return num(first) - num(second)
      case 'multiply': return num(first) * num(second)
      case 'divide': return num(second) === 0 ? null : num(first) / num(second)
      case 'mod': return num(second) === 0 ? null : num(first) % num(second)
      case 'pow': return num(first) ** num(second)
      case 'abs': return Math.abs(num(first))
      case 'round': { const digits = Math.max(0, Math.min(15, Math.trunc(num(second)))); const scale = 10 ** digits; return Math.round(num(first) * scale) / scale }
      case 'ceil': return Math.ceil(num(first))
      case 'floor': return Math.floor(num(first))
      case 'trunc': return Math.trunc(num(first))
      case 'sqrt': return num(first) < 0 ? null : Math.sqrt(num(first))
      case 'cbrt': return Math.cbrt(num(first))
      case 'exp': return Math.exp(num(first))
      case 'ln': return num(first) <= 0 ? null : Math.log(num(first))
      case 'log10': return num(first) <= 0 ? null : Math.log10(num(first))
      case 'log2': return num(first) <= 0 ? null : Math.log2(num(first))
      case 'sign': return Math.sign(num(first))
      case 'pi': return Math.PI
      case 'e': return Math.E
      case 'min': case 'max': {
        const all = flat(args).filter((value) => value !== null && value !== '')
        if (!all.length) return null
        if (all.every(isFormulaDate)) return all.reduce((best, value) => (node.name === 'min' ? compare(value, best) < 0 : compare(value, best) > 0) ? value : best)
        const numbers = numbersOf(all)
        return numbers.length ? node.name === 'min' ? Math.min(...numbers) : Math.max(...numbers) : null
      }
      case 'sum': return numbersOf(args).reduce((total, value) => total + value, 0)
      case 'mean': case 'average': { const numbers = numbersOf(args); return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null }
      case 'median': {
        const numbers = numbersOf(args).sort((a, b) => a - b)
        if (!numbers.length) return null
        const middle = Math.floor(numbers.length / 2)
        return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
      }
      case 'tonumber': {
        if (first === null || first === '') return null
        if (typeof first === 'number') return first
        if (typeof first === 'boolean') return first ? 1 : 0
        if (isFormulaDate(first)) return first.start.getTime()
        const text = formulaText(first).trim().replace(/\s/g, '')
        const normalized = /^-?\d{1,3}(\.\d{3})*,\d+$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : /^-?\d+,\d+$/.test(text) ? text.replace(',', '.') : text
        const parsed = Number(normalized)
        if (Number.isFinite(parsed)) return parsed
        const leading = parseFloat(normalized)
        return Number.isFinite(leading) ? leading : null
      }
      // Texto
      case 'format': return formulaText(first)
      case 'concat':
        if (args.some(Array.isArray)) return args.flatMap((value) => Array.isArray(value) ? value : [value])
        if (args.some(isStyled)) return { kind: 'styled', runs: mergeRuns(args.flatMap(runsOf)) }
        return args.map(formulaText).join('')
      case 'join': {
        if (Array.isArray(first)) return first.map(formulaText).join(args.length > 1 ? textArg(1) : ', ')
        return args.length > 1 ? args.slice(1).map(formulaText).join(formulaText(first)) : formulaText(first)
      }
      case 'length': return Array.isArray(first) ? first.length : formulaText(first).length
      case 'lower': return formulaText(first).toLocaleLowerCase('pt-BR')
      case 'upper': return formulaText(first).toLocaleUpperCase('pt-BR')
      case 'trim': return formulaText(first).trim()
      case 'capitalize': { const text = formulaText(first); return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1) }
      case 'replace': return formulaText(first).split(textArg(1)).join(textArg(2))
      case 'replaceall': return formulaText(first).replace(regex(1, 'g'), textArg(2))
      case 'replacefirst': return formulaText(first).replace(regex(1), textArg(2))
      case 'test': return regex(1).test(formulaText(first))
      case 'match': return [...formulaText(first).matchAll(regex(1, 'g'))].map((match) => match[0])
      case 'split': return formulaText(first).split(args.length > 1 ? textArg(1) : ',').map((part) => args.length > 1 ? part : part.trim())
      case 'repeat': return formulaText(first).repeat(Math.max(0, Math.min(1_000_000, Math.trunc(num(second)))))
      case 'padstart': return formulaText(first).padStart(Math.trunc(num(second)), args.length > 2 ? textArg(2) : ' ')
      case 'padend': return formulaText(first).padEnd(Math.trunc(num(second)), args.length > 2 ? textArg(2) : ' ')
      case 'substring': return formulaText(first).slice(Math.trunc(num(second)), args[2] === undefined ? undefined : Math.trunc(num(args[2])))
      case 'slice': {
        const end = args[2] === undefined || args[2] === null ? undefined : Math.trunc(num(args[2]))
        return Array.isArray(first) ? first.slice(Math.trunc(num(second)), end) : formulaText(first).slice(Math.trunc(num(second)), end)
      }
      case 'startswith': return formulaText(first).startsWith(textArg(1))
      case 'endswith': return formulaText(first).endsWith(textArg(1))
      case 'contains': case 'includes': return Array.isArray(first) ? first.some((item) => equals(item, second)) : formulaText(first).includes(textArg(1))
      case 'indexof': return Array.isArray(first) ? first.findIndex((item) => equals(item, second)) : formulaText(first).indexOf(textArg(1))
      case 'link': {
        const href = safeHref(textArg(1))
        return { kind: 'styled', runs: [{ text: formulaText(first) || textArg(1), ...(href ? { href } : {}) }] }
      }
      case 'style': {
        const runs = runsOf(first)
        for (const style of args.slice(1).map(formulaText)) {
          const key = style.trim()
          const lower = key.toLowerCase()
          for (const item of runs) {
            if (lower === 'b') item.bold = true
            else if (lower === 'i') item.italic = true
            else if (lower === 'u') item.underline = true
            else if (lower === 's') item.strike = true
            else if (lower === 'c') item.code = true
            else if ((STYLE_COLORS as readonly string[]).includes(lower)) item.color = lower
            else if (lower.endsWith('_background') && (STYLE_COLORS as readonly string[]).includes(lower.slice(0, -11))) item.background = lower.slice(0, -11)
            else if (/^#[0-9a-f]{6}$/i.test(key)) item.color = key.toLowerCase()
            else if (/^bg:#[0-9a-f]{6}$/i.test(key)) item.background = key.slice(3).toLowerCase()
            else fail(node, `Estilo desconhecido: “${key}”`, `Unknown style: “${key}”`)
          }
        }
        return { kind: 'styled', runs: mergeRuns(runs) }
      }
      case 'unstyle': {
        if (!isStyled(first)) return first
        if (args.length < 2) return formulaText(first)
        const remove = new Set(args.slice(1).map((value) => formulaText(value).toLowerCase()))
        return { kind: 'styled', runs: first.runs.map((item) => {
          const copy = { ...item }
          if (remove.has('b')) delete copy.bold
          if (remove.has('i')) delete copy.italic
          if (remove.has('u')) delete copy.underline
          if (remove.has('s')) delete copy.strike
          if (remove.has('c')) delete copy.code
          if (copy.color && remove.has(copy.color)) delete copy.color
          if (copy.background && remove.has(`${copy.background}_background`)) delete copy.background
          return copy
        }) }
      }
      // Listas
      case 'list': return args
      case 'at': { const list = Array.isArray(first) ? first : typeof first === 'string' ? [...first] : toList(first); return list.at(Math.trunc(num(second))) ?? null }
      case 'first': return toList(first)[0] ?? null
      case 'last': return toList(first).at(-1) ?? null
      case 'reverse': return Array.isArray(first) ? [...first].reverse() : [...formulaText(first)].reverse().join('')
      case 'unique': {
        const seen = new Set<string>()
        return toList(first).filter((item) => { const key = isFormulaPage(item) ? `page:${item.id}` : formulaText(item); if (seen.has(key)) return false; seen.add(key); return true })
      }
      case 'flat': return flat(toList(first))
      // Datas
      case 'now': return { kind: 'date', start: new Date(ctx.now.getTime()), time: true }
      case 'today': return { kind: 'date', start: new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()), time: false }
      case 'minute': { const date = dateArg(0); return date ? date.start.getMinutes() : null }
      case 'hour': { const date = dateArg(0); return date ? date.start.getHours() : null }
      case 'day': { const date = dateArg(0); return date ? date.start.getDay() || 7 : null }
      case 'date': { const date = dateArg(0); return date ? date.start.getDate() : null }
      case 'week': { const date = dateArg(0); return date ? isoWeek(date.start) : null }
      case 'month': { const date = dateArg(0); return date ? date.start.getMonth() + 1 : null }
      case 'year': { const date = dateArg(0); return date ? date.start.getFullYear() : null }
      case 'dateadd': case 'datesubtract': {
        const date = dateArg(0)
        if (!date) return null
        const unit = unitArg(2, 'days')
        const amount = Math.trunc(num(second)) * (node.name === 'datesubtract' ? -1 : 1)
        const time = date.time || ['hours', 'minutes', 'seconds', 'milliseconds'].includes(unit)
        return { kind: 'date', start: addUnits(date.start, amount, unit), ...(date.end ? { end: addUnits(date.end, amount, unit) } : {}), time }
      }
      case 'datebetween': {
        const start = dateArg(0), end = dateArg(1)
        if (!start || !end) return null
        return unitsBetween(start, end, unitArg(2, 'days'))
      }
      case 'daterange': {
        const start = dateArg(0), end = dateArg(1)
        if (!start) return null
        const finish = end ? end.end ?? end.start : undefined
        return { kind: 'date', start: start.start, ...(finish ? { end: finish } : {}), time: start.time || !!end?.time }
      }
      case 'datestart': { const date = dateArg(0); return date ? { kind: 'date', start: date.start, time: date.time } : null }
      case 'dateend': { const date = dateArg(0); return date ? { kind: 'date', start: date.end ?? date.start, time: date.time } : null }
      case 'timestamp': { const date = dateArg(0); return date ? date.start.getTime() : null }
      case 'fromtimestamp': return first === null || first === '' ? null : { kind: 'date', start: new Date(num(first)), time: true }
      case 'formatdate': {
        const date = dateArg(0)
        if (!date) return ''
        const format = args.length > 1 ? textArg(1) : ctx.locale === 'en-US' ? 'MMMM D, YYYY' : 'D [de] MMMM [de] YYYY'
        const one = (value: Date) => formatDateTokens(value, format, ctx.locale)
        return date.end ? `${one(date.start)} → ${one(date.end)}` : one(date.start)
      }
      case 'parsedate': {
        if (first === null || first === '') return null
        if (isFormulaDate(first)) return first
        const parsed = parseDateText(formulaText(first))
        if (!parsed) fail(node.args[0], `Data inválida: “${formulaText(first)}”`, `Invalid date: “${formulaText(first)}”`)
        return parsed
      }
      // Páginas
      case 'id': {
        if (isFormulaPage(first)) return first.id
        if (ctx.self) return ctx.self.id
        return null
      }
      case 'title': case 'name': return isFormulaPage(first) ? first.title : first === null ? ctx.self?.title ?? null : formulaText(first)
      default: return fail(nameSpan, `Função desconhecida: ${node.name}`, `Unknown function: ${node.name}`)
    }
  }

  return run(tree, new Map())
}

function contextFor(property: ((name: string) => PropValue) | undefined, options: FormulaOptions): EvalContext {
  const resolve = options.resolve
  const lookup = (name: string, node: FormulaNode, direct: boolean): FormulaValue => {
    if (resolve) {
      const value = resolve(name)
      if (value !== undefined) return value
      if (direct) fail(node, `Nome desconhecido: ${name} (use prop("${name}") para propriedades)`, `Unknown name: ${name} (use prop("${name}") for properties)`)
      return fail(node, `Propriedade não encontrada: “${name}”`, `Property not found: “${name}”`)
    }
    return fromPropValue(property ? property(name) : null)
  }
  return {
    property: (name, node) => lookup(name, node, false),
    direct: (name, node) => lookup(name, node, true),
    self: options.self,
    now: options.now ?? new Date(),
    locale: options.locale ?? defaultLocale,
  }
}

function guard<T>(source: string, work: () => T): T {
  try { return work() } catch (error) {
    if (error instanceof RangeError) throw new FormulaError('Fórmula aninhada demais para a pilha de execução', 'Formula is nested too deeply for the execution stack', 0, source.length)
    throw error
  }
}

/** Avalia e devolve o valor interno (listas de páginas, datas, texto estilizado…). */
export function evaluateFormulaValue(source: string, property?: (name: string) => PropValue, options: FormulaOptions = {}): FormulaValue {
  return guard(source, () => {
    const tree = cachedParse(source)
    if (!tree) return null
    const result = evaluateTree(tree, contextFor(property, options))
    return typeof result === 'number' && !Number.isFinite(result) ? null : result
  })
}

/** Fórmulas locais: AST próprio, sem eval, acesso a globais, rede ou funções arbitrárias. */
export function evaluateFormula(source: string, property: (name: string) => PropValue, options: FormulaOptions = {}): PropValue {
  return toPropValue(evaluateFormulaValue(source, property, options))
}

export interface FormulaDiagnostic { value: PropValue; error: string | null; at?: number; end?: number }

export function formulaErrorMessage(error: unknown, locale: 'pt-BR' | 'en-US'): { message: string; at?: number; end?: number } {
  if (error instanceof FormulaError) return { message: locale === 'en-US' ? error.en : error.pt, ...(error.at >= 0 ? { at: error.at, end: error.end } : {}) }
  return { message: locale === 'en-US' ? 'Invalid formula' : 'Fórmula inválida' }
}

export function formulaDiagnostic(source: string, property: (name: string) => PropValue, locale: 'pt-BR' | 'en-US' = 'pt-BR', options: FormulaOptions = {}): FormulaDiagnostic {
  try { return { value: evaluateFormula(source, property, { locale, ...options }), error: null } }
  catch (error) { const info = formulaErrorMessage(error, locale); return { value: null, error: info.message, at: info.at, end: info.end } }
}

/** Só a sintaxe (sem avaliar): útil para exibir erros sem depender dos dados da linha. */
export function formulaSyntaxError(source: string, locale: 'pt-BR' | 'en-US' = 'pt-BR'): { message: string; at?: number; end?: number } | null {
  try { cachedParse(source); return null } catch (error) { return formulaErrorMessage(error, locale) }
}
