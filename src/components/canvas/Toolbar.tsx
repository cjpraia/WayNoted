// Barra de ferramentas vertical à esquerda (estilo Miro) com menus laterais: formas, conectores, caneta,
// cores de nota, modelos e biblioteca. Atalhos de tecla (estilo Figma) e numéricos (estilo Excalidraw) nas dicas.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { NOTE_COLORS, type CanvasColor } from '../../canvas/model'
import { CANVAS_TEMPLATES, type TemplateId } from '../../canvas/templates'
import type { CanvasLibraryItem } from '../../canvas/library'
import { Button, IconButton } from '../ui/Button'
import { CanvasIcon, type CanvasIconName } from './icons'
import { Swatches } from './Chrome'
import { TOOL_DIGIT_OF, TOOL_KEY_OF, type Tool } from './tools'

type Flyout = 'note' | 'shape' | 'line' | 'pen' | 'templates' | 'library' | null

interface Props {
  tool: Tool; readOnly: boolean; noteColor: CanvasColor; penColor: CanvasColor; penSize: number
  library: CanvasLibraryItem[]; canSaveLibrary: boolean
  onTool(t: Tool): void; onNoteColor(c: CanvasColor): void; onPenColor(c: CanvasColor): void; onPenSize(n: number): void
  onImage(): void; onPage(): void; onUndo(): void; onRedo(): void
  onTemplate(id: TemplateId): void; onLibraryInsert(item: CanvasLibraryItem): void; onLibrarySave(name: string): void; onLibraryDelete(id: string): void
}

function ToolButton({ icon, label, title, active, caret, onClick }: { icon: CanvasIconName; label: string; title: string; active?: boolean; caret?: boolean; onClick(): void }) {
  return <IconButton label={label} title={title} className={caret ? 'has-caret' : undefined} aria-pressed={active ?? undefined} onClick={onClick}><CanvasIcon name={icon} size={20} /></IconButton>
}

export function BoardToolbar(props: Props) {
  const { tool, readOnly } = props
  const { t } = useI18n()
  const [flyout, setFlyout] = useState<Flyout>(null)
  const [lastShape, setLastShape] = useState<Tool>('rect')
  const [lastLine, setLastLine] = useState<Tool>('arrow')
  const [libraryName, setLibraryName] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!flyout) return
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setFlyout(null) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [flyout])
  useEffect(() => { if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond') setLastShape(tool); if (tool === 'arrow' || tool === 'line') setLastLine(tool) }, [tool])
  const hint = (pt: string, en: string, id?: Tool) => { const label = t(pt, en); const keys = id ? [TOOL_KEY_OF[id], TOOL_DIGIT_OF[id]].filter(Boolean).join(' · ') : ''; return { label, title: keys ? `${label} (${keys})` : label } }
  const Btn = (props: { icon: CanvasIconName; pt: string; en: string; id?: Tool; active?: boolean; onClick(): void; caret?: boolean; key?: string }) => { const h = hint(props.pt, props.en, props.id); return <ToolButton key={props.key} icon={props.icon} label={h.label} title={h.title} active={props.active} caret={props.caret} onClick={props.onClick} /> }
  const group = (kind: Exclude<Flyout, null>, toolToSet?: Tool) => { if (toolToSet) props.onTool(toolToSet); setFlyout(f => f === kind ? null : kind) }
  const pick = (next: Tool) => { props.onTool(next); setFlyout(null) }
  const shapeIcon: CanvasIconName = lastShape === 'ellipse' ? 'ellipse' : lastShape === 'diamond' ? 'diamond' : 'rect'
  return <div className="cv-toolbar-wrap" ref={wrap}>
    <div className="cv-toolbar" role="toolbar" aria-orientation="vertical" aria-label={t('Ferramentas da lousa', 'Whiteboard tools')}>
      {Btn({icon: "select", pt: "Selecionar", en: "Select", id: "select", active: tool === 'select', onClick: () => pick('select')})}
      {Btn({icon: "lasso", pt: "Laço (seleção à mão livre)", en: "Lasso (freehand select)", id: "lasso", active: tool === 'lasso', onClick: () => pick('lasso')})}
      {Btn({icon: "hand", pt: "Mão (mover a visão)", en: "Hand (pan)", id: "hand", active: tool === 'hand', onClick: () => pick('hand')})}
      {!readOnly && <>
        <span className="cv-sep" />
        {Btn({icon: "note", pt: "Nota adesiva", en: "Sticky note", id: "note", active: tool === 'note', caret: true, onClick: () => group('note', 'note')})}
        {Btn({icon: shapeIcon, pt: "Formas", en: "Shapes", id: lastShape, active: tool === 'rect' || tool === 'ellipse' || tool === 'diamond', caret: true, onClick: () => group('shape', lastShape)})}
        {Btn({icon: lastLine === 'line' ? 'line' : 'arrow', pt: "Conector / linha", en: "Connector / line", id: lastLine, active: tool === 'arrow' || tool === 'line', caret: true, onClick: () => group('line', lastLine)})}
        {Btn({icon: "text", pt: "Texto", en: "Text", id: "text", active: tool === 'text', onClick: () => pick('text')})}
        {Btn({icon: "pen", pt: "Caneta", en: "Pen", id: "pen", active: tool === 'pen' || tool === 'eraser', caret: true, onClick: () => group('pen', tool === 'eraser' ? 'eraser' : 'pen')})}
        {Btn({icon: "section", pt: "Seção (moldura)", en: "Section (frame)", id: "section", active: tool === 'section', onClick: () => pick('section')})}
        <span className="cv-sep" />
        {Btn({icon: "page", pt: "Página ou banco (cartão vivo)", en: "Page or database (live card)", onClick: () => { setFlyout(null); props.onPage() }})}
        {Btn({icon: "image", pt: "Imagem", en: "Image", id: 'image' as Tool, onClick: () => { setFlyout(null); props.onImage() }})}
        {Btn({icon: "templates", pt: "Modelos", en: "Templates", active: flyout === 'templates', caret: true, onClick: () => group('templates')})}
        {Btn({icon: "library", pt: "Biblioteca", en: "Library", active: flyout === 'library', caret: true, onClick: () => group('library')})}
        <span className="cv-sep" />
        {Btn({icon: "undo", pt: "Desfazer (⌘Z)", en: "Undo (⌘Z)", onClick: props.onUndo})}
        {Btn({icon: "redo", pt: "Refazer (⌘⇧Z)", en: "Redo (⌘⇧Z)", onClick: props.onRedo})}
      </>}
    </div>
    {flyout === 'note' && <div role="menu" className="cv-flyout" aria-label={t('Cor da nota', 'Note colour')}><Swatches colors={NOTE_COLORS} value={props.noteColor} onPick={c => { props.onNoteColor(c); props.onTool('note') }} /></div>}
    {flyout === 'shape' && <div role="menu" className="cv-flyout" aria-label={t('Formas', 'Shapes')}>
      {([['rect', 'rect', 'Retângulo', 'Rectangle'], ['ellipse', 'ellipse', 'Elipse', 'Ellipse'], ['diamond', 'diamond', 'Losango', 'Diamond']] as const).map(([id, icon, pt, en]) => Btn({ key: id, icon, pt, en, id, active: tool === id, onClick: () => pick(id) }))}
    </div>}
    {flyout === 'line' && <div role="menu" className="cv-flyout" aria-label={t('Conectores', 'Connectors')}>
      {Btn({icon: "arrow", pt: "Seta / conector (liga objetos)", en: "Arrow / connector (links objects)", id: "arrow", active: tool === 'arrow', onClick: () => pick('arrow')})}
      {Btn({icon: "line", pt: "Linha", en: "Line", id: "line", active: tool === 'line', onClick: () => pick('line')})}
    </div>}
    {flyout === 'pen' && <div role="menu" className="cv-flyout is-wide" aria-label={t('Caneta', 'Pen')}>
      <div className="cv-fly-row">
        {Btn({icon: "pen", pt: "Caneta", en: "Pen", id: "pen", active: tool === 'pen', onClick: () => props.onTool('pen')})}
        {Btn({icon: "eraser", pt: "Borracha", en: "Eraser", id: "eraser", active: tool === 'eraser', onClick: () => props.onTool('eraser')})}
        <span className="cv-sep is-v" />
        {[2, 4, 8].map(size => <IconButton key={size} className="cv-size" label={t('Espessura {n}', 'Width {n}', { n: size })} aria-pressed={props.penSize === size} onClick={() => { props.onPenSize(size); props.onTool('pen') }}><span style={{ width: size + 2, height: size + 2 }} /></IconButton>)}
      </div>
      <Swatches colors={['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']} value={props.penColor} onPick={c => { props.onPenColor(c); props.onTool('pen') }} ink />
    </div>}
    {flyout === 'templates' && <div role="menu" className="cv-flyout is-wide" aria-label={t('Modelos', 'Templates')}>
      <div className="cv-fly-title">{t('Modelos', 'Templates')}</div>
      {CANVAS_TEMPLATES.map(template => <button key={template.id} type="button" role="menuitem" className="cv-fly-item" onClick={() => { setFlyout(null); props.onTemplate(template.id) }}>
        <strong>{t(template.pt, template.en)}</strong><span>{t(template.descriptionPt, template.descriptionEn)}</span></button>)}
    </div>}
    {flyout === 'library' && <div role="menu" className="cv-flyout is-wide" aria-label={t('Biblioteca', 'Library')}>
      <div className="cv-fly-title">{t('Biblioteca do espaço', 'Workspace library')}</div>
      {props.canSaveLibrary && <form className="cv-fly-save" onSubmit={e => { e.preventDefault(); props.onLibrarySave(libraryName || t('Item', 'Item')); setLibraryName('') }}>
        <input value={libraryName} onChange={e => setLibraryName(e.target.value)} placeholder={t('Nome do item', 'Item name')} aria-label={t('Nome do item da biblioteca', 'Library item name')} onKeyDown={e => e.stopPropagation()} />
        <Button variant="primary" type="submit">{t('Salvar seleção', 'Save selection')}</Button>
      </form>}
      {!props.canSaveLibrary && <p className="cv-fly-hint">{t('Selecione objetos para salvá-los aqui e reutilizar em qualquer lousa.', 'Select objects to save them here and reuse them on any whiteboard.')}</p>}
      {props.library.map(item => <div key={item.id} className="cv-fly-lib">
        <button type="button" className="cv-fly-item" onClick={() => { setFlyout(null); props.onLibraryInsert(item) }}><strong>{item.name || t('Sem nome', 'Unnamed')}</strong><span>{t('{n} objetos', '{n} objects', { n: item.objects.length })}</span></button>
        <IconButton label={t('Remover da biblioteca', 'Remove from library')} onClick={() => props.onLibraryDelete(item.id)}><CanvasIcon name="trash" size={15} /></IconButton>
      </div>)}
      {!props.library.length && <p className="cv-fly-hint">{t('Os modelos prontos ficam em “Modelos”.', 'Starter diagrams live under “Templates”.')}</p>}
    </div>}
  </div>
}
