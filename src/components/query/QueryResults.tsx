// Resultado de uma consulta: reaproveita as visualizações dos bancos (tabela virtualizada, lista,
// galeria, quadro) sobre o "banco virtual", ou mostra a contagem/resumo.
import { useMemo, useState, type ReactNode } from 'react'
import type { Page, ViewType } from '../../types'
import type { ViewProps } from '../database/lib'
import { TableView } from '../database/TableView'
import { ListView } from '../database/views/ListView'
import { GalleryView } from '../database/views/GalleryView'
import { BoardView } from '../database/views/BoardView'
import { translate } from '../../localization.ts'
import { buildVirtualDb } from '../../query/virtualDb.ts'
import { fieldValue, type QueryResult } from '../../query/engine.ts'
import { valueText } from '../database/filterEngine.ts'
import type { Query } from '../../query/model.ts'
import { fieldLabel } from './catalog.ts'
import { registeredTypes } from '../../objecttypes/registry.ts'
import { PAGE_TYPE_FIELD } from '../../query/typeField.ts'
import { TypeChip } from './QueryBuilder'

type Locale = 'pt-BR' | 'en-US'
const VIEWS: Partial<Record<ViewType, (props: ViewProps) => ReactNode>> = { table: TableView, list: ListView, gallery: GalleryView, board: BoardView }
const PAGE_SIZE: Record<string, number> = { table: 2000, list: 100, gallery: 60, board: 400 }

export interface QueryResultsProps { query: Query; result: QueryResult; pages: Record<string, Page>; blockId: string; locale: Locale; canEdit: boolean; onOpenRow: (id: string, rowIds: string[]) => void }

export function QueryResults({ query, result, pages, blockId, locale, canEdit, onOpenRow }: QueryResultsProps) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const [pagesShown, setPagesShown] = useState(1)
  const types = registeredTypes()
  const vdb = useMemo(() => query.display === 'count' ? null : buildVirtualDb(query, result, pages, blockId, { title: t('Consulta', 'Query'), locale, fieldName: (field) => fieldLabel(field, locale) }, canEdit, types),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, result, canEdit, locale, blockId, types, query.display === 'count' ? null : pages])
  if (query.display === 'count') return <QueryCount query={query} result={result} pages={pages} locale={locale} />
  if (!vdb) return null
  const Comp = VIEWS[vdb.view.type] ?? TableView
  const size = (PAGE_SIZE[vdb.view.type] ?? 200) * pagesShown
  const ids = vdb.rows.map((row) => row.id)
  const open = (id: string) => onOpenRow(id, ids)
  const readOnly = !vdb.editable
  const props = (rows: Page[]): ViewProps => ({ db: vdb.db, schema: vdb.schema, view: vdb.view, rows, visibleProps: vdb.visibleProps, readOnly, schemaLocked: true, onOpenRow: open })
  const boardHandlesGroups = vdb.view.type === 'board' && !!vdb.view.groupBy
  let shown = 0
  const sliceRows = (rows: Page[]) => { const room = Math.max(0, size - shown); const out = rows.slice(0, room); shown += out.length; return out }
  const body = vdb.groups && !boardHandlesGroups
    ? vdb.groups.map((group) => { const rows = sliceRows(group.rows); return rows.length ? <section key={group.key} className="qr-group" data-qr="group">
        <header className="qr-group-head" data-qr="group-head">{group.typeId && types.find((type) => type.id === group.typeId) ? <TypeChip type={types.find((type) => type.id === group.typeId)!} /> : <span>{group.label || (query.groupBy === PAGE_TYPE_FIELD ? t('Sem tipo', 'No type') : t('Sem {name}', 'No {name}', { name: fieldLabel(query.groupBy ?? '', locale) }))}</span>}<small>{group.rows.length.toLocaleString(locale)}</small></header>
        <Comp {...props(rows)} />
      </section> : null })
    : <Comp {...props(sliceRows(vdb.rows))} />
  const hidden = vdb.rows.length - shown
  return <div className={`qr qr--${vdb.view.type}`} data-qr="results">
    {body}
    {hidden > 0 && <button type="button" className="qr-more" onClick={() => setPagesShown((n) => n + 1)}>{t('Mostrar mais ({n} restantes)', 'Show more ({n} remaining)', { n: hidden })}</button>}
  </div>
}

function QueryCount({ query, result, pages, locale }: { query: Query; result: QueryResult; pages: Record<string, Page>; locale: Locale }) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const groups = result.groups ?? (query.source.kind === 'databases' || query.source.kind === 'pages' || query.source.kind === 'tasks' ? breakdown(result, pages, locale, query) : null)
  const max = Math.max(1, ...(groups ?? []).map((group) => group.rows.length))
  const total = result.total
  // Somas de colunas numéricas (quando a consulta escolhe colunas).
  const sums = (query.columns ?? []).flatMap((field) => {
    let sum = 0, count = 0
    for (const row of result.rows) { const { value } = fieldValue(row, field, pages, registeredTypes()); if (typeof value === 'number') { sum += value; count++ } }
    return count ? [{ field, sum, average: sum / count }] : []
  })
  return <div className="qr-count" data-qr="count">
    <div className="qr-count-total"><strong>{total.toLocaleString(locale)}</strong><span>{query.source.kind === 'tasks' ? t('tarefas', 'tasks') : total === 1 ? t('resultado', 'result') : t('resultados', 'results')}</span></div>
    {sums.map((item) => <div key={item.field} className="qr-count-sum"><span>{fieldLabel(item.field, locale)}</span><strong>Σ {item.sum.toLocaleString(locale, { maximumFractionDigits: 2 })}</strong><small>{t('média', 'avg')} {item.average.toLocaleString(locale, { maximumFractionDigits: 2 })}</small></div>)}
    {groups && groups.length > 0 && <ul className="qr-bars">{groups.slice(0, 24).map((group) => <li key={group.key}>
      <span className="qr-bar-label" title={group.label}>{group.label || (query.groupBy === PAGE_TYPE_FIELD ? t('Sem tipo', 'No type') : t('(vazio)', '(empty)'))}</span>
      <span className="qr-bar-track"><span className="qr-bar-fill" style={{ width: `${Math.max(2, (group.rows.length / max) * 100)}%` }} /></span>
      <span className="qr-bar-value">{group.rows.length.toLocaleString(locale)}</span>
    </li>)}</ul>}
  </div>
}

/** Sem agrupamento explícito, a contagem mostra a distribuição por banco/origem. */
function breakdown(result: QueryResult, pages: Record<string, Page>, locale: Locale, query: Query) {
  const field = query.source.kind === 'tasks' ? '@source' : '@database'
  const map = new Map<string, { key: string; label: string; rows: Page[] }>()
  for (const row of result.rows) {
    const { value, prop } = fieldValue(row, field, pages)
    const label = valueText(value, prop, pages, locale) || translate(locale, 'Páginas', 'Pages')
    let group = map.get(label)
    if (!group) map.set(label, (group = { key: label, label, rows: [] }))
    group.rows.push(row)
  }
  return map.size > 1 || query.source.kind !== 'pages' ? [...map.values()].sort((a, b) => b.rows.length - a.rows.length) : null
}
