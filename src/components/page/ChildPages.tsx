import COMPAT from '../../../shared/compatibility.ts'
// Seção "Subpáginas (N)" no fim da página: lista as subpáginas que ainda não aparecem no corpo (bloco de página,
// link ou menção). Pequena e neutra; recolhível (estado lembrado por página), reordenável e com menu por item.
// docs/USAGE.md
import { useMemo, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import { ChevronRight, ExternalLink, FolderInput, GripVertical, Lock, MoreHorizontal, Table2, Trash2, TextCursorInput } from 'lucide-react'
import { actions, selectors, useStore } from '../../store'
import { useI18n } from '../../i18n'
import { isLockedPage, protectedTitle } from '../../security/pageLock'
import { pageTypes, typeDataHidden } from '../../objecttypes/model'
import { PageIcon } from './PageIcon'
import { DbPopover, Menu, MenuItem, MenuSep } from '../database/ui/Popover'
import { MovePageDialog } from '../sidebar/MovePageDialog'
import { showToast } from '../ui/toastQueue'
import { convertibleSubpageCount } from '../../subpages/actions'
import { uncitedChildren } from '../../subpages/plan'
import { openSubpagesDialog } from '../../subpages/ui'
import type { PageEditorType } from './schema'
import '../../subpages/subpages.css'

const KEY = COMPAT.record036
function loadClosed(pageId: string): boolean { try { return localStorage.getItem(KEY + pageId) === '1' } catch { return false } }
function saveClosed(pageId: string, closed: boolean) { try { if (closed) localStorage.setItem(KEY + pageId, '1'); else localStorage.removeItem(KEY + pageId) } catch { /* sem armazenamento */ } }

export function ChildPages({ pageId, locked, editorRef }: { pageId: string; locked: boolean; editorRef: RefObject<PageEditorType | null> }) {
  const { t, locale } = useI18n()
  const { pages, settings } = useStore()
  const page = pages[pageId]
  const [closed, setClosed] = useState(() => loadClosed(pageId))
  const [menu, setMenu] = useState<{ id: string; el: Element } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  // Recém-inseridas no texto: somem da seção até o índice de links alcançar o corpo salvo.
  const [inserted, setInserted] = useState<ReadonlySet<string>>(new Set())
  const children = selectors.children(pageId)
  const ids = useMemo(() => uncitedChildren(children, page?.bodyOutboundPageIds ?? page?.outboundPageIds, inserted), [children, page?.bodyOutboundPageIds, page?.outboundPageIds, inserted])
  if (!page || page.database || ids.length === 0) return null
  const convertible = !locked && convertibleSubpageCount(pageId) > 0
  const types = settings.objectTypes ?? []
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
  const edited = (ts: number) => new Date(ts).toDateString() === new Date().toDateString() ? timeFmt.format(ts) : dateFmt.format(ts)
  const toggle = () => { const next = !closed; setClosed(next); saveClosed(pageId, next) }
  const open = (id: string, newTab: boolean) => newTab ? actions.openInNewTab({ type: 'page', id }) : actions.openPage(id)

  const reorder = (id: string, targetId: string, after: boolean) => {
    if (id === targetId || locked) return
    const rest = selectors.children(pageId).filter((c) => c.id !== id)
    const at = rest.findIndex((c) => c.id === targetId)
    if (at >= 0) actions.movePage(id, pageId, at + (after ? 1 : 0))
  }
  const nudge = (id: string, delta: -1 | 1) => {
    const index = ids.indexOf(id), target = ids[index + delta]
    if (target) reorder(id, target, delta === 1)
  }
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !locked) { e.preventDefault(); nudge(id, e.key === 'ArrowUp' ? -1 : 1); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const buttons = [...(e.currentTarget.closest('.cp-list')?.querySelectorAll<HTMLElement>('.cp-open') ?? [])]
      const next = buttons[buttons.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) { e.preventDefault(); next.focus() }
    }
  }
  const onDragOver = (e: DragEvent, id: string) => {
    if (!drag || drag === id) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    if (over?.id !== id || over.after !== after) setOver({ id, after })
  }
  const insertInText = async (id: string) => {
    const block = { type: 'page', props: { pageId: id, ownership: 'linked', display: 'page' }, children: [] as unknown[] }
    try {
      const editor = editorRef.current
      if (editor && editor.isEditable !== false) {
        const document = editor.document
        const reference = editor.isFocused() ? editor.getTextCursorPosition().block : document[document.length - 1]
        editor.insertBlocks([block as never], reference, 'after')
      } else await actions.appendPageBlocks(pageId, [{ ...block, id: crypto.randomUUID() }])
      setInserted((current) => new Set(current).add(id))
    } catch (error) { actions.reportSaveError(error) }
  }
  const trash = (id: string) => {
    const title = pages[id]?.title || t('Sem título', 'Untitled')
    actions.trashPage(id)
    showToast({ message: t('“{title}” foi para a lixeira.', '“{title}” moved to trash.', { title }), actionLabel: t('Desfazer', 'Undo'), onAction: () => actions.restorePage(id) })
  }

  const menuPage = menu ? pages[menu.id] : undefined
  return (
    <section className="cp" aria-label={t('Subpáginas', 'Subpages')} data-child-pages>
      <div className="cp-head">
        <button type="button" className="cp-toggle" aria-expanded={!closed} onClick={toggle}>
          <ChevronRight size={14} aria-hidden />
          <span>{t('Subpáginas', 'Subpages')} <span className="cp-count">({ids.length})</span></span>
        </button>
        <span className="cp-spacer" />
        {convertible && <button type="button" className="cp-convert" onClick={() => openSubpagesDialog({ kind: 'subpages', pageId })}><Table2 size={14} aria-hidden />{t('Transformar subpáginas em banco de dados', 'Turn subpages into a database')}</button>}
      </div>
      {!closed && (
        <ul className="cp-list" role="list">
          {ids.map((id) => {
            const child = pages[id]
            if (!child) return null
            const hiddenTitle = protectedTitle(child, t('Página protegida', 'Protected page'))
            const secret = isLockedPage(child)
            const title = hiddenTitle ?? (child.title.trim() || t('Sem título', 'Untitled'))
            const type = secret || typeDataHidden(child) ? undefined : pageTypes(types, child)[0]
            const extraTypes = secret ? 0 : Math.max(0, pageTypes(types, child).length - 1)
            const cls = ['cp-item', drag === id && 'is-dragging', over?.id === id && !over.after && 'is-over', over?.id === id && over.after && 'is-over-after'].filter(Boolean).join(' ')
            return (
              <li key={id} className={cls} data-child-id={id}
                draggable={!locked}
                onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
                onDragOver={(e) => onDragOver(e, id)}
                onDragLeave={() => setOver((o) => o?.id === id ? null : o)}
                onDrop={(e) => { e.preventDefault(); if (drag && over) reorder(drag, over.id, over.after); setDrag(null); setOver(null) }}
                onDragEnd={() => { setDrag(null); setOver(null) }}>
                {!locked && <span className="cp-grip" aria-hidden title={t('Arraste para reordenar', 'Drag to reorder')}><GripVertical size={14} /></span>}
                <button type="button" className="cp-open" onKeyDown={(e) => onKey(e, id)}
                  onClick={(e) => open(id, e.metaKey || e.ctrlKey)}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(id, true) } }}
                  aria-keyshortcuts={locked ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}>
                  <span className="cp-icon" aria-hidden>{secret && child.passwordLock?.hideTitle ? <Lock size={16} /> : <PageIcon value={child.icon} fallback={child.database ? 'database' : child.canvas ? 'canvas' : 'page'} style={{ width: 18, height: 18 }} />}</span>
                  <span className="cp-title">{title}</span>
                  {type && <span className="cp-chip">{type.name}{extraTypes > 0 ? ` +${extraTypes}` : ''}</span>}
                  {!secret && <span className="cp-date">{edited(child.updatedAt)}</span>}
                </button>
                <button type="button" className="cp-more" aria-label={t('Mais ações para “{title}”', 'More actions for “{title}”', { title })} aria-haspopup="menu" aria-expanded={menu?.id === id}
                  onClick={(e) => setMenu(menu?.id === id ? null : { id, el: e.currentTarget })}><MoreHorizontal size={16} aria-hidden /></button>
              </li>
            )
          })}
        </ul>
      )}
      {menu && menuPage && (
        <DbPopover anchor={menu.el} onClose={() => setMenu(null)} ignore={menu.el} label={t('Ações da subpágina', 'Subpage actions')}>
          <Menu width={236}>
            <MenuItem icon={<ExternalLink size={16} />} label={t('Abrir', 'Open')} onClick={() => { open(menu.id, false); setMenu(null) }} />
            <MenuItem icon={<ExternalLink size={16} />} label={t('Abrir em nova aba', 'Open in new tab')} hint="⌘↵" onClick={() => { open(menu.id, true); setMenu(null) }} />
            {!locked && <MenuItem icon={<TextCursorInput size={16} />} label={t('Inserir no texto', 'Insert in text')} onClick={() => { const id = menu.id; setMenu(null); void insertInText(id) }} />}
            {!locked && <MenuItem icon={<FolderInput size={16} />} label={t('Mover para…', 'Move to…')} onClick={() => { setMoving(menu.id); setMenu(null) }} />}
            {!locked && <><MenuSep /><MenuItem danger icon={<Trash2 size={16} />} label={t('Excluir', 'Delete')} onClick={() => { const id = menu.id; setMenu(null); trash(id) }} /></>}
          </Menu>
        </DbPopover>
      )}
      {moving && <MovePageDialog pageId={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}
