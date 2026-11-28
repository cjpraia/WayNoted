import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileText, Lock, Search } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useModalFocus } from '../../a11y/useModalFocus'
import { useI18n } from '../../i18n'
import { actions, getState, selectors, useStore } from '../../store'
import { foldSearch } from '../../workspace'
import { PageIcon } from '../sidebar/PageTree'
import { Button } from '../ui/Button'
import { DialogActions } from '../ui/DialogActions'
import { EmptyState } from '../ui/illustrations/Illustration'
import { TrashPreview } from './TrashPreview'
import { trashPageLabels, trashPageTitle } from './trashLabels'
import './trash.css'

export function TrashView() {
  const { pages } = useStore()
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const listLabel = useId()
  const search = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const returnToList = useRef(false)
  const entries = useMemo(() => selectors.trash().map(page => ({ page, ...trashPageLabels(page, selectors.ancestors(page.id)) })), [pages, locale])
  const term = foldSearch(query.trim())
  const results = term ? entries.filter(item => foldSearch(`${item.title} ${item.path}`).includes(term)) : entries
  const selected = results.find(item => item.page.id === selectedId)
  const confirmPage = confirmId ? pages[confirmId] : undefined

  useEffect(() => { (search.current ?? heading.current)?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (selected) {
      if (back.current?.getClientRects().length) back.current.focus({ preventScroll: true })
    } else if (returnToList.current) {
      returnToList.current = false
      const target = search.current ?? heading.current
      target?.focus({ preventScroll: true })
    }
  }, [selected?.page.id, selectedId])

  const clearSelection = () => {
    returnToList.current = true
    setSelectedId(null)
  }
  const restore = (id: string) => {
    if (!getState().pages[id]?.trashed) return
    actions.restorePage(id)
    clearSelection()
    setNotice(t('Item restaurado.', 'Item restored.'))
  }
  const finishDelete = () => {
    clearSelection()
    setConfirmId(null)
    setNotice(t('Item excluído definitivamente.', 'Item permanently deleted.'))
  }

  return <section className="trash-page" aria-labelledby={listLabel}>
    <header className="trash-page__header">
      <h1 id={listLabel} ref={heading} tabIndex={-1}>{t('Lixeira', 'Trash')}</h1>
      {notice && <p role="status">{notice}</p>}
    </header>
    <div className={`trash-page__split${selected ? ' has-preview' : ''}${entries.length ? '' : ' is-empty'}`} inert={confirmPage?.trashed || undefined}>
      <section className="trash-page__list-pane" aria-label={t('Itens na lixeira', 'Items in trash')}>
        {entries.length > 0 && <div className="trash-page__filters">
          <label className="trash-page__search">
            <Search size={16} aria-hidden />
            <input ref={search} type="search" value={query} aria-label={t('Buscar na lixeira', 'Search trash')} placeholder={t('Buscar na lixeira', 'Search trash')}
              onChange={event => { setSelectedId(null); setQuery(event.target.value) }} />
          </label>
          <p className="trash-page__count" role="status">{results.length === 1 ? t('1 item', '1 item') : t('{count} itens', '{count} items', { count: results.length })}</p>
        </div>}
        {results.length ? <ul className="trash-page__list">
          {results.map(item => <li key={item.page.id}>
            <button className="trash-page__item" type="button" aria-current={selectedId === item.page.id ? 'true' : undefined}
              onClick={() => { setNotice(''); setSelectedId(item.page.id) }}>
              <span className="trash-page__icon" aria-hidden>{item.concealed ? <Lock size={18} /> : <PageIcon page={item.page} size={18} />}</span>
              <span className="trash-page__label"><strong title={item.title}>{item.title}</strong>{item.path && <small title={item.path}>{item.path}</small>}</span>
            </button>
          </li>)}
        </ul> : <EmptyState className="trash-page__empty" illustration={term && entries.length ? 'search' : 'pages'} size={72}
          title={entries.length ? t('Nenhum resultado', 'No results') : t('A lixeira está vazia', 'Trash is empty')}>
          {entries.length ? t('Tente outro termo.', 'Try another term.') : t('Os itens que você excluir vão aparecer aqui.', 'Items you delete will appear here.')}
        </EmptyState>}
      </section>
      {entries.length > 0 && <section className="trash-page__preview" aria-label={t('Prévia do item', 'Item preview')}>
        {selected ? <>
          <Button ref={back} className="trash-page__back" variant="ghost" onClick={clearSelection}>
            <ArrowLeft size={16} aria-hidden />{t('Voltar à lista', 'Back to list')}
          </Button>
          <TrashPreview key={selected.page.id} page={selected.page} onRestore={() => restore(selected.page.id)} onDelete={() => setConfirmId(selected.page.id)} />
        </> : <div className="trash-page__placeholder">
          <FileText size={24} aria-hidden />
          <p>{t('Selecione um item para ver o conteúdo.', 'Select an item to see its contents.')}</p>
        </div>}
      </section>}
    </div>
    {confirmPage?.trashed && <DeleteTrashItem key={confirmPage.id} id={confirmPage.id} title={trashPageTitle(confirmPage, selectors.ancestors(confirmPage.id))}
      onClose={() => setConfirmId(null)} onDelete={finishDelete} />}
  </section>
}

function DeleteTrashItem({ id, title, onClose, onDelete }: { id: string; title: string; onClose: () => void; onDelete: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const heading = useId()
  const description = useId()
  const dialog = useRef<HTMLDivElement>(null)
  useModalFocus(dialog)
  async function remove() {
    if (!getState().pages[id]?.trashed) return onClose()
    setBusy(true)
    try {
      await actions.deletePageForever(id)
      onDelete()
    } catch (error) {
      actions.reportSaveError(error)
    } finally { setBusy(false) }
  }
  return createPortal(<div className="trash-page__overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={dialog} tabIndex={-1} className="trash-page__dialog" role="alertdialog" aria-modal="true" aria-labelledby={heading} aria-describedby={description}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() } }}>
      <h2 id={heading}>{t('Excluir “{title}” definitivamente?', 'Permanently delete “{title}”?', { title })}</h2>
      <p id={description}>{t('A exclusão é permanente e inclui todas as páginas dentro deste item.', 'Deletion is permanent and includes all pages inside this item.')}</p>
      <DialogActions destructive busy={busy} confirmLabel={busy ? t('Excluindo…', 'Deleting…') : t('Excluir definitivamente', 'Delete permanently')}
        onConfirm={() => void remove()} onCancel={onClose} />
    </div>
  </div>, document.body)
}
