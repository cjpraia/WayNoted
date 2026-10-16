// D3b — Importação do Apple Notes: pastas e notas lidas sob demanda do app Notas (Automação, somente leitura),
// convertidas em páginas sob "Importado do Apple Notes <data>". Puro: quem busca os lotes é `fetchBatch`
// (no app, IPC → osascript; nos testes, um executor simulado). Cancelável; o lote entra como um passo de ⌘Z.
import type { Page } from '../../types.ts'
import type { Locale } from '../../localization.ts'
import { translate } from '../../localization.ts'
import { pageBlock, type Block } from '../bundle/blocks.ts'
import { Warnings, type ImportOptions, type ImportPreview, type ImportResult } from '../bundle/importer.ts'
import { newId } from '../bundle/util.ts'
import { isoDay, makePage } from '../archive/enex.ts'
import { appleHtmlToBlocks } from './html.ts'
import { parseBatch, type AppleAccount, type AppleFolder, type AppleListing } from './parse.ts'

export const APPLE_BATCH = 20
const TRASH_NAME = /^(recently deleted|apagadas? recentemente|notas apagadas recentemente|excluídas? recentemente|eliminadas? recientemente)$/i

export interface AppleImportPlan {
  accounts: AppleAccount[]
  /** Pastas escolhidas mais os ancestrais necessários, em ordem de árvore (pai antes dos filhos). */
  folders: AppleFolder[]
  selected: ReadonlySet<string>
  notes: number
  locked: number
  warnings: Warnings
}

/** Pastas marcadas por padrão: todas, menos "Apagadas recentemente". */
export const defaultSelection = (listing: AppleListing): string[] => listing.folders.filter(folder => !TRASH_NAME.test(folder.name)).map(folder => folder.id)

export function planAppleImport(listing: AppleListing, selectedIds: Iterable<string>): AppleImportPlan {
  const selected = new Set(selectedIds), byId = new Map(listing.folders.map(folder => [folder.id, folder]))
  const needed = new Set<string>()
  for (const id of selected) for (let folder = byId.get(id); folder && !needed.has(folder.id); folder = folder.parentId ? byId.get(folder.parentId) : undefined) needed.add(folder.id)
  const ordered: AppleFolder[] = []
  const visit = (parentId: string | null) => { for (const folder of listing.folders) if (needed.has(folder.id) && folder.parentId === parentId) { ordered.push(folder); visit(folder.id) } }
  visit(null)
  let notes = 0, locked = 0
  for (const folder of ordered) if (selected.has(folder.id)) { notes += Math.max(0, folder.notes - folder.locked); locked += folder.locked }
  const warnings = new Warnings()
  for (let i = 0; i < locked; i++) warnings.add('apple-locked')
  const accountIds = new Set(ordered.map(folder => folder.accountId))
  return { accounts: listing.accounts.filter(account => accountIds.has(account.id)), folders: ordered, selected, notes, locked, warnings }
}

export function previewAppleImport(plan: AppleImportPlan, locale: Locale): ImportPreview {
  const containers = plan.folders.length + (plan.accounts.length > 1 ? plan.accounts.length : 0)
  return { pages: plan.notes + containers, databases: 0, rows: 0, files: 0, bytes: 0, format: 'none', nestedArchives: 0, warnings: plan.warnings.list(locale) }
}

export interface AppleImportOptions extends Omit<ImportOptions, 'parseHTML'> {
  /** Devolve a saída JSON do osascript para um lote de notas de uma pasta. */
  fetchBatch(folderId: string, offset: number, limit: number): Promise<string>
}

function abortError(): Error { return Object.assign(new Error('Importação cancelada.'), { name: 'AbortError' }) }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export async function buildAppleNotesImport(plan: AppleImportPlan, options: AppleImportOptions): Promise<ImportResult> {
  const { locale } = options
  const now = options.now ?? Date.now()
  const author = options.author ?? translate(locale, 'Importado do Apple Notes', 'Imported from Apple Notes')
  const warnings = new Warnings()
  const untitled = translate(locale, 'Sem título', 'Untitled')
  const check = () => { if (options.signal?.aborted) throw abortError() }
  const multi = plan.accounts.length > 1
  const rootId = newId()
  const pages: Page[] = [], documents: Record<string, unknown[]> = {}
  const children = new Map<string, Block[]>() // pageId -> blocos de subpágina na ordem
  const add = (parentId: string, id: string) => { const list = children.get(parentId) ?? []; list.push(pageBlock(id, false)); children.set(parentId, list) }
  const make = (init: Parameters<typeof makePage>[0]) => { pages.push(makePage({ createdBy: author, updatedBy: author, ...init })); return init.id }

  const accountPage = new Map<string, string>()
  if (multi) for (const account of plan.accounts) { const id = make({ id: newId(), parentId: rootId, title: account.name, icon: '🗂️', order: accountPage.size, createdAt: now, updatedAt: now }); accountPage.set(account.id, id); add(rootId, id) }
  const folderPage = new Map<string, string>()
  const orderIn = new Map<string, number>()
  const nextOrder = (parentId: string) => { const n = orderIn.get(parentId) ?? 0; orderIn.set(parentId, n + 1); return n }
  for (const folder of plan.folders) {
    const parentId = folder.parentId ? folderPage.get(folder.parentId)! : multi ? accountPage.get(folder.accountId)! : rootId
    const id = make({ id: newId(), parentId, title: folder.name, icon: '📁', order: nextOrder(parentId), createdAt: now, updatedAt: now })
    folderPage.set(folder.id, id); add(parentId, id)
  }

  let done = 0
  const total = Math.max(1, plan.notes)
  let images = 0
  for (const folder of plan.folders) {
    if (!plan.selected.has(folder.id)) continue
    const parentId = folderPage.get(folder.id)!
    for (let offset = 0, known = folder.notes; offset < known; offset += APPLE_BATCH) {
      check()
      let batch
      try { batch = parseBatch(await options.fetchBatch(folder.id, offset, APPLE_BATCH), folder.id) }
      catch (error) { if ((error as Error).name === 'AbortError' || /APPLE_NOTES_(DENIED|TIMEOUT|UNAVAILABLE|ABORTED)/.test(String((error as Error).message))) throw error; warnings.add('apple-batch-failed', `${folder.name} (${offset + 1}–${offset + APPLE_BATCH})`); continue }
      known = Math.max(known, Math.min(batch.total, folder.notes + 5000))
      for (const name of batch.oversized) warnings.add('apple-note-too-large', name)
      for (const note of batch.notes) {
        check()
        if (note.locked) { warnings.add('apple-locked', note.name || untitled); continue }
        const title = note.name || untitled
        const converted = appleHtmlToBlocks(note.body, {
          title, warn: (code, detail) => warnings.add(code, detail ? `${title}: ${detail}` : title),
          imageName: (index, ext) => `${translate(locale, 'imagem', 'image')}-${index}.${ext}`,
        })
        images += converted.images
        const id = newId()
        documents[id] = converted.blocks
        make({ id, parentId, title, order: nextOrder(parentId), createdAt: note.created ?? note.modified ?? now, updatedAt: note.modified ?? note.created ?? now })
        add(parentId, id)
        done++
      }
      options.onProgress?.('convert', Math.min(done, total), total)
      await tick()
    }
  }
  const rootTitle = options.rootTitle ?? `${translate(locale, 'Importado do Apple Notes', 'Imported from Apple Notes')} ${isoDay(now)}`
  pages.unshift(makePage({ id: rootId, parentId: null, title: rootTitle, icon: '📥', order: 0, createdAt: now, updatedAt: now, createdBy: author, updatedBy: author }))
  for (const [id, blocks] of children) documents[id] = blocks
  options.onProgress?.('convert', total, total)
  return { rootId, pages, documents, warnings: warnings.list(locale), stats: { pages: done + plan.folders.length + (multi ? plan.accounts.length : 0), databases: 0, rows: 0, files: images, links: 0 } }
}
