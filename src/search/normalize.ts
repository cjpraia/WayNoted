// Normalização de texto compartilhada pela busca (e reutilizável por outros módulos:
// menções não vinculadas, grafo, importação). Puro, sem dependências do DOM.

const COMBINING = /[̀-ͯ]/g
const SPECIAL: Record<string, string> = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ı': 'i', 'ﬁ': 'fi', 'ﬂ': 'fl' }
const SPECIAL_RE = /[ßæœøđłıﬁﬂ]/g

/** Ignora acentos e caixa: "Ação" → "acao". Mantém pontuação e espaços. */
export function normalizeText(text: string): string {
  if (!text) return ''
  return text.normalize('NFD').replace(COMBINING, '').toLocaleLowerCase('pt-BR').replace(SPECIAL_RE, char => SPECIAL[char] ?? char)
}

/**
 * Normaliza preservando o mapeamento para o texto original, para destacar trechos.
 * `map[i]` é o índice no original do i-ésimo caractere normalizado; `map[text.length]` = original.length.
 */
export function normalizeWithMap(original: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let index = 0
  for (const char of original) {
    const folded = normalizeText(char)
    for (let k = 0; k < folded.length; k++) { text += folded[k]; map.push(index) }
    index += char.length
  }
  map.push(original.length)
  return { text, map }
}

const WORD = /[\p{L}\p{N}]+/gu

/** Palavras normalizadas (letras/dígitos), na ordem em que aparecem. */
export function tokenize(text: string): string[] {
  return normalizeText(text).match(WORD) ?? []
}

/** Palavras com posição no texto já normalizado. */
export function tokenSpans(normalized: string): { token: string; start: number; end: number }[] {
  const spans: { token: string; start: number; end: number }[] = []
  for (const match of normalized.matchAll(WORD)) spans.push({ token: match[0], start: match.index!, end: match.index! + match[0].length })
  return spans
}

/**
 * Formas-base para plural simples pt/en. Um termo e uma palavra combinam quando
 * os conjuntos se cruzam: "acoes" → {acoes, acoe, aco, acao}; "acao" → {acao}.
 */
export function baseForms(token: string): string[] {
  const forms = new Set([token])
  const n = token.length
  if (n >= 4 && !/\d/.test(token)) {
    const cut = (suffix: string, replacement: string) => { if (token.endsWith(suffix) && n - suffix.length >= 2) forms.add(token.slice(0, n - suffix.length) + replacement) }
    cut('oes', 'ao'); cut('aes', 'ao'); cut('ais', 'al'); cut('eis', 'el'); cut('eis', 'il'); cut('ois', 'ol'); cut('uis', 'ul')
    cut('ns', 'm'); cut('ies', 'y'); cut('es', '')
    if (token.endsWith('s') && !token.endsWith('ss')) forms.add(token.slice(0, -1))
  }
  return [...forms]
}

/** Distância de edição ≤ 1 (inserção, remoção, troca ou transposição adjacente). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** Termos com 5+ letras aceitam um erro de digitação. */
export const FUZZY_MIN_LENGTH = 5
