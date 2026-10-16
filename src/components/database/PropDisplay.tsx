// Exibição somente leitura do valor de uma propriedade (chips, datas, checkbox…).
// Usado por todas as visualizações; os editores ficam em outro lugar.
import type { DateValue, Property, PropValue } from '../../types'
import { actions, getState } from '../../store'
import { isLivePage, isStringArray } from './derived'
import { DerivedDisplay } from './DerivedDisplay'
import { isFileArray } from './derived'
import { formatPropertyNumber, progressValue } from './formatting'
import { getLocale, t } from '../../i18n'
import { findOption, formatDateValue, isDateValue, isEmptyValue } from './lib'
import { isRichTextValue, safeRichHref } from './richText'
import { OptionChip } from './OptionChip'
import { PageIcon } from '../page/PageIcon'
import { recurrenceLabel } from './formatting'
import './db-tokens.css'

export { OptionChip }

export function PropDisplay({ property, value, rowId }: { property: Property; value: PropValue; rowId?: string }) {
  if (property.type === 'button') return <button type="button" className="db-action-button" disabled={!rowId || !property.buttonActions?.length || !!(rowId && getState().pages[rowId]?.locked)} onClick={(e) => { e.stopPropagation(); if (rowId && property.buttonActions?.length) void actions.runDatabaseActions(rowId, property.buttonActions) }}>{property.name || t('Executar', 'Run')}</button>
  if (property.type === 'formula' || property.type === 'rollup') return <DerivedDisplay property={property} value={value} rowId={rowId} />
  if (property.type === 'checkbox') {
    return <span className={`db-check${value === true ? ' db-check-on' : ''}`} role="img" aria-label={value === true ? t('Marcado', 'Checked') : t('Desmarcado', 'Unchecked')} />
  }
  if (isEmptyValue(value)) return null
  if (property.display === 'icon') return typeof value === 'string' ? <span className="db-icon-value"><PageIcon value={value} style={{ width: 18, height: 18 }} /></span> : null

  switch (property.type) {
    case 'text':
      return isRichTextValue(value) ? <span className="db-text db-rich-value">{value.runs.map((run, index) => {
        const style = { fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecoration: [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean).join(' ') || undefined, fontFamily: run.code ? 'monospace' : undefined } as const
        const href = run.href && safeRichHref(run.href)
        return href ? <a key={index} style={style} href={href} onClick={(event) => event.stopPropagation()}>{run.text}</a> : <span key={index} style={style}>{run.text}</span>
      })}</span> : <span className="db-text">{String(value)}</span>
    case 'select':
    case 'status': {
      const option = findOption(property, value)
      return option ? <OptionChip name={option.name} color={option.color} custom={option.customColor} dot={property.type === 'status'} /> : null
    }
    case 'multiSelect':
      return (
        <span className="db-chips">
          {(isStringArray(value) ? value : []).map((id) => {
            const option = findOption(property, id)
            return option ? <OptionChip key={id} name={option.name} color={option.color} custom={option.customColor} icon={option.icon} /> : null
          })}
        </span>
      )
    case 'date':
      return isDateValue(value) ? <span className="db-text">{formatDateValue(value, property)}<RecurrenceMark value={value} /></span> : null
    case 'number':
      return <span className="db-text db-number">{typeof value === 'number' ? <>{property.numberFormat === 'progress' && <span className="db-progress-track"><span style={{ width: `${progressValue(value)}%` }} /></span>}{formatPropertyNumber(value, property, getLocale())}</> : String(value)}</span>
    case 'createdTime':
    case 'updatedTime':
      return <span className="db-text">{typeof value === 'number' ? new Date(value).toLocaleString(getLocale()) : ''}</span>
    case 'relation':
      return <span className="db-relation-values">{(isStringArray(value) ? value : []).map((id) => {
        const page = getState().pages[id]
        return page && isLivePage(id, getState().pages) ? <button key={id} type="button" className="db-relation-link" title={page.title || t('Sem título', 'Untitled')} onClick={(e) => { e.stopPropagation(); actions.openPeek(id) }}>
          <span className="db-relation-icon" aria-hidden="true">{page.icon ? <PageIcon value={page.icon} /> : <PageIcon value={null} fallback={page.database ? 'database' : 'page'} style={{ width: 16, height: 16 }} />}</span>
          <span className="db-relation-title">{page.title || t('Sem título', 'Untitled')}</span>
        </button> : null
      })}</span>
    case 'createdBy':
    case 'updatedBy':
    case 'person':
    case 'uniqueId':
      return <span className="db-text">{String(value)}</span>
    case 'place':
      return value !== null && typeof value === 'object' && !Array.isArray(value) && 'lat' in value ? <span className="db-text db-place" title={`${value.lat}, ${value.lng}`}><PlacePin />{value.label}</span> : null
    case 'files':
      return isFileArray(value) ? <span className="db-file-values">{value.map((file) => /^data:[^,]+;base64,/.test(file.data) ? <a key={file.id} href={file.data} download={file.name} onClick={(e) => e.stopPropagation()}>{file.name}</a> : <span key={file.id}>{file.name}</span>)}</span> : null
    case 'url':
      return <span className="db-text db-url">{String(value)}</span>
    case 'email':
      return <a className="db-text db-url" href={`mailto:${String(value)}`} onClick={(e) => e.stopPropagation()}>{String(value)}</a>
    case 'phone':
      return <a className="db-text db-url" href={`tel:${String(value)}`} onClick={(e) => e.stopPropagation()}>{String(value)}</a>
    default:
      return <span className="db-text">{String(value)}</span>
  }
}

/** ↻ ao lado de datas recorrentes; o resumo ("Toda segunda e quarta") fica no título/leitor de tela. */
function RecurrenceMark({ value }: { value: DateValue }) {
  const label = recurrenceLabel(value, getLocale())
  return label ? <span className="db-recur-mark" title={label} aria-label={label}>↻</span> : null
}

/** Alfinete de lugar em traço fino, cinza (mesmo estilo dos ícones de propriedade). */
function PlacePin() {
  return (
    <svg className="db-place-pin" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 14.5s-4.5-4.1-4.5-7.6a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.6-4.5 7.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="6.9" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
