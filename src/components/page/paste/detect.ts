// Heurística "este texto simples é Markdown?" e leitura de TSV (planilhas). Puro: sem DOM.
// Documentado em docs/USAGE.md. Sinais fortes bastam sozinhos; sinais fracos precisam somar 2.

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})[^`]*$/
const HEADING = /^\s{0,3}#{1,6}[ \t]+\S/
const TASK = /^\s*[-*+][ \t]+\[[ xX]\][ \t]+\S/
const BULLET = /^\s*[-*+][ \t]+\S/
const ORDERED = /^\s*\d{1,9}[.)][ \t]+\S/
const QUOTE = /^\s{0,3}>[ \t]?\S/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$|^\s*\|\s*:?-{3,}:?\s*\|\s*$/
const DIVIDER = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const DISPLAY_MATH = /^\s*(\$\$|\\\[)/
const CALLOUT = /^\s{0,3}>\s*\[!\w+\]/
const DETAILS = /^\s*<details\b/i
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:\s+\S/

const BOLD = /(^|[^\w*])\*\*(?=\S)[^*\n]*?\S\*\*(?!\*)|(^|[^\w_])__(?=\S)[^_\n]*?\S__(?![\w_])/
const INLINE_CODE = /(^|[^`\w])`(?=[^`\s])[^`\n]{0,200}[^`\s]?`(?!`)/
const LINK = /!?\[[^\]\n]{1,300}\]\((?:https?:\/\/|mailto:|data:image\/|\/|\.{0,2}\/)[^)\s]*(?:\s+"[^"]*")?\)/
const STRIKE = /~~(?=\S)[^~\n]*?\S~~/
const HIGHLIGHT = /==(?=\S)[^=\n]*?\S==/
const ITALIC = /(^|[\s(])(\*|_)(?=[^\s*_])[^*_\n]{1,80}[^\s*_]\2(?=[\s.,;:!?)]|$)/
const HTML_INLINE = /<(br\s*\/?|\/?(b|i|u|em|strong|s|del|sup|sub|mark|kbd|code))>/gi

export interface MarkdownSignals { strong: string[]; weak: string[] }

/** Sinais encontrados (para testes e depuração). */
export function markdownSignals(source: string): MarkdownSignals {
  const strong = new Set<string>(), weak = new Set<string>()
  const text = source.length > 400_000 ? source.slice(0, 400_000) : source
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let bullets = 0, ordered = 0, quotes = 0, fenceOpen: string | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fence = FENCE_OPEN.exec(line)
    if (fenceOpen) {
      if (line.trim().startsWith(fenceOpen) && /^\s*(`{3,}|~{3,})\s*$/.test(line)) { strong.add('fence'); fenceOpen = null }
      continue
    }
    if (fence) { fenceOpen = fence[1]; continue }
    if (HEADING.test(line)) strong.add('heading')
    if (TASK.test(line)) strong.add('task')
    else if (BULLET.test(line) && !DIVIDER.test(line)) bullets++
    if (ORDERED.test(line)) ordered++
    if (CALLOUT.test(line)) strong.add('callout')
    else if (QUOTE.test(line)) quotes++
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[index + 1] ?? '')) strong.add('table')
    if (DISPLAY_MATH.test(line)) {
      const opener = line.trim().startsWith('$$') ? '$$' : '\\]'
      const rest = line.trim().slice(2)
      if (rest.includes(opener) || lines.slice(index + 1, index + 200).some((next) => next.includes(opener))) strong.add('math')
    }
    if (DETAILS.test(line) && /<summary>/i.test(text)) strong.add('details')
    if (FOOTNOTE_DEF.test(line)) weak.add('footnote')
    if (DIVIDER.test(line) && index > 0 && lines[index - 1].trim() === '' ) weak.add('divider')
  }
  if (bullets >= 2) strong.add('list'); else if (bullets === 1) weak.add('list')
  if (ordered >= 2) strong.add('ordered'); else if (ordered === 1) weak.add('ordered')
  if (quotes >= 2) weak.add('quote+'), weak.add('quote'); else if (quotes === 1) weak.add('quote')
  // Inline: só fora de cercas de código.
  const prose = text.replace(/(^|\n)\s{0,3}(`{3,}|~{3,})[\s\S]*?\n\s{0,3}\2[^\n]*/g, '\n')
  if (BOLD.test(prose)) strong.add('bold')
  if (LINK.test(prose)) strong.add('link')
  if (INLINE_CODE.test(prose)) strong.add('code')
  if (STRIKE.test(prose)) weak.add('strike')
  if (HIGHLIGHT.test(prose)) weak.add('highlight')
  if (ITALIC.test(prose)) weak.add('italic')
  const tags = prose.match(HTML_INLINE)?.length ?? 0
  if (tags >= 3) strong.add('html'); else if (tags) weak.add('html')
  if (conversationRoles(lines).length >= 2) strong.add('conversation')
  return { strong: [...strong], weak: [...weak] }
}

/** O texto colado deve ser convertido de Markdown em blocos? */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || !text.trim()) return false
  const { strong, weak } = markdownSignals(text)
  return strong.length > 0 || weak.length >= 2
}

const ROLE = /^\s*(?:\*\*)?(?:(?:o|a|the)\s+)?(você|voce|eu|usuário|usuario|assistente|ia|user|you|me|assistant|human|ai|chatgpt|claude|gemini|copilot|bot|sistema|system)(?:\s+(?:disse|said|wrote|escreveu))?\s*:(?:\*\*)?\s*(.*)$/i

const ROLE_KIND: Record<string, string> = {
  você: 'user', voce: 'user', eu: 'user', usuário: 'user', usuario: 'user', user: 'user', you: 'user', me: 'user', human: 'user',
  assistente: 'ai', ia: 'ai', assistant: 'ai', ai: 'ai', chatgpt: 'ai', claude: 'ai', gemini: 'ai', copilot: 'ai', bot: 'ai', sistema: 'system', system: 'system',
}

/** Linhas "Papel: fala" de uma conversa copiada. Exige ≥ 2 falas de ≥ 2 papéis distintos. */
export function conversationRoles(lines: string[]): { index: number; role: string; rest: string }[] {
  const found: { index: number; role: string; rest: string }[] = []
  let fence: string | null = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const open = FENCE_OPEN.exec(line)
    if (fence) { if (line.trim().startsWith(fence)) fence = null; continue }
    if (open) { fence = open[1]; continue }
    if (/^\s/.test(line)) continue
    const match = ROLE.exec(line)
    if (match) found.push({ index, role: line.slice(0, line.indexOf(':')).replace(/\*\*/g, '').trim(), rest: match[2] })
  }
  const kinds = new Set(found.map((item) => ROLE_KIND[item.role.split(/\s+/).find((word) => ROLE_KIND[word.toLowerCase()])?.toLowerCase() ?? ''] ?? item.role.toLowerCase()))
  return found.length >= 2 && kinds.size >= 2 ? found : []
}

/** TSV de planilha (Excel, Numbers, Planilhas): ≥ 2 linhas × ≥ 2 colunas, mesmo número de tabs. */
export function parseTsv(text: string): string[][] | null {
  if (!text.includes('\t') || text.length > 4_000_000) return null
  const source = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const rows: string[][] = []
  let row: string[] = [], cell = '', index = 0
  while (index <= source.length) {
    if (index === source.length) { row.push(cell); rows.push(row); break }
    const char = source[index]
    if (char === '"' && cell === '') {
      // Campo entre aspas (Excel usa para células com quebra de linha ou tab).
      let end = index + 1, value = ''
      for (; end < source.length; end++) {
        if (source[end] === '"') { if (source[end + 1] === '"') { value += '"'; end++; continue } break }
        value += source[end]
      }
      if (end < source.length && (end + 1 === source.length || source[end + 1] === '\t' || source[end + 1] === '\n')) { cell = value; index = end + 1; continue }
    }
    if (char === '\t') { row.push(cell); cell = ''; index++; continue }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; continue }
    cell += char; index++
  }
  if (rows.length < 2) return null
  const width = rows[0].length
  if (width < 2 || rows.some((item) => item.length !== width)) return null
  if (rows.every((item) => item[0] === '')) return null
  if (rows.every((item) => item.every((value) => value.trim() === ''))) return null
  return rows.map((item) => item.map((value) => value.replace(/ /g, ' ').trim()))
}
