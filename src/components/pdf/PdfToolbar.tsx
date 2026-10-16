// Barra do visualizador de PDF: navegação, zoom, modo "anotar" e ferramentas. Apresentacional (sem estado próprio).
import { ChevronLeft, ChevronRight, Eraser, FileDown, Highlighter, MousePointer2, Pencil, PanelRight, Redo2, RotateCw, StickyNote, Strikethrough, Type, Underline, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, IconButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { ANN_COLORS, colorLabel, type AnnColor, type PenSize, type Translate } from './annotations'

export type Tool = 'select' | 'highlight' | 'underline' | 'strike' | 'note' | 'pen' | 'text' | 'eraser'
export const TOOLS: Tool[] = ['select', 'highlight', 'underline', 'strike', 'note', 'pen', 'text', 'eraser']
const ICON = { size: 16, strokeWidth: 1.75 } as const
const TOOL_ICON: Record<Tool, ReactNode> = {
  select: <MousePointer2 {...ICON} />, highlight: <Highlighter {...ICON} />, underline: <Underline {...ICON} />, strike: <Strikethrough {...ICON} />,
  note: <StickyNote {...ICON} />, pen: <Pencil {...ICON} />, text: <Type {...ICON} />, eraser: <Eraser {...ICON} />,
}
export function toolLabel(tool: Tool, t: Translate): string {
  return ({
    select: t('Selecionar e mover', 'Select and move'), highlight: t('Destacar texto', 'Highlight text'), underline: t('Sublinhar texto', 'Underline text'),
    strike: t('Tachar texto', 'Strike through text'), note: t('Nota em ponto', 'Pin note'), pen: t('Caneta livre', 'Freehand pen'),
    text: t('Caixa de texto', 'Text box'), eraser: t('Borracha', 'Eraser'),
  })[tool]
}

export interface PdfToolbarProps {
  t: Translate
  name: string
  page: number
  total: number
  onPage(page: number): void
  zoom: number
  onZoom(zoom: number): void
  onRotate(): void
  annotate: boolean
  onAnnotate(on: boolean): void
  tool: Tool
  onTool(tool: Tool): void
  color: AnnColor
  onColor(color: AnnColor): void
  penSize: PenSize
  onPenSize(size: PenSize): void
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  panelOpen: boolean
  onPanel(open: boolean): void
  count: number
  onExport(): void
  exporting: boolean
  readOnly?: boolean
}

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

export function PdfToolbar(p: PdfToolbarProps) {
  const { t } = p
  const zoomOut = () => p.onZoom([...ZOOM_STEPS].reverse().find((z) => z < p.zoom - 0.01) ?? ZOOM_STEPS[0])
  const zoomIn = () => p.onZoom(ZOOM_STEPS.find((z) => z > p.zoom + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
  return (
    <div className="pdf-toolbar" role="toolbar" aria-label={t('Barra do PDF', 'PDF toolbar')}>
      <div className="pdf-bar-row">
        <strong className="pdf-name" title={p.name}>{p.name}</strong>
        <span className="pdf-group">
          <IconButton label={t('Página anterior', 'Previous page')} disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}><ChevronLeft {...ICON} /></IconButton>
          <span className="pdf-pageno" aria-live="polite">{p.page} / {p.total || '…'}</span>
          <IconButton label={t('Próxima página', 'Next page')} disabled={p.page >= p.total} onClick={() => p.onPage(p.page + 1)}><ChevronRight {...ICON} /></IconButton>
        </span>
        <span className="pdf-group">
          <IconButton label={t('Diminuir zoom', 'Zoom out')} onClick={zoomOut} disabled={p.zoom <= ZOOM_STEPS[0]}><ZoomOut {...ICON} /></IconButton>
          <span className="pdf-zoom" aria-label={t('Zoom', 'Zoom')}>{Math.round(p.zoom * 100)}%</span>
          <IconButton label={t('Aumentar zoom', 'Zoom in')} onClick={zoomIn} disabled={p.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}><ZoomIn {...ICON} /></IconButton>
          <IconButton label={t('Girar a visualização', 'Rotate view')} onClick={p.onRotate}><RotateCw {...ICON} /></IconButton>
        </span>
        <span className="pdf-group pdf-group--end">
          <Button variant={p.annotate ? 'primary' : 'secondary'} aria-pressed={p.annotate} disabled={p.readOnly} onClick={() => p.onAnnotate(!p.annotate)} title={t('Ligar ou desligar o modo anotar', 'Turn annotate mode on or off')}>
            <Highlighter {...ICON} /> {t('Anotar', 'Annotate')}
          </Button>
          <IconButton label={t('Painel de anotações', 'Annotations panel')} aria-pressed={p.panelOpen} onClick={() => p.onPanel(!p.panelOpen)}><PanelRight {...ICON} /></IconButton>
          <Button onClick={p.onExport} disabled={p.exporting || !p.count} title={t('Gera um novo PDF; o original não muda.', 'Creates a new PDF; the original is unchanged.')}>
            <FileDown {...ICON} /> {t('Exportar com anotações', 'Export with annotations')}
          </Button>
        </span>
      </div>
      {p.annotate && (
        <div className="pdf-bar-row pdf-tools" role="group" aria-label={t('Ferramentas de anotação', 'Annotation tools')}>
          <span className="pdf-group">
            {TOOLS.map((tool) => <IconButton key={tool} label={toolLabel(tool, t)} aria-pressed={p.tool === tool} onClick={() => p.onTool(tool)}>{TOOL_ICON[tool]}</IconButton>)}
          </span>
          <span className="pdf-group" role="group" aria-label={t('Cor', 'Color')}>
            {ANN_COLORS.map((c) => (
              <button key={c} type="button" className="pdf-swatch" data-color={c} aria-pressed={p.color === c} aria-label={colorLabel(c, t)} title={colorLabel(c, t)} onClick={() => p.onColor(c)} />
            ))}
          </span>
          {p.tool === 'pen' && (
            <Select value={p.penSize} onValueChange={(value) => p.onPenSize(value as PenSize)} aria-label={t('Espessura da caneta', 'Pen thickness')}>
              <option value="thin">{t('Fina', 'Thin')}</option>
              <option value="medium">{t('Média', 'Medium')}</option>
              <option value="thick">{t('Grossa', 'Thick')}</option>
            </Select>
          )}
          <span className="pdf-group pdf-group--end">
            <IconButton label={t('Desfazer anotação', 'Undo annotation')} disabled={!p.canUndo} onClick={p.onUndo}><Undo2 {...ICON} /></IconButton>
            <IconButton label={t('Refazer anotação', 'Redo annotation')} disabled={!p.canRedo} onClick={p.onRedo}><Redo2 {...ICON} /></IconButton>
          </span>
        </div>
      )}
    </div>
  )
}
