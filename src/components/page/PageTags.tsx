import { useEffect, useMemo, useState } from 'react'
import { Hash, Plus, X } from 'lucide-react'
import { actions, getState, selectors, useStore } from '../../store'
import type { Page } from '../../types'
import { useI18n } from '../../i18n'
import { createObject, createType } from '../../objecttypes/actions'
import { fold, typeIndex } from '../../objecttypes/model'
import { linkedTagPages, pagesTaggedWith, tagTypeIds } from '../../objecttypes/pageTags'
import { isQueryable } from '../../query/engine'
import { Popover } from '../sidebar/Popover'
import './pageTags.css'

export function PageTags({ page, locked }: { page: Page; locked: boolean }) {
  const { t } = useI18n()
  const { pages, settings } = useStore()
  const types = settings.objectTypes ?? []
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const [title, setTitle] = useState('')
  const [limit, setLimit] = useState(30)
  useEffect(() => { setTrigger(null); setTitle(''); setLimit(30) }, [page.id])
  const tagTypes = useMemo(() => tagTypeIds(types), [types])
  const tags = linkedTagPages(page, pages)
  const related = useMemo(() => pagesTaggedWith(page.id, pages), [pages, page.id])
  const isTag = related.length > 0 || page.types?.some(id => tagTypes.has(id))
  const candidates = useMemo(() => {
    if (!trigger) return []
    const index = typeIndex(pages, types)
    const ids = new Set([...tagTypes].flatMap(id => index.get(id) ?? []))
    return [...ids].filter(id => id !== page.id && isQueryable(pages, id)).map(id => pages[id])
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [pages, page.id, tagTypes, trigger, types])
  const query = fold(title.trim())
  const exact = query ? candidates.find(tag => fold(tag.title) === query) : undefined
  const selected = new Set(page.tagPageIds)
  const close = () => { trigger?.focus(); setTrigger(null); setTitle('') }
  const change = (id: string, remove = false) => {
    const current = selectors.page(page.id)
    if (!current || current.locked || locked || !isQueryable(getState().pages, page.id)) return
    const ids = new Set(current.tagPageIds)
    if (remove) ids.delete(id)
    else if (ids.size < 100 && id !== current.id && isQueryable(getState().pages, id)) ids.add(id)
    else return
    actions.updatePage(current.id, { tagPageIds: [...ids] })
    close()
  }
  const create = () => {
    if (!query || exact || locked || !isQueryable(getState().pages, page.id) || (selectors.page(page.id)?.tagPageIds?.length ?? 0) >= 100) return
    try {
      const typeId = tagTypes.values().next().value ?? createType({ name: 'Tags', icon: 'lucide:tag:blue' })
      if (typeId) change(createObject(typeId, {}, { title: title.trim() }))
    } catch (error) { actions.reportSaveError(error) }
  }
  const canEdit = !locked && isQueryable(pages, page.id)

  return <>
    {(tags.length > 0 || (canEdit && !isTag)) && <div className="pg-tag-links" aria-label={t('Tags vinculadas', 'Linked tags')}>
      {tags.map(tag => <span key={tag.id} className="pg-tag-pill">
        <button type="button" onClick={() => actions.openPage(tag.id)}><Hash size={13} />{tag.title || t('Sem título', 'Untitled')}</button>
        {canEdit && <button type="button" aria-label={t('Remover tag {name}', 'Remove tag {name}', { name: tag.title })} onClick={() => change(tag.id, true)}><X size={12} /></button>}
      </span>)}
      {canEdit && !isTag && selected.size < 100 && <button type="button" className="pg-tag-add" aria-expanded={!!trigger} onClick={event => { setTitle(''); setTrigger(event.currentTarget) }}>
        <Plus size={14} />{t('Vincular tag', 'Link tag')}
      </button>}
    </div>}
    {trigger && canEdit && <Popover anchor={trigger.getBoundingClientRect()} ignore={trigger} onClose={close} className="pg-tag-picker" label={t('Adicionar tag', 'Add tag')}>
      <form onSubmit={event => { event.preventDefault(); if (exact && !selected.has(exact.id)) change(exact.id); else if (!exact) create() }}>
        <input autoFocus value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder={t('Buscar ou criar tag', 'Find or create a tag')} aria-label={t('Buscar ou criar tag', 'Find or create a tag')} />
        <div className="pg-tag-options">
          {candidates.filter(tag => !selected.has(tag.id) && fold(tag.title).includes(query)).slice(0, 30).map(tag => <button key={tag.id} type="button" onClick={() => change(tag.id)}><Hash size={14} />{tag.title || t('Sem título', 'Untitled')}</button>)}
          {query && !exact && <button type="submit"><Plus size={14} />{t('Criar tag “{name}”', 'Create tag “{name}”', { name: title.trim() })}</button>}
        </div>
      </form>
    </Popover>}
    {isTag && <section className="pg-tag-related" aria-label={t('Páginas com esta tag', 'Pages with this tag')}>
      <h2>{t('Páginas com esta tag', 'Pages with this tag')}</h2>
      {related.length ? <ul>{related.slice(0, limit).map(item => <li key={item.id}>
        <button type="button" onClick={() => actions.openPage(item.id)}>{item.title || t('Sem título', 'Untitled')}</button>
      </li>)}</ul> : <p>{t('Nenhuma página usa esta tag ainda.', 'No pages use this tag yet.')}</p>}
      {related.length > limit && <button type="button" onClick={() => setLimit(value => value + 30)}>{t('Mostrar mais', 'Show more')}</button>}
    </section>}
  </>
}
