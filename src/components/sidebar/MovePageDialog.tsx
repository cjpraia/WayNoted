import { t, getLocale } from '../../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderInput, Search, X } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { moveDestinations } from '../modals/search.mts'
import { PageIcon } from './PageTree'
import { movePagesTo } from '../../subpages/actions'
import { announceMove } from '../../subpages/bulk'
import './move.css'

export function MovePageDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { pages, settings } = useStore()
  const page = pages[pageId]
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const targets = useMemo(() => moveDestinations(pages, pageId, query), [pages, pageId, query])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  if (!page) return null
  const move = async (parentId: string | null) => {
    setBusy(true); setError('')
    try { const result = movePagesTo([pageId], parentId); await actions.flushMeta(); announceMove(result); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Não foi possível salvar a mudança. Tente novamente.", "Could not save the change. Please try again.")) }
    finally { setBusy(false) }
  }
  return createPortal(<div className="move-overlay" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()} onKeyDown={e => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); onClose() }
    if (e.key === 'Tab') {
      const focusable = [...(box.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') || [])]
      if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus() }
    }
  }}><div className="move-dialog" role="dialog" aria-modal="true" aria-labelledby="move-title" ref={box}>
    <header><h2 id="move-title">{t("Mover “{title}” para", "Move “{title}” to", {title:page.title || t("Sem título", "Untitled")})}</h2><button onClick={onClose} disabled={busy} aria-label={t("Fechar", "Close")}><X size={18} /></button></header>
    <label className="move-search"><Search size={16} /><input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Buscar uma página…", "Search for a page…")} aria-label={t("Buscar destino", "Search destinations")} /></label>
    <div className="move-targets">
      <button disabled={busy || page.parentId === null} onClick={() => void move(null)}><FolderInput size={18} /><span>{settings.workspaceName || t("Espaço de trabalho", "Workspace")}<small>{t("Particular · nível principal", "Private · top level")}</small></span>{page.parentId === null && <em>{t("Atual", "Current")}</em>}</button>
      {targets.map(target => <button key={target.id} disabled={busy || page.parentId === target.id} onClick={() => void move(target.id)}><PageIcon page={target} size={18} /><span>{target.title || t("Sem título", "Untitled")}<small>{selectors.ancestors(target.id).map(ancestor => ancestor.title || t("Sem título", "Untitled")).join(' / ') || (target.database ? t("Banco de dados", "Database") : t("Página particular", "Private page"))}</small></span>{page.parentId === target.id && <em>{t("Atual", "Current")}</em>}</button>)}
      {!targets.length && <p>{t("Nenhuma página disponível para este destino.", "No page is available as a destination.")}</p>}
    </div>
    {error && <div className="move-error" role="alert">{error}<button disabled={busy} onClick={() => {
      setBusy(true)
      void actions.flushMeta().then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : t("Falha ao salvar.", "Could not save."))).finally(() => setBusy(false))
    }}>{t("Tentar salvar novamente", "Try saving again")}</button></div>}
    <footer>{t("As subpáginas acompanham esta página.", "Subpages move with this page.")}</footer>
  </div></div>, document.body)
}
