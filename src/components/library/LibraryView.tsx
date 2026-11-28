import { useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react'
import { Search } from 'lucide-react'
import { actions, useStore } from '../../store'
import { Select } from '../ui/Select'
import { t } from '../../i18n'
import type { LibraryScope } from '../../types'
import { pageTypes, type TypeList } from '../../objecttypes/model'
import { indexVersion, subscribeIndex } from '../../search/indexer'
import { searchEngine, searchablePages } from '../modals/search.mts'
import { PageIcon } from '../sidebar/PageTree'
import { requestPageCreation } from './PageCreation'
import { indexedLibraryMatches, libraryPages, libraryTypePages, searchLibrary } from './model'
import { libraryTitle } from './labels'
import './library.css'

const EMPTY_TYPES: TypeList = []
const PAGE_SIZE = 50

export function LibraryView({ scope }: { scope: LibraryScope }) {
  const { pages, settings } = useStore()
  const types = settings.objectTypes ?? EMPTY_TYPES
  const [query, setQuery] = useState('')
  const [typeId, setTypeId] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const deferredQuery = useDeferredValue(query)
  const revision = useSyncExternalStore(subscribeIndex, indexVersion, indexVersion)
  const candidates = useMemo(() => libraryPages(pages, types, scope, settings.recent, settings.dailyFlow?.databaseId), [pages, types, scope, settings.recent, settings.dailyFlow?.databaseId])
  const textMatches = useMemo(() => {
    if (!deferredQuery.trim()) return new Set<string>()
    // O índice compartilhado inclui conteúdo de blocos e texto de anexos.
    searchEngine.sync(searchablePages(pages))
    return indexedLibraryMatches(searchEngine, deferredQuery, pages)
  }, [pages, deferredQuery, revision])
  const selectedType = scope === 'untyped' ? undefined : types.find(type => type.id === typeId)
  const typePages = useMemo(() => selectedType ? libraryTypePages(pages, types, selectedType.id) : undefined, [pages, types, selectedType])
  const results = useMemo(() => searchLibrary(candidates, deferredQuery, textMatches, typePages), [candidates, deferredQuery, textMatches, typePages])

  return <section className="library-view">
    <header className="library-header">
      <h1>{libraryTitle(scope)}</h1>
      <button type="button" onClick={() => requestPageCreation({}, null, selectedType?.id)}>{t('Nova página', 'New page')}</button>
    </header>
    <nav className="library-scopes" aria-label={t('Visões do acervo', 'Library views')}>
      {(['all', 'recent', 'untyped'] as const).map(view => <button type="button" key={view} aria-current={scope === view ? 'page' : undefined} onClick={() => { setLimit(PAGE_SIZE); actions.navigate({ type: 'library', scope: view }) }}>
        {view === 'all' ? t('Tudo', 'All') : libraryTitle(view)}
      </button>)}
    </nav>
    <div className="library-filters">
      <label className="library-search"><Search size={16} aria-hidden />
        <input type="search" aria-label={t('Buscar no acervo', 'Search library')} placeholder={t('Buscar no acervo', 'Search library')} value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE) }} />
      </label>
      {scope !== 'untyped' && types.length > 0 && <div className="library-select"><span aria-hidden>{t('Tipo', 'Type')}</span>
        <Select aria-label={t('Tipo', 'Type')} value={selectedType?.id ?? ''} onChange={event => { setTypeId(event.target.value); setLimit(PAGE_SIZE) }}>
          <option value="">{t('Todos os tipos', 'All types')}</option>
          {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </Select>
      </div>}
    </div>
    <p className="library-count" role="status">{results.length === 1 ? t('1 item', '1 item') : t('{count} itens', '{count} items', { count: results.length })}</p>
    {results.length > 0 ? <ul className="library-list">
      {results.slice(0, limit).map(page => {
        const parent = page.parentId ? pages[page.parentId] : null
        return <li key={page.id}>
          <button type="button" className="library-item" onClick={() => actions.openPage(page.id)}>
            <span className="library-item-icon"><PageIcon page={page} size={18} /></span>
            <span className="library-item-text"><strong>{page.title || t('Sem título', 'Untitled')}</strong>{parent && <small>{parent.title || t('Sem título', 'Untitled')}</small>}</span>
            <span className="library-types">{pageTypes(types, page).map(type => <span key={type.id}>{type.name}</span>)}</span>
          </button>
        </li>
      })}
    </ul> : <p>{t('Nenhum item nesta visão.', 'No items in this view.')}</p>}
    {results.length > limit && <button type="button" onClick={() => setLimit(value => value + PAGE_SIZE)}>{t('Mostrar mais', 'Show more')}</button>}
  </section>
}
