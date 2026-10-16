// Diálogos de conversão entre páginas e bancos de dados (montado no App). docs/USAGE.md
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Database, Search, X } from 'lucide-react'
import { actions, useStore } from '../store.ts'
import { useI18n } from '../i18n.ts'
import { protectedTitle } from '../security/pageLock.ts'
import { PageIcon } from '../components/sidebar/PageTree.tsx'
import { showToast } from '../components/ui/toastQueue.ts'
import { closeSubpagesDialog, useSubpagesDialog, type SubpagesDialog } from './ui.ts'
import { clearSelection } from './selection.ts'
import {
  convertDatabaseToPages, convertPageToDatabase, convertSubpagesToDatabase, createDatabaseFromPages, databaseConversionBlocker, databaseTargets,
  describeExclusion, movePagesToDatabase, pageConversionBlocker, previewPage, previewSelection, previewSubpages, selectionConversionBlocker, subpageConversionBlocker,
  type ConversionPreview,
} from './actions.ts'
import '../components/sidebar/move.css'
import './subpages.css'
import { Button } from '../components/ui/Button'

const undoNotice = (message: string) => showToast({ message, actionLabel: 'Desfazer', onAction: () => { actions.undoDatabase() } })

/** ⌘Z / ⌘⇧Z desfazem e refazem conversões de páginas ↔ bancos também fora de telas de banco (fora de campos de texto). */
function useStructureUndoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.ProseMirror, .bn-editor, [role="dialog"]'))) return
      const ok = e.shiftKey ? actions.nextRedoIsStructural() && actions.redoDatabase() : actions.nextUndoIsStructural() && actions.undoDatabase()
      if (ok) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function SubpagesHost() {
  const dialog = useSubpagesDialog()
  useStructureUndoKeys()
  if (!dialog) return null
  return dialog.kind === 'move' ? <MoveToDatabaseDialog ids={dialog.ids} /> : <ConvertDialog dialog={dialog} />
}

function useDialogChrome(onClose: () => void, busy: boolean) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); onClose() }
    if (e.key === 'Tab') {
      const focusable = [...(box.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled)') ?? [])]
      if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0]?.focus() }
    }
  }
  return { box, onKeyDown }
}

function previewOf(dialog: Exclude<SubpagesDialog, { kind: 'move' } | { kind: 'database-to-pages' }>): ConversionPreview {
  return dialog.kind === 'selection' ? previewSelection(dialog.ids) : dialog.kind === 'page' ? previewPage(dialog.pageId) : previewSubpages(dialog.pageId)
}

function ConvertDialog({ dialog }: { dialog: Exclude<SubpagesDialog, { kind: 'move' }> }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { box, onKeyDown } = useDialogChrome(closeSubpagesDialog, busy)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { confirmRef.current?.focus() }, [])
  const toDatabase = dialog.kind !== 'database-to-pages'
  const preview = useMemo(() => toDatabase ? previewOf(dialog) : null, [dialog, pages, toDatabase])
  const blocker = dialog.kind === 'subpages' ? subpageConversionBlocker(dialog.pageId)
    : dialog.kind === 'page' ? pageConversionBlocker(dialog.pageId)
    : dialog.kind === 'selection' ? selectionConversionBlocker(dialog.ids)
    : databaseConversionBlocker(dialog.dbId)
  const target = dialog.kind === 'subpages' || dialog.kind === 'page' ? pages[dialog.pageId] : dialog.kind === 'database-to-pages' ? pages[dialog.dbId] : undefined
  const title = protectedTitle(target ?? ({} as never), t('Página protegida', 'Protected page')) ?? (target?.title || t('Sem título', 'Untitled'))
  const rowCount = dialog.kind === 'database-to-pages' ? Object.values(pages).filter((p) => p.parentId === dialog.dbId && !p.trashed).length : preview?.eligible.length ?? 0
  const heading = dialog.kind === 'subpages' ? (rowCount === 1 ? t('Transformar 1 subpágina em linha de um banco?', 'Turn 1 subpage into a row of a database?') : t('Transformar {n} subpáginas em linhas de um banco?', 'Turn {n} subpages into rows of a database?', { n: rowCount }))
    : dialog.kind === 'selection' ? (rowCount === 1 ? t('Criar um banco de dados com 1 página?', 'Create a database with 1 page?') : t('Criar um banco de dados com {n} páginas?', 'Create a database with {n} pages?', { n: rowCount }))
    : dialog.kind === 'page' ? t('Transformar “{title}” em banco de dados?', 'Turn “{title}” into a database?', { title })
    : t('Converter “{title}” em páginas?', 'Convert “{title}” to pages?', { title })
  const confirm = async () => {
    setBusy(true); setError('')
    try {
      if (dialog.kind === 'subpages') {
        const result = await convertSubpagesToDatabase(dialog.pageId)
        undoNotice(result.moved === 1 ? t('1 subpágina virou linha de “{name}”.', '1 subpage became a row of “{name}”.', { name: pages[result.dbId]?.title || t('banco', 'database') }) : t('{n} subpáginas viraram linhas.', '{n} subpages became rows.', { n: result.moved }))
      } else if (dialog.kind === 'selection') {
        const result = createDatabaseFromPages(dialog.ids)
        clearSelection()
        actions.openPage(result.dbId)
        undoNotice(t('Banco criado com {n} páginas.', 'Database created with {n} pages.', { n: result.moved }))
      } else if (dialog.kind === 'page') {
        const result = await convertPageToDatabase(dialog.pageId)
        undoNotice(t('A página agora é um banco de dados com {n} linhas.', 'The page is now a database with {n} rows.', { n: result.moved }))
      } else {
        const result = convertDatabaseToPages(dialog.dbId)
        undoNotice(result.hidden ? t('{n} linhas voltaram a ser subpáginas. {h} valores de propriedades ficam guardados.', '{n} rows are subpages again. {h} property values are kept.', { n: result.rows, h: result.hidden }) : t('{n} linhas voltaram a ser subpáginas.', '{n} rows are subpages again.', { n: result.rows }))
      }
      await actions.flushMeta()
      closeSubpagesDialog()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível converter.', 'Could not convert.')) }
    finally { setBusy(false) }
  }
  const nameOf = (id: string) => { const p = pages[id]; return (p ? protectedTitle(p, t('Página protegida', 'Protected page')) : null) ?? (p?.title || t('Sem título', 'Untitled')) }
  const disabled = busy || !!blocker || (toDatabase && dialog.kind !== 'page' && !rowCount)
  return createPortal(<div className="sp-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeSubpagesDialog()} onKeyDown={onKeyDown}>
    <div className="sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-title" ref={box}>
      <header><h2 id="sp-title">{heading}</h2><button type="button" onClick={closeSubpagesDialog} disabled={busy} aria-label={t('Fechar', 'Close')}><X size={16} /></button></header>
      <div className="sp-body">
        {blocker && <p className="sp-warn" role="alert">{blocker}</p>}
        {!blocker && dialog.kind === 'subpages' && <p>{t('Uma tabela será criada dentro desta página. As subpáginas viram as linhas dela, com o mesmo conteúdo e links.', 'A table will be created inside this page. The subpages become its rows, with the same content and links.')}</p>}
        {!blocker && dialog.kind === 'selection' && <p>{t('O banco fica no lugar da primeira página selecionada e as páginas viram as linhas dele.', 'The database takes the place of the first selected page and the pages become its rows.')}</p>}
        {!blocker && dialog.kind === 'page' && <p>{t('O texto da página fica acima da tabela, como descrição. Título, ícone e capa continuam; as subpáginas viram linhas.', 'The page text stays above the table as a description. Title, icon and cover stay; subpages become rows.')}</p>}
        {!blocker && dialog.kind === 'database-to-pages' && <p>{t('Cada linha volta a ser uma subpágina comum, com o conteúdo intacto. Os valores das propriedades ficam guardados e voltam se a página entrar de novo num banco com as mesmas propriedades.', 'Each row becomes a regular subpage with its content intact. Property values are kept and return if the page joins a database with the same properties again.')}</p>}
        {!blocker && preview && preview.typeId && <p className="sp-note">{t('{n} de {total} são “{type}”: o banco terá os campos desse tipo.', '{n} of {total} are “{type}”: the database will have that object type’s fields.', { n: preview.typeCount, total: preview.eligible.length, type: preview.typeName })}</p>}
        {!blocker && preview && preview.carried.length > 0 && <p className="sp-note">{t('Também entram as propriedades já preenchidas: {names}.', 'Already filled properties also come along: {names}.', { names: preview.carried.join(', ') })}</p>}
        {!blocker && preview && preview.citedInBody > 0 && <p className="sp-note">{t('{n} já aparecem no texto da página e continuam lá.', '{n} already appear in the page text and stay there.', { n: preview.citedInBody })}</p>}
        {!blocker && preview && preview.excluded.length > 0 && <div className="sp-note"><strong>{dialog.kind === 'page' ? t('Ficam como estão:', 'Stay as they are:') : t('Ficam de fora:', 'Left out:')}</strong>
          <ul>{preview.excluded.slice(0, 6).map((e) => <li key={e.id}>{nameOf(e.id)} <span>({describeExclusion(e.reason)})</span></li>)}{preview.excluded.length > 6 && <li>{t('e mais {n}', 'and {n} more', { n: preview.excluded.length - 6 })}</li>}</ul></div>}
        {error && <p className="sp-warn" role="alert">{error}</p>}
      </div>
      <footer>
        <span className="sp-hint">{t('Dá para desfazer com ⌘Z.', 'You can undo with ⌘Z.')}</span>
        <Button onClick={closeSubpagesDialog} disabled={busy}>{t('Cancelar', 'Cancel')}</Button>
        <Button variant="primary" ref={confirmRef} disabled={disabled} onClick={() => void confirm()}>{busy ? t('Convertendo…', 'Converting…') : dialog.kind === 'database-to-pages' ? t('Converter em páginas', 'Convert to pages') : dialog.kind === 'page' ? t('Transformar em banco', 'Turn into database') : dialog.kind === 'selection' ? t('Criar banco', 'Create database') : t('Transformar', 'Turn into rows')}</Button>
      </footer>
    </div>
  </div>, document.body)
}

function MoveToDatabaseDialog({ ids }: { ids: string[] }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { box, onKeyDown } = useDialogChrome(closeSubpagesDialog, busy)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const targets = useMemo(() => databaseTargets(ids, query), [ids, query, pages])
  const move = async (dbId: string) => {
    setBusy(true); setError('')
    try {
      const result = movePagesToDatabase(ids, dbId)
      await actions.flushMeta()
      clearSelection()
      closeSubpagesDialog()
      const skipped = result.excluded.length ? t(' {n} ficaram de fora (protegidas, bloqueadas ou bancos).', ' {n} were left out (protected, locked or databases).', { n: result.excluded.length }) : ''
      undoNotice((result.moved === 1 ? t('Adicionada como linha de “{name}”.', 'Added as a row of “{name}”.', { name: result.databaseTitle || t('banco', 'database') }) : t('{n} páginas adicionadas como linhas de “{name}”.', '{n} pages added as rows of “{name}”.', { n: result.moved, name: result.databaseTitle || t('banco', 'database') })) + skipped)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Não foi possível mover.', 'Could not move.')) }
    finally { setBusy(false) }
  }
  return createPortal(<div className="move-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeSubpagesDialog()} onKeyDown={onKeyDown}>
    <div className="move-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-move-title" ref={box}>
      <header><h2 id="sp-move-title">{ids.length === 1 ? t('Mover para um banco de dados', 'Move to a database') : t('Mover {n} páginas para um banco de dados', 'Move {n} pages to a database', { n: ids.length })}</h2><button type="button" onClick={closeSubpagesDialog} disabled={busy} aria-label={t('Fechar', 'Close')}><X size={16} /></button></header>
      <label className="move-search"><Search size={16} /><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Buscar um banco de dados…', 'Search for a database…')} aria-label={t('Buscar um banco de dados', 'Search for a database')} /></label>
      <div className="move-targets">
        {targets.map((db) => <button type="button" key={db.id} disabled={busy} onClick={() => void move(db.id)}><PageIcon page={db} size={18} /><span>{protectedTitle(db, t('Página protegida', 'Protected page')) ?? (db.title || t('Sem título', 'Untitled'))}</span></button>)}
        {!targets.length && <p><Database size={14} /> {t('Nenhum banco de dados disponível.', 'No database available.')}</p>}
      </div>
      {error && <div className="move-error" role="alert">{error}</div>}
      <footer>{t('Os valores das propriedades de mesmo nome e tipo são copiados. Dá para desfazer com ⌘Z.', 'Values of properties with the same name and type are copied. You can undo with ⌘Z.')}</footer>
    </div>
  </div>, document.body)
}
