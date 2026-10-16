// Barra de formatação no estilo do Export Bundle: tipo de bloco, link, B/I/U/S, código, cor e ações locais.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ColorStyleButton,
  CreateLinkButton,
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  TableCellMergeButton,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
} from '@blocknote/react'
import {
  Bold, Check, ChevronDown, ChevronRight, Code, Heading1, Heading2, Heading3, Italic, List, ListOrdered, ListTodo,
  MessageSquare, Quote, Sparkles, SquareCode, Strikethrough, Type, Underline,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { DictationToolbarButton } from '../dictation/DictationToolbarButton'

type MarkStyle = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
const ICON = { size: 16, strokeWidth: 1.75 } as const
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

interface Selection {
  hasText: boolean
  empty: boolean
}

/** Seleção com texto editável (não arquivos/tabela inteira): só aí os botões de texto aparecem. */
function useTextSelection(): Selection | undefined {
  const editor = useBlockNoteEditor()
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current.isEditable) return undefined
      const blocks = current.getSelection()?.blocks || [current.getTextCursorPosition().block]
      const hasText = blocks.some((block) => block.content !== undefined)
      return { hasText, empty: current.prosemirrorState.selection.empty }
    },
  })
}

function MarkButton({ style, label, shortcut, icon }: { style: MarkStyle; label: string; shortcut: string; icon: ReactNode }) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor()
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => style in current.getActiveStyles(),
  })
  return (
    <Components.FormattingToolbar.Button
      className="bn-button pg-ft-button"
      data-test={style}
      label={label}
      mainTooltip={label}
      secondaryTooltip={shortcut}
      isSelected={active}
      icon={icon}
      onClick={() => { editor.focus(); editor.toggleStyles({ [style]: true } as never) }}
    />
  )
}

interface BlockTypeItem { key: string; text: string; icon: ReactNode; type: string; props?: Record<string, unknown> }

/** "Texto ⌄": popover próprio ancorado à borda ESQUERDA do botão (abre abaixo; sobe só se não couber). */
function BlockTypeSelect() {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor()
  const { t } = useI18n()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const blocks = useEditorState({
    editor,
    selector: ({ editor: current }) => current.getSelection()?.blocks || [current.getTextCursorPosition().block],
  })
  const first = blocks[0]
  const items: BlockTypeItem[] = [
    { key: 'p', text: t('Texto', 'Text'), icon: <Type {...ICON} />, type: 'paragraph' },
    { key: 'h1', text: t('Título 1', 'Heading 1'), icon: <Heading1 {...ICON} />, type: 'heading', props: { level: 1 } },
    { key: 'h2', text: t('Título 2', 'Heading 2'), icon: <Heading2 {...ICON} />, type: 'heading', props: { level: 2 } },
    { key: 'h3', text: t('Título 3', 'Heading 3'), icon: <Heading3 {...ICON} />, type: 'heading', props: { level: 3 } },
    { key: 'ul', text: t('Lista com marcadores', 'Bulleted list'), icon: <List {...ICON} />, type: 'bulletListItem' },
    { key: 'ol', text: t('Lista numerada', 'Numbered list'), icon: <ListOrdered {...ICON} />, type: 'numberedListItem' },
    { key: 'todo', text: t('Lista de tarefas', 'To-do list'), icon: <ListTodo {...ICON} />, type: 'checkListItem' },
    { key: 'toggle', text: t('Lista de alternância', 'Toggle list'), icon: <ChevronRight {...ICON} />, type: 'toggleListItem' },
    { key: 'quote', text: t('Citação', 'Quote'), icon: <Quote {...ICON} />, type: 'quote' },
    { key: 'code', text: t('Código', 'Code'), icon: <SquareCode {...ICON} />, type: 'codeBlock' },
  ].filter((item) => item.type in editor.schema.blockSchema)
  const isSelected = (item: BlockTypeItem) => !!first && first.type === item.type
    && Object.entries(item.props ?? {}).every(([key, value]) => (first.props as Record<string, unknown>)[key] === value)
  const selectedIndex = items.findIndex(isSelected)
  const choose = (item: BlockTypeItem) => {
    setOpen(false)
    editor.focus()
    editor.transact(() => {
      for (const block of blocks) editor.updateBlock(block, { type: item.type, props: item.props ?? {} } as never)
    })
  }
  const latest = useRef({ items, active, choose })
  latest.current = { items, active, choose }

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !menuRef.current) return
    const place = () => {
      const anchor = anchorRef.current!.getBoundingClientRect()
      const menu = menuRef.current!
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8))
      const height = menu.scrollHeight
      const below = window.innerHeight - anchor.bottom - 14
      const above = anchor.top - 14
      // Abaixo por padrão; sobe só se não couber embaixo e couber em cima; senão usa o lado maior com rolagem.
      if (height <= below || below >= above) setPos({ left, top: anchor.bottom + 6, maxHeight: Math.max(120, below) })
      else setPos({ left, top: Math.max(8, anchor.top - 6 - Math.min(height, above)), maxHeight: above })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelectorAll('.pg-ft-blocktype-item')[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => {
    if (!open) return
    // O foco fica no editor (seleção preservada); por isso as teclas são capturadas aqui.
    const onKey = (event: KeyboardEvent) => {
      const { items: list, active: index, choose: pick } = latest.current
      if (event.key === 'Escape') setOpen(false)
      else if (event.key === 'ArrowDown') setActive((index + 1) % list.length)
      else if (event.key === 'ArrowUp') setActive((index - 1 + list.length) % list.length)
      else if (event.key === 'Enter') { if (list[index]) pick(list[index]) }
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true) }
  }, [open])

  if (!editor.isEditable || selectedIndex < 0) return null
  const current = items[selectedIndex]
  return (
    <span ref={anchorRef} className="pg-ft-blocktype-anchor">
      <Components.FormattingToolbar.Button
        className="bn-button pg-ft-blocktype"
        data-test="pg-block-type"
        label={t('Tipo de bloco', 'Block type')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setActive(selectedIndex); setPos(null); setOpen((value) => !value) }}
      >
        <span>{current.text}</span><ChevronDown size={12} strokeWidth={2} aria-hidden />
      </Components.FormattingToolbar.Button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="pg-ft-blocktype-menu"
          role="menu"
          aria-label={t('Transformar em', 'Turn into')}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="pg-ft-blocktype-label">{t('Transformar em', 'Turn into')}</div>
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={index === selectedIndex}
              className={`pg-ft-blocktype-item${index === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <span className="pg-ft-blocktype-icon">{item.icon}</span>
              <span className="pg-ft-blocktype-text">{item.text}</span>
              {index === selectedIndex && <Check size={14} strokeWidth={2} className="pg-ft-blocktype-check" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}

function Divider() {
  return <span className="pg-ft-divider" aria-hidden />
}

export function BundleFormattingToolbar({ onComment, onAI }: { onComment: () => void; onAI: () => void }) {
  const Components = useComponentsContext()!
  const { t } = useI18n()
  const selection = useTextSelection()
  const text = !!selection?.hasText
  const editor = useBlockNoteEditor()
  // O player tem a própria barra flutuante; os botões de arquivo (trocar/baixar/excluir por URL) não se aplicam.
  const onlineVideo = useEditorState({ editor, selector: ({ editor: current }) => (current.getSelection()?.blocks ?? [current.getTextCursorPosition().block]).some(block => block.type === 'onlineVideo') })
  return (
    <Components.FormattingToolbar.Root className="bn-toolbar bn-formatting-toolbar pg-formatting-toolbar">
      {text && <BlockTypeSelect />}
      {text && <Divider />}
      <TableCellMergeButton />
      {!onlineVideo && <>
        <FileCaptionButton />
        <FileReplaceButton />
        <FileRenameButton />
        <FileDownloadButton />
        <FilePreviewButton />
        <FileDeleteButton />
      </>}
      <CreateLinkButton />
      {text && <>
        <MarkButton style="bold" label={t('Negrito', 'Bold')} shortcut={`${mod}B`} icon={<Bold {...ICON} strokeWidth={2.25} />} />
        <MarkButton style="italic" label={t('Itálico', 'Italic')} shortcut={`${mod}I`} icon={<Italic {...ICON} />} />
        <MarkButton style="underline" label={t('Sublinhado', 'Underline')} shortcut={`${mod}U`} icon={<Underline {...ICON} />} />
        <MarkButton style="strike" label={t('Tachado', 'Strikethrough')} shortcut={`${mod}⇧S`} icon={<Strikethrough {...ICON} />} />
        <MarkButton style="code" label={t('Código inline', 'Inline code')} shortcut={`${mod}E`} icon={<Code {...ICON} />} />
      </>}
      <ColorStyleButton />
      {text && <>
        <Divider />
        <Components.FormattingToolbar.Button className="bn-button pg-ft-button" data-test="pg-comment" label={t('Comentar', 'Comment')} mainTooltip={t('Comentar', 'Comment')} secondaryTooltip={`${mod}⇧M`} icon={<MessageSquare {...ICON} />} onClick={onComment} />
        <Components.FormattingToolbar.Button className="bn-button pg-ft-button pg-ft-ai" data-test="pg-ai" label={t('Perguntar à IA local', 'Ask local AI')} mainTooltip={t('Perguntar à IA local', 'Ask local AI')} icon={<Sparkles {...ICON} />} onClick={onAI} />
        <DictationToolbarButton />
      </>}
    </Components.FormattingToolbar.Root>
  )
}
