// Popover de edição de uma relação, no estilo do Export Bundle: busca "Vincular ou criar uma página…"
// com o banco ou tipo alvo à direita, seção "N selecionadas" (− desvincula) e "Selecionar mais"
// (clique vincula); texto sem página correspondente oferece "Criar “texto”". ↑/↓/Enter, Esc.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, MoreHorizontal, Minus, Plus, Tag } from 'lucide-react'
import { actions, getState, useStore } from '../../../store'
import type { Page, Property, PropValue } from '../../../types'
import { createObject } from '../../../objecttypes/actions'
import { findType, readTypeProps } from '../../../objecttypes/model'
import { lockedAncestor } from '../../../security/pageLock'
import { DbPopover, Menu, MenuItem, MenuSep, type DbAnchor, type DbPlacement } from '../ui/Popover'
import type { EditorCloseReason } from './PropertyEditor'
import { isLivePage, isStringArray } from '../derived'
import { cellText, planRelationPicker, relationTargetObjects, relationTargetRows, toggleRelationValue } from '../relationPicker'
import { RelationPickerConfig } from '../RelatedRulesEditor'
import { PageIcon } from '../../page/PageIcon'
import { t } from '../../../i18n'

export { sortCandidates } from '../relationPicker'

/** Itens renderizados por vez em "Selecionar mais" (bancos grandes continuam leves). */
const PAGE_SIZE = 50

type Item =
  | { kind: 'selected'; page: Page }
  | { kind: 'more'; page: Page }
  | { kind: 'showMore'; remaining: number }
  | { kind: 'create'; title: string }

export function RelationEditor({ dbId, rowId, property, value, anchor, onChange, onClose }: {
  dbId?: string
  rowId?: string
  property: Property
  value: PropValue
  anchor: DbAnchor
  onChange: (value: PropValue) => void
  onClose: (reason: EditorCloseReason) => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [active, setActive] = useState(0)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [rules, setRules] = useState<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { pages: all, settings } = useStore()
  const targetTypeId = property.relationTypeId
  const targetType = findType(settings.objectTypes ?? [], targetTypeId)
  const source = targetTypeId && rowId ? all[rowId] : undefined
  // Resolved relation values omit deleted pages. Keep raw IDs so adding a link
  // or removing one visible entry does not drop other saved links.
  const sourceSchema = source?.parentId ? all[source.parentId]?.database : undefined
  const stored = source
    ? (sourceSchema?.properties.some((p) => p.id === property.id) ? source.props : readTypeProps(settings.objectTypes ?? [], source))?.[property.id] ?? null
    : value
  const selectedIds = isStringArray(stored) ? stored : []
  const target = targetTypeId ? undefined : property.relationDatabaseId
  const targetPage = target ? all[target] : undefined
  const schema = targetPage?.database
  const picker = targetTypeId ? undefined : property.relationPicker
  const shown = useMemo(() => (picker?.shownPropertyIds ?? []).map((id) => schema?.properties.find((p) => p.id === id)).filter((p): p is Property => !!p), [picker?.shownPropertyIds, schema])
  const rows = useMemo(() => targetType
    ? relationTargetObjects(all, settings.objectTypes ?? [], targetType.id).filter((page) => page.id !== rowId)
    : relationTargetRows(all, target), [all, settings.objectTypes, targetType, target, rowId])
  const targetAvailable = targetTypeId ? !!targetType : !!target
  const plan = useMemo(() => planRelationPicker({
    pages: all, rows, selectedIds, query, picker, showAll, shownProperties: shown, excludeLocked: !!targetTypeId,
  }), [all, rows, selectedIds.join('\u0000'), query, picker, showAll, shown, targetTypeId])
  const visibleMore = plan.more.slice(0, limit)
  const items: Item[] = [
    ...plan.selected.map((page) => ({ kind: 'selected' as const, page })),
    ...visibleMore.map((page) => ({ kind: 'more' as const, page })),
    ...(plan.more.length > limit ? [{ kind: 'showMore' as const, remaining: plan.more.length - limit }] : []),
    ...(plan.create && targetAvailable ? [{ kind: 'create' as const, title: plan.create }] : []),
  ]
  const current = Math.min(active, items.length - 1)

  useEffect(() => { setActive(0); setLimit(PAGE_SIZE) }, [query])
  useEffect(() => {
    // Rola só a lista (scrollIntoView também rolaria a tabela por trás do popover).
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    if (!list || !el) return
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 6
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 6
  }, [current])

  const locked = !!(dbId && all[dbId]?.locked)
  const canEditTypeRelation = () => {
    const { pages } = getState()
    return !rowId || (!pages[rowId]?.locked && isLivePage(rowId, pages) && !lockedAncestor(pages, rowId))
  }
  const changeValue = (ids: string[]) => {
    if (!targetTypeId || canEditTypeRelation()) onChange(ids)
  }
  const createPage = (title: string) => {
    try {
      let id: string
      if (targetTypeId) {
        if (!canEditTypeRelation()) return
        id = createObject(targetTypeId, {}, { title })
      } else if (target) id = actions.createRow(target, {}, { title })
      else return
      changeValue([...selectedIds, id])
      setQuery('')
    } catch (error) { actions.reportSaveError(error) }
  }
  const run = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'selected' || item.kind === 'more') changeValue(toggleRelationValue(selectedIds, item.page.id))
    else if (item.kind === 'showMore') setLimit((n) => n + PAGE_SIZE)
    else createPage(item.title)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (!items.length) return
      setActive((current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      run(items[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose('escape')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onClose(e.shiftKey ? 'shiftTab' : 'tab')
    }
  }
  // Como no Export Bundle, o popover cobre a célula (a busca ocupa o lugar dela); sem espaço abaixo,
  // abre acima da célula, sem sobrepô-la.
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : null
  const roomFromTop = rect ? window.innerHeight - rect.top - 16 : 480
  const placement: DbPlacement = !rect || roomFromTop >= 260 ? 'cover' : 'bottom-start'
  const maxHeight = placement === 'cover' ? Math.min(480, roomFromTop) : undefined
  const dbName = targetPage ? targetPage.title || t('Banco sem título', 'Untitled database') : ''
  const title = (page: Page) => page.title || t('Sem título', 'Untitled')
  const pageRow = (item: Extract<Item, { page: Page }>, index: number) => {
    const { page } = item
    const props = shown.map((p) => { const text = cellText(page, p, all); return text ? <span key={p.id} title={`${p.name}: ${text}`}>{p.name}: {text}</span> : null }).filter(Boolean)
    return <div key={item.kind + page.id} data-index={index} role="option" aria-selected={item.kind === 'selected'} className={`db-relpick-item${index === current ? ' is-active' : ''}`}
      onMouseMove={() => index !== current && setActive(index)} onClick={() => run(item)}>
      <span className="db-relpick-icon">{page.icon ? <PageIcon value={page.icon} /> : <PageIcon value={null} fallback={page.database ? 'database' : 'page'} style={{ width: 18, height: 18 }} />}</span>
      <span className="db-relpick-main">
        <span className="db-relpick-title">{title(page)}</span>
        {props.length > 0 && <span className="db-relpick-props">{props}</span>}
      </span>
      {item.kind === 'selected' && <button type="button" className="db-relpick-remove" aria-label={t('Desvincular {name}', 'Unlink {name}', { name: title(page) })} title={t('Desvincular', 'Unlink')} onClick={(e) => { e.stopPropagation(); run(item) }}><Minus size={14} /></button>}
    </div>
  }

  return (
    <DbPopover anchor={anchor} placement={placement} onClose={() => onClose('outside')} className="db-relpick-popover" label={t('Relacionar {name}', 'Relate {name}', { name: property.name })}>
      <div className="db-relpick" style={{ maxHeight }} onKeyDown={onKeyDown}>
        <div className="db-relpick-search">
          <input autoFocus aria-label={t('Vincular ou criar uma página', 'Link or create a page')} placeholder={t('Vincular ou criar uma página…', 'Link or create a page…')} value={query} onChange={(e) => setQuery(e.target.value)}
            role="combobox" aria-expanded="true" aria-controls="db-relpick-list" aria-activedescendant={undefined} />
          {targetType ? <span className="db-relpick-in"><span>{t('Tipo', 'Type')}</span><span className="db-relpick-db">{targetType.icon ? <PageIcon value={targetType.icon} /> : <Tag size={16} strokeWidth={1.6} />}<u>{targetType.name}</u></span></span>
            : targetPage && <span className="db-relpick-in"><span>{t('Em', 'In')}</span><span className="db-relpick-db">{targetPage.icon ? <PageIcon value={targetPage.icon} /> : <Database size={16} strokeWidth={1.6} />}<u>{dbName}</u></span></span>}
        </div>
        <div className="db-relpick-list" id="db-relpick-list" role="listbox" aria-multiselectable="true" ref={listRef}>
          {!targetAvailable && <div className="db-relpick-empty">{targetTypeId
            ? t('O tipo vinculado não está disponível. Escolha outro tipo ao editar o campo.', 'The related type is unavailable. Choose another type when editing the field.')
            : t('Escolha um banco de dados no menu da propriedade.', 'Choose a database in the property menu.')}</div>}
          {(targetAvailable || (targetTypeId && selectedIds.length > 0)) && <>
            {(plan.selectedCount > 0 || (!targetAvailable && selectedIds.length > 0)) && <div className="db-relpick-label">
              <span>{!plan.selectedCount ? t('Vínculos indisponíveis', 'Unavailable links') : plan.selectedCount === 1 ? t('1 selecionada', '1 selected') : t('{count} selecionadas', '{count} selected', { count: plan.selectedCount })}</span>
              <button type="button" className="db-relpick-more" aria-label={t('Opções da relação', 'Relation options')} aria-haspopup="menu" onClick={(e) => setMenu(menu ? null : e.currentTarget)}><MoreHorizontal size={16} /></button>
            </div>}
            {plan.selected.map((page, index) => pageRow({ kind: 'selected', page }, index))}
            {targetAvailable && (visibleMore.length > 0 || plan.selectedCount === 0) && <div className="db-relpick-label">
              <span>{plan.selectedCount > 0 ? t('Selecionar mais', 'Select more') : t('Selecionar uma página', 'Select a page')}</span>
              {plan.selectedCount === 0 && <button type="button" className="db-relpick-more" aria-label={t('Opções da relação', 'Relation options')} aria-haspopup="menu" onClick={(e) => setMenu(menu ? null : e.currentTarget)}><MoreHorizontal size={16} /></button>}
            </div>}
            {visibleMore.map((page, at) => pageRow({ kind: 'more', page }, plan.selected.length + at))}
            {items.map((item, index) => item.kind === 'showMore'
              ? <div key="show-more" data-index={index} role="option" aria-selected="false" className={`db-relpick-item db-relpick-action${index === current ? ' is-active' : ''}`} onMouseMove={() => index !== current && setActive(index)} onClick={() => run(item)}><span className="db-relpick-icon"><MoreHorizontal size={16} /></span><span>{t('Mostrar mais {count}', 'Show {count} more', { count: Math.min(PAGE_SIZE, item.remaining) })}<span className="db-relpick-dim"> · {t('{count} restantes', '{count} remaining', { count: item.remaining })}</span></span></div>
              : item.kind === 'create'
                ? <div key="create" data-index={index} role="option" aria-selected="false" className={`db-relpick-item db-relpick-action${index === current ? ' is-active' : ''}`} onMouseMove={() => index !== current && setActive(index)} onClick={() => run(item)}><span className="db-relpick-icon"><Plus size={16} /></span><span>{t('Criar', 'Create')} <span className="db-relpick-create">“{item.title}”</span></span></div>
                : null)}
            {targetAvailable && !items.length && <div className="db-relpick-empty">{query.trim() ? t('Nenhuma página encontrada.', 'No pages found.') : targetType
              ? t('Nenhuma página deste tipo. Digite um nome para criar.', 'No pages of this type. Enter a name to create one.')
              : t('Nenhuma página neste banco.', 'No pages in this database.')}</div>}
            {plan.hiddenByFilter > 0 && !showAll && <button type="button" className="db-relpick-hidden" onClick={() => setShowAll(true)}>{plan.hiddenByFilter === 1 ? t('1 oculta pelo filtro', '1 hidden by filter') : t('{count} ocultas pelo filtro', '{count} hidden by filter', { count: plan.hiddenByFilter })} · {t('Mostrar todas', 'Show all')}</button>}
          </>}
        </div>
      </div>
      {menu && <DbPopover anchor={menu} placement="bottom-end" onClose={() => setMenu(null)} label={t('Opções da relação', 'Relation options')}>
        <Menu width={240}>
          <MenuItem icon={<Minus size={16} />} label={t('Limpar todas', 'Clear all')} disabled={!selectedIds.length} onClick={() => { changeValue([]); setMenu(null) }} />
          {picker?.filters?.length ? <MenuItem label={t('Mostrar páginas fora do filtro', 'Show pages outside the filter')} checked={showAll} onClick={() => { setShowAll(!showAll); setMenu(null) }} /> : null}
          {dbId && target && <><MenuSep /><MenuItem label={t('Filtros e ordenação…', 'Filters and sorting…')} disabled={locked} onClick={(e) => { setRules(e.currentTarget.closest('.dbv-popover') as HTMLElement); setMenu(null) }} /></>}
        </Menu>
      </DbPopover>}
      {rules && dbId && <DbPopover anchor={rules} placement="right-start" onClose={() => setRules(null)} className="db-relpick-rules" label={t('Filtros e ordenação', 'Filters and sorting')}>
        <div className="db-property-config">
          <RelationPickerConfig property={property} onPatch={(patch) => actions.updateSchema(dbId, (s) => ({ ...s, properties: s.properties.map((p) => p.id === property.id ? { ...p, ...patch } : p) }))} />
        </div>
      </DbPopover>}
    </DbPopover>
  )
}
