// Configuração de uma propriedade Relação no estilo do Export Bundle: painel "Relacionada a" (busca e
// lista de fontes de dados com trilha), criação de banco novo e "Mostrar em [Banco]" (relação
// bidirecional, com nome editável da propriedade espelho). Filtro/ordenação dos candidatos
// continuam em "Filtros e ordenação".
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Info, MoreHorizontal, Plus, X } from 'lucide-react'
import { actions, getState } from '../../store'
import type { Property } from '../../types'
import { useI18n } from '../../i18n'
import { DbPopover } from './ui/Popover'
import { addProperty, renameProperty } from './schemaOps'
import { PROP_TYPE_LABELS } from './lib'
import { backfillMirror, findMirrorCandidate, listDataSources, mirrorPropertyName, type DataSourceEntry } from './relationPicker'
import { RelationPickerConfig } from './RelatedRulesEditor'
import { PageIcon } from '../page/PageIcon'
import './editors/editors.css'

const FIRST = 5

/** Lista "Fontes de dados existentes" com busca, "Mostrar mais N" e "Novo banco de dados". */
export function DataSourcePicker({ selectedId, onPick, onCreate, onClose, autoFocus = true }: {
  selectedId?: string
  onPick: (id: string) => void
  onCreate?: (title: string) => void
  onClose?: () => void
  autoFocus?: boolean
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [active, setActive] = useState(0)
  const [info, setInfo] = useState<string | null>(null)
  const pages = getState().pages
  const untitled = t('Banco sem título', 'Untitled database')
  const sources = useMemo(() => listDataSources(pages, query, untitled), [pages, query, untitled])
  const visible = expanded || query.trim() ? sources : sources.slice(0, FIRST)
  const hidden = sources.length - visible.length
  const count = visible.length + (hidden ? 1 : 0) + (onCreate ? 1 : 0)
  const current = Math.min(active, count - 1)
  useEffect(() => setActive(0), [query])
  const run = (index: number) => {
    if (index < visible.length) onPick(visible[index].id)
    else if (hidden && index === visible.length) setExpanded(true)
    else onCreate?.(query.trim())
  }
  const describe = (source: DataSourceEntry) => {
    const props = pages[source.id]?.database?.properties.map((p) => p.name) ?? []
    return `${source.rows === 1 ? t('1 página', '1 page') : t('{count} páginas', '{count} pages', { count: source.rows })} · ${props.length === 1 ? t('1 propriedade', '1 property') : t('{count} propriedades', '{count} properties', { count: props.length })}: ${props.slice(0, 6).join(', ')}${props.length > 6 ? '…' : ''}`
  }
  return <div className="db-dsp" onKeyDown={(e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (count) setActive((current + (e.key === 'ArrowDown' ? 1 : count - 1)) % count) }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (count) run(current) }
  }}>
    <div className="db-dsp-head">
      <span>{t('Relacionada a', 'Related to')}</span>
      {onClose && <button type="button" className="db-dsp-close" aria-label={t('Fechar', 'Close')} onClick={onClose}><X size={14} /></button>}
    </div>
    <input autoFocus={autoFocus} className="dbv-input db-dsp-search" aria-label={t('Vincular a uma fonte de dados', 'Link to a data source')} placeholder={t('Vincular a uma fonte de dados…', 'Link to a data source…')} value={query} onChange={(e) => setQuery(e.target.value)} />
    <div className="db-dsp-label">{t('Fontes de dados existentes', 'Existing data sources')}</div>
    <div className="db-dsp-list" role="listbox" aria-label={t('Fontes de dados existentes', 'Existing data sources')}>
      {visible.map((source, index) => <div key={source.id} role="option" aria-selected={source.id === selectedId} className={`db-dsp-item${index === current ? ' is-active' : ''}${source.id === selectedId ? ' is-selected' : ''}`} onMouseMove={() => index !== current && setActive(index)} onMouseLeave={() => setInfo(null)} onClick={() => run(index)}>
        <span className="db-dsp-icon">{source.icon ? <PageIcon value={source.icon} /> : <Database size={18} strokeWidth={1.5} />}</span>
        <span className="db-dsp-text">
          <span className="db-dsp-title">{source.title}</span>
          {source.path && <span className="db-dsp-path">{source.path}</span>}
          {info === source.id && <span className="db-dsp-desc" role="note">{describe(source)}</span>}
        </span>
        <button type="button" className="db-dsp-info" aria-label={t('Detalhes de {name}', 'Details of {name}', { name: source.title })} title={describe(source)} onMouseEnter={() => setInfo(source.id)} onFocus={() => setInfo(source.id)} onClick={(e) => { e.stopPropagation(); setInfo(info === source.id ? null : source.id) }}><Info size={16} /></button>
      </div>)}
      {!visible.length && <div className="db-dsp-empty">{t('Nenhuma fonte de dados encontrada.', 'No data sources found.')}</div>}
      {hidden > 0 && <div role="option" aria-selected="false" className={`db-dsp-item db-dsp-action${current === visible.length ? ' is-active' : ''}`} onMouseMove={() => setActive(visible.length)} onClick={() => setExpanded(true)}><span className="db-dsp-icon"><MoreHorizontal size={16} /></span><span>{t('Mostrar mais {count}', 'Show {count} more', { count: hidden })}</span></div>}
      {onCreate && <div role="option" aria-selected="false" className={`db-dsp-item db-dsp-action${current === count - 1 ? ' is-active' : ''}`} onMouseMove={() => setActive(count - 1)} onClick={() => onCreate(query.trim())}><span className="db-dsp-icon"><Plus size={16} /></span><span>{query.trim() ? t('Novo banco de dados “{name}”', 'New database “{name}”', { name: query.trim() }) : t('Novo banco de dados', 'New database')}</span></div>}
    </div>
  </div>
}

const DEFAULT_NAME = new RegExp(`^(?:${PROP_TYPE_LABELS.relation}|Relation)(?: \\d+)?$`)

/** Bloco de relação do menu da propriedade. */
export function RelationPropertyConfig({ dbId, property, onPatch, onClose }: { dbId: string; property: Property; onPatch: (patch: Partial<Property>) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState<HTMLElement | null>(null)
  const [rulesOpen, setRulesOpen] = useState(!!(property.relationPicker?.filters?.length || property.relationPicker?.sortPropertyId || property.relationPicker?.shownPropertyIds?.length))
  const pages = getState().pages
  const targetId = property.relationDatabaseId
  const target = targetId ? pages[targetId] : undefined
  const untitled = t('Banco sem título', 'Untitled database')
  const mirror = targetId ? target?.database?.properties.find((p) => p.id === property.relationMirrorPropertyId && p.type === 'relation' && p.relationDatabaseId === dbId) : undefined
  const [mirrorName, setMirrorName] = useState(mirror?.name ?? '')
  useEffect(() => setMirrorName(mirror?.name ?? ''), [mirror?.name])
  const targetLocked = !!target?.locked

  const unlinkMirror = () => {
    if (mirror && targetId) actions.updateSchema(targetId, (s) => ({ ...s, properties: s.properties.map((p) => p.id === mirror.id && p.relationMirrorPropertyId === property.id ? { ...p, relationMirrorPropertyId: undefined } : p) }))
  }
  const pick = (id: string) => {
    setPicking(null)
    if (id === targetId) return
    unlinkMirror()
    const fresh = getState().pages
    const title = fresh[id]?.title || untitled
    const names = new Set(fresh[dbId]?.database?.properties.filter((p) => p.id !== property.id).map((p) => p.name) ?? [])
    let name = title
    for (let i = 2; names.has(name); i++) name = `${title} ${i}`
    onPatch({ relationDatabaseId: id, relationMirrorPropertyId: undefined, relationPicker: undefined, ...(DEFAULT_NAME.test(property.name) ? { name } : {}) })
  }
  const create = (title: string) => {
    const id = actions.createDatabase(getState().pages[dbId]?.parentId ?? null, 'table', { title: title || t('Novo banco de dados', 'New database') })
    pick(id)
  }
  const enableTwoWay = () => {
    if (!targetId) return
    const state = getState().pages
    const existing = findMirrorCandidate(state, dbId, property)
    let reverseId = existing?.id
    if (reverseId) {
      actions.updateSchema(targetId, (s) => ({ ...s, properties: s.properties.map((p) => p.id === reverseId ? { ...p, relationMirrorPropertyId: property.id } : p) }))
    } else {
      const name = mirrorPropertyName(state, dbId, targetId, untitled)
      reverseId = addProperty(targetId, 'relation', undefined)
      actions.updateSchema(targetId, (s) => ({ ...s, properties: s.properties.map((p) => p.id === reverseId ? { ...p, name, relationDatabaseId: dbId, relationMirrorPropertyId: property.id } : p) }))
    }
    onPatch({ relationMirrorPropertyId: reverseId })
    // Une os dois lados (nada é apagado): origem → espelho e espelho → origem.
    const id = reverseId
    for (const patch of backfillMirror(getState().pages, dbId, property.id, targetId, id)) actions.updatePage(patch.rowId, { props: { ...getState().pages[patch.rowId].props, [id]: patch.value } })
    for (const patch of backfillMirror(getState().pages, targetId, id, dbId, property.id)) actions.updatePage(patch.rowId, { props: { ...getState().pages[patch.rowId].props, [property.id]: patch.value } })
  }
  const disableTwoWay = () => { unlinkMirror(); onPatch({ relationMirrorPropertyId: undefined }) }
  const commitMirrorName = () => {
    const name = mirrorName.trim()
    if (mirror && targetId && name && name !== mirror.name) renameProperty(targetId, mirror.id, name)
    else setMirrorName(mirror?.name ?? '')
  }

  if (!target?.database) return <div className="db-relcfg"><DataSourcePicker onPick={pick} onCreate={create} onClose={onClose} /></div>
  const targetName = target.title || untitled
  return <div className="db-relcfg">
    <button type="button" className="dbv-menu-item db-relcfg-row" aria-haspopup="dialog" aria-expanded={!!picking} onClick={(e) => setPicking(picking ? null : e.currentTarget)}>
      <span className="dbv-menu-label">{t('Relacionada a', 'Related to')}</span>
      <span className="db-relcfg-value">{target.icon ? <PageIcon value={target.icon} /> : <Database size={14} strokeWidth={1.6} />}<span>{targetName}</span><ChevronRight size={14} /></span>
    </button>
    <button type="button" className="dbv-menu-item db-relcfg-row" role="switch" aria-checked={!!mirror} disabled={targetLocked} onClick={() => mirror ? disableTwoWay() : enableTwoWay()}>
      <span className="dbv-menu-label db-relcfg-two">
        <span>{targetId === dbId ? t('Relação bidirecional no mesmo banco', 'Two-way relation in this database') : t('Mostrar em {name}', 'Show on {name}', { name: targetName })}</span>
        <small>{t('Relação bidirecional', 'Two-way relation')}</small>
      </span>
      <span className={`np-switch-track${mirror ? ' is-on' : ''}`} />
    </button>
    {mirror && <div className="db-property-config db-relcfg-mirror">
      <label htmlFor={`relation-mirror-${property.id}`}>{t('Propriedade relacionada em {name}', 'Related property on {name}', { name: targetName })}</label>
      <input id={`relation-mirror-${property.id}`} className="dbv-input" value={mirrorName} disabled={targetLocked} onChange={(e) => setMirrorName(e.target.value)} onBlur={commitMirrorName} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitMirrorName() } }} />
    </div>}
    <button type="button" className="dbv-menu-item db-relcfg-row" aria-expanded={rulesOpen} onClick={() => setRulesOpen(!rulesOpen)}>
      <span className="dbv-menu-label">{t('Filtros e ordenação das páginas oferecidas', 'Filters and sorting for offered pages')}</span>
      {rulesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    {rulesOpen && <div className="db-property-config"><RelationPickerConfig property={property} onPatch={onPatch} /></div>}
    {picking && <DbPopover anchor={picking} placement="right-start" onClose={() => setPicking(null)} label={t('Relacionada a', 'Related to')}>
      <DataSourcePicker selectedId={targetId} onPick={pick} onCreate={create} onClose={() => setPicking(null)} />
    </DbPopover>}
  </div>
}
