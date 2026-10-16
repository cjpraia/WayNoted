import COMPAT from '../../../shared/compatibility.ts'
// Assistente "Importar do Export Bundle": escolher ZIP/pasta → pré-visualizar → importar (cancelável) → relatório/desfazer.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FileText, FolderOpen, Undo2, X } from 'lucide-react'
import { actions, getState, selectors } from '../../store'
import { humanError } from '../../onboarding/humanError'
import { importSummary } from '../../onboarding/day'
import { t, useI18n } from '../../i18n'
import type { ExportPlan, ImportPreview, ImportResult, ImportWarning } from "../../importers/bundle/importer"
import { filesFromDrop, pickExport, type PickedExport } from "../../importers/bundle/source"
import { ProgressBar } from '../ui/ProgressBar'
import "./ImportDialog.css"

// Estado global mínimo para abrir o assistente de qualquer lugar (Configurações, menu Arquivo).
let open = false
export type ImportSource = "bundle" | "markdown" | "archive"
let openSource: ImportSource = "bundle"
const listeners = new Set<() => void>()
export function openBundleImport(source: ImportSource = "bundle") { openSource = source; open = true; listeners.forEach(listener => listener()) }
function closeBundleImport() { open = false; listeners.forEach(listener => listener()) }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

type Step =
  | { kind: 'choose' }
  | { kind: 'reading'; name: string }
  | { kind: 'preview'; name: string; plan: ExportPlan; preview: ImportPreview }
  | { kind: 'importing'; name: string; percent: number; label: string }
  | { kind: 'done'; name: string; result: ImportResult; undone: boolean }
  | { kind: 'error'; message: string }

// O conversor (fflate, parsers) só é carregado quando o assistente é usado.
const loadImporter = (source: ImportSource) => Promise.all([import("../../importers/bundle/importer"), import("../../importers/bundle/vfs"), source === "markdown" ? import("../../importers/markdown/vault") : null, source === "archive" ? import("../../importers/archive/enex") : null])
  .then(([importer, vfs, vault, enex]) => ({ ...importer, ...vfs,
    ...(vault ? { analyzeExport: vault.analyzeVault as unknown as typeof importer.analyzeExport, previewExport: vault.previewVault as unknown as typeof importer.previewExport, buildImport: vault.buildVaultImport as unknown as typeof importer.buildImport } : {}),
    ...(enex ? { analyzeExport: enex.analyzeEnex as unknown as typeof importer.analyzeExport, previewExport: enex.previewEnex as unknown as typeof importer.previewExport, buildImport: enex.buildEnexImport as unknown as typeof importer.buildImport } : {}) }))
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function formatBytes(bytes: number, locale: string) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes, unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`
}
function readError(error: unknown): string {
  if (error instanceof Error && error.message === "BUNDLE_IMPORT_TOO_LARGE") return t('A exportação passa de 4 GB descompactados. Exporte o espaço em partes menores.', 'The export exceeds 4 GB uncompressed. Export the workspace in smaller parts.')
  if (error instanceof Error && error.message === 'ENEX_IMPORT_TOO_LARGE') return t('Um dos arquivos .enex passa de 512 MB. Exporte o caderno em partes menores.', 'One of the .enex files exceeds 512 MB. Export the notebook in smaller parts.')
  return humanError('import', error, t).text
}

export function BundleImportHost() {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  // Configurações abrem o assistente por evento, sem importar este módulo.
  useEffect(() => {
    const listener = () => openBundleImport("bundle")
    const markdown = () => openBundleImport("markdown")
    const archive = () => openBundleImport("archive")
    window.addEventListener(COMPAT.record033, listener)
    window.addEventListener(COMPAT.record034, markdown)
    window.addEventListener(COMPAT.record035, archive)
    return () => { window.removeEventListener(COMPAT.record033, listener); window.removeEventListener(COMPAT.record034, markdown); window.removeEventListener(COMPAT.record035, archive) }
  }, [])
  return isOpen ? <ImportDialog onClose={closeBundleImport} source={openSource} /> : null
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

import { useModalFocus } from '../../a11y/useModalFocus'

export function ImportDialog({ onClose, source = "bundle" }: { onClose: () => void; source?: ImportSource }) {
  const { locale } = useI18n()
  const markdown = source === "markdown"
  const archive = source === "archive"
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  const [dragging, setDragging] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useModalFocus(box, { initial: () => box.current })
  const busy = step.kind === 'reading' || step.kind === 'importing'

  const load = async (picked: PickedExport | null) => {
    if (!picked) return
    setStep({ kind: 'reading', name: picked.name })
    await tick()
    try {
      const { buildVirtualFS, analyzeExport, previewExport } = await loadImporter(source)
      const vfs = buildVirtualFS(picked.files)
      const plan = analyzeExport(vfs)
      setStep({ kind: 'preview', name: picked.name, plan, preview: previewExport(plan, locale) })
    } catch (error) { setStep({ kind: 'error', message: readError(error) }) }
  }
  const choose = (kind: 'zip' | 'folder' | 'enex') => void pickExport(kind).then(load).catch(error => setStep({ kind: 'error', message: readError(error) }))

  const start = async () => {
    if (step.kind !== 'preview') return
    const { plan, name } = step
    const abort = new AbortController()
    controller.current = abort
    const label = (phase: string) => phase === 'save' ? t('Gravando páginas no dispositivo…', 'Saving pages on this device…') : t('Convertendo páginas…', 'Converting pages…')
    setStep({ kind: 'importing', name, percent: 0, label: label('convert') })
    const { buildImport, analyzeExport, previewExport } = await loadImporter(source)
    try {
      const result = await buildImport(plan, {
        locale, signal: abort.signal,
        author: getState().settings.userName || undefined,
        parseHTML: html => new DOMParser().parseFromString(html, 'text/html'),
        onProgress: (phase, done, total) => setStep({ kind: 'importing', name, percent: Math.round((done / Math.max(1, total)) * 50), label: label(phase) }),
      })
      await actions.importPageTree(result.pages, result.documents, {
        signal: abort.signal,
        onProgress: (done, total) => setStep({ kind: 'importing', name, percent: 50 + Math.round((done / Math.max(1, total)) * 50), label: label('save') }),
      })
      // ⌘Z (fora de campos de texto) desfaz o lote inteiro: um passo estrutural na pilha de desfazer.
      if (archive) actions.transact(t("Importar do ENEX Archive", "Import from ENEX Archive"), [], () => {}, { created: () => result.pages.map(page => page.id) })
      setStep({ kind: 'done', name, result, undone: false })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') { const fresh = analyzeExport(plan.vfs); setStep({ kind: 'preview', name, plan: fresh, preview: previewExport(fresh, locale) }) }
      else setStep({ kind: 'error', message: readError(error) })
    } finally { controller.current = null }
  }

  const undo = () => {
    if (step.kind !== 'done') return
    if (archive && actions.nextUndoIsStructural()) actions.undoDatabase()
    else actions.trashPage(step.result.rootId)
    setStep({ ...step, undone: true })
  }
  const openRoot = () => {
    if (step.kind !== 'done') return
    if (selectors.isLive(step.result.rootId)) actions.openPage(step.result.rootId)
    onClose()
  }
  const dismiss = () => { if (busy) controller.current?.abort(); else onClose() }

  return <div className="nid-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }}>
    <div className="nid-dialog" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="nid-title">
      <header>
        <BundleMark />
        <h2 id="nid-title">{archive ? t("Importar do ENEX Archive", "Import from ENEX Archive") : markdown ? t("Importar do Markdown Vault", "Import from Markdown Vault") : t("Importar do Export Bundle", "Import from Export Bundle")}</h2>
        <button className="nid-icon" onClick={dismiss} aria-label={busy ? t('Cancelar importação', 'Cancel import') : t('Fechar', 'Close')}><X size={16} /></button>
      </header>

      {step.kind === 'choose' && <>
        <p>{archive ? t("No ENEX Archive, selecione um caderno e use Arquivo → Exportar notas… → formato ENEX (.enex). Cada nota vira uma página, com tarefas, tabelas, listas, anexos e etiquetas. Nada é enviado pela rede: tudo é lido neste dispositivo.", "In ENEX Archive, select a notebook and use File → Export Notes… → ENEX (.enex) format. Each note becomes a page, with tasks, tables, lists, attachments and tags. Nothing is sent over the network: everything is read on this device.") : markdown ? t("Escolha a pasta do seu vault (ou um ZIP dela). As notas viram páginas dentro de suas pastas, [[links]] entre notas são ligados, anexos são copiados e o front-matter vira uma tabela de propriedades. A pasta .markdown é ignorada. Nada é enviado pela rede.", "Choose your vault folder (or a ZIP of it). Notes become pages inside their folders, [[links]] between notes are connected, attachments are copied, and front-matter becomes a properties table. The .markdown folder is ignored. Nothing is sent over the network.") : t("No Export Bundle, abra ••• → Exportar, escolha “Markdown & CSV” ou “HTML”, inclua subpáginas e baixe o ZIP. Nada é enviado pela rede: tudo é lido neste dispositivo.", "In Export Bundle, open ••• → Export, choose “Markdown & CSV” or “HTML”, include subpages, and download the ZIP. Nothing is sent over the network: everything is read on this device.")}</p>
        <div className={`nid-drop${dragging ? ' is-over' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void filesFromDrop(event.dataTransfer.files).then(load).catch(error => setStep({ kind: 'error', message: readError(error) })) }}>
          <div className="nid-choices">
            {archive && <button className="nid-choice" onClick={() => choose('enex')}><FileText size={20} aria-hidden /><span><strong>{t('Arquivos .enex', '.enex files')}</strong><small>{t('Um ou vários cadernos', 'One or several notebooks')}</small></span></button>}
            {!archive && <button className="nid-choice" onClick={() => choose('zip')}><FileArchive size={20} aria-hidden /><span><strong>{t('Arquivo ZIP', 'ZIP file')}</strong><small>{t('Inclusive ZIPs com várias partes', 'Including multi-part ZIPs')}</small></span></button>}
            <button className="nid-choice" onClick={() => choose('folder')}><FolderOpen size={20} aria-hidden /><span><strong>{t('Pasta descompactada', 'Unzipped folder')}</strong><small>{archive ? t('Pasta com arquivos .enex', 'Folder with .enex files') : markdown ? t('A pasta do vault', 'The vault folder') : t('A pasta extraída da exportação', 'The extracted export folder')}</small></span></button>
          </div>
          <small className="nid-hint">{archive ? t('Ou arraste os arquivos .enex para cá.', 'Or drop the .enex files here.') : t('Ou arraste o ZIP para cá.', 'Or drop the ZIP here.')}</small>
        </div>
      </>}

      {step.kind === 'reading' && <div className="nid-progress" role="status"><span>{t('Lendo {name}…', 'Reading {name}…', { name: step.name })}</span><div className="nid-bar is-indeterminate"><div /></div></div>}

      {step.kind === 'preview' && <>
        <p className="nid-source">{step.name}{step.preview.nestedArchives > 0 && ` · ${t('{count} ZIPs internos', '{count} inner ZIPs', { count: step.preview.nestedArchives })}`} · {formatBytes(step.preview.bytes, locale)}</p>
        {step.preview.pages + step.preview.databases > 0 ? <>
          <dl className="nid-stats">
            <div><dt>{archive ? t('Notas', 'Notes') : t('Páginas', 'Pages')}</dt><dd>{step.preview.pages.toLocaleString(locale)}</dd></div>
            {!archive && <div><dt>{t('Bancos de dados', 'Databases')}</dt><dd>{step.preview.databases.toLocaleString(locale)}</dd></div>}
            {!archive && <div><dt>{t('Linhas', 'Rows')}</dt><dd>{step.preview.rows.toLocaleString(locale)}</dd></div>}
            <div><dt>{archive ? t('Anexos', 'Attachments') : t('Arquivos', 'Files')}</dt><dd>{step.preview.files.toLocaleString(locale)}</dd></div>
          </dl>
          <p>{archive ? t("Tudo será criado dentro de uma nova página “Importado do ENEX Archive” com a data de hoje. Nenhuma página existente será alterada; você pode cancelar durante a importação e desfazer depois (⌘Z).", "Everything will be created inside a new “Imported from ENEX Archive” page with today’s date. No existing page will be changed; you can cancel while importing and undo afterwards (⌘Z).") : markdown ? t("Tudo será criado dentro de uma nova página “Importado do Markdown Vault”. Nenhuma página existente será alterada.", "Everything will be created inside a new “Imported from Markdown Vault” page. No existing page will be changed.") : t("Tudo será criado dentro de uma nova página “Importado do Export Bundle”. Nenhuma página existente será alterada.", "Everything will be created inside a new “Imported from Export Bundle” page. No existing page will be changed.")}</p>
        </> : null}
        <Warnings items={step.preview.warnings} />
        <footer>
          <button onClick={() => setStep({ kind: 'choose' })}>{t('Escolher outro', 'Choose another')}</button>
          <button className="nid-primary" disabled={step.preview.pages + step.preview.databases === 0} onClick={() => void start()}>{t('Importar', 'Import')}</button>
        </footer>
      </>}

      {step.kind === 'importing' && <>
        <div className="nid-progress" role="status" aria-live="polite">
          <ProgressBar value={step.percent / 100} label={step.label} onCancel={() => controller.current?.abort()} cancelLabel={t('Cancelar', 'Cancel')} />
        </div>
      </>}

      {step.kind === 'done' && <>
        <div className="nid-done" role="status">
          <CheckCircle2 size={18} aria-hidden />
          <span>{step.undone
            ? t('Importação desfeita: tudo foi movido para a lixeira.', 'Import undone: everything was moved to the trash.')
            : importSummary(step.result.stats.pages, step.result.stats.databases, step.result.warnings.length, t, n => n.toLocaleString(locale))}</span>
        </div>
        {!step.undone && <p className="nid-next">{t('Próximos passos: abra as páginas importadas, confira os avisos abaixo e arrume os ícones ou a barra lateral ao seu gosto. Se não ficou como esperado, você pode desfazer.', 'Next steps: open the imported pages, review the warnings below and tidy icons or the sidebar as you like. If it is not what you expected, you can undo.')}</p>}
        {!step.undone && step.result.stats.links > 0 && <p>{t('{count} links internos foram ligados às páginas importadas.', '{count} internal links were connected to the imported pages.', { count: step.result.stats.links.toLocaleString(locale) })}</p>}
        <Warnings items={step.result.warnings} />
        <footer>
          {!step.undone && <button onClick={undo}><Undo2 size={14} aria-hidden />{t('Desfazer importação', 'Undo import')}</button>}
          <button className="nid-primary" onClick={step.undone ? onClose : openRoot}>{step.undone ? t('Fechar', 'Close') : t('Abrir páginas importadas', 'Open imported pages')}</button>
        </footer>
      </>}

      {step.kind === 'error' && <>
        <p className="nid-error" role="alert">{step.message}</p>
        <p className="nid-next">{t('Nada foi alterado nas suas páginas.', 'Nothing was changed in your pages.')}</p>
        <footer><button onClick={() => setStep({ kind: 'choose' })}>{t('Escolher outro arquivo', 'Choose another file')}</button></footer>
      </>}
    </div>
  </div>
}

/** Ícone de linha próprio (caixa com seta de entrada), sem marca de terceiros. */
function BundleMark() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="nid-mark">
    <path d="M3.5 11.5v3a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3" /><path d="M10 3.5v9" /><path d="M6.5 9l3.5 3.5L13.5 9" />
  </svg>
}
