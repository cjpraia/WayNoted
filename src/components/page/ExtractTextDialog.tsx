// Diálogo de "Extrair texto" (B6a): roda o OCR/extração local, mostra o texto numa prévia editável e só então
// insere parágrafos abaixo do bloco ("Inserir abaixo") ou copia. Nada sai do computador.
import { useEffect, useRef, useState } from 'react'
import { ScanText, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { ProgressBar } from '../ui/ProgressBar'
import { OCR_PDF_PAGE_LIMIT, extractFromImage, extractFromPdf, paragraphsFromEditedText, paragraphsToText, textToParagraphs, type ExtractDeps, type ExtractTarget, type ExtractProgress, type ExtractResult } from '../../ocr/extractText.ts'
import '../ai/ai.css'

type Stage = { phase: 'running'; progress: ExtractProgress | null } | { phase: 'ready'; result: ExtractResult } | { phase: 'error'; code: string }

export function ExtractTextDialog({ target, editable, onInsert, onClose, deps }: { target: ExtractTarget; editable: boolean; onInsert: (paragraphs: string[]) => void; onClose: () => void; deps?: ExtractDeps }) {
  const { t } = useI18n()
  const [stage, setStage] = useState<Stage>({ phase: 'running', progress: null })
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController(); abort.current = controller
    const previous = document.activeElement as HTMLElement | null
    box.current?.focus()
    void (async () => {
      try {
        const result = target.kind === 'pdf' ? await extractFromPdf(target.data, { ...deps, signal: controller.signal, onProgress: progress => { if (!controller.signal.aborted) setStage({ phase: 'running', progress }) } }) : await extractFromImage(target.data, deps)
        setText(paragraphsToText(textToParagraphs(result.text)))
        setStage({ phase: 'ready', result })
      } catch (cause) { setStage({ phase: 'error', code: cause instanceof Error ? cause.message : 'FAILED' }) }
    })()
    return () => { controller.abort(); if (previous?.isConnected) previous.focus() }
  }, [])
  const paragraphs = paragraphsFromEditedText(text)
  const running = stage.phase === 'running'
  const insert = () => { if (paragraphs.length && editable) { onInsert(paragraphs); onClose() } }
  const copy = () => { void navigator.clipboard?.writeText(paragraphs.join('\n\n')).then(() => setCopied(true)).catch(() => {}) }
  const result = stage.phase === 'ready' ? stage.result : null
  const progress = stage.phase === 'running' ? stage.progress : null
  const errorText = stage.phase === 'error' ? (stage.code === 'OCR_UNAVAILABLE' ? t('A extração de texto de imagens usa o Vision do macOS e só está disponível no app para Mac.', 'Text extraction from images uses macOS Vision and is only available in the Mac app.') : stage.code === 'PDF_UNREADABLE' ? t('Não foi possível ler este PDF.', 'This PDF could not be read.') : t('Não foi possível extrair o texto. Tente de novo.', 'Could not extract the text. Try again.')) : ''
  return <div className="ai-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !running) onClose() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (running) abort.current?.abort(); else onClose() } }}>
    <div className="ai-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('Extrair texto', 'Extract text')} data-testid="extract-text-dialog">
      <header><ScanText size={18} aria-hidden /><h2>{t('Extrair texto', 'Extract text')}{target.name ? ` · ${target.name}` : ''}</h2><button type="button" className="np-icon-btn" onClick={() => { if (running) abort.current?.abort(); onClose() }} aria-label={t('Fechar', 'Close')}><X size={16} /></button></header>
      {running && <ProgressBar
        label={progress ? (progress.phase === 'ocr' ? t('Lendo a página {page} de {total} com o Vision…', 'Reading page {page} of {total} with Vision…', { page: progress.page, total: progress.total }) : t('Página {page} de {total}…', 'Page {page} of {total}…', { page: progress.page, total: progress.total })) : t('Extraindo o texto…', 'Extracting text…')}
        value={progress && target.kind === 'pdf' ? (progress.page - 1) / Math.max(1, progress.total) : undefined}
        onCancel={() => abort.current?.abort()} cancelLabel={t('Cancelar', 'Cancel')} />}
      {stage.phase === 'error' && <p role="alert" className="ai-feedback is-error">{errorText}</p>}
      {result && <p role="status">{result.cancelled ? t('Cancelado: o texto das páginas já lidas foi mantido.', 'Cancelled: the text from the pages already read was kept.') : !paragraphs.length ? t('Nenhum texto foi encontrado.', 'No text was found.') : t('Revise e edite o texto antes de inserir. Idiomas reconhecidos: português e inglês.', 'Review and edit the text before inserting. Recognized languages: Portuguese and English.')}{result.truncated ? ' ' + t('Só as primeiras {n} páginas foram lidas.', 'Only the first {n} pages were read.', { n: OCR_PDF_PAGE_LIMIT }) : ''}</p>}
      {(result || running) && <Textarea value={text} onChange={event => { setText(event.target.value); setCopied(false) }} disabled={running} rows={12} spellCheck={false} aria-label={t('Texto extraído (parágrafos separados por linha em branco)', 'Extracted text (paragraphs separated by a blank line)')} placeholder={running ? '' : t('Nenhum texto', 'No text')} />}
      {!editable && result && <p>{t('Esta página está bloqueada: você ainda pode copiar o texto.', 'This page is locked: you can still copy the text.')}</p>}
      <div className="ai-actions">
        <Button onClick={() => { if (running) abort.current?.abort(); else onClose() }}>{running ? t('Cancelar', 'Cancel') : t('Fechar', 'Close')}</Button>
        <Button onClick={copy} disabled={running || !paragraphs.length}>{copied ? t('Copiado', 'Copied') : t('Copiar', 'Copy')}</Button>
        <Button variant="primary" onClick={insert} disabled={running || !paragraphs.length || !editable}>{t('Inserir abaixo', 'Insert below')}</Button>
      </div>
    </div>
  </div>
}
