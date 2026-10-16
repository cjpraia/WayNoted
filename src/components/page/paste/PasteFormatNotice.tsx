import './paste.css'

export type PasteMode = 'formatted' | 'plain'

interface Props {
  left: number
  top: number
  mode: PasteMode
  /** 0–1 enquanto uma colagem grande é convertida; undefined quando concluída. */
  progress?: number
  onChoose: (mode: PasteMode) => void
  onCancel?: () => void
  onHover: (inside: boolean) => void
  t: (pt: string, en: string) => string
}

/**
 * Aviso temporário que não rouba o foco do editor: os botões evitam o mousedown padrão,
 * então a digitação continua no texto (e qualquer tecla fecha o aviso).
 */
export function PasteFormatNotice({ left, top, mode, progress, onChoose, onCancel, onHover, t }: Props) {
  const keep = (event: { preventDefault: () => void }) => event.preventDefault()
  if (progress !== undefined) {
    return <div className="pg-paste-format-notice" role="status" aria-live="polite" style={{ position: 'fixed', left, top }} onMouseDown={keep}>
      <span>{t('Convertendo colagem…', 'Converting paste…')}</span>
      <div className="pg-paste-format-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      {onCancel && <button type="button" onClick={onCancel}>{t('Colar como texto', 'Paste as text')}</button>}
    </div>
  }
  return <div className="pg-paste-format-notice" role="group" aria-label={t('Formato da colagem', 'Paste format')}
    style={{ position: 'fixed', left, top }} onMouseDown={keep} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
    <span>{mode === 'formatted' ? t('Colado com formatação', 'Pasted with formatting') : t('Colado como texto', 'Pasted as text')}</span>
    <button type="button" aria-pressed={mode === 'plain'} onClick={() => { if (mode !== 'plain') onChoose('plain') }}>{t('Colar como texto', 'Paste as text')}</button>
    <button type="button" aria-pressed={mode === 'formatted'} onClick={() => { if (mode !== 'formatted') onChoose('formatted') }}>{t('Manter formatação', 'Keep formatting')}</button>
  </div>
}
