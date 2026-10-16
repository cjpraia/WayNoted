// Página: capa, ícone, título e corpo (BlockNote), no estilo do Export Bundle.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ImageIcon, Link2, Smile, Sparkles, FileAudio, Database, ListFilter, LayoutTemplate, MoreHorizontal } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import type { Page } from '../../types'
import { CoverPicker } from './CoverPicker'
import { coverStyle, isImageCover, randomCover } from './covers'
import { EmojiPicker } from './EmojiPicker'
import { PageIcon } from './PageIcon'
import { useI18n } from '../../i18n'
import { randomEmoji } from './emojiData'
import { PageEditor } from './PageEditor'
import { blocksToText, flushDoc, isDocDirty } from './util'
import { firstLinkingBlock } from './backlinkAnchor'
import { revealLinkedBlock } from './blockLinks'
import { deleteDraft, loadDraft } from './draftStorage'
import { RowProperties } from '../database/RowProperties'
import { DailyNoteNav } from '../../daily/DailyNoteNav'
import { DatabaseView } from '../database/DatabaseView'
import type { PageEditorType } from './schema'
import { TextSelection } from '@tiptap/pm/state'
import { resolveTextAnchor } from './commentAnchors'
import { EditorBoundary } from './EditorBoundary'
import { isEmptyPageDocument } from './emptyPage'
import { availableTemplates } from './templates'
import { applyPendingCursor, hasPendingCursor, placeCursor } from '../../templates/cursor'
import { prepareTemplate } from '../../templates/apply'
import { cloneDocument, remapReferences } from '../../workspace'
import { pageBlockReferences } from '../../page-block-ownership'
import { trackResume } from '../../onboarding/trackResume'
import { trackStep } from '../../onboarding/tracker'
import { LocalAIModal } from '../modals/LocalAIModal'
import { PageComments } from './PageComments'
import { UnlinkedMentions } from '../graph/UnlinkedMentions'
import { RowLayoutSettings } from '../database/RowLayoutSettings'
import { TypeFields, TypeHeader, TypeTagSuggestion } from '../objecttypes/PageTypes'
import { ChildPages } from './ChildPages'
import { insertTextInPageEditor, objectTypes, registerTypeEditor } from '../../objecttypes/actions'
import { VariablePicker } from '../modals/VariablePicker'
import { typesAsTemplates } from '../../objecttypes/adjust'
import { sidebarTypes } from '../../objecttypes/visibility'
import { applyTypeFlow } from '../objecttypes/TypePicker'
import { Button } from '../ui/Button'
import './page.css'
import './editor.css'

interface Props {
  pageId: string
  theme: 'light' | 'dark'
}

type DocState =
  | { status: 'loading' }
  | { status: 'ready'; blocks: unknown[] | null }
  | { status: 'recovery'; savedBlocks: unknown[] | null; draftBlocks: unknown[] }
  | { status: 'error'; message: string }

export function PageView({ pageId, theme }: Props) {
  const { locale, t } = useI18n()
  const { docRevision, route, pages: allPages } = useStore()
  const page = selectors.page(pageId)
  const parentDatabase = selectors.parentDatabase(pageId)
  const rowLayout = parentDatabase?.database?.rowLayout
  const [layoutTab, setLayoutTab] = useState('content')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selectedLayoutTab = rowLayout?.tabs?.find(tab => tab.id === layoutTab)
  const backlinks = selectors.backlinks(pageId).filter((source) => source.id !== pageId)
  const [doc, setDoc] = useState<DocState>({ status: 'loading' })
  // Cada documento recarregado (versão restaurada, bloco acrescentado ou removido por conversões) recria o editor, mesmo que o React agrupe os estados.
  const docKey = useRef({ doc, n: 0 })
  if (docKey.current.doc !== doc) docKey.current = { doc, n: docKey.current.n + 1 }
  const [reload, setReload] = useState(0)
  const [bodyStarted, setBodyStarted] = useState(false)
  const [bodyEmpty, setBodyEmpty] = useState<boolean | null>(null)
  const [starterPanel, setStarterPanel] = useState<'templates' | 'more' | 'layout' | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [starterBusy, setStarterBusy] = useState(false)
  const editorSubscription = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => { editorSubscription.current?.(); editorRef.current = null; typeEditorCleanup.current?.() }, [])
  const typeEditorCleanup = useRef<(() => void) | undefined>(undefined)
  const [anchorWarning, setAnchorWarning] = useState('')
  const editorRef = useRef<PageEditorType | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isDocDirty(pageId) && doc.status === 'ready') return
    let alive = true
    setDoc({ status: 'loading' })
    void (async () => {
      const blocks = await api.loadDoc(pageId)
      if (blocks !== null && !Array.isArray(blocks)) throw new Error(t('O arquivo da página não contém uma lista válida de blocos.', 'The page file does not contain a valid block list.'))
      const draft = await loadDraft(pageId)
      if (!alive) return
      if (draft && JSON.stringify(draft) !== JSON.stringify(blocks)) setDoc({ status: 'recovery', savedBlocks: blocks, draftBlocks: draft })
      else {
        if (draft) await deleteDraft(pageId)
        if (alive) setDoc({ status: 'ready', blocks })
      }
    })().catch((error) => { if (alive) setDoc({ status: 'error', message: error instanceof Error ? error.message : t('Não foi possível carregar esta página.', 'Could not load this page.') }) })
    return () => {
      alive = false
    }
  }, [pageId, reload, docRevision])

  const onReady = useCallback((editor: PageEditorType) => {
    editorSubscription.current?.()
    editorRef.current = editor
    typeEditorCleanup.current?.()
    typeEditorCleanup.current = registerTypeEditor(pageId, editor)
    const update = () => {
      const empty = isEmptyPageDocument(editor.document)
      setBodyEmpty(empty)
      // Esvaziar o último bloco com o cursor no editor não pode esconder o corpo (perdia o foco e o texto digitado).
      if (!empty) { setBodyStarted(editor.isFocused()); setStarterPanel(current => current === 'templates' || current === 'more' ? null : current) }
    }
    update()
    // {{cursor}} de um modelo recém-aplicado: tenta já e de novo quando o documento carregar.
    if (hasPendingCursor(pageId) && !applyPendingCursor(pageId, editor as never)) window.setTimeout(() => { try { applyPendingCursor(pageId, editor as never) } catch { /* editor desmontado */ } }, 250)
    const offChange = editor.onChange(update)
    // Ponto de retomada: bloco do cursor (cartão "Continuar" no Meu dia).
    const offSelection = editor.onSelectionChange?.(() => { try { trackResume(pageId, editor.getTextCursorPosition().block.id) } catch { /* sem cursor */ } })
    editorSubscription.current = () => { offChange?.(); offSelection?.() }
  }, [pageId])

  // "Use o menu /": a barra digitada dentro do editor marca o passo de Primeiros passos.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === '/' && (event.target as HTMLElement | null)?.closest?.('.bn-editor')) trackStep('slash') }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (doc.status !== 'ready' || route.type !== 'page' || route.id !== pageId || !route.blockId) return
    const blockId = route.blockId
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor?.getBlock(blockId)) return
      try {
        const anchor = route.commentId ? selectors.page(pageId)?.comments?.find(comment => comment.id === route.commentId)?.textAnchor : undefined
        const range = anchor ? resolveTextAnchor(editor.prosemirrorState.doc, anchor) : null
        setAnchorWarning(anchor && !range ? t('O trecho comentado foi alterado. A citação original continua no comentário.', 'The commented passage changed. Its original quote remains in the comment.') : '')
        if (range) {
          editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(TextSelection.create(editor.prosemirrorState.doc, range.from, range.to)).scrollIntoView())
          editor.focus()
        } else editor.setTextCursorPosition(blockId, 'start')
      } catch { /* Deleted block; keep page open. */ }
      // File/database blocks have no inline cursor; scrolling must still run.
      const root = document.querySelector<HTMLElement>(`.pg-root[data-page-id="${CSS.escape(pageId)}"]`)
      if (root) revealLinkedBlock(root, blockId)
    })
    return () => cancelAnimationFrame(frame)
  }, [doc.status, route, pageId])

  const restoreDraft = async () => {
    if (doc.status !== 'recovery' || page?.locked) return
    try {
      await api.saveDoc(pageId, doc.draftBlocks, { base: doc.savedBlocks === null ? null : JSON.stringify(doc.savedBlocks), page, userEdit: true })
      actions.updatePage(pageId, { text: blocksToText(doc.draftBlocks) })
      await deleteDraft(pageId)
      setDoc({ status: 'ready', blocks: doc.draftBlocks })
    } catch (error) {
      setDoc({ status: 'error', message: error instanceof Error ? error.message : t('Não foi possível restaurar o rascunho.', 'Could not restore the draft.') })
    }
  }

  if (!page) return null
  const locked = page.locked
  const emptyBody = doc.status === 'ready' && (bodyEmpty ?? isEmptyPageDocument(doc.blocks))
  const starterVisible = emptyBody && !bodyStarted && !locked
  const blankPage = starterVisible && !parentDatabase
  // Modelos nativos/pessoais + os tipos do usuário ("Tipo: Tags"), em uso primeiro, sem repetir nomes. docs/USAGE.md
  const starterTemplates = starterPanel === 'templates' ? availableTemplates() : []
  const starterTypes = starterPanel === 'templates' && !page?.types?.length ? typesAsTemplates(sidebarTypes(allPages, objectTypes()), starterTemplates.map(template => template.title)) : []
  const addStarterBlocks = async (blocks: unknown[], clonePages = true) => {
    const editor = editorRef.current
    if (!editor || selectors.page(pageId)?.locked || starterBusy) return
    if (!isEmptyPageDocument(editor.document)) { actions.reportSaveError(new Error(t('Os atalhos iniciais só podem preencher uma página vazia.', 'Starter actions can only fill an empty page.'))); return }
    // Variáveis {{…}} do modelo (só em modelos, não no atalho "banco"): perguntas antes de tocar na página; cancelar não muda nada.
    let prepared: Awaited<ReturnType<typeof prepareTemplate>> = null
    if (clonePages) {
      try { prepared = await prepareTemplate(blocks, { title: selectors.page(pageId)?.title }) } catch (error) { actions.reportSaveError(error); return }
      if (!prepared) return
      if (editorRef.current !== editor || selectors.page(pageId)?.locked || !isEmptyPageDocument(editor.document)) return
    }
    const before = JSON.stringify(editor.document)
    setStarterBusy(true)
    try {
      const copies = cloneDocument(prepared ? prepared.blocks as unknown[] : blocks, {})
      // Personal templates can contain owned subpages/databases. Copy those too.
      const mapping: Record<string, string> = {}
      for (const [id, ref] of pageBlockReferences(copies)) {
        if (!clonePages || !ref.owned || !selectors.isLive(id)) continue
        const copy = await actions.duplicatePage(id, pageId)
        if (copy) { mapping[id] = copy; actions.updatePage(copy, { blockOwnerId: null }) }
      }
      if (editorRef.current !== editor || selectors.page(pageId)?.locked || JSON.stringify(editor.document) !== before || !isEmptyPageDocument(editor.document)) throw new Error(t('A página mudou durante a preparação do modelo. Seu conteúdo foi preservado.', 'The page changed while preparing the template. Your content was preserved.'))
      const fresh = remapReferences(copies, mapping) as unknown[]
      editor.replaceBlocks(editor.document, fresh as never)
      setBodyStarted(isEmptyPageDocument(fresh)); setStarterPanel(null)
      for (const [id, ref] of pageBlockReferences(fresh)) if (ref.owned && selectors.page(id)?.parentId === pageId) actions.updatePage(id, { blockOwnerId: pageId })
      await flushDoc(pageId)
      await actions.flushMeta()
      requestAnimationFrame(() => { if (!placeCursor(editor as never, prepared?.cursor ?? null)) editor.focus() })
    } catch (error) { actions.reportSaveError(error) }
    finally { setStarterBusy(false) }
  }
  const addDatabase = async (form = false) => {
    if (locked || starterBusy || !editorRef.current || !isEmptyPageDocument(editorRef.current.document)) return
    const id = actions.createDatabase(pageId, form ? 'form' : 'table', { blockOwnerId: null })
    await addStarterBlocks([{ type: 'page', props: { pageId: id, ownership: 'owned', display: 'inline' } }], false)
  }

  const rootStyle = {
    '--pg-font': page.font === 'serif' ? 'var(--font-serif)' : page.font === 'mono' ? 'var(--font-mono)' : 'var(--font-sans)',
    // Título: fonte de caráter (Newsreader, --font-display) só na fonte "Padrão"; Serifa/Mono seguem a da página.
    '--pg-title-font': page.font === 'serif' ? 'var(--font-serif)' : page.font === 'mono' ? 'var(--font-mono)' : 'var(--font-display)',
    '--pg-body-size': page.smallText ? '14px' : '16px',
  } as CSSProperties

  /** Foca o início do editor; com `text`, cria um parágrafo no topo com esse texto. */
  const focusEditorStart = (text?: string) => {
    const editor = editorRef.current
    if (!editor || locked) return
    setBodyStarted(true)
    try {
      const first = editor.document[0]
      const firstEmpty =
        first && first.type === 'paragraph' && Array.isArray(first.content) && first.content.length === 0
      if (text !== undefined && !(firstEmpty && !text)) {
        const [inserted] = editor.insertBlocks([{ type: 'paragraph', content: text }], first, 'before')
        editor.setTextCursorPosition(inserted, 'start')
      } else if (first && first.content !== undefined) {
        editor.setTextCursorPosition(first, 'start')
      }
      requestAnimationFrame(() => editor.focus())
    } catch {
      requestAnimationFrame(() => editor.focus())
    }
  }

  const focusEditorEnd = () => {
    const editor = editorRef.current
    if (!editor || locked) return
    setBodyStarted(true)
    try {
      const blocks = editor.document
      const last = blocks[blocks.length - 1]
      const lastEmpty = last && last.type === 'paragraph' && Array.isArray(last.content) && last.content.length === 0
      if (lastEmpty) {
        editor.setTextCursorPosition(last, 'end')
      } else {
        const [inserted] = editor.insertBlocks([{ type: 'paragraph' }], last, 'after')
        editor.setTextCursorPosition(inserted, 'end')
      }
      requestAnimationFrame(() => editor.focus())
    } catch {
      requestAnimationFrame(() => editor.focus())
    }
  }

  return (
    <div
      className={`pg-root${page.fullWidth || rowLayout?.fullWidth ? ' pg-full' : ''}${detailsOpen ? ' pg-details-open' : ''}${page.smallText ? ' pg-small' : ''}${page.font === 'mono' ? ' pg-mono' : ''}${locked ? ' pg-locked' : ''}${blankPage ? ' pg-empty-page' : ''}`}
      data-page-id={pageId}
      style={rootStyle}
    >
      {page.cover && <Cover page={page} locked={locked} />}
      <div className="pg-frame">
        <DailyNoteNav pageId={pageId} />
        <PageHeader page={page} locked={locked} titleRef={titleRef} onEnter={focusEditorStart} hasDoc={doc.status === 'ready'} onCustomizeLayout={parentDatabase && !parentDatabase.locked ? () => setStarterPanel(starterPanel === 'layout' ? null : 'layout') : undefined} />
        <TypeHeader page={page} locked={locked} />
        {!!rowLayout?.pinnedPropertyIds?.length && <RowProperties pageId={pageId} placement="pinned" />}
        <div className="pg-layout-nav">
          {!!rowLayout?.tabs?.length && <div role="tablist" aria-label={t('Abas da página', 'Page tabs')}><button role="tab" aria-selected={!selectedLayoutTab} onClick={() => setLayoutTab('content')}>{t('Conteúdo', 'Content')}</button>{rowLayout.tabs.map(tab => <button role="tab" aria-selected={selectedLayoutTab?.id === tab.id} key={tab.id} onClick={() => setLayoutTab(tab.id)}>{tab.name}</button>)}{!locked && !!parentDatabase && !parentDatabase.locked && <button type="button" className="pg-tabs-manage" aria-label={t('Gerenciar abas', 'Manage tabs')} title={t('Gerenciar abas deste banco', 'Manage this database’s tabs')} onClick={() => { setLayoutTab('content'); setStarterPanel('layout') }}>⋯</button>}</div>}
          {!!rowLayout?.detailsPropertyIds?.length && <button className="pg-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? t('Ocultar detalhes', 'Hide details') : t('Ver detalhes', 'View details')}</button>}
        </div>
        <div className="pg-layout-grid"><div className="pg-layout-main">
        {selectedLayoutTab && <section role="tabpanel">{selectedLayoutTab.databaseId === parentDatabase?.id && !selectedLayoutTab.relationPropertyId && <p className="pg-tab-hint" role="note">{t('Esta aba mostra todas as linhas do próprio banco. Escolha um banco relacionado ou filtre pela página em “Layout da página”.', 'This tab shows every row of the same database. Pick a related database or filter by this page in “Page layout”.')} {!locked && <button type="button" onClick={() => { setLayoutTab('content'); setStarterPanel('layout') }}>{t('Ajustar aba', 'Adjust tab')}</button>}</p>}<DatabaseView pageId={selectedLayoutTab.databaseId} embedded fixedViewId={selectedLayoutTab.viewId} relationFilter={selectedLayoutTab.relationPropertyId ? { propertyId: selectedLayoutTab.relationPropertyId, rowId: pageId } : undefined} /></section>}
        <div hidden={!!selectedLayoutTab} role={rowLayout?.tabs?.length ? 'tabpanel' : undefined}>
        <RowProperties pageId={pageId} typeLocked={locked} />
        <TypeFields page={page} locked={locked} />
        <TypeTagSuggestion page={page} locked={locked} />
        {parentDatabase && <div className="pg-row-comments"><PageComments page={page} inline />
          {starterPanel === 'layout' && !locked && !parentDatabase.locked && parentDatabase.database && <RowLayoutSettings dbId={parentDatabase.id} schema={parentDatabase.database} patch={layout => actions.updateSchema(parentDatabase.id, schema => ({ ...schema, rowLayout: layout }))} />}
        </div>}
        {!locked && objectTypes().some(type => type.template.sourcePageId === pageId) && <div className="tpl-banner" role="note"><span>{t('Esta página é o modelo de um tipo. Use {{variáveis}}: são preenchidas quando o tipo é aplicado.', 'This page is a type template. Use {{variables}}: they are filled in when the type is applied.')}</span><VariablePicker scope="row" onPick={token => { insertTextInPageEditor(pageId, token) }} /></div>}
        <div className="pg-body" hidden={starterVisible}>
          {anchorWarning && <div className="pg-editor-feedback" role="status">{anchorWarning}</div>}
          {doc.status === 'ready' ? (
            <EditorBoundary resetKey={`${pageId}:${reload}:${docRevision}`} locale={locale} onRetry={() => setReload(value => value + 1)}><PageEditor key={docKey.current.n} pageId={pageId} initial={doc.blocks} theme={theme} editable={!locked} onReady={onReady} /></EditorBoundary>
          ) : doc.status === 'recovery' ? (
            <div className="pg-load-error" role="alert">
              <strong>{t('Há um rascunho local não salvo desta página.', 'There is an unsaved local draft of this page.')}</strong>
              <span>{t('Escolha se deseja restaurá-lo ou manter a última versão salva.', 'Choose whether to restore it or keep the last saved version.')}</span>
              <div className="pg-recovery-actions">
                <button disabled={locked} onClick={() => void restoreDraft()}>{t('Restaurar rascunho', 'Restore draft')}</button>
                <button onClick={() => void deleteDraft(pageId).then(() => setDoc({ status: 'ready', blocks: doc.savedBlocks })).catch(actions.reportSaveError)}>{t('Manter versão salva', 'Keep saved version')}</button>
              </div>
            </div>
          ) : doc.status === 'error' ? (
            <div className="pg-load-error" role="alert">
              <strong>{t('Não foi possível abrir o conteúdo da página.', 'Could not open the page content.')}</strong>
              <span>{doc.message}</span>
              <button onClick={() => setReload((value) => value + 1)}>{t('Tentar novamente', 'Try again')}</button>
            </div>
          ) : (
            <div className="pg-skeleton" />
          )}
        </div>
        {parentDatabase && starterVisible && <div className="pg-row-start"><button disabled={starterBusy} onClick={() => focusEditorStart()}>{t('Pressione Enter para continuar com uma página vazia', 'Press enter to continue with an empty page')}</button>{t(', ou ', ', or ')}<button disabled={starterBusy} onClick={() => setStarterPanel('templates')}>{t('crie um modelo', 'create a template')}</button></div>}
        {doc.status === 'ready' && <ChildPages pageId={pageId} locked={locked} editorRef={editorRef} />}
        {backlinks.length > 0 && !blankPage && (
          <section className="pg-backlinks" aria-label={t('Páginas que mencionam esta página', 'Pages that mention this page')}>
            <h2><Link2 size={16} /> {t('Referências a esta página', 'References to this page')} <span>{backlinks.length}</span></h2>
            <div className="pg-backlinks-list">
              {backlinks.map((source) => (
                <button type="button" key={source.id} onClick={(event) => {
                  const newTab = event.metaKey || event.ctrlKey
                  void (async () => {
                    let blockId: string | undefined
                    try { await flushDoc(source.id); blockId = firstLinkingBlock(await api.loadDoc(source.id) ?? [], pageId) }
                    catch { /* Source still opens when the reference cannot be inspected. */ }
                    if (newTab) actions.openInNewTab({ type: 'page', id: source.id, ...(blockId ? { blockId } : {}) })
                    else actions.openPage(source.id, blockId ? { blockId } : {})
                  })()
                }}>
                  <span aria-hidden><PageIcon value={source.icon || '📄'} /></span>
                  <span>{source.title || t('Sem título', 'Untitled')}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!blankPage && doc.status === 'ready' && <UnlinkedMentions pageId={pageId} />}
        </div></div>
        {detailsOpen && !!rowLayout?.detailsPropertyIds?.length && <aside className="pg-details-panel" aria-label={t('Detalhes da página', 'Page details')}><RowProperties pageId={pageId} placement="details" /></aside>}
        </div>
      </div>
      {starterPanel === 'templates' && !locked && <div className="pg-starter-templates pg-frame" role="dialog" aria-label={t('Modelos', 'Templates')}><div><strong>{t('Modelos', 'Templates')}</strong><button onClick={() => setStarterPanel(null)}>{t('Fechar', 'Close')}</button></div>{starterTemplates.map(template => <button key={template.id} disabled={starterBusy} onClick={() => void addStarterBlocks(template.blocks)}><PageIcon value={template.icon} /> <span>{template.title}<small>{template.description}</small></span></button>)}
        {starterTypes.map(({ type }) => <button key={`type:${type.id}`} disabled={starterBusy} data-type-template={type.id} onClick={() => { setStarterPanel(null); void applyTypeFlow([pageId], type.id, false, { confirmed: true, template: true }).catch(actions.reportSaveError) }}><PageIcon value={type.icon} fallback="page" /> <span>{t('Tipo: {name}', 'Type: {name}', { name: type.name })}<small>{type.description || t('Aplica o tipo e insere o modelo dele', 'Applies the type and inserts its template')}</small></span></button>)}</div>}
      <div className="pg-bottom-space" onClick={focusEditorEnd} />
      {blankPage && <div className="pg-starter pg-frame"><span>{t('Comece com', 'Get started with')}</span><div className="pg-starter-actions">
        <button disabled={starterBusy} onClick={() => setAiOpen(true)}><Sparkles size={16} />{t('Perguntar à IA', 'Ask AI')}</button>
        <button disabled={starterBusy} onClick={() => void addStarterBlocks([{ type: 'aiMeetingNotes' }])}><FileAudio size={16} />{t('Notas de reunião com IA', 'AI Meeting Notes')}</button>
        <button disabled={starterBusy} onClick={() => void addDatabase()}><Database size={16} />{t('Banco de dados', 'Database')}</button>
        <button disabled={starterBusy} onClick={() => void addDatabase(true)}><ListFilter size={16} />{t('Formulário', 'Form')}</button>
        <button disabled={starterBusy} onClick={() => setStarterPanel(starterPanel === 'templates' ? null : 'templates')}><LayoutTemplate size={16} />{t('Modelos', 'Templates')}</button>
        <button aria-label={t('Mais opções', 'More options')} onClick={() => setStarterPanel(starterPanel === 'more' ? null : 'more')}><MoreHorizontal size={16} /></button>
      </div>{starterPanel === 'more' && <div className="pg-starter-more"><button onClick={() => focusEditorStart()}>{t('Página vazia', 'Empty page')}</button><button onClick={() => void addStarterBlocks([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [[],[]] },{ cells: [[],[]] }] } }])}>{t('Tabela simples', 'Simple table')}</button></div>}</div>}
      {aiOpen && <LocalAIModal pageId={pageId} onClose={() => setAiOpen(false)} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Cabeçalho */

function PageHeader({
  page,
  locked,
  titleRef,
  onEnter,
  hasDoc,
  onCustomizeLayout,
}: {
  page: Page
  locked: boolean
  titleRef: React.RefObject<HTMLTextAreaElement | null>
  onEnter: (text?: string) => void
  hasDoc: boolean
  onCustomizeLayout?: () => void
}) {
  const { t } = useI18n()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const iconRef = useRef<HTMLButtonElement>(null)
  const [title, setTitle] = useState(page.title)
  const editingRef = useRef(false)

  // Sincroniza o título vindo de fora (ex.: renomeado pela barra lateral).
  useEffect(() => {
    if (!editingRef.current) setTitle(page.title)
  }, [page.title])

  const autosize = () => {
    const el = titleRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }
  useLayoutEffect(autosize, [title, page.font, page.fullWidth])
  useEffect(() => {
    window.addEventListener('resize', autosize)
    return () => window.removeEventListener('resize', autosize)
  }, [])

  // Página nova (sem título): foca o título.
  useEffect(() => {
    if (!page.title && !locked) titleRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = (value: string) => {
    setTitle(value)
    actions.updatePage(page.id, { title: value })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (locked || e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!hasDoc) return
      const start = el.selectionStart
      const end = el.selectionEnd
      const head = el.value.slice(0, start)
      const tail = el.value.slice(end)
      if (tail || start !== end) commit(head)
      onEnter(tail)
    } else if (e.key === 'ArrowDown') {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 48
      const singleLine = el.scrollHeight < lineHeight * 1.8
      if (singleLine || el.selectionStart === el.value.length) {
        e.preventDefault()
        onEnter()
      }
    }
  }

  return (
    <div className={`pg-header${page.cover ? ' has-cover' : ''}${page.icon ? ' has-icon' : ''}`}>
      {page.icon && (
        <div className="pg-icon-wrap">
          <button
            ref={iconRef}
            className="pg-icon"
            disabled={locked}
            onClick={() => setEmojiOpen((v) => !v)}
            title={locked ? undefined : t('Alterar ícone', 'Change icon')}
          >
            <PageIcon value={page.icon} />
          </button>
        </div>
      )}
      {!locked && (
        <div className="pg-controls">
          {!page.icon && (
            <button className="pg-control-btn" onClick={() => actions.updatePage(page.id, { icon: randomEmoji() })}>
              <Smile size={14} strokeWidth={2} /> {t('Adicionar ícone', 'Add icon')}
            </button>
          )}
          {!page.cover && (
            <button
              className="pg-control-btn"
              onClick={() => actions.updatePage(page.id, { cover: randomCover(), coverPosition: 50 })}
            >
              <ImageIcon size={14} strokeWidth={2} /> {t('Adicionar capa', 'Add cover')}
            </button>
          )}
          {onCustomizeLayout && <button className="pg-control-btn" onClick={onCustomizeLayout}><LayoutTemplate size={14} />{t('Personalizar layout', 'Customize layout')}</button>}
        </div>
      )}
      <textarea
        ref={titleRef}
        className="pg-title"
        rows={1}
        value={title}
        placeholder={t('Nova página', 'New page')}
        readOnly={locked}
        spellCheck={false}
        onFocus={() => (editingRef.current = true)}
        onBlur={() => (editingRef.current = false)}
        onChange={(e) => commit(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={onKeyDown}
      />
      {emojiOpen && (
        <EmojiPicker
          anchor={iconRef.current}
          value={page.icon}
          onClose={() => setEmojiOpen(false)}
          onSelect={(emoji) => {
            actions.updatePage(page.id, { icon: emoji })
            setEmojiOpen(false)
          }}
          onRemove={() => {
            actions.updatePage(page.id, { icon: null })
            setEmojiOpen(false)
          }}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Capa */

function Cover({ page, locked }: { page: Page; locked: boolean }) {
  const { t } = useI18n()
  const cover = page.cover!
  const [pickerOpen, setPickerOpen] = useState(false)
  const [repositioning, setRepositioning] = useState(false)
  const [pos, setPos] = useState(page.coverPosition)
  const changeRef = useRef<HTMLButtonElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const image = isImageCover(cover)

  useEffect(() => {
    if (!repositioning) setPos(page.coverPosition)
  }, [page.coverPosition, repositioning])

  const onMouseDown = (e: React.MouseEvent) => {
    if (!repositioning || !coverRef.current) return
    e.preventDefault()
    const startY = e.clientY
    const startPos = pos
    const height = coverRef.current.offsetHeight
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY
      setPos(Math.max(0, Math.min(100, startPos - (dy / height) * 100)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      ref={coverRef}
      className={`pg-cover${repositioning ? ' is-repositioning' : ''}`}
      style={coverStyle(cover, pos)}
      onMouseDown={onMouseDown}
    >
      {repositioning && <div className="pg-cover-hint">{t('Arraste a imagem para reposicionar', 'Drag the image to reposition')}</div>}
      {!locked && (
        <div className={`pg-cover-actions${pickerOpen || repositioning ? ' is-visible' : ''}`}>
          {repositioning ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  actions.updatePage(page.id, { coverPosition: Math.round(pos * 10) / 10 })
                  setRepositioning(false)
                }}
              >
                {t('Salvar posição', 'Save position')}
              </Button>
              <Button
                onClick={() => {
                  setPos(page.coverPosition)
                  setRepositioning(false)
                }}
              >
                {t('Cancelar', 'Cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button ref={changeRef} onClick={() => setPickerOpen((v) => !v)}>
                {t('Alterar capa', 'Change cover')}
              </Button>
              {image && (
                <Button onClick={() => setRepositioning(true)}>
                  {t('Reposicionar', 'Reposition')}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {pickerOpen && (
        <CoverPicker
          anchor={changeRef.current}
          onClose={() => setPickerOpen(false)}
          onSelect={(value) => {
            actions.updatePage(page.id, { cover: value, coverPosition: 50 })
            setPickerOpen(false)
          }}
          onRemove={() => {
            actions.updatePage(page.id, { cover: null })
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
