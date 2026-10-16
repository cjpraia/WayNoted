// Exibição de fórmulas e rollups: texto estilizado por style(), datas no formato local,
// porcentagens, caixas de seleção e erros (incluindo ciclos) da própria linha.
import type { CSSProperties } from 'react'
import type { Property, PropValue } from '../../types'
import { getLocale, t } from '../../i18n'
import { derivedErrorFor, isStringArray } from './derived'
import { formulaSyntaxError, setFormulaLocale, STYLE_COLORS } from './formula'
import { PERCENT_AGGREGATIONS } from './aggregations'
import { formatDateValueText } from './formatting'
import { isRichTextValue, safeRichHref } from './richText'
import { Icon } from '../ui/icons'
import './db-tokens.css'

const palette = new Set<string>(STYLE_COLORS)
function runStyle(run: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; color?: string; background?: string }): CSSProperties {
  return {
    fontWeight: run.bold ? 600 : undefined,
    fontStyle: run.italic ? 'italic' : undefined,
    textDecoration: [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    fontFamily: run.code ? 'var(--font-mono, monospace)' : undefined,
    color: run.color ? palette.has(run.color) ? `var(--fx-${run.color})` : run.color : undefined,
    background: run.background ? palette.has(run.background) ? `var(--opt-${run.background}-bg)` : `color-mix(in srgb, ${run.background} 30%, transparent)` : undefined,
  }
}

export function DerivedDisplay({ property, value, rowId }: { property: Property; value: PropValue; rowId?: string }) {
  const locale = getLocale()
  setFormulaLocale(locale)
  const error = property.type === 'formula' && property.formula
    ? formulaSyntaxError(property.formula, locale)?.message ?? (rowId ? derivedErrorFor(rowId, property.id, locale) : null)
    : rowId ? derivedErrorFor(rowId, property.id, locale) : null
  if (error) return <span className="db-formula-error" title={error}><Icon name="alert" size={14} /> {error}</span>
  if (value === null || value === '' || Array.isArray(value) && value.length === 0) return null
  if (typeof value === 'boolean') return <span className={`db-check${value ? ' db-check-on' : ''}`} role="img" aria-label={value ? t('Verdadeiro', 'True') : t('Falso', 'False')} />
  if (typeof value === 'number') {
    const percent = property.type === 'rollup' && property.rollup && PERCENT_AGGREGATIONS.has(property.rollup.aggregation)
    const text = percent ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
      : property.type === 'rollup' && property.rollup?.aggregation === 'dateRange' ? `${value.toLocaleString(locale)} ${value === 1 ? t('dia', 'day') : t('dias', 'days')}`
      : value.toLocaleString(locale, { maximumFractionDigits: 8 })
    return <span className="db-text db-number">{text}</span>
  }
  if (isRichTextValue(value)) {
    return <span className="db-text db-formula-value">{value.runs.map((run, index) => {
      const style = runStyle(run)
      const href = run.href && safeRichHref(run.href)
      const className = run.background ? 'db-formula-run--bg' : undefined
      return href ? <a key={index} className={className} style={style} href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{run.text}</a> : <span key={index} className={className} style={style}>{run.text}</span>
    })}</span>
  }
  if (typeof value === 'object' && !Array.isArray(value) && 'start' in value) return <span className="db-text">{formatDateValueText(value, locale)}</span>
  if (isStringArray(value)) return <span className="db-text" title={value.join(', ')}>{value.join(', ')}</span>
  return <span className="db-text">{String(value)}</span>
}
