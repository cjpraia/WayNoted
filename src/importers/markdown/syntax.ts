// Sintaxe própria do Markdown Vault → Markdown comum que o conversor do Export Bundle já entende:
// [[Nota]], [[Nota|apelido]], [[Nota#Título]], ![[imagem.png]], ![[Nota]], %%comentário%% e callouts.
// Links internos viram `markdown:<alvo>`; anexos viram caminhos a partir da raiz do vault.
export interface SyntaxResolvers {
  /** Caminho (a partir da raiz) do anexo apontado, ou null. */
  asset(target: string): string | null
  /** A nota existe? (para decidir se `![[Nota]]` vira link). */
  note(target: string): boolean
}

const WIKI = /(!?)\[\[([^\[\]|]+?)(?:\|([^\[\]]*?))?\]\]/g
const NOTE_EXT = /\.(md|markdown)$/i

/** Percent-encode seguro para o destino de um link Markdown (espaços, parênteses, colchetes). */
export function encodeMdPath(path: string): string {
  return encodeURI(path).replace(/[()\[\]]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
const escapeLabel = (label: string) => label.replace(/([\[\]\\])/g, '\\$1')

function convertSegment(segment: string, resolvers: SyntaxResolvers): string {
  return segment.replace(WIKI, (_all, bang: string, rawTarget: string, alias?: string) => {
    let target = rawTarget.trim()
    const hashAt = target.indexOf('#')
    const heading = hashAt >= 0 ? target.slice(hashAt + 1).replace(/^\^/, '').trim() : ''
    let note = hashAt >= 0 ? target.slice(0, hashAt).trim() : target
    note = note.replace(/\^[\w-]+$/, '').trim()
    const label = alias?.trim()
    if (!note) return heading ? escapeLabel(label || heading) : ''
    if (bang) {
      const isNote = !/\.[a-z0-9]{2,5}$/i.test(note) || NOTE_EXT.test(note)
      if (!isNote) {
        const path = resolvers.asset(note)
        // Apelido numérico (`|200` ou `|200x100`) é tamanho, não legenda.
        const alt = label && !/^\d+(x\d+)?$/.test(label) ? label : ''
        return `![${escapeLabel(alt)}](${encodeMdPath(path ?? note)})`
      }
      target = note.replace(NOTE_EXT, '')
      return `\n\n[${escapeLabel(label || target)}](markdown:${encodeURIComponent(target)})\n\n`
    }
    target = note.replace(NOTE_EXT, '')
    const shown = label || (heading ? `${target.split('/').pop()} > ${heading}` : target.split('/').pop()!)
    return `[${escapeLabel(shown)}](markdown:${encodeURIComponent(target)})`
  })
}

/** Converte linha a linha, preservando blocos de código cercados e código inline. */
export function convertMarkdownSyntax(markdown: string, resolvers: SyntaxResolvers): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence = ''
  let comment = false
  for (let line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) { out.push(line); if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = ''; continue }
    if (fenceMatch) { fence = fenceMatch[1]; out.push(line); continue }
    // Comentários %% … %% (também em várias linhas).
    if (comment) { const close = line.indexOf('%%'); if (close < 0) continue; line = line.slice(close + 2); comment = false }
    for (;;) {
      const open = line.indexOf('%%')
      if (open < 0) break
      const close = line.indexOf('%%', open + 2)
      if (close < 0) { line = line.slice(0, open); comment = true; break }
      line = line.slice(0, open) + line.slice(close + 2)
    }
    // Callout `> [!tipo]- Título` → citação com título em negrito.
    line = line.replace(/^(\s*>\s*)\[!([\w-]+)\][+-]?[ \t]*(.*)$/, (_m, prefix: string, kind: string, title: string) => `${prefix}**${(title.trim() || kind.charAt(0).toUpperCase() + kind.slice(1)).replace(/\*/g, '')}**`)
    const parts = line.split(/(`+[^`]*`+)/)
    out.push(parts.map((part, index) => index % 2 ? part : convertSegment(part, resolvers)).join(''))
  }
  return out.join('\n')
}
