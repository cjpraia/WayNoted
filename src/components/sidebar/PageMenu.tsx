import { t, getLocale } from '../../i18n'
// Menu de contexto de uma página e popover de renomear.
import { useEffect, useRef, useState } from 'react'
import { Copy, Link2, PenLine, Star, StarOff, Trash, FolderInput, ExternalLink } from 'lucide-react'
import { actions, selectors } from '../../store'
import { copyText } from '../../clipboard'
import { MenuItem, Popover, menuKeyNav, type Anchor } from './Popover'
import { PageIcon } from './PageTree'
import { MovePageDialog } from './MovePageDialog'
import { flushDoc } from '../page/util'
import { Tag, Table2 } from 'lucide-react'
import { openTypePicker } from '../../objecttypes/ui'
import { openSubpagesDialog } from '../../subpages/ui'
import { convertibleSubpageCount } from '../../subpages/actions'

export function formatEdited(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const time = d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff === 0) return t("Hoje às {time}", "Today at {time}", {time})
  if (diff === 1) return t("Ontem às {time}", "Yesterday at {time}", {time})
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return t("{date} às {time}", "{date} at {time}", {date:d.toLocaleDateString(getLocale(), opts),time})
}

export function PageMenu(props: {
  pageId: string
  anchor: Anchor
  trigger: Element | null
  onClose: () => void
  onRename: () => void
}) {
  const page = selectors.page(props.pageId)
  const menuRef = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    menuRef.current?.focus()
  }, [])
  if (!page) return null
  const close = props.onClose
  if (moving) return <MovePageDialog pageId={page.id} onClose={close} />
  return (
    <Popover
      anchor={props.anchor}
      placement={'width' in props.anchor ? 'bottom-start' : 'point'}
      onClose={close}
      ignore={props.trigger}
      className="sb-menu"
      label={t("Ações da página", "Page actions")}
    >
      <div ref={menuRef} role="menu" tabIndex={-1} className="sb-menu-body" onKeyDown={menuKeyNav}>
        <div className="sb-menu-group">
          <MenuItem
            icon={page.favorite ? <StarOff size={18} /> : <Star size={18} />}
            label={page.favorite ? t("Remover dos favoritos", "Remove from favorites") : t("Adicionar aos favoritos", "Add to favorites")}
            onClick={() => {
              actions.toggleFavorite(page.id)
              close()
            }}
          />
        </div>
        <div className="sb-menu-sep" />
        <div className="sb-menu-group">
          <MenuItem
            icon={<Link2 size={18} />}
            label={t("Copiar link", "Copy link")}
            onClick={() => {
              void (async () => {
                try { await copyText(`workspace://page/${page.id}`); close() }
                catch (cause) { setError(cause instanceof Error ? cause.message : t("Não foi possível copiar o link.", "Could not copy the link.")) }
              })()
            }}
          />
          <MenuItem
            icon={<Copy size={18} />}
            label={busy ? t("Duplicando…", "Duplicating…") : t("Duplicar", "Duplicate")}
            disabled={busy}
            onClick={() => {
              if (busy) return
              setBusy(true); setError('')
              void (async () => {
                try { await flushDoc(page.id); const id = await actions.duplicatePage(page.id); await actions.flushMeta(); if (id) actions.openPage(id); close() }
                catch (cause) { setError(cause instanceof Error ? cause.message : t("Não foi possível duplicar a página.", "Could not duplicate the page.")) }
                finally { setBusy(false) }
              })()
            }}
          />
          <MenuItem icon={<ExternalLink size={18} />} label={t("Abrir em nova aba", "Open in new tab")} onClick={() => { actions.openInNewTab({ type: 'page', id: page.id }); close() }} />
          <MenuItem icon={<FolderInput size={18} />} label={t("Mover para…", "Move to…")} onClick={() => setMoving(true)} />
          {!page.locked && <MenuItem icon={<Tag size={18} />} label={page.database ? t("Aplicar tipo às linhas…", "Apply type to rows…") : t("Aplicar tipo…", "Apply type…")} onClick={() => { const a = props.anchor; openTypePicker([page.id], 'width' in a ? { x: a.left, y: a.bottom } : a); close() }} />}
          {!page.database && convertibleSubpageCount(page.id) > 0 && <MenuItem icon={<Table2 size={18} />} label={t("Transformar subpáginas em banco de dados", "Turn subpages into a database")} onClick={() => { close(); openSubpagesDialog({ kind: 'subpages', pageId: page.id }) }} />}
          <MenuItem icon={<PenLine size={18} />} label={t("Renomear", "Rename")} disabled={page.locked && !page.database} onClick={props.onRename} />
        </div>
        <div className="sb-menu-sep" />
        <div className="sb-menu-group">
          <MenuItem
            icon={<Trash size={18} />}
            label={t("Mover para a lixeira", "Move to trash")}

            danger
            onClick={() => {
              actions.trashPage(page.id)
              close()
            }}
          />
        </div>
        <div className="sb-menu-sep" />
        {error && <div className="sb-action-error" role="alert">{error}</div>}
        <div className="sb-menu-footer">{t("Última edição: {date}", "Last edited: {date}", {date:formatEdited(page.updatedAt)})}</div>
      </div>
    </Popover>
  )
}

export function RenamePopover(props: { pageId: string; anchor: DOMRect; onClose: () => void }) {
  const page = selectors.page(props.pageId)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  if (!page) return null
  const width = Math.max(260, Math.min(props.anchor.width, 360))
  return (
    <Popover anchor={props.anchor} placement="bottom-start" offset={2} onClose={props.onClose} className="sb-rename" style={{ width }} label={t("Renomear página", "Rename page")}>
      <span className="sb-rename-icon" aria-hidden>
        <PageIcon page={page} size={18} />
      </span>
      <input
        ref={inputRef}
        className="sb-input"
        aria-label={t("Título da página", "Page title")}
        placeholder={t("Sem título", "Untitled")}
        defaultValue={page.title}
        onChange={(e) => actions.updatePage(page.id, { title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') props.onClose()
        }}
      />
    </Popover>
  )
}
