import PRODUCT from '../../shared/product.json' with { type: 'json' }
import COMPAT from '../../shared/compatibility.ts'
// Ponte entre o diálogo de exportação, o store e o processo nativo (Electron).
import { actions, api, getState } from '../store'
import { t } from '../i18n'
import { printElement } from '../components/modals/printPage'
import { buildExportPackage } from './package.ts'
import { withoutLockedPages } from '../security/pageLock'
import { buildLayout } from './layout.ts'
import { safeFileName, type ExportFormat, type ExportScope, type ExportSource, type PackageFiles } from './model.ts'

interface ExportNative {
  saveExport?(input: { name: string; kind: 'zip'; data: Uint8Array } | { name: string; kind: 'folder'; files: PackageFiles }): Promise<string | null>
  exportPagePDF?(name: string): Promise<string | null>
  revealExport?(target: string): Promise<void>
}
const native = () => api as typeof api & ExportNative

export type ExportDestination = 'zip' | 'folder'
export interface ExportRequest { format: ExportFormat | 'pdf'; scope: ExportScope; pageId?: string; includeFiles: boolean; includePlayers?: boolean; destination: ExportDestination }
export interface ExportResult { saved: boolean; path: string | null; files: number; pages: number }
export type ProgressHandler = (fraction: number, label: string) => void

export const canChooseFolder = () => !!native().saveExport
export const canExportPdf = () => !!(native().exportPagePDF || api.exportPDF)
export const canReveal = () => !!native().revealExport
export function revealExport(path: string) { return native().revealExport?.(path) }

async function collectSource(scope: ExportScope, pageId: string | undefined, onProgress: ProgressHandler): Promise<ExportSource> {
  await actions.flushAll()
  const state = getState()
  // Locked password-protected pages (and their subpages) are left out of every export.
  const layout = buildLayout(withoutLockedPages(state.pages), scope, pageId, 'md', 'x')
  const documents: Record<string, unknown[]> = {}
  let done = 0
  for (const node of layout.order) {
    documents[node.page.id] = (await api.loadDoc(node.page.id)) ?? []
    onProgress(0.4 * (++done / layout.order.length), t('Lendo páginas…', 'Reading pages…'))
  }
  // O carregamento pode atualizar índices; usa o retrato mais recente.
  const fresh = getState()
  return { pages: withoutLockedPages(fresh.pages), documents, syncedBlocks: fresh.syncedBlocks, objectTypes: fresh.settings.objectTypes, workspaceName: fresh.settings.workspaceName || `${PRODUCT.name}`, locale: fresh.settings.locale ?? 'pt-BR' }
}

export async function runExport(request: ExportRequest, onProgress: ProgressHandler): Promise<ExportResult> {
  const state = getState()
  const page = request.pageId ? state.pages[request.pageId] : undefined
  if (request.format === 'pdf') {
    if (!page) throw new Error(t('Abra uma página para exportar o PDF.', 'Open a page to export its PDF.'))
    onProgress(0.2, t('Preparando o PDF…', 'Preparing the PDF…'))
    await actions.flushAll()
    const target = [...document.querySelectorAll<HTMLElement>('.pg-root[data-page-id], .dbv[data-page-id]')].find((element) => element.dataset.pageId === page.id)
    if (!target) throw new Error(t('Abra a página antes de exportar o PDF.', 'Open the page before exporting its PDF.'))
    const name = `${safeFileName(page.title, t('pagina', 'page'))}.pdf`
    let path: string | null = null
    const saved = await printElement(target, async () => {
      if (native().exportPagePDF) { path = await native().exportPagePDF!(name); return !!path }
      if (api.exportPDF) return api.exportPDF(name)
      throw new Error(t('A exportação PDF requer o aplicativo desktop.', 'PDF export requires the desktop app.'))
    })
    onProgress(1, '')
    return { saved, path, files: saved ? 1 : 0, pages: 1 }
  }
  const source = await collectSource(request.scope, request.pageId, onProgress)
  const { files, manifest } = await buildExportPackage(source, {
    format: request.format, scope: request.scope, pageId: request.pageId, includeFiles: request.includeFiles, includePlayers: request.includePlayers,
    onProgress: (done, total, label) => onProgress(0.4 + 0.45 * (total ? done / total : 1), label),
  })
  const base = request.scope === 'workspace' ? source.workspaceName : page?.title ?? ''
  const name = `${safeFileName(base, `${PRODUCT.name}`)} - ${request.format === 'html' ? 'HTML' : 'Markdown'}`
  const count = Object.keys(files).length
  onProgress(0.9, t('Gravando arquivos…', 'Writing files…'))
  if (request.destination === 'folder' && native().saveExport) {
    const path = await native().saveExport!({ name, kind: 'folder', files })
    onProgress(1, '')
    return { saved: !!path, path, files: count, pages: manifest.pages.length }
  }
  const { zipSync, strToU8 } = await import('fflate')
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? strToU8(value) : value])), { level: 6 })
  let path: string | null = null
  let saved: boolean
  if (native().saveExport) { path = await native().saveExport!({ name, kind: 'zip', data: zip }); saved = !!path }
  else if (api.exportBinaryFile) saved = await api.exportBinaryFile(`${name}.zip`, zip)
  else throw new Error(t('Exportação ZIP indisponível.', 'ZIP export is unavailable.'))
  onProgress(1, '')
  return { saved, path, files: count, pages: manifest.pages.length }
}

// ---------- abertura do diálogo (sem acoplar o store) ----------
const EVENT = COMPAT.record048
export function openExportDialog(pageId?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { pageId } }))
}
export function onExportDialog(handler: (pageId?: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<{ pageId?: string }>).detail?.pageId)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
