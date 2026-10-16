// Construtor visual das consultas: "Mostrar [Tabela ⌄] de [fonte ⌄] onde [filtros…] ordenar por …
// agrupar por … limite … colunas …". Chips no padrão dos filtros dos bancos (dbv-pill) e popovers
// do banco (DbPopover). Não lê a store: recebe páginas e devolve a consulta alterada.
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Columns3, Database, FileText, Hash, History, Link2, ListChecks, Plus, Rows3, Shapes, Trash2, X } from 'lucide-react'
import type { FilterOp, Page } from '../../types'
import { translate } from '../../localization.ts'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep } from '../database/ui/Popover'
import { valueToQueryText } from '../../query/text.ts'
import { describeRange } from '../../query/engine.ts'
import type { ObjectType, TypeList } from '../../objecttypes/model.ts'
import { PAGE_TYPE_FIELD, resolveTypeRef, typeRuleRefs } from '../../query/typeField.ts'
import { OptionChip } from '../database/OptionChip'
import { addGroup, addRule, newNodeId, removeNode, updateNode, MAX_LIMIT, QUERY_DISPLAYS, SOURCE_KINDS, type Query, type QueryGroup, type QueryNode, type QueryRule, type QuerySourceKind, type QueryValue } from '../../query/model.ts'
import { DATE_PRESETS, DISPLAY_LABELS, SOURCE_LABELS, TYPE_OPS, fieldCatalog, fieldInfo, fieldLabel, opLabel, opsFor, typeOpLabel, type FieldInfo } from './catalog.ts'
import { Select } from '../ui/Select'

type Locale = 'pt-BR' | 'en-US'
type Anchor = { kind: string; id?: string; el: Element }
export interface QueryBuilderProps { query: Query; pages: Record<string, Page>; locale: Locale; readOnly: boolean; onChange: (query: Query) => void; types?: TypeList }

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
const live = (page: Page) => !page.trashed && !page.passwordLock
const SOURCE_ICONS: Record<QuerySourceKind, ReactNode> = { pages: <FileText size={16} />, database: <Database size={16} />, databases: <Database size={16} />, children: <Rows3 size={16} />, tag: <Hash size={16} />, modified: <History size={16} />, relatedToThis: <Link2 size={16} />, backlinks: <Link2 size={16} />, tasks: <ListChecks size={16} />, type: <Shapes size={16} /> }
const NO_TYPES: TypeList = []

/** Chip de um tipo (ícone, nome e cor) — o mesmo desenho da coluna "Tipo" dos resultados. */
export function TypeChip({ type }: { type: Pick<ObjectType, 'name' | 'color' | 'icon'> }) {
  return <OptionChip name={type.name || '—'} color={type.color} icon={type.icon ?? undefined} />
}

export function sourceSummary(query: Query, pages: Record<string, Page>, locale: Locale, types: TypeList = NO_TYPES): string {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const title = (id?: string) => !id || id === '@thisPage' ? t('esta página', 'this page') : pages[id]?.title || t('Sem título', 'Untitled')
  const s = query.source
  switch (s.kind) {
    case 'database': case 'databases': return (s.databaseIds ?? []).map((id) => pages[id]?.title || t('Banco ausente', 'Missing database')).join(', ') || t('escolha um banco', 'choose a database')
    case 'children': return `${s.deep ? t('descendentes de', 'descendants of') : t('filhas de', 'children of')} ${title(s.pageId)}`
    case 'tag': return s.tag ? `#${s.tag}` : t('escolha uma tag', 'choose a tag')
    case 'modified': return t('modificadas nos últimos {n} dias', 'modified in the last {n} days', { n: s.days ?? 7 })
    case 'relatedToThis': return t('linhas relacionadas a esta página', 'rows related to this page') + (s.databaseIds?.[0] ? ` · ${title(s.databaseIds[0])}` : '')
    case 'backlinks': return `${t('backlinks de', 'backlinks of')} ${title(s.pageId)}`
    case 'tasks': return s.includeDone ? t('tarefas (com concluídas)', 'tasks (including done)') : t('tarefas em aberto', 'open tasks')
    case 'type': return (s.typeIds ?? []).map((id) => types.find((type) => type.id === id)?.name ?? t('Tipo ausente', 'Missing type')).join(', ') || t('escolha um tipo', 'choose a type')
    default: return t('todas as páginas', 'all pages')
  }
}

function valueLabel(rule: QueryRule, info: FieldInfo, pages: Record<string, Page>, locale: Locale): string {
  if (rule.op === 'isEmpty' || rule.op === 'isNotEmpty') return ''
  if (rule.value === null || rule.value === '') return '…'
  if (typeof rule.value === 'string' && pages[rule.value]) return pages[rule.value].title
  if (typeof rule.value === 'string' && !rule.value.startsWith('@') && !/^\d{4}-\d{2}-\d{2}$/.test(rule.value)) return rule.value
  if (info.type === 'checkbox') return rule.value === true ? translate(locale, 'marcado', 'checked') : translate(locale, 'desmarcado', 'unchecked')
  return valueToQueryText(rule.value, locale)
}

export function QueryBuilder({ query, pages, locale, readOnly, onChange, types = NO_TYPES }: QueryBuilderProps) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const [pop, setPop] = useState<Anchor | null>(null)
  const catalog = useMemo(() => fieldCatalog(query, pages, locale, types), [query, pages, locale, types])
  const open = (kind: string, id?: string) => (event: React.MouseEvent<HTMLElement>) => { if (!readOnly) setPop({ kind, id, el: event.currentTarget }) }
  const close = () => setPop(null)
  const set = (patch: Partial<Query>) => onChange({ ...query, ...patch })
  const setFilter = (filter: QueryGroup) => set({ filter })
  // Com tipos no espaço, o primeiro filtro sugerido é "Tipo é …" (fora de fontes de banco/tarefas).
  const typeFirst = types.length > 0 && query.source.kind !== 'database' && query.source.kind !== 'databases' && query.source.kind !== 'tasks' && query.source.kind !== 'type'
  const newRule = (field = typeFirst ? PAGE_TYPE_FIELD : catalog.find((info) => !info.page)?.field ?? '@title'): QueryRule => { const info = fieldInfo(catalog, field, locale); return { kind: 'rule', id: newNodeId(), field, op: field === PAGE_TYPE_FIELD ? 'is' : opsFor(info.type)[0], value: info.type === 'checkbox' ? true : null } }

  const pill = (label: ReactNode, onClick: (event: React.MouseEvent<HTMLElement>) => void, options: { set?: boolean; title?: string; testid?: string; icon?: ReactNode } = {}) =>
    <button type="button" className={`dbv-pill qb-pill${options.set ? ' dbv-pill--set' : ''}`} disabled={readOnly} title={options.title} data-qb={options.testid} onClick={onClick}>{options.icon}<span className="dbv-pill-text">{label}</span>{!readOnly && <ChevronDown size={12} />}</button>

  const renderNode = (node: QueryNode, parent: QueryGroup | null, depth: number): ReactNode => {
    if (node.kind === 'rule') {
      const info = fieldInfo(catalog, node.field, locale)
      const missing = !info.page && !catalog.some((item) => item.field === info.field)
      const isType = node.field === PAGE_TYPE_FIELD
      const chosen = isType ? typeRuleRefs(node.value).map((ref) => types.find((type) => type.id === resolveTypeRef(types, ref))) : []
      return <span key={node.id} className={`qb-chip${missing ? ' qb-chip--missing' : ''}`} data-qb="rule" data-field={isType ? 'type' : undefined}>
        <button type="button" className="dbv-pill dbv-pill--set qb-pill" disabled={readOnly} onClick={open('rule', node.id)} title={missing ? t('Propriedade não encontrada nos bancos da fonte', 'Property not found in the source databases') : undefined}>
          {isType ? <span className="dbv-pill-text qb-type-rule"><b>{info.label}</b> {typeOpLabel(node.op, node.value, locale)} {node.op === 'isEmpty' || node.op === 'isNotEmpty' ? null : chosen.length ? chosen.map((type, index) => type ? <TypeChip key={type.id} type={type} /> : <span key={index} className="qb-missing-type">{t('tipo ausente', 'missing type')}</span>) : '…'}</span>
            : <span className="dbv-pill-text"><b>{info.label}</b> {opLabel(node.op, info.type, locale)} {valueLabel(node, info, pages, locale)}</span>}
        </button>
        {!readOnly && <button type="button" className="qb-chip-x" aria-label={t('Remover filtro', 'Remove filter')} onClick={() => setFilter(removeNode(query.filter, node.id))}><X size={12} /></button>}
      </span>
    }
    const items: ReactNode[] = []
    node.children.forEach((child, index) => {
      if (index) items.push(<button key={`op-${child.id}`} type="button" className="qb-connector" disabled={readOnly} title={t('Alternar E/OU', 'Toggle AND/OR')} onClick={() => setFilter(updateNode(query.filter, node.id, (group) => group.kind === 'group' ? { ...group, operator: group.operator === 'and' ? 'or' : 'and' } : group))}>{node.operator === 'and' ? t('e', 'and') : t('ou', 'or')}</button>)
      items.push(renderNode(child, node, depth + 1))
    })
    const adders = !readOnly && <>
      <button type="button" className="dbv-pill dbv-pill--add qb-pill" onClick={() => setFilter(addRule(query.filter, node.id, newRule()))} data-qb={depth ? 'add-in-group' : 'add-filter'}><Plus size={12} /><span>{depth ? '' : t('Filtro', 'Filter')}</span></button>
      {depth === 0 && <button type="button" className="dbv-pill dbv-pill--add qb-pill" onClick={() => setFilter(addGroup(query.filter, node.id, node.operator === 'and' ? 'or' : 'and'))} data-qb="add-group"><Plus size={12} /><span>{t('Grupo', 'Group')}</span></button>}
      {depth > 0 && <button type="button" className="qb-chip-x" aria-label={t('Remover grupo', 'Remove group')} onClick={() => setFilter(removeNode(query.filter, node.id))}><X size={12} /></button>}
    </>
    if (!parent) return <>{items}{adders}</>
    const negate = <button type="button" className={`qb-not${node.negate ? ' is-on' : ''}`} disabled={readOnly} aria-pressed={!!node.negate} title={node.negate ? t('Grupo negado: casa quando o conteúdo NÃO casa. Clique para desfazer.', 'Negated group: matches when its content does NOT match. Click to undo.') : t('Negar grupo (não …)', 'Negate group (not …)')} data-qb="negate" onClick={() => setFilter(updateNode(query.filter, node.id, (group) => { if (group.kind !== 'group') return group; const next = { ...group }; if (group.negate) delete next.negate; else next.negate = true; return next }))}>{t('não', 'not')}</button>
    if (readOnly && !node.negate) return <span key={node.id} className="qb-group" data-qb="group"><span className="qb-paren">(</span>{items.length ? items : <span className="qb-muted">{t('vazio', 'empty')}</span>}<span className="qb-paren">)</span></span>
    return <span key={node.id} className={`qb-group${node.negate ? ' qb-group--not' : ''}`} data-qb="group">{negate}<span className="qb-paren">(</span>{items.length ? items : <span className="qb-muted">{t('vazio', 'empty')}</span>}{adders}<span className="qb-paren">)</span></span>
  }

  const ruleNode = pop?.kind === 'rule' && pop.id ? findRule(query.filter, pop.id) : null
  const hasFilters = query.filter.children.length > 0

  return <div className="qb" role="group" aria-label={t('Construtor de consulta', 'Query builder')}>
    <span className="qb-word">{t('Mostrar', 'Show')}</span>
    {pill(t(...DISPLAY_LABELS[query.display]), open('display'), { set: true, testid: 'display' })}
    <span className="qb-word">{t('de', 'from')}</span>
    {pill(sourceSummary(query, pages, locale, types), open('source'), { set: true, testid: 'source', icon: SOURCE_ICONS[query.source.kind] })}
    <span className="qb-word">{hasFilters ? t('onde', 'where') : ''}</span>
    {renderNode(query.filter, null, 0)}
    {(query.sorts.length > 0 || !readOnly) && <span className="qb-word">{t('ordenar por', 'sort by')}</span>}
    {query.sorts.map((sort, index) => <span key={`${sort.field}-${index}`} className="qb-chip" data-qb="sort">
      <button type="button" className="dbv-pill dbv-pill--set qb-pill" disabled={readOnly} title={t('Inverter direção', 'Reverse direction')} onClick={() => set({ sorts: query.sorts.map((item, at) => at === index ? { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' } : item) })}>
        {sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}<span className="dbv-pill-text">{fieldInfo(catalog, sort.field, locale).label}</span>
      </button>
      {!readOnly && <button type="button" className="qb-chip-x" aria-label={t('Remover ordenação', 'Remove sort')} onClick={() => set({ sorts: query.sorts.filter((_, at) => at !== index) })}><X size={12} /></button>}
    </span>)}
    {!readOnly && query.sorts.length < 8 && <button type="button" className="dbv-pill dbv-pill--add qb-pill" onClick={open('sort')} data-qb="add-sort"><Plus size={12} />{!query.sorts.length && <span>{t('campo', 'field')}</span>}</button>}
    {(query.groupBy || !readOnly) && <><span className="qb-word">{t('agrupar por', 'group by')}</span>{pill(query.groupBy ? fieldInfo(catalog, query.groupBy, locale).label : '—', open('group'), { set: !!query.groupBy, testid: 'group' })}</>}
    {(query.limit || !readOnly) && <><span className="qb-word">{t('limite', 'limit')}</span>{pill(query.limit ? String(query.limit) : '—', open('limit'), { set: !!query.limit, testid: 'limit' })}</>}
    {query.display !== 'count' && pill(query.columns?.length ? t('{n} colunas', '{n} columns', { n: query.columns.length }) : t('Colunas', 'Columns'), open('columns'), { set: !!query.columns?.length, testid: 'columns', icon: <Columns3 size={14} /> })}

    {pop?.kind === 'display' && <DbPopover anchor={pop.el} onClose={close} label={t('Exibir como', 'Display as')}><Menu width={200}>
      {QUERY_DISPLAYS.map((display) => <MenuItem key={display} label={t(...DISPLAY_LABELS[display])} checked={query.display === display} onClick={() => { set({ display }); close() }} />)}
    </Menu></DbPopover>}
    {pop?.kind === 'source' && <SourceEditor query={query} pages={pages} locale={locale} types={types} anchor={pop.el} onClose={close} onChange={(source) => set({ source })} />}
    {ruleNode && <RuleEditor rule={ruleNode} catalog={catalog} pages={pages} locale={locale} types={types} anchor={pop!.el} onClose={close} onChange={(next) => setFilter(updateNode(query.filter, ruleNode.id, () => next))} onRemove={() => { setFilter(removeNode(query.filter, ruleNode.id)); close() }} />}
    {pop?.kind === 'sort' && <FieldPicker catalog={catalog} types={types} locale={locale} anchor={pop.el} onClose={close} onPick={(field) => { set({ sorts: [...query.sorts, { field, direction: 'asc' }] }); close() }} />}
    {pop?.kind === 'group' && <FieldPicker catalog={catalog} types={types} locale={locale} anchor={pop.el} onClose={close} allowNone={!!query.groupBy} onPick={(field) => { const next = { ...query }; if (field) next.groupBy = field; else delete next.groupBy; onChange(next); close() }} />}
    {pop?.kind === 'limit' && <DbPopover anchor={pop.el} onClose={close} label={t('Limite', 'Limit')}><div className="qb-pop qb-pop--narrow">
      <label className="qb-label">{t('Mostrar no máximo', 'Show at most')}<input className="dbv-input" type="number" min={1} max={MAX_LIMIT} autoFocus defaultValue={query.limit ?? ''} placeholder={t('sem limite', 'no limit')} onChange={(event) => { const n = Math.floor(Number(event.target.value)); const next = { ...query }; if (n > 0) next.limit = Math.min(MAX_LIMIT, n); else delete next.limit; onChange(next) }} onKeyDown={(event) => { if (event.key === 'Enter') close() }} /></label>
      <div className="qb-presets">{[10, 20, 50, 100].map((n) => <button type="button" key={n} className="qb-preset" onClick={() => { set({ limit: n }); close() }}>{n}</button>)}<button type="button" className="qb-preset" onClick={() => { const next = { ...query }; delete next.limit; onChange(next); close() }}>{t('Sem limite', 'No limit')}</button></div>
    </div></DbPopover>}
    {pop?.kind === 'columns' && <DbPopover anchor={pop.el} onClose={close} label={t('Colunas', 'Columns')}><Menu width={260}>
      <MenuItem label={t('Automático (padrão da fonte)', 'Automatic (source default)')} checked={!query.columns?.length} onClick={() => { const next = { ...query }; delete next.columns; onChange(next) }} />
      <MenuSep />
      <div className="qb-scroll">{fieldSections(catalog, types, locale).map((section) => <div key={section.key}><MenuLabel>{section.label}</MenuLabel>{section.items.map((info) => { const on = !!query.columns?.includes(info.field); return <MenuItem key={`${section.key}:${info.field}`} label={info.label} hint={on ? String(query.columns!.indexOf(info.field) + 1) : undefined} checked={on} onClick={() => { const current = query.columns?.length ? query.columns : ['@title']; const next = on ? current.filter((field) => field !== info.field) : [...current, info.field]; const out = { ...query }; if (next.length) out.columns = next; else delete out.columns; onChange(out) }} /> })}</div>)}</div>
    </Menu></DbPopover>}
  </div>
}

function findRule(node: QueryNode, id: string, depth = 0): QueryRule | null {
  if (depth > 8) return null
  if (node.kind === 'rule') return node.id === id ? node : null
  for (const child of node.children) { const hit = findRule(child, id, depth + 1); if (hit) return hit }
  return null
}

/** Seções do catálogo: página · campos de cada tipo escolhido · propriedades dos bancos · campos dos demais tipos. */
export function fieldSections(catalog: FieldInfo[], types: TypeList, locale: Locale): { key: string; label: string; items: FieldInfo[] }[] {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const out: { key: string; label: string; items: FieldInfo[] }[] = [{ key: 'page', label: t('Campos da página', 'Page fields'), items: catalog.filter((info) => info.page) }]
  const selected = [...new Set(catalog.filter((info) => info.selected && info.typeId).map((info) => info.typeId!))]
  for (const typeId of selected) out.push({ key: `type:${typeId}`, label: t('Campos de {name}', '{name} fields', { name: types.find((type) => type.id === typeId)?.name ?? '' }), items: catalog.filter((info) => info.selected && info.typeId === typeId) })
  out.push({ key: 'props', label: t('Propriedades', 'Properties'), items: catalog.filter((info) => !info.page && !info.typeId) })
  out.push({ key: 'types', label: t('Campos de tipos', 'Type fields'), items: catalog.filter((info) => !info.selected && info.typeId) })
  return out.filter((section) => section.items.length)
}

function FieldPicker({ catalog, types, locale, anchor, onClose, onPick, allowNone }: { catalog: FieldInfo[]; types: TypeList; locale: Locale; anchor: Element; onClose: () => void; onPick: (field: string) => void; allowNone?: boolean }) {
  const [search, setSearch] = useState('')
  const t = (pt: string, en: string) => translate(locale, pt, en)
  const shown = catalog.filter((info) => fold(info.label).includes(fold(search.trim())))
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Escolher campo', 'Choose field')}><Menu width={260}>
    <div className="qb-search"><input className="dbv-input" autoFocus placeholder={t('Buscar campo…', 'Search field…')} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && shown[0]) onPick(shown[0].field) }} /></div>
    {allowNone && <MenuItem label={t('Nenhum', 'None')} onClick={() => onPick('')} />}
    <div className="qb-scroll">
      {fieldSections(shown, types, locale).map((section) => <div key={section.key} data-qb-section={section.key}>
        <MenuLabel>{section.label}</MenuLabel>
        {section.items.map((info) => <MenuItem key={`${section.key}:${info.field}`} label={info.label} icon={info.field === PAGE_TYPE_FIELD ? <Shapes size={16} /> : undefined} onClick={() => onPick(info.field)} />)}
      </div>)}
    </div>
  </Menu></DbPopover>
}

function RuleEditor({ rule, catalog, pages, locale, types, anchor, onClose, onChange, onRemove }: { rule: QueryRule; catalog: FieldInfo[]; pages: Record<string, Page>; locale: Locale; types: TypeList; anchor: Element; onClose: () => void; onChange: (rule: QueryRule) => void; onRemove: () => void }) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const info = fieldInfo(catalog, rule.field, locale)
  const isType = rule.field === PAGE_TYPE_FIELD
  const ops = isType ? TYPE_OPS : opsFor(info.type)
  const op = rule.op
  const setValue = (value: QueryValue) => onChange({ ...rule, value })
  const dateLike = info.type === 'date' || info.type === 'createdTime' || info.type === 'updatedTime'
  const offset = typeof rule.value === 'string' ? /^@today([+-]\d+)d$/.exec(rule.value)?.[1] : undefined
  const span = typeof rule.value === 'string' ? /^@(past|next)(\d{1,4})d$/.exec(rule.value) : null
  const range = dateLike && typeof rule.value === 'string' && rule.value.startsWith('@') ? describeRange(rule.value, {}) : null
  const sections = fieldSections(catalog, types, locale)
  const pickField = (field: string) => {
    const next = fieldInfo(catalog, field, locale)
    if (field === PAGE_TYPE_FIELD) { onChange({ ...rule, field, op: TYPE_OPS.includes(rule.op) ? rule.op : 'is', value: null }); return }
    const nextOps = opsFor(next.type)
    onChange({ ...rule, field: next.field, op: nextOps.includes(rule.op) ? rule.op : nextOps[0], value: next.type === 'checkbox' ? true : next.type === info.type && rule.field !== PAGE_TYPE_FIELD ? rule.value : null })
  }
  const opText = (item: FilterOp) => isType ? typeOpLabel(item, rule.value, locale) : opLabel(item, info.type, locale)
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Editar filtro', 'Edit filter')}><div className="qb-pop" data-qb="rule-editor">
    <div className="qb-row">
      <Select className="dbv-input" aria-label={t('Campo', 'Field')} value={info.field} onChange={(event) => pickField(event.target.value)}>
        {sections.map((section) => <optgroup key={section.key} label={section.label}>{section.items.map((item) => <option key={`${section.key}:${item.field}`} value={item.field}>{item.label}</option>)}</optgroup>)}
        {!catalog.some((item) => item.field === info.field) && <optgroup label={t('Propriedades', 'Properties')}><option value={info.field}>{info.label}</option></optgroup>}
      </Select>
      <Select className={`dbv-input qb-op${isType ? ' qb-op--wide' : ''}`} aria-label={t('Operador', 'Operator')} value={op} onChange={(event) => onChange({ ...rule, op: event.target.value as FilterOp, value: event.target.value === 'isEmpty' || event.target.value === 'isNotEmpty' ? null : rule.value })}>
        {[...new Set([...ops, op])].map((item) => <option key={item} value={item}>{opText(item)}</option>)}
      </Select>
      <button type="button" className="qb-icon-btn" aria-label={t('Excluir filtro', 'Delete filter')} title={t('Excluir filtro', 'Delete filter')} onClick={onRemove}><Trash2 size={14} /></button>
    </div>
    {isType && op !== 'isEmpty' && op !== 'isNotEmpty' && <TypeValuePicker types={types} locale={locale} value={rule.value} onChange={setValue} />}
    {!isType && op !== 'isEmpty' && op !== 'isNotEmpty' && <div className="qb-value">
      {info.type === 'checkbox' ? <div className="qb-presets">{[true, false].map((value) => <button type="button" key={String(value)} className={`qb-preset${rule.value === value ? ' is-on' : ''}`} onClick={() => setValue(value)}>{value ? t('Marcado', 'Checked') : t('Desmarcado', 'Unchecked')}</button>)}</div>
        : info.options.length ? <div className="qb-options">{info.options.map((name) => <button type="button" key={name} className={`qb-option${rule.value === name ? ' is-on' : ''}`} onClick={() => setValue(name)}>{rule.value === name && <Check size={12} />}{name}</button>)}</div>
        : dateLike ? <>
          <div className="qb-presets">{DATE_PRESETS.map((preset) => <button type="button" key={preset.value} className={`qb-preset${rule.value === preset.value ? ' is-on' : ''}`} onClick={() => setValue(preset.value)}>{locale === 'en-US' ? preset.en : preset.pt}</button>)}</div>
          <div className="qb-row qb-row--wrap">
            <label className="qb-inline">{t('Últimos', 'Last')}<input className="dbv-input qb-num" type="number" min={1} max={3650} aria-label={t('Últimos N dias', 'Last N days')} value={span?.[1] === 'past' ? span[2] : ''} onChange={(event) => { const n = Math.round(Number(event.target.value)); setValue(n > 0 ? `@past${Math.min(3650, n)}d` : null) }} />{t('dias', 'days')}</label>
            <label className="qb-inline">{t('Próximos', 'Next')}<input className="dbv-input qb-num" type="number" min={1} max={3650} aria-label={t('Próximos N dias', 'Next N days')} value={span?.[1] === 'next' ? span[2] : ''} onChange={(event) => { const n = Math.round(Number(event.target.value)); setValue(n > 0 ? `@next${Math.min(3650, n)}d` : null) }} />{t('dias', 'days')}</label>
          </div>
          <div className="qb-row"><input className="dbv-input" type="date" aria-label={t('Data', 'Date')} value={typeof rule.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rule.value) ? rule.value : ''} onChange={(event) => setValue(event.target.value || null)} />
            <label className="qb-inline">{t('ou hoje +', 'or today +')}<input className="dbv-input qb-num" type="number" aria-label={t('Dias a partir de hoje', 'Days from today')} value={offset ?? ''} onChange={(event) => { const n = Math.round(Number(event.target.value)); setValue(event.target.value === '' ? null : `@today${n >= 0 ? '+' : ''}${n}d`) }} />{t('dias', 'days')}</label></div>
          {range && <p className="qb-hint" data-qb="range">{range.start === range.end ? t('Dia {a}', 'Day {a}', { a: dayLabel(range.start, locale) }) : t('De {a} a {b}', 'From {a} to {b}', { a: dayLabel(range.start, locale), b: dayLabel(range.end, locale) })}</p>}
        </>
        : <>
          <input className="dbv-input" autoFocus inputMode={info.type === 'number' ? 'decimal' : undefined} aria-label={t('Valor', 'Value')} placeholder={t('Valor…', 'Value…')}
            value={rule.value === null || rule.value === '@thisPage' || typeof rule.value === 'boolean' || Array.isArray(rule.value) ? '' : typeof rule.value === 'string' && pages[rule.value] ? pages[rule.value].title : String(rule.value)}
            onChange={(event) => { const raw = event.target.value; setValue(info.type === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw.replace(',', '.'))) ? Number(raw.replace(',', '.')) : raw) }} onKeyDown={(event) => { if (event.key === 'Enter') onClose() }} />
          {(info.type === 'relation' || rule.field === '@parent') && <div className="qb-presets"><button type="button" className={`qb-preset${rule.value === '@thisPage' ? ' is-on' : ''}`} onClick={() => setValue('@thisPage')}>{t('Esta página', 'This page')}</button></div>}
        </>}
    </div>}
    {isType && !types.length && <p className="qb-hint">{t('Ainda não há tipos neste espaço. Crie um em “+ Tipo” no cabeçalho de uma página.', 'There are no types in this workspace yet. Create one with “+ Type” in a page header.')}</p>}
    {!info.page && !catalog.some((item) => item.field === info.field) && <p className="qb-warning">{t('Esta propriedade não existe nos bancos da fonte.', 'This property does not exist in the source databases.')}</p>}
  </div></DbPopover>
}

function dayLabel(iso: string, locale: Locale): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' })
}

/** Lista de tipos (ícone + cor + nome) com seleção múltipla: 1 = "é", 2+ = "é qualquer um de". */
function TypeValuePicker({ types, locale, value, onChange, multiple = true }: { types: TypeList; locale: Locale; value: QueryValue; onChange: (value: QueryValue) => void; multiple?: boolean }) {
  const t = (pt: string, en: string) => translate(locale, pt, en)
  const [search, setSearch] = useState('')
  const selected = typeRuleRefs(value).map((ref) => resolveTypeRef(types, ref) ?? ref)
  const shown = types.filter((type) => fold(type.name).includes(fold(search.trim()))).slice(0, 200)
  const toggle = (id: string) => {
    const next = !multiple ? [id] : selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]
    onChange(next.length > 1 ? next : next[0] ?? null)
  }
  return <div className="qb-value" data-qb="type-picker">
    {types.length > 7 && <input className="dbv-input" autoFocus placeholder={t('Buscar tipo…', 'Search type…')} value={search} onChange={(event) => setSearch(event.target.value)} />}
    <div className="qb-scroll qb-typelist" role="listbox" aria-multiselectable={multiple} aria-label={t('Tipos', 'Types')}>
      {shown.map((type) => { const on = selected.includes(type.id); return <button type="button" role="option" aria-selected={on} key={type.id} className={`qb-option qb-option--row${on ? ' is-on' : ''}`} onClick={() => toggle(type.id)}>
        <span className="qb-check-slot">{on && <Check size={14} />}</span><TypeChip type={type} />
      </button> })}
      {!shown.length && <p className="qb-muted">{t('Nenhum tipo encontrado.', 'No types found.')}</p>}
    </div>
    {multiple && selected.length > 1 && <p className="qb-hint">{t('Páginas com qualquer um dos tipos marcados (subtipos incluídos).', 'Pages with any of the checked types (subtypes included).')}</p>}
  </div>
}

function SourceEditor({ query, pages, locale, types, anchor, onClose, onChange }: { query: Query; pages: Record<string, Page>; locale: Locale; types: TypeList; anchor: Element; onClose: () => void; onChange: (source: Query['source']) => void }) {
  const t = (pt: string, en: string, vars?: Record<string, string | number>) => translate(locale, pt, en, vars)
  const [search, setSearch] = useState('')
  const source = query.source
  const databases = useMemo(() => Object.values(pages).filter((page) => page.database && live(page) && !isUnder(pages, page)).sort((a, b) => a.title.localeCompare(b.title, locale)), [pages, locale])
  const shown = databases.filter((db) => fold(db.title).includes(fold(search.trim()))).slice(0, 200)
  const selected = source.databaseIds ?? []
  const toggleDb = (id: string) => {
    if (source.kind === 'databases') { const ids = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]; onChange(ids.length > 1 ? { kind: 'databases', databaseIds: ids } : ids.length ? { kind: 'database', databaseIds: ids } : { kind: 'databases', databaseIds: [] }) }
    else if (source.kind === 'relatedToThis') onChange({ kind: 'relatedToThis', ...(selected[0] === id ? {} : { databaseIds: [id] }) })
    else onChange({ kind: 'database', databaseIds: [id] })
  }
  const pickKind = (kind: QuerySourceKind) => {
    if (kind === source.kind) return
    if (kind === 'database' || kind === 'databases') onChange({ kind, databaseIds: selected.slice(0, kind === 'database' ? 1 : 32) })
    else if (kind === 'modified') onChange({ kind, days: 7 })
    else if (kind === 'type') onChange({ kind, ...(types[0] && types.length === 1 ? { typeIds: [types[0].id] } : {}) })
    else onChange({ kind })
  }
  const pickDb = source.kind === 'database' || source.kind === 'databases' || source.kind === 'relatedToThis'
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Fonte da consulta', 'Query source')}><div className="qb-pop qb-pop--source" data-qb="source-editor">
    <div className="qb-kinds">{SOURCE_KINDS.map((kind) => <button type="button" key={kind} className={`qb-kind${source.kind === kind ? ' is-on' : ''}`} onClick={() => pickKind(kind)}>{SOURCE_ICONS[kind]}<span>{t(...SOURCE_LABELS[kind])}</span></button>)}</div>
    <div className="qb-source-config">
      {pickDb && <>
        <input className="dbv-input" placeholder={t('Buscar banco…', 'Search database…')} value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
        <div className="qb-scroll qb-dblist">{shown.length ? shown.map((db) => <button type="button" key={db.id} className={`qb-option qb-option--row${selected.includes(db.id) ? ' is-on' : ''}`} onClick={() => toggleDb(db.id)}>{selected.includes(db.id) ? <Check size={14} /> : <Database size={14} />}<span>{db.title || t('Sem título', 'Untitled')}</span>{db.database?.linkedSourceId && <small>{t('vinculado', 'linked')}</small>}</button>) : <p className="qb-muted">{t('Nenhum banco encontrado.', 'No databases found.')}</p>}</div>
        {source.kind === 'relatedToThis' && <p className="qb-hint">{t('Sem banco escolhido, procura em todos os bancos com relação.', 'With no database chosen, searches every database with a relation.')}</p>}
      </>}
      {(source.kind === 'children' || source.kind === 'backlinks') && <>
        <label className="qb-label">{source.kind === 'children' ? t('Página', 'Page') : t('Menções a', 'Mentions of')}
          <Select className="dbv-input" value={source.pageId ?? '@thisPage'} onChange={(event) => onChange({ ...source, pageId: event.target.value === '@thisPage' ? undefined : event.target.value })}>
            <option value="@thisPage">{t('Esta página', 'This page')}</option>
            {Object.values(pages).filter((page) => live(page) && !(page.parentId && pages[page.parentId]?.database) && !isUnder(pages, page)).sort((a, b) => a.title.localeCompare(b.title, locale)).slice(0, 500).map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}
          </Select></label>
        {source.kind === 'children' && <label className="qb-check"><input type="checkbox" checked={!!source.deep} onChange={(event) => onChange({ ...source, deep: event.target.checked || undefined })} />{t('Incluir todos os níveis (descendentes)', 'Include all levels (descendants)')}</label>}
      </>}
      {source.kind === 'tag' && <label className="qb-label">{t('Tag (#tag no texto ou opção de seleção)', 'Tag (#tag in text or select option)')}<input className="dbv-input" autoFocus value={source.tag ?? ''} placeholder="ideia" onChange={(event) => onChange({ kind: 'tag', tag: event.target.value.replace(/^#/, '') })} /></label>}
      {source.kind === 'modified' && <label className="qb-label">{t('Nos últimos (dias)', 'In the last (days)')}<input className="dbv-input" type="number" min={1} max={3650} value={source.days ?? 7} onChange={(event) => onChange({ kind: 'modified', days: Math.max(1, Math.min(3650, Math.round(Number(event.target.value) || 1))) })} /></label>}
      {source.kind === 'type' && <>
        <TypeValuePicker types={types} locale={locale} value={source.typeIds?.length ? source.typeIds.length > 1 ? source.typeIds : source.typeIds[0] : null} onChange={(value) => { const ids = typeRuleRefs(value); onChange(ids.length ? { kind: 'type', typeIds: ids } : { kind: 'type' }) }} />
        <p className="qb-hint">{t('Páginas com o tipo, onde quer que estejam (subtipos incluídos). Os campos do tipo viram colunas e filtros.', 'Pages with the type, wherever they are (subtypes included). The type fields become columns and filters.')}</p>
      </>}
      {source.kind === 'tasks' && <label className="qb-check"><input type="checkbox" checked={!!source.includeDone} onChange={(event) => onChange({ kind: 'tasks', ...(event.target.checked ? { includeDone: true } : {}) })} />{t('Incluir concluídas', 'Include done')}</label>}
      {source.kind === 'pages' && <p className="qb-hint">{t('Todas as páginas e linhas do espaço, exceto lixeira e páginas protegidas por senha.', 'Every page and row in the workspace, except trash and password-protected pages.')}</p>}
    </div>
  </div></DbPopover>
}

/** Bancos/páginas dentro de página protegida não aparecem como opção. */
function isUnder(pages: Record<string, Page>, page: Page): boolean {
  let current: Page | undefined = page, guard = 0
  while (current && guard++ < 128) { if (current.passwordLock || current.trashed) return true; current = current.parentId ? pages[current.parentId] : undefined }
  return false
}

export { fieldLabel }
