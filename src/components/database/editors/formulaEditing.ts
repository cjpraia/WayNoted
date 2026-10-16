// Funções puras do editor de fórmulas: realce tolerante a erros, contexto do cursor,
// sugestões (funções/propriedades/palavras-chave) e aplicação do autocompletar.
import { FORMULA_FUNCTIONS, FORMULA_KEYWORDS, formulaFunctionDoc, type FormulaFunctionDoc } from '../formulaCatalog.ts'

export type SegmentKind = 'text' | 'string' | 'number' | 'function' | 'property' | 'keyword' | 'operator' | 'paren' | 'comment' | 'unknown'
export interface Segment { text: string; kind: SegmentKind; at: number; error?: boolean }

const KEYWORDS = new Set(FORMULA_KEYWORDS)

/** Divide a fórmula em trechos coloridos sem nunca lançar erro (texto incompleto é comum ao digitar). */
export function highlightFormula(source: string, propertyNames: string[], error?: { at?: number; end?: number }): Segment[] {
  const names = new Set(propertyNames)
  const out: Segment[] = []
  const push = (text: string, kind: SegmentKind, at: number) => { if (text) out.push({ text, kind, at }) }
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const space = rest.match(/^\s+/)
    if (space) { push(space[0], 'text', i); i += space[0].length; continue }
    if (rest.startsWith('//')) { const end = rest.indexOf('\n'); const text = end < 0 ? rest : rest.slice(0, end); push(text, 'comment', i); i += text.length; continue }
    if (rest.startsWith('/*')) { const end = rest.indexOf('*/'); const text = end < 0 ? rest : rest.slice(0, end + 2); push(text, 'comment', i); i += text.length; continue }
    const quote = rest[0]
    if (quote === '"' || quote === "'") {
      let j = 1
      while (j < rest.length && rest[j] !== quote) j += rest[j] === '\\' ? 2 : 1
      const text = rest.slice(0, Math.min(rest.length, j + 1))
      const before = source.slice(0, i).replace(/\s+$/, '')
      const isPropName = /(?:^|[^\p{L}\p{N}_])prop\s*\($/u.test(before) || /\.prop\s*\($/u.test(before)
      push(text, isPropName ? 'property' : 'string', i)
      i += text.length
      continue
    }
    const number = rest.match(/^(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/)
    if (number) { push(number[0], 'number', i); i += number[0].length; continue }
    const name = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u)
    if (name) {
      const after = rest.slice(name[0].length).match(/^\s*\(/)
      const lower = name[0].toLowerCase()
      const kind: SegmentKind = after ? (formulaFunctionDoc(lower) ? 'function' : 'unknown') : KEYWORDS.has(lower) ? 'keyword' : names.has(name[0]) ? 'property' : 'text'
      push(name[0], kind, i)
      i += name[0].length
      continue
    }
    push(rest[0], '()[]'.includes(rest[0]) ? 'paren' : 'operator', i)
    i++
  }
  if (error?.at === undefined || error.at < 0) return out
  // Marca os trechos dentro do intervalo do erro (dividindo nas bordas).
  const from = error.at, to = Math.max(error.end ?? from + 1, from + 1)
  const marked: Segment[] = []
  for (const segment of out) {
    const start = segment.at, end = segment.at + segment.text.length
    if (end <= from || start >= to) { marked.push(segment); continue }
    const a = Math.max(from, start) - start, b = Math.min(to, end) - start
    if (a > 0) marked.push({ ...segment, text: segment.text.slice(0, a) })
    marked.push({ ...segment, text: segment.text.slice(a, b), at: start + a, error: true })
    if (b < segment.text.length) marked.push({ ...segment, text: segment.text.slice(b), at: start + b })
  }
  if (from >= source.length) marked.push({ text: ' ', kind: 'text', at: source.length, error: true })
  return marked
}

/** Palavra sendo digitada antes do cursor (para sugerir). */
export function completionContext(source: string, caret: number): { prefix: string; from: number; afterDot: boolean; insidePropString: boolean } {
  const before = source.slice(0, caret)
  const propString = before.match(/prop\(\s*["']([^"']*)$/)
  if (propString) return { prefix: propString[1], from: caret - propString[1].length, afterDot: false, insidePropString: true }
  const word = before.match(/[\p{L}_][\p{L}\p{N}_]*$/u)?.[0] ?? ''
  const from = caret - word.length
  return { prefix: word, from, afterDot: source[from - 1] === '.', insidePropString: false }
}

export interface Suggestion { kind: 'function' | 'property' | 'keyword'; label: string; insert: string; detail: string; doc?: FormulaFunctionDoc }

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function formulaSuggestions(source: string, caret: number, propertyNames: string[], limit = 40): { suggestions: Suggestion[]; from: number; to: number } {
  const context = completionContext(source, caret)
  const query = normalize(context.prefix)
  const to = caret
  if (context.insidePropString) {
    const suggestions = propertyNames.filter((name) => normalize(name).includes(query)).slice(0, limit).map((name): Suggestion => ({ kind: 'property', label: name, insert: name, detail: 'prop' }))
    return { suggestions, from: context.from, to }
  }
  if (!query && !context.afterDot) return { suggestions: [], from: context.from, to }
  const rank = (label: string) => normalize(label).startsWith(query) ? 0 : 1
  const functions = FORMULA_FUNCTIONS.filter((doc) => normalize(doc.name).includes(query)).map((doc): Suggestion => ({ kind: 'function', label: doc.name, insert: `${doc.name}(`, detail: doc.signature, doc }))
  const properties = context.afterDot ? [] : propertyNames.filter((name) => normalize(name).includes(query)).map((name): Suggestion => ({ kind: 'property', label: name, insert: /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `prop("${name.replace(/"/g, '\\"')}")`, detail: 'prop' }))
  const keywords = context.afterDot ? [] : FORMULA_KEYWORDS.filter((word) => word.startsWith(query)).map((word): Suggestion => ({ kind: 'keyword', label: word, insert: word, detail: '' }))
  const all = [...properties, ...functions, ...keywords].sort((a, b) => rank(a.label) - rank(b.label))
  return { suggestions: all.slice(0, limit), from: context.from, to }
}

export function applySuggestion(source: string, from: number, to: number, suggestion: Suggestion, insidePropString = false): { source: string; caret: number } {
  let insert = suggestion.insert
  if (insidePropString) {
    const closeQuote = /^["']/.test(source.slice(to)) ? '' : '"'
    const closeParen = /^["']?\s*\)/.test(source.slice(to)) ? '' : ')'
    insert = `${suggestion.insert}${closeQuote}${closeParen}`
    const next = source.slice(0, from) + insert + source.slice(to)
    return { source: next, caret: from + insert.length + (closeQuote ? 0 : 1) + (closeParen ? 0 : 1) }
  }
  const next = source.slice(0, from) + insert + source.slice(to)
  return { source: next, caret: from + insert.length }
}

/** Função cuja chamada contém o cursor (para mostrar a documentação dela). */
export function enclosingCall(source: string, caret: number): FormulaFunctionDoc | undefined {
  let depth = 0
  for (let i = caret - 1; i >= 0; i--) {
    const ch = source[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      if (depth === 0) {
        const name = source.slice(0, i).match(/([\p{L}_][\p{L}\p{N}_]*)\s*$/u)?.[1]
        const doc = name ? formulaFunctionDoc(name) : undefined
        if (doc) return doc
      } else depth--
    }
  }
  return undefined
}
