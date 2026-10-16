// "Mostrar no quadro" (menu da página): escolhe um quadro existente ou cria um novo com o cartão da página.
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Popover } from '../page/Popover'
import { useI18n } from '../../i18n'
import { canvasPages, showOnCanvas } from './canvasActions'
import { CanvasIcon } from './icons'

export function ShowOnCanvasPanel({ pageId, anchor, onBack, onClose }: { pageId: string; anchor: HTMLElement | null; onBack(): void; onClose(): void }) {
  const { t } = useI18n()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const boards = canvasPages().filter(board => board.id !== pageId && !board.locked).slice(0, 12)
  const pick = (target: string | 'new') => {
    if (busy) return
    setBusy(true); setError('')
    void showOnCanvas(pageId, target).then(onClose, cause => { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) })
  }
  return <Popover anchor={anchor} onClose={() => { if (!busy) onClose() }} align="end" className="pg-template-panel" width={300}>
    <div className="pg-history-head"><button type="button" onClick={onBack} aria-label={t('Voltar ao menu', 'Back to menu')}><ArrowLeft size={16} /></button><strong>{t('Mostrar na lousa', 'Show on whiteboard')}</strong></div>
    <div className="pg-menu-section">
      <button type="button" className="pg-menu-item" disabled={busy} onClick={() => pick('new')}><span className="pg-menu-icon"><CanvasIcon name="canvas" size={16} /></span><span className="pg-menu-label">{t('Nova lousa', 'New whiteboard')}</span></button>
      {boards.length > 0 && <div className="pg-menu-caption">{t('Lousas', 'Whiteboards')}</div>}
      {boards.map(board => <button key={board.id} type="button" className="pg-menu-item" disabled={busy} onClick={() => pick(board.id)}><span className="pg-menu-icon">{board.icon && !/^data:/.test(board.icon) ? board.icon : <CanvasIcon name="canvas" size={16} />}</span><span className="pg-menu-label">{board.title || t('Sem título', 'Untitled')}</span></button>)}
    </div>
    {error && <div className="pg-menu-error" role="alert">{error}</div>}
  </Popover>
}
