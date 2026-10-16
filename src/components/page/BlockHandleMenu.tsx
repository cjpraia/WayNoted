import { useEffect, useMemo, useState } from 'react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { SideMenu, useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react'
import { ChevronRight, MessageSquareText, PaintRoller, Repeat2, ScanText, Sparkles } from 'lucide-react'
import { absoluteTime } from './util'
import { blockMenuCharacterCount, blockMenuText, blockMenuWordCount } from './blockMenuStats'
import { SLASH_CATALOG, type SlashCommand } from './slashMenu/catalog'
import { useI18n } from '../../i18n'
import { BlockIcon } from '../ui/BlockIcon'
import { extractTargetOf, type ExtractTarget } from '../../ocr/extractText.ts'
import { ocrAvailable } from '../../search/attachments.ts'
import { deleteColumns, undoColumns } from './columns/actions.ts'
import { enclosingColumnList } from './columns/model.ts'

// Só rótulos de teclas que têm tratador real (src/shortcuts.ts, id `block-menu`; tests/shortcuts.test.mts confere).
export const BLOCK_MENU_SHORTCUTS: Record<string, string> = { duplicate: '⌘D', comment: '⌘⇧M' }
const SHORTCUTS = BLOCK_MENU_SHORTCUTS

export interface BlockHandleMenuProps {
  editable: boolean
  updatedBy?: string
  updatedAt?: number
  onCommand: (command: SlashCommand, blockId: string) => void
  onSuggest: (blockId: string) => void
  /** "Extrair texto" de imagem/PDF (B6a): abre a prévia editável. */
  onExtractText?: (target: ExtractTarget) => void
}

export function BlockHandleMenu({ editable, updatedBy, updatedAt, onCommand, onSuggest, onExtractText }: BlockHandleMenuProps) {
  const Components = useComponentsContext()!
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block })
  const editor = useBlockNoteEditor()
  const { locale, t } = useI18n()
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<'main' | 'turn' | 'color'>('main')
  useEffect(() => { setSearch(''); setSection('main') }, [block?.id])
  const text = block ? blockMenuText(block) : ''
  const normalized = search.trim().toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const choices = useMemo(() => SLASH_CATALOG.filter((item) => ['Turn into', 'Text color', 'Background color'].includes(item.category)), [])
  const filtered = choices.filter((item) => {
    if (!normalized) return section === 'turn' ? item.category === 'Turn into' : section === 'color' ? item.category === 'Text color' || item.category === 'Background color' : false
    return [item.en, item.pt, ...item.aliases].some((term) => term.toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalized))
  })
  const action = (id: string) => SLASH_CATALOG.find((item) => item.id === id)
  const showAction = (id: string, label: string, mutable = true, danger = false) => {
    const item = action(id)
    if (!block || !item || normalized && ![label, item.en, item.pt, ...item.aliases].some((value) => value.toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalized))) return null
    return <Components.Generic.Menu.Item className={`pg-block-menu-item${mutable && !editable ? ' is-disabled' : ''}${danger ? ' is-danger' : ''}`} key={id} onClick={() => { if (!mutable || editable) onCommand(item, block.id) }}><span className="pg-block-menu-label"><BlockIcon name={id} size={16} />{label}</span>{SHORTCUTS[id] && <kbd>{SHORTCUTS[id]}</kbd>}</Components.Generic.Menu.Item>
  }
  // Colunas: ações da lista de colunas que contém o bloco (ou do próprio bloco de colunas).
  const inColumns = !!block && !!enclosingColumnList(editor.document as never, block.id)
  const columnAction = (id: 'undo-columns' | 'delete-columns', label: string, run: () => void, danger = false) => {
    if (!inColumns || normalized && !label.toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normalized)) return null
    return <Components.Generic.Menu.Item className={`pg-block-menu-item${!editable ? ' is-disabled' : ''}${danger ? ' is-danger' : ''}`} key={id} onClick={() => { if (editable) run() }}><span className="pg-block-menu-label"><BlockIcon name={danger ? 'delete' : 'columns-2'} size={16} />{label}</span></Components.Generic.Menu.Item>
  }
  const undoColumnsItem = columnAction('undo-columns', t('Desfazer colunas', 'Undo columns'), () => { if (block) undoColumns(editor as never, block.id) })
  const deleteColumnsItem = columnAction('delete-columns', t('Excluir colunas', 'Delete columns'), () => { if (block) deleteColumns(editor as never, block.id) }, true)
  // Imagem precisa do OCR do macOS; PDF sempre tem a camada de texto (e o Vision nas páginas escaneadas).
  const extract = onExtractText ? extractTargetOf(block as never) : null
  const extractLabel = t('Extrair texto', 'Extract text')
  const showExtract = !!extract && (extract.kind === 'pdf' || ocrAvailable()) && (!normalized || [extractLabel, 'extract text', 'extrair texto', 'ocr'].some(value => value.toLocaleLowerCase(locale).includes(normalized)))
  const extractItem = showExtract ? <Components.Generic.Menu.Item className="pg-block-menu-item" key="extract-text" onClick={() => onExtractText!(extract!)}><span className="pg-block-menu-label"><ScanText size={16} />{extractLabel}</span></Components.Generic.Menu.Item> : null
  if (!block) return null
  return <Components.Generic.Menu.Dropdown className="bn-menu-dropdown pg-block-menu">
    <input autoFocus className="pg-block-menu-search" aria-label={t('Pesquisar ações', 'Search actions')} placeholder={t('Pesquisar ações…', 'Search actions…')} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (!['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) event.stopPropagation() }} />
    {!normalized && <><div className="pg-block-menu-type">{block.type === 'paragraph' ? t('Texto', 'Text') : block.type === 'heading' ? t('Título', 'Heading') : block.type}</div>
      {section !== 'main' && <button type="button" className="pg-block-menu-back" onClick={() => setSection('main')}>‹ {t('Voltar', 'Back')}</button>}
      {section === 'main' && <>
        <button type="button" className="pg-block-menu-row" disabled={!editable} onClick={() => setSection('turn')}><span className="pg-block-menu-label"><Repeat2 size={16} />{t('Transformar em', 'Turn into')}</span><ChevronRight size={16} /></button>
        <button type="button" className="pg-block-menu-row" disabled={!editable} onClick={() => setSection('color')}><span className="pg-block-menu-label"><PaintRoller size={16} />{t('Cor', 'Color')}</span><ChevronRight size={16} /></button>
        <hr />
        {showAction('copy-link', t('Copiar link do bloco', 'Copy link to block'), false)}
        {showAction('duplicate', t('Duplicar', 'Duplicate'))}
        {showAction('move-to', t('Mover para', 'Move to'))}
        {undoColumnsItem}
        {extractItem}
        <hr />
        {showAction('comment', t('Comentar', 'Comment'))}
        <Components.Generic.Menu.Item className={`pg-block-menu-item${!editable || !text ? ' is-disabled' : ''}`} onClick={() => { if (editable && text) onSuggest(block.id) }}><span className="pg-block-menu-label"><MessageSquareText size={16} />{t('Sugerir edições', 'Suggest edits')}</span></Components.Generic.Menu.Item>
        <hr />
        {showAction('ask-ai', t('Perguntar à IA', 'Ask AI'))}
        <button type="button" className="pg-block-menu-row" disabled title={t('As habilidades remotas não estão disponíveis no modo local.', 'Remote skills are unavailable in local mode.')}><span className="pg-block-menu-label"><Sparkles size={16} />{t('Habilidades', 'Skills')}</span><ChevronRight size={16} /></button>
      <hr />
        {showAction('delete', t('Excluir', 'Delete'), true, true)}
        {deleteColumnsItem}
      </>}
    </>}
    {(normalized || section !== 'main') && <div className="pg-block-menu-results">{filtered.map((item) => <Components.Generic.Menu.Item key={item.id} className={`pg-block-menu-item${!editable ? ' is-disabled' : ''}`} onClick={() => { if (editable) onCommand(item, block.id) }}><span className="pg-block-menu-label"><BlockIcon name={item.id} size={16} />{locale === 'en-US' ? item.en : item.pt}</span>{normalized && <small>{item.category}</small>}</Components.Generic.Menu.Item>)}
      {normalized && <>{extractItem}{undoColumnsItem}{deleteColumnsItem}{['copy-link', 'duplicate', 'move-to', 'delete', 'comment', 'ask-ai'].map((id) => showAction(id, locale === 'en-US' ? action(id)?.en ?? '' : action(id)?.pt ?? '', id !== 'copy-link'))}{['suggest', 'skills'].filter((id) => (id === 'suggest' ? t('Sugerir edições', 'Suggest edits') : t('Habilidades', 'Skills')).toLocaleLowerCase(locale).includes(normalized)).map((id) => id === 'suggest' ? <Components.Generic.Menu.Item key={id} className={`pg-block-menu-item${!editable || !text ? ' is-disabled' : ''}`} onClick={() => { if (editable && text) onSuggest(block.id) }}>{t('Sugerir edições', 'Suggest edits')}</Components.Generic.Menu.Item> : <button key={id} type="button" className="pg-block-menu-row" disabled>{t('Habilidades (indisponível offline)', 'Skills (unavailable offline)')}</button>)}</>}
      {!filtered.length && !normalized && <div className="pg-block-menu-empty">{t('Nenhum comando', 'No commands')}</div>}
    </div>}
    <footer className="pg-block-menu-footer">
      <div>{t('Página editada por {name}', 'Page last edited by {name}', { name: updatedBy || t('você', 'you') })}</div>
      <div>{updatedAt ? absoluteTime(updatedAt, Date.now(), locale) : t('Data indisponível', 'Date unavailable')}</div>
      <div>{t('{words} palavras, {characters} caracteres', '{words} words, {characters} characters', { words: blockMenuWordCount(text), characters: blockMenuCharacterCount(text) })}</div>
    </footer>
  </Components.Generic.Menu.Dropdown>
}

export function EditorSideMenu(props: BlockHandleMenuProps) {
  return <SideMenu dragHandleMenu={() => <BlockHandleMenu {...props} />} />
}
