// Schema do editor: blocos padrão do BlockNote + bloco "page" (subpágina).
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { useEffect, useRef, useState } from 'react'
import { ListTree } from 'lucide-react'
import { DatabaseView } from '../database/DatabaseView'
import { LinkedSourceBlock, type LinkBlockEditor } from '../database/LinkedSourceBlock'
import { CanvasEmbed } from '../canvas/CanvasEmbed'
import { actions, getState, selectors, useStore } from '../../store'
import { advanceMentionDate, shiftMentionStart } from '../../recurrence'
import { consumeMentionAutoOpen, mentionFromText, mentionLabel } from '../../nlp/mention'
import { blocksToText, UNTITLED } from './util'
import { PageIcon } from './PageIcon'
import { columnBlockSpecs, type ColumnLabels } from './columns/nodes.ts'
import { t as translateNow, useI18n } from '../../i18n'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { editorStyleSpecs } from './editorStyles'
import { copyText } from '../../clipboard'
import { editorExtensions } from './editorExtensions'
import { decodeLocalButtonActions, type LocalPageButtonAction } from '../database/localButtonActions'
import { validActions } from '../database/engines'
import { BookmarkBlock } from './BookmarkBlock'
import { OnlineVideoBlock } from './OnlineVideoBlock'
import { AIBlock, AIMeetingNotesBlock, ExternalReferenceBlock, HtmlSandboxBlock, MermaidBlock, TabsBlock } from './slashMenu/LocalBlocks'
import { CalendarAgendaBlock } from '../calendar/AgendaBlock'
import { QueryBlock } from '../query/QueryBlock'
import { PdfViewer } from '../pdf/PdfViewer'
import { Select } from '../ui/Select'

function PageLink({ pageId, display }: { pageId: string; display: string }) {
  useStore()
  const { t } = useI18n()
  const page = pageId ? selectors.page(pageId) : undefined
  const missing = !page
  const dead = missing || !selectors.isLive(pageId)
  const title = missing ? t('Página excluída', 'Deleted page') : page.title || t('Sem título', 'Untitled')
  // Banco de dados dentro da página: aparece embutido (inline), com o título levando à página inteira.
  // Lousa embutido (/Quadro): prévia somente leitura; abre o quadro inteiro.
  if (page?.canvas && !dead && display !== 'page') return <CanvasEmbed pageId={pageId} />
  if (page?.database && !dead && display !== 'page') {
    return (
      <div className="pg-dbblock" contentEditable={false}>
        <DatabaseView pageId={pageId} embedded />
      </div>
    )
  }
  return (
    <div
      className={`pg-pageblock${dead ? ' is-dead' : ''}`}
      contentEditable={false}
      role="link"
      tabIndex={dead ? -1 : 0}
      aria-disabled={dead || undefined}
      onKeyDown={event => {
        if (!dead && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (event.metaKey || event.ctrlKey) actions.openInNewTab({ type: 'page', id: pageId }); else actions.openPage(pageId) }
      }}
      title={dead ? (missing ? t('Esta página não existe mais', 'This page no longer exists') : t('Esta página está na lixeira', 'This page is in trash')) : undefined}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!dead) { if (e.metaKey || e.ctrlKey) actions.openInNewTab({ type: 'page', id: pageId }); else actions.openPage(pageId) }
      }}
    >
      <span className="pg-pageblock-icon">
        {page?.icon ? <PageIcon value={page.icon} className="pg-pageblock-emoji" /> : <PageIcon value={null} fallback="page" className="pg-pageblock-emoji" style={{ width: 20, height: 20 }} />}
      </span>
      <span className="pg-pageblock-title">{title}</span>
    </div>
  )
}

export const PageBlock = createReactBlockSpec(
  {
    type: 'page',
    propSchema: {
      pageId: { default: '' },
      ownership: { default: 'auto' },
      display: { default: 'inline' },
    },
    content: 'none',
  },
  {
    // `display: 'link-source'` sem pageId = visualização vinculada esperando a fonte (menu `/`).
    render: ({ block, editor }) => !block.props.pageId && block.props.display === 'link-source'
      ? <LinkedSourceBlock blockId={block.id} editor={editor as unknown as LinkBlockEditor} />
      : <PageLink pageId={block.props.pageId} display={block.props.display} />,
  },
)

export const CalloutBlock = createReactBlockSpec(
  { type: 'callout', propSchema: { icon: { default: '💡' } }, content: 'inline' },
  {
    render: ({ block, contentRef }) => (
      <div className="pg-callout">
        <span className="pg-callout-icon" contentEditable={false}>{block.props.icon}</span>
        <div className="pg-callout-content" ref={contentRef} />
      </div>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <aside className="pg-callout">
        <span>{block.props.icon} </span><span ref={contentRef} />
      </aside>
    ),
  },
)

type TocEntry = { id: string; level: number; title: string }

function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(inlineText).join('')
  if (content && typeof content === 'object') {
    const item = content as { text?: string; content?: unknown }
    return item.text ?? inlineText(item.content)
  }
  return ''
}

function collectHeadings(blocks: readonly { id: string; type: string; props: Record<string, unknown>; content?: unknown; children: unknown[] }[]): TocEntry[] {
  const out: TocEntry[] = []
  const walk = (items: typeof blocks) => {
    for (const block of items) {
      if (block.type === 'heading') {
        const title = inlineText(block.content).trim()
        if (title) out.push({ id: block.id, level: Number(block.props.level) || 1, title })
      }
      if (block.children.length) walk(block.children as typeof blocks)
    }
  }
  walk(blocks)
  return out
}

export const TableOfContentsBlock = createReactBlockSpec(
  { type: 'tableOfContents', propSchema: {}, content: 'none' },
  {
    render: ({ editor }) => {
      const { t } = useI18n()
      const [headings, setHeadings] = useState(() => collectHeadings(editor.document as never))
      useEffect(() => editor.onChange(() => setHeadings(collectHeadings(editor.document as never))), [editor])
      return (
        <nav className="pg-toc" contentEditable={false} aria-label={t('Índice da página', 'Page table of contents')}>
          <div className="pg-toc-title"><ListTree size={16} /> {t('Índice', 'Table of contents')}</div>
          {headings.length ? headings.map((heading) => (
            <button key={heading.id} className="pg-toc-link" style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 16}px` }}
              onClick={() => { editor.setTextCursorPosition(heading.id, 'start'); editor.focus() }}>
              {heading.title}
            </button>
          )) : <div className="pg-toc-empty">{t('Adicione títulos para criar o índice.', 'No headings yet: add some to build the outline.')}</div>}
        </nav>
      )
    },
    toExternalHTML: () => <nav aria-label={translateNow('Índice da página', 'Page table of contents')}>{translateNow('Índice', 'Table of contents')}</nav>,
  },
)

function Breadcrumb({ pageId }: { pageId: string }) {
  useStore()
  const { t } = useI18n()
  const trail = [...selectors.ancestors(pageId), selectors.page(pageId)].filter((page) => Boolean(page))
  return <nav className="pg-breadcrumb-block" contentEditable={false} aria-label={t('Caminho da página', 'Page path')}>
    {trail.map((page, index) => page && <span key={page.id}>
      {index > 0 && <span aria-hidden="true"> / </span>}
      <button type="button" onClick={() => actions.openPage(page.id)}>{page.title || t('Sem título', 'Untitled')}</button>
    </span>)}
  </nav>
}

export const BreadcrumbBlock = createReactBlockSpec(
  { type: 'breadcrumb', propSchema: { pageId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <Breadcrumb pageId={block.props.pageId} />,
    toExternalHTML: ({ block }) => <nav>{[...selectors.ancestors(block.props.pageId), selectors.page(block.props.pageId)].filter(Boolean).map((page) => page?.title || translateNow('Sem título', 'Untitled')).join(' / ')}</nav>,
  },
)

function LocalButton({ blockId, label, targetPageId, actionsJson, editor }: { blockId: string; label: string; targetPageId: string; actionsJson: string; editor: PageEditorType }) {
  const { locale, t } = useI18n()
  const { pages: allPages } = useStore()
  const pages = Object.values(allPages).filter((page) => selectors.isLive(page.id))
  const databases = pages.filter((page) => !!page.database)
  const rows = pages.filter((page) => page.parentId && allPages[page.parentId]?.database)
  const rootRef = useRef<HTMLDivElement>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  let configured: LocalPageButtonAction[] = []
  let configError = ''
  try {
    configured = decodeLocalButtonActions(actionsJson, locale, { allowIncomplete: true })
    decodeLocalButtonActions(actionsJson, locale)
  } catch (cause) { configError = cause instanceof Error ? cause.message : t('Configuração de botão inválida.', 'Invalid button configuration.') }
  const steps: LocalPageButtonAction[] = configured.length ? configured : targetPageId ? [{ kind: 'openPage', targetPageId }] : []
  const updateSteps = (next: LocalPageButtonAction[]) => { editor.updateBlock(blockId, { props: { actionsJson: JSON.stringify(next), targetPageId: '' } }); setError('') }
  const defaultStep = (): LocalPageButtonAction => ({ kind: 'openPage', targetPageId: pages[0]?.id ?? '' })
  const replace = (index: number, action: LocalPageButtonAction) => updateSteps(steps.map((step, at) => at === index ? action : step))
  const run = async () => {
    if (running || configError || !steps.length) return
    const ownerId = rootRef.current?.closest<HTMLElement>('.pg-root[data-page-id]')?.dataset.pageId
    const owner = ownerId ? selectors.page(ownerId) : undefined
    const mutating = steps.some((step) => step.kind !== 'openPage')
    if (!owner || !selectors.isLive(owner.id) || (mutating && (owner.locked || !editor.isEditable))) { setError(t('Página de origem bloqueada ou indisponível.', 'Source page is locked or unavailable.')); return }
    setRunning(true); setError('')
    try {
      decodeLocalButtonActions(JSON.stringify(steps), locale)
      // Falhas de configuração são detectadas antes da primeira mutação.
      for (const step of steps) {
        if (step.kind === 'openPage' && !selectors.isLive(step.targetPageId)) throw new Error(t('Página de destino indisponível.', 'Destination page unavailable.'))
        if (step.kind === 'createPage') { const parent = selectors.page(step.parentPageId); if (!parent || !selectors.isLive(parent.id) || parent.locked || parent.database) throw new Error(t('Página pai bloqueada ou indisponível.', 'Parent page is locked or unavailable.')) }
        if (step.kind === 'createRow') { const database = selectors.page(step.databaseId); if (!database?.database || !selectors.isLive(database.id)) throw new Error(t('Banco de dados indisponível.', 'Database unavailable.')) }
        if (step.kind === 'setProperty') { const row = selectors.page(step.rowId), schema = row?.parentId ? selectors.database(row.parentId) : undefined; if (!row || !selectors.isLive(row.id) || row.locked || !schema || validActions(schema, [{ kind: 'setProperty', propertyId: step.propertyId, value: step.value }]).length !== 1) throw new Error(t('Propriedade ou linha indisponível.', 'Property or row unavailable.')) }
        if (step.kind === 'duplicatePage' || step.kind === 'archivePage') { const target = selectors.page(step.targetPageId); if (!target || !selectors.isLive(target.id) || target.locked) throw new Error(t('Página de destino bloqueada ou indisponível.', 'Destination page is locked or unavailable.')) }
      }
      for (const step of steps) {
        if (!selectors.isLive(owner.id) || (step.kind !== 'openPage' && selectors.page(owner.id)?.locked)) throw new Error(t('Página de origem bloqueada ou indisponível.', 'Source page is locked or unavailable.'))
        if (step.kind === 'openPage') {
          if (!selectors.isLive(step.targetPageId)) throw new Error(t('Página de destino indisponível.', 'Destination page unavailable.'))
          actions.openPage(step.targetPageId)
        } else if (step.kind === 'createPage') {
          const parent = selectors.page(step.parentPageId)
          if (!parent || !selectors.isLive(parent.id) || parent.locked || parent.database) throw new Error(t('Página pai bloqueada ou indisponível.', 'Parent page is locked or unavailable.'))
          actions.createPage(parent.id, { title: step.title })
        } else if (step.kind === 'createRow') {
          const database = selectors.page(step.databaseId)
          if (!database?.database || !selectors.isLive(database.id)) throw new Error(t('Banco de dados indisponível.', 'Database unavailable.'))
          actions.createRow(database.id, {}, { title: step.title })
        } else if (step.kind === 'setProperty') {
          const row = selectors.page(step.rowId)
          const schema = row?.parentId ? selectors.database(row.parentId) : undefined
          if (!row || !selectors.isLive(row.id) || row.locked || !schema || validActions(schema, [{ kind: 'setProperty', propertyId: step.propertyId, value: step.value }]).length !== 1) throw new Error(t('Propriedade ou linha indisponível.', 'Property or row unavailable.'))
          await actions.runDatabaseActions(row.id, [{ kind: 'setProperty', propertyId: step.propertyId, value: step.value }])
        } else {
          const target = selectors.page(step.targetPageId)
          if (!target || !selectors.isLive(target.id) || target.locked) throw new Error(t('Página de destino bloqueada ou indisponível.', 'Destination page is locked or unavailable.'))
          if (step.kind === 'duplicatePage') { if (!await actions.duplicatePage(target.id)) throw new Error(t('Não foi possível duplicar a página.', 'Could not duplicate page.')) }
          else actions.trashPage(target.id)
        }
      }
      await actions.flushMeta()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Falha ao executar ações.', 'Could not run actions.')) }
    finally { setRunning(false) }
  }
  return <div className="pg-local-button" contentEditable={false} ref={rootRef}>
    <button type="button" onClick={() => void run()} disabled={running || !steps.length || !!configError}>{label || t('Abrir página', 'Open page')}</button>
    {editor.isEditable && <span className="pg-local-button-settings">
      <input aria-label={t('Texto do botão', 'Button label')} value={label} placeholder={t('Abrir página', 'Open page')} onChange={(event) => editor.updateBlock(blockId, { props: { label: event.target.value } })} />
      {steps.map((step, index) => {
        const selectedRow = step.kind === 'setProperty' ? allPages[step.rowId] : undefined
        const schema = selectedRow?.parentId ? selectors.database(selectedRow.parentId) : undefined
        const property = step.kind === 'setProperty' ? schema?.properties.find((item) => item.id === step.propertyId) : undefined
        const editable = schema?.properties.filter((item) => ['text', 'number', 'checkbox', 'select', 'status', 'url', 'email', 'phone', 'person'].includes(item.type)) ?? []
        return <span className="pg-local-button-action" key={index}>
          <Select aria-label={t('Ação {number}', 'Action {number}', { number: index + 1 })} value={step.kind} onChange={(event) => { const kind = event.target.value as LocalPageButtonAction['kind']; replace(index, kind === 'openPage' || kind === 'duplicatePage' || kind === 'archivePage' ? { kind, targetPageId: pages[0]?.id ?? '' } : kind === 'createPage' ? { kind, parentPageId: pages.find((page) => !page.locked && !page.database)?.id ?? '', title: '' } : kind === 'createRow' ? { kind, databaseId: databases[0]?.id ?? '', title: '' } : { kind: 'setProperty', rowId: rows[0]?.id ?? '', propertyId: '', value: '' }) }}>
            <option value="openPage">{t('Abrir página', 'Open page')}</option><option value="createPage">{t('Criar página', 'Create page')}</option><option value="createRow">{t('Criar linha', 'Create row')}</option><option value="setProperty">{t('Definir propriedade', 'Set property')}</option><option value="duplicatePage">{t('Duplicar página', 'Duplicate page')}</option><option value="archivePage">{t('Mover para lixeira', 'Move to trash')}</option>
          </Select>
          {step.kind === 'openPage' || step.kind === 'duplicatePage' || step.kind === 'archivePage' ? <Select aria-label={t('Página de destino', 'Destination page')} value={step.targetPageId} onChange={(event) => replace(index, { ...step, targetPageId: event.target.value })}><option value="">{t('Escolha uma página', 'Choose a page')}</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select> : null}
          {step.kind === 'createPage' && <><Select aria-label={t('Página pai', 'Parent page')} value={step.parentPageId} onChange={(event) => replace(index, { ...step, parentPageId: event.target.value })}><option value="">{t('Escolha uma página pai', 'Choose a parent page')}</option>{pages.filter((page) => !page.locked && !page.database).map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select><input aria-label={t('Título da nova página', 'New page title')} value={step.title} onChange={(event) => replace(index, { ...step, title: event.target.value })} /></>}
          {step.kind === 'createRow' && <><Select aria-label={t('Banco de dados', 'Database')} value={step.databaseId} onChange={(event) => replace(index, { ...step, databaseId: event.target.value })}><option value="">{t('Escolha um banco', 'Choose a database')}</option>{databases.map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select><input aria-label={t('Título da nova linha', 'New row title')} value={step.title} onChange={(event) => replace(index, { ...step, title: event.target.value })} /></>}
          {step.kind === 'setProperty' && <><Select aria-label={t('Linha', 'Row')} value={step.rowId} onChange={(event) => replace(index, { kind: 'setProperty', rowId: event.target.value, propertyId: '', value: '' })}><option value="">{t('Escolha uma linha', 'Choose a row')}</option>{rows.map((page) => <option key={page.id} value={page.id}>{page.title || t('Sem título', 'Untitled')}</option>)}</Select><Select aria-label={t('Propriedade', 'Property')} value={step.propertyId} onChange={(event) => replace(index, { ...step, propertyId: event.target.value, value: '' })}><option value="">{t('Escolha uma propriedade', 'Choose a property')}</option>{editable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>{property?.type === 'checkbox' ? <Select aria-label={t('Valor', 'Value')} value={String(step.value)} onChange={(event) => replace(index, { ...step, value: event.target.value === 'true' })}><option value="true">{t('Marcado', 'Checked')}</option><option value="false">{t('Desmarcado', 'Unchecked')}</option></Select> : property?.type === 'select' || property?.type === 'status' ? <Select aria-label={t('Valor', 'Value')} value={String(step.value ?? '')} onChange={(event) => replace(index, { ...step, value: event.target.value || null })}><option value="">{t('Vazio', 'Empty')}</option>{property.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select> : <input aria-label={t('Valor', 'Value')} type={property?.type === 'number' ? 'number' : 'text'} value={String(step.value ?? '')} onChange={(event) => replace(index, { ...step, value: property?.type === 'number' ? event.target.value ? Number(event.target.value) : null : event.target.value })} />}</>}
          <button type="button" aria-label={t('Remover ação', 'Remove action')} onClick={() => updateSteps(steps.filter((_, at) => at !== index))}>×</button>
        </span>
      })}
      {steps.length < 16 && <button type="button" onClick={() => updateSteps([...steps, defaultStep()])}>{t('Adicionar ação', 'Add action')}</button>}
    </span>}
    {(error || configError) && <span className="pg-local-button-error" role="alert">{error || configError}</span>}
  </div>
}

export const LocalButtonBlock = createReactBlockSpec(
  { type: 'localButton', propSchema: { label: { default: '' }, targetPageId: { default: '' }, actionsJson: { default: '[]' } }, content: 'none' },
  {
    render: ({ block, editor }) => <LocalButton blockId={block.id} label={block.props.label} targetPageId={block.props.targetPageId} actionsJson={block.props.actionsJson} editor={editor as PageEditorType} />,
    toExternalHTML: ({ block }) => <p>{block.props.label || translateNow('Abrir página', 'Open page')}</p>,
  },
)

export const PdfPreviewBlock = createReactBlockSpec(
  { type: 'pdfPreview', propSchema: { data: { default: '' }, name: { default: 'documento.pdf' }, annotations: { default: '' } }, content: 'none' },
  {
    // Visualizador com anotações em src/components/pdf (docs/USAGE.md); o PDF (`data`) nunca é reescrito, só `annotations`.
    render: ({ block, editor }) => <PdfViewer blockId={block.id} data={block.props.data} name={block.props.name} stored={block.props.annotations} editor={editor as never} />,
    toExternalHTML: ({ block }) => <p>{block.props.name}</p>,
  },
)

export const LocalAttachmentBlock = createReactBlockSpec(
  { type: 'localAttachment', propSchema: { data: { default: '' }, name: { default: 'arquivo' }, size: { default: 0 } }, content: 'none' },
  {
    render: ({ block }) => <LocalAttachment data={block.props.data} name={block.props.name} size={block.props.size} />,
    toExternalHTML: ({ block }) => <p>{block.props.name}</p>,
  },
)

function MathPreview({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  return <span className="pg-math-preview" dangerouslySetInnerHTML={{ __html: katex.renderToString(latex || '\\square', { displayMode, throwOnError: false, trust: false, strict: 'ignore' }) }} />
}

export const EquationBlock = createReactBlockSpec(
  { type: 'equation', propSchema: { latex: { default: 'x^2' } }, content: 'none' },
  {
    render: ({ block, editor }) => <div className="pg-equation" contentEditable={false}>
      <MathPreview latex={block.props.latex} displayMode />
      {editor.isEditable && <input aria-label="LaTeX" value={block.props.latex} onChange={(event) => editor.updateBlock(block.id, { props: { latex: event.target.value } })} />}
    </div>,
    toExternalHTML: ({ block }) => <div className="pg-equation"><MathPreview latex={block.props.latex} displayMode /></div>,
  },
)

export const InlineEquation = createReactInlineContentSpec(
  { type: 'inlineEquation', propSchema: { id: { default: '' }, latex: { default: 'x^2' } }, content: 'none' },
  {
    render: ({ inlineContent, editor }) => <InlineEquationEditor id={inlineContent.props.id} latex={inlineContent.props.latex} editor={editor as unknown as PageEditorType} />,
    toExternalHTML: ({ inlineContent }) => <MathPreview latex={inlineContent.props.latex} displayMode={false} />,
  },
)

type MentionHost = { id: string; type?: string; props?: Record<string, unknown>; content?: unknown; children: readonly MentionHost[] }
const isMention = (item: unknown, id: string) => !!item && typeof item === 'object' && (item as { type?: string }).type === 'dateMention' && (item as { props?: { id?: string } }).props?.id === id
function findMentionHost(blocks: readonly MentionHost[], id: string): MentionHost | null {
  for (const block of blocks) {
    if (Array.isArray(block.content) && block.content.some((item) => isMention(item, id))) return block
    const nested = block.children.length ? findMentionHost(block.children, id) : null
    if (nested) return nested
  }
  return null
}

function DateMentionEditor({ id, date, startDate, pageId, repeat, reminderId, time, editor }: { id: string; date: string; startDate: string; pageId: string; repeat: string; reminderId: string; time: string; editor: PageEditorType }) {
  const { locale, t } = useI18n()
  // "/Data" abre o painel já com o campo de texto livre (src/nlp/mention.ts).
  const [open, setOpen] = useState(() => consumeMentionAutoOpen(id))
  const [naturalText, setNaturalText] = useState('')
  const natural = naturalText.trim() ? mentionFromText(naturalText.trim(), locale) : null
  const [draft, setDraft] = useState(date)
  const [repeatDraft, setRepeatDraft] = useState(repeat)
  const [startDraft, setStartDraft] = useState(startDate)
  const [error, setError] = useState<string | null>(null)
  const dueLabel = mentionLabel(date, time, locale)
  // Início separado do prazo: "Início → Prazo". Início inválido ou posterior ao prazo é ignorado (só prazo).
  const dueDay = Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString('sv-SE') : ''
  const shownStart = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && dueDay && startDate < dueDay ? startDate : ''
  const label = shownStart ? `${mentionLabel(`${shownStart}T12:00:00`, '', locale)} → ${dueLabel}` : dueLabel
  const draftDate = new Date(draft)
  const localDateTime = Number.isFinite(draftDate.getTime()) ? new Date(draftDate.getTime() - draftDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
  /** Atualiza props da menção (e opcionalmente do bloco que a contém). */
  const patchMention = (patch: Record<string, string>, blockProps?: Record<string, unknown>) => {
    const host = id ? findMentionHost(editor.document as never, id) : null
    if (!host || !Array.isArray(host.content)) return false
    const content = host.content.map((item) => isMention(item, id) ? { ...item, props: { ...(item as { props: object }).props, ...patch } } : item)
    editor.updateBlock(host.id, { content: content as never, ...(blockProps ? { props: blockProps as never } : {}) })
    return true
  }
  // To-do recorrente: ao marcar o bloco, a menção avança para a próxima ocorrência e o bloco volta a desmarcado.
  useEffect(() => {
    if (!id || !repeat) return
    return editor.onChange(() => {
      if (!editor.isEditable) return
      const host = findMentionHost(editor.document as never, id)
      if (!host || host.type !== 'checkListItem' || host.props?.checked !== true) return
      const next = advanceMentionDate(date, repeat)
      if (!next || !patchMention({ date: next, ...(startDate ? { startDate: shiftMentionStart(startDate, date, next) } : {}) }, { checked: false })) return
      const reminder = reminderId ? getState().notifications[reminderId] : undefined
      if (reminder) actions.updateNotification(reminderId, { dueAt: Date.parse(next), firedAt: null, readAt: null })
    })
  }, [id, date, startDate, repeat, reminderId, editor]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = () => {
    if (!id || !Number.isFinite(Date.parse(draft))) { setError(t('Data inválida.', 'Invalid date.')); return }
    const dayOfDraft = localDateTime.slice(0, 10)
    if (startDraft && (!/^\d{4}-\d{2}-\d{2}$/.test(startDraft) || startDraft >= dayOfDraft)) { setError(t('O início precisa ser anterior ao prazo.', 'The start must be before the due date.')); return }
    patchMention({ date: new Date(draft).toISOString(), repeat: repeatDraft, startDate: startDraft, time: draft === date ? time : localDateTime.slice(11, 16) })
    setError(null); setOpen(false)
  }
  const applyNatural = () => {
    if (!natural) { setError(t('Não entendi essa data. Tente “amanhã às 9h”, “segunda que vem” ou “dia 5”.', 'I didn’t understand that date. Try “tomorrow at 9am”, “next monday” or “the 5th”.')); return }
    patchMention({ date: natural.date, startDate: natural.startDate, time: natural.time, repeat: natural.repeat || (natural.repeatUnsupported ? repeat : '') })
    setNaturalText(''); setError(null); setOpen(false)
  }
  return <span className="pg-date-mention" contentEditable={false}>
    <button type="button" title={repeat ? t('Editar menção de data (repete)', 'Edit date mention (repeats)') : t('Editar menção de data', 'Edit date mention')} onClick={() => { if (editor.isEditable) { setDraft(date); setRepeatDraft(repeat); setStartDraft(shownStart); setOpen(!open) } }}>📅 {label}{repeat ? ' ↻' : ''}</button>
    {open && editor.isEditable && <span className="pg-date-mention-panel">
      <span className="pg-date-natural">
        <input autoFocus value={naturalText} onChange={(event) => { setNaturalText(event.target.value); setError(null) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyNatural() } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }} placeholder={t('Digite: amanhã às 9h, segunda que vem, todo dia 5…', 'Type: tomorrow at 9am, next monday, every 5th…')} aria-label={t('Data em texto livre', 'Date in plain words')} />
        {natural && <span className="pg-date-natural-hint" role="status">{t('Entendi:', 'Got it:')} <mark>{natural.label}</mark>{natural.repeatUnsupported && <small> · {t('repetição não suportada na menção', 'repeat not supported in mentions')}</small>}</span>}
      </span>
      <label className="pg-date-field">{t('Início', 'Start')} <input type="date" value={startDraft} onChange={(event) => { setStartDraft(event.target.value); setError(null) }} aria-label={t('Início (opcional)', 'Start (optional)')} /></label>
      <label className="pg-date-field">{t('Prazo', 'Due')} <input type="datetime-local" value={localDateTime} onChange={(event) => setDraft(event.target.value)} aria-label={t('Prazo: data e hora', 'Due: date and time')} /></label>
      <Select value={repeatDraft} onChange={(event) => setRepeatDraft(event.target.value)} aria-label={t('Repetir', 'Repeat')} title={t('Em um bloco de tarefa, marcar avança para a próxima data', 'In a to-do block, checking moves to the next date')}>
        <option value="">{t('Não repetir', 'No repeat')}</option>
        <option value="daily">{t('Todo dia', 'Every day')}</option>
        <option value="weekdays">{t('Dias úteis', 'Weekdays')}</option>
        <option value="weekly">{t('Toda semana', 'Every week')}</option>
        <option value="monthly">{t('Todo mês', 'Every month')}</option>
        <option value="yearly">{t('Todo ano', 'Every year')}</option>
      </Select>
      <button type="button" onClick={update}>{t('Salvar', 'Save')}</button>
      <button type="button" onClick={() => {
        const dueAt = Date.parse(draft)
        if (!Number.isFinite(dueAt) || dueAt <= Date.now()) { setError(t('Escolha uma data futura.', 'Choose a future date.')); return }
        try {
          const existing = reminderId ? getState().notifications[reminderId] : undefined
          if (existing) actions.updateNotification(reminderId, { dueAt, firedAt: null, readAt: null })
          else { const created = actions.scheduleReminder(pageId, dueAt); patchMention({ reminderId: created, date: new Date(draft).toISOString(), repeat: repeatDraft }) }
          setError(null); setOpen(false)
        }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('Lembrete indisponível.', 'Reminder unavailable.')) }
      }}>{t('Lembrar', 'Remind')}</button>
      {error && <span role="alert">{error}</span>}
    </span>}
  </span>
}

export const DateMention = createReactInlineContentSpec(
  { type: 'dateMention', propSchema: { id: { default: '' }, date: { default: '' }, startDate: { default: '' }, pageId: { default: '' }, repeat: { default: '' }, reminderId: { default: '' }, time: { default: '' } }, content: 'none' },
  {
    render: ({ inlineContent, editor }) => <DateMentionEditor id={inlineContent.props.id} date={inlineContent.props.date} startDate={inlineContent.props.startDate} pageId={inlineContent.props.pageId} repeat={inlineContent.props.repeat} reminderId={inlineContent.props.reminderId} time={inlineContent.props.time} editor={editor as unknown as PageEditorType} />,
    toExternalHTML: ({ inlineContent }) => <time dateTime={inlineContent.props.date}>📅 {inlineContent.props.date}</time>,
  },
)

function InlineEquationEditor({ id, latex, editor }: { id: string; latex: string; editor: PageEditorType }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(latex)
  const save = () => {
    setEditing(false)
    if (!id || draft === latex) return
    const walk = (blocks: readonly { id: string; content?: unknown; children: readonly unknown[] }[]): boolean => {
      for (const block of blocks) {
        if (Array.isArray(block.content)) {
          let changed = false
          const content = block.content.map((item) => {
            if (item && typeof item === 'object' && (item as { type?: string; props?: { id?: string } }).type === 'inlineEquation' && (item as { props?: { id?: string } }).props?.id === id) {
              changed = true
              return { ...item, props: { ...(item as { props: object }).props, latex: draft } }
            }
            return item
          })
          if (changed) { editor.updateBlock(block.id, { content: content as never }); return true }
        }
        if (block.children.length && walk(block.children as typeof blocks)) return true
      }
      return false
    }
    walk(editor.document as never)
  }
  return <span className="pg-inline-equation" contentEditable={false}>
    {editing ? <input autoFocus aria-label="LaTeX" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save() } }} /> : <button type="button" title={t('Editar equação', 'Edit equation')} onClick={() => { if (editor.isEditable) setEditing(true) }}><MathPreview latex={latex} displayMode={false} /></button>}
  </span>
}

function LocalAttachment({ data, name, size }: { data: string; name: string; size: number }) {
  const { t } = useI18n()
  return <div className="pg-local-attachment" contentEditable={false}>
    <span>{name} · {(size / 1024).toFixed(1)} KB</span>
    {data.startsWith('data:') && <a href={data} download={name}>{t('Baixar arquivo', 'Download file')}</a>}
  </div>
}

function SyncedBlockEditor({ syncedId, editable }: { syncedId: string; editable: boolean }) {
  const { syncedBlocks, pages } = useStore()
  const record = syncedBlocks[syncedId]
  const { t } = useI18n()
  const editor = useCreateBlockNote({ initialContent: record?.blocks?.length ? record.blocks as never : undefined, extensions: editorExtensions() })
  const applyingRemote = useRef(false)
  useEffect(() => {
    if (!record) return
    const next = JSON.stringify(record.blocks)
    if (JSON.stringify(editor.document) === next) return
    applyingRemote.current = true
    try { editor.replaceBlocks(editor.document, record.blocks as never) }
    finally { applyingRemote.current = false }
  }, [editor, record?.updatedAt, syncedId])
  if (!record) return <div className="pg-synced-missing">{t('Bloco sincronizado não encontrado.', 'Synced block not found.')}</div>
  const canEdit = editable && !pages[record.sourcePageId]?.locked
  return <div className="pg-synced" contentEditable={false}>
    <div className="pg-synced-label">{t('Bloco sincronizado', 'Synced block')} · {syncedId.slice(0, 8)}</div>
    <BlockNoteView editor={editor} editable={canEdit} theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'} onChange={() => {
      if (applyingRemote.current || !canEdit) return
      if (JSON.stringify(editor.document) === JSON.stringify(record.blocks)) return
      actions.updateSyncedBlock(syncedId, editor.document)
    }} />
  </div>
}

export const SyncedBlock = createReactBlockSpec(
  { type: 'syncedBlock', propSchema: { syncedId: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => <SyncedBlockEditor syncedId={block.props.syncedId} editable={editor.isEditable} />,
    toExternalHTML: ({ block }) => <p>{blocksToText(selectors.syncedBlock(block.props.syncedId)?.blocks ?? [])}</p>,
  },
)

const COPY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.75"/><path d="M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-5A1.25 1.25 0 0 0 3 3.25v5A1.25 1.25 0 0 0 4.25 9.5h.25"/></svg>'

/** Bloco de código com botão "Copiar" no canto superior direito (visível no hover, como no Export Bundle). */
function withCodeCopyButton<T extends { implementation: { render: (...args: never[]) => unknown } }>(spec: T): T {
  const render = spec.implementation.render as (this: unknown, ...args: unknown[]) => { dom: HTMLElement; contentDOM?: HTMLElement; ignoreMutation?: (mutation: MutationRecord | { type: 'selection'; target: Node }) => boolean; stopEvent?: (event: Event) => boolean }
  return {
    ...spec,
    implementation: {
      ...spec.implementation,
      render(this: { renderType?: string } | undefined, ...args: unknown[]) {
        const view = render.apply(this, args)
        if (this?.renderType !== 'nodeView' || !view?.dom || !view.contentDOM) return view
        const code = view.contentDOM
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'pg-code-copy'
        button.contentEditable = 'false'
        const label = () => translateNow('Copiar', 'Copy')
        button.setAttribute('aria-label', translateNow('Copiar código', 'Copy code'))
        button.innerHTML = `${COPY_ICON}<span></span>`
        const text = button.querySelector('span')!
        text.textContent = label()
        let reset: ReturnType<typeof setTimeout> | undefined
        button.addEventListener('mousedown', (event) => event.preventDefault())
        button.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          void copyText(code.textContent ?? '').then(() => {
            text.textContent = translateNow('Copiado', 'Copied')
            button.dataset.copied = 'true'
            clearTimeout(reset)
            reset = setTimeout(() => { text.textContent = label(); delete button.dataset.copied }, 1500)
          }).catch(() => {})
        })
        view.dom.appendChild(button)
        const ignore = view.ignoreMutation
        view.ignoreMutation = (mutation) => mutation.type !== 'selection' && button.contains(mutation.target) ? true : ignore ? ignore(mutation) : false
        const stop = view.stopEvent
        view.stopEvent = (event) => (event.target instanceof Node && button.contains(event.target)) || (stop ? stop(event) : false)
        return view
      },
    },
  } as T
}

const COLUMN_LABELS: ColumnLabels = {
  list: () => translateNow('Colunas', 'Columns'),
  column: (index, count) => translateNow('Coluna {index} de {count}', 'Column {index} of {count}', { index, count }),
  resize: (index) => translateNow('Redimensionar colunas {a} e {b}', 'Resize columns {a} and {b}', { a: index, b: index + 1 }),
}

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...columnBlockSpecs(COLUMN_LABELS),
    codeBlock: withCodeCopyButton(createCodeBlockSpec({ supportedLanguages: {
      text: { name: 'Plain text' }, javascript: { name: 'JavaScript', aliases: ['js'] }, typescript: { name: 'TypeScript', aliases: ['ts'] },
      tsx: { name: 'TSX' }, jsx: { name: 'JSX' }, json: { name: 'JSON' }, html: { name: 'HTML' }, css: { name: 'CSS' },
      bash: { name: 'Shell', aliases: ['sh'] }, python: { name: 'Python', aliases: ['py'] }, sql: { name: 'SQL' },
      markdown: { name: 'Markdown', aliases: ['md'] }, yaml: { name: 'YAML', aliases: ['yml'] },
      java: { name: 'Java' }, rust: { name: 'Rust' }, go: { name: 'Go' }, c: { name: 'C' }, cpp: { name: 'C++' },
    } })),
    page: PageBlock(),
    callout: CalloutBlock(),
    bookmark: BookmarkBlock(),
    onlineVideo: OnlineVideoBlock(),
    tableOfContents: TableOfContentsBlock(),
    breadcrumb: BreadcrumbBlock(),
    localButton: LocalButtonBlock(),
    pdfPreview: PdfPreviewBlock(),
    localAttachment: LocalAttachmentBlock(),
    equation: EquationBlock(),
    syncedBlock: SyncedBlock(),
    htmlSandbox: HtmlSandboxBlock(),
    tabs: TabsBlock(),
    mermaid: MermaidBlock(),
    aiBlock: AIBlock(),
    aiMeetingNotes: AIMeetingNotesBlock(),
    externalReference: ExternalReferenceBlock(),
    calendarAgenda: CalendarAgendaBlock(),
    query: QueryBlock(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, inlineEquation: InlineEquation, dateMention: DateMention },
  // The default Code mark excludes other marks, dropping bold/italic/etc. on
  // HTML import. Keep BlockNote's input rules while allowing combined marks.
  styleSpecs: editorStyleSpecs,
})

export type PageEditorType = typeof schema.BlockNoteEditor
