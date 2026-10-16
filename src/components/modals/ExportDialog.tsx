// Diálogo "Exportar…": formato, escopo, arquivos, destino, progresso e resultado.
import { humanError } from '../../onboarding/humanError'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileDown, FolderOpen, X } from 'lucide-react'
import { getState, useStore } from '../../store'
import { useI18n } from '../../i18n'
import type { ExportScope } from '../../export/model'
import { canChooseFolder, canExportPdf, canReveal, onExportDialog, revealExport, runExport, type ExportDestination, type ExportRequest, type ExportResult } from '../../export/run'
import { Button } from '../ui/Button'
import { DialogActions } from '../ui/DialogActions'
import './ExportDialog.css'

type Format = ExportRequest['format']

export function ExportDialogHost() {
  const [open, setOpen] = useState<{ pageId?: string } | null>(null)
  useEffect(() => onExportDialog((pageId) => {
    const route = getState().route
    setOpen({ pageId: pageId ?? (route.type === 'page' ? route.id : undefined) })
  }), [])
  return open ? <ExportDialog pageId={open.pageId} onClose={() => setOpen(null)} /> : null
}

export function ExportDialog({ pageId, onClose }: { pageId?: string; onClose: () => void }) {
  const { t } = useI18n()
  const { pages } = useStore()
  const page = pageId ? pages[pageId] : undefined
  const [format, setFormat] = useState<Format>('markdown')
  const [scope, setScope] = useState<ExportScope>(page ? 'tree' : 'workspace')
  const [includeFiles, setIncludeFiles] = useState(true)
  const [includePlayers, setIncludePlayers] = useState(false)
  const [destination, setDestination] = useState<ExportDestination>('zip')
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const busy = !!progress && !result && !error
  const effectiveScope: ExportScope = format === 'pdf' ? 'page' : scope

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const start = async () => {
    setError(''); setResult(null); setProgress({ fraction: 0, label: t('Preparando…', 'Preparing…') })
    try {
      const done = await runExport({ format, scope: effectiveScope, pageId: effectiveScope === 'workspace' ? undefined : pageId, includeFiles, includePlayers: format === 'html' && includePlayers, destination }, (fraction, label) => setProgress({ fraction, label }))
      if (!done.saved) { setProgress(null); return }
      setResult(done)
    } catch (cause) {
      setError(humanError('export', cause, t).text)
      setProgress(null)
    }
  }

  const formats: { id: Format; label: string; hint: string }[] = [
    { id: 'markdown', label: 'Markdown', hint: t('Pastas, .md com front-matter, CSV e schema.json. Reimportável.', 'Folders, .md with front-matter, CSV and schema.json. Re-importable.') },
    { id: 'html', label: 'HTML', hint: t('Páginas autocontidas com navegação, para abrir em qualquer navegador.', 'Self-contained pages with navigation, for any browser.') },
    ...(canExportPdf() && page ? [{ id: 'pdf' as Format, label: 'PDF', hint: t('A página aberta, com o visual do app.', 'The open page, with the app look.') }] : []),
  ]
  const scopes: { id: ExportScope; label: string; disabled?: boolean }[] = [
    { id: 'page', label: t('Somente esta página', 'This page only'), disabled: !page },
    { id: 'tree', label: t('Página e subpáginas', 'Page and subpages'), disabled: !page || format === 'pdf' },
    { id: 'workspace', label: t('Espaço inteiro', 'Entire workspace'), disabled: format === 'pdf' },
  ]

  return (
    <div className="exd-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="exd-dialog" role="dialog" aria-modal="true" aria-labelledby="exd-title" tabIndex={-1} ref={box}>
        <header>
          <FileDown size={18} />
          <h2 id="exd-title">{t('Exportar', 'Export')}</h2>
          <button aria-label={t('Fechar', 'Close')} onClick={onClose} disabled={busy}><X size={16} /></button>
        </header>
        {result ? (
          <div className="exd-done" role="status">
            <CheckCircle2 size={28} />
            <p><strong>{t('Exportação concluída', 'Export complete')}</strong></p>
            <p>{format === 'pdf' ? t('PDF salvo.', 'PDF saved.') : t('{pages} páginas · {files} arquivos', '{pages} pages · {files} files', { pages: result.pages, files: result.files })}</p>
            {result.path && <p className="exd-path" title={result.path}>{result.path}</p>}
            <p className="exd-hint">{t('Guarde esta cópia em outro lugar (disco externo ou sua nuvem pessoal) para ter um backup de verdade.', 'Keep this copy somewhere else (external drive or your personal cloud) for a real backup.')}</p>
            <div className="np-dialog-actions exd-done-actions">
              {result.path && canReveal() && <Button onClick={() => void revealExport(result.path!)?.catch((cause: unknown) => setError(String(cause)))}><FolderOpen size={16} />{t('Mostrar no Finder', 'Show in Finder')}</Button>}
              <Button variant="primary" autoFocus onClick={onClose}>{t('Concluir', 'Done')}</Button>
            </div>
          </div>
        ) : (
          <>
            <fieldset disabled={busy}>
              <legend>{t('Formato', 'Format')}</legend>
              <div className="exd-segment" role="radiogroup">
                {formats.map((item) => <button key={item.id} role="radio" aria-checked={format === item.id} className={format === item.id ? 'is-on' : ''} onClick={() => setFormat(item.id)}>{item.label}</button>)}
              </div>
              <p className="exd-hint">{formats.find((item) => item.id === format)?.hint}</p>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>{t('Conteúdo', 'Content')}</legend>
              {scopes.map((item) => (
                <label key={item.id} className={`exd-radio${item.disabled ? ' is-disabled' : ''}`}>
                  <input type="radio" name="exd-scope" checked={effectiveScope === item.id} disabled={item.disabled} onChange={() => setScope(item.id)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            {format !== 'pdf' && (
              <fieldset disabled={busy}>
                <legend>{t('Opções', 'Options')}</legend>
                <label className="exd-switch">
                  <span>{t('Incluir imagens e arquivos', 'Include images and files')}</span>
                  <input type="checkbox" className="np-switch" checked={includeFiles} onChange={(event) => setIncludeFiles(event.target.checked)} />
                </label>
                {format === 'html' && (
                  <label className="exd-switch" title={t('O HTML exportado carrega o player do provedor (YouTube, Vimeo…) ao ser aberto, o que contacta a internet.', 'The exported HTML loads the provider player (YouTube, Vimeo…) when opened, which contacts the internet.')}>
                    <span>{t('Incluir players de vídeo online (requer internet ao abrir)', 'Include online video players (needs internet when opened)')}</span>
                    <input type="checkbox" className="np-switch" checked={includePlayers} onChange={(event) => setIncludePlayers(event.target.checked)} />
                  </label>
                )}
                {canChooseFolder() && (
                  <div className="exd-segment exd-small" role="radiogroup" aria-label={t('Destino', 'Destination')}>
                    <button role="radio" aria-checked={destination === 'zip'} className={destination === 'zip' ? 'is-on' : ''} onClick={() => setDestination('zip')}>{t('Arquivo ZIP', 'ZIP file')}</button>
                    <button role="radio" aria-checked={destination === 'folder'} className={destination === 'folder' ? 'is-on' : ''} onClick={() => setDestination('folder')}>{t('Pasta', 'Folder')}</button>
                  </div>
                )}
              </fieldset>
            )}
            {progress && (
              <div className="exd-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
                <div><span style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
                <small>{progress.label}</small>
              </div>
            )}
            {error && <p className="exd-error" role="alert">{error}</p>}
            <DialogActions confirmLabel={busy ? t('Exportando…', 'Exporting…') : t('Exportar', 'Export')} onConfirm={() => void start()} onCancel={onClose} busy={busy} />
          </>
        )}
      </div>
    </div>
  )
}
