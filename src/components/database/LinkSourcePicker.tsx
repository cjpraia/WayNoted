import PRODUCT from '../../../shared/product.json' with { type: 'json' }
// Popover "Vincular fonte de dados" (docs/USAGE.md): busca com filtro imediato
// (nome e caminho), "Novo banco vazio", só bancos de verdade com caminho em cinza, recentes primeiro,
// "Mostrar mais" 5 → 20 → todos. Teclado: ↑/↓ movem, Enter escolhe, Esc fecha e devolve o foco.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { getState, useStore } from '../../store'
import { t } from '../../i18n'
import { DbPopover, type DbPlacement } from './ui/Popover'
import { PanelHeader } from '../ui/PanelHeader'
import { Icon } from '../ui/icons'
import { PageIcon } from '../page/PageIcon'
import { linkableSources, visibleSourceCount, SOURCE_PAGE_STEPS } from './linkedSource'

type Entry = { kind: 'new' } | { kind: 'source'; id: string } | { kind: 'more' }

export function LinkSourcePicker(props: {
  anchor: Element
  /** Elemento cujo clique não fecha o seletor (o botão que o abre); padrão: a âncora. */
  ignore?: Element
  /** Para onde o foco volta ao fechar; padrão: a âncora. */
  returnFocus?: Element
  title: string
  placement?: DbPlacement
  /** Bancos que não podem ser escolhidos (a própria visualização, por exemplo). */
  exclude?: string[]
  /** Fonte atual (marcada com ✓ ao trocar de fonte). */
  currentId?: string
  onPick: (sourceId: string) => void
  /** "Novo banco vazio": cria um banco e já vincula. Ausente = sem a opção. */
  onCreateNew?: () => void
  onClose: () => void
}) {
  useStore()
  const { anchor, onClose } = props
  const [query, setQuery] = useState('')
  const [step, setStep] = useState(0)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const state = getState()
  const sources = useMemo(() => linkableSources(state.pages, {
    query,
    recent: state.settings.recent,
    exclude: props.exclude,
    workspaceName: state.settings.workspaceName || `${PRODUCT.name}`,
    untitled: t('Sem título', 'Untitled'),
  }), [state.pages, state.settings.recent, state.settings.workspaceName, query, props.exclude])
  const shown = sources.slice(0, visibleSourceCount(step, sources.length))
  const hasMore = shown.length < sources.length
  const entries: Entry[] = [
    ...(props.onCreateNew && !query.trim() ? [{ kind: 'new' } as const] : []),
    ...shown.map((source) => ({ kind: 'source', id: source.id } as const)),
    ...(hasMore ? [{ kind: 'more' } as const] : []),
  ]
  const activeIndex = Math.min(active, Math.max(0, entries.length - 1))

  useEffect(() => { inputRef.current?.focus() }, [])
  // Ao fechar, o foco volta ao botão que abriu o seletor (se ele ainda existir).
  const focusBack = (props.returnFocus ?? props.ignore ?? anchor) as HTMLElement
  useEffect(() => () => {
    const el = focusBack
    if (el.isConnected && typeof el.focus === 'function') setTimeout(() => { if (el.isConnected) el.focus() }, 0)
  }, [focusBack])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-lsp-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  const choose = (entry: Entry | undefined) => {
    if (!entry) return
    if (entry.kind === 'more') { setStep((n) => Math.min(n + 1, SOURCE_PAGE_STEPS.length - 1)); return }
    if (entry.kind === 'new') { props.onCreateNew?.(); return }
    props.onPick(entry.id)
  }
  const optionId = (index: number) => `${listId}-o${index}`
  const sourcesStart = entries.findIndex((entry) => entry.kind === 'source')
  const noDatabases = !query.trim() && sources.length === 0

  return (
    <DbPopover anchor={anchor} placement={props.placement ?? 'bottom-start'} onClose={onClose} ignore={props.ignore ?? anchor} label={props.title} className="lsp-pop">
      <div className="lsp">
        <PanelHeader title={props.title} onClose={onClose} />
        <div className="lsp-search">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="lsp-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={entries.length ? optionId(activeIndex) : undefined}
            aria-label={t('Buscar ou criar fonte de dados', 'Search or create a data source')}
            placeholder={t('Buscar ou criar fonte de dados…', 'Search or create a data source…')}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); setStep(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!entries.length) return
                const delta = event.key === 'ArrowDown' ? 1 : -1
                setActive((activeIndex + delta + entries.length) % entries.length)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(entries[activeIndex])
              }
            }}
          />
        </div>
        <div className="lsp-list" id={listId} role="listbox" aria-label={t('Fontes de dados', 'Data sources')} ref={listRef}>
          {entries.map((entry, index) => {
            const common = {
              id: optionId(index),
              role: 'option' as const,
              'aria-selected': index === activeIndex,
              'data-lsp-index': index,
              className: `lsp-item${index === activeIndex ? ' is-active' : ''}${entry.kind === 'more' ? ' lsp-more' : ''}`,
              onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
              onMouseMove: () => { if (index !== activeIndex) setActive(index) },
              onClick: () => choose(entry),
            }
            if (entry.kind === 'new') return <div key="new" {...common}>
              <span className="lsp-item-icon"><Icon name="plus" size={16} /></span>
              <span className="lsp-item-main"><span className="lsp-item-title">{t('Novo banco vazio', 'New empty database')}</span></span>
            </div>
            if (entry.kind === 'more') return <div key="more" {...common}>
              <span className="lsp-item-icon"><Icon name="chevron-down" size={16} /></span>
              <span className="lsp-item-main"><span className="lsp-item-title">{t('Mostrar mais', 'Show more')}</span></span>
              <span className="lsp-item-count">{sources.length - shown.length}</span>
            </div>
            const source = shown.find((item) => item.id === entry.id)!
            const item = <div key={source.id} {...common} title={[...source.path, source.title].join(' / ')}>
              <span className="lsp-item-icon"><PageIcon value={source.icon} fallback="database" style={{ width: 16, height: 16 }} /></span>
              <span className="lsp-item-main">
                <span className="lsp-item-title">{source.title}</span>
                <span className="lsp-item-path">{source.path.join(' / ')}</span>
              </span>
              <span className="lsp-item-count" aria-label={t('{n} linhas', '{n} rows', { n: source.rowCount })}>{source.rowCount}</span>
              {props.currentId === source.id && <Icon name="check" size={16} className="lsp-item-check" title={t('Fonte atual', 'Current source')} />}
            </div>
            return index === sourcesStart ? [<div key="section" className="lsp-section" role="presentation">{query.trim() ? t('Resultados', 'Results') : t('Fontes existentes', 'Existing data sources')}</div>, item] : item
          })}
        </div>
        {noDatabases && <p className="lsp-empty">{props.onCreateNew ? t('Ainda não há bancos de dados neste espaço. Crie um novo acima.', 'There are no databases in this workspace yet. Create a new one above.') : t('Ainda não há outros bancos de dados neste espaço.', 'There are no other databases in this workspace yet.')}</p>}
        {!noDatabases && query.trim() && sources.length === 0 && <p className="lsp-empty" role="status">{t('Nenhum banco encontrado para “{q}”.', 'No database matches “{q}”.', { q: query.trim() })}</p>}
      </div>
    </DbPopover>
  )
}
