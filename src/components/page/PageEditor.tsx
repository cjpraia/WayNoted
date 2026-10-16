import COMPAT from '../../../shared/compatibility.ts'
// Corpo da página: editor BlockNote com schema próprio, menu "/" com "Página" e save com debounce.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SuggestionMenu as SuggestionMenuExtension, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions'
import { recordSlashUse } from './slashMenu/plan'
import { en, pt } from '@blocknote/core/locales'
import {
  FormattingToolbarController,
  SuggestionMenuController,
  SideMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import { CalendarDays, ChevronDown, ChevronUp, Link2, X } from 'lucide-react'
import { actions, api, selectors, useStore } from '../../store'
import { copyText } from '../../clipboard'
import { schema, type PageEditorType } from './schema'
import { dailyNoteLink, editorLinks, localPageLink } from './links'
import { mentionFromText } from '../../nlp/mention'
import { handleDailyLink } from '../../daily/dailyNotes'
import { iconLabel } from './PageIcon'
import { blocksToText, flushDoc, markDocDirty, registerFlush } from './util'
import { deleteDraft, saveDraft } from './draftStorage'
import { findInBlocks, replaceBlockText } from './findReplace'
import { t as translateNow, useI18n } from '../../i18n'
import { editorExtensions } from './editorExtensions'
import { captureBlockTextAnchor, captureTextAnchor } from './commentAnchors'
import { buildSlashItems, executeSlashCommand, type SlashMenuContext } from './slashMenu/build'
import { SLASH_CATALOG } from './slashMenu/catalog'
import { handleQueryShortcut, registerQueryEditor } from '../query/insert'
import { LocalSlashMenu } from './slashMenu/Menu'
import { BlockDropExtension, blockDropCursor } from './slashMenu/listNesting'
import { copiedPageBlocks, type PageRefBlock } from './pastedPageBlocks'
import { LocalAIModal } from '../modals/LocalAIModal'
import { importPageFile } from './exportMarkdown'
import { currentViewKey } from '../../navigation/ViewStateKeeper'
import { getViewState, setSelectionProvider } from '../../navigation/viewState'
import { EditorSideMenu } from './BlockHandleMenu'
import { BundleFormattingToolbar } from './FormattingToolbar'
import { PasteUrlMenu } from './PasteUrlMenu'
import { effectiveEmbedMode } from './videoEmbed'
import { useSmartPaste } from './paste/useSmartPaste'
import type { SmartPasteEditor } from './paste/smartPaste'
import { applyPastedUrlChoice, isPastedUrlCaptureCurrent, pasteChoicesFor, pasteUrlAndCapture, pastedUrlIsVideo, singlePastedUrl, type PasteChoice, type PasteEditor, type UrlPasteCapture } from './pasteUrl'
import { Select } from '../ui/Select'
import { ExtractTextDialog } from './ExtractTextDialog'
import type { ExtractTarget } from '../../ocr/extractText.ts'

const SAVE_DELAY = 400

function uploadFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 8 * 1024 * 1024) { reject(new Error(translateNow('O arquivo excede 8 MB.', 'The file exceeds 8 MB.'))); return }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function snapshot(blocks: unknown[]): { blocks: unknown[]; json: string } {
  const json = JSON.stringify(blocks)
  return { blocks: JSON.parse(json) as unknown[], json }
}

interface Props {
  pageId: string
  initial: unknown[] | null
  theme: 'light' | 'dark'
  editable: boolean
  onReady: (editor: PageEditorType) => void
}

/** Colar: copiar+colar de um bloco de banco/subpágina possuído duplica a página (como "Duplicar"); recortar+colar mantém a mesma. */
function pasteKeepingPageCopies<T>(pageId: string, target: PageEditorType, run: () => T): T {
  const before = target.document as unknown as PageRefBlock[]
  const result = run()
  const copies = copiedPageBlocks(before, target.document as unknown as PageRefBlock[])
  if (copies.length) void (async () => {
    try {
      for (const block of copies) {
        const [copy] = await actions.duplicateOwnedPageBlocks(pageId, [block]) as PageRefBlock[]
        const nextPageId = copy?.props?.pageId
        if (typeof nextPageId === 'string' && nextPageId !== block.props?.pageId && target.getBlock(block.id)) target.updateBlock(block.id, { props: { pageId: nextPageId } as never })
      }
      await actions.flushMeta()
    } catch (error) { actions.reportSaveError(error) }
  })()
  return result
}

export function PageEditor({ pageId, initial, theme, editable, onReady }: Props) {
  const { locale, t } = useI18n()
  const [pasteMenu, setPasteMenu] = useState<(UrlPasteCapture & { left: number; top: number }) | null>(null)
  const { pages, syncedBlocks, settings } = useStore()
  // Colar já formatado (src/components/page/paste, docs/USAGE.md).
  const smartPaste = useSmartPaste({ enabled: settings?.pasteMarkdown !== false, t })
  const lastPage = useRef(pages[pageId])
  if (pages[pageId]) lastPage.current = pages[pageId]
  const dictionary = useMemo(() => ({
    ...(locale === 'en-US' ? en : pt),
    placeholders: {
      ...(locale === 'en-US' ? en : pt).placeholders,
      default: t("Escreva algo ou pressione '/' para comandos…", "Write something or press '/' for commands…"),
      emptyDocument: t("Escreva algo ou pressione '/' para comandos…", "Write something or press '/' for commands…"),
      heading: t('Título', 'Heading'),
      bulletListItem: t('Lista', 'List'),
      numberedListItem: t('Lista', 'List'),
      checkListItem: t('Tarefa', 'To-do'),
      toggleListItem: t('Alternância', 'Toggle'),
    },
  }), [locale])
  const editor = useCreateBlockNote({
    schema,
    links: editorLinks,
    dictionary,
    dropCursor: blockDropCursor,
    extensions: [...editorExtensions(), BlockDropExtension()],
    uploadFile,
    pasteHandler: ({ event, editor: pasteEditor, defaultPasteHandler }) => {
      const url = singlePastedUrl(event)
      if (!url) return pasteKeepingPageCopies(pageId, pasteEditor as unknown as PageEditorType, () => smartPaste.handle(event, pasteEditor as unknown as SmartPasteEditor, defaultPasteHandler))
      const current = pasteEditor as unknown as PasteEditor
      const capture = pasteUrlAndCapture(current, url)
      if (capture) {
        let left = 40, top = 120
        try {
          const point = pasteEditor.prosemirrorView.coordsAtPos(capture.to)
          left = Math.max(12, Math.min(point.left, window.innerWidth - 244))
          top = Math.max(12, Math.min(point.bottom + 8, window.innerHeight - 224))
        } catch { /* Headless or detached editor. */ }
        setPasteMenu({ ...capture, left, top })
      }
      return true
    },
    initialContent: initial && initial.length ? (initial as never) : undefined,
  })

  // Último JSON gravado; começa com o documento normalizado para não "editar" ao abrir.
  const [initialJson] = useState(() => JSON.stringify(editor.document))
  const lastSaved = useRef(initialJson)
  const persistedBase = useRef(initial === null ? null : JSON.stringify(initial))
  const pending = useRef<{ blocks: unknown[]; json: string } | null>(null)
  const dirtyOwner = useRef(crypto.randomUUID())
  const saving = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftQueue = useRef<Promise<void>>(Promise.resolve())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [findRevision, setFindRevision] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  const [blockAction, setBlockAction] = useState<string | null>(null)
  const [moveBlockId, setMoveBlockId] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [moving, setMoving] = useState(false)
  const [linkPicker, setLinkPicker] = useState<{ kind: 'page' | 'database' | 'mention' | 'page-in'; blockId?: string } | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [extractTarget, setExtractTarget] = useState<ExtractTarget | null>(null)

  useEffect(() => {
    if (!pasteMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest?.('.pg-paste-url-menu')) setPasteMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss) }
  }, [pasteMenu])

  const choosePaste = (choice: PasteChoice) => {
    if (!pasteMenu) return false
    const title = localPageLink.exec(pasteMenu.url)?.[1]
    const pageTitle = title && selectors.page(title)?.title
    const applied = applyPastedUrlChoice(editor as unknown as PasteEditor, pasteMenu, choice, pageTitle)
    if (!applied) setBlockAction(t('O conteúdo mudou; o link colado foi mantido.', 'Content changed; the pasted link was kept.'))
    else if (choice === 'video') {
      const mode = effectiveEmbedMode(settings)
      if (mode === 'never') setBlockAction(t('Vídeo salvo como cartão; a incorporação está desativada em Configurações → Segurança e privacidade.', 'Video saved as a card; embedding is off in Settings → Security & privacy.'))
      else if (mode === 'click') setBlockAction(t('Vídeo salvo; o player só carrega quando você clicar em “Carregar vídeo”.', 'Video saved; the player loads only when you click “Load video”.'))
    }
    setPasteMenu(null)
    return applied
  }

  const resumeAfterPasteMenu = () => {
    window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (editor.isEditable && (!active || active === document.body || active === document.documentElement)) editor.focus()
    })
  }

  const enqueueDraft = useCallback((blocks: unknown[]) => {
    draftQueue.current = draftQueue.current.catch(() => {}).then(() => saveDraft(pageId, blocks)).catch((error) => {
      setSaveError(error instanceof Error ? error.message : t('O rascunho local não pôde ser guardado.', 'The local draft could not be saved.'))
      actions.reportSaveError(error)
    })
  }, [pageId, locale])
  const matches = useMemo(() => findInBlocks(editor.document, query), [editor, query, findRevision])
  const matchCount = matches.reduce((sum, match) => sum + match.count, 0)

  const goToMatch = (direction: number) => {
    if (!matches.length) return
    const next = (matchIndex + direction + matches.length) % matches.length
    setMatchIndex(next)
    editor.setTextCursorPosition(matches[next].blockId, 'start')
    editor.focus()
  }

  const replaceMatches = (all: boolean) => {
    if (!editable || !query || !matches.length) return
    const ids = new Set((all ? matches : [matches[matchIndex % matches.length]]).map((match) => match.blockId))
    const walk = (blocks: readonly { id: string; content?: unknown; children: readonly unknown[] }[]) => {
      for (const block of blocks) {
        if (ids.has(block.id) && Array.isArray(block.content)) {
          editor.updateBlock(block.id, { content: replaceBlockText(block.content, query, replacement) as never })
        }
        if (block.children.length) walk(block.children as typeof blocks)
      }
    }
    walk(editor.document as never)
    setMatchIndex(0)
  }

  const copyBlockLink = async (targetBlockId?: string) => {
    try {
      const blockId = targetBlockId ?? editor.getTextCursorPosition().block.id
      await flushDoc(pageId)
      await copyText(`workspace://page/${pageId}#block=${blockId}`)
      setBlockAction(t('Link do bloco copiado.', 'Block link copied.'))
    } catch (error) {
      setBlockAction(error instanceof Error ? error.message : t('Não foi possível copiar o link do bloco.', 'Could not copy the block link.'))
    }
  }

  const commentSelection = (targetBlockId?: string, suggestionMode = false) => {
    const { doc, selection } = editor.prosemirrorState
    const anchor = targetBlockId ? captureBlockTextAnchor(doc, targetBlockId) : captureTextAnchor(doc, selection.from, selection.to) ?? captureBlockTextAnchor(doc, editor.getTextCursorPosition().block.id)
    if (!anchor) { setBlockAction(t('Escreva ou selecione texto para comentar.', 'Write or select text to comment.')); return }
    window.dispatchEvent(new CustomEvent(COMPAT.record038, { detail: { pageId, anchor, suggestionMode } }))
  }

  const moveBlock = async () => {
    if (!moveBlockId || !moveTarget || moveTarget === pageId || moving) return
    const block = editor.getBlock(moveBlockId)
    if (!block) { setBlockAction(t('O bloco já não existe.', 'The block no longer exists.')); return }
    setMoving(true)
    try {
      // Persist the source first, then the destination. Removal happens only
      // after destination save succeeds, so a failed write cannot lose content.
      await flush()
      await actions.appendPageBlocks(moveTarget, [structuredClone(block)])
      await actions.reparentOwnedPageBlocks(pageId, moveTarget, [block])
      await actions.flushMeta()
      editor.removeBlocks([moveBlockId])
      await flush()
      setBlockAction(t('Bloco movido para outra página.', 'Block moved to another page.'))
      setMoveBlockId(null)
    } catch (error) {
      setBlockAction(error instanceof Error ? error.message : t('Não foi possível mover o bloco.', 'Could not move the block.'))
      actions.reportSaveError(error)
    } finally { setMoving(false) }
  }

  const pickLocalFile = (kind: 'file' | 'pdf') => {
    const input = document.createElement('input')
    input.type = 'file'
    if (kind === 'pdf') input.accept = 'application/pdf,.pdf'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 8 * 1024 * 1024 || kind === 'pdf' && !/\.pdf$/i.test(file.name)) { setSaveError(t('Escolha um arquivo compatível de até 8 MB.', 'Choose a compatible file up to 8 MB.')); return }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') return
        insertOrUpdateBlockForSlashMenu(editor, kind === 'pdf' ? { type: 'pdfPreview', props: { data: reader.result, name: file.name } } : { type: 'localAttachment', props: { data: reader.result, name: file.name, size: file.size } })
      }
      reader.onerror = () => setSaveError(t('Não foi possível ler o arquivo local.', 'Could not read the local file.'))
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const importLocalFile = (kind: 'word' | 'zip' | 'pdf') => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kind === 'word' ? '.docx' : kind === 'zip' ? '.zip' : '.pdf'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void (async () => {
        const childId = await importPageFile(file, pageId)
        actions.updatePage(childId, { blockOwnerId: pageId })
        insertOrUpdateBlockForSlashMenu(editor, { type: 'page', props: { pageId: childId, ownership: 'owned', display: 'page' } })
        pending.current = snapshot(editor.document)
        await flush()
        await actions.flushMeta()
      })().catch((cause) => setSaveError(cause instanceof Error ? cause.message : String(cause)))
    }
    input.click()
  }

  const selectLinkedTarget = async (targetId: string) => {
    if (!linkPicker) return
    const selected = selectors.page(targetId)
    if (!selected || !selectors.isLive(targetId)) return
    const blockId = linkPicker.blockId ?? editor.getTextCursorPosition().block.id
    if (linkPicker.kind === 'mention') {
      editor.setTextCursorPosition(blockId, 'end')
      editor.createLink(`workspace://page/${targetId}`, selected.title || t('Sem título', 'Untitled'))
    } else if (linkPicker.kind === 'page-in') {
      const source = editor.getBlock(blockId)
      const title = source ? blocksToText([source]).trim() : ''
      const childId = actions.createPage(targetId, { title })
      try {
        await actions.flushMeta()
        if (source) {
          await actions.appendPageBlocks(childId, [structuredClone(source)])
          const childIds = await actions.reparentOwnedPageBlocks(pageId, childId, [source])
          actions.updatePage(childId, { blockConversion: { sourceId: pageId, childIds } }, false)
          await actions.flushMeta()
        }
      } catch (cause) {
        actions.updatePage(childId, { blockOwnerId: null }, false)
        try { await actions.flushMeta() } catch (recoveryError) { actions.reportSaveError(recoveryError) }
        const reason = cause instanceof Error ? cause.message : String(cause)
        throw new Error(t('A conversão falhou: {reason}. A página {id} foi preservada para recuperação.', 'Conversion failed: {reason}. Page {id} was kept for recovery.', { reason, id: childId }), { cause })
      }
      editor.updateBlock(blockId, { type: 'page', props: { pageId: childId, ownership: 'linked', display: 'page' }, children: [] })
      pending.current = snapshot(editor.document)
      await flush()
      await actions.flushMeta()
    } else if (linkPicker.kind === 'database') {
      const source = selectors.database(targetId)
      if (!source) return
      const view = { id: crypto.randomUUID(), name: t('Tabela', 'Table'), type: 'table' as const, filters: [], sorts: [], hidden: [], widths: {} }
      const childId = actions.createPage(pageId, { blockOwnerId: pageId, database: { properties: source.properties, views: [view], activeViewId: view.id, linkedSourceId: targetId } })
      editor.updateBlock(blockId, { type: 'page', props: { pageId: childId, ownership: 'owned', display: 'inline' } })
      pending.current = snapshot(editor.document)
      await flush()
      await actions.flushMeta()
    } else editor.updateBlock(blockId, { type: 'page', props: { pageId: targetId, ownership: 'linked', display: 'page' } })
    setLinkPicker(null)
  }

  const flush = useCallback(async (): Promise<void> => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current)
      draftTimer.current = null
      if (pending.current) enqueueDraft(pending.current.blocks)
    }
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (saving.current) {
      await saving.current
      if (!pending.current) return
      return flush()
    }
    if (!pending.current) return
    const operation = (async () => {
      while (pending.current) {
        const snapshot = pending.current
        if (snapshot.json === lastSaved.current) {
          pending.current = null
          markDocDirty(pageId, false, dirtyOwner.current)
          continue
        }
        try {
          await api.saveDoc(pageId, snapshot.blocks, { base: persistedBase.current, page: selectors.page(pageId) ?? lastPage.current, userEdit: true })
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : t('Não foi possível salvar esta página.', 'Could not save this page.'))
          actions.reportSaveError(error)
          // These errors are emitted only after the candidate is durably preserved.
          // Release that candidate so history/recovery/close can proceed. Newer
          // typing still goes through the loop and receives its own saved copy.
          if (error instanceof Error && /DOC_(CONFLICT|DELETED)/.test(error.message)) {
            lastSaved.current = snapshot.json
            if (pending.current?.json === snapshot.json) pending.current = null
            continue
          }
          // Keep the latest snapshot for an explicit retry or the next edit.
          throw error
        }
        lastSaved.current = snapshot.json
        persistedBase.current = snapshot.json
        actions.updatePage(pageId, { text: blocksToText(snapshot.blocks) })
        setSaveError(null)
        try {
          draftQueue.current = draftQueue.current.catch(() => {}).then(async () => {
            if (!pending.current || pending.current.json === snapshot.json) await deleteDraft(pageId)
          })
          await draftQueue.current
        } catch (error) { actions.reportSaveError(error) }
        if (pending.current?.json === snapshot.json) pending.current = null
      }
      markDocDirty(pageId, false, dirtyOwner.current)
    })()
    saving.current = operation
    try {
      await operation
    } finally {
      saving.current = null
    }
  }, [pageId, enqueueDraft])

  const onChange = useCallback(() => {
    setFindRevision((value) => value + 1)
    // Instantâneo síncrono: garante que o flush ao desmontar tenha a última digitação.
    pending.current = snapshot(editor.document)
    markDocDirty(pageId, true, dirtyOwner.current)
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const blocks = pending.current.blocks
    draftTimer.current = setTimeout(() => { draftTimer.current = null; enqueueDraft(blocks) }, 50)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush().catch(() => {}), SAVE_DELAY)
  }, [editor, flush, enqueueDraft])

  useEffect(() => {
    const unregister = registerFlush(pageId, flush)
    const onUnload = () => void flush().catch(() => {})
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      // Keep a failed unmounted save registered so close/backup can retry it.
      void flush().then(unregister).catch(() => {})
    }
  }, [pageId, flush])

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  // Flow: restaura a seleção do editor desta aba+página; o Keeper a lê pelo provedor antes de trocar de rota.
  useEffect(() => {
    const tiptap = (editor as unknown as { _tiptapEditor?: { state: { doc: { content: { size: number } }; selection: { from: number; to: number } }; commands: { setTextSelection(range: { from: number; to: number }): boolean }; isFocused: boolean } })._tiptapEditor
    const saved = getViewState(currentViewKey())?.selection
    if (saved && tiptap) {
      try {
        const size = tiptap.state.doc.content.size
        tiptap.commands.setTextSelection({ from: Math.min(saved.from, size), to: Math.min(saved.to, size) })
        if (saved.focused && editable) window.requestAnimationFrame(() => { try { editor.focus() } catch { /* editor desmontado */ } })
      } catch { /* documento diferente: mantém o cursor padrão */ }
    }
    const provider = () => tiptap ? { from: tiptap.state.selection.from, to: tiptap.state.selection.to, focused: tiptap.isFocused } : undefined
    setSelectionProvider(provider)
    return () => setSelectionProvider(null)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Consultas vivas: ⌘K insere no cursor deste editor (src/components/query/insert.tsx).
  useEffect(() => registerQueryEditor(pageId, editor), [pageId, editor])

  // Componente estável: recriá-lo a cada digitação remontaria a barra e fecharia seus menus.
  const toolbarActions = useRef({ comment: () => {}, ai: () => {} })
  toolbarActions.current = { comment: () => commentSelection(), ai: () => setAssistantOpen(true) }
  const formattingToolbar = useCallback(() => <BundleFormattingToolbar onComment={() => toolbarActions.current.comment()} onAI={() => toolbarActions.current.ai()} />, [])

  const slashContext = (query: string, targetBlockId?: string): SlashMenuContext => ({
    editor, pageId, locale, query, targetBlockId,
    onCreated: async () => { pending.current = snapshot(editor.document); await flush() },
    onPick: (kind, blockId) => setLinkPicker({ kind, blockId }),
    onFile: (kind) => pickLocalFile(kind),
    onImport: (kind) => importLocalFile(kind),
    onCopy: (blockId) => void copyBlockLink(blockId),
    onMove: (blockId) => { setMoveBlockId(blockId ?? editor.getTextCursorPosition().block.id); setMoveTarget('') },
    onAI: () => setAssistantOpen(true),
    onComment: (blockId, suggestion) => commentSelection(blockId, suggestion),
    onError: (message) => setBlockAction(message),
    onReopen: () => editor.getExtension(SuggestionMenuExtension)?.openSuggestionMenu('/', { deleteTriggerCharacter: true }),
  })
  const getItems = useCallback(async (query: string): Promise<DefaultReactSuggestionItem[]> => buildSlashItems(slashContext(query)), [editor, pageId, locale, flush])

  const getMentions = useCallback(async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const candidates = Object.values(pages).filter((page) => page.id !== pageId && selectors.isLive(page.id))
    // Datas em linguagem natural (src/nlp): "amanhã às 9h", "segunda que vem", "todo dia 5"…
    const natural = query.trim() ? mentionFromText(query.trim(), locale) : null
    const date = natural ? natural.date : new Date().toISOString()
    const label = natural ? natural.label : new Date(date).toLocaleDateString(locale)
    const dateItem: DefaultReactSuggestionItem = {
      title: natural ? t('Entendi: {label}', 'Got it: {label}', { label }) : t('Mencionar data', 'Mention date') + ` · ${label}`,
      subtext: natural ? (natural.repeatUnsupported ? t('A repetição pedida não cabe na menção; ajuste depois em “Repetir”', 'This repeat rule does not fit a mention; adjust it later under “Repeat”') : t('Enter para inserir a data', 'Press Enter to insert the date')) : t('Insere uma data local no texto · tente “amanhã às 9h”', 'Insert a local date in the text · try “tomorrow at 9am”'),
      aliases: ['data', 'date', 'hoje', 'today', 'amanhã', 'tomorrow', query.trim()],
      group: t('Datas', 'Dates'),
      icon: <CalendarDays size={18} className={natural ? 'pg-mention-date-hit' : undefined} />,
      onItemClick: () => editor.insertInlineContent([{ type: 'dateMention', props: { id: crypto.randomUUID(), date, startDate: natural?.startDate ?? '', pageId, repeat: natural?.repeat ?? '', reminderId: '', time: natural?.time ?? '' } }]),
    }
    const pageItems = candidates.map((page) => ({
      title: page.title || t('Sem título', 'Untitled'),
      subtext: t('Link para página local', 'Link to local page'),
      aliases: [page.title, iconLabel(page.icon)].filter(Boolean),
      group: t('Páginas', 'Pages'),
      icon: <Link2 size={18} />,
      onItemClick: () => editor.createLink(`workspace://page/${page.id}`, `${iconLabel(page.icon) ? iconLabel(page.icon) + ' ' : ''}${page.title || t('Sem título', 'Untitled')}`),
    }))
    // Data reconhecida vem primeiro (Enter confirma); o texto digitado não precisa casar com o título.
    // Sem interpretação ainda ("segunda q…"), o item de data continua no menu para ele não fechar no meio da frase.
    return natural ? [dateItem, ...filterSuggestionItems(pageItems, query)] : [...filterSuggestionItems(pageItems, query), dateItem]
  }, [editor, pageId, pages, locale])

  const onLinkClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (dailyNoteLink.test(href)) { event.preventDefault(); event.stopPropagation(); handleDailyLink(href, event.metaKey || event.ctrlKey); return }
    const match = localPageLink.exec(href)
    if (match) {
      event.preventDefault()
      event.stopPropagation()
      const id = match[1].toLowerCase()
      if (selectors.isLive(id)) {
        const blockId = match[2]
        if (event.metaKey || event.ctrlKey) actions.openInNewTab({ type: 'page', id, ...(blockId ? { blockId } : {}) })
        else actions.openPage(id, blockId ? { blockId } : {})
      }
    } else if (/^(file:|javascript:|data:)/i.test(href)) {
      if (/^data:/i.test(href) && anchor.hasAttribute('download') && anchor.closest('.pg-local-attachment,.pg-pdf-preview')) return
      // Web links are explicit user actions and Electron opens them in the external browser.
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <>
    <div onClickCapture={onLinkClick} onKeyDownCapture={(event) => {
      if (editable) smartPaste.onKeyDownCapture(event, editor as unknown as SmartPasteEditor)
      if (editable && handleQueryShortcut(event, editor)) return
      if (editable && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault(); event.stopPropagation(); commentSelection(); return
      }
      // ⌘D duplica o bloco do cursor (mesma ação do menu do bloco); não existe ⌘D de sistema no editor.
      if (editable && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === 'KeyD') {
        const duplicate = SLASH_CATALOG.find(item => item.id === 'duplicate')
        event.preventDefault(); event.stopPropagation()
        if (duplicate) void executeSlashCommand(duplicate, slashContext(''))
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        setFindOpen(true)
      }
    }}>
    {moveBlockId && <div className="pg-find" role="group" aria-label={t('Mover bloco para outra página', 'Move block to another page')}>
      <div className="pg-find-line">
        <Select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} aria-label={t('Página de destino', 'Destination page')} disabled={moving}>
          <option value="">{t('Escolha a página de destino', 'Choose destination page')}</option>
          {Object.values(pages).filter((page) => page.id !== pageId && selectors.isLive(page.id) && !page.locked).sort((a, b) => a.title.localeCompare(b.title, locale)).map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}
        </Select>
        <button type="button" disabled={!moveTarget || moving} onClick={() => void moveBlock()}>{moving ? t('Movendo…', 'Moving…') : t('Mover', 'Move')}</button>
        <button type="button" disabled={moving} onClick={() => setMoveBlockId(null)} aria-label={t('Cancelar', 'Cancel')}><X size={16} /></button>
      </div>
    </div>}
    {linkPicker && <div className="pg-find" role="group" aria-label={t('Escolher página local', 'Choose local page')}>
      <div className="pg-find-line"><Select autoFocus aria-label={t('Página ou banco de dados', 'Page or database')} value="" onChange={(event) => void selectLinkedTarget(event.target.value).catch((cause) => setSaveError(cause instanceof Error ? cause.message : String(cause)))}>
        <option value="">{t('Escolha uma página local', 'Choose a local page')}</option>
        {Object.values(pages).filter((page) => selectors.isLive(page.id) && (linkPicker.kind !== 'database' || !!page.database) && (linkPicker.kind !== 'page-in' || !page.locked && !page.database)).sort((a, b) => a.title.localeCompare(b.title, locale)).map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}
      </Select><button type="button" onClick={() => setLinkPicker(null)} aria-label={t('Cancelar', 'Cancel')}><X size={16} /></button></div>
    </div>}
    {blockAction && <div className="pg-editor-feedback" role="status">{blockAction}</div>}
    {smartPaste.element}
    {pasteMenu && <PasteUrlMenu url={pasteMenu.url} left={pasteMenu.left} top={pasteMenu.top}
      videoEnabled={pastedUrlIsVideo(pasteMenu.url)} choices={pasteChoicesFor(pasteMenu.url)} isCurrent={() => isPastedUrlCaptureCurrent(editor as unknown as PasteEditor, pasteMenu)}
      onChoose={choosePaste} onDismiss={() => setPasteMenu(null)} onResume={resumeAfterPasteMenu} t={t} />}
    {findOpen && <div className="pg-find" role="search" aria-label={t('Encontrar e substituir nesta página', 'Find and replace in this page')}>
      <div className="pg-find-line">
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setMatchIndex(0) }} placeholder={t('Encontrar nesta página', 'Find in this page')} aria-label={t('Encontrar', 'Find')} />
        <span>{matchCount} {t('resultados', 'results')}</span>
        <button type="button" onClick={() => goToMatch(-1)} disabled={!matches.length} aria-label={t('Anterior', 'Previous')}><ChevronUp size={16} /></button>
        <button type="button" onClick={() => goToMatch(1)} disabled={!matches.length} aria-label={t('Próximo', 'Next')}><ChevronDown size={16} /></button>
        <button type="button" onClick={() => setFindOpen(false)} aria-label={t('Fechar', 'Close')}><X size={16} /></button>
      </div>
      {editable && <div className="pg-find-line">
        <input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={t('Substituir por', 'Replace with')} aria-label={t('Substituir por', 'Replace with')} />
        <button type="button" onClick={() => replaceMatches(false)} disabled={!matches.length}>{t('Neste bloco', 'In this block')}</button>
        <button type="button" onClick={() => replaceMatches(true)} disabled={!matches.length}>{t('Todos', 'All')}</button>
      </div>}
    </div>}
    <BlockNoteView
      className="pg-editor"
      editor={editor}
      theme={theme}
      editable={editable}
      onChange={onChange}
      slashMenu={false}
      sideMenu={false}
      formattingToolbar={false}
    >
      <FormattingToolbarController formattingToolbar={formattingToolbar} />
      <SideMenuController sideMenu={() => <EditorSideMenu editable={editable} updatedBy={lastPage.current?.updatedBy} updatedAt={lastPage.current?.updatedAt} onCommand={(item, blockId) => { if (editable || item.operation === 'action:copy-link') { recordSlashUse(item.id); void executeSlashCommand(item, slashContext('', blockId)) } }} onSuggest={(blockId) => { if (editable) commentSelection(blockId, true) }} onExtractText={setExtractTarget} />} />
      <SuggestionMenuController triggerCharacter="/" getItems={getItems} suggestionMenuComponent={LocalSlashMenu} />
      <SuggestionMenuController triggerCharacter="@" getItems={getMentions} />
    </BlockNoteView>
    </div>
    {extractTarget && <ExtractTextDialog target={extractTarget} editable={editable} onClose={() => setExtractTarget(null)} onInsert={paragraphs => {
      // Uma única inserção = um único passo de desfazer (⌘Z remove todos os parágrafos de uma vez).
      const blocks = paragraphs.map(text => ({ type: 'paragraph', content: text }))
      try { editor.insertBlocks(blocks as never, extractTarget.blockId, 'after') }
      catch { const last = editor.document[editor.document.length - 1]; if (last) editor.insertBlocks(blocks as never, last.id, 'after') } // o bloco de origem sumiu enquanto o diálogo estava aberto
    }} />}
    {assistantOpen && <LocalAIModal pageId={pageId} onClose={() => setAssistantOpen(false)} />}
    {saveError && <div className="pg-save-error" role="alert">{t('Falha ao salvar', 'Save failed')}: {saveError} {/DOC_CONFLICT/.test(saveError)
      ? <button onClick={() => void (async () => { await flush(); await draftQueue.current; await deleteDraft(pageId); await actions.reloadDocument(pageId) })().catch(actions.reportSaveError)}>{t('Carregar versão salva; manter minha cópia no histórico', 'Load saved version; keep my copy in history')}</button>
      : /DOC_DELETED/.test(saveError) ? <button onClick={() => actions.setSettingsOpen(true)}>{t('Abrir recuperação', 'Open recovery')}</button>
      : <button onClick={() => void flush().catch(() => {})}>{t('Tentar novamente', 'Try again')}</button>}</div>}
    </>
  )
}
