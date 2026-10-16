import { t, getLocale } from '../../i18n'
// Popover da lixeira: filtrar, restaurar e excluir definitivamente.
import { useEffect, useRef, useState } from 'react'
import { Search, Trash, Undo2 } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { Popover } from './Popover'
import { PageIcon } from './PageTree'
import { EmptyState } from '../ui/illustrations/Illustration'
export function TrashPopover(props: { anchor: DOMRect; trigger: Element | null; onClose: () => void }) {
  useStore()
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const q = query.trim().toLowerCase()
  const all = selectors.trash()
  const items = q ? all.filter((p) => (p.title || t("Sem título", "Untitled")).toLowerCase().includes(q)) : all

  return (
    <Popover
      anchor={props.anchor}
      placement="right-end"
      offset={10}
      onClose={props.onClose}
      ignore={props.trigger}
      className="sb-trash"
      label={t("Lixeira", "Trash")}
    >
      <div className="sb-trash-search">
        <Search size={16} className="sb-trash-search-icon" aria-hidden />
        <input
          ref={inputRef}
          className="sb-input sb-input--search"
          placeholder={t("Pesquisar páginas na lixeira", "Search pages in trash")}
          aria-label={t("Pesquisar páginas na lixeira", "Search pages in trash")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="sb-trash-list" role="list">
        {items.length === 0 ? (
          <EmptyState className="sb-trash-empty" illustration={all.length ? 'search' : 'pages'} size={72} title={all.length ? t("Nenhum resultado", "No results") : t("A lixeira está vazia", "Trash is empty")}>
            {all.length ? t("Tente outro termo.", "Try another term.") : t("Páginas excluídas ficam aqui até você esvaziar a lixeira.", "Deleted pages stay here until you empty the trash.")}
          </EmptyState>
        ) : (
          items.map((p) => {
            const path = selectors
              .ancestors(p.id)
              .map((a) => a.title.trim() || t("Sem título", "Untitled"))
              .join(' / ')
            const title = p.title.trim() || t("Sem título", "Untitled")
            return (
              <div key={p.id} className="sb-trash-item" role="listitem">
                <span className="sb-row-icon">
                  <PageIcon page={p} />
                </span>
                <span className="sb-trash-text">
                  <span className="sb-trash-title">{title}</span>
                  {path && <span className="sb-trash-path">{path}</span>}
                </span>
                {confirmId === p.id ? (
                  <span className="sb-trash-confirm">
                    <span>{t("Excluir para sempre?", "Delete permanently?")}</span>
                    <button
                      type="button"
                      className="sb-text-btn sb-text-btn--danger"
                      disabled={deleting !== null}
                      onClick={() => {
                        setDeleting(p.id)
                        void actions.deletePageForever(p.id).then(() => setConfirmId(null)).catch(actions.reportSaveError).finally(() => setDeleting(null))
                      }}
                    >
                      {deleting === p.id ? t("Excluindo…", "Deleting…") : t("Excluir", "Delete")}
                    </button>
                    <button type="button" className="sb-text-btn" disabled={deleting !== null} onClick={() => setConfirmId(null)}>
                      {t("Cancelar", "Cancel")}
                    </button>
                  </span>
                ) : (
                  <span className="sb-trash-actions">
                    <button
                      type="button"
                      className="sb-mini-btn"
                      aria-label={t("Restaurar {title}", "Restore {title}", {title})}
                      data-tip={t("Restaurar", "Restore")}
                      onClick={() => actions.restorePage(p.id)}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      type="button"
                      className="sb-mini-btn"
                      aria-label={t("Excluir {title} definitivamente", "Permanently delete {title}", {title})}
                      data-tip={t("Excluir definitivamente", "Delete permanently")}
                      onClick={() => setConfirmId(p.id)}
                    >
                      <Trash size={16} />
                    </button>
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="sb-trash-foot">{t("As páginas na lixeira ficam aqui até você excluí-las definitivamente.", "Pages remain in trash until you delete them permanently.")}</div>
    </Popover>
  )
}
