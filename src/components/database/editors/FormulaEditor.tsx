// Editor de fórmula do menu da propriedade: realce de sintaxe, autocompletar de propriedades e
// funções, documentação inline da função sob o cursor, pré-visualização numa linha real e erros
// sublinhados na posição exata.
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getState } from '../../../store'
import { useI18n } from '../../../i18n'
import type { Page, Property, PropValue } from '../../../types'
import { isLivePage, previewFormula } from '../derived'
import { formulaSyntaxError, setFormulaLocale } from '../formula'
import { FORMULA_CATEGORY_LABELS, FORMULA_FUNCTIONS, type FormulaCategory, type FormulaFunctionDoc } from '../formulaCatalog'
import { formatDateValueText } from '../formatting'
import { applySuggestion, completionContext, enclosingCall, formulaSuggestions, highlightFormula, type Suggestion } from './formulaEditing'
import './FormulaEditor.css'
import { Select } from '../../ui/Select'

function previewText(value: PropValue, locale: 'pt-BR' | 'en-US'): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString(locale, { maximumFractionDigits: 8 })
  if (typeof value === 'boolean') return value ? (locale === 'en-US' ? 'true (checked)' : 'verdadeiro (marcado)') : (locale === 'en-US' ? 'false' : 'falso')
  if (Array.isArray(value)) return value.length ? `[${value.map((item) => typeof item === 'string' ? item : item.name).join(', ')}]` : '[]'
  if (typeof value === 'object' && 'type' in value && value.type === 'richText') return value.runs.map((run) => run.text).join('')
  if (typeof value === 'object' && 'start' in value) return formatDateValueText(value, locale)
  if (typeof value === 'object' && 'label' in value) return value.label
  return String(value)
}

export function FormulaEditor({ dbId, property, onChange }: { dbId: string; property: Property; onChange: (formula: string) => void }) {
  const { t, locale } = useI18n()
  setFormulaLocale(locale)
  const [source, setSource] = useState(property.formula ?? '')
  const [caret, setCaret] = useState(source.length)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [browse, setBrowse] = useState<FormulaCategory | null>(null)
  const [rowId, setRowId] = useState<string>('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLPreElement>(null)
  const pages = getState().pages
  const properties = (pages[dbId]?.database?.properties ?? []).filter((item) => item.id !== property.id)
  const names = properties.map((item) => item.name)
  const rows = useMemo(() => Object.values(pages).filter((page): page is Page => page.parentId === dbId && isLivePage(page.id, pages)).sort((a, b) => a.order - b.order).slice(0, 50), [pages, dbId])
  const sample = rows.find((row) => row.id === rowId) ?? rows[0]
  const syntax = formulaSyntaxError(source, locale)
  const preview = source.trim() ? previewFormula(sample, property, source, pages, locale) : null
  const error = syntax ?? (preview?.error ? { message: preview.error, at: preview.at, end: preview.end } : null)
  const segments = highlightFormula(source, names, error ?? undefined)
  const completion = dismissed ? { suggestions: [] as Suggestion[], from: caret, to: caret } : formulaSuggestions(source, caret, names, 12)
  const context = completionContext(source, caret)
  const highlighted = completion.suggestions[Math.min(active, completion.suggestions.length - 1)]
  const doc: FormulaFunctionDoc | undefined = highlighted?.doc ?? enclosingCall(source, caret)

  const update = (next: string, nextCaret: number) => {
    setSource(next)
    setCaret(nextCaret)
    setActive(0)
    onChange(next)
    requestAnimationFrame(() => { const el = textRef.current; if (el) { el.selectionStart = el.selectionEnd = nextCaret; el.focus() } })
  }
  const accept = (suggestion: Suggestion) => {
    const result = applySuggestion(source, completion.from, completion.to, suggestion, context.insidePropString)
    update(result.source, result.caret)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (!completion.suggestions.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % completion.suggestions.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + completion.suggestions.length) % completion.suggestions.length) }
    else if ((event.key === 'Enter' || event.key === 'Tab') && highlighted) { event.preventDefault(); accept(highlighted) }
    else if (event.key === 'Escape') { event.preventDefault(); setDismissed(true) }
  }
  const insertSnippet = (text: string) => {
    const el = textRef.current
    const start = el?.selectionStart ?? source.length, end = el?.selectionEnd ?? source.length
    update(source.slice(0, start) + text + source.slice(end), start + text.length)
  }

  return <div className="fx-editor">
    <div className="fx-field">
      <pre ref={overlayRef} className="fx-overlay" aria-hidden="true">{segments.map((segment, index) => <span key={index} className={`fx-${segment.kind}${segment.error ? ' fx-error-mark' : ''}`}>{segment.text}</span>)}{'\n'}</pre>
      <textarea
        ref={textRef}
        id={`formula-${property.id}`}
        className="fx-input"
        spellCheck={false}
        rows={4}
        value={source}
        aria-label={t('Fórmula', 'Formula')}
        aria-invalid={!!error}
        aria-describedby={`formula-status-${property.id}`}
        placeholder={t('prop("Preço") * prop("Quantidade")', 'prop("Price") * prop("Quantity")')}
        onChange={(event) => { setDismissed(false); update(event.target.value, event.target.selectionStart) }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onScroll={(event) => { if (overlayRef.current) { overlayRef.current.scrollTop = event.currentTarget.scrollTop; overlayRef.current.scrollLeft = event.currentTarget.scrollLeft } }}
      />
    </div>
    {completion.suggestions.length > 0 && <div className="fx-suggestions" role="listbox" aria-label={t('Sugestões', 'Suggestions')}>
      {completion.suggestions.map((suggestion, index) => <button type="button" role="option" aria-selected={index === active} key={`${suggestion.kind}:${suggestion.label}`} className={`fx-suggestion${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); accept(suggestion) }}>
        <span className={`fx-badge fx-badge--${suggestion.kind}`}>{suggestion.kind === 'function' ? 'ƒ' : suggestion.kind === 'property' ? 'P' : 'K'}</span>
        <span className="fx-suggestion-label">{suggestion.label}</span>
        <span className="fx-suggestion-detail">{suggestion.kind === 'property' ? t('Propriedade', 'Property') : suggestion.detail}</span>
      </button>)}
    </div>}
    {doc && <div className="fx-doc" role="note">
      <code>{doc.signature}</code>
      <span>{locale === 'en-US' ? doc.en : doc.pt}</span>
      <span className="fx-doc-example">{t('Exemplo', 'Example')}: <code>{doc.example}</code>{doc.result !== undefined && <> → <code>{doc.result}</code></>}</span>
    </div>}
    <div id={`formula-status-${property.id}`} className={`fx-status${error ? ' fx-status--error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <>
        <strong>{error.at !== undefined ? t('Erro na posição {at}', 'Error at position {at}', { at: error.at + 1 }) : t('Erro', 'Error')}:</strong> {error.message}
      </> : preview ? <>
        <span className="fx-status-label">{sample ? t('Resultado em “{row}”', 'Result for “{row}”', { row: sample.title || t('Sem título', 'Untitled') }) : t('Resultado', 'Result')}:</span> <strong className="fx-result">{previewText(preview.value, locale)}</strong>
      </> : <span className="fx-status-label">{t('Digite uma fórmula. Use nomes de propriedades, funções e current/index em listas.', 'Type a formula. Use property names, functions and current/index in lists.')}</span>}
    </div>
    {rows.length > 1 && <label className="fx-row-pick">{t('Pré-visualizar com', 'Preview with')}
      <Select className="dbv-input" value={sample?.id ?? ''} onChange={(event) => setRowId(event.target.value)}>{rows.map((row) => <option key={row.id} value={row.id}>{row.title || t('Sem título', 'Untitled')}</option>)}</Select>
    </label>}
    <div className="fx-browse">
      <div className="fx-browse-tabs" role="tablist" aria-label={t('Funções', 'Functions')}>
        {(Object.keys(FORMULA_CATEGORY_LABELS) as FormulaCategory[]).map((category) => <button type="button" role="tab" aria-selected={browse === category} key={category} className={browse === category ? 'is-active' : ''} onClick={() => setBrowse((current) => current === category ? null : category)}>{t(...FORMULA_CATEGORY_LABELS[category])}</button>)}
      </div>
      {browse && <div className="fx-browse-list">
        {browse === 'page' && names.map((name) => <button type="button" key={`p:${name}`} onClick={() => insertSnippet(/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `prop("${name}")`)} title={t('Inserir propriedade', 'Insert property')}><span className="fx-badge fx-badge--property">P</span>{name}</button>)}
        {FORMULA_FUNCTIONS.filter((item) => item.category === browse).map((item) => <button type="button" key={item.name} onClick={() => insertSnippet(`${item.name}(`)} title={locale === 'en-US' ? item.en : item.pt}><span className="fx-badge fx-badge--function">ƒ</span>{item.name}<small>{locale === 'en-US' ? item.en : item.pt}</small></button>)}
      </div>}
    </div>
  </div>
}
