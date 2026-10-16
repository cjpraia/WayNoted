// Cartões DOM do quadro: página (editor ao vivo ou prévia estática) e banco (DatabaseView embutido).
import { memo, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { actions, api, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { PageEditor } from '../page/PageEditor'
import { EditorBoundary } from '../page/EditorBoundary'
import { PageIcon } from '../page/PageIcon'
import { loadDraft } from '../page/draftStorage'
import { DatabaseView } from '../database/DatabaseView'
import type { PageCardObject, DatabaseCardObject } from '../../canvas/model'
import { cardInfo } from './canvasActions'
import { CanvasIcon } from './icons'

interface CardProps {
  object: PageCardObject | DatabaseCardObject
  live: boolean
  selected: boolean
  readOnly: boolean
  theme: 'light' | 'dark'
  onActivate(id: string): void
}

/** In-place editor: the same PageEditor as the page, with its own save/draft/conflict pipeline. */
function CardEditor({ pageId, theme, editable }: { pageId: string; theme: 'light' | 'dark'; editable: boolean }) {
  const { t, locale } = useI18n()
  const [doc, setDoc] = useState<{ status: 'loading' } | { status: 'ready'; blocks: unknown[] | null } | { status: 'draft' } | { status: 'error'; message: string }>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const { docRevision } = useStore()
  useEffect(() => {
    let alive = true
    setDoc({ status: 'loading' })
    void (async () => {
      const blocks = await api.loadDoc(pageId)
      const draft = await loadDraft(pageId)
      if (!alive) return
      // Rascunho de recuperação pendente: a escolha acontece na página, nunca silenciosamente no cartão.
      if (draft && JSON.stringify(draft) !== JSON.stringify(blocks)) setDoc({ status: 'draft' })
      else setDoc({ status: 'ready', blocks: Array.isArray(blocks) ? blocks : null })
    })().catch(error => { if (alive) setDoc({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => { alive = false }
  }, [pageId, reload, docRevision])
  const onReady = useCallback(() => {}, [])
  if (doc.status === 'loading') return <div className="cv-card-loading" aria-busy="true" />
  if (doc.status === 'error') return <div className="cv-card-note" role="alert">{doc.message}</div>
  if (doc.status === 'draft') return <div className="cv-card-note">{t('Há um rascunho não salvo desta página.', 'This page has an unsaved draft.')} <button type="button" onClick={() => actions.openPage(pageId)}>{t('Abrir para recuperar', 'Open to recover')}</button></div>
  return <EditorBoundary resetKey={`${pageId}:${reload}`} locale={locale} onRetry={() => setReload(n => n + 1)}>
    <PageEditor pageId={pageId} initial={doc.blocks} theme={theme} editable={editable} onReady={onReady} />
  </EditorBoundary>
}

/** The trashed page itself or its trashed ancestor (restoring that brings the card back). */
function trashedRoot(pages: Record<string, { id: string; parentId: string | null; trashed: boolean }>, id: string): string {
  const seen = new Set<string>()
  let page = pages[id]
  while (page && !seen.has(page.id)) { if (page.trashed) return page.id; seen.add(page.id); page = page.parentId ? pages[page.parentId] : undefined as never }
  return id
}

export const BoardCard = memo(function BoardCard({ object, live, selected, readOnly, theme, onActivate }: CardProps) {
  const { pages, peekPageId } = useStore()
  const { t } = useI18n()
  const info = cardInfo(pages, object.pageId)
  const page = pages[object.pageId]
  const usable = info.state === 'ok'
  // Página protegida (mesmo destrancada) e quadros aninhados ficam estáticos: o PageLockGate só cobre a página.
  const editable = usable && !readOnly && !page?.locked && !page?.passwordLock && !page?.canvas
  const showLive = live && usable && !page?.canvas && !page?.passwordLock && peekPageId !== object.pageId
  const stop = (event: ReactPointerEvent) => { if (showLive) { event.stopPropagation(); onActivate(object.id) } }
  const open = (peek: boolean) => peek ? actions.openPeek(object.pageId, 'side') : actions.openPage(object.pageId)
  return (
    <div className={`cv-card${selected ? ' is-selected' : ''}${showLive ? ' is-live' : ''} cv-card--${info.state}${object.type === 'database' ? ' cv-card--db' : ''}`}
      data-id={object.id} data-page-id={object.pageId}
      style={{ left: object.x, top: object.y, width: object.w, height: object.h }}>
      <div className="cv-card-head" title={info.title}>
        <span className="cv-card-icon">{info.state === 'locked' ? <CanvasIcon name="lock" size={15} /> : page?.icon && info.state === 'ok' ? <PageIcon value={page.icon} /> : <CanvasIcon name={object.type === 'database' ? 'database' : page?.canvas ? 'canvas' : 'page'} size={15} />}</span>
        <span className="cv-card-title">{info.title}</span>
        {usable && <span className="cv-card-actions">
          <button type="button" aria-label={t('Abrir na prévia lateral', 'Open in side peek')} title={t('Abrir na prévia lateral', 'Open in side peek')} onPointerDown={e => e.stopPropagation()} onClick={() => open(true)}><CanvasIcon name="peek" size={15} /></button>
          <button type="button" aria-label={t('Abrir página', 'Open page')} title={t('Abrir página', 'Open page')} onPointerDown={e => e.stopPropagation()} onClick={() => open(false)}><CanvasIcon name="open" size={15} /></button>
        </span>}
      </div>
      <div className="cv-card-body" onPointerDown={stop} onDoubleClick={e => { if (showLive) e.stopPropagation() }}>
        {info.state === 'locked' ? <div className="cv-card-note"><CanvasIcon name="lock" size={22} /><span>{t('Página protegida por senha', 'Password-protected page')}</span></div>
          : info.state === 'missing' ? <div className="cv-card-note">{t('Esta página foi excluída.', 'This page was deleted.')}</div>
          : info.state === 'trash' ? <div className="cv-card-note"><span>{t('Página na lixeira', 'Page in trash')}</span>{!readOnly && page && <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => actions.restorePage(trashedRoot(pages, page.id))}>{t('Restaurar', 'Restore')}</button>}</div>
          : showLive ? object.type === 'database' ? <div className="cv-card-db"><DatabaseView pageId={object.pageId} embedded /></div>
            : <div className={`cv-card-editor${page?.smallText ? ' is-small' : ''}`} data-page-id={object.pageId}><CardEditor pageId={object.pageId} theme={theme} editable={editable} /></div>
          : <div className="cv-card-preview">{page?.canvas ? t('Lousa', 'Whiteboard') : page?.passwordLock ? <span className="cv-card-empty">{t('Conteúdo protegido por senha — abra a página para ver.', 'Password-protected content — open the page to view.')}</span> : object.type === 'database' ? t('Banco de dados', 'Database') : info.excerpt || <span className="cv-card-empty">{t('Página vazia', 'Empty page')}</span>}</div>}
      </div>
    </div>
  )
})
