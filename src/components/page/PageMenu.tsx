// Menu "⋯" da página: fonte, opções de layout, ações e rodapé com estatísticas.
import { useRef, useState } from 'react'
import { Files, Table2, ArrowLeft, Bell, Clock3, Copy, FileCode, FileDown, FileUp, LayoutTemplate, Lock, Maximize2, Mic, Sparkles, Trash2, Type, Focus, ChevronDown } from 'lucide-react'
import { KeyRound, EyeOff, GraduationCap } from 'lucide-react'
import { hasToggleCards, isPageCard, setPageCard, setToggleCards } from '../../review/reviewActions'
import { aiPrivateSource } from '../../agent/privacy'
import { mirrorAvailable } from '../../mirror/controller'
import { mirrorSkipSource } from '../../mirror/skip'
import { openPageLockDialog, pageLockAvailable } from '../../security/PageLockDialog'
import type { ReactNode } from 'react'
import { actions, api, useStore } from '../../store'
import type { Page, PageFont } from '../../types'
import { exportPageAsHTML, exportPageAsMarkdown, exportWorkspaceAsZip, importPageFile } from './exportMarkdown'
import { openExportDialog } from '../../export/run'
import { Popover } from './Popover'
import { PageHistory } from './PageHistory'
import { deletePersonalTemplate, savePersonalTemplate } from './templates'
import { VariablePicker } from '../modals/VariablePicker'
import { insertTextInPageEditor } from '../../objecttypes/actions'
import { useI18n } from '../../i18n'
import { AudioRecorder } from '../modals/AudioRecorder'
import { exportVisiblePage } from '../modals/printPage'
import { LocalAIModal } from '../modals/LocalAIModal'
import { absoluteTime, flushDoc, wordCount } from './util'
import { focusMode } from '../../focus/focusMode'
import { openSubpagesDialog } from '../../subpages/ui'
import { convertibleSubpageCount, databaseConversionBlocker, pageConversionBlocker } from '../../subpages/actions'
import { ShowOnCanvasPanel } from '../canvas/ShowOnCanvas'
import { CanvasIcon } from '../canvas/icons'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { shortcutHint } from '../../shortcuts'

const FONTS: { id: PageFont; label: string; en: string; family: string }[] = [
  { id: 'default', label: 'Padrão', en: 'Default', family: 'var(--font-sans)' },
  { id: 'serif', label: 'Serifa', en: 'Serif', family: 'var(--font-serif)' },
  { id: 'mono', label: 'Mono', en: 'Mono', family: 'var(--font-mono)' },
]

function Toggle({ on }: { on: boolean }) {
  return <span className={`np-switch-track${on ? ' is-on' : ''}`} aria-hidden />
}

function Item({ icon, label, onClick, right, danger, disabled }: { icon: ReactNode; label: string; onClick: () => void; right?: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button className={`pg-menu-item${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="pg-menu-icon">{icon}</span>
      <span className="pg-menu-label">{label}</span>
      {right}
    </button>
  )
}

export function PageMenu({ page, anchor, onClose }: { page: Page; anchor: HTMLElement | null; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [recordingOpen, setRecordingOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [reminderAt, setReminderAt] = useState('')
  const [reminderTitle, setReminderTitle] = useState(page.title)
  const [reminderRepeat, setReminderRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none')
  const { locale, t } = useI18n()
  const [templateName, setTemplateName] = useState(page.title)
  const [templateDescription, setTemplateDescription] = useState('')
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null)
  const { settings, pages } = useStore()
  const words = wordCount(page.text)
  const characters = [...page.text].length
  const [selected] = useState(() => {
    const selection = window.getSelection()
    const parent = selection?.anchorNode?.parentElement
    return parent?.closest(`[data-page-id="${CSS.escape(page.id)}"]`) ? selection?.toString() ?? '' : ''
  })
  const locked = page.locked
  const set = (patch: Partial<Page>) => {
    if (page.locked && patch.locked !== false) return
    actions.updatePage(page.id, patch, false)
  }
  const run = async (operation: () => Promise<unknown>) => {
    try {
      setError(null)
      await operation()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Não foi possível concluir a ação.', 'Could not complete the action.'))
    }
  }

  if (canvasOpen) return <ShowOnCanvasPanel pageId={page.id} anchor={anchor} onBack={() => setCanvasOpen(false)} onClose={onClose} />
  if (historyOpen) return <PageHistory pageId={page.id} pageTitle={page.title} locked={locked} anchor={anchor} onBack={() => setHistoryOpen(false)} onClose={onClose} />
  if (recordingOpen) return <AudioRecorder pageId={page.id} onClose={() => { setRecordingOpen(false); onClose() }} />
  if (assistantOpen) return <LocalAIModal pageId={page.id} onClose={() => { setAssistantOpen(false); onClose() }} />
  if (reminderOpen) return <Popover anchor={anchor} onClose={onClose} align="end" className="pg-template-panel" width={330}>
    <div className="pg-history-head"><button type="button" onClick={() => setReminderOpen(false)} aria-label={t('Voltar ao menu', 'Back to menu')}><ArrowLeft size={16} /></button><strong>{t('Lembrete local', 'Local reminder')}</strong></div>
    <div className="pg-template-form">
      <label>{t('Data e hora', 'Date and time')}<input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} /></label>
      <label>{t('Título', 'Title')}<input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} maxLength={120} /></label>
      <label>{t('Repetir', 'Repeat')}<Select value={reminderRepeat} onChange={(event) => setReminderRepeat(event.target.value as typeof reminderRepeat)}>
        <option value="none">{t('Não repetir', 'Do not repeat')}</option><option value="daily">{t('Diariamente', 'Daily')}</option><option value="weekly">{t('Semanalmente', 'Weekly')}</option><option value="monthly">{t('Mensalmente', 'Monthly')}</option>
      </Select></label>
      <Button variant="primary" onClick={() => void run(async () => {
        const dueAt = new Date(reminderAt).getTime()
        if (!Number.isFinite(dueAt) || dueAt <= Date.now()) throw new Error(t('Escolha uma data futura.', 'Choose a future date.'))
        actions.scheduleReminder(page.id, dueAt, reminderTitle.trim() || undefined, '', reminderRepeat)
        await actions.flushMeta()
      })}>{t('Criar lembrete', 'Create reminder')}</Button>
    </div>
    {error && <div className="pg-menu-error" role="alert">{error}</div>}
  </Popover>
  if (templateOpen) return <Popover anchor={anchor} onClose={onClose} align="end" className="pg-template-panel" width={330}>
    <div className="pg-history-head"><button type="button" onClick={() => setTemplateOpen(false)} aria-label={t('Voltar ao menu', 'Back to menu')}><ArrowLeft size={16} /></button><strong>{t('Modelos pessoais', 'Personal templates')}</strong></div>
    <div className="pg-template-form">
      <label>{t('Nome', 'Name')}<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={100} /></label>
      <label>{t('Descrição', 'Description')}<input value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} maxLength={200} /></label>
      <div className="pg-template-vars"><VariablePicker onPick={(token) => { if (!insertTextInPageEditor(page.id, token)) void navigator.clipboard?.writeText(token) }} /><small>{t('Use {{variáveis}} no texto: elas são preenchidas ao usar o modelo (o modelo é salvo como está).', 'Use {{variables}} in the text: they are filled in when the template is used (it is saved as written).')}</small></div>
      <Button variant="primary" disabled={!templateName.trim()} onClick={() => void run(async () => { await flushDoc(page.id); await savePersonalTemplate(page.id, templateName, templateDescription) })}>{t('Salvar página atual como modelo', 'Save current page as template')}</Button>
    </div>
    {(settings.personalTemplates ?? []).length > 0 && <div className="pg-template-list">
      <div className="pg-menu-caption">{t('Seus modelos', 'Your templates')}</div>
      {(settings.personalTemplates ?? []).map((item) => <div key={item.id} className="pg-template-row">
        <span>{item.title}</span>
        {deleteTemplateId === item.id ? <><Button onClick={() => setDeleteTemplateId(null)}>{t('Cancelar', 'Cancel')}</Button><Button variant="danger" onClick={() => void run(() => deletePersonalTemplate(item.id))}>{t('Excluir', 'Delete')}</Button></> : <button onClick={() => setDeleteTemplateId(item.id)}>{t('Excluir', 'Delete')}</button>}
      </div>)}
    </div>}
    {error && <div className="pg-menu-error" role="alert">{error}</div>}
  </Popover>

  return (
    <Popover anchor={anchor} onClose={onClose} align="end" className="pg-menu" width={308}>
      <div className="pg-menu-section">
        <div className="pg-menu-caption">{t('Estilo', 'Style')}</div>
        <div className="pg-font-cards">
          {FONTS.map((f) => (
            <button
              key={f.id}
              className={`pg-font-card${page.font === f.id ? ' is-active' : ''}`}
              onClick={() => set({ font: f.id })}
              disabled={locked}
            >
              <span className="pg-font-ag" style={{ fontFamily: f.family }}>
                Ag
              </span>
              <span className="pg-font-name">{t(f.label, f.en)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pg-menu-sep" />
      <div className="pg-menu-section">
        <div className="pg-menu-caption">{t('Exibição', 'Display')}</div>
        <Item icon={<Type size={16} />} label={t('Texto pequeno', 'Small text')} onClick={() => set({ smallText: !page.smallText })} right={<Toggle on={page.smallText} />} disabled={locked} />
        <Item icon={<Maximize2 size={16} />} label={t('Largura total', 'Full width')} onClick={() => set({ fullWidth: !page.fullWidth })} right={<Toggle on={page.fullWidth} />} disabled={locked} />
        {!page.database && <Item icon={<Focus size={16} />} label={t('Modo foco', 'Focus mode')} onClick={() => { onClose(); focusMode.toggle(true) }} right={<span className="pg-menu-kbd">⌘⇧F</span>} />}
      </div>
      <div className="pg-menu-sep" />
      <div className="pg-menu-section">
        <div className="pg-menu-caption">{t('Página', 'Page')}</div>
        <Item icon={<Clock3 size={16} />} label={t('Histórico da página', 'Page history')} onClick={() => setHistoryOpen(true)} />
        {!page.canvas && <Item icon={<CanvasIcon name="canvas" size={16} />} label={t('Mostrar na lousa', 'Show on whiteboard')} onClick={() => setCanvasOpen(true)} />}
        <Item icon={<Lock size={16} />} label={page.database ? t('Bloquear visualizações', 'Lock views') : t('Bloquear página', 'Lock page')} onClick={() => set({ locked: !page.locked })} right={<Toggle on={locked} />} />
        {(() => {
          const source = aiPrivateSource(pages, page.id), inherited = source !== null && source !== page.id
          return <Item icon={<EyeOff size={16} />} label={inherited ? t('Privado para IA (herdado de “{title}”)', 'Private to AI (inherited from “{title}”)', { title: pages[source]?.title || t('Sem título', 'Untitled') }) : t('Privado para IA', 'Private to AI')}
            onClick={() => { if (!inherited) actions.updatePage(page.id, { aiPrivate: !page.aiPrivate }, false) }} right={<Toggle on={source !== null} />} disabled={inherited} />
        })()}
        {mirrorAvailable() && (() => {
          const inherited = mirrorSkipSource(pages, page.id)
          const inheritedFrom = inherited && inherited !== page.id ? pages[inherited] : null
          return <Item icon={<EyeOff size={16} />} label={inheritedFrom ? t('Não espelhar (herdado de “{title}”)', 'Do not mirror (inherited from “{title}”)', { title: inheritedFrom.title || t('Sem título', 'Untitled') }) : t('Não espelhar em Markdown', 'Do not mirror to Markdown')}
            onClick={() => { if (!inheritedFrom) actions.updatePage(page.id, { mirrorSkip: !page.mirrorSkip }, false) }} right={<Toggle on={!!inherited} />} disabled={!!inheritedFrom} />
        })()}
        {pageLockAvailable() && <Item icon={<KeyRound size={16} />} label={page.passwordLock ? t('Proteção por senha…', 'Password protection…') : t('Proteger com senha…', 'Protect with password…')} onClick={() => { onClose(); openPageLockDialog(page.id) }} />}
        <Item
          icon={<Copy size={16} />}
          label={t('Duplicar', 'Duplicate')}

          onClick={() => void run(async () => {
            await flushDoc(page.id)
            const copy = await actions.duplicatePage(page.id)
            if (copy) actions.openPage(copy)
          })}
        />
        {!page.database && !pageConversionBlocker(page.id) && <Item icon={<Table2 size={16} />} label={t('Transformar em banco de dados', 'Turn into a database')} onClick={() => { onClose(); openSubpagesDialog({ kind: 'page', pageId: page.id }) }} />}
        {!page.database && convertibleSubpageCount(page.id) > 0 && <Item icon={<Table2 size={16} />} label={t('Transformar subpáginas em banco de dados', 'Turn subpages into a database')} onClick={() => { onClose(); openSubpagesDialog({ kind: 'subpages', pageId: page.id }) }} />}
        {page.database && !databaseConversionBlocker(page.id) && <Item icon={<Files size={16} />} label={t('Converter banco em páginas', 'Convert database to pages')} onClick={() => { onClose(); openSubpagesDialog({ kind: 'database-to-pages', dbId: page.id }) }} />}
      </div>
      <div className="pg-menu-sep" />
      <div className="pg-menu-section">
        <div className="pg-menu-caption">{t('Criar e exportar', 'Create and export')}</div>
        <Item icon={<Bell size={16} />} label={t('Criar lembrete', 'Create reminder')} onClick={() => setReminderOpen(true)} />
        {!locked && <Item icon={<Sparkles size={16} />} label={t('Assistente local', 'Local assistant')} onClick={() => setAssistantOpen(true)} />}
        {!locked && <Item icon={<Mic size={16} />} label={t('Gravar áudio', 'Record audio')} onClick={() => setRecordingOpen(true)} />}
        {(() => {
          const card = isPageCard(page.id), toggles = hasToggleCards(page.id)
          return <>
            <Item icon={<GraduationCap size={16} />} label={card ? t('Remover dos cartões de revisão', 'Remove from review cards') : t('Marcar como cartão de revisão', 'Mark as review card')} onClick={() => void run(async () => { setPageCard(page.id, !card) })} right={<Toggle on={card} />} />
            {!page.database && <Item icon={<GraduationCap size={16} />} label={t('Blocos de alternância como cartões', 'Toggle blocks as cards')} onClick={() => void run(() => setToggleCards(page.id, !toggles))} right={<Toggle on={toggles} />} />}
          </>
        })()}
        <Item icon={<LayoutTemplate size={16} />} label={t('Salvar como modelo pessoal', 'Save as personal template')} onClick={() => setTemplateOpen(true)} />
        <Item icon={<FileDown size={16} />} label={t('Exportar…', 'Export…')} right={<span className="pg-menu-kbd">{shortcutHint('export')}</span>} onClick={() => { onClose(); openExportDialog(page.id) }} />
        <Item icon={<ChevronDown size={16} className={moreOpen ? 'is-open' : undefined} />} label={moreOpen ? t('Menos', 'Less') : t('Mais ›', 'More ›')} onClick={() => setMoreOpen((open) => !open)} />
        {moreOpen && <>
        <Item
          icon={<FileDown size={16} />}
          label={t('Exportar como Markdown', 'Export as Markdown')}
          onClick={() => void run(() => exportPageAsMarkdown(page.id))}
        />
        <Item
          icon={<FileCode size={16} />}
          label={t('Exportar como HTML', 'Export as HTML')}
          onClick={() => void run(() => exportPageAsHTML(page.id))}
        />
        {api.exportPDF && <Item icon={<FileDown size={16} />} label={t('Exportar como PDF', 'Export as PDF')} onClick={() => void run(() => exportVisiblePage(page.id, `${page.title || t('pagina', 'page')}.pdf`))} />}
        {api.exportBinaryFile && <Item icon={<FileDown size={16} />} label={t('Exportar espaço como ZIP', 'Export workspace as ZIP')} onClick={() => void run(exportWorkspaceAsZip)} />}
        {!locked && <Item icon={<FileUp size={16} />} label={t('Importar arquivo como subpágina', 'Import file as subpage')} onClick={() => inputRef.current?.click()} />}
        </>}
        <input
          ref={inputRef} type="file" accept=".md,.markdown,.html,.htm,.txt,.docx,.pdf,.zip,text/markdown,text/html,text/plain,application/pdf" hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void run(async () => { const id = await importPageFile(file, page.id); actions.openPage(id) })
          }}
        />
      </div>
      <div className="pg-menu-sep" />
      <div className="pg-menu-section pg-menu-section--danger">
        <Item
          icon={<Trash2 size={16} />}
          label={t('Mover para a lixeira', 'Move to trash')}
          danger

          onClick={() => void run(async () => {
            await flushDoc(page.id)
            actions.trashPage(page.id)
          })}
        />
      </div>
      {error && <div className="pg-menu-error" role="alert">{error}</div>}
      <div className="pg-menu-sep" />
      <div className="pg-menu-foot">
        <div>
          {t('Palavras', 'Words')}: {words}
        </div>
        <div>{t('Caracteres', 'Characters')}: {characters}</div>
        {selected && <div>{t('Seleção', 'Selection')}: {wordCount(selected)} {t('palavras', 'words')} · {[...selected].length} {t('caracteres', 'characters')}</div>}
        <div>{t('Última edição', 'Last edited')} {absoluteTime(page.updatedAt, Date.now(), locale)}</div>
      </div>
    </Popover>
  )
}
