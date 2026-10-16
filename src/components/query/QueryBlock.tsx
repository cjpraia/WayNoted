// Bloco "/Consulta": lista páginas/linhas do espaço por critérios e se atualiza sozinho.
// Props do bloco: `query` (JSON do modelo — fonte da verdade) e `text` (forma textual, para busca,
// exportação e leitura). Funciona em qualquer página, dentro de toggles, colunas e destaques.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { AlertTriangle, Check, Code2, Database, Loader2, SlidersHorizontal } from 'lucide-react'
import { actions, getState, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { flushDoc } from '../page/util'
import { parseQueryJson, defaultQuery, type Query } from '../../query/model'
import { parseQueryText, serializeQuery, type TextContext } from '../../query/text'
import { queryBlockProps, queryTemplate } from '../../query/templates'
import { useQueryResult, queryEnv, estimateCandidates, SLICE_THRESHOLD } from '../../query/live'
import { toggleTypeFacet, typeFacets } from '../../query/facets'
import type { ObjectType } from '../../objecttypes/model'
import { runQuery, taskForRow, type QueryIssue } from '../../query/engine'
import { queryToLinkedView } from '../../query/convert'
import { buildVirtualDb, singleDatabase } from '../../query/virtualDb'
import { QueryBuilder, TypeChip } from './QueryBuilder'
import { QueryTextEditor } from './QueryTextEditor'
import { QueryResults } from './QueryResults'
import { fieldCatalog, fieldLabel } from './catalog'
import '../database/dbview.css'
import './query.css'

const uiModes = new Map<string, 'builder' | 'text' | 'hidden'>()
const NO_TYPES: ObjectType[] = []
type Editor = { isEditable: boolean; updateBlock: (id: string, update: Record<string, unknown>) => void }
function countLabel(shown: number, total: number, locale: string, t: (pt: string, en: string, vars?: Record<string, string | number>) => string): string {
  const n = (value: number) => value.toLocaleString(locale)
  const noun = total === 1 ? t('resultado', 'result') : t('resultados', 'results')
  return shown === total ? `${n(total)} ${noun}` : t('{shown} de {total} {noun}', '{shown} of {total} {noun}', { shown: n(shown), total: n(total), noun })
}

/** Contexto de nomes do modo texto (bancos, páginas, propriedades e opções). */
export function textContextFor(query: Query, pages: Record<string, ReturnType<typeof getState>['pages'][string]>, locale: 'pt-BR' | 'en-US', types: readonly ObjectType[] = getState().settings.objectTypes ?? NO_TYPES): TextContext {
  const live = Object.values(pages).filter((page) => !page.trashed && !page.passwordLock)
  const catalog = fieldCatalog(query, pages, locale, types)
  return {
    locale,
    databases: live.filter((page) => page.database).map((page) => ({ id: page.id, title: page.title })),
    pages: live.filter((page) => !page.database && !(page.parentId && pages[page.parentId]?.database)).slice(0, 2000).map((page) => ({ id: page.id, title: page.title })),
    properties: catalog.filter((info) => !info.page).map((info) => info.field),
    options: Object.fromEntries(catalog.filter((info) => info.options.length && !info.page).map((info) => [info.field, info.options])),
    types: types.map((type) => ({ id: type.id, name: type.name })),
  }
}

function issueText(issue: QueryIssue, t: (pt: string, en: string, vars?: Record<string, string | number>) => string): string {
  switch (issue.kind) {
    case 'missingDatabase': return t('Um banco desta consulta foi excluído ou está na lixeira.', 'A database in this query was deleted or is in the trash.')
    case 'lockedDatabase': return t('Um banco desta consulta está numa página protegida por senha; ele foi ignorado.', 'A database in this query is inside a password-protected page; it was skipped.')
    case 'missingPage': return t('A página de origem não existe mais.', 'The source page no longer exists.')
    case 'missingType': return t('Um tipo desta consulta foi excluído.', 'A type in this query was deleted.')
    default: return t('A propriedade “{name}” não existe nos bancos da fonte.', 'Property “{name}” does not exist in the source databases.', { name: issue.detail })
  }
}

export function QueryBlockView({ blockId, json, text, editor }: { blockId: string; json: string; text?: string; editor: Editor }) {
  const state = useStore()
  const { t, locale } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const [pageId, setPageId] = useState<string | undefined>(undefined)
  useLayoutEffect(() => { setPageId(rootRef.current?.closest<HTMLElement>('.pg-root[data-page-id]')?.dataset.pageId) })
  // Importado de Markdown só com o texto (`<!-- np:query … -->`): interpreta o texto com os nomes do espaço.
  const fromText = useMemo(() => !json.trim() && text?.trim() ? parseQueryText(text, textContextFor(defaultQuery(), getState().pages, getState().settings.locale ?? 'pt-BR')).query : null, [json, text])
  const parsed = useMemo(() => parseQueryJson(json), [json])
  const query = parsed ?? fromText ?? (json.trim() ? null : queryTemplate('blank'))
  // Estado de interface por bloco: sobrevive a remontagens do editor (gravação, recarga do documento).
  const [mode, setModeState] = useState<'builder' | 'text' | 'hidden'>(() => uiModes.get(blockId) ?? (editor.isEditable ? 'builder' : 'hidden'))
  const setMode = (next: 'builder' | 'text' | 'hidden') => { uiModes.set(blockId, next); if (uiModes.size > 500) uiModes.delete(uiModes.keys().next().value!); setModeState(next) }
  const [notice, setNotice] = useState('')
  const editable = editor.isEditable && !(pageId && state.pages[pageId]?.locked)
  const live = useQueryResult(query, blockId, pageId)
  const pages = state.pages
  const types = state.settings.objectTypes ?? NO_TYPES
  const typeName = useCallback((id: string) => types.find((type) => type.id === id)?.name, [types])

  const update = useCallback((next: Query) => {
    if (!editor.isEditable) return
    const pagesNow = getState().pages
    editor.updateBlock(blockId, { props: queryBlockProps(next, { locale, databaseName: (id) => pagesNow[id]?.title, pageTitle: (id) => pagesNow[id]?.title, typeName }) })
  }, [editor, blockId, locale, typeName])

  const openRow = useCallback((id: string, rowIds: string[]) => {
    const result = live.result
    const synthetic = result?.rows.find((row) => row.id === id)
    const task = synthetic ? taskForRow(synthetic) : undefined
    if (task) { actions.openPage(task.pageId, task.blockId ? { blockId: task.blockId } : {}); return }
    if (!selectors.isLive(id)) return
    void (async () => {
      const current = getState().peekPageId
      if (current && current !== id) { await flushDoc(current); await actions.flushMeta() }
      actions.openPeek(id, 'side', rowIds.filter((rowId) => !rowId.startsWith('task:')))
    })().catch(actions.reportSaveError)
  }, [live.result])

  const convert = () => {
    if (!query || !pageId) return
    const result = queryToLinkedView(query, getState().pages, { thisPageId: pageId, viewName: t('Consulta', 'Query') })
    if (!result.ok) { setNotice(result.reason === 'source' ? t('Só consultas de um único banco viram visualização vinculada.', 'Only single-database queries can become a linked view.') : t('O campo “{name}” não existe no banco; ajuste a consulta antes.', 'Field “{name}” does not exist in the database; adjust the query first.', { name: fieldLabel(result.detail ?? '', locale) })); return }
    try {
      const childId = actions.createPage(pageId, { blockOwnerId: pageId, database: result.schema })
      editor.updateBlock(blockId, { type: 'page', props: { pageId: childId, ownership: 'owned', display: 'inline' } })
      void actions.flushMeta().catch(actions.reportSaveError)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)) }
  }

  if (!query) return <div className="qblock qblock--error" contentEditable={false} ref={rootRef} data-query-block="">
    <div className="qblock-issue" role="alert"><AlertTriangle size={14} /> {t('Esta consulta está corrompida e não pôde ser lida. O conteúdo original foi preservado.', 'This query is corrupted and could not be read. The original content was preserved.')}</div>
    {editable && <button type="button" className="qblock-btn" onClick={() => update(defaultQuery())}>{t('Recomeçar consulta', 'Start over')}</button>}
  </div>

  const result = live.result
  const serialize = { locale, databaseName: (id: string) => pages[id]?.title, pageTitle: (id: string) => pages[id]?.title, typeName }
  const convertible = query.source.kind === 'database' && query.source.databaseIds?.length === 1
  const canEditCells = editable && !!result && query.display !== 'count' && singleDatabase(query, result, pages) !== null && !!pages[singleDatabase(query, result, pages)!] && !pages[singleDatabase(query, result, pages)!].locked
  return <div className="qblock" contentEditable={false} ref={rootRef} data-query-block="">
    <div className="qblock-head">
      <span className="qblock-title"><SlidersHorizontal size={14} />{t('Consulta', 'Query')}</span>
      <span className="qblock-count" data-qr="count-label" aria-live="polite">{result ? countLabel(result.rows.length, result.total, locale, t) : ''}</span>
      {live.pending && <span className="qblock-pending" title={t('Atualizando…', 'Updating…')}><Loader2 size={14} className="qblock-spin" />{t('atualizando', 'updating')}</span>}
      {canEditCells && <span className="qblock-badge" title={t('As células editam o banco de origem', 'Cells edit the source database')}>{t('editável', 'editable')}</span>}
      <span className="qblock-spacer" />
      {editable && <button type="button" className={`qblock-btn${mode === 'builder' ? ' is-on' : ''}`} aria-pressed={mode === 'builder'} onClick={() => setMode(mode === 'builder' ? 'hidden' : 'builder')}><SlidersHorizontal size={14} />{t('Configurar', 'Configure')}</button>}
      <button type="button" className={`qblock-btn${mode === 'text' ? ' is-on' : ''}`} aria-pressed={mode === 'text'} onClick={() => setMode(mode === 'text' ? 'hidden' : 'text')}><Code2 size={14} />{t('Editar consulta', 'Edit query')}</button>
      {editable && <button type="button" className="qblock-btn" disabled={!convertible} title={convertible ? t('Converte numa visualização vinculada do banco', 'Converts into a linked view of the database') : t('Disponível para consultas de um único banco', 'Available for single-database queries')} onClick={convert}><Database size={14} />{t('Abrir como banco', 'Open as database')}</button>}
    </div>
    {(mode === 'builder' || mode === 'text') && <QueryBuilder query={query} pages={pages} locale={locale} types={types} readOnly={!editable} onChange={update} />}
    {editable && result && <TypeFacetBar query={query} result={result} blockId={blockId} pageId={pageId} types={types} locale={locale} onChange={update} />}
    {mode === 'text' && <QueryTextEditor id={`q-${blockId}`} query={query} context={textContextFor(query, pages, locale, types)} serialize={serialize} locale={locale} readOnly={!editable} onChange={update} />}
    {mode === 'hidden' && <button type="button" className="qblock-summary" onClick={() => setMode(editable ? 'builder' : 'text')} title={t('Mostrar a consulta', 'Show the query')}>{serializeQuery(query, serialize)}</button>}
    {notice && <div className="qblock-issue" role="status">{notice}</div>}
    {live.error && <div className="qblock-issue" role="alert"><AlertTriangle size={14} />{live.error}</div>}
    {result?.issues.map((issue, index) => <div key={index} className="qblock-issue" role="status"><AlertTriangle size={14} />{issueText(issue, t)}</div>)}
    {result && result.total === 0 && query.display !== 'count' && <div className="qblock-empty" data-qr="empty">
      <strong>{t('Nenhum resultado', 'No results')}</strong>
      <span>{query.filter.children.length ? t('Nenhuma página atende aos filtros. Ajuste ou remova algum filtro.', 'No page matches the filters. Adjust or remove a filter.') : query.source.kind === 'database' && !query.source.databaseIds?.length ? t('Escolha um banco de dados na fonte.', 'Choose a database as the source.') : t('A fonte escolhida ainda não tem páginas.', 'The chosen source has no pages yet.')}</span>
    </div>}
    {result && (result.total > 0 || query.display === 'count') && <QueryResults query={query} result={result} pages={pages} blockId={blockId} locale={locale} canEdit={editable} onOpenRow={openRow} />}
  </div>
}

/** Filtro rápido por tipo: chips com contagem; clicar marca/desmarca (vários = "qualquer um de"). */
function TypeFacetBar({ query, result, blockId, pageId, types, locale, onChange }: { query: Query; result: NonNullable<ReturnType<typeof useQueryResult>['result']>; blockId: string; pageId: string | undefined; types: readonly ObjectType[]; locale: 'pt-BR' | 'en-US'; onChange: (query: Query) => void }) {
  const { t } = useI18n()
  const data = useMemo(() => {
    try {
      const env = queryEnv(pageId, query)
      return typeFacets(query, result, env, types, { key: blockId, allowRun: estimateCandidates(env, query) <= SLICE_THRESHOLD })
    } catch { return null }
  }, [query, result, types, blockId, pageId])
  if (!data) return null
  const byId = new Map(types.map((type) => [type.id, type]))
  return <div className="qb-facets" role="group" aria-label={t('Filtrar por tipo', 'Filter by type')} data-qb="facets">
    <span className="qb-word">{t('Tipo', 'Type')}</span>
    {data.facets.map((facet) => {
      const type = facet.typeId ? byId.get(facet.typeId) : undefined
      const on = facet.typeId ? data.active.has(facet.typeId) : data.untypedActive
      return <button key={facet.typeId ?? '__none__'} type="button" className={`qb-facet${on ? ' is-on' : ''}`} aria-pressed={on} data-qb="facet" data-type-id={facet.typeId ?? ''}
        title={on ? t('Remover do filtro', 'Remove from filter') : t('Mostrar só estas páginas', 'Show only these pages')}
        onClick={() => onChange(toggleTypeFacet(query, facet.typeId, types))}>
        {on && <Check size={12} />}
        {type ? <TypeChip type={type} /> : <span className="qb-facet-none">{t('Sem tipo', 'No type')}</span>}
        <small>{facet.count.toLocaleString(locale)}</small>
      </button>
    })}
  </div>
}

/** HTML externo (copiar para outro app): texto da consulta + resultado atual como tabela. */
export function queryExternalHtml(json: string, text: string) {
  const query = parseQueryJson(json)
  let rows: string[][] = []
  let header: string[] = []
  if (query) {
    try {
      const state = getState()
      const result = runQuery(query, queryEnv(undefined, query))
      const locale = state.settings.locale ?? 'pt-BR'
      const vdb = buildVirtualDb(query, result, state.pages, 'external', { title: '', locale, fieldName: (field) => fieldLabel(field, locale) }, false)
      header = vdb.visibleProps.map((prop) => prop.name)
      rows = vdb.rows.slice(0, 200).map((row) => vdb.visibleProps.map((prop) => prop.type === 'title' ? row.title : String(row.props?.[prop.id] ?? '')))
    } catch { /* Sem resultado: só o texto. */ }
  }
  return <div data-np-query={json}>
    <p><code>{text}</code></p>
    {header.length > 0 && <table><thead><tr>{header.map((name, index) => <th key={index}>{name}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}</tbody></table>}
  </div>
}

export const QueryBlock = createReactBlockSpec(
  { type: 'query', propSchema: { query: { default: '' }, text: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => <QueryBlockView blockId={block.id} json={block.props.query} text={block.props.text} editor={editor as unknown as Editor} />,
    toExternalHTML: ({ block }) => queryExternalHtml(block.props.query, block.props.text),
    parse: (element) => {
      const json = element.getAttribute('data-np-query')
      if (json === null) return undefined
      const query = parseQueryJson(json)
      return query ? { query: json, text: element.querySelector('code')?.textContent ?? '' } : undefined
    },
  },
)

