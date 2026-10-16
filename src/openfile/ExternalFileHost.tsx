import COMPAT from '../../shared/compatibility.ts'
// B5 — Abrir .md/.txt avulso sem importar. O arquivo vira uma visão temporária (fora do espaço de trabalho) com
// o banner "Arquivo: <caminho> — Salvar no arquivo / Importar como página / Fechar". Nada é gravado no arquivo
// sem ação explícita; se o arquivo mudou no disco, o aviso aparece antes de qualquer sobrescrita.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import { actions, api } from '../store'
import { t } from '../i18n'
import { Button } from '../components/ui/Button'
import { Textarea } from '../components/ui/Textarea'
import { useModalFocus } from '../a11y/useModalFocus'
import type { ExternalFile } from '../types'
import { fileErrorMessage as describe, nextQueue } from './externalFile'
const fileErrorMessage = (error: unknown) => describe(error, t)
import './externalFile.css'

type Conflict = 'changed' | 'missing' | 'invalid' | null
const CHECK_MS = 4000

export function ExternalFileHost() {
  const [queue, setQueue] = useState<ExternalFile[]>([])
  const current = queue[0] as ExternalFile | undefined
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [preview, setPreview] = useState('')
  const [conflict, setConflict] = useState<Conflict>(null)
  const [confirm, setConfirm] = useState<'discard' | 'overwrite' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const loaded = useRef<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const draftRef = useRef(draft), savedRef = useRef(saved)
  draftRef.current = draft; savedRef.current = saved
  const dirty = !!current && draft !== saved
  useModalFocus(box, { initial: () => box.current })

  // O main entrega arquivos abertos pelo Finder ("Abrir com…") ou pelo menu; o menu também pede o seletor.
  useEffect(() => {
    const add = (file: ExternalFile) => setQueue(list => nextQueue(list, file, loaded.current === file.fileId && draftRef.current !== savedRef.current))
    const remove = api.onExternalFile?.(add)
    const pick = () => void api.openMarkdownFile?.().then(file => { if (file) add(file) }).catch(error => setFailure(fileErrorMessage(error)))
    window.addEventListener(COMPAT.record023, pick)
    return () => { remove?.(); window.removeEventListener(COMPAT.record023, pick) }
  }, [])

  // Cada arquivo novo na frente da fila reinicia o editor.
  useEffect(() => {
    if (!current) { loaded.current = null; return }
    if (loaded.current !== current.fileId) {
      loaded.current = current.fileId
      setDraft(current.text); setSaved(current.text); setMode('edit'); setConflict(null); setConfirm(null); setMessage(null)
    } else if (draftRef.current === savedRef.current) { setDraft(current.text); setSaved(current.text) }
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alteração externa: confere ao voltar para a janela e periodicamente.
  const check = useCallback(async () => {
    const file = queue[0]
    if (!file || !api.externalFileCheck) return
    try { const result = await api.externalFileCheck(file.fileId); setConflict(result.state === 'same' ? null : result.state) } catch { /* arquivo liberado */ }
  }, [queue])
  useEffect(() => {
    if (!current) return
    const timer = setInterval(() => void check(), CHECK_MS)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [current, check])

  useEffect(() => {
    if (mode !== 'preview' || !current) return
    let alive = true
    void import('../components/page/exportMarkdown').then(module => { if (alive) setPreview(module.markdownPreviewHtml(draft)) }).catch(() => { if (alive) setPreview('') })
    return () => { alive = false }
  }, [mode, current, draft])

  if (!current) return failure ? <div className="xf-overlay" onKeyDown={event => { if (event.key === 'Escape') setFailure(null) }}>
    <div className="xf-dialog xf-small" role="alertdialog" aria-modal="true" aria-label={t('Não foi possível abrir', 'Could not open')}>
      <p className="xf-error">{failure}</p>
      <div className="xf-actions"><Button variant="primary" autoFocus onClick={() => setFailure(null)}>{t('Fechar', 'Close')}</Button></div>
    </div>
  </div> : null

  const finish = () => { void api.externalFileRelease?.(current.fileId); setQueue(list => list.slice(1)); setConfirm(null) }
  const close = () => { if (dirty && confirm !== 'discard') { setConfirm('discard'); return } finish() }
  const save = async (force = false) => {
    setBusy(true); setMessage(null)
    try {
      const result = await api.externalFileSave!(current.fileId, draft, { force })
      if (result.saved) { setSaved(draft); setConflict(null); setConfirm(null); setMessage({ text: t('Salvo no arquivo.', 'Saved to the file.') }) }
      else { setConflict(result.conflict ?? 'changed'); setConfirm('overwrite') }
    } catch (error) { setMessage({ text: fileErrorMessage(error), error: true }) } finally { setBusy(false) }
  }
  const reload = async () => {
    setBusy(true)
    try { const file = await api.externalFileReload!(current.fileId); setQueue(list => [file, ...list.slice(1)]); setDraft(file.text); setSaved(file.text); setConflict(null); setConfirm(null); setMessage({ text: t('Recarregado do disco.', 'Reloaded from disk.') }) }
    catch (error) { setMessage({ text: fileErrorMessage(error), error: true }) } finally { setBusy(false) }
  }
  const importAsPage = async () => {
    setBusy(true); setMessage(null)
    try {
      const { importMarkdownAsPage } = await import('../components/page/exportMarkdown')
      const id = await importMarkdownAsPage(current.name, draft)
      finish(); actions.openPage(id)
    } catch (error) { setMessage({ text: fileErrorMessage(error), error: true }) } finally { setBusy(false) }
  }

  return <div className="xf-overlay" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); close() } }}>
    <div className="xf-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="xf-title">
      <header className="xf-banner">
        <FileText size={16} aria-hidden />
        <div className="xf-file">
          <strong id="xf-title">{current.name}{dirty ? ' •' : ''}</strong>
          <span className="xf-path" title={current.path}>{t('Arquivo: {path}', 'File: {path}', { path: current.path })}</span>
        </div>
        <div className="xf-actions">
          <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>{t('Salvar no arquivo', 'Save to file')}</Button>
          <Button disabled={busy} onClick={() => void importAsPage()}>{t('Importar como página', 'Import as page')}</Button>
          <Button disabled={busy} onClick={close}>{t('Fechar', 'Close')}</Button>
        </div>
      </header>
      <p className="xf-note">{t('Visão temporária: nada é gravado no arquivo nem no seu espaço até você escolher uma das ações acima.', 'Temporary view: nothing is written to the file or to your workspace until you choose one of the actions above.')}{queue.length > 1 ? ` ${t('Mais {count} na fila.', '{count} more queued.', { count: queue.length - 1 })}` : ''}</p>
      {conflict && <div className="xf-warn" role="alert">
        <span>{conflict === 'missing' ? t('O arquivo não existe mais no disco. Salvar vai recriá-lo.', 'The file no longer exists on disk. Saving will recreate it.')
          : conflict === 'invalid' ? t('O arquivo mudou no disco e não é mais um texto UTF-8 válido.', 'The file changed on disk and is no longer valid UTF-8 text.')
          : t('O arquivo mudou no disco depois que você o abriu.', 'The file changed on disk after you opened it.')}</span>
        <div className="xf-actions">
          {conflict !== 'missing' && conflict !== 'invalid' && <Button disabled={busy} onClick={() => void reload()}>{t('Recarregar do disco', 'Reload from disk')}</Button>}
          {dirty && <Button variant="danger" disabled={busy} onClick={() => void save(true)}>{t('Sobrescrever com a minha versão', 'Overwrite with my version')}</Button>}
        </div>
      </div>}
      {confirm === 'discard' && <div className="xf-warn" role="alertdialog" aria-label={t('Descartar alterações', 'Discard changes')}>
        <span>{t('Há alterações não salvas neste arquivo. Descartar?', 'There are unsaved changes in this file. Discard them?')}</span>
        <div className="xf-actions"><Button onClick={() => setConfirm(null)}>{t('Continuar editando', 'Keep editing')}</Button><Button variant="danger" onClick={finish}>{t('Descartar e fechar', 'Discard and close')}</Button></div>
      </div>}
      <div className="xf-tabs" role="group" aria-label={t('Modo', 'Mode')}>
        <Button variant="ghost" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>{t('Texto', 'Text')}</Button>
        <Button variant="ghost" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>{t('Prévia', 'Preview')}</Button>
      </div>
      {mode === 'edit'
        ? <Textarea className="xf-editor" value={draft} spellCheck={false} aria-label={t('Conteúdo do arquivo', 'File content')} onChange={event => { setDraft(event.target.value); setMessage(null) }} />
        : <div className="xf-preview" onClick={event => { if ((event.target as HTMLElement).closest('a')) event.preventDefault() }} dangerouslySetInnerHTML={{ __html: preview }} />}
      {message && <p className={message.error ? 'xf-error' : 'xf-ok'} role="status">{message.text}</p>}
    </div>
  </div>
}
