// Prévia de mapeamento da importação de CSV: coluna → tipo inferido (editável), amostra de 5 linhas e problemas.
import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { CSV_COLUMN_TYPES, countIssues, type ColumnPlan, type CsvColumnType } from './csvInfer'
import './csvImport.css'
import { Button } from '../ui/Button'
import { Select } from '../ui/Select'

export interface CsvPreviewColumn {
  index: number
  header: string
  /** new = cria propriedade; existing = usa a propriedade de mesmo nome; title = vira o título da linha; meta = metadado do exportador. */
  role: 'new' | 'existing' | 'title' | 'meta'
  plan?: ColumnPlan
}

const LABELS: Record<CsvColumnType, [string, string]> = {
  text: ['Texto', 'Text'], number: ['Número', 'Number'], date: ['Data', 'Date'], select: ['Seleção', 'Select'], multiSelect: ['Multisseleção', 'Multi-select'],
  checkbox: ['Checkbox', 'Checkbox'], url: ['URL', 'URL'], email: ['E-mail', 'Email'], phone: ['Telefone', 'Phone'], ignore: ['Ignorar', 'Ignore'],
}
const FORMAT: Record<string, [string, string]> = { currency: ['moeda', 'currency'], percent: ['percentual', 'percent'] }

export function CsvImportPreview({ fileName, rowCount, columns, sample, busy, onType, onConfirm, onCancel }: {
  fileName: string; rowCount: number; columns: CsvPreviewColumn[]; sample: string[][]; busy: boolean
  onType: (index: number, type: CsvColumnType) => void; onConfirm: () => void; onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const plans = columns.flatMap((c) => c.plan ? [c.plan] : [])
  const issues = countIssues(plans)
  const ambiguous = plans.filter((p) => p.type === 'date' && p.ambiguousDate)
  const shown = columns.filter((c) => c.role !== 'meta')
  return <div className="csvp-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
    <div className="csvp" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('Prévia da importação de CSV', 'CSV import preview')} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel() }}>
      <header><h2>{t('Importar CSV', 'Import CSV')}</h2><span>{fileName} · {rowCount} {rowCount === 1 ? t('linha', 'row') : t('linhas', 'rows')}</span></header>
      <p className="csvp-hint">{t('Confira o tipo de cada coluna antes de importar. Valores que não cabem no tipo ficam vazios.', 'Check each column type before importing. Values that do not fit the type are left empty.')}</p>
      {ambiguous.length > 0 && <p className="csvp-warn" role="status">{t('Datas ambíguas em', 'Ambiguous dates in')} {ambiguous.map((p) => p.header).join(', ')}: {t('usando a ordem do idioma do app', 'using the app language order')} ({ambiguous[0].dateOrder === 'mdy' ? t('mês/dia/ano', 'month/day/year') : t('dia/mês/ano', 'day/month/year')}).</p>}
      <div className="csvp-scroll">
        <table>
          <thead><tr>{shown.map((c) => <th key={c.index}>
            <div className="csvp-name" title={c.header}>{c.header}</div>
            {c.role === 'new' && c.plan
              ? <Select aria-label={`${t('Tipo da propriedade', 'Property type')} ${c.header}`} value={c.plan.type} disabled={busy} onChange={(e) => onType(c.index, e.target.value as CsvColumnType)}>
                {CSV_COLUMN_TYPES.map((type) => <option key={type} value={type}>{t(...LABELS[type])}</option>)}
              </Select>
              : <span className="csvp-fixed">{c.role === 'title' ? t('Título', 'Title') : t('Propriedade existente', 'Existing property')}</span>}
            {c.plan?.type === 'number' && c.plan.numberFormat && c.plan.numberFormat !== 'number' && <small>{t(...FORMAT[c.plan.numberFormat])}</small>}
            {c.plan && c.plan.type !== 'ignore' && c.plan.problems > 0 && <small className="csvp-bad">{c.plan.problems} {c.plan.problems === 1 ? t('problema', 'issue') : t('problemas', 'issues')}</small>}
          </th>)}</tr></thead>
          <tbody>{sample.map((row, r) => <tr key={r}>{shown.map((c) => <td key={c.index} className={c.plan?.type === 'ignore' ? 'csvp-off' : undefined}>{row[c.index] ?? ''}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <footer>
        <span className={issues ? 'csvp-bad' : undefined} role="status">{issues ? `${issues} ${issues === 1 ? t('valor não corresponde ao tipo', 'value does not match its type') : t('valores não correspondem ao tipo', 'values do not match their type')}` : t('Nenhum problema encontrado', 'No issues found')}</span>
        <Button disabled={busy} onClick={onCancel}>{t('Cancelar', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={onConfirm}>{busy ? t('Importando…', 'Importing…') : `${t('Importar', 'Import')} ${rowCount}`}</Button>
      </footer>
    </div>
  </div>
}
