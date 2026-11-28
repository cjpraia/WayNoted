import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Copy, LockKeyhole, Trash2, Undo2 } from 'lucide-react'
import { copyText } from '../../clipboard'
import { useI18n } from '../../i18n'
import { getState, loadDocForIndex, selectors, useStore } from '../../store'
import type { Page } from '../../types'
import { PageIcon } from '../page/PageIcon'
import { trashPageLabels } from './trashLabels'
import { canReadTrashPreview, readTrashPreview, trashPreviewHtml } from './trashPreviewModel'
import './trashPreview.css'

type DocumentState = { id: string; revision: number; blocks: unknown[] | null }
type CopyStatus = 'copied' | 'empty' | 'error'

export function TrashPreview({ page, onRestore, onDelete }: { page: Page; onRestore(): void; onDelete(): void }) {
  const { locale, t } = useI18n()
  const { pages, syncedBlocks, docRevision } = useStore()
  const { id } = page
  const available = canReadTrashPreview(pages, id)
  const { title, path, concealed } = trashPageLabels(page, selectors.ancestors(id))
  const headingId = useId()
  const content = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<DocumentState | null>(null)
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null)
  const current = loaded?.id === id && loaded.revision === docRevision ? loaded : null

  useEffect(() => {
    setLoaded(null)
    setCopyStatus(null)
    if (!available) return
    let active = true
    void readTrashPreview(id, () => getState().pages, loadDocForIndex).then(blocks => {
      if (active && blocks) setLoaded({ id, revision: docRevision, blocks })
    }).catch(() => {
      if (active) setLoaded({ id, revision: docRevision, blocks: null })
    })
    return () => { active = false }
  }, [id, available, docRevision])

  const html = useMemo(() => {
    if (!available || !current?.blocks) return null
    try { return trashPreviewHtml(document, id, current.blocks, pages, syncedBlocks, locale) }
    catch { return null }
  }, [available, current, id, pages, syncedBlocks, locale])

  const copy = async () => {
    const latest = getState()
    if (!content.current || !html || !canReadTrashPreview(latest.pages, id) || latest.pages !== pages || latest.syncedBlocks !== syncedBlocks || latest.docRevision !== docRevision) return
    const text = content.current.innerText.trim() || [...content.current.querySelectorAll('svg text')].map(label => label.textContent).filter(Boolean).join('\n')
    if (!text) { setCopyStatus('empty'); return }
    try {
      await copyText(text)
      setCopyStatus('copied')
    } catch { setCopyStatus('error') }
  }

  return <section className="trash-preview" aria-labelledby={headingId}>
    <header className="trash-preview__header">
      <div className="trash-preview__heading">
        <span aria-hidden="true" className="trash-preview__icon">
          {concealed ? <LockKeyhole size={24} /> : <PageIcon value={page.icon} fallback={page.canvas ? 'canvas' : page.database ? 'database' : 'page'} style={{ width: 24, height: 24, fontSize: 24 }} />}
        </span>
        <h2 id={headingId} dir="auto">{title}</h2>
      </div>
      {path && <p className="trash-preview__path" dir="auto">{path}</p>}
      <div className="trash-preview__actions">
        <button type="button" className="np-btn np-btn--primary" onClick={onRestore}><Undo2 size={16} aria-hidden="true" />{t('Restaurar', 'Restore')}</button>
        <button type="button" className="np-btn" onClick={() => void copy()} disabled={!html}><Copy size={16} aria-hidden="true" />{t('Copiar conteúdo', 'Copy content')}</button>
        <button type="button" className="np-icon-btn trash-preview__delete" onClick={onDelete} title={t('Excluir definitivamente', 'Delete permanently')} aria-label={t('Excluir definitivamente', 'Delete permanently')}><Trash2 size={16} aria-hidden="true" /></button>
        {available && copyStatus && <span className="trash-preview__status" role="status">{copyStatus === 'copied' ? t('Conteúdo copiado.', 'Content copied.') : copyStatus === 'empty' ? t('Esta página não tem texto para copiar.', 'This page has no text to copy.') : t('Não foi possível copiar o conteúdo.', 'Could not copy the content.')}</span>}
      </div>
    </header>
    <div className="trash-preview__scroll">
      {!available ? <p className="trash-preview__message"><LockKeyhole size={18} aria-hidden="true" />{t('O conteúdo desta página está protegido por senha.', 'This page’s content is password-protected.')}</p>
        : !current ? <p className="trash-preview__message" role="status">{t('Carregando conteúdo…', 'Loading content…')}</p>
        : html === null ? <p className="trash-preview__message" role="alert">{t('Não foi possível abrir o conteúdo da página.', 'Could not open the page content.')}</p>
        : !html ? <p className="trash-preview__message">{t('Esta página está vazia.', 'This page is empty.')}</p>
        : <div className="trash-preview__body" ref={content} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  </section>
}
