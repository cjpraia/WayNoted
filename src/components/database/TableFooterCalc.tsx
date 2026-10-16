// Rodapé da tabela com cálculos de coluna estilo planilha: contagens, %, soma, média, mediana,
// mín/máx, intervalo, datas. Em visualizações agrupadas mostra o valor do grupo e o total geral.
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { actions, getState, selectors } from '../../store'
import type { DatabaseSchema, Page, Property, View } from '../../types'
import { applyView } from './lib'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep } from './ui/Popover'
import { calculateColumn, calculationsFor, CALC_LABELS, CALC_LABELS_EN, type Calculation } from './calculations'
import { getLocale, t } from '../../i18n'
import './TableFooterCalc.css'

const calcLabel = (calculation: Calculation) => t(CALC_LABELS[calculation], CALC_LABELS_EN[calculation])
const SECTIONS: { pt: string; en: string; kinds: Calculation[] }[] = [
  { pt: 'Contagem', en: 'Count', kinds: ['count', 'countValues', 'countUnique', 'empty', 'notEmpty'] },
  { pt: 'Porcentagem', en: 'Percent', kinds: ['percentEmpty', 'percentNotEmpty'] },
  { pt: 'Caixa de seleção', en: 'Checkbox', kinds: ['checked', 'unchecked', 'percentChecked', 'percentUnchecked'] },
  { pt: 'Números', en: 'Numbers', kinds: ['sum', 'average', 'median', 'min', 'max', 'range'] },
  { pt: 'Datas', en: 'Dates', kinds: ['earliest', 'latest', 'dateRange'] },
]

export function TableFooterCalc(props: {
  db: Page
  schema: DatabaseSchema
  view: View
  rows: Page[]
  visibleProps: Property[]
  widthOf: (property: Property) => number
  stickyLeft: (index: number) => number | undefined
  totalWidth: number
  schemaLocked: boolean
}) {
  const { db, schema, view, rows, visibleProps, schemaLocked } = props
  const [menu, setMenu] = useState<{ propId: string; el: Element } | null>(null)
  const pages = getState().pages
  const locale = getLocale()
  // Agrupada: cada grupo tem sua tabela; o total geral considera todas as linhas filtradas da visualização.
  const grouped = !!view.groupBy && !schema.linkedSourceId && !schema.sourceDatabaseIds?.length
  let allRows: Page[] | null = null
  const totals = () => (allRows ??= applyView(selectors.rows(db.id), schema, view))
  const menuProp = menu ? schema.properties.find((property) => property.id === menu.propId) : undefined
  const choose = (calculation: Calculation) => {
    if (!menu) return
    actions.updateView(db.id, view.id, { tableCalculations: { ...view.tableCalculations, [menu.propId]: calculation } })
    setMenu(null)
  }

  return <>
    <div className="tb-foot" style={{ width: props.totalWidth }}>
      {visibleProps.map((property, index) => {
        const calculation = view.tableCalculations?.[property.id] ?? 'none'
        const left = props.stickyLeft(index)
        const value = calculation === 'none' ? '' : calculateColumn(rows, property, pages, calculation, locale)
        const total = calculation !== 'none' && grouped ? calculateColumn(totals(), property, pages, calculation, locale) : null
        // Como no Export Bundle: sem cálculo a célula fica vazia e mostra "Calcular" só no hover da linha.
        return <button type="button" key={property.id} className={`tb-foot-cell${calculation === 'none' ? ' tb-foot-cell--empty' : ''}${left !== undefined ? ' tb-frozen-foot' : ''}`} style={{ width: props.widthOf(property), ...(left !== undefined ? { left } : {}) }} disabled={schemaLocked} onClick={(event) => setMenu({ propId: property.id, el: event.currentTarget })} title={`${t('Cálculo', 'Calculation')}: ${calcLabel(calculation)}${total !== null ? ` · ${t('Total geral', 'Grand total')}: ${total}` : ''}`}>
          {calculation === 'none'
            ? <span className="tb-foot-cta">{t('Calcular', 'Calculate')}<ChevronDown size={12} /></span>
            : <><span>{calcLabel(calculation)}</span><strong>{value}</strong>{total !== null && total !== value && <span className="tb-foot-total">/ {total}</span>}</>}
        </button>
      })}
    </div>
    {menu && menuProp && <DbPopover anchor={menu.el} onClose={() => setMenu(null)} label={t('Cálculo da coluna', 'Column calculation')}>
      <Menu width={240}>
        <MenuLabel>{menuProp.name}</MenuLabel>
        <MenuItem label={calcLabel('none')} checked={(view.tableCalculations?.[menuProp.id] ?? 'none') === 'none'} onClick={() => choose('none')} />
        {SECTIONS.map((section) => {
          const available = calculationsFor(menuProp)
          const kinds = section.kinds.filter((kind) => available.includes(kind))
          if (!kinds.length) return null
          return <div key={section.pt}>
            <MenuSep />
            <MenuLabel>{t(section.pt, section.en)}</MenuLabel>
            {kinds.map((kind) => <MenuItem key={kind} label={calcLabel(kind)} hint={<span className="tb-foot-preview">{calculateColumn(rows, menuProp, pages, kind, locale)}</span>} checked={(view.tableCalculations?.[menuProp.id] ?? 'none') === kind} onClick={() => choose(kind)} />)}
          </div>
        })}
      </Menu>
    </DbPopover>}
  </>
}
