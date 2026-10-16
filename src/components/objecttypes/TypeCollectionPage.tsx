// Coleção de um tipo como tela própria (rota `objectType`): título, ícone e descrição como uma página, as
// visualizações dos bancos, "+ Novo" já com o tipo, "Editar tipo" e a ponte "Transformar em banco de dados".
// As páginas continuam onde estão ("Ver onde"). docs/USAGE.md
import { useEffect, useMemo, useState } from 'react'
import { Database, Link2, MoreHorizontal, Plus, Settings2, Trash2 } from 'lucide-react'
import { actions, useStore } from '../../store'
import { copyText } from '../../clipboard'
import { useI18n } from '../../i18n'
import type { Page } from '../../types'
import { PageIcon } from '../page/PageIcon'
import { EmptyState } from '../ui/illustrations/Illustration'
import { DialogActions } from '../ui/DialogActions'
import { DbPopover, Menu, MenuItem, MenuLabel, MenuSep } from '../database/ui/Popover'
import { normalizeSearch } from '../modals/search.mts'
import { findType, pagesWithType, typeIndex, type ObjectType } from '../../objecttypes/model'
import { createObject, objectTypes } from '../../objecttypes/actions'
import { convertTypeToDatabase, previewTypeToDatabase } from '../../objecttypes/bridge'
import { openTypesManager, showTypesToast } from '../../objecttypes/ui'
import { applyTypeFlow } from './TypePicker'
import { useHarvests } from './Harvest'
import { pendingFields } from '../../objecttypes/harvest'
import { TypeCollection } from './TypeCollection'
import { UntypedPages } from './UntypedPages'
import { DeleteTypeDialog } from './TypesManager'
import { fieldSummary } from '../../objecttypes/visibility'
import '../database/dbview.css'
import './objecttypes.css'
import { Button, IconButton } from '../ui/Button'

/** "Particular › Projetos › Ana" — onde a página mora na árvore. */
export function pagePath(page: Page, pages: Record<string, Page>, root: string): string {
  const parts: string[] = []
  let parent = page.parentId ? pages[page.parentId] : undefined
  for (let depth = 0; parent && depth < 32; depth++) { parts.unshift(parent.title || '…'); parent = parent.parentId ? pages[parent.parentId] : undefined }
  return [root, ...parts].join(' › ')
}

export function TypeCollectionPage({ typeId }: { typeId: string }) {
  const { t } = useI18n()
  const { pages, settings } = useStore()
  const type = findType(settings.objectTypes ?? [], typeId)
  const [where, setWhere] = useState<Element | null>(null)
  const [more, setMore] = useState<Element | null>(null)
  const [adding, setAdding] = useState<Element | null>(null)
  const [converting, setConverting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { harvests, dismissed } = useHarvests()
  useEffect(() => { if (!type) actions.navigate({ type: 'home' }) }, [type])
  if (!type) return null
  const count = typeIndex(pages, objectTypes()).get(type.id)?.length ?? 0
  const open = (id: string, ids: string[]) => { void ids; actions.openPage(id) }
  const createNew = () => actions.openPage(createObject(type.id))
  const empty = <EmptyState illustration="pages" title={t('Nenhuma página com o tipo {name} ainda', 'No pages with the {name} type yet', { name: type.name })}
    action={<div className="ot-row ot-row--center">
      <Button variant="primary" onClick={createNew}><Plus size={14} /> {t('Nova página {name}', 'New {name} page', { name: type.name })}</Button>
      <Button onClick={(e) => setAdding(e.currentTarget)}>{t('Aplicar a uma página existente', 'Apply to an existing page')}</Button>
    </div>}>
    {t('Crie uma página já com os campos e o modelo, ou aplique o tipo a uma página que você já tem. Ela continua onde está.', 'Create a page that already has the fields and template, or apply the type to a page you already have. It stays where it is.')}
    {type.properties.length > 0 && <span className="ot-page-note" data-ot="type-example"> {t('Exemplo: cada página {name} terá {list}.', 'Example: each {name} page will have {list}.', { name: type.name, list: fieldSummary(type.properties.map((prop) => prop.name), 4) })}</span>}
  </EmptyState>
  return <div className="ot-page" data-ot="collection-page">
    <header className="ot-page-head">
      <span className={`ot-page-icon db-color-${type.color}`} aria-hidden><PageIcon value={type.icon || 'lucide:tag:gray'} style={{ width: 28, height: 28 }} /></span>
      <div className="ot-page-title">
        <h1 className="np-display">{type.name || t('Sem nome', 'Untitled')}</h1>
        {type.description && <p>{type.description}</p>}
        <p className="ot-page-note">
          {count ? t('{n} página(s) com este tipo.', '{n} page(s) with this type.', { n: count }) + ' ' : ''}
          {t('As páginas continuam onde estão.', 'Pages stay where they are.')}
          {pendingFields(harvests.get(typeId), dismissed[typeId]).length > 0 && <> <button type="button" className="ot-link" data-ot="review-badge" onClick={() => openTypesManager(typeId, 'fields')}>{t('{n} campo(s) a revisar', '{n} field(s) to review', { n: pendingFields(harvests.get(typeId), dismissed[typeId]).length })}</button></>}
          {count > 0 && <> <button type="button" className="ot-link" aria-expanded={!!where} onClick={(e) => setWhere(where ? null : e.currentTarget)}>{t('Ver onde', 'See where')}</button></>}
        </p>
      </div>
      <div className="ot-page-actions">
        <Button onClick={() => openTypesManager(type.id)}><Settings2 size={14} /> {t('Editar tipo', 'Edit type')}</Button>
        <IconButton label={t('Mais ações do tipo', 'More type actions')} aria-haspopup="menu" aria-expanded={!!more} onClick={(e) => setMore(more ? null : e.currentTarget)}><MoreHorizontal size={16} /></IconButton>
      </div>
    </header>
    <TypeCollection type={type} onOpen={open} empty={empty} />
    <UntypedPages type={type} pathOf={(page) => pagePath(page, pages, t('Particular', 'Private'))} />
    {where && <WherePopover type={type} anchor={where} onClose={() => setWhere(null)} />}
    {adding && <ExistingPagePicker type={type} anchor={adding} onClose={() => setAdding(null)} />}
    {more && <DbPopover anchor={more} onClose={() => setMore(null)} label={t('Mais ações do tipo', 'More type actions')}>
      <Menu width={260}>
        <MenuItem icon={<Plus size={16} />} label={t('Aplicar a uma página existente…', 'Apply to an existing page…')} onClick={() => { setAdding(more); setMore(null) }} />
        <MenuItem icon={<Database size={16} />} label={t('Transformar em banco de dados…', 'Turn into a database…')} onClick={() => { setMore(null); setConverting(true) }} />
        <MenuItem icon={<Link2 size={16} />} label={t('Copiar link do tipo', 'Copy type link')} onClick={() => { setMore(null); void copyText(`workspace://type/${type.id}`).then(() => showTypesToast(t('Link copiado', 'Link copied'))).catch(actions.reportSaveError) }} />
        <MenuSep />
        <MenuItem danger icon={<Trash2 size={16} />} label={t('Excluir tipo…', 'Delete type…')} onClick={() => { setMore(null); setDeleting(true) }} />
      </Menu>
    </DbPopover>}
    {converting && <ConvertTypeDialog type={type} onClose={() => setConverting(false)} />}
    {deleting && <DeleteTypeDialog type={type} count={count} onClose={() => setDeleting(false)} />}
  </div>
}

function WherePopover({ type, anchor, onClose }: { type: ObjectType; anchor: Element; onClose: () => void }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const list = pagesWithType(pages, objectTypes(), type.id).filter((page) => !(page.passwordLock && !page.passwordLock.unlocked && page.passwordLock.hideTitle))
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Onde estão as páginas', 'Where the pages are')}>
    <Menu width={320}>
      <MenuLabel>{t('Onde estão as páginas', 'Where the pages are')}</MenuLabel>
      {list.slice(0, 50).map((page) => <MenuItem key={page.id} icon={<PageIcon value={page.icon} fallback="page" />} label={<span className="ot-where"><span>{page.title || t('Sem título', 'Untitled')}</span><small>{pagePath(page, pages, t('Particular', 'Private'))}</small></span>} onClick={() => { onClose(); actions.openPage(page.id) }} />)}
      {list.length > 50 && <MenuLabel>{t('e mais {n}', 'and {n} more', { n: list.length - 50 })}</MenuLabel>}
    </Menu>
  </DbPopover>
}

/** Busca uma página que ainda não tem o tipo e aplica (com a confirmação e o aviso de sempre). */
function ExistingPagePicker({ type, anchor, onClose }: { type: ObjectType; anchor: Element; onClose: () => void }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const [query, setQuery] = useState('')
  const q = normalizeSearch(query.trim())
  const list = useMemo(() => Object.values(pages)
    .filter((page) => !page.trashed && !page.database && !page.canvas && !page.locked && !page.passwordLock && !page.types?.includes(type.id) && (!q || normalizeSearch(page.title).includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [pages, q, type.id])
  const choose = (id: string) => { onClose(); void applyTypeFlow([id], type.id).catch(actions.reportSaveError) }
  return <DbPopover anchor={anchor} onClose={onClose} label={t('Aplicar a uma página existente', 'Apply to an existing page')}>
    <Menu width={300}>
      <div className="dbv-input-wrap"><input autoFocus className="dbv-input" placeholder={t('Buscar página…', 'Search page…')} aria-label={t('Buscar página', 'Search page')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); choose(list[0].id) } }} /></div>
      {list.map((page) => <MenuItem key={page.id} icon={<PageIcon value={page.icon} fallback="page" />} label={page.title || t('Sem título', 'Untitled')} onClick={() => choose(page.id)} />)}
      {!list.length && <MenuLabel>{t('Nenhuma página encontrada', 'No page found')}</MenuLabel>}
    </Menu>
  </DbPopover>
}

function ConvertTypeDialog({ type, onClose }: { type: ObjectType; onClose: () => void }) {
  const { t } = useI18n()
  const preview = previewTypeToDatabase(type.id)
  const [error, setError] = useState('')
  if (!preview) return null
  const run = () => {
    try {
      const { dbId, moved } = convertTypeToDatabase(type.id)
      onClose()
      actions.openPage(dbId)
      showTypesToast(t('{n} página(s) viraram linhas de “{name}”', '{n} page(s) became rows of “{name}”', { n: moved, name: preview.title }), () => { actions.undoDatabase() })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <div className="ot-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="ot-dialog" role="dialog" aria-modal="true" aria-labelledby="ot-convert-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <h3 id="ot-convert-title">{t('Transformar “{name}” em banco de dados?', 'Turn “{name}” into a database?', { name: type.name })}</h3>
      <p>{t('Cria o banco “{title}” na raiz com as propriedades {fields}. As {n} página(s) saem de onde estão e viram linhas, com o mesmo conteúdo; o tipo continua aplicado.', 'Creates the “{title}” database at the root with the properties {fields}. The {n} page(s) leave where they are and become rows, with the same content; the type stays applied.', { title: preview.title, fields: preview.fields.join(', '), n: preview.eligible.length })}</p>
      {(preview.excluded.length > 0 || preview.inOtherDatabases.length > 0) && <p>{t('Ficam onde estão: {n} (protegidas, bloqueadas, bancos, lousas ou linhas de outro banco).', 'Staying put: {n} (protected, locked, databases, whiteboards or rows of another database).', { n: preview.excluded.length + preview.inOtherDatabases.length })}</p>}
      <p className="ot-collection-note">{t('Prefere não mover nada? Continue usando o tipo: a coleção já mostra tudo junto. ⌘Z desfaz a transformação.', 'Rather not move anything? Keep using the type: the collection already shows everything together. ⌘Z undoes the change.')}</p>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <DialogActions confirmLabel={t('Transformar em banco', 'Turn into a database')} disabled={!preview.eligible.length} onCancel={onClose} onConfirm={run} />
    </div>
  </div>
}
