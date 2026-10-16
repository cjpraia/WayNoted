// Lei de Postel: aceitar a entrada de muitos jeitos e devolver sempre o formato rigoroso.
// Puro (sem DOM): usado em campos de URL, colar link e células numéricas.

export interface LooseUrl { url: string; label?: string }

const HOST = /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:[/?#]\S*)?$/i
const SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Aceita `https://x.com`, `x.com/a`, `www.x.com`, ` <https://x.com> `, `[texto](https://x.com)`, aspas e espaços nas pontas.
 * Devolve a URL canônica (https por padrão; http para localhost/IP) ou null. Nunca aceita `javascript:` e afins.
 */
export function parseLooseUrl(raw: string): LooseUrl | null {
  let text = raw.normalize('NFC').trim()
  let label: string | undefined
  const markdown = /^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)$/.exec(text)
  if (markdown) { label = markdown[1].trim() || undefined; text = markdown[2] }
  text = text.replace(/^<(.*)>$/, '$1').replace(/^(["'“‘])(.*)(["'”’])$/, '$2').trim()
  if (!text || /\s/.test(text)) return null
  let candidate = text
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)
  if (scheme && !/^(localhost|\d{1,3}(\.\d{1,3}){3}):\d/i.test(text)) {
    if (!SCHEMES.has(`${scheme[1].toLowerCase()}:`)) return null
  } else if (text.startsWith('//')) candidate = `https:${text}`
  else if (HOST.test(text)) candidate = `${/^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(text) ? 'http' : 'https'}://${text}`
  else return null
  try {
    const url = new URL(candidate)
    if (!SCHEMES.has(url.protocol) || url.username || url.password) return null
    if (url.protocol.startsWith('http') && !url.hostname) return null
    const href = url.protocol.startsWith('http') && url.pathname === '/' && !url.search && !url.hash ? url.href.replace(/\/$/, '') : url.href
    return { url: href, ...(label ? { label } : {}) }
  } catch { return null }
}

export interface LooseNumber { value: number; percent: boolean; currency?: string }

const CURRENCY = /^(?:R\$|US\$|\$|€|£|BRL|USD|EUR|GBP)\s*|\s*(?:BRL|USD|EUR|GBP|reais?)$/i

/**
 * Número "como a pessoa digita": `1.234,56`, `1,234.56`, `R$ 12`, `12%`, `(40)`, `−3`, `1 234,5`, `12,`.
 * Com um só separador, vírgula é decimal; ponto é decimal, exceto quando há vários pontos (milhar) ou "1.234.567".
 * Devolve null se não for número.
 */
export function parseLooseNumber(raw: string): LooseNumber | null {
  let s = raw.normalize('NFKC').trim()
  if (!s) return null
  let negative = false, percent = false, currency: string | undefined
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim() }
  s = s.replace(/^[−–]/, '-')
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim() }
  const cur = CURRENCY.exec(s)
  if (cur) { currency = cur[0].trim().toUpperCase().replace('R$', 'BRL').replace('US$', 'USD').replace('$', 'USD').replace('€', 'EUR').replace('£', 'GBP').replace(/^REAIS?$/, 'BRL'); s = s.replace(CURRENCY, '') }
  if (cur && s.startsWith('-')) { negative = true; s = s.slice(1).trim() }
  if (s.endsWith('%')) { percent = true; s = s.slice(0, -1).trim() }
  s = s.replace(/[\s ']/g, '')
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null
  s = s.replace(/[.,]$/, '')
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length
  let normalized: string
  if (dots && commas) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    if (s.split(decimal).length > 2) return null
    const [int, frac] = s.split(decimal)
    if (!int.split(thousands).every((g, i) => i === 0 ? /^\d{1,3}$/.test(g) || /^0$/.test(g) : /^\d{3}$/.test(g))) return null
    normalized = `${int.split(thousands).join('')}.${frac}`
  } else if (commas > 1) {
    if (!s.split(',').every((g, i) => i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g))) return null
    normalized = s.replace(/,/g, '')
  } else if (dots > 1) {
    if (!s.split('.').every((g, i) => i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g))) return null
    normalized = s.replace(/\./g, '')
  } else normalized = s.replace(',', '.')
  if (normalized.startsWith('.')) normalized = `0${normalized}`
  const value = Number(normalized)
  if (!Number.isFinite(value) || normalized.replace(/\D/g, '').length > 15) return null
  return { value: negative ? -value : value, percent, ...(currency ? { currency } : {}) }
}

/** Valor numérico de uma célula digitada; `percentFormat` guarda "12%" como fração (0,12). */
export function looseNumberValue(raw: string, percentFormat = false): number | null {
  const parsed = parseLooseNumber(raw)
  if (!parsed) return null
  return parsed.percent && percentFormat ? Math.round(parsed.value * 1e10) / 1e12 : parsed.value
}
