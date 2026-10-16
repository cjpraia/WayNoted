// Página do tipo "Quadro": carrega/grava o documento (mesmo protocolo do editor) e monta a superfície.
import { useCallback, useEffect, useRef, useState } from 'react'
import { actions, api, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { flushDoc, isDocDirty, markDocDirty, registerFlush } from '../page/util'
import { PageIcon } from '../page/PageIcon'
import { canvasDocument, readCanvasDocument, type CanvasData, type CanvasDocument } from '../../canvas/model'
import { CanvasBoard } from './CanvasBoard'
import { CanvasIcon } from './icons'
import './canvas.css'

const SAVE_DELAY = 500

type LoadState = { status: 'loading' } | { status: 'ready'; doc: CanvasDocument; key: number } | { status: 'error'; message: string }

export function CanvasView({ pageId, theme, embedded }: { pageId: string; theme: 'light' | 'dark'; embedded?: boolean }) {
  const { t } = useI18n()
  const { docRevision, route } = useStore()
  const page = selectors.page(pageId)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [saveError, setSaveError] = useState<string | null>(null)
  const docRef = useRef<CanvasDocument | null>(null)
  const persistedBase = useRef<string | null>(null)
  const lastSaved = useRef<string | null>(null)
  const pending = useRef<CanvasData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  const owner = useRef(crypto.randomUUID())
  const loads = useRef(0)

  useEffect(() => {
    if (isDocDirty(pageId) && state.status === 'ready') return
    let alive = true
    setState({ status: 'loading' })
    void (async () => {
      const blocks = await api.loadDoc(pageId)
      if (!alive) return
      const doc = readCanvasDocument(blocks)
      docRef.current = doc
      persistedBase.current = blocks === null ? null : JSON.stringify(blocks)
      lastSaved.current = persistedBase.current
      setState({ status: 'ready', doc, key: ++loads.current })
    })().catch(error => { if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => { alive = false }
  }, [pageId, docRevision])

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (saving.current) { await saving.current; if (!pending.current) return; return flush() }
    if (!pending.current || !docRef.current) return
    const operation = (async () => {
      while (pending.current && docRef.current) {
        const data = pending.current
        const blocks = canvasDocument(data, docRef.current.blockId, docRef.current.preserved)
        const json = JSON.stringify(blocks)
        if (json === lastSaved.current) { pending.current = pending.current === data ? null : pending.current; continue }
        try {
          await api.saveDoc(pageId, blocks, { base: persistedBase.current, page: selectors.page(pageId), userEdit: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setSaveError(message)
          actions.reportSaveError(error)
          if (/DOC_(CONFLICT|DELETED)/.test(message)) { lastSaved.current = json; if (pending.current === data) pending.current = null; continue }
          throw error
        }
        lastSaved.current = json; persistedBase.current = json
        docRef.current = { ...docRef.current, data }
        setSaveError(null)
        if (pending.current === data) pending.current = null
      }
      markDocDirty(pageId, false, owner.current)
    })()
    saving.current = operation
    try { await operation } finally { saving.current = null }
  }, [pageId])

  useEffect(() => {
    const unregister = registerFlush(pageId, flush)
    const onUnload = () => void flush().catch(() => {})
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('beforeunload', onUnload); void flush().then(unregister).catch(() => {}) }
  }, [pageId, flush])

  const onChange = useCallback((data: CanvasData) => {
    pending.current = data
    markDocDirty(pageId, true, owner.current)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush().catch(() => {}), SAVE_DELAY)
  }, [pageId, flush])

  if (!page) return null
  const readOnly = !!page.locked
  const focusId = route.type === 'page' && route.id === pageId ? route.blockId : undefined
  return (
    <div className={`cv-root${embedded ? ' is-embedded' : ''}`} data-page-id={pageId}>
      <header className="cv-header">
        <span className="cv-header-icon">{page.icon ? <PageIcon value={page.icon} /> : <CanvasIcon name="canvas" size={18} />}</span>
        <input className="cv-title" value={page.title} placeholder={t('Lousa sem título', 'Untitled whiteboard')} aria-label={t('Título da lousa', 'Whiteboard title')} readOnly={readOnly}
          onChange={e => actions.updatePage(pageId, { title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget.closest('.cv-root')?.querySelector('.cv-surface') as HTMLElement | null)?.focus() }} />
        {readOnly && <span className="cv-badge"><CanvasIcon name="lock" size={13} /> {t('Bloqueado', 'Locked')}</span>}
      </header>
      {saveError && <div className="pg-save-error" role="alert">{t('Falha ao salvar', 'Save failed')}: {saveError} {/DOC_CONFLICT/.test(saveError)
        ? <button onClick={() => void (async () => { await flush(); await flushDoc(pageId); await actions.reloadDocument(pageId) })().catch(actions.reportSaveError)}>{t('Carregar versão salva; manter minha cópia no histórico', 'Load saved version; keep my copy in history')}</button>
        : <button onClick={() => void flush().catch(() => {})}>{t('Tentar novamente', 'Try again')}</button>}</div>}
      {state.status === 'loading' && <div className="cv-loading" aria-busy="true">{t('Abrindo lousa…', 'Opening whiteboard…')}</div>}
      {state.status === 'error' && <div className="pg-load-error" role="alert"><strong>{t('Não foi possível abrir esta lousa.', 'Could not open this whiteboard.')}</strong><span>{state.message}</span></div>}
      {state.status === 'ready' && <CanvasBoard key={state.key} pageId={pageId} title={page.title} data={state.doc.data} readOnly={readOnly} theme={theme} focusId={focusId} onChange={onChange} />}
    </div>
  )
}
