import PRODUCT from '../../../shared/product.json' with { type: 'json' }
import COMPAT from '../../../shared/compatibility.ts'
// D3b — Assistente "Importar do Apple Notes": permissão de Automação → escolher pastas → prévia (contagem) →
// importar (cancelável, um passo de ⌘Z) → relatório. Só leitura do app Notas; nada sai deste Mac.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AlertTriangle, CheckCircle2, StickyNote, Undo2, X } from 'lucide-react'
import { actions, api, getState, selectors } from '../../store'
import { t, useI18n } from '../../i18n'
import { importSummary } from '../../onboarding/day'
import { useModalFocus } from '../../a11y/useModalFocus'
import { Button, IconButton } from '../ui/Button'
import { Toggle } from '../ui/Toggle'
import { ProgressBar } from '../ui/ProgressBar'
import type { ImportPreview, ImportResult, ImportWarning } from "../../importers/bundle/importer"
import type { AppleErrorCode, AppleListing } from '../../importers/appleNotes/parse'
import type { AppleImportPlan } from '../../importers/appleNotes/importer'
import "./ImportDialog.css"
import './AppleNotesImportDialog.css'

let open = false
const listeners = new Set<() => void>()
export function openAppleNotesImport() { open = true; listeners.forEach(listener => listener()) }
const closeDialog = () => { open = false; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

type Step =
  | { kind: 'intro' }
  | { kind: 'reading' }
  | { kind: 'choose'; listing: AppleListing; selected: Set<string> }
  | { kind: 'preview'; listing: AppleListing; selected: Set<string>; plan: AppleImportPlan; preview: ImportPreview }
  | { kind: 'importing'; percent: number }
  | { kind: 'done'; result: ImportResult; undone: boolean }
  | { kind: 'error'; code: AppleErrorCode; detail?: string }

export function AppleNotesImportHost() {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  useEffect(() => {
    const listener = () => openAppleNotesImport()
    window.addEventListener(COMPAT.record032, listener)
    return () => window.removeEventListener(COMPAT.record032, listener)
  }, [])
  return isOpen ? <AppleNotesImportDialog onClose={closeDialog} /> : null
}

function Warnings({ items }: { items: ImportWarning[] }) {
  if (!items.length) return null
  return <ul className="nid-warnings" aria-label={t('Avisos', 'Warnings')}>
    {items.map(item => <li key={item.code}>
      <AlertTriangle size={14} aria-hidden />
      <div><span>{item.message}</span>
        {item.examples.length > 0 && <details><summary>{t('Exemplos', 'Examples')}</summary><ul>{item.examples.map(example => <li key={example}>{example}</li>)}</ul></details>}
      </div>
    </li>)}
  </ul>
}

function errorText(code: AppleErrorCode, detail?: string) {
  switch (code) {
    case 'denied': return t(`O macOS não permitiu que o ${PRODUCT.name} controle o app Notas. Libere em Ajustes do Sistema → Privacidade e Segurança → Automação → ${PRODUCT.name} → Notas e tente de novo.`, `macOS did not allow ${PRODUCT.name} to control the Notes app. Allow it in System Settings → Privacy & Security → Automation → ${PRODUCT.name} → Notes, then try again.`)
    case 'timeout': return t('O app Notas não respondeu a tempo. Abra o Notas, espere carregar e tente de novo.', 'The Notes app did not respond in time. Open Notes, wait for it to load and try again.')
    case 'unavailable': return t('Não foi possível abrir o app Notas neste Mac.', 'Could not open the Notes app on this Mac.')
    case 'aborted': return t('Importação cancelada.', 'Import cancelled.')
    default: return detail ? t('Não foi possível ler as notas: {detail}', 'Could not read the notes: {detail}', { detail }) : t('Não foi possível ler as notas do app Notas.', 'Could not read the notes from the Notes app.')
  }
}

export function AppleNotesImportDialog({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const controller = useRef<AbortController | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useModalFocus(box, { initial: () => box.current })
  const busy = step.kind === 'reading' || step.kind === 'importing'
  const supported = !!api.appleNotesFolders

  const fail = async (error: unknown) => {
    const { appleErrorCode } = await import('../../importers/appleNotes/parse')
    const code = appleErrorCode(error)
    setStep({ kind: 'error', code, detail: code === 'failed' ? String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200) : undefined })
  }

  const readFolders = async () => {
    setStep({ kind: 'reading' })
    try {
      const [{ parseListing }, { defaultSelection }] = await Promise.all([import('../../importers/appleNotes/parse'), import('../../importers/appleNotes/importer')])
      const listing = parseListing(await api.appleNotesFolders!())
      setStep({ kind: 'choose', listing, selected: new Set(defaultSelection(listing)) })
    } catch (error) { await fail(error) }
  }
  const toPreview = async (listing: AppleListing, selected: Set<string>) => {
    const { planAppleImport, previewAppleImport } = await import('../../importers/appleNotes/importer')
    const plan = planAppleImport(listing, selected)
    setStep({ kind: 'preview', listing, selected, plan, preview: previewAppleImport(plan, locale) })
  }
  const start = async () => {
    if (step.kind !== 'preview') return
    const { plan, listing, selected } = step
    const abort = new AbortController()
    controller.current = abort
    setStep({ kind: 'importing', percent: 0 })
    try {
      const { buildAppleNotesImport } = await import('../../importers/appleNotes/importer')
      const result = await buildAppleNotesImport(plan, {
        locale, signal: abort.signal, author: getState().settings.userName || undefined,
        fetchBatch: (folderId, offset, limit) => api.appleNotesBatch!(folderId, offset, limit),
        onProgress: (_phase, done, total) => setStep({ kind: 'importing', percent: Math.round((done / Math.max(1, total)) * 50) }),
      })
      await actions.importPageTree(result.pages, result.documents, {
        signal: abort.signal,
        onProgress: (done, total) => setStep({ kind: 'importing', percent: 50 + Math.round((done / Math.max(1, total)) * 50) }),
      })
      // ⌘Z (fora de campos de texto) desfaz o lote inteiro: um passo estrutural na pilha de desfazer.
      actions.transact(t('Importar do Apple Notes', 'Import from Apple Notes'), [], () => {}, { created: () => result.pages.map(page => page.id) })
      setStep({ kind: 'done', result, undone: false })
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') { void api.appleNotesCancel?.(); await toPreview(listing, selected) } else await fail(error)
    } finally { controller.current = null }
  }
  const undo = () => {
    if (step.kind !== 'done') return
    if (actions.nextUndoIsStructural()) actions.undoDatabase(); else actions.trashPage(step.result.rootId)
    setStep({ ...step, undone: true })
  }
  const openRoot = () => { if (step.kind === 'done') { if (selectors.isLive(step.result.rootId)) actions.openPage(step.result.rootId) } onClose() }
  const dismiss = () => { if (busy) { controller.current?.abort(); void api.appleNotesCancel?.() } else onClose() }

  return <div className="ani-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }}>
    <div className="ani-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="nid-title">
      <header>
        <StickyNote size={18} aria-hidden className="ani-mark" />
        <h2 id="nid-title">{t('Importar do Apple Notes', 'Import from Apple Notes')}</h2>
        <IconButton label={busy ? t('Cancelar importação', 'Cancel import') : t('Fechar', 'Close')} onClick={dismiss}><X size={16} /></IconButton>
      </header>

      {step.kind === 'intro' && <>
        <p>{t(`O ${PRODUCT.name} lê as suas notas direto do app Notas, só para leitura: nada é alterado no Notas e nada sai deste Mac. Na primeira vez, o macOS pergunta se o ${PRODUCT.name} pode controlar o Notas; responda “OK”. Notas protegidas por senha são ignoradas.`, `${PRODUCT.name} reads your notes straight from the Notes app, read-only: nothing is changed in Notes and nothing leaves this Mac. The first time, macOS asks whether ${PRODUCT.name} may control Notes; answer “OK”. Password-protected notes are skipped.`)}</p>
        {!supported && <p className="nid-error" role="alert">{t('Disponível apenas no aplicativo para Mac.', 'Available only in the Mac app.')}</p>}
        <footer><Button onClick={onClose}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" disabled={!supported} onClick={() => void readFolders()}>{t('Continuar', 'Continue')}</Button></footer>
      </>}

      {step.kind === 'reading' && <div className="nid-progress" role="status"><span>{t('Falando com o app Notas… se o macOS pedir permissão, aprove na janela dele.', 'Talking to the Notes app… if macOS asks for permission, approve it in its window.')}</span><div className="nid-bar is-indeterminate"><div /></div></div>}

      {step.kind === 'choose' && <>
        <p>{t('Escolha as pastas a importar. Pastas dentro de pastas mantêm a hierarquia.', 'Choose the folders to import. Nested folders keep their hierarchy.')}</p>
        <ul className="ani-tree" aria-label={t('Pastas do Notas', 'Notes folders')}>
          {step.listing.accounts.map(account => <li key={account.id}>
            <strong>{account.name}</strong>
            {step.listing.folders.filter(folder => folder.accountId === account.id).map(folder => {
              const depth = (() => { let d = 0; for (let f = folder; f.parentId; d++) { const parent = step.listing.folders.find(item => item.id === f.parentId); if (!parent || d > 20) break; f = parent } return d })()
              return <div key={folder.id} className="ani-folder" style={{ '--depth': depth } as CSSProperties}>
                <Toggle label={`${folder.name} (${folder.notes})`} checked={step.selected.has(folder.id)} onChange={value => { const next = new Set(step.selected); if (value) next.add(folder.id); else next.delete(folder.id); setStep({ ...step, selected: next }) }} />
              </div>
            })}
          </li>)}
        </ul>
        <footer><Button onClick={onClose}>{t('Cancelar', 'Cancel')}</Button><Button variant="primary" disabled={!step.selected.size} onClick={() => void toPreview(step.listing, step.selected)}>{t('Ver prévia', 'Preview')}</Button></footer>
      </>}

      {step.kind === 'preview' && <>
        {step.plan.notes > 0 ? <>
          <dl className="nid-stats">
            <div><dt>{t('Notas', 'Notes')}</dt><dd>{step.plan.notes.toLocaleString(locale)}</dd></div>
            <div><dt>{t('Pastas', 'Folders')}</dt><dd>{step.plan.folders.length.toLocaleString(locale)}</dd></div>
            <div><dt>{t('Protegidas', 'Protected')}</dt><dd>{step.plan.locked.toLocaleString(locale)}</dd></div>
          </dl>
          <p>{t('Tudo será criado dentro de uma nova página “Importado do Apple Notes” com a data de hoje. Nenhuma página existente será alterada; você pode cancelar durante a importação e desfazer depois (⌘Z). Imagens coladas nas notas são copiadas; outros anexos não.', 'Everything will be created inside a new “Imported from Apple Notes” page with today’s date. No existing page will be changed; you can cancel while importing and undo afterwards (⌘Z). Images pasted into notes are copied; other attachments are not.')}</p>
        </> : <p>{t('Nenhuma nota para importar nas pastas escolhidas.', 'No notes to import in the chosen folders.')}</p>}
        <Warnings items={step.preview.warnings} />
        <footer><Button onClick={() => setStep({ kind: 'choose', listing: step.listing, selected: step.selected })}>{t('Voltar', 'Back')}</Button><Button variant="primary" disabled={step.plan.notes === 0} onClick={() => void start()}>{t('Importar', 'Import')}</Button></footer>
      </>}

      {step.kind === 'importing' && <div className="nid-progress" role="status" aria-live="polite">
        <ProgressBar value={step.percent / 100} label={step.percent < 50 ? t('Lendo e convertendo notas…', 'Reading and converting notes…') : t('Gravando páginas no dispositivo…', 'Saving pages on this device…')} onCancel={() => dismiss()} cancelLabel={t('Cancelar', 'Cancel')} />
      </div>}

      {step.kind === 'done' && <>
        <div className="nid-done" role="status"><CheckCircle2 size={18} aria-hidden /><span>{step.undone ? t('Importação desfeita: tudo foi movido para a lixeira.', 'Import undone: everything was moved to the trash.') : importSummary(step.result.stats.pages, 0, step.result.warnings.length, t, n => n.toLocaleString(locale))}</span></div>
        {!step.undone && <p className="nid-next">{t('Próximos passos: abra as páginas importadas e confira os avisos abaixo. Se não ficou como esperado, você pode desfazer.', 'Next steps: open the imported pages and review the warnings below. If it is not what you expected, you can undo.')}</p>}
        <Warnings items={step.result.warnings} />
        <footer>
          {!step.undone && <Button onClick={undo}><Undo2 size={14} aria-hidden />{t('Desfazer importação', 'Undo import')}</Button>}
          <Button variant="primary" onClick={step.undone ? onClose : openRoot}>{step.undone ? t('Fechar', 'Close') : t('Abrir páginas importadas', 'Open imported pages')}</Button>
        </footer>
      </>}

      {step.kind === 'error' && <>
        <p className="nid-error" role="alert">{errorText(step.code, step.detail)}</p>
        <p className="nid-next">{t('Nada foi alterado nas suas páginas nem no app Notas.', 'Nothing was changed in your pages or in the Notes app.')}</p>
        <footer>
          {step.code === 'denied' && <Button onClick={() => void api.openPrivacySettings?.('automation')}>{t('Abrir Ajustes → Automação', 'Open Settings → Automation')}</Button>}
          <Button onClick={onClose}>{t('Fechar', 'Close')}</Button>
          <Button variant="primary" onClick={() => void readFolders()}>{t('Tentar de novo', 'Try again')}</Button>
        </footer>
      </>}
    </div>
  </div>
}
