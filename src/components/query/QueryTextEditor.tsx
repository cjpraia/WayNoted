// "Editar consulta" em texto (modo avançado): mesmo visual do editor de fórmulas (realce por
// sobreposição, sugestões, erro com posição). Texto válido atualiza o modelo; o construtor e o texto
// ficam sempre sincronizados (texto ↔ modelo).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { translate } from '../../localization.ts'
import { applyQuerySuggestion, highlightQuery, parseQueryText, querySuggestions, serializeQuery, type SerializeContext, type Suggestion, type TextContext } from '../../query/text.ts'
import { stripIds, type Query } from '../../query/model.ts'
import '../database/editors/FormulaEditor.css'

type Locale = 'pt-BR' | 'en-US'
export interface QueryTextEditorProps { query: Query; context: TextContext; serialize: SerializeContext; locale: Locale; readOnly: boolean; onChange: (query: Query) => void; id: string }

const drafts = new Map<string, string>()
const same = (a: Query | null, b: Query) => !!a && JSON.stringify(stripIds(a)) === JSON.stringify(stripIds(b))

export function QueryTextEditor({ query, context, serialize, locale, readOnly, onChange, id }: QueryTextEditorProps) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  // Rascunho por bloco: digitação em andamento (ainda inválida) sobrevive a remontagens.
  const [source, setSourceState] = useState(() => drafts.get(id) ?? serializeQuery(query, serialize))
  const setSource = (next: string) => { drafts.set(id, next); if (drafts.size > 200) drafts.delete(drafts.keys().next().value!); setSourceState(next) }
  const [caret, setCaret] = useState(source.length)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(true)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLPreElement>(null)
  const parsed = parseQueryText(source, context)
  // O construtor mudou a consulta: o texto passa a refletir o modelo novo.
  useEffect(() => {
    if (!same(parseQueryText(source, context).query, query)) { const next = serializeQuery(query, serialize); setSource(next); setCaret(next.length) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const segments = highlightQuery(source, context, parsed)
  const completion = dismissed || readOnly ? { suggestions: [] as Suggestion[], from: caret, to: caret } : querySuggestions(source, caret, context, 10)
  const highlighted = completion.suggestions[Math.min(active, completion.suggestions.length - 1)]

  const update = (next: string, nextCaret: number) => {
    setSource(next); setCaret(nextCaret); setActive(0)
    const result = parseQueryText(next, context)
    if (result.query && !same(result.query, query)) onChange(result.query)
    requestAnimationFrame(() => { const el = textRef.current; if (el && document.activeElement === el) { el.selectionStart = el.selectionEnd = nextCaret } })
  }
  const accept = (suggestion: Suggestion) => { const result = applyQuerySuggestion(source, completion.from, completion.to, suggestion); update(result.source, result.caret); textRef.current?.focus() }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.key === ' ' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setDismissed(false); return }
    if (!completion.suggestions.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % completion.suggestions.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + completion.suggestions.length) % completion.suggestions.length) }
    else if ((event.key === 'Enter' || event.key === 'Tab') && highlighted) { event.preventDefault(); accept(highlighted) }
    else if (event.key === 'Escape') { event.preventDefault(); setDismissed(true) }
  }
  const error = parsed.error
  return <div className="fx-editor qb-text" data-qb="text-editor">
    <div className="fx-field">
      <pre ref={overlayRef} className="fx-overlay" aria-hidden="true">{segments.map((segment, index) => <span key={index} className={`fx-${segment.kind}${segment.error ? ' fx-error-mark' : ''}`}>{segment.text}</span>)}{'\n'}</pre>
      <textarea ref={textRef} className="fx-input" spellCheck={false} rows={2} value={source} readOnly={readOnly}
        aria-label={t('Consulta em texto', 'Query text')} aria-invalid={!!error} aria-describedby={`${id}-status`}
        placeholder={t('tabela de "Projetos" onde Status = "Em andamento" e Prazo < hoje+7d ordenar Prazo limite 20', 'table from "Projects" where Status = "In progress" and Due < today+7d sort Due limit 20')}
        onChange={(event) => { setDismissed(false); update(event.target.value, event.target.selectionStart) }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setDismissed(true)}
        onKeyDown={onKeyDown}
        onScroll={(event) => { if (overlayRef.current) { overlayRef.current.scrollTop = event.currentTarget.scrollTop; overlayRef.current.scrollLeft = event.currentTarget.scrollLeft } }} />
    </div>
    {completion.suggestions.length > 0 && <div className="fx-suggestions" role="listbox" aria-label={t('Sugestões', 'Suggestions')}>
      {completion.suggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={index === active} key={`${suggestion.kind}:${suggestion.label}`} className={`fx-suggestion${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); accept(suggestion) }}>
        <span className={`fx-badge fx-badge--${suggestion.kind === 'database' || suggestion.kind === 'function' ? 'function' : suggestion.kind === 'property' ? 'property' : 'keyword'}`}>{suggestion.kind === 'database' ? 'B' : suggestion.kind === 'property' ? 'P' : suggestion.kind === 'function' ? 'ƒ' : suggestion.kind === 'value' ? 'V' : 'K'}</span>
        <span className="fx-suggestion-label">{suggestion.label}</span>
        <span className="fx-suggestion-detail">{suggestion.detail}</span>
      </button>)}
    </div>}
    <div id={`${id}-status`} className={`fx-status${error ? ' fx-status--error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <><strong>{t('Erro na posição {at}', 'Error at position {at}', { at: error.from + 1 })}:</strong> {error.message}</>
        : <span className="fx-status-label">{t('Consulta válida. ⌃Espaço sugere nomes; o construtor acima acompanha o texto.', 'Valid query. ⌃Space suggests names; the builder above follows the text.')}</span>}
    </div>
  </div>
}
